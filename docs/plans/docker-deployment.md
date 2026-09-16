# Docker 化部署方案

> 状态：v2（已并入 HTTP 服务形态，双 target 构建）。评审结论见 `docs/review/` 对应记录。

## 目标

将 md2docx 封装为 Docker 镜像，宿主机除 Docker 外零依赖。一石二鸟：Linux 部署由"装 6 个运行时"降为"装 1 个 Docker"；同一份 Dockerfile 在 Windows Docker Desktop 同样可跑，为后续 Windows 交付预留路径。

本方案覆盖两种形态：
- **形态 A（CLI 一次性容器）**：`docker run --rm md2docx /data/input.md`
- **形态 B（HTTP 服务容器）**：`docker run -p 8080:8080 md2docx-server`（本文件 v2 新增）

## 现状盘点（实测）

| 依赖 | 版本/位置 | 容器化处理 |
|---|---|---|
| Node.js | 本机 v24.15.0（nvm） | 基础镜像自带 |
| npm | 11.12.1 | 基础镜像自带 |
| Chrome/Chromium | 系统 google-chrome + puppeteer 缓存 636M | 镜像内装 chromium |
| Java | openjdk 11（系统） | 镜像内装 openjdk-17-jre-headless |
| graphviz | 2.42.2（系统） | 镜像内 apt 装 |
| python3 | 3.12.3（系统） | 镜像内装 |
| python-docx | 1.2.0（pip） | 镜像内 apt 装 python3-docx 或 pip 装 |
| plantuml.jar | bin/ 内 v1.2025.2（21M） | COPY 进镜像 |

### 对容器化友好的现有代码

- `scripts/puppeteer-config.js` 已带 `--no-sandbox --disable-setuid-sandbox` —— 容器内跑 Chrome 的必备条件，已天然适配。
- `scripts/puppeteer-config.js` 的 Chrome 候选路径含 `/usr/bin/chromium`、`/usr/bin/chromium-browser`、`/usr/bin/google-chrome` —— 镜像内任一存在即可自动探测到。
- `scripts/plantuml-renderer.js` 的 `buildCommand` 会探测 `java-21/17/11`，镜像内装任一即可。
- CLI 路径逻辑：输入 `/data/input.md`（不在 output/clean 下）时，输出到 `/data/output/docx/input.docx`，preprocess 输出 `/data/output/clean/input.clean.md` —— 正好配合 bind mount 挂载卷。

### 隐藏坑：中文字体（必须处理）

容器默认无中文字体。PlantUML 的 `findChineseFont()` 依赖 `fc-list :lang=zh`；mermaid 中文标签也需要。**必须装 `fonts-noto-cjk`**，否则图表中文渲染成方块。

## 形态划分

```
形态 A：docker run --rm -v $PWD/md:/data md2docx /data/input.md
        → 输出 /data/output/docx/xxx.docx（写入挂载卷，宿主机即得文件）

形态 B：docker run -p 8080:8080 -v md2docx-data:/app/data md2docx:server
        → POST /api/convert 上传 md → 轮询进度 → 下载 docx；GET / 上传页面
```

## Dockerfile 草案（双 target，评审 M4）

```dockerfile
# syntax=docker/dockerfile:1
# ---- 阶段 1：系统依赖 + npm 依赖（共享 base，利用缓存分层）----
FROM node:22-bookworm-slim AS deps
WORKDIR /app

# 1. 系统依赖：Chromium、Java、graphviz、python3、中文字体
#    python3-docx 走 Debian 包，避免 pip 额外源
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      openjdk-17-jre-headless \
      graphviz \
      python3 \
      python3-docx \
      fonts-noto-cjk \
      ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# 2. npm 依赖（含服务端 express/multer，package.json/lock 先 COPY 利用层缓存）
COPY package.json package-lock.json ./
RUN PUPPETEER_SKIP_DOWNLOAD=true npm ci --omit=dev

# ---- 阶段 2：运行时公共层（核心代码 + bin）----
FROM deps AS runtime
WORKDIR /app
COPY scripts/ scripts/
COPY bin/ bin/
# 01-base 规范文档、md/ 样例可选择性 COPY

# 3. plantuml.jar 首次可用（renderPlantUML 也会自动下载兜底）
RUN test -f bin/plantuml.jar && echo "jar present"

# 4. 中文字体缓存刷新（fc-list 需要）
RUN fc-cache -f

# 5. 验证依赖齐备
RUN node -e "require('./scripts/puppeteer-config').findChrome() && console.log('chrome ok')" \
 && node scripts/preprocess.js --help >/dev/null 2>&1 || true

# ---- 形态 A target：CLI 一次性容器 ----
FROM runtime AS cli
# 入口：batch 脚本（幂等检查依赖，多文件可传）
ENTRYPOINT ["./scripts/md2docx.sh"]

# ---- 形态 B target：HTTP 服务容器 ----
FROM runtime AS server
WORKDIR /app
COPY server/ server/
COPY package.json package-lock.json ./
# 数据卷：作业工作目录（产物），容器重启数据可持久
VOLUME ["/app/data"]
EXPOSE 8080
ENV PORT=8080 DATA_DIR=/app/data
CMD ["node", "server/app.js"]
```

### 关键决策点

| 决策 | 选择 | 理由 |
|---|---|---|
| 基础镜像 | `node:22-bookworm-slim` | 体积小、自带 node+npm、Debian 系 apt 齐全 |
| `PUPPETEER_SKIP_DOWNLOAD=true` | 是 | 用系统 chromium，避免镜像里再拉 636M puppeteer 浏览器 |
| Chrome 来源 | Debian `chromium` 包 | puppeteer-config 候选含 `/usr/bin/chromium`，自动探测 |
| python-docx | Debian `python3-docx` 包 | 避免 pip 网络依赖，离线友好 |
| 字体 | `fonts-noto-cjk` | PlantUML/mermaid 中文必需 |
| 挂载方式（CLI） | `-v $PWD/md:/data` + 传 `/data/input.md` | 完全复用现有路径逻辑，零代码改动 |
| 作业目录（服务） | `VOLUME /app/data` + `DATA_DIR=/app/data` | 产物与上传文件持久化，镜像升级不丢作业 |
| 构建 target | `cli` / `server` 两个 target | 一套 Dockerfile 覆盖两种形态，base 层共享体积 |

### 构建与运行

```bash
# 形态 A（CLI）
docker build -t md2docx --target cli .
docker run --rm -v "$PWD/md:/data" md2docx /data/test-plantuml.md

# 形态 B（HTTP 服务）
docker build -t md2docx:server --target server .
docker run -d --name md2docx-srv -p 8080:8080 -v md2docx-data:/app/data md2docx:server
# 访问 http://localhost:8080/ （上传页面）
# 健康检查
curl http://localhost:8080/api/health
```

## 体积优化（后续可选）

| 优化 | 收益 | 风险 |
|---|---|---|
| multi-stage 只保留运行时（已含在草案）| 减小构建产物 | 低 |
| jlink 精简 JRE（`--add-modules` 最小集）| 省 100-200M | 中：需测 PlantUML 全图类型 |
| PlantUML 换官方**原生 exe**（免 JRE）| 省 Java 全部 | 中：需验证原生镜像可用性 |
| 精简 chromium 用 headless-shell | 省 100-200M | 低：puppeteer-config 已支持缓存探测 |

目标：朴素版 1.2-1.6GB → 优化版 ~700MB。

## 离线部署（承接此前离线诉求）

```bash
# 在线机器
docker save md2docx | gzip > md2docx-image.tar.gz

# 离线机器
docker load < md2docx-image.tar.gz
docker run --rm -v "$PWD/md:/data" md2docx /data/xxx.md
```

镜像自包含 node_modules + jar + 系统依赖，离线目标机只需装 Docker 本身。

## 风险与开放问题

| 风险 | 说明 | 缓解 |
|---|---|---|
| chromium 沙箱 | 容器内需 `--no-sandbox` | 代码已带，无需改 |
| 中文字体缺失 | 图表中文变方块 | Dockerfile 已装 fonts-noto-cjk + fc-cache |
| `md2docx.sh` 的 tty 交互 | `node_modules` 缺失时 `read < /dev/tty` 在容器/CI 卡死 | 镜像构建已 `npm ci`，运行时必存在；如需增强可加 `CI=1` 跳过交互 |
| mmdc 渲染超时 | 30s 默认 | 复杂大图可能失败降级为代码块（设计预期） |
| 镜像体积 | 朴素版偏大 | 见体积优化表 |
| 文件权限 | 容器内 root 写挂载卷 | `--user $(id -u):$(id -g)` 或接受 root 产出 |

## 实施步骤

1. 写 `Dockerfile`（双 target）+ `.dockerignore`（忽略 node_modules、md/output、data、.git）
2. 本机构建两个 target，修 chromium/java/python-docx 安装细节
3. 形态 A：用 `md/test-plantuml.md` 端到端验证：mermaid + plantuml 渲染、中文字体、docx 生成
4. 形态 B：`docker run` 起服务，curl 走通 上传→轮询→下载；确认 `/api/health` 依赖全 ✓
5. 验证离线路径（save/load）
6. 评审通过后落地为 `docs/deployment/`，方案归档

## 验证方法

1. `docker build --target cli -t md2docx .` 与 `--target server -t md2docx:server .` 构建无报错
2. 形态 A：`docker run --rm -v "$PWD/md:/data" md2docx /data/test-plantuml.md` 三张图全部渲染成功（mermaid 时序/流程/类图 + plantuml 时序/流程/类图）
3. 检查 `md/output/docx/` 中 docx 用 LibreOffice 打开，图表中文正常、无彩色 AI 味
4. 形态 B：`docker run -d -p 8080:8080 -v md2docx-data:/app/data md2docx:server`，`curl /api/health` 全依赖 ✓，浏览器打开 `/` 上传 `md/test-comprehensive.md` 走通全流程
5. `docker save | gzip` 后清空镜像 `docker rmi`，再 `docker load` 验证离线可用
