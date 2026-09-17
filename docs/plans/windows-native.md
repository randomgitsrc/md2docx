# Windows 原生一键安装方案（无 WSL / 无 Docker / 完全离线）

> 状态：草案 v2（已按 `docs/review/review-windows-native.md` 评审修订 + 本机实测补充）
> 目标形态：**单个离线安装包**，装完双击图标 → 起本地服务 → 浏览器打开 `http://127.0.0.1:<port>`
> 约束：**不污染系统环境**（自带运行时，等价于 venv 式的局部依赖）；**全程无需联网**

## 1. 目标

在**纯 Windows**（不装 WSL、不装 Docker、不装 Java/Python/Chrome、无网络）的机器上：

- 一键安装（单个安装包，或解压即用）
- 安装后双击图标 → 自动起本地服务 → 自动打开浏览器
- CLI 批量转换能力保留（命令行/拖拽可用）
- 所有依赖随包自带，**不改动系统 PATH、不写注册表式全局依赖、卸载后无残留**

## 2. 依赖方案（本机实测结论）

### 2.1 结论：5 套运行时 → **1 套（Node）**

| 原依赖 | 处理 | 依据（本机实测） |
|---|---|---|
| **Java**（PlantUML） | **去除** | 改用官方 **`@plantuml/core`**（TeaVM 编译版 PlantUML，**MIT**，7.5MB），自带 **Viz.js 3.24 = WASM 版真 Graphviz**，README 明示 "no server, no Java, no Graphviz binary required" |
| **graphviz** | **去除** | 同上——`viz-global.js` 是真 Graphviz（非 Smetana 降级） |
| **Python + python-docx** | **去除** | `docx@9.7.0` **原生输出** `cantSplit`/`keepNext`/`keepLines`；等价性实测 0 处差异（见 `scripts/compare-pagination.js`） |
| **Chromium** | **复用已有** | mermaid 渲染本来就要一个浏览器；`@plantuml/core` 也复用它（同一进程内渲染 SVG） |
| **Node.js** | **随包** | 便携 `node.exe`（约 35MB 压缩包） |

**`@plantuml/core` 的本机实测结果**（用户真实文档 23 张图）：

| 检查项 | 结果 |
|---|---|
| 渲染成功率 | **23/23**（无失败） |
| 总耗时 | **1.7 秒**（对比 `java -jar` 每图起一次 JVM，整篇需数分钟） |
| 中文显示 | 正常（"系统与网络设置"/"选择场景设置" 均在 SVG 中） |
| 是否退化为 Smetana | **否**（真 Graphviz） |
| `!theme plain` | 生效（彩色像素 0.00%） |
| `skinparam defaultFontName` | 生效，`font-family` 直接写入 SVG（可指定 SimSun/微软雅黑，由系统字体渲染） |
| **横置判定是否翻转** | **0 处翻转**（21 张两版均成功的图逐张比对） |

> 横置判定依赖渲染后像素（`宽/内容区 > 3 且 宽高比 > 2.0`），版式差异会影响分节与页码，
> 因此这是选型的关键门禁——实测两版版式有像素级差异（如类图 413×117 vs 333×183），
> **但均未跨越横置阈值**。

### 2.2 为什么不用官方 `native-plantuml-windows-amd64`

评审实测该 zip 解压后是 **`plantuml.exe` 121.8MB + 10 个 DLL**（非单文件），
且依赖未随包提供的 `VCRUNTIME140.dll`，干净 Windows 上会直接启动失败。
体积与部署复杂度都劣于 `@plantuml/core`，故不采用。

## 3. 代码改动点（Windows 适配）

标注：☑ 已完成并回归通过 / ☐ 待办

1. ☑ **外部命令改用参数数组**（`scripts/exec-util.js`）
   新增 `runFile`/`runMmdc`：内部 `execFileSync` + 参数数组，**不经 shell**。
   原实现用模板字符串拼命令且 `-p` 漏引号，路径含空格时 mermaid 静默降级为代码块
   （实测 `md/output/测试 目录 带空格/样例 文档.md` 修复前 0/1、修复后 1/1）。
   同时改用 `node <mermaid-cli>/src/cli.js`（Windows 下 `.bin/mmdc` 是 `.cmd` shim）。
2. ☑ **中文字体探测平台分支**（`plantuml-renderer.js`）
   Windows 无 `fc-list`，改为读 `%WINDIR%\Fonts` 判断 `msyh/simsun/Deng/SimHei` 等。
3. ☑ **Chrome 探测覆盖 Edge 与用户级安装**（`puppeteer-config.js`）
   补 `msedge.exe` 常见路径、用户级 `AppData\Local` 安装、Windows 版 puppeteer
   缓存布局（`chrome-headless-shell-win64/*.exe`），并支持 `PUPPETEER_EXECUTABLE_PATH`。
   注意：puppeteer 24 的 `channel` **没有 `'msedge'`**（只有 chrome 系列），Edge 必须走
   `executablePath`——本项已按此实现。
4. ☑ **去除 python-docx 依赖**（`md2docx.js`）
   `TableRow` 加 `cantSplit`，Caption 段落与表头行首段加 `keepNext`/`keepLines`，
   由 docx 库原生输出；`patchDocxPagination()` 降级为回退开关
   `ENABLE_PAGINATION_PATCH=1`，默认不执行。
5. ☑ **不依赖系统 curl**：`downloadPlantUML()` 改用 Node `https`（`exec-util.downloadFileSync`）。
6. ☑ **渲染产物「先删旧文件 + 以产物判成功」**（`plantuml-renderer.js`）
   修 P0 静默错图：PlantUML 遇「块内无 `@startuml`」时 exit 0 且不写文件，
   仅凭 `existsSync` 判成功会复用上一份文档的 PNG。
7. ☑ **剥离 BOM**（`preprocess.js` / `md2docx.js`）
   修 P0：Windows 记事本 UTF-8 会写 BOM，使 YAML 去重前置判断 `^---` 失配，
   重复 `title` 直接报 `duplicated mapping key`。
8. ☑ **监听地址默认 `127.0.0.1`**（`server/config.js`）
   单机无需对外暴露，且避免 Windows 防火墙弹窗；局域网访问显式设 `HOST=0.0.0.0`。
9. ☑ **数据目录不随 CWD 漂移**（`server/config.js`）
   默认改为安装目录下 `data/`——快捷方式/计划任务启动时 CWD 可能是 `System32`。
10. ☑ **端口自动探测**（`server/app.js`）
   8080 被占则向后找空闲端口，并把实际 URL 写入 `data/server-url.txt`；
    可选 `MD2DOCX_OPEN_BROWSER=1` 自动开浏览器。
11. ☐ **接入 `@plantuml/core` 作为 PlantUML 渲染后端**（本次选型核心）
    在已有 puppeteer/Chromium 中加载 `plantuml.js` + `viz-global.js` 渲染 SVG，
    再截图为 PNG。需保留 jar 后端作为回退（`PLANTUML_BACKEND=core|jar`）。
12. ☐ **Windows CLI 入口**：`md2docx.sh` 是 bash，需提供 `md2docx.cmd`/`.ps1`
    或纯 Node 入口（推荐后者，跨平台一套逻辑）。
13. ☐ **纯 JS 分页后处理**（仅当仍需回退层时）：`python-docx` 那段逻辑可用纯 JS
    操作 zip 内 XML 复刻，但**不再需要**——原生属性已等价（见第 4 项）。

## 4. 打包形态（**推荐形态 B**）

### 形态 A：Electron + electron-builder（NSIS）—— **不推荐**
评审指出其选型理由不成立：mermaid-cli 默认 `headless:'shell'`，会向 puppeteer 传
`--headless`；而我们只能通过 `executablePath` 指向 Electron 本体，**这不是受支持的用法**。
要真正复用 Electron 的 Chromium，须弃用 mmdc、改为隐藏窗口直渲（等于重写渲染层）。
另：`exec-util.js` 依赖 `ELECTRON_RUN_AS_NODE`，若 electron-builder 关闭 `runAsNode` fuse，
**所有子进程会失效**。

### 形态 B：便携 Node + 系统浏览器（**推荐**）
- 包内容：便携 `node.exe`（~35MB 解压后约 80MB）+ `node_modules`（裁剪后 ~290MB）
  + Chromium（见下）+ 启动脚本
- **Chromium 三选一**（按体积/可靠性权衡）：
  1. **系统自带 Edge**（Windows 10/11 必装）→ 0 体积，用 `executablePath` 指定；
     企业精简镜像可能缺 → 需回退
  2. **打包 `chrome-headless-shell`**（~150MB）→ 最可靠、完全自包含
  3. 复用 Electron → 见形态 A 的问题，不推荐
- 启动脚本（`.cmd`/`.ps1`）：设好 `PATH`/环境变量后 `node server/app.js`，
  读取 `data/server-url.txt` 打开浏览器；**不改系统 PATH、不写全局注册表**
- 安装包：可用 **Inno Setup**（Windows 侧）或**免安装 zip**（解压即用，最契合"不污染环境"）

> **离线自包含决策**：既然要求"中间不需要联网即可使用"，建议**打包 chrome-headless-shell**
> 而非依赖系统 Edge——这样目标机不需要任何预装组件，代价是安装包大 ~150MB。

### 体积估算（实测/核实）
| 组成 | 体积 |
|---|---|
| 便携 Node（win-x64） | 35MB 压缩包 / ~80MB 解压 |
| `node_modules`（win32 定向安装 + 裁剪冗余） | 475MB → **290MB**（删 source map/d.ts/docs 后实测渲染正常） |
| `@plantuml/core` | 7.5MB |
| chrome-headless-shell（若自带） | ~150MB |
| **合计（自带 Chromium）** | **约 480MB**；用系统 Edge 则约 **330MB** |
| （替代方案）精简 JRE 49MB + plantuml.jar 21MB，若走 jar 后端 | 需 +70MB，且需 Java 生态，故不采用 |
## 5. 风险与验证门

| 风险 | 状态 | 说明与缓解 |
|---|---|---|
| 陈旧产物复用导致**静默错图** | ☑ 已修 + 回归 | 见 §3.6；回归脚本 `scripts/verify-stale-png.sh` |
| BOM 导致 YAML 去重失效 | ☑ 已修 + 回归 | 见 §3.7；用例 `md/qa/bom-duplicate-key.md` |
| 路径含空格/中文使渲染失败 | ☑ 已修 + 回归 | 见 §3.1；回归覆盖两种路径 |
| `@plantuml/core` 版式差异翻转横置判定 | ☑ 已实测 0 处翻转 | 改版式/升级该包后**必须重跑** 23 图比对（方法见下） |
| `@plantuml/core` 的 `skinparam defaultFontName` | ☑ 已实测生效 | 字体名写入 SVG，由系统字体渲染；Windows 用微软雅黑/宋体 |
| **Windows 上中文是否变方块** | ☐ 需真机确认 | 本机 Linux 已验证 `@plantuml/core` 中文正常；Windows 字体名不同，需真机逐张目检 |
| 目标机缺 `VCRUNTIME140.dll` 等运行库 | ☐ 需真机确认 | 用 `@plantuml/core` 路线已规避（不再有原生 exe）；便携 node.exe 自带依赖 |
| 系统 Edge 缺失（企业精简镜像） | ☐ 决策 | 建议**自带 chrome-headless-shell** 换取完全自包含 |
| 杀软误报 | ☐ | 免安装 zip 可降低；必要时代码签名 |
| 长路径 / 中文路径 | ☑ 部分覆盖 | 已测 `测试 目录 带空格/中文.md`；仍需测超长路径（>260） |
| 中文上传文件名 mojibake | ☐ 待修 | 评审实测 `测试文档.md` → `æµè‹ææ¡£.md`（multipart 文件名编码） |
| `tmpDir` 从不清理 | ☐ 待修 | 长期运行会积累临时文件 |

**横置判定回归方法**（改 PlantUML 后端或升级版本后必做）：
逐张渲染用户文档 23 图，比较 `@plantuml/core` 与 jar 版的像素尺寸，
判定 `宽/内容区 > 3 且 宽高比 > 2.0` 是否翻转——翻转会改变分节与页码。

## 6. 实施步骤

1. ☑ 跨平台命令层（`scripts/exec-util.js`）+ 各调用点接入
2. ☑ 字体平台分支、Chrome/Edge 探测、去 curl 依赖
3. ☑ 去 python-docx（改原生属性，等价性已验证）
4. ☑ P0 修复：陈旧产物、BOM；host/dataDir/端口默认值
5. ☑ **接入 `@plantuml/core`**：core 后端已实现 + `PLANTUML_BACKEND=core|jar|auto` 开关，
   经 `plantuml-core-helper.js`（子进程 + 无头 Chromium）渲染 SVG → 截图 PNG；jar 保留为回退。
   实测用户文档 23/23 成功、总耗时 29s（jar 版 3-5 分钟）
6. ☑ `node_modules` 裁剪 + win32 定向安装（`npm ci --os=win32 --cpu=x64`）
7. ☑ Windows CLI 入口 `scripts/cli.js`（纯 Node，跨平台一套逻辑）
8. ☑ 离线包组装 `scripts/build-windows-bundle.js` → 534.8MB 目录 / 213.3MB zip，
   含启动脚本与使用说明
9. ☐ **Windows 真机实测**（见 §7）——唯一剩余的关键步骤
10. ☑ 文档：`docs/deployment/windows-offline.md`（构建、分发、使用、卸载、验证清单）

## 7. 验证清单（Windows 真机）

- [ ] 目标机**断网**状态下，解压/安装后即可使用（无任何联网请求）
- [ ] 双击启动 → 浏览器自动打开 → 页面可用
- [ ] `/api/health` 必需项全 ✓（node / chrome / plantuml）
- [ ] 转换用户真实文档：PlantUML **23/23**、题注 **540 全居中**、宽表不崩
- [ ] **图表中文无方块**（Windows 字体名与 Linux 不同，重点目检）
- [ ] 路径含空格与中文（`C:\用户\我的 文档\`）正常
- [ ] CLI 批量转换可用
- [ ] 端口被占时自动换端口且浏览器仍能打开
- [ ] 不污染系统：不改 PATH、无需预装 Node/Java/Python/graphviz
- [ ] 卸载/删除目录后无残留（无服务、无自启项、无注册表残留）

## 8. 与 Docker 路线的关系

两条路线**不冲突**，按目标机能力择一：
- 能跑 WSL/Docker 的机器 → Docker（复用 Linux 镜像，见 `docs/plans/docker-deployment.md`）
- 只有纯 Windows / 完全离线 → 本方案

**哪些改动对两条路线都是净收益**（评审 §8 的收窄结论）：
跨平台命令层、去 python-docx、host/port/dataDir 默认值、陈旧产物与 BOM 修复。
**去 graphviz 对 Docker 反而是净损失**（apt 装 graphviz 近乎零成本、保真度更好）——
但若改用 `@plantuml/core`，则 Java/graphviz/体积三者同时成为净收益，
Docker 镜像也能顺带变小（少装 openjdk + graphviz）。
