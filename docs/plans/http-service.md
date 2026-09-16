# HTTP 服务方案 — md2docx Web API + 上传页面

> 状态：v2（已按 `docs/review/review-http-service.md` 评审修订；评审结论"修改后通过"）
> 修订要点：落实 4 个 P0（渲染异步化、缓存目录隔离、路径穿越防护、孤儿清理/优雅关闭）+ 9 个 P1 + 必要 P2。

## 背景与目标

md2docx 目前是纯 CLI（两阶段流水线：`preprocess.js` → `md2docx.js`）。目标是在**不改动现有转换能力**的前提下，新增一个 HTTP 服务层：

1. **REST API**：上传 `.md` → 异步转换 → 查询进度 → 下载 `.docx`/`.clean.md`
2. **Web 上传页面**：浏览器里拖拽/选择文件、实时进度、一键下载
3. **架构要求**：分层清晰、关注点分离、可测试、文档齐全
4. 服务验收后，与既有 `docs/plans/docker-deployment.md` 合并，整体 Docker 化

**核心原则：服务端必须复用现有 scripts 核心，不另起炉灶。** 转换行为与 CLI 完全一致，避免"双路差异"。

## 现状约束（实测）

| 项 | 值 | 影响 |
|---|---|---|
| Node | v24.15.0（本机）/ Docker 用 node:22 LTS | 服务端代码需避开 24-only API（见 M4/L4） |
| express/multer 等 | **未装** | 需新增依赖（体积极小，不影响既有 465M 大头） |
| 转换耗时 | mermaid 渲染数秒~数十秒/图 | **必须异步作业模型**，不能同步阻塞 HTTP |
| 图表渲染 | mmdc(Chrome) + plantuml(Java) + python3 后处理 | 全部经 `execSync` 调用（**阻塞事件循环，必须改造**） |
| 现有脚本 | `main()` 直接跑，路径硬编码 | 需重构为可编程 API + 保留 CLI 入口 |

## 总体架构

```
┌─────────────────────────────────────────────────┐
│  Client                                          │
│   Web 页面 (public/)      API 调用方 (curl/脚本)   │
└──────────────────────┬──────────────────────────┘
                       │ HTTP (express)
┌──────────────────────▼──────────────────────────┐
│  server/app.js — Express 装配                     │
│   ├─ routes/      (convert / jobs / health)      │
│   ├─ services/    (conversion / dependency-check) │
│   ├─ jobs/        (queue / store / model)         │
│   └─ lib/         (pipeline / logger / config)    │
└──────────────────────┬──────────────────────────┘
                       │ 复用
┌──────────────────────▼──────────────────────────┐
│  scripts/ 核心（重构为可编程 + CLI 双入口）          │
│   preprocess.js  ──► preprocess(inputPath, opts)  │
│   md2docx.js     ──► convert(cleanPath, opts)     │
│   plantuml-renderer.js / puppeteer-config.js      │
└─────────────────────────────────────────────────┘
```

### 分层职责（关注点分离）

| 层 | 文件 | 职责 |
|---|---|---|
| 路由层 | `routes/*.js` | HTTP 解析/校验/响应，不碰业务逻辑 |
| 服务层 | `services/*.js` | 编排转换、依赖探测、请求防护 |
| 作业层 | `jobs/*.js` | 队列、状态存储、作业生命周期 |
| 基础设施 | `lib/*.js` | 管线封装、日志、配置 |
| 核心 | `scripts/*.js` | 纯转换逻辑（与 CLI 共享） |
| 前端 | `public/*` | 静态页面，纯原生 HTML/JS/CSS（**不引入前端构建链**） |

## 核心设计决策

### 决策 1：重构 scripts 为可编程 API（保留 CLI）

`preprocess.js` / `md2docx.js` 当前 `main()` 直接执行。重构为：

```javascript
// preprocess.js
function preprocess(inputPath, opts = {}) {
  // opts: { outputDir, cleanDir, mermaidCacheDir, plantumlCacheDir, onProgress, onLog, overrides }
  // 返回 { outputPath, cleanPath, stats, warnings }
}
if (require.main === module) main();   // CLI 入口保留，默认路径逻辑不变

// md2docx.js
async function convert(cleanPath, opts = {}) {
  // opts: { outputDir, srcDir, onProgress, onLog, overrides }
  // 返回 { outputPath, stats, warnings }
}
if (require.main === module) main();
```

- **进度/日志回调**：管线各阶段调用 `opts.onProgress(percent, message)`、`opts.onLog(line)`。CLI 不传则降级为原终端输出（含 `\r\x1b[K` 进度条）。**逐图粒度**回调必须保留（见 M6）。
- **目录参数化**（评审 H2，P0）：`opts` 必须含 `outputDir / cleanDir / mermaidCacheDir / plantumlCacheDir`，由服务端按 `jobId` 生成绝对路径传入；CLI 入口保留原默认（`inputDir/output/...`），保证 CLI 行为不变。
- **双路一致性**：服务端管线**固定为 preprocess（全量渲染）→ convert（仅处理图片引用）**。`md2docx.js` 的 fence 自渲染在服务端是死路径，不在服务端使用。
- **回归保障**：重构后先跑 `md2docx.sh` 端到端回归（golden 文件比对，见 L6），确认 CLI 行为不变。

### 决策 2：异步作业模型（必须）

一次转换含多次图表渲染，耗时 5s~60s+。采用 **提交 → 轮询** 模型：

```
POST /api/convert  ──► 立即返回 202 { jobId }        （只存文件、建作业）
GET  /api/jobs/:id ──► { status, progress, logs }     （轮询进度）
GET  /api/jobs/:id/download ──► 下载产物（须 status=done，否则 409）
```

**作业状态机**：`queued → running → done | failed`

### 决策 3：并发受限队列 + 渲染异步化（评审 H1，P0）

**不阻塞事件循环是硬约束。** 现有底层 `execSync`（`preprocess.js` L256/300、`md2docx.js` L227/778/1195）会在单次渲染 5~30s 内冻结整个 Node 事件循环，导致进度条卡死、健康检查无响应——`maxConcurrent` 也救不了。

- **实现方案（推荐 worker_threads）**：整个 preprocess+convert 流程放进一个 `Worker` 线程，主线程只做 HTTP 与作业状态管理。Worker 内部继续用 `execSync`（同步语义简单、改动最小），主线程天然不被阻塞。
- 备用方案：`lib/pipeline.js` 层把所有 `execSync` 改 `child_process.exec`/`execFile` 异步化——改动面大（涉及 preprocess.js/md2docx.js/plantuml-renderer.js 多处），且需处理回调/进度串联。
- **取 worker_threads 作为主方案**：每个作业一个 worker，天然隔离 `execSync`，且并发上限天然对应 worker 数（maxConcurrent=2 → 至多 2 个 worker 常驻）。
- `maxConcurrent` 默认 2（可配置），超出排队。

### 决策 4：作业隔离 + 启动清扫 + 优雅关闭（评审 H2/H4，P0）

- **每作业独立工作目录**：`data/jobs/<id>/`（上传文件/中间产物/最终 docx/图表缓存全部在作业目录内）。`preprocess` 的 `.mermaid/`、`.plantuml/` 缓存目录通过 `opts` 参数化指到作业目录，**杜绝同名文件并发覆盖**（评审 H2）。
- **图片引用路径白名单**（评审 H3，P0）：`lib/pipeline.js` 在转换前扫描 clean.md 里所有 `![](xxx)`，只允许引用**作业目录内的相对路径**，禁止 `..`、禁止绝对路径；越界的剔除并记 warning（降级为 `[图片缺失]`）。防止上传 md 通过 `![](../../../../etc/passwd)` 穿越读取宿主文件。
- **启动清扫**（评审 H4）：服务启动时扫描 `data/jobs/`，清理所有残留目录（v1 内存存储无恢复语义，全清）。
- **优雅关闭**（评审 H4）：注册 `SIGTERM`/`SIGINT` handler——停止入队新作业、等待 `running` 完成（带 30s 超时）后退出，适配容器 `docker stop`。
- 作业 TTL（默认 1h）+ 定期清理；`DELETE /api/jobs/:id` 手动清理。
- 作业状态存内存（`jobs/store.js`）；v1 不做磁盘持久化（重启即清空），预留持久化接口。
- **store 与目录一致性**（评审 M9）：清理任务同时校验目录存在性；`GET /api/jobs/:id` 时若 store 有记录但目录缺失，标记 `failed` 并附 `error: 'artifact lost'`；删除幂等。

### 决策 5：错误模型

统一错误中间件，结构化响应：

```json
{ "error": { "code": "CONVERSION_FAILED", "message": "...", "details": "..." } }
```

- 转换失败 ≠ 作业失败：图表渲染失败会**降级为代码块**（现有设计），文档仍产出——此时 `status: done` 但附带 `warnings`。
- **日志脱敏**（评审 L8）：返回前端的 `logs` 去掉 `data/jobs/<id>/` 前缀，只保留相对路径，防绝对路径泄露辅助穿越。

### 决策 6：请求防护（评审 M3）

- **上传校验**：扩展名必须 `.md`；文件大小上限 20MB；YAML front matter 上限 64KB（评审 L7）。
- **图表数量上限**：预处理前正则统计 `^```mermaid\s*$` / `^```plantuml\s*$` 块数，超阈值（默认 30）直接 `400 { error: { code: 'TOO_MANY_DIAGRAMS' } }`——防"10KB md 塞 200 个 mermaid 块"打满队列。
- **IP 速率限制**：每 IP 每分钟 N 次提交（`express-rate-limit`，或自写令牌桶）。
- **队列长度上限**：排队作业超过阈值返回 `429 Too Many Requests`。

### 决策 7：健康检查缓存（评审 M5）

- 启动时探测一次依赖（node/chrome/java/graphviz/python/pythonDocx）并缓存，TTL 60s；`/api/health` 返回缓存值，不阻塞事件循环。
- 前端健康徽标只拉一次或低频刷新（30s），不与作业轮询耦合。
- 注意：`checkGraphviz()` 用 `execSync('dot -V')`（阻塞），只在启动探测时跑一次，不进请求路径。

### 决策 8：mmdc 直接调二进制（评审 M7）

- 把 `npx mmdc` 改为 `node_modules/.bin/mmdc`（或 `require.resolve('@mermaid-js/mermaid-cli')` 直接定位 cli），消除 `npx` 每次的包解析开销；容器内 PATH 差异也随之消失。CLI 与 worker 共用此改动。
- **统一 mermaid 重试分辨率**（评审 L1）：`preprocess.js` 与 `md2docx.js` 的 mmdc 重试路径使用同一分辨率常量（竖置 2400 / 横置 3600），抽为共享常量，避免两处不一致。

## API 设计

| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| GET | `/api/health` | — | `{ status, deps: { node, chrome, java, graphviz, python, pythonDocx } }`（缓存 60s） |
| POST | `/api/convert` | multipart：`file`(.md)、可选 `title/company/date` | `202 { jobId }` |
| GET | `/api/jobs` | `?limit&offset` | `{ jobs: [{id, status, createdAt, progress}] }` |
| GET | `/api/jobs/:id` | — | `{ id, status, progress, logs[], warnings[], artifact?, error? }` |
| GET | `/api/jobs/:id/download` | — | docx；`status!=done` → `409 { error: { code: 'JOB_NOT_DONE' } }`；响应头含 `Content-Disposition: attachment; filename="<原名>.docx"` |
| GET | `/api/jobs/:id/clean` | — | `text/markdown; charset=utf-8`（预处理中间产物）；同上状态约束 |
| DELETE | `/api/jobs/:id` | — | `204`（幂等） |

**校验**（决策 6）：扩展名 `.md`、大小 ≤20MB、图表数 ≤30、IP 速率限制、队列长度上限；违规分别返回 `400`/`429`。

**`title/company/date` 覆盖语义**（评审 M8）：**表单参数优先于 YAML**（真覆盖），匹配 Web 表单场景（用户上传后改标题）。`lib/pipeline.js` 在生成 clean.md 前改写 YAML front matter。`docs/api.md` 给出"有 YAML + 传参"与"无 YAML + 传参"两个示例。

## Web 页面（public/）

纯静态三件套（`index.html` + `app.js` + `style.css`），无构建步骤：

- 拖拽/选择 `.md` 文件 → `POST /api/convert`
- 轮询 `GET /api/jobs/:id`，**带退避**（评审 L2）：progress 变化时 1s，停滞时延长到 2~3s
- 进度条 + 分步日志（YAML→标题→图表→转换→DOCX），进度口径：preprocess 占 60%（内部按图数加权）、convert 占 40%
- 完成 → 下载按钮（`/api/jobs/:id/download`）；失败 → 错误详情 + 警告列表
- 顶部依赖健康徽标（低频刷新，30s）

## 依赖变更

```json
"dependencies": {
  "express": "^4.22.2",     // Web 框架（行业标准，~1MB）
  "multer": "^1.4.4",       // multipart 上传（~0.5MB）
  "express-rate-limit": "^7" // IP 速率限制（可选，也可自写令牌桶）
}
```

体积影响可忽略（合计 ~6MB，对比现有 465M）。**不引入**前端框架/构建工具。

## 目录结构（新增）

```
server/
  app.js                  — Express 装配（中间件、路由、错误处理、优雅关闭）
  config.js               — 端口/并发/上限/TTL/速率限制等配置
  routes/
    health.js
    convert.js
    jobs.js
  services/
    conversion-service.js — 作业编排：接收上传→校验→建作业→入队→产出归档
    dependency-check.js   — 启动时依赖探测 + 缓存（TTL）
  jobs/
    job-queue.js          — 并发受限队列（worker 池）
    job-worker.js         — worker_threads：跑 preprocess+convert
    job-store.js          — 内存作业存储 + TTL/孤儿清理
    job.js                — 作业模型（状态/进度/日志/产物）
  lib/
    pipeline.js           — 封装 scripts 调用、图片路径白名单、日志脱敏
    logger.js             — 日志
  public/
    index.html
    app.js
    style.css
data/jobs/                — 作业工作目录（gitignore）
scripts/                  — 重构核心（保留 CLI）
docs/http-service.md      — 架构说明（交付文档）
docs/api.md               — API 参考（交付文档）
```

## 实施步骤

1. **重构核心**：`preprocess.js` / `md2docx.js` 拆出可编程 API（目录参数化 + 进度/日志回调 + 返回结构），移除死代码 `askUser`（L5），mmdc 改直调二进制（M7）；跑 CLI 端到端回归（golden 比对）
2. **骨架**：`config.js` / `logger.js` / `app.js`（健康检查先通，依赖探测 + 缓存）
3. **作业层**：`job.js` / `job-store.js` / `job-queue.js` / `job-worker.js`（worker_threads 封装 + 并发上限 + TTL/孤儿清扫 + 优雅关闭）
4. **管线接入**：`lib/pipeline.js`（调核心函数、图片路径白名单、日志脱敏、title 覆盖）
5. **路由**：convert / jobs / download / clean / health + 校验（扩展名/大小/图表数/速率/队列）+ 错误中间件
6. **前端**：`public/` 页面（退避轮询、进度、下载、依赖徽标）
7. **测试**：单元（store/queue/pipeline）+ 集成（curl 上传→轮询→下载→校验 docx）+ 并发（5 作业、2 同名文件并发）
8. **文档**：`docs/http-service.md`（架构）+ `docs/api.md`（API）+ 更新 `AGENTS.md`
9. 服务验收后：与 `docs/plans/docker-deployment.md` 合并 Docker 规划（见下）

## Docker 合并形态（评审 M4）

- **多 target Dockerfile**：`build-arg TARGET=cli|server`，共享 base stage（系统依赖 + `npm ci` 含 express/multer）。
  - `server` target 额外：`COPY server/ public/`、`EXPOSE 8080`、`CMD ["node","server/app.js"]`、`VOLUME /app/data/jobs`
  - `cli` target：沿用现有 `ENTRYPOINT ["./scripts/md2docx.sh"]`
- **Node 版本对齐**：开发与容器统一 `node:22` LTS（或都升 24），服务端代码避免 24-only API。
- Dockerfile 的 `npm ci` 依赖层需包含新增的 express/multer/express-rate-limit。

## 测试与验证

- **单元**：job-store 状态流转、job-queue 并发上限、pipeline 图片白名单/进度回调/脱敏
- **集成**：用 `md/test-plantuml.md`、`md/test-comprehensive.md` curl 全流程，验证产物 docx 可被 python-docx 打开、段落数/图片数正确
- **并发**：同时提交 5 个作业，验证 maxConcurrent=2 排队、全部完成、无串扰；**两个同名文件（都叫 index.md）并发提交，验证图表缓存隔离（H2）**
- **错误路径**：上传非 .md / 超大 / 超图表数 / 恶意路径 `![](../../etc/passwd)` → 4xx 或降级；核心渲染失败 → done+warning
- **安全**：图片引用穿越用例（H3）；日志不含绝对路径（L8）
- **前端**：浏览器（playwright）走通"上传→进度→下载"
- **回归（golden）**（评审 L6）：重构前存 golden docx，回归时解压比对 `word/document.xml`（忽略时间戳）或比对段落数/样式/图片数
- **依赖**：确认 gray-matter/js-yaml 默认禁用 unsafe loads（L7）

## 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 重构破坏 CLI | 现有流程不可用 | 重构先行 + golden 回归 |
| 渲染阻塞事件循环 | 服务不可用（进度卡死、健康无响应） | **worker_threads 隔离（P0）** |
| 同名文件并发覆盖缓存 | 产出错乱文档 | 目录参数化按 jobId 隔离（P0） |
| 图片引用路径穿越 | 读取宿主任意文件 | 路径白名单（P0） |
| 崩溃留孤儿目录 | 磁盘泄漏 | 启动清扫 + 优雅关闭（P0） |
| 恶意上传打满队列 | DoS | 图表数上限 + 速率限制 + 队列上限 |
| 内存存储重启丢作业 | 转换中断 | v1 接受，预留持久化接口 |

## 交付文档清单

1. `docs/plans/http-service.md` — 本方案
2. `docs/review/review-http-service.md` — 评审记录
3. `docs/http-service.md` — 架构说明（分层、作业模型、部署运行）
4. `docs/api.md` — API 参考（端点、请求/响应示例、错误码、覆盖语义示例、CORS 说明）
5. `AGENTS.md` — 补充服务相关的命令与约定
6. `README.md` — 服务启动/使用说明（若存在则更新）
7. `docs/plans/docker-deployment.md` — 更新为 cli+server 双 target

## 不做的事项（v1 范围外）

- 用户认证/权限（内网工具，v1 不做）
- 作业磁盘持久化（重启恢复）
- HTTPS 终结（交由反向代理）
- 前端构建工具链（保持零构建）
- SSE 实时推送（v1 用轮询，退避即可）
