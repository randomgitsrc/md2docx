# 评审：Windows 原生一键安装方案（无 WSL / 无 Docker）

## 评审日期

2026-09-17

## 评审范围

- `docs/plans/windows-native.md`（待评审方案，115 行，`md5=e950aae0…`）
- 对照实现：`scripts/md2docx.js`、`scripts/preprocess.js`、`scripts/plantuml-renderer.js`、
  `scripts/puppeteer-config.js`、`scripts/exec-util.js`、`scripts/md2docx.sh`
- 服务端：`server/app.js`、`server/config.js`、`server/lib/pipeline.js`、
  `server/jobs/job-worker.js`、`server/jobs/job-store.js`、
  `server/services/dependency-check.js`、`server/routes/health.js`
- 约定：`AGENTS.md`、`package.json`
- 外部事实核查：PlantUML 官方 release 资产、Smetana 文档、puppeteer 24 源码、npm registry

## 评审方法与环境声明

本机为 **Linux**，**无法实测任何 Windows 行为**。以下结论分三类，已逐条标注：

- **[静态]** — 代码/文档阅读即可确定，与操作系统无关。
- **[本机实测]** — 我在本机（Linux + Node 24.15.0 + plantuml.jar 1.2025.2 + 官方 Chrome headless-shell）
  实跑复现，结论对我实测的那条代码路径成立。
- **[需 Windows 实测]** — 依赖 Windows API/路径/注册表/控制台，只能在目标机确认。

评审期间工作树正被并行修改（`git log` 出现 `6652674 feat: Windows 原生适配…`，且
`scripts/md2docx.js`、`server/services/dependency-check.js`、`server/routes/health.js` 有未提交改动；
`scripts/md2docx.js` 在评审过程中从 1400 行涨到 1426 行）。
**本文以"方案文本"为评审对象**，并在涉及处注明"代码已经走得更远"。

> ⚠️ **行号时效性**：文中行号已按评审结束时的**工作树**状态校准过一遍；
> 但既然工作树仍在变动，实施时请以**符号名/函数名**（如 `appendImageParagraph`、
> `renderPlantUML`、`fixYamlFrontMatter`）而非行号定位。
> 另：§3「漏列文件」与 §7「依赖只剩两项」两条结论，**代码已经自行走得更远**
> （`dependency-check.js` 已改为探 node/chrome/plantuml），方案文本尚未同步改编。

## 评审结论速览

**结论：修改后通过。**

方案的方向是对的：去掉 Java/graphviz/Python 三个重依赖、把外部命令改成参数数组、
监听 `127.0.0.1`、一键安装 + 自动开浏览器——这些判断都成立，且部分已在代码里落地。
但方案有 **3 个事实性错误**（`channel:'msedge'` 不存在、原生 exe 不是单文件、
Smetana 只对 DOT 类图生效且版式与 graphviz 不等价），遗漏了 **10+ 处会在 Windows 上真实失败的点**
（其中"缓存目录陈旧 PNG 被复用导致嵌入错图"我已实测复现，是静默产生错误文档的数据正确性问题），
并且 **§3 漏列了 4 个必须改的文件**。此外 **Electron 选型的核心理由（复用其 Chromium 给 mermaid 用）
技术上不成立**，建议改推形态 B。

另有 **1 个方案完全没考虑的更优路线**：官方 `@plantuml/core`（TeaVM 编译的 PlantUML，
MIT，7.7MB，自带 WASM 版 Graphviz）可在现有 Chromium 里渲染 PNG，**同时干掉 Java、graphviz、
原生 exe 体积、VC++ 运行时与字体子进程五个风险**。建议优先评估。

---

# 一、高严重级问题

## H1. 【高】§2/§4 的 `channel: 'msedge'` 在 puppeteer 24 中不存在

**位置**：方案 §2 依赖瘦身表"Chromium"行、§4 形态 A "puppeteer 指向 Electron 的 chromium 或用系统 Edge"

**问题** **[静态]**：方案把"用系统 Edge（`channel: 'msedge'`）"当作 0 体积方案。
但 puppeteer 24 的 `ChromeReleaseChannel` 只有 `chrome | chrome-beta | chrome-dev | chrome-canary`：

```
node_modules/puppeteer-core/lib/esm/puppeteer/node/LaunchOptions.js:10-21
  case 'chrome': … case 'chrome-beta': … case 'chrome-dev': … case 'chrome-canary':
```

`@puppeteer/browsers` 的 `computeSystemExecutablePath` 也没有 edge 分支。
传 `channel:'msedge'` 会走进 `switch` 无匹配 → 返回 `undefined` → 启动期报错。
**结论是对的，机制是错的。**

**建议**：改写为"Edge 只能通过 `executablePath` 指定"。
好消息是 `scripts/puppeteer-config.js` 已经这么做了（`CANDIDATES` 含 msedge.exe、
`PUPPETEER_EXECUTABLE_PATH` 可覆盖、用户级 `AppData\Local\Microsoft\Edge\...` 也已加）——
**该条应标记为"已实现"而不是"待实现"**，并修正 `channel` 的错误表述，避免后续照抄。

## H2. 【高】§6.1 原生 PlantUML "解压为 `bin/plantuml.exe`" 会失败

**位置**：§2 依赖表 Java 行（"~48MB"）、§6 实施步骤第 1 步、§5 风险表"原生 PlantUML 的中文字体"

**问题** **[本机实测]**：我下载了 `native-plantuml-windows-amd64-1.2026.8.zip`（48.3MB）并列出内容：

```
plantuml.exe        127,766,528 B   ← 解压后 121.8MB（不是 48MB，48MB 是 zip 体积）
awt.dll fontmanager.dll freetype.dll java.dll javaaccessbridge.dll
javajpeg.dll jawt.dll jvm.dll lcms.dll mlib_image.dll   ← 10 个 DLL，与 exe 平铺同级
```

三点后果：

1. **不能只解压 exe**。`awt.dll`/`fontmanager.dll`/`freetype.dll`/`javajpeg.dll`/`mlib_image.dll`/`lcms.dll`
   是字体与图像子系统，必须与 exe 同目录。方案"解压为 bin/plantuml.exe"会得到一个启动即崩（或渲染无字）的包。
2. **体积预估错**：解压 121.8MB，§2 的"约 48MB"是压缩包体积。叠加 Electron 250MB 后，
   方案 §2 的"250–350MB"安装包估算偏乐观。
3. **缺 VC++ 运行时**：exe 依赖 `VCRUNTIME140.dll`/`VCRUNTIME140_1.dll`，zip **未附带**，
   干净 Windows 上没有 → 直接报"找不到 VCRUNTIME140.dll"。方案 §1 声称"不装 Java/Python/Chrome"，
   但没提 VC++ redist。 **[需 Windows 实测]** 确认目标机是否已有（多数装了 Office/VS 的机器有）。

**建议**：
- 若要保留原生 exe：改为"解压整个 zip 到 `bin/plantuml-native/`"（`findPlantUML()` 探测 `bin/plantuml-native/plantuml.exe`），
  安装器检测/静默安装 VC++ 2015-2022 x64 redist，§2 体积改为 122MB。
- **更推荐直接放弃原生 exe，改用 H6 的 `@plantuml/core`**（无 Java、无 DLL、无 VC++、7.7MB）。

## H3. 【高】缓存目录中的陈旧 PNG 会被复用 → 静默嵌入上一份文档的图

**位置**：`scripts/plantuml-renderer.js:344-428`（`renderPlantUML`），缓存目录 `md/output/.plantuml/`、
HTTP 作业的 `<jobDir>/.plantuml/`；方案 §3 未提及

**问题** **[本机实测，已复现]**：`renderPlantUML` 把中间文件写成**固定名** `p_<index>.puml` /
`p_<index>.png` 放进持久缓存目录，渲染后仅用 `fs.existsSync(outFile)`（:409）判成功，**没有先删除旧产物**。

PlantUML 在"块里没有 `@startuml`"时 **exit code = 0 且不写任何文件**，只在 stderr 打 `No diagram found`：

```
$ java -jar plantuml.jar -tpng -o . p_1.puml   # 内容: "no startuml here"
exit=0 ; 未生成任何 png ; stderr: Warning: no image … / No diagram found
```

于是上一轮残留的 `p_1.png` 让 `existsSync` 为真 → 被当作本次渲染结果。

**实测复现（跨文档污染）**：

```
docA.md（正常 @startuml，画 class ONLY_IN_DOC_A）→ p_1.png sha=c01d7d2b…
docB.md（同一目录，plantuml 块无 @startuml）    → p_1.png sha=c01d7d2b…  ← 未变
docB.clean.md 生成:  ![](../.plantuml/docB_puml1.png)   ← docB 嵌入了 docA 的图
```

**为什么这是本次评审最严重的问题**：它不是崩溃，而是**静默产出内容错误的正式文档**。
Windows 打包后 CLI 批量转换（§1 明确要求保留"CLI 批量转换能力"）会在同一目录连续产出多份文档，
正是触发条件。方案 §5 只列了"渲染失败 → 降级为代码块"，**没有考虑"渲染未失败但复用了旧图"**。

**建议**：
- `renderPlantUML` 在 `runFile` 前 `fs.rmSync(outFile, { force: true })`；
  或把中间文件放进每次运行的独立 `mkdtemp` 目录（与 H4 的 tmpDir 修复合并做）。
- §7 验证清单加入回归用例：连续转换两份文档，第二份的 plantuml 块故意写错，
  断言**不得**复用第一份的 PNG（现有 `md/qa/plantuml-no-end.md` 是同类用例，但它只覆盖单文件、未覆盖跨文件复用）。

## H4. 【高】`dataDir` 相对 CWD，且启动清扫会删目录

**位置**：`server/config.js:24`、`server/jobs/job-store.js:76-96`；方案 §3/§4 未提及

**问题** **[静态 + 需 Windows 实测]**：

```js
dataDir: path.resolve(process.env.DATA_DIR || 'data'),   // server/config.js:24
```

`path.resolve` 以 CWD 为基准。Node 下我实测确认：

```
cwd=/tmp                → dataDir=/tmp/data
cwd=<project>           → dataDir=<project>/data
```

Windows 快捷方式启动时 CWD 由"起始位置"字段决定，常见为 `C:\Windows\System32`、
或用户主目录、或未定义（继承 explorer.exe 的 CWD）。两条后果：

1. `fs.mkdirSync(.../jobs)` 在 `System32` 下抛 `EPERM`，`createApp()` 里**未捕获** → 服务启动即崩。
2. 更危险：`JobStore.cleanupOrphans()` 每次启动 `fs.rmSync(p, {recursive:true, force:true})`
   **删除该目录下所有不在内存 store 中的子目录**（:85-92）。若 CWD 恰好指向用户某个有数据的目录，
   这是**静默数据删除**。

方案 §5 只提到"作业目录放在哪（ProgramData? AppData?）"是开放问题，§3 完全没有把 `config.js` 列为改动点。

**建议**：
- `config.js` 增加平台默认：Windows → `%LOCALAPPDATA%\md2docx`（单用户、免管理员、无 ACL 问题），
  或 `%PROGRAMDATA%\md2docx`（多用户，需安装器设 ACL）。**不要**用 CWD。
- 启动清扫加护栏：只删除**形如 jobId（16 位 hex）** 的子目录，并在删除前确认目录名匹配且非符号链接；
  另加"目录为空则跳过"的保护。`DATA_DIR` 显式设置时保留现有语义。
- `createApp()` 的 `new JobStore(...)`/`cleanupOrphans()` 包 try/catch，失败时给出可读错误而不是栈。

## H5. 【高】监听地址 / 端口占用 / 无鉴权（§3 第 7、8 条未实施）

**位置**：`server/config.js:21`、`server/app.js:111`；方案 §3 第 7、8 条

**问题** **[静态]**：

```js
host: process.env.HOST || '0.0.0.0',        // config.js:21  ← 与方案 §3.7 的 127.0.0.1 相反
app.listen(config.port, config.host, …)     // app.js:111   ← 无 'error' 监听、无空闲端口探测
```

1. 默认 `0.0.0.0` 会在 Windows 首次运行弹**防火墙授权框**（正是 §3.7 想避免的）。
2. 服务**没有任何鉴权**（只有 IP 限流 `rate-limit.js`，且 `app.set('trust proxy', true)`
   使 `req.ip` 可被 `X-Forwarded-For` 伪造）。绑 `0.0.0.0` 等于把"任意 md → 文件下载"
   暴露给同网段所有人；作业产物含用户文档内容。**这是安全边界问题，不是体验问题。**
3. `app.listen` 无 `error` handler：8080 被占用时抛未捕获异常，用户看到一屏栈（§3.8 要解决的正是这个）。

**建议**：
- `host` 默认改 `127.0.0.1`；局域网模式必须显式设置 `HOST=0.0.0.0`，并在启动日志与页面上
  **明确告警"无鉴权，同网段可访问"**；如要开源到局域网，至少加一个随机 token（启动时生成、打印在托盘/日志）。
- `listen` 加 `error` 处理 + 端口回退：`EADDRINUSE` 时在 `[8080, 8081, …]` 中探测空闲端口，
  成功后把实际端口写入用户配置并由托盘/日志给出正确 URL（§3.8 的落地）。
- 加**单实例锁**：两实例共用同一 `dataDir` 会互相 `cleanupOrphans` 删掉对方的作业目录。

## H6. 【高】方案遗漏的官方更优解：`@plantuml/core`（TeaVM PlantUML + WASM Graphviz）

**位置**：方案 §2 依赖瘦身表整表、§5 风险表"原生 PlantUML 的中文字体"（方案自评的最高风险）

**问题** **[本机实测]**：PlantUML 官方（维护者 Arnaud Roques 发布）已提供 TeaVM 编译的
JS 引擎 `@plantuml/core`（v1.2026.8，**MIT**，解压 7.7MB），并自带 `viz-global.js`
（**Graphviz/Viz.js 编译产物**——即**真正的 dot 布局**，不是 Smetana 降级）。
方案完全没考虑它。我在本机实测了完整链路：

| 验证项 | 结果 |
|---|---|
| Node 中 import | ✅ `export{render, renderToString}` 可加载（ESM） |
| 无头 Chromium 中渲染 | ✅ `renderToString` 返回 SVG |
| **是否退化为 Smetana** | ✅ **未退化**（控制台无 `falling back to the Smetana layout engine`，说明真用了 WASM dot） |
| 中文 | ✅ SVG 含 `服务进程` 等 CJK 文本 |
| `!theme plain` / `cerulean` | ✅ 均生效（需把 `themes.js` 与引擎同目录提供） |
| 单图耗时 | ✅ 119–458 ms |
| PNG 产物 | ✅ 对 SVG 元素截图即得 PNG |

**为什么它优于方案的三条路**：一次性消掉方案 §5 的**最高风险**（原生镜像字体子系统差异）+ 
Java + graphviz + 121MB 原生 exe + VC++ redist + `p_1.png` 子进程时序，并且
**复用 mermaid 已经必需的 Chromium**——与方案 §2"推荐组合"想要的复用是同一个目标，
只是换成了真正可行的实现。

**已知约束（诚实标注）**：
- 需要 DOM：必须跑在页面里（项目已有 puppeteer + `puppeteer-config.js` 全套基础设施，正好复用）。
- `!theme` 需要 `themes.js` 同目录；标准库（C4 等）需另配 `PLANTUML_STDLIB_BASE`，未打包。
- 我在快速测试中 `skinparam defaultFontName` **未**反映到 SVG 的 `font-family`（得到 `monospace`），
  中文可显示说明系统字体回退生效，但"指定字体名是否可靠" **[需在目标机实测]**；
  缓解：给渲染页注入 CSS `font-family`（比 PlantUML 的 skinparam 更可控）。
- **需实测确认**与 jar 版在 23 张真实图上的版式/尺寸差异（这决定横置判定，见 H7）。

**建议**：把"`@plantuml/core` + 现有 Chromium"列为**首选路线（D 方案）**，与 A/B 并列做 PoC；
若 PoC 通过，§2 的依赖表可砍到"**仅 Node + Chromium**"两项，§5 的最高风险项直接消失。

## H7. 【高】Smetana 结论过强：适用面、版式不等价、横置判定会连带变化

**位置**：方案 §2 graphviz 行（"实测 23/23 全通过"）、§5、§6 第 3 步

**问题** **[本机实测]**：

1. **适用面是"只有 DOT 类图"**。按 PlantUML 官方
   [Smetana 文档](https://plantuml.com/smetana02)，`dot` 只用于 usecase / class / object /
   component / deployment / state / legacy activity 七类；
   而 [vizjs 页](https://plantuml.com/vizjs) 进一步说明 "every UML diagrams (except Sequence Diagrams
   and Activity Beta Diagrams)"。我实测 13 类图 smetana 全部出图（class/usecase/component/
   deployment/state/object/sequence/activity/gantt/mindmap/wbs/nwdiag），
   **即"能不能出图"没问题，"出得对不对"另说**。
2. **版式与 graphviz 不等价**。同一张图，dot 与 smetana 产物**字节不同**（class 图 11091B vs 9555B、
   component 3274B vs 3054B）。"23/23 全通过"= 都渲染出来了，**不等于 23/23 视觉等价**。
3. **会连带改变横置判定**。`needsLandscape = downscaleRatio > 3 && aspectRatio > 2.0`
   （`plantuml-renderer.js:424-425`、`md2docx.js:706`）依赖**渲染后的实际像素**。
   版式一变，宽高比就可能跨过阈值 → 某张图从竖置变横置（或反之）→ 多出一个横置 section，
   页码与"竖→横→竖"连续性受影响（`AGENTS.md` 陷阱 1、3 正是这个机制的雷区）。
4. **不要往用户代码里注入 pragma**。方案 §6.3 说"注入 `!pragma layout smetana`"。
   注入会改变行号，而 `buildRenderError` 的 `injectedLineOffset` 是按"注入了 theme/font 行数"算的
   （`plantuml-renderer.js:309-338`）——**多注入一行 pragma 必须同步改偏移量**，否则报错行号指错位置。
   我已实测 `-Playout=smetana` 命令行开关**可用**，且不改源文件。
5. `vizjs` 路线（方案未提）官方自述"只支持 Java 8、复杂带标签箭头图工作不好"，
   可作为最后兜底，不适合当主路线。

**建议**：
- 改用 **`-Playout=smetana` 命令行开关**（不改源文件、无行号偏移、可用环境变量开关，正好满足 §6.3 的"可用环境变量开关"）。
- §2 措辞从"23/23 全通过"改为"**23/23 能出图；版式与 graphviz 存在差异，已逐张人工比对；
  横置判定已重跑确认无变化**"，并把它列为 PoC 必过项。
- 在 §5 风险表补一行："**Smetana 版式差异导致横置判定变化** → 页码/分节错乱"，
  验证方式：对 23 张图比对 `needsLandscape` 与最终 docx 的 section 序列。
- 若采用 H6 的 `@plantuml/core`（自带 WASM dot），本问题**整体消失**。

## H8. 【高】BOM 未剥离：记事本保存的 md 直接转换失败

**位置**：`scripts/preprocess.js:601`、`scripts/md2docx.js:1275`；方案 §3 未列

**问题** **[本机实测]**：两处都只做 `\r\n → \n`，**没有剥离 `\uFEFF`**（[静态] 全仓 grep 无 `uFEFF`）。
Windows 记事本、PowerShell `>`/`Out-File` 产出的 UTF-8 都带 BOM。后果：

```
# 记事本风格文件（UTF-8 BOM + CRLF + YAML 重复 key）
$ node scripts/preprocess.js notepad.md
错误: duplicated mapping key at line 3, column 1:
    title: 测试文档
```

机理（[本机实测]）：
- `fixYamlFrontMatter` 的去重正则 `^---\n([\s\S]*?)\n---`（:103）**因行首 BOM 不匹配** → **去重被静默跳过**；
- 随后 `gray-matter` 直接对含重复 key 的 YAML 报错 → **整个转换失败**。

即：去除重这块"防重复 key"的保险，恰好对**最需要它的 Windows 文件**失效。
（`title` 重复在人工维护的中文文档里很常见。）

**建议**：`preprocess.js` 与 `md2docx.js` 在读入后、`replace(/\r\n?/g,'\n')` **之前**加
`.replace(/^\uFEFF/, '')`；并把去重正则改为 `/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/` 不必要——
统一先剥 BOM 再走现有逻辑即可。§7 验证清单加入"记事本保存的带 BOM + 重复 key 的 md"用例。
（[需 Windows 实测] 确认记事本/Out-File 的实际产物形态。）

## H9. 【高】Electron 选型的核心理由不成立

**位置**：方案 §2 "推荐组合"、§4 形态 A 与"建议先做形态 A"

**问题** **[静态 + 本机实测]**：方案推荐 Electron 的**唯一实质理由**是"Chromium 可直接复用 Electron 的
（`puppeteer` 指向 Electron 的 chromium 或用系统 Edge）"。这条不可靠：

1. **mermaid-cli 是独立 Node CLI，自己 launch 浏览器**。`mmdc` 默认把
   `puppeteerConfig = { headless: 'shell' }`，再与我们 `-p` 传的 JSON `Object.assign` 合并
   （`@mermaid-js/mermaid-cli/src/index.js` 的 `cli()`）。
   我们传 `executablePath` 时 `headless:'shell'` 仍在，puppeteer 会 push **`--headless`**
   （`ChromeLauncher.js:193`：`headless === 'shell' ? '--headless' : '--headless=new'`）。
2. **Electron 的可执行文件不是 Chrome**。用 `--headless` 启动 Electron 本体不是受支持的用法
   （无 `chrome-headless-shell` 等价物、CDP 端点/协议版本不保证、且会走 Electron 自己的启动流程）。
   换言之"复用 Electron 的 Chromium 给 mmdc"在 mmdc 的既有启动路径下**基本不可行**；
   要真复用，得**弃用 mmdc**、改成在 Electron 的隐藏 `BrowserWindow` 里直接跑 mermaid——
   那是一次渲染层重写，方案没把它列为工作量。
3. **Electron 体积换来的"省事"有限**：托盘/自启/单实例/端口冲突**在形态 B 下也是几十行代码**，
   而 Electron 的代价是 +250MB、asar 打包（`plantuml.exe`/Chromium 必须 `asarUnpack`）、
   以及 **`ELECTRON_RUN_AS_NODE` 依赖 fuses 未被关闭**（electron-builder 的安全建议常关闭 `runAsNode`，
   一旦关闭，`runMmdc`/`downloadFileSync` 的 `process.execPath` 子进程**全部失效**——
   代码里已按"fuses 开着"假设实现，见 `exec-util.js:71-74`、`149`）。
4. **方案自相矛盾**：§2 称 Electron 可让 Chromium "0 体积"，§4 又说"Chromium 可直接复用……或系统 Edge"，
   而 §5 风险表承认"系统 Edge 不可用 → 回退到 Electron 自带 Chromium 或打包 chrome-headless-shell"。
   若最终仍需系统 Edge 或 150MB `chrome-headless-shell`，Electron 就没省下它承诺的东西。

**建议**：
- **改推形态 B（便携 Node + Inno Setup / NSIS）**，Chromium 优先级：
  ① `PUPPETEER_EXECUTABLE_PATH` 指向系统 Edge（已实现，0 体积）；
  ② 回退内置 `chrome-headless-shell`（~150MB，`puppeteer-config.js` 已能探测其缓存目录，
     布局对 Windows 正确——[本机实测] 校验过 `@puppeteer/browsers` 的 `chrome-headless-shell-win64/chrome-headless-shell.exe` 命名）。
- 若坚持 Electron：必须在 §4 明确 (a) **弃用 mmdc**、在隐藏窗口内直接调用 mermaid ESM，
  (b) `asarUnpack` 清单，(c) **`runAsNode` fuse 必须保持开启**，并把"Electron 只用于 UI/托盘、
  渲染交给系统 Edge"这种混合形态写清楚。
- §2 的"预估安装包 250–350MB"在 Electron 方案下应改为 **~400MB+**（Electron + 122MB 原生 exe + jar 兜底）。

---

# 二、中严重级问题

## M1. 【中】§3 漏列 4 个必须改的文件

**位置**：§3 全节

**问题** **[静态]**：§3 只列了 `plantuml-renderer.js`、`preprocess.js`、`md2docx.js`、
`puppeteer-config.js`、`md2docx.sh`。但 §7 的清单要成立，至少还须改：

| 文件 | 为什么必须改 | 现状 |
|---|---|---|
| `server/services/dependency-check.js` | `probe()` 探测 `java`/`dot`/`python3`/`python3 -c "import docx"`；不改则 `/api/health` 在纯 Windows 上永远 `degraded` | **代码已改**（探 node/chrome/plantuml，`allOk=['node','chrome','plantuml']`），方案未记 |
| `server/routes/health.js` | 响应体固定输出 java/graphviz/python/pythonDocx 字段 | **代码已改**，方案未记 |
| `server/config.js` | §3.7 监听地址、§3.8 端口、作业目录位置都落在这里 | 未改（`host` 仍 `0.0.0.0`） |
| `server/app.js` | `listen` 的 `error`/端口回退/单实例；形态 A 的 `createApp()` 复用入口 | 未改 |

**建议**：§3 补上这 4 个文件（并把 dependency-check/health 标注"已实现"）。
方案声称"§7 依赖全 ✓（此时应只剩 node/chrome 两项）"——实际必需项是 **3 项**（含 plantuml），
文字需同步。

## M2. 【中】§3.3 的 `adm-zip` 路线是错的方向（应改为 docx 库原生能力）

**位置**：§2 Python 行、§3 第 3 条、§6 第 2 步

**问题** **[本机实测]**：方案设计"用 `adm-zip` 读写 `word/document.xml` 注入 `cantSplit`/`keepNext`/`keepLines`"。
但这个前提**本身是错的**——`docx@9.7.0` **原生支持**这些属性：

```
node_modules/docx/dist/file/paragraph/properties.d.ts:20-21   keepNext?, keepLines?
node_modules/docx/dist/file/table/table-row/table-row-properties.d.ts   cantSplit?, tableHeader?
```

我在本机实跑验证：`new TableRow({cantSplit:true})` → `document.xml` 出现 2 处 `<w:cantSplit/>`；
`new Paragraph({keepNext:true, keepLines:true})` → 分别出现 `<w:keepNext/>`/`<w:keepLines/>`；
样式级也能输出（`styles.xml` 的 Caption 带 `<w:keepNext/><w:keepLines/>`）。
（这与 `AGENTS.md` 新增的陷阱 4 一致：代码已改为原生输出 + `ENABLE_PAGINATION_PATCH=1` 回退开关。）

**结论**：**不需要 adm-zip，也不需要任何 zip 手术**。手工改 `document.xml` 反而引入
`[Content_Types].xml`、`w:pPr` 子元素顺序（OOXML schema 对 `pPr` 内元素顺序敏感）、
命名空间前缀、以及"样式引用 vs 直接格式化"三类风险——而收益为零。
**建议**：§3.3 改为"删除 python-docx 调用，分页属性由 docx 库原生输出
（`TableRow.cantSplit`、Caption/表头段 `keepNext`/`keepLines`）；
保留旧实现为 `ENABLE_PAGINATION_PATCH=1` 回退开关"。
等价性验证已由 `scripts/compare-pagination.js` 完成（4427 行 / 13514 段，0 差异），方案应引用它。
`adm-zip` 若确实无人使用，应作为"可移除依赖"标注（§2 称其"已是现有依赖"——
`package.json:18` 有，但【静态】全仓无 `require('adm-zip')`）。

## M3. 【中】上传中文文件名被 mojibake，影响产物与下载名

**位置**：`server/routes/convert.js:12-19`、`server/services/conversion-service.js:47`；方案未提

**问题** **[本机实测]**：multer 的 `file.originalname` 由 busboy 按 **latin1** 解码
（`node_modules/busboy/lib/types/multipart.js` 用 `latin1Slice`；multer 1.4.4-lts.1 未设 `defParamCharset`）。
我用真实 multipart 请求测：上传 `测试文档.md` → `originalname = "æµè¯ææ¡£.md"`。

后果：生成的 docx 文件名、`Content-Disposition` 下载名、作业列表显示名全是乱码。
**对中文 Windows 目标机这是大概率命中的问题**（用户不可能只传 ASCII 文件名）。
转换内容本身不受影响（`upload.md` 是固定名）。

**建议**：`conversion-service.js` 取名字处加
`const name = Buffer.from(file.originalname, 'latin1').toString('utf8')`（并对已 UTF-8 的情况做
启发式判断，避免双重解码）；§7 加"上传中文文件名"用例。

## M4. 【中】`tmpDir` 从不清理，`%TEMP%` 持续累积

**位置**：`scripts/md2docx.js:329`；方案未提

**问题** **[静态]**：`fs.mkdtempSync(path.join(os.tmpdir(), 'md2docx-'))` 创建后
【静态】全文件搜 `rmSync`/`unlinkSync`/`rmdirSync` **零命中**（清理只存在于作业目录：
`job-store.js:51,87`、`conversion-service.js:95`）。每次 CLI 运行、每个 HTTP 作业（worker 里 new converter）
都漏一个 `%TEMP%\md2docx-*`。Windows 上 `%TEMP%` 不自动清理，长期运行会累积
PNG/`.mmd`/`puppetee.json`（每图几百 KB～几 MB）。

**建议**：`convert()` 在 `finally` 中 `fs.rmSync(converter.tmpDir, {recursive:true, force:true})`；
注意 Windows 上若子进程仍持有文件句柄，`rmSync` 可能 `EBUSY` → 用 `force:true` + 失败仅告警；
或改为进程退出时清理 + 启动时清理超过 24h 的 `md2docx-*`。

## M5. 【中】真实用户图片引用含空格时被静默丢弃

**位置**：`scripts/md2docx.js:469-478`、`scripts/preprocess.js:333/425`；方案 §7 "路径含空格"用例

**问题** **[本机实测]**：markdown-it 对未用 `<>` 包裹、路径含空格的图片语法**不产出 image token**：

```
'![](../.mermaid/a b.png)'        → 无 image token（退化为纯文本）
'![](<../.mermaid/a b.png>)'      → 正常，src='../.mermaid/a%20b.png'
```

于是 `appendImageParagraph` 永不触发，段落按普通文字渲染 → 图变成一行字面量。
§7 的"路径含空格与中文时正常"只覆盖了**项目/作业目录**含空格（`execFile` 参数数组已解决），
**没覆盖 md 内部的图片引用**。另外 `server/lib/pipeline.js:40` 的 `\(([^)]+)\)`
在路径含 `)` 时会截断（`D:\a (1)\x.png`）。
[本机实测] preprocess **自己生成**的名字是安全的（`baseName` 会把空格/括号替换为 `_`，
且相对路径为 `../.mermaid/...`，无空格）——所以这是"用户手写图引用"的问题，不是生成的图。

**建议**：§7 拆成两条用例：①作业/项目目录含空格与中文；②md 内含空格的图片引用。
②若判定为可接受限制，应在文档中写明"md 内图片路径请用 `![](<带 空格.png>)` 或改为无空格名"，
并把 `pipeline.js` 的图片正则改为支持 `<>` 包裹形式。

## M6. 【中】原生 exe 场景下 JAVA_HOME 探测失效、探测名与执行名不一致

**位置**：`scripts/plantuml-renderer.js:292-302`、`:44` vs `:287`

**问题** **[静态]**：
- `javaHomes` 用 `path.join(JAVA_HOME,'bin','java')`（无 `.exe`）→ Windows 上 `existsSync` 恒 false，
  **JAVA_HOME 优化静默失效**；另三条是 Linux 绝对路径。
- `findPlantUML()` 用裸名 `'plantuml'` 探测（:44），`buildCommand` 在 win32 用 `'plantuml.exe'`（:287），
  两者不一致（Node 的 CreateProcess 会补 `.exe`，所以能跑，但探测与执行走不同名字，Windows 上未经实测）。

**建议**：`path.join(JAVA_HOME,'bin', process.platform==='win32'?'java.exe':'java')`；
探测与执行统一用同一个解析函数（返回绝对路径），避免"探测到 A、执行 B"。

## M7. 【中】`downloadFileSync` 并发/首启竞态

**位置**：`scripts/exec-util.js:123-152`；方案 §3.4（改成 Node 下载）已实现

**问题** **[静态]**：下载写 `<dest>.part` 再 `renameSync`。两个作业同时首次需要
`bin/plantuml.jar` 时，会**争抢同一个 `.part` 路径**；Windows 上 `renameSync` 在目标被占用时
抛 `EPERM`。方案 §5 只考虑了"离线路径"，没考虑并发首启。

**建议**：`.part` 名加入 pid/随机后缀；下载前检查目标已存在且大小合理则跳过；
写完后用 `fs.renameSync` 失败回退"直接写目标"或加短重试。

## M8. 【中】§7 验证清单缺口（关键翻车项未覆盖）

**位置**：§7 全节

**问题** **[静态]**：清单方向正确，但漏了本次评审发现的**全部高危项**。应补：

1. **陈旧 PNG 复用回归**（H3）：连续转换同目录两份文档，第二份图表源码故意写错，
   断言**不得**嵌入第一份的图（这是唯一会静默产出错误文档的项，优先级最高）。
2. **BOM + 重复 YAML key** 的记事本风格文件（H8）。
3. **中文上传文件名**（M3）。
4. **8080 被占用**时自动换端口且用户能看到正确 URL（H5）。
5. **dataDir 在 CWD 不可写时**（模拟 `System32`）不崩、不误删（H4）。
6. **双实例**同时启动不互删作业目录（H5）。
7. **原生 exe 的 DLL/VC++ 依赖**：在未装 VC++ redist 的干净镜像上首次渲染（H2）。
8. **横置/分节回归**：采用 Smetana 或 TeaVM 后，逐张比对 `needsLandscape` 与 docx section 序列（H7）。
9. **离线首启**：断网状态下启动（不得触发 jar 下载/npm install 弹窗）、以及"离线但缺
   `bin/plantuml.jar`"时的降级路径是否可读。
10. **超长路径**：>=260 字符的输入路径与 `%TEMP%`（Windows 需 `LongPathsEnabled` 或缩短路径）。
11. **杀软/SmartScreen**：未签名安装包在启用 Defender 的机器上的实际拦截情况。
12. **卸载残留**：显式列出要清理的位置（`%LOCALAPPDATA%\md2docx` 作业目录、
   运行时下载的 `bin/plantuml.jar`、开机自启项、快捷方式、日志），并验证清理干净。
13. **Word 打开着输出文件**时覆盖写 → `EBUSY` 的可读提示（Windows 特有文件锁）。

## M9. 【中】§5 风险表遗漏三类真实风险

**位置**：§5

**建议补充**：

| 风险 | 影响 | 缓解 |
|---|---|---|
| **文件锁**：用户用 Word 打开着 `xxx.docx` 时重跑转换 | `fs.writeFileSync` 抛 `EBUSY`，用户看到栈 | 捕获后提示"请先关闭 Word 中打开的该文档" |
| **Windows 保留名**：输入文件名为 `con.md`/`nul.md`/`aux.md`/`com1.md`（带扩展名仍保留） | 无法创建 `con.clean.md`/`con.docx`，报错难懂 | 对 `docName` 做保留名校验并改名；`baseName` 的字符白名单已能挡大部分，但 `con` 是合法字母串 |
| **`%TEMP%` 被安全软件重定向/清理** | 渲染中途文件消失，报错难定位 | 允许 `TMPDIR` 覆盖；错误信息带出实际 tmp 路径 |

---

# 三、低严重级问题（可更好，非失败）

## L1. 【低】Windows 控制台编码与 ANSI 转义

**位置**：`scripts/preprocess.js:52`（`\r\x1b[K`）、全仓 `console.log` 中文

**[本机实测 + 需 Windows 实测]**：`logRenderProgress` 用 `process.stdout.write('\r\x1b[K…')` 做进度覆盖。
Windows `cmd.exe`（尤其老 conhost）对 ANSI 支持不稳，可能显示成 `←[K` 乱码；
中文日志在代码页 936（GBK）控制台下会 mojibake（我在本机验证了 UTF-8 字节按 GBK 解释必然乱码）。
不致命（不影响转换），但"一键安装给非技术用户"时第一印象很差。
**建议**：为 TTY 检测（`process.stdout.isTTY`）+ `process.platform==='win32'` 时关闭 ANSI 覆盖、改用逐行；
或在启动器里 `chcp 65001`。PowerShell 5.1 的 `>` 重定向写 UTF-16LE，若文档教用户重定向日志需注意。

## L2. 【低】`md2docx.sh` 的 Windows 替代（§3.6）

**位置**：§3.6、`scripts/md2docx.sh`

**[静态]** 方案判断正确（bash 脚本在 Windows 不可用，且它依赖 `which`/`command -v`/`curl`/`du`/`/dev/tty`）。
形态 B 下需提供 `md2docx.cmd` 或 `node scripts/cli.js`（推荐后者，一套逻辑跨平台）。
**补充建议**：纯 Node 入口应复用 `exec-util`，并且**保留 `.sh`**（Docker 路线仍用它，
§8 的"净收益"才成立）；`.cmd` 里注意 `%~dp0` 与含空格路径的引号。

## L3. 【低】`puppeteer-config.js` 的 `AppData\Local\puppeteer` 是死分支

**位置**：`scripts/puppeteer-config.js:42`

**[静态 + 本机实测]** [本机实测] puppeteer 24 的 `cacheDirectory` 默认值是
`path.join(os.homedir(), '.cache', 'puppeteer')`，**所有平台一致**（含 Windows）——
`Configuration.d.ts` 明确写着该 `@defaultValue`。所以 `:40` 是对的，`:42` 的
`AppData\Local\puppeteer` 并非真实位置。windows 目录布局（`chrome-headless-shell-win64/chrome-headless-shell.exe`、
`chrome-win64/chrome.exe`）**已正确覆盖**（对照 `@puppeteer/browsers` 的
`folder()`/`relativeExecutablePath()`）。**建议**：删掉死分支或注释说明其仅为兼容自定义缓存。

## L4. 【低】残留的 shell 字符串拼命令与无用依赖

**位置**：`server/services/dependency-check.js:14`（`` execSync(`${cmd} ${args||''}`) ``）、
`scripts/preprocess.js:23`（未使用的 `execSync` import）

**问题** **[静态]**：`AGENTS.md` 陷阱 11 已把"外部命令必须用参数数组、不经 shell"定为硬规则。
`dependency-check.js:14` 仍是模板字符串（当前 `args` 全是静态串，无实际漏洞，但违反约定、且是
唯一残留的字符串拼命令点之一；另一处是 `md2docx.js:1248` 的 python 回退，已被开关关掉）。
`preprocess.js` 的 `execSync` import 在改造后已无人使用。

**建议**：`dependency-check.js` 改用 `exec-util.runFile`；删掉无用 import；
`md2docx.js:1248` 的 python 回退建议在 Windows 上直接短路（`process.platform==='win32'` 时不尝试），
避免"菜单里明明有回退开关、在 Windows 上却只会失败一次再告警"。

## L5. 【低】`--no-sandbox` 在 Windows 上无必要

**位置**：`scripts/puppeteer-config.js:83`

**[静态]** `args: ['--no-sandbox','--disable-setuid-sandbox']` 是为容器/root 场景加的
（`docker-deployment.md` 明确说明）。Windows 下非必要，且会降低渲染进程隔离。
**建议**：仅在 Linux 或检测到 root/容器时附加；Windows 保持默认沙箱。

## L6. 【低】死参数 `srcDir` 与死变量 `alt`

**位置**：`scripts/md2docx.js:331`（`this.srcDir` 只写不读）、`:686`（用 `this.inputDir`）、`:476` + `:683`（`alt` 恒为 `''`）

**[静态]** `job-worker.js:63` 传 `srcDir: jobDir` 实际不生效（今天无害，因为
`inputDir` = `<jobDir>/clean`，`../.mermaid` 仍能解析）。`appendImageParagraph(src, alt)` 的 `alt`
从未被使用（markdown-it 把 alt 放在 `token.content`，而代码从 `attrs` 取，恒得 `''`）。
**建议**：删 `srcDir`（或让它真正生效并统一到 `srcDir`），删 `alt` 参数——否则下一个人会以为改了 `srcDir` 就改了图片解析基准。

## L7. 【低】`checkGraphviz()` 的 apt 提示在 Windows 上是误导

**位置**：`scripts/plantuml-renderer.js:23-31`

**[静态]** 打印 `sudo apt-get install graphviz`。模块级 `graphvizChecked` 只保证**每进程一次**，
而每个 worker 线程会重新 require → HTTP 服务下每个作业都可能再打一次。
**建议**：平台分支（Windows 提示"安装 Graphviz 或改用 Smetana/TeaVM 引擎"），
并把提示降到 `debug` 级或只在 CLI 交互 TTY 下输出。

---

# 四、专项回答

## Q1. 方案 §3 之外还有哪些 Windows 失败点？

按文件汇总（已在上文展开，此处给索引）：

| # | 文件:行 | 问题 | 级别 | 证据类型 |
|---|---|---|---|---|
| 1 | `plantuml-renderer.js:344-428` | 陈旧 PNG 复用 → 嵌入错图 | 高 | 本机实测 |
| 2 | `preprocess.js:601`、`md2docx.js:1286` | BOM 未剥 → 重复 key 崩溃/去重失效 | 高 | 本机实测 |
| 3 | `config.js:24` + `job-store.js:76-96` | dataDir 相对 CWD + 启动删目录 | 高 | 静态 |
| 4 | `config.js:21`、`app.js:111` | `0.0.0.0` + 无鉴权 + 无端口回退 | 高 | 静态 |
| 5 | `md2docx.js:329` | tmpDir 泄漏 | 中 | 静态 |
| 6 | `md2docx.js:469-478` | 含空格图片引用被丢弃 | 中 | 本机实测 |
| 7 | `plantuml-renderer.js:292-302` | JAVA_HOME 探测无 `.exe` | 中 | 静态 |
| 8 | `exec-util.js:137-140` | jar 首启 `.part` 竞态 | 中 | 静态 |
| 9 | `convert.js:12-19` | 中文上传名 mojibake | 中 | 本机实测 |
| 10 | `md2docx.js:686` vs `:331` | `srcDir` 死参数 | 低 | 静态 |
| 11 | `plantuml-renderer.js:23-31` | apt 提示误导 | 低 | 静态 |
| 12 | `preprocess.js:52` | ANSI/GBK 控制台 | 低 | 本机实测+需 Windows |
| 13 | `puppeteer-config.js:42` | 死分支（puppeteer 缓存路径在 Windows 也是 `~/.cache/puppeteer`） | 低 | 本机实测 |
| 14 | `dependency-check.js:14` | 残留 shell 拼串 | 低 | 静态 |

方案 §3 已列的点里，**第 1、4、5 条方向正确且已在代码落地**；第 2 条部分落地（`exec-util` 已建，
mmdc/plantuml 已改，`dependency-check.js` 与 python 回退未改）；**第 3 条方向错误**（见 M2）；
**第 6、7、8 条未实施**。方案 §6 的第 2、3、6 步未实施；仓库中**尚无** `server/desktop.js`、
无 electron-builder 配置。

## Q2. 去依赖三条结论是否成立？

**(a) 原生 `native-plantuml-windows-amd64` 替代 `java -jar`：部分成立，但有硬缺陷。**
- ✅ GraalVM 原生镜像确实存在（v1.2026.8，48.3MB zip）。
- ✅ `!theme`/`skinparam defaultFontName`/`-tpng -o` 是 PlantUML 语言/CLI 层功能，
  原生镜像与 jar 同源码同 CLI（官方 `BUILDING.md` 明确 "a GraalVM native binary of **the same code** as
  `plantuml.jar` (headless CLI)"），**语法层面应当都支持**；`-o` 输出目录行为我已在 jar 版实测（绝对路径可用）。
- ⚠️ **不能只解压 exe**：必须整包（10 个 DLL）且需 VC++ redist（H2）。**[需 Windows 实测]**
- ⚠️ **中文字体是方案自评的最高风险，判断正确**。GraalVM 原生镜像**绕过了 JVM 的 fontconfig 链路**，
  改用打包的 `fontmanager.dll`/`freetype.dll`/`awt.dll` 直接读系统字体。理论上能读
  `C:\Windows\Fonts`（Windows 字体注册表），但**是否覆盖 `.ttc` 集合字体（msyh.ttc/simsun.ttc）
  与 "Microsoft YaHei"/"SimSun" 名称映射，必须实测**——这是最可能出方块的点。**[需 Windows 实测]**
- **缓解（按优先级）**：
  1. **改用 `@plantuml/core`（H6）**：字体走 Chromium 的字体栈，与 mermaid 同一套渲染基础，
     方案的最高风险直接消失——这是最优缓解。
  2. 保留原生 exe 时：`injectChineseFont` 的 `skinparam defaultFontName` 传**字体文件名对应的确切实名**
     （如 `Microsoft YaHei`）并**逐张目检 23 图**；再加一条"中文像素级校验"（对渲染结果做
     OCR 或与 jar 版做图像 diff）作为自动化门禁。
  3. 兜底：打包 `jlink` 精简 JRE + jar（方案已提，约 50MB）——但这条等于放弃"去 Java"，
     且与 Docker 路线的镜像复用性更好，可接受。

**(b) 用 PlantUML 内置 Smetana 去掉 graphviz：可行但适用范围与保真度都有折扣。**
- ✅ 内置、无需外部进程，`!pragma layout smetana` 与 `-Playout=smetana` 均可用（我都实测过）。
- ⚠️ **只影响需要 dot 布局的图**（usecase/class/object/component/deployment/state/legacy activity）；
  sequence/activity-beta **本来就不需要 graphviz**，所以"去 graphviz"对它们没有收益也不构成风险。
- ⚠️ **渲染不出的图类型**：我实测 13 类均出图。真正的风险不是"渲染不了"而是
  **版式差异**（dot vs smetana 字节不同）与**复杂带标签箭头图的效果**（官方对同类 vizjs 方案自述
  "for complex diagrams (especially with labels on arrow), the solution is not working very well"；
  Smetana 文档亦称该 Java 移植 "not finished yet"）。
  **应重点关注**：带边标签的 class/component 图、C4 风格图（社区有 smetana 与 C4 库不兼容的 issue）、
  以及 `skinparam linetype ortho`（我实测 smetana 与 dot 产物不同）。
- ⚠️ **横置判定连带风险**（H7 第 3 点）：必须在 PoC 中重跑 section 序列。
- **建议**：用 `-Playout=smetana`（不改源文件、无行号偏移），并把"23/23 版式人工比对 + 横置判定无变化"
  作为硬门禁；若采用 `@plantuml/core`，则用真正的 WASM dot，无需在保真度上妥协。

**(c) 用 `adm-zip` 替代 python-docx：不需要，且方向错。**
- ❌ `adm-zip` 路线**不必要**：`docx@9.7.0` 原生输出 `cantSplit`/`keepNext`/`keepLines`（M2，已实测）。
- ✅ 若真要走 zip 手术，可行性上"能注入"没问题，但有三个 XML 结构坑：
  ① `w:pPr` 内元素**有 schema 顺序要求**（`pStyle → keepNext → keepLines → …`），
  盲插到末尾可能被 Word 判定为无效文档；
  ② `w:trPr` 同理（`cantSplit` 位置）；
  ③ 必须保留 `[Content_Types].xml` 与 `word/_rels` 不动，且不能改 `w:pStyle w:val="Caption"`
  （样式引用本身不用动，只要 `styles.xml` 里已有 Caption 定义）。
- **行为等价性风险**：python-docx 的 `doc.paragraphs` **只遍历 body 顶层段落**，
  **不进入表格单元格内的段落**——现有 python 实现的三条规则里，第 2 条（Caption）
  只覆盖正文层题注，而表内题注不会被加 `keepNext`。若用 XML 全局查找实现，
  反而会**比现状多注入**（行为变了）。这是"等价性"最容易翻车的地方，必须逐项比对
  （仓库已有 `scripts/compare-pagination.js`，方案应引用它的结论：0 差异）。

## Q3. Electron vs 便携 Node 选型是否合理？

**结论：选型理由不成立，建议改推形态 B。** 详见 H9。要点复述：
- "复用 Electron 的 Chromium 给 mmdc"在 mmdc 既有启动路径（`headless:'shell'` → `--headless` +
  `executablePath` 指向 Electron 本体）下不可行；要真复用必须弃用 mmdc 改为隐藏窗口直渲（重写）。
- 体积：Electron ~250MB + 原生 exe 122MB ≈ **380MB+**，而形态 B（便携 Node ~50MB + 系统 Edge 0）≈ **60–150MB**。
- 启动方式/托盘/自启/单实例/端口冲突：形态 B 各需几十行，**不是**选 Electron 的充分理由；
  且 Electron 引入 asar/`asarUnpack`/`runAsNode` fuse 三个新的失败面（H9 第 3 点）。
- 若坚持 Electron：把 `runAsNode` fuse **保持开启**写入配置（否则 `exec-util` 的子进程全失效），
  并把 `plantuml.exe` 与 `chrome-headless-shell` 加入 `asarUnpack`。
- 更值得考虑的第三条：**便携 Node + 系统 Edge + `@plantuml/core`**，
  此时连 `chrome-headless-shell` 都不必打包（Edge 已在，且 PlantUML 与 mermaid 共用它），
  安装包可压到 ~60MB。

## Q4. 安全与运维

- **`127.0.0.1` 的取舍**：✅ 应为默认。它同时解决"防火墙弹窗"与"无鉴权暴露"。
  若提供局域网模式，**必须**承认"无鉴权"并在 UI/日志明示；建议加随机 token（H5）。
  另：`trust proxy: true` + `X-Forwarded-For` 可伪造 `req.ip`，使限流形同虚设——本机场景应设 `false`。
- **作业目录位置**：❌ 现状是 CWD 相对（H4）。
  建议 `%LOCALAPPDATA%\md2docx\jobs`（免管理员、天然按用户隔离）。
  若要多用户共享，用 `%PROGRAMDATA%\md2docx` 并由安装器设 ACL（否则**任何用户可读他人上传的文档**）。
  注意现有 `cleanupOrphans` 会**删除**该目录下所有非 store 目录——放到 ProgramData 时这个行为更危险。
  作业 TTL 默认 60 分钟，但**服务退出后内存 store 丢失**，重启即删掉所有历史作业 → 用户"刚转换完、
  重启后想再下载"会失败。方案未提持久化，建议至少保留最近 N 小时产物或在 UI 提示"产物仅本次运行有效"。
- **多用户**：单用户（AppData）方案最省事，推荐；多用户需处理端口冲突（每用户一个端口/端口写回配置）。
- **卸载残留**：§7 有"卸载干净"，但未定义清理范围。建议明确列出：
  `%LOCALAPPDATA%\md2docx`（作业与配置）、运行时下载的 `bin/plantuml.jar`、开机自启项（Run 键/计划任务）、
  开始菜单与桌面快捷方式、日志文件；卸载器需能选择"保留/删除用户数据"。
- **杀软误报**：⚠️ 未签名 NSIS + 121MB 原生 exe + 首次运行联网下载 jar + 启动本地 HTTP 服务，
  是启发式引擎的典型目标。方案把代码签名列为"(可选)"——**对"企业目标机一键安装"应升为 P1**
  （EV 证书可缓解 SmartScreen）。
- **离线安装**：⚠️ 方案 §7 有"离线安装可用"，但§6 未落实：
  ① 安装包必须**自带** jar 或原生 exe（否则首启联网）；
  ② `puppeteer` 的 postinstall 会下载 Chromium——构建时必须 `PUPPETEER_SKIP_DOWNLOAD=true` 并显式决定是否内置；
  ③ 若走形态 B，**绝不能**在运行时 `npm install`（`md2docx.sh` 现在就是这么做的，在离线机上必失败）；
  ④ 原生 exe 的 VC++ redist 必须随包（H2）。

## Q5. 验证门（§7）是否够？

**不够。** §7 覆盖了"happy path + 中文 + 空格路径 + 卸载 + 离线"，
但**没有一项覆盖本次发现的静默错误与 Windows 特有失败**。必须补的见 M8（13 条），
其中最关键的 3 条：
1. **陈旧 PNG 复用回归**（唯一会静默产出错误文档的缺陷，H3）；
2. **BOM/记事本文件**（H8，真实用户文件形态）；
3. **原生 exe 在无 VC++ redist 的干净镜像上的首次渲染**（H2）。

另外建议把"**依赖缺失时的降级路径也给用户可读结论**"列为验证项：
现在渲染失败只 warn，图变代码块，非技术用户会以为"转换成功但图没了"。§7 应要求
**前端/日志明确列出"第 N 张图渲染失败及原因"**（`hooks.onLog` 已有链路，需确认 UI 展示）。

## Q6. §8 "代码改动对两条路线都是净收益"是否成立？

**部分成立，需收窄表述。**

| 改动 | Docker 路线是否净收益 | 说明 |
|---|---|---|
| 跨平台命令层 `exec-util`（参数数组、`node cli.js` 而非 `.bin/mmdc`） | ✅ 是 | 修掉真实 bug（含空格路径静默降级），两路都受益 |
| 分页改 docx 原生（去 python-docx） | ✅ 是 | 镜像少一套运行时，且已实测 0 差异 |
| 去 Java（用原生 exe 或 TeaVM） | ⚠️ 视实现 | 若用 `@plantuml/core`（纯 JS），**两路都受益且镜像显著变小**；若用 Windows 原生 exe，Docker 反而要加 windows 专属产物，**不是**净收益 |
| 去 graphviz（Smetana） | ❌ 不是 | Docker 里 `apt install graphviz` 几乎零成本，且版式保真度更好；为 Windows 体积而牺牲保真度，对 Docker 是**净损失**（除非同样改用 WASM dot） |
| Windows CLI 入口 | ❌ 不是 | Docker 继续用 `md2docx.sh` 更省事；不必为 Docker 改 |
| `host/port/dataDir` 调整 | ✅ 是 | 这些本就由环境变量驱动（`PORT`/`HOST`/`DATA_DIR`），改成"有合理默认"对两路都好 |
| 字体探测平台分支 | ✅ 是 | 抽成"候选字体列表 + 存在性检查"，两路更清晰 |

**建议改写 §8 为**：
> 跨平台命令层、分页去 python-docx、host/port/dataDir 默认值、字体探测这四项对两条路线都是净收益；
> 去 Java/graphviz 只在 Windows 路线是**收益**、在 Docker 路线是**有代价的取舍**
> （保真度 vs 体积）。若采用 `@plantuml/core`（TeaVM + WASM Graphviz），
> 则"去 Java + 去 graphviz"**同时**成为两条路线的净收益，建议以此为目标。

另需注意：§8 说"两条路线不冲突，按目标机能力择一"，但 `puppeteer-config.js` 的
`--no-sandbox`、`md2docx.sh` 的 tty 交互等是为 Docker 加的；Windows 化改动**不要顺手删掉**
Docker 依赖（例如别把 `.sh` 删了、别把 `--no-sandbox` 无条件去掉）。

---

# 五、优先级表

## P0 — 阻断正确性，实施前必须解决

| # | 项 | 位置 | 动作 |
|---|---|---|---|
| P0-1 | 陈旧 PNG 复用 → 静默嵌入错图 | `plantuml-renderer.js:344-428` | 渲染前 `rmSync(outFile)` 或每次运行独立 tmpDir；加跨文档回归用例 |
| P0-2 | 原生 exe 不是单文件 + 缺 VC++ redist | 方案 §6.1/§2；`plantuml-renderer.js:50-56` | 整包解压 + 检测/安装 VC++ redist；或改用 `@plantuml/core`（推荐） |
| P0-3 | dataDir 相对 CWD + 启动删目录 | `config.js:24`、`job-store.js:76-96` | 平台默认目录（`%LOCALAPPDATA%`）+ 清扫护栏（只删 jobId 形态） |
| P0-4 | `0.0.0.0` + 无鉴权 + 无端口回退 | `config.js:21`、`app.js:111` | 默认 `127.0.0.1`；`listen` error + 端口探测；单实例锁；局域网模式明示无鉴权 |
| P0-5 | BOM 未剥离 → 记事本文件转换失败 | `preprocess.js:601`、`md2docx.js:1286` | 读入后剥 `^\uFEFF` |
| P0-6 | `channel:'msedge'` 事实错误 | 方案 §2/§4 | 改为 `executablePath`（代码已实现，标注已实现即可） |
| P0-7 | Smetana 版式差异与横置判定风险 | 方案 §2/§5/§6.3；`plantuml-renderer.js:309-338` | 改 `-Playout=smetana`；23 图逐张比对 + section 序列回归；或改用 WASM dot |

## P1 — 影响可用性/交付质量，应在首个 Windows 版本前完成

| # | 项 | 位置 |
|---|---|---|
| P1-1 | Electron 选型改为形态 B（或明确 mmdc 弃用 + asar/fuse 约束） | 方案 §2/§4 |
| P1-2 | `@plantuml/core` PoC（一次性消掉 Java/graphviz/原生 exe/字体四风险） | 方案 §2 新增 D 方案 |
| P1-3 | 中文上传文件名 mojibake | `convert.js:12-19`、`conversion-service.js:47` |
| P1-4 | `tmpDir` 从不清理 | `md2docx.js:329` |
| P1-5 | 含空格/含 `)` 的图片引用被丢弃 | `md2docx.js:469-478`、`pipeline.js:40` |
| P1-6 | §3 补列 dependency-check/health/config/app 四个文件 | 方案 §3/§7 |
| P1-7 | §3.3 改为 docx 原生分页（删 adm-zip 方案） | 方案 §3.3/§6.2 |
| P1-8 | 代码签名（SmartScreen/杀软） | 方案 §5 |
| P1-9 | 离线自包含（jar/exe/Chromium/VC++，禁止运行时 npm install） | 方案 §5/§6/§7 |
| P1-10 | §7 补 13 条验证门（尤其陈旧 PNG、BOM、VC++、端口、双实例） | 方案 §7 |
| P1-11 | jar 首启并发 `.part` 竞态 | `exec-util.js:137-140` |
| P1-12 | `§8` 表述收窄（区分净收益与有代价取舍） | 方案 §8 |

## P2 — 体验/整洁度，可迭代

| # | 项 | 位置 |
|---|---|---|
| P2-1 | Windows 控制台 ANSI/GBK 乱码 | `preprocess.js:52` 等 |
| P2-2 | `JAVA_HOME` 探测无 `.exe`、探测名与执行名不一致 | `plantuml-renderer.js:44/287/292-302` |
| P2-3 | `checkGraphviz` 的 apt 提示 + 每进程重复告警 | `plantuml-renderer.js:23-31` |
| P2-4 | `puppeteer-config.js:42` 死分支 | 同上 |
| P2-5 | 残留 shell 拼串与无用 import/依赖 | `dependency-check.js:14`、`preprocess.js:23`、`adm-zip` |
| P2-6 | 死参数 `srcDir` / 死变量 `alt` | `md2docx.js:331/680`、`:473/683` |
| P2-7 | Windows 保留文件名（con/nul/aux/com1…）与文件锁 `EBUSY` | 方案 §5 |
| P2-8 | `--no-sandbox` 在 Windows 无必要 | `puppeteer-config.js:83` |
| P2-9 | 多用户/ProgramData ACL、卸载清理范围、作业产物持久化策略 | 方案 §5 |

---

# 六、结论

**修改后通过。**

方案的问题意识与三个"去依赖"方向值得肯定：现有代码确实存在字符串拼命令、
python-docx 耦合、无中文平台分支等真实缺陷，方案把这些点识别出来是正确的；
§3 的第 1/4/5 条已经落地且实现质量不错（`exec-util` 的参数数组 + `process.execPath` +
`ELECTRON_RUN_AS_NODE` 处理到位）。

但方案**不足以直接实施**，原因集中在三类：

1. **事实性错误 3 处**：`channel:'msedge'` 在 puppeteer 24 不存在；
   原生 exe 不是单文件且缺 VC++ redist；Smetana 的"23/23 全通过"不等于版式等价，
   且会连带影响横置判定。
2. **遗漏高危点**：最严重的是**缓存目录陈旧 PNG 复用导致静默嵌入上一份文档的图**——
   我已在本机完整复现（跨文档污染），它不崩溃、不告警，直接产出内容错误的正式文档；
   其次是 BOM 文件转换失败、`dataDir` 相对 CWD + 启动删目录、默认 `0.0.0.0` + 无鉴权。
3. **选型理由不成立**：Electron 的"复用 Chromium 给 mermaid"在 mmdc 的启动路径下不可行，
   建议改推形态 B；同时方案完全没评估官方的 `@plantuml/core`（TeaVM + WASM Graphviz），
   而它是能一次性消掉方案自评"最高风险"（原生镜像中文字体）的路线。

**建议的处理顺序**：
1. 先做 `@plantuml/core` 与"系统 Edge 驱动 mermaid"的最小 PoC（两者都不改架构，只验证渲染保真度/中文）；
2. 同时修 P0-1/P0-3/P0-4/P0-5 这四个与选型无关的确定性缺陷；
3. PoC 通过后重写 §2/§3/§4/§7，把 Electron 与原生 exe 从"推荐"降为"备选"；
4. 按 P1 补齐验证门后再进 Windows 实测。

---

## 附：本次评审的实测证据索引

| 结论 | 复现命令/方法 | 观察 |
|---|---|---|
| 陈旧 PNG 复用（H3） | 同目录先转 `docA.md`（正常）再转 `docB.md`（无 `@startuml`） | `p_1.png` sha 不变；`docB.clean.md` 引用 `docB_puml1.png`，内容 = docA 的图 |
| PlantUML exit 0 无输出（H3） | `java -jar plantuml.jar -tpng -o . p_1.puml`（文件无 `@startuml`） | `exit=0`，无 png，stderr `No diagram found` |
| BOM 崩溃（H8） | 构造 `EF BB BF` + CRLF + 重复 `title`，跑 `preprocess.js` | `错误: duplicated mapping key at line 3` |
| BOM 使去重失效（H8） | 同上，检查 `^---\n` 正则 | 不匹配 → 去重被跳过 |
| docx 原生分页（M2） | `new TableRow({cantSplit:true})`、`Paragraph({keepNext,keepLines})` → 解包 XML | `<w:cantSplit/>`×2，`<w:keepNext/>`、`<w:keepLines/>` 均在 |
| `msedge` channel 不存在（H1） | 读 `LaunchOptions.js:10-21`、`ChromeLauncher.js:206-216` | 仅 chrome/chrome-beta/chrome-dev/chrome-canary |
| 原生 zip 内容（H2） | 下载 `native-plantuml-windows-amd64-1.2026.8.zip` 并 `unzip -l` | `plantuml.exe` 121.8MB + 10 个 DLL |
| Smetana 可用但版式不同（H7） | dot vs `-Playout=smetana` 渲染同图后 `cmp` | 均出图，字节不同（11091B vs 9555B 等） |
| Smetana 覆盖 13 类图（H7） | 13 类语法逐类渲染 | 全部出图 |
| `@plantuml/core` 可行（H6） | Node 中 import + 无头 Chromium `renderToString` | SVG 含中文；未触发 Smetana 回退；119–458ms |
| puppeteer 缓存路径（L3） | 读 `Configuration.d.ts` 的 `@defaultValue` | `<homedir>/.cache/puppeteer`（全平台） |
| Windows 缓存布局（L3） | 读 `@puppeteer/browsers/.../chrome-headless-shell.js` | `chrome-headless-shell-win64/chrome-headless-shell.exe` |
| multer 中文名（M3） | 真实 multipart 请求上传 `测试文档.md` | `originalname = "æµè¯ææ¡£.md"` |
| 含空格图片引用（M5） | markdown-it 解析 `![](../a b.png)` | 无 image token（`<>` 包裹才正常） |
| `dataDir` 随 CWD（H4） | 从不同 cwd require `config.js` | `/tmp/data` vs `<project>/data` |
| `node -e` argv（排除误报） | `node -e CODE url dest` | `argv=[execPath,url,dest]`，`slice(1)` 正确 |
