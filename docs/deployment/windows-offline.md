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
node scripts/build-windows-bundle.js
```

可选参数：

| 参数 | 作用 |
|---|---|
| `--installer` | 额外生成 Windows 一键安装器 EXE（NSIS，可交叉编译） |
| `--out <dir>` | 指定输出目录（默认 `dist/`） |
| `--skip-chromium` | 不打包浏览器（目标机需自带 Chrome/Edge，可省约 230MB） |
| `--keep-temp` | 保留临时目录便于排查 |

生成安装器时，若 `PATH` 中没有 `makensis`，脚本会自动下载并**本地解包**
Ubuntu 归档的 `nsis` + `nsis-common` 两个 deb（不改系统、不需 root）。

### 4.1 构建闸门（失败即中止，不会产出坏包）

构建脚本内置三道强制检查。它们的存在有具体教训：曾把 `dist/` 里的**旧包**
当成最新的发给别人——那个包缺少后续 6 个提交里的 5 个缺陷修复
（活动图 31% 渲染失败、99% 表格失效等），外观却与正确包无异。

| 闸门 | 时机 | 作用 |
|---|---|---|
| `assertCleanTree` | 构建前 | 工作区有未提交改动时拒绝构建（提示先提交，或显式 `--allow-dirty`）。分发包必须能对应到确定版本 |
| `verifyBundleCode` | 打包前 | 逐字节比对包内 `scripts/`、`server/` 与当前源码，防"拷贝遗漏/旧文件残留" |
| `smokeTestBundle` | 打包前 | 用**包内**代码与依赖真跑一次转换——"能构建 ≠ 能运行"的唯一实证 |

`smokeTestBundle` 的自检用例刻意覆盖近期修过的缺陷路径（作者本地图片、
裸写活动名的活动图、无分隔行的键值表），断言图片数 ≥3、表格数 ≥1、
无"图片缺失"占位。本机无浏览器时会跳过并明确提示需真机验证。

包内 `BUILD-INFO.txt` 记录构建时间与代码版本，便于确认目标机上那个包是哪次构建的。

构建脚本会自动完成：下载便携 Node → `npm ci --os=win32 --cpu=x64` → 裁剪冗余
（source map / 类型声明 / Chrome 多余语言包 / 非 win32 原生包）→ 下载
`chrome-headless-shell`（win64）→ 组装 → 打 zip。

## 5. 体积构成（实测）

| 组成 | 体积 |
|---|---|
| `chrome-headless-shell` | 231MB |
| `node_modules`（裁剪后） | 297MB |
| `node.exe` | 83MB |
| **目录合计** | **534.9MB** |
| **zip** | **213.3MB** |
| **一键安装器 EXE** | **133.0MB**（LZMA 固实压缩，比 zip 更小） |

想更小：加 `--skip-chromium` 复用系统 Chrome/Edge（约省 230MB）。

## 6. 技术要点（为什么能免 Java / graphviz / Python）

| 原本需要 | 现在 | 说明 |
|---|---|---|
| Java + `plantuml.jar` | **不需要** | 改用 `@plantuml/core`（TeaVM 版 PlantUML，MIT，7.5MB），自带 WASM 版真 Graphviz |
| graphviz | **不需要** | 同上 |
| python3 + python-docx | **不需要** | 分页属性（`cantSplit`/`keepNext`/`keepLines`）由 `docx` 库原生输出 |
| 系统 Chrome | **随包** | `chrome-headless-shell`（win64），经 `PUPPETEER_EXECUTABLE_PATH` 指定 |

渲染后端可用 `PLANTUML_BACKEND=core|jar|auto` 切换，默认 `auto`（优先 core，不可用则回退 jar）。

## 7. 已验证 / 待真机验证

**已在本机（Linux）验证**：

- 包内容与平台正确性：只含 win32 原生二进制，无 linux 残留；无本机构建路径残留
- **依赖树完整可用**：用包内 `node_modules` + 包内 `scripts/cli.js` 跑通
  mermaid + PlantUML + 表格全流程，产出 docx
- 裁剪安全性：每步裁剪后均重跑渲染验证
- **构建闸门全部通过**：代码干净、包内代码与源码逐字节一致（33 个文件）、
  包自检通过（图 3 张含裸活动名、表 1 个无分隔行已修复、无图片缺失）

**必须在 Windows 真机确认**（清单见 `docs/plans/windows-native.md` §7）：

- 图内中文显示是否正常（Windows 字体名与 Linux 不同，**最高风险项**）
- 双击 `.cmd` 启动、浏览器自动打开、端口被占时自动换端口
- 路径含空格与中文（`C:\用户\我的 文档\`）
- 上传/转换**文件名或图片名含空格**的文档（缺陷 006 场景，Windows 高发）
- 断网状态下全流程可用
- 杀软是否拦截

## 8. 卸载

删除整个目录即可。包不写系统 PATH、不注册全局组件、不安装服务；
服务产生的作业文件都在包内 `data/`，随目录一并删除。
