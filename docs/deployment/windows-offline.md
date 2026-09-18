# Windows 离线部署（免安装包）

本文档说明如何构建、分发与使用 **Windows 完全离线包**。目标机无需联网、无需预装任何运行时（Node / Java / Python / graphviz / Chrome 全部随包自带），且**不污染系统环境**。

配套：方案与选型依据见 [`docs/plans/windows-native.md`](../plans/windows-native.md)。

## 1. 适用场景

- 目标机是纯 Windows，且**不能或不便使用 WSL / Docker**
- 目标机**不能联网**（内网、涉密网、隔离环境）
- 要求"不污染本机环境"：不改 PATH、不装全局组件、删除即卸载

## 2. 交给用户的东西

构建产物（`dist/` 下）：

| 文件 | 说明 |
|---|---|
| `md2docx-Setup-<ver>-win-x64.exe` | **一键安装器**（实测约 133MB；体积最小、体验最好） |
| `md2docx-win-x64.zip` | 免安装压缩包（实测约 213MB） |
| `md2docx-win-x64/` | 未压缩目录（可直接拷目录） |

### 2.1 一键安装器（推荐）

双击 `md2docx-Setup-<ver>-win-x64.exe` 安装。特点是：

- **按用户安装**到 `%LOCALAPPDATA%\Programs\md2docx`，`RequestExecutionLevel user`
  → **无需管理员、不弹 UAC**
- 自动创建开始菜单与桌面快捷方式（指向"启动 md2docx.cmd"）
- 卸载走"设置 → 应用"或开始菜单里的卸载项，会清理快捷方式、注册表项与整个安装目录

安装器由构建脚本用 **NSIS 交叉编译**生成（在 Linux 上即可，无需 Windows 机器）。

### 2.2 免安装包

解压 `md2docx-win-x64.zip`，双击其中的 `启动 md2docx.cmd` 即可（见第 3 节）。

包内结构：

```text
md2docx-win-x64/
├─ 启动 md2docx.cmd        # 双击 → 起服务 + 自动开浏览器
├─ 转换文档.cmd            # 拖 .md 上去 → 批量转 DOCX
├─ 使用说明.txt
├─ node.exe                # 便携 Node（自带）
├─ node_modules/           # 依赖（win32 定向安装 + 裁剪）
├─ chrome-headless-shell/  # 渲染 mermaid / PlantUML 用的浏览器（自带）
├─ scripts/                # 转换核心
└─ server/                 # HTTP 服务（REST API + Web 页面）
```

## 3. 目标机使用（三步）

1. 把 zip 拷到目标机，**解压到任意目录**（路径可含中文与空格）
2. 双击 `启动 md2docx.cmd`
3. 浏览器自动打开 `http://127.0.0.1:<端口>`；若被拦截，按窗口里打印的地址手动访问

关闭服务：关掉那个命令行窗口即可。

批量转换（可选）：

```bat
转换文档.cmd "D:\文档\需求规格说明.md"
```

或直接把 `.md` 文件拖到 `转换文档.cmd` 上。产物在该 md 同级的 `output/docx/` 下。

## 4. 在本机构建包（需联网，仅一次）

```bash
npm ci                      # 首次：装构建脚本自身需要的依赖（adm-zip 等）
npm run build:win           # → dist/md2docx-win-x64/ + dist/md2docx-win-x64.zip
npm run release:win         # 同上，额外产出 Windows 一键安装器 EXE
```

等价于 `node scripts/build-windows-bundle.js`（`release:win` 即追加 `--installer`）。

**构建机要求**：`node` + `npm` + 联网。Linux / Windows / macOS 均可；
**目标机不需要任何东西**。

> Windows 构建机注意：脚本内部调用 npm 时用 `process.execPath` 直接执行 npm 的
> `npm-cli.js`。不要改回 `execFileSync('npm', …)`——Windows 上 `'npm'` 会去找
> 不存在的 `npm.exe`（ENOENT），而 `'npm.cmd'` 又被 Node 的 CVE-2024-27980 补丁
> 拒绝（EINVAL）。

可选参数：

| 参数 | 作用 |
|---|---|
| `--installer` | 额外生成 Windows 一键安装器 EXE（NSIS） |
| `--out <dir>` | 指定输出目录（默认 `dist/`） |
| `--skip-chromium` | 不打包浏览器（目标机需自带 Chrome/Edge，可省约 230MB） |
| `--keep-temp` | 保留临时目录便于排查 |
| `--allow-dirty` | 允许在脏工作区构建（不可追溯，不推荐用于分发） |

生成安装器时，若 `PATH` 中没有 `makensis`：**Linux** 上脚本会自动下载并本地解包
Ubuntu 归档的 `nsis` + `nsis-common` 两个 deb（不改系统、不需 root）；**Windows** 上
需先自行安装（`winget install NSIS.NSIS`），否则脚本会明确提示并跳过安装器
（zip 免安装包不受影响）。

### 4.1 构建闸门（失败即中止，不会产出坏包）

构建脚本内置三道强制检查。它们的存在有具体教训：曾把 `dist/` 里的**旧包**
当成最新的发给别人——那个包缺少后续 6 个提交里的 5 个缺陷修复
（活动图 31% 渲染失败、99% 表格失效等），外观却与正确包无异。

| 闸门 | 时机 | 作用 |
|---|---|---|
| `assertCleanTree` | 构建前 | 工作区有未提交改动时拒绝构建（提示先提交，或显式 `--allow-dirty`）。分发包必须能对应到确定版本 |
| `assertBundleContents` | 打包前 | 必需文件齐全（`node.exe` / 启动脚本 / `@plantuml/core` / mermaid-cli / 内置浏览器），防"少拷一层目录"导致图表静默降级 |
| `verifyBundleCode` | 打包前 | 逐字节比对包内 `scripts/`、`server/` 与当前源码，防"拷贝遗漏/旧文件残留" |
| `smokeTestBundle` | 打包前 | 用**包内**代码与依赖真跑一次转换——"能构建 ≠ 能运行"的唯一实证 |
| `verifyZipEntryEncoding` | 打包后 | zip 内中文名必须带 UTF-8 flag，否则在非中文 Windows 上解压出乱码文件名（见 §4.2） |
| `assertBundleBudget` | 打包后 | 体积/文件数预算（默认 ≤1000MB / ≤40000 文件），防依赖树被间接拖大 |

`smokeTestBundle` 的自检用例刻意覆盖近期修过的缺陷路径（作者本地图片、
裸写活动名的活动图、无分隔行的键值表），断言图片数 ≥3、表格数 ≥1、
无"图片缺失"占位。本机无浏览器时会跳过并明确提示需真机验证。

包内 `BUILD-INFO.txt` 记录构建时间与代码版本，便于确认目标机上那个包是哪次构建的。
`dist/RELEASE-INFO.txt`（在 zip **旁边**，不进包）记录 zip 的条目数、大小与 **SHA256**，
接收方可自行校验：

```bat
certutil -hashfile md2docx-win-x64.zip SHA256
```

### 4.2 打包工具与中文文件名（重要）

默认优先使用系统 **bsdtar**（Windows 10+ 自带 `C:\Windows\System32\tar.exe`）：

```bat
tar.exe -a -c -f dist\md2docx-win-x64.zip --options hdrcharset=UTF-8 -C dist md2docx-win-x64
```

两个要点，都不是可选项：

- **必须带 `--options hdrcharset=UTF-8`**。bsdtar 默认按系统 ANSI 代码页（中文机器为 GBK）
  写文件名且**不置 UTF-8 flag**——这种包在中文 Windows 上解压正常、在英文 Windows 上
  解压出来是 `ʹ��˵��.txt` 这类乱码，而外观与正确包完全一样，只有到别人机器上才暴露。
  `verifyZipEntryEncoding` 闸门会把它拦下。
- **不要用 `adm-zip` 做默认**。它编码语义正确（UTF-8 + flag），但需要把每个文件先读进
  内存再压缩：2.3 万个文件 / 535MB 时 GC 压力极大，实测读 1.4 万文件就花了 356 秒且
  越来越慢（整包 20 分钟以上，看起来像卡死）。bsdtar 同样内容约 6 分钟、内存平稳。
  找不到 bsdtar 时脚本会自动回退 adm-zip，只是慢。


构建脚本会自动完成：下载便携 Node → `npm ci --os=win32 --cpu=x64` → 裁剪冗余
（source map / 类型声明 / Chrome 多余语言包 / 非 win32 原生包）→ 下载
`chrome-headless-shell`（win64）→ 组装 → 打 zip。

## 5. 体积构成（实测）

| 组成 | 体积 |
|---|---|
| `chrome-headless-shell` | 231MB |
| `node_modules`（裁剪后） | 297MB |
| `node.exe` | 83MB |
| **目录合计** | **534.9MB**（22,857 个文件） |
| **zip** | **211.8MB** |
| **一键安装器 EXE** | **133.0MB**（LZMA 固实压缩，比 zip 更小） |

打包耗时（Windows 构建机实测）：bsdtar 约 **6 分钟**；adm-zip 回退路径 20 分钟以上。

想更小：加 `--skip-chromium` 复用系统 Chrome/Edge（约省 230MB）。

> `node_modules` 里 2.3 万个文件大部分是间接依赖拖进来的（例如
> `@mermaid-js/mermaid-zenuml` 声明了 `@zenuml/core`——一个 React+Tailwind 应用，
> 会把 react/react-dom/@headlessui/tailwindcss/@napi-rs 整套装上，约 1.6 万个文件；
> 而运行时只用它同包内已打包好的 ESM chunk，`@zenuml/core` 本身并不被引用）。
> 这是后续可优化的方向，`assertBundleBudget` 会防止它继续失控。

## 6. 技术要点（为什么能免 Java / graphviz / Python）

| 原本需要 | 现在 | 说明 |
|---|---|---|
| Java + `plantuml.jar` | **不需要** | 改用 `@plantuml/core`（TeaVM 版 PlantUML，MIT，7.5MB），自带 WASM 版真 Graphviz |
| graphviz | **不需要** | 同上 |
| python3 + python-docx | **不需要** | 分页属性（`cantSplit`/`keepNext`/`keepLines`）由 `docx` 库原生输出 |
| 系统 Chrome | **随包** | `chrome-headless-shell`（win64），经 `PUPPETEER_EXECUTABLE_PATH` 指定 |

渲染后端可用 `PLANTUML_BACKEND=core|jar|auto` 切换，默认 `auto`（优先 core，不可用则回退 jar）。

## 7. 验证状态

### 7.1 已在 Windows 真机验证（2026-09）

| 项 | 结果 |
|---|---|
| 包自检（包内 node + 包内 chrome-headless-shell） | **全部通过**（13s） |
| 安装路径含中文与空格 | ✓ 已验证（`...\md2docx 离线 测试\md2docx-win-x64`） |
| **图内中文是否变方块**（原最高风险项） | ✓ 逐图目视确认：PlantUML + mermaid 中文均正常，无方块 |
| 图表灰阶主题 | ✓ mermaid `neutral` / PlantUML `plain` 均为黑白灰 |
| CLI 批量转换（`转换文档.cmd`） | ✓ 中文+空格路径下 3/3 PlantUML，产出 DOCX |
| 真实文档端到端 | ✓ PlantUML 23/23、图片 24 张、题注 436 个 |
| HTTP 服务 `/api/health` | ✓ `status: ok`（node / chrome / plantuml=core 全 ✓） |
| `/api/convert` 全流程 | ✓ 202 → done → 下载；**中文上传文件名无乱码** |
| 端口被占自动换端口 | ✓ 8080 被占 → 自动用 8081，`server-url.txt` 与实际一致 |
| 双击启动 + 浏览器自动打开 | ✓ 打开默认浏览器并指向实际端口 |
| zip 解压即用 | ✓ `Expand-Archive` 解压后直接跑通自检 |
| zip 内中文文件名 | ✓ 解压得到 `启动 md2docx.cmd` / `使用说明.txt` / `自检.cmd` / `转换文档.cmd` |

### 7.2 仍需真机确认

- [ ] 目标机**断网**状态下全流程可用（无任何联网请求）
- [ ] 杀软是否拦截（便携 node.exe / chrome-headless-shell）
- [ ] 超长路径（>260 字符）
- [ ] 一键安装器 EXE 的安装/卸载（Windows 上需本地装 NSIS 构建）

### 7.3 构建期已自动覆盖

`smokeTestBundle` 每次构建都会用包内代码真跑一次转换（图/表/中文/含空格图片名），
因此"包能不能跑"不需要人工判断——构建通过即代表核心链路可用。

历史教训：曾把 `dist/` 里的旧包当成最新的发出去，那个包缺少后续 6 个提交里的
5 个缺陷修复（活动图 31% 渲染失败、99% 表格失效等），外观却与正确包无异。
这就是 `assertCleanTree` + `BUILD-INFO.txt` + CI 出包的由来。

## 8. 卸载

删除整个目录即可。包不写系统 PATH、不注册全局组件、不安装服务；
服务产生的作业文件都在包内 `data/`，随目录一并删除。
