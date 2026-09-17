# Windows 原生一键安装方案（无 WSL / 无 Docker）

> 状态：草案，待独立评审
> 前置：用户环境可能**无法运行 WSL**，因此不能依赖 Docker/WSL 路线

## 1. 目标

在**纯 Windows**（不装 WSL、不装 Docker、不装 Java/Python/Chrome）的机器上：

- 一键安装（单个 `.exe` 安装包）
- 安装后双击图标 → 自动起本地服务 → 自动打开浏览器到 `http://127.0.0.1:<port>`
- CLI 批量转换能力保留（右键/命令行可用）

## 2. 依赖瘦身结论（已实测 / 已核实）

当前 Linux 侧需要 5 套运行时，Windows 原生路线可砍到 **1~2 套**：

| 依赖 | 现状 | Windows 原生方案 | 依据 |
|---|---|---|---|
| Java（PlantUML） | 必需 | **去掉** | 官方发布含 `native-plantuml-windows-amd64-<ver>.zip`（~48MB，GraalVM 原生镜像，免 JRE）。见 [plantuml releases](https://github.com/plantuml/plantuml/releases) |
| graphviz | 必需 | **去掉** | PlantUML 内置 Smetana 布局引擎；实测用户文档 23 张图 `!pragma layout smetana` **23/23 全通过** |
| Python + python-docx | 必需 | **去掉** | 后处理只做 docx(zip) 内 `document.xml` 注入，`adm-zip`（**已是现有依赖**）纯 JS 可完成；已实测注入 `cantSplit`/`keepNext`/`keepLines` 并产出合法 XML |
| Chromium（mermaid 渲染） | 必需 | **三选一** | ① 用 Windows 自带 **Microsoft Edge**（puppeteer 支持 `channel: 'msedge'`）→ 0 体积；② Electron 自带 Chromium；③ 打包 chrome-headless-shell（~150MB） |
| Node.js | 必需 | **随包** | Electron 自带；或便携 `node.exe` |

**推荐组合**：Electron（Node + Chromium 一体）+ `native-plantuml.exe` + 系统 Edge 作为备选渲染器。

预估安装包：**约 250–350 MB**（Electron 占大头）；若改用便携 Node + 系统 Edge，可压到 **约 100–150 MB**。

## 3. 需要改动的代码点（Windows 适配）

这些是**必须改**的，否则在 Windows 上会直接失败：

1. **`findChineseFont()`**（`scripts/plantuml-renderer.js`）
   现在用 `fc-list :lang=zh`，Windows 没有 fc-list。需加平台分支：Windows 直接返回候选字体名（`Microsoft YaHei` / `SimSun` / `DengXian`），并用 `fs.existsSync('C:\\Windows\\Fonts\\msyh.ttc')` 之类做存在性判断。

2. **所有外部命令调用改为 `spawn`/`execFile` + 参数数组**
   当前是字符串拼接 `execSync(\`"${bin}" -i "${in}" ...\`)`。Windows 下路径常含空格（`C:\Program Files\`）与中文用户名，字符串拼接极易被 shell 拆坏；且 `mmdc` 在 Windows 上是 `mmdc.cmd`（`.bin/mmdc` 不存在）。
   涉及：`preprocess.js`（mmdc 两处）、`md2docx.js`（`npx mmdc`）、`plantuml-renderer.js`（plantuml 命令）。

3. **`patchDocxPagination()` 改纯 JS**（`scripts/md2docx.js`）
   去掉 `python3` 调用，用 `adm-zip` 读写 `word/document.xml`。注意：按 `w:pStyle w:val="Caption"` 匹配段落，按 `<w:tr>`/`<w:trPr>` 注入行属性。

4. **`downloadPlantUML()` 不依赖 `curl`**（`plantuml-renderer.js`）
   改用 Node 内置 `https`/`fetch` 下载，并支持配置镜像/离线路径。

5. **`findChrome()` 支持 Edge 与 Windows 实际路径**（`scripts/puppeteer-config.js`）
   现候选已含 `C:\Program Files\Google\Chrome\...`，需补 `msedge.exe` 的常见路径，并允许 `PUPPETEER_EXECUTABLE_PATH` 环境变量覆盖。

6. **Windows CLI 入口**
   `scripts/md2docx.sh` 是 bash，Windows 不可用。需提供 `md2docx.cmd`/`.ps1` 或纯 Node 入口（推荐后者：`node scripts/cli.js`，跨平台一套逻辑）。

7. **监听地址默认 `127.0.0.1`**
   避免 Windows 防火墙弹窗；如要局域网访问再显式切 `0.0.0.0` + 放行防火墙。

8. **端口占用处理**
   8080 常被占用。启动时探测空闲端口，并把实际端口写入配置/快捷方式，避免用户看到"打不开"。

## 4. 打包形态

### 形态 A：Electron + electron-builder（NSIS 一键安装）
- 主进程启动 Express（`server/app.js` 的 `createApp()`），拿到端口后 `shell.openExternal()` 打开默认浏览器
- 托盘图标：显示状态、打开页面、退出
- electron-builder 产出 `md2docx-Setup-x.y.z.exe`（NSIS，支持一键安装 + 开始菜单/桌面快捷方式）
- Chromium 可直接复用 Electron 的（`puppeteer` 指向 Electron 的 chromium 或用系统 Edge）

### 形态 B：便携 Node + Inno Setup（更轻）
- 打包 `node.exe` + `node_modules` + `native-plantuml.exe` + 启动脚本
- Inno Setup 做安装包，创建快捷方式；用计划任务/启动文件夹实现开机自启
- 体积更小，但托盘/自启/错误提示都要自己写

**建议先做形态 A**：一键安装、托盘、自动开浏览器这些"软件感"由 Electron 直接提供，省掉大量 Windows 平台细节。

## 5. 风险与验证门（必须在 Windows 上实测）

| 风险 | 影响 | 验证方式 / 缓解 |
|---|---|---|
| **原生 PlantUML 的中文字体** | 图表中文变方块（原生镜像的字体子系统与 JVM 不同） | 最高风险项。在 Windows 上渲染含中文的 23 张图逐张目检；不合格则回退"打包精简 JRE + jar"（jlink 约 50MB） |
| 系统 Edge 不可用（企业精简镜像） | mermaid 无法渲染 | 回退到 Electron 自带 Chromium 或打包 chrome-headless-shell |
| Electron 体积 | 安装包 250MB+ | 可接受；如需更小走形态 B |
| `.cmd` 与路径引号 | 渲染命令失败 | 全部改 `execFile`+数组，并在含空格/中文路径下测试 |
| 杀软误报（NSIS + 原生 exe） | 安装被拦 | 代码签名（可选）；先内部放行 |
| 长路径 / 中文路径 | 临时文件写入失败 | 测试 `C:\用户\文档\中文 目录\` 场景 |

## 6. 实施步骤

1. **依赖落地**：下载 `native-plantuml-windows-amd64` 解压为 `bin/plantuml.exe`；`findPlantUML()` 增加 exe 探测分支
2. **去 Python**：实现纯 JS `patchDocxPagination`，与 python-docx 版本**逐项比对产物**（cantSplit/keepNext/keepLines 数量与位置一致）
3. **去 graphviz**：注入 `!pragma layout smetana`（可用环境变量开关），回归 23 张图
4. **跨平台命令层**：抽出 `lib/exec.js`（`execFile` 封装 + 参数数组 + 平台差异集中处理）
5. **字体层**：`findChineseFont()` 平台分支
6. **Windows 入口**：`server/desktop.js`（Electron 主进程：起服务 + 开浏览器 + 托盘）
7. **打包**：electron-builder 配置 + `electron-builder.yml`，产出 NSIS 安装包
8. **Windows 实测**：在真实目标机跑通安装 → 打开页面 → 转换用户真实文档（含 23 图）+ CLI 批量
9. 文档：`docs/deployment/windows.md`（安装、端口、防火墙、卸载、离线）

## 7. 验证清单

- [ ] 安装包在纯净 Windows 10/11 上一键装完，无需管理员之外的操作
- [ ] 双击图标 → 浏览器自动打开 → 页面可用
- [ ] `/api/health` 依赖全 ✓（此时应只剩 node/chrome 两项）
- [ ] 转换用户真实文档：PlantUML 23/23、题注 540 全居中、宽表不崩
- [ ] 图表中文无方块（重点）
- [ ] 路径含空格与中文时正常
- [ ] CLI 批量转换可用
- [ ] 卸载干净（无残留服务/自启项）
- [ ] 离线安装可用（安装包自包含）

## 8. 与 Docker 路线的关系

两条路线**不冲突**，按目标机能力择一：
- 能跑 WSL/Docker 的机器 → Docker（复用 Linux 镜像，见 `docs/plans/docker-deployment.md`）
- 只有纯 Windows → 本方案

代码改动（去 Python/graphviz、跨平台命令层）对两条路线都是净收益（镜像更小、依赖更少）。
