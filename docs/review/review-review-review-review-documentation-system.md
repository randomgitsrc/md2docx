# 评审（第四轮）：文档体系方案 v4

## 评审日期
2026-09-17

## 评审范围

**文档**

- `docs/plans/documentation-system.md`（v4，648 行，逐行核对，含 `## 0. 修订记录` 的 v4 段）
- `docs/review/review-documentation-system.md`（第一轮，462 行）
- `docs/review/review-review-documentation-system.md`（第二轮，291 行）
- `docs/review/review-review-review-documentation-system.md`（第三轮，266 行）

**代码（逐条打开核对，非仅阅读）**

- `server/config.js`、`server/app.js`、`server/services/dependency-check.js`、`server/lib/logger.js`
- `scripts/md2docx.js`、`scripts/cli.js`、`scripts/plantuml-renderer.js`、`scripts/puppeteer-config.js`
- `scripts/build-windows-bundle.js`、`scripts/self-check.js`、`scripts/e2e-web.js`、`scripts/exec-util.js`
- `package.json`、`.github/workflows/release-windows.yml`

**实际执行的命令（证据）**

1. 全仓扫描 `process\.env\.[A-Za-z_]\w*`（30 命中）+ 补充扫描 `process\.env` 的非 `.<NAME>` 形式
   （确认无 `process.env['X']`、无裸 `process.env` 读取；`{...process.env}` 展开不计）。
2. **机械模拟 v4 §6.2 守卫**（按方案 `:294-300` 字面实现：取标记所在行 → 先剔 `@docfact…=…` → 按 `|`/`,` 切
   token → 数字词边界 / 其他须带引号），对 v4 `:303-331` 列出的**全部**事实逐条跑；并做反向探针。
3. 提取方案内**全部** `file:line` 引用并逐条打开核对。
4. `git status --porcelain`、`git ls-files .github`、`Test-Path`（README/CHANGELOG/index/glossary/manifest/
   linux-install/RELEASE-INFO）。
5. `node --version` → `v24.20.0`（本机 node 不在 PATH，用 `D:\home\apps\DeepSeekHarness\node\node.exe`）。
6. 临时模拟脚本写在系统临时目录并在评审后删除；未执行 `require('./server/config')`，
   `Test-Path data` = `False`；`git status` 与评审前一致（仅本评审文件为新增）。

## 三条放行条件的处置核对

| 条件 | 是否到位 | 证据 |
|---|---|---|
| 1. 多值 `@docfact` 同行落点 + §12 自证 | **到位** | §6.2 `:289-290` 硬性"标记必须与真实常量同一行、只断言标记所在行"；`:311-331` 三处多值示例全部改为**行尾注释**；**机械模拟 9/9 全部 PASS**（见下表）；反向探针 `default_queue_limit=5` vs `50`、`default_port=808` vs `8080`、代码改 `output/docxs` **全部被拒**；§12.1 `:632` 已补"把 `OUT_DIRS.docx` 改成 `output/docxs` 必须失败" |
| 2. claim 锚点归属完整、不自相矛盾 | **基本到位（1 处残留）** | §6.2 `:345` 改为**规则化**归属：`default_*` 与 `backend_values` → `reference/configuration.md`，`default_max_concurrent` 天然被 `default_*` 通配覆盖；`:346` 检查项 3 定死"**生成文件参与锚点，其锚点由生成器产出，无需人工维护**"，v3 的 `:353/:354` 自相矛盾已消除；`manifest.factOwners`（`:408-414`）与之一致。**残留**：C7 宣布 `engines` 为 Tier A 事实，但 `factOwners` 无对应规则/条目（见新问题 4） |
| 3. 生成契约映射齐全 | **基本到位（残留见新问题 8）** | §6.2 `:355-356` 写明 `<key> = 环境变量名小写`（`PORT→default_port`、`MAX_FILE_SIZE_MB→default_max_file_size_mb`）；`:367` 补 `default_plantuml_backend=auto`；`:370-371` 逐一登记 `NO_OPEN_BROWSER`/`MD2DOCX_OPEN_BROWSER`/`ENABLE_PAGINATION_PATCH`。实扫白名单 5 文件：**22 个变量与表格 20 行 + 黑名单 2 项完全对得上**（详见下文） |

### 守卫机械模拟（v4 §6.2 示例逐字）

| 事实 | 所在行（剔标记后剩余文本） | 结果 |
|---|---|---|
| `default_port=8080` | `port: num(process.env.PORT, 8080), //` | **PASS** |
| `default_host=127.0.0.1` | `host: process.env.HOST \|\| '127.0.0.1', //` | **PASS** |
| `default_max_concurrent=2` | `maxConcurrent: num(process.env.MAX_CONCURRENT, 2), //` | **PASS** |
| `default_queue_limit=50` | `queueLimit: num(process.env.QUEUE_LIMIT, 50), //` | **PASS** |
| `clean_dir=output/clean` | `const OUT_DIRS = { clean: 'output/clean', … }; //` | **PASS** |
| `docx_dir=output/docx` | 同上 | **PASS** |
| `backend_values=core\|jar\|auto` | `const BACKEND_VALUES = ['core', 'jar', 'auto']; //` | **PASS** |
| `default_plantuml_backend=auto` | `const raw = (process.env.PLANTUML_BACKEND \|\| 'auto')…; //` | **PASS** |
| `entry_cmds=启动 md2docx.cmd,转换文档.cmd,自检.cmd` | `const ENTRY_CMDS = ['启动 md2docx.cmd', …]; //` | **PASS** |
| **反向** `default_queue_limit=5` vs `…, 50)` | token `5` 后紧邻 `0` | **拒绝（FAIL）✓** |
| **反向** `default_port=808` vs `8080` | token `808` 后紧邻 `0` | **拒绝（FAIL）✓** |
| **反向** 代码改 `output/docxs` | 无 `'output/docx'` | **拒绝（FAIL）✓** |
| **反向** `clean_dir`/`docx_dir` 键值互换 | 两 token 仍在同一常量行 | PASS＝**已知盲区，§10 `:594` 已如实登记** |

**结论**：第三轮问题 1（守卫恒假）与问题 4（子串过弱）**均已实质修复**；同行硬规则可满足；
反向探针证明数字词边界生效。唯一保留的盲区（同行键值互换）方案自己已声明、且被 claim 锚点
（文档锚点值 vs 扫描事实值）二次兜底，不构成阻断。

### `configuration.md` 契约枚举核对（实扫，非阅读）

白名单 5 文件（§6.2 `:353`）实际 `process.env` 共 **22 个变量**：

- `server/config.js`：`DATA_DIR`(39)、`LOCALAPPDATA`(41,42)、`PORT`(77)、`HOST`(80)、`MAX_CONCURRENT`(89)、
  `QUEUE_LIMIT`(90)、`MAX_FILE_SIZE_MB`(93)、`MAX_DIAGRAMS`(94)、`JOB_TTL_MINUTES`(97)、
  `CLEANUP_INTERVAL_MINUTES`(98)、`GRACEFUL_TIMEOUT_MS`(99)、`RATE_LIMIT_PER_MINUTE`(102)、
  `HEALTH_CACHE_TTL_MS`(105)、`JOB_TIMEOUT_MS`(108)、`DEBUG`(111)
- `scripts/plantuml-renderer.js`：`WINDIR`(249)、`JAVA_HOME`(342)、`PLANTUML_BACKEND`(395)
- `scripts/puppeteer-config.js`：`PUPPETEER_EXECUTABLE_PATH`(69)
- `server/app.js`：`NO_OPEN_BROWSER`、`MD2DOCX_OPEN_BROWSER`(151)
- `scripts/md2docx.js`：`ENABLE_PAGINATION_PATCH`(1563)

方案 `:365-372` 表格：进表 20 + 黑名单 2（`LOCALAPPDATA`/`WINDIR`）= 22，**无遗漏、无误纳**；
黑名单其余项（`SystemRoot`/`NSIS*`/`NODE_ENV`/`CDP_URL`/`PUPPETEER_SKIP_DOWNLOAD`）虽不在白名单文件，
冗余但无害。**该条件成立。**

## 三项新要求的核对

| 要求 | 是否到位 | 证据 |
|---|---|---|
| **可扩展 / 不写死** | **部分到位** | manifest 为**结构单一源**：`docs[].type/audience/platforms/inBundle` 派生导航/包内子集/链接检查/锚点归属（§6.3 `:431-440`），新增一篇文档确实只需 manifest + 建文件。但仍有硬编码：① 环境变量扫描白名单是**写死的 5 文件**（`:353`）；② 生成器的 `from` 种类只有 3 个写死字符串（`:415-419`）；③ 新增平台要改 **3 处**（manifest `platforms` + `supported-platforms.md` + Tier B，`:455`）。`factOwners` 在 §6.2 散文（`:345`）与 manifest（`:408-414`）**重复登记**，是潜在漂移面 |
| **程序更新后方便同步** | **部分到位** | 事实级链条自洽：代码行 ↔ `@docfact` 标记（守卫）↔ claim 锚点（文档值）↔ 生成物（逐字节）。但 `syncMap`（`:420-426`）**只列 5 个 source**，遗漏 `scripts/plantuml-renderer.js`（主题注入语义 → `how-to/use-diagrams.md`）、`scripts/md2docx.js`（题注/横置语义 → `write-captions.md`/`landscape-and-pagination.md`）、`server/app.js`（路由/UI → `reference/web-ui.md`）、`scripts/md2docx.sh`、`scripts/puppeteer-config.js`。这些文件改了且只改语义（非事实）时，**三级机制全都不响** → 存在假阴性，与 §2 目标 4"不依赖人记得"不完全相符。`docs:status` 的"代码已变"缺基线定义（相对上次发布 tag？相对上次动文档？） |
| **版本管理** | **部分到位** | `verifyVersion` 规则 ①②可实现（解析 `## [x.y.z]`）；但**规则 ③"新版本号必须严格大于 CHANGELOG 中最近一个已发布版本"在每次发布时都不成立**（见新问题 2）。安装器文件名确实取版本（`build-windows-bundle.js:818-819` `md2docx-Setup-${appVer}-win-x64.exe`），但 **zip 名与版本无关**（`:37` `BUNDLE_NAME='md2docx-win-x64'`、`:380`），与 §6.5 `:474`"安装器与 zip 命名沿用该版本"**不符**；`RELEASE-INFO.txt`（`:393-407`）只有 `代码版本`（git 短 hash）与 SHA256，**不含 SemVer**，与 §6.5 `:479`"含版本、commit、SHA256"不符 |

## 总体结论

v4 对第三轮 3 条放行条件的处置**实质到位**：最关键的多值 `@docfact` 落点已改为同行尾注，守卫经本机
机械模拟对 9 条事实**全部 PASS**、对 3 条反向探针**全部正确拒绝**，第三轮"照字面写会卡住 P0 第 1 步"
的硬伤已消除；claim 锚点归属规则化、生成文件参与锚点且由生成器产锚，自相矛盾已收敛；生成契约的
`<key>` 映射、`default_plantuml_backend`、三个开关全部补齐，实扫 22 个变量对得上。

但 v4 新增的 manifest / syncMap / verifyVersion 三项机制在**落点细节**上仍有 4 处"照字面写会卡住或
留下空洞"：最硬的是 **Tier A 的 `@docfact` 扫描白名单从未定义**——方案唯一定义的"白名单"是
`configuration.md` 那 5 个环境变量文件，而它**恰好不含** `scripts/cli.js` 与
`scripts/build-windows-bundle.js`，即 `clean_dir`/`docx_dir`/`entry_cmds` 三个（第三轮的全部焦点）
所在的文件；若照字面实现，这三个键**根本不会被扫描**，§12.1 的自证项"把 `OUT_DIRS.docx` 改成
`output/docxs` 必须失败"将**失败不了**，重演"删了标记就绕过"。此外 `verifyVersion` 规则 ③ 在首次运行
即不可满足、`document-format.md` 的提取源不足以产出方案宣称的内容、`engines` 作为 Tier A 事实无法
在 `package.json` 里打标记。

这些均属"文字/契约级"缺陷（改法明确、不改架构），但都落在用户本轮新增的三项要求上，故本轮结论为
**有条件通过**，下列 4 条须在 §9 P0 对应步骤动手前写回方案。

## 新发现的问题1：Tier A `@docfact` 的扫描白名单从未定义；按字面实现，`cli.js`/`build-windows-bundle.js` 里的多值事实不会被扫描 [严重]

**位置**：方案 §6.2 `:294`（"扫描白名单文件"）、`:348`（检查项 5"白名单文件中的已知事实若缺标记 → 失败"）、
`:353`（唯一定义的"白名单"）；`scripts/cli.js:50`、`scripts/build-windows-bundle.js:295/312/731`

方案在 Tier A 通用规则里只说"扫描白名单文件，收集 `@docfact key=value`"（`:294`），**未列白名单**；
全文唯一给出列表的"白名单"是 §6.2 生成契约里的 **`configuration.md` 5 文件**
（`:353`：`server/config.js`、`scripts/plantuml-renderer.js`、`scripts/puppeteer-config.js`、
`server/app.js`、`scripts/md2docx.js`）。而 v4 `:315/330` 把 `clean_dir`/`docx_dir` 的标记放在
`scripts/cli.js`、把 `entry_cmds` 的标记放在 `scripts/build-windows-bundle.js`——**两者都不在该白名单内**。

按字面实现，`verify:docs` 的检查项 5 只在 5 个环境变量文件里找已知事实，于是：

- `cli.js`/`build-windows-bundle.js` 里的 `@docfact` 标记**不会被收集、也不会被断言**；
- 从 `cli.js` 删掉 `OUT_DIRS` 常量或删掉标记，**不会失败**；

这同时使 §12.1 `:632` 的自证项"把 `OUT_DIRS.docx` 改成 `output/docxs` **必须失败**"无法成立——
这恰是第二轮问题 1 与"删了标记就绕过"要防的洞。注意：v4 自己的守卫模拟是**成立**的（本评审已证），
前提是扫描器真的读到了那两行；而白名单的定义让这个前提落空。

**影响**：§9 P0 第 1 步的核心验收；也是本轮"更新即同步"的事实级基石。

**建议（写回方案）**：在 §6.2 显式定义 Tier A 的 `factScanFiles` 白名单，至少
`server/config.js`、`server/app.js`、`scripts/md2docx.js`、`scripts/plantuml-renderer.js`、
`scripts/cli.js`、`scripts/build-windows-bundle.js`、`scripts/puppeteer-config.js`；
或明确声明"@docfact 扫描白名单 = 环境变量白名单 ∪ {cli.js, build-windows-bundle.js}"。
把它放进 `manifest.json`（如 `factScanFiles`）以契合"不写死"。

## 新发现的问题2：`verifyVersion` 规则 ③"严格大于最近一个已发布版本"在每次发布（含首次）都不成立 [中]

**位置**：方案 §6.5 `:476`

原文：

> ③ 新版本号必须严格大于 CHANGELOG 中最近一个已发布版本。

仓库现状（已核对）：`package.json:3` 为 `"version": "1.0.0"`；`CHANGELOG.md` **不存在**
（`Test-Path` = False，方案 §1.1 `:72` 亦承认）。C11 要新建 `CHANGELOG.md` 并接入闸门。

设闸门在构建/发布时读 CHANGELOG（此时新版本段已写入，否则规则 ① 不满足）：

- **首次**：CHANGELOG 需含 `## [1.0.0]` 才满足规则 ①，而 `package.json` = `1.0.0`。
  "最近一个已发布版本" = `1.0.0`，要求"严格大于 1.0.0"——**假**，闸门必红。
- **任一后续发布**：发布后在 CHANGELOG 追加 `## [1.1.0]` 并把版本改为 `1.1.0`；
  最近一个已发布版本又 = `1.1.0`，仍要求"严格大于 1.1.0"——**恒假**。

也就是说规则 ③ 的语义应比较"当前版本"与"**上一个**版本"（不含当前段），或写成"不得小于已有
最大版本且不得与已归档段重复"。按现状字面，`verifyVersion()` 无法在第一次构建通过。

**影响**：§9 P0 第 3 项（C11）"必须有能失败的证明"同时也要"构建自身成功一次"，字面实现过不了后者。

**建议**：改写规则 ③ 为"当前 `package.json` 版本必须 = CHANGELOG 的最新段版本，且严格大于
**次新**段版本"；首次引入时以 `## [1.0.0]` 为基线、无次新段即视为通过。并在 §12.1 补一条自证
（改成 CHANGELOG 里没有的号 → 失败；改回 → 通过）。

## 新发现的问题3：`document-format.md` 的提取源（SIZE/FONT/PAGE）不足以产出方案宣称的内容；`@docfact` 退化路径对样式行也不成立 [中]

**位置**：方案 §5.1 `:212`（"字体/字号/页边距/**表格**/**题注**"）、§6.3 `:444-446`（提取
`scripts/md2docx.js` 顶部 `SIZE`/`FONT`/`PAGE` 常量块，失败则退化 `@docfact`）；`scripts/md2docx.js:50-66`、`:75-123`

实际代码形状（已核对）：

- `SIZE`(`:50`)、`FONT`(`:52-59`)、`PAGE`(`:61-66`) 确为**顶层对象字面量**，
  "受控提取"对这三块**技术上可行**（`PAGE` 的值是 `cm(21)` 这类函数调用，需带一个 `cm` 求值器）。
- 但方案宣称的"表格/题注"样式**不在这三块里**：它们分散在 `documentStyles`（`:75-123`）的 11 个
  样式对象中（`Heading1`→`FONT.黑体`/`SIZE.小三`、`CoverTitle`→`FONT.方正小标宋`/`SIZE.小一`、
  `TableText`→`SIZE.五号`、`Caption`→`FONT.黑体`/`SIZE.小四`、`CodeBlock`→`FONT.等宽`），
  且引用形式是 **`FONT.黑体`/`SIZE.小四` 成员访问，不是字符串字面量**。
- 退化路径"`@docfact` 逐项标记"按 v4 守卫（`:297-299` 非数字 token 须以 `'token'`/`"token"` 出现）
  对这些样式行**会失败**——例如 `eastAsia: FONT.黑体` 行的剩余文本里没有 `'黑体'`。
  即 T9 的"两种都不手写表格"目前两条路都不通。

**影响**：`document-format.md` 是 §9 P0 第 8 项交付物。要么收窄其内容为"基础常量表"
（SIZE/FONT/PAGE 的字面值），要么扩展提取/守卫。当前描述会误导实现者。

**建议**：二选一并写清——(a) `document-format.md` 只报 `SIZE`/`FONT`/`PAGE` 基础常量，
样式对照留在 `01-base/技术规范`；(b) 让 `doc-gen.js` 受控提取 `documentStyles`（并对
`FONT.x`/`SIZE.y` 做符号解析），同时把 `@docfact` 守卫放宽为"允许 `FONT.值`/`SIZE.值` 形式"
或为样式行补上可断言的字符串字面量。方案 `:444` 的"提取失败即报错"不能替代"提取结果覆盖不到
宣称内容"这一缺口。

## 新发现的问题4：C7 宣布 `engines` 为 Tier A 事实，但 `package.json` 无法承载 `// @docfact`，`factOwners` 也无对应条目 [中]

**位置**：方案 §9.0 C7 `:555`、§6.3 `:455`、§6.2 `:345`/`:408-414`

`engines` 是 `package.json` 的字段，而 `package.json` 是**标准 JSON，不允许注释**，
`// @docfact engines=…` 写进去会导致 `JSON.parse`/`require` 失败；v4 的 Tier A 机制全部建立在
"常量行尾注释"上，无法覆盖它。同时 `manifest.factOwners`（`:408-414`）只有
`default_*`/`backend_values`/`clean_dir`/`docx_dir`/`entry_cmds`，**没有 `engines` 的规则或显式条目**，
而检查项 2 要求"每个 Tier A 键恰好一个锚点"。于是 C7 一旦实施，会立刻撞上"无标记、无归属"。

**影响**：C7 是 P0 第 1/8 项附近的低风险项，但按字面做不出来。

**建议**：二选一——(a) 不用 `@docfact` 机制，改为在 `manifest.json` 显式登记 `engines` 的值并说明
来源为 `package.json`（生成器/校验器直接读 JSON 字段）；(b) 在 `doc-facts.js` 里对 `package.json`
做**专用提取器**（读 `engines.node`），并在 `factOwners` 加 `engines` 条目。无论哪种，都要在
§6.2 写清"非 JS 文件的事实"如何进入 Tier A。

## 新发现的问题5：`syncMap` 源文件覆盖不全，"更新即同步"存在假阴性 [低]

**位置**：方案 §6.3 `:420-426`、§6.4 `:463-465`

`syncMap` 只列 `server/config.js`、`scripts/cli.js`、`scripts/build-windows-bundle.js`、
`scripts/preprocess.js`、`package.json`。但会改变用户文档语义、且不在事实级覆盖内的源至少还有：

- `scripts/plantuml-renderer.js`：`injectTheme()`(`:299-302`) 默认 `plain` 主题 → `how-to/use-diagrams.md`；
  改主题注入不会触发任何机制（`default_plantuml_backend` 只覆盖后端选择这个事实）。
- `scripts/md2docx.js`：题注/横置/分页规则 → `write-captions.md`/`landscape-and-pagination.md`。
- `server/app.js`：路由与前端行为 → `reference/web-ui.md`。
- `scripts/md2docx.sh`：CLI/引导行为 → `reference/cli.md`、`deployment/docker.md`。
- `scripts/puppeteer-config.js`：浏览器探测 → `reference/supported-platforms.md`。

这些文件的语义改动"CI 漂移检查"与"事实校验"**都抓不到**，与 §2 目标 4 的措辞不符。

**建议**：把上述文件补进 `syncMap`；或在 §6.4 如实标注"关联级只覆盖 manifest 登记的 source，
未登记文件仍靠人工"，避免把覆盖度说满。

## 新发现的问题6：§6.5 两处事实与代码不符（zip 命名、RELEASE-INFO 内容） [低]

**位置**：方案 §6.5 `:474`、`:479`；`scripts/build-windows-bundle.js:37/380/393-407/818-819`

- `:474` "安装器与 zip 命名沿用该版本"：**安装器成立**（`:818-819`
  `md2docx-Setup-${appVer}-win-x64.exe`），**zip 不成立**（`:37` `BUNDLE_NAME = 'md2docx-win-x64'`、
  `:380` `${BUNDLE_NAME}.zip`，与版本无关）。CI 上传名 `md2docx-win-x64`（`release-windows.yml:58`）亦然。
- `:479` "`dist/RELEASE-INFO.txt`（已有）含版本、commit、SHA256"：实际（`:393-407`）有
  `构建时间`、`代码版本`（= `stamp.git`，git 短 hash，`buildStamp():136-144`）、`SHA256`，
  **没有 `package.json` 的 SemVer**。

**建议**：改为"安装器命名沿用该版本；zip 名固定"；并把 RELEASE-INFO 的字段写准，或顺带把
SemVer 加入 RELEASE-INFO（更利于"发布物 ↔ 版本"对应）。

## 新发现的问题7：`docs/manifest.json` 示例含 `//` 注释，但文件名是 `.json` [低]

**位置**：方案 §6.3 `:396`（```jsonc）、`:404`（`// 新增文档 = …`）、`:192/:394`（文件名为 `manifest.json`）

方案给的清单示例是 JSONC（带注释），而落地文件名是 `docs/manifest.json`。若照抄注释，
`JSON.parse`/`require('./docs/manifest.json')` 会抛错，生成器/构建脚本/CI 三处都要额外处理。

**建议**：文件名改 `manifest.jsonc` 并统一用注释感知解析，或把示例里的 `//` 去掉（注释仅存于方案）。

## 新发现的问题8：`-nodefault` 事实的 claim 锚点处置未定义，且 `envNotes` 未枚举（生成会先红） [低]

**位置**：方案 §6.2 `:345`（每个 Tier A 键恰好一个锚点）、`:374`（说明列来源缺 `envNotes` 即失败）、`:427`（`envNotes` 示例仅 1 条）

- `DATA_DIR`/`JAVA_HOME`/`PUPPETEER_EXECUTABLE_PATH`/`NO_OPEN_BROWSER`/`MD2DOCX_OPEN_BROWSER`/
  `ENABLE_PAGINATION_PATCH` 都是"无默认"（`@docfact-nodefault`），它们没有可锚定的"值"。
  §6.2 的锚点规则未说明这些键是否参与 claim 锚点、以何值参与。
- 说明列的"优先取同行注释；无注释的由 `envNotes` 登记（缺失即失败）"：实扫发现
  `PORT`/`HOST`/`MAX_CONCURRENT`/`MAX_FILE_SIZE_MB`/`JOB_TTL_MINUTES`/`CLEANUP_INTERVAL_MINUTES`/
  `GRACEFUL_TIMEOUT_MS`/`HEALTH_CACHE_TTL_MS`/`JOB_TIMEOUT_MS`/`DEBUG`/`PUPPETEER_EXECUTABLE_PATH`/
  `PLANTUML_BACKEND` 等**多数没有同行注释**，而 `envNotes` 只登记了 `PUPPETEER_EXECUTABLE_PATH` 一条。
  按"缺失即失败"，`configuration.md` 首次生成必然失败，直到补全所有 `envNotes`。

**建议**：明确 `-nodefault` 键不参与 claim 锚点（或定义其锚点形式）；在方案里列出需要 `envNotes` 的
变量清单（或在 P0 步骤中显式作为一项产出），避免"写方案的人以为自动、实现者一跑就红"。

## 新发现的问题9：`docs:status` 的"代码已变"缺基线；发布 tag 与版本号无校验 [低]

**位置**：方案 §6.4 `:465`、§6.5 `:481`；`.github/workflows/release-windows.yml:20-22`、`:64`

- `docs:status` 要"列出代码已变、文档未更新"，但"已变"相对什么基线（上次发布 tag？上次动文档的
  commit？文件 mtime？）未定义，不同基线结论不同，实现者需临时决策。
- CI 在 `v*` tag 上发布（`release-windows.yml:20-22`），但 `verifyVersion` 只校验
  `package.json` ↔ `CHANGELOG`，**不校验 tag 名 == 版本号**；存在"打 v1.1.0 标签却发 1.0.0 包"的
  可能，与"版本可追溯"目标有缝。

**建议**：明确 `docs:status` 基线（建议上次 `v*` tag）；在发布工作流加一行
"`github.ref_name` 去掉 `v` 后必须等于 `package.json` version"。

## 残留问题

1. **`disabled`/`applicable` 的 `java`/`graphviz`**：§4.2 已按 `dependency-check.js:50-76/104-105`
   标注可选，无残留。
2. **macOS 字体分支**：§4.1 `:139-143` 与 `plantuml-renderer.js:246-295/275-288/289-294/307`
   逐行一致，无残留。
3. **T9（`document-format.md` 提取 vs 退化）** 仍未决，但本轮新问题 3 说明两条路都有问题，
   建议直接落定为"收窄内容"或"提取 `documentStyles`"。
4. **第二/三轮低优先残留**（§5.1 点名 v5、T2/T6）均已在本版处置，无新增。

## 达成的共识 / 值得保留

以下均经本机核对成立：

1. **第三轮 3 条放行条件的设计与落点均已修正**：同行标记（`:289-290/311-331`）、规则化归属
   与生成文件参与锚点（`:345-346`）、映射约定与三开关登记（`:355-371`）——**本轮机械模拟 9/9 PASS、
   3 条反向探针全部拒绝**，这是 v4 最实的进步。
2. **`configuration.md` 生成契约自洽**：实扫白名单 5 文件共 22 个变量，表格 20 + 黑名单 2 完全覆盖，
   无误纳（`JAVA_HOME`/`DEBUG` 未被误黑，`LOCALAPPDATA`/`WINDIR` 正确入黑）。
3. **v4 全部新引入/沿用的 `file:line` 经逐条打开核对正确**：`config.js:39/52-57/68-72/80/83`、
   `plantuml-renderer.js:71-83/246-295/250-257/275-288/289-294/307/395/517`、
   `server/app.js:151/154`、`md2docx.js:1410-1417/1432-1433/1563`、`cli.js:50`、
   `build-windows-bundle.js:136-144/295/312/376/470-493/474-476/623-639/645-667/661/687-724/731/851/853`、
   `self-check.js:5`、`preprocess.js:102-136`、`api.md:21-22/36-39`、
   `dependency-check.js:50-76/85/104-105`、`md2docx.sh:9-19/90-91`、`docker-deployment.md:91`。
4. **`scripts/md2docx.js` 顶部确有 `SIZE`/`FONT`/`PAGE` 顶层常量块**（`:50-66`），
   §6.3 对其"受控提取"的可行性判断成立（缺口仅在"表格/题注"内容不在块内，见新问题 3）。
5. **构建期版本注入有现成落点**：`buildStamp()`（`:136-144`）提供 commit/time，
   `package.json:3` 提供 version，`build-windows-bundle.js:818-819` 已在用 version 生成安装器名；
   且方案正确指出"改副本不改仓库"以避开 `assertCleanTree`（`:623-639`）。
6. **CI 落脚点真实**：`release-windows.yml:29` `runs-on: ubuntu-latest`、`:50` `npm run release:win`，
   `build-windows-bundle.js:376` 确在包内跑 `smokeTestBundle`；方案对 `.github/` 未跟踪的判断正确
   （`git ls-files .github` 为空、`git status` 显示 `?? .github/`）。
7. **已实测的 `doccheck` front matter 方案**（§6.6 `:500-501`）与 `md2docx.js:1432-1433` 一致，
   对转换无影响（第二轮已实测，本轮复核代码路径一致）。

## 优先级

| 优先级 | 问题 | 建议 |
|---|---|---|
| **P0（阻断）** | 新问题 1：Tier A `@docfact` 扫描白名单未定义，`cli.js`/`build-windows-bundle.js` 的多值事实不会被扫描，§12.1 自证失效 | 在 §6.2/manifest 显式定义 `factScanFiles`（含这两个文件）；补自证用例 |
| **P1** | 新问题 2：`verifyVersion` 规则 ③ 每次发布恒假 | 改为与"次新版本"比较；给出 1.0.0 首次基线；补自证 |
| **P1** | 新问题 3：`document-format.md` 提取源不足、退化路径对样式行不成立 | 收窄内容为 SIZE/FONT/PAGE 常量表，或扩展提取到 `documentStyles` 并调整守卫 |
| **P1** | 新问题 4：`engines` 作为 Tier A 事实无法在 `package.json` 打标记、无 `factOwners` | 为 package.json 加专用提取器 + `factOwners` 条目，或改由 manifest 登记 |
| P2 | 新问题 5：`syncMap` 覆盖不全，存在假阴性 | 补入 plantuml-renderer/md2docx/app.js/md2docx.sh/puppeteer-config，或如实标注边界 |
| P2 | 新问题 8：`-nodefault` 锚点处置 + `envNotes` 未枚举，生成先红 | 明确 nodefault 不参与锚点；列出需 `envNotes` 的变量 |
| P3 | 新问题 6：zip 命名/RELEASE-INFO 字段与代码不符 | 写准事实，或把 SemVer 加入 RELEASE-INFO |
| P3 | 新问题 7：`manifest.json` 示例含 `//` 注释 | 改 `.jsonc` 或去注释 |
| P3 | 新问题 9：`docs:status` 基线未定义；tag↔version 无校验 | 定义基线；发布工作流加 tag==version 校验 |

## 评审结论

**有条件通过。**

第三轮 3 条放行条件**均已实质解决**（守卫机械模拟 9/9 PASS、反向探针全部拒绝、锚点归属规则化并
消除生成文件矛盾、生成契约 22/22 覆盖）；v4 对本轮新增的 Excel 事实/行号核对**全部正确**；
manifest 作为结构单一源、版本号单一源的设计方向合理。方案架构**无需重开评审**。

但 v4 新增机制存在 4 处"照字面写会卡住或留下空洞"的缺陷，且都落在本轮用户新增要求上。
以下 4 条须在 §9 P0 对应步骤动手前写回方案（均为契约/文字级修正）：

1. **定义 Tier A 的 `@docfact` 扫描白名单**（新问题 1），必须包含 `scripts/cli.js` 与
   `scripts/build-windows-bundle.js`；否则第三轮全部多值事实无人校验、§12.1 自证失效。
2. **修正 `verifyVersion` 规则 ③**（新问题 2），比较"次新版本"并给出 1.0.0 首次基线。
3. **收敛 `document-format.md` 的来源与内容**（新问题 3），或明确其只输出基础常量。
4. **为 `engines` 等非 JS/非注释文件的事实定义 Tier A 进入方式与归属**（新问题 4）。

其余（新问题 5-9）为 P2/P3，可在实施中一并处理，不阻断 P0。

**对三项新机制的"是否过度设计"判断：**

- **manifest 驱动**：**与需求相称，保留**。它是唯一的"结构单一源"，新增文档的成本确实降为
  "manifest 一条 + 建文件"，且被"生成物一致/链接/归属"反向校验，不是空架子。
- **syncMap + CI + docs:status**：**方向合理但偏重**。事实级机制已足够硬；关联级的 `syncMap` 覆盖
  不全，收益主要在"提醒改了配置/入口的人去动对应文档"。建议先按 P0 落地事实级与 `docs:status`，
  CI 漂移检查可后置（或先只覆盖 `config.js`/`cli.js` 两个最易漂移的源）。
- **版本闸门**：**价值最高、成本最低，保留**（修好规则 ③ 即可）。
- **`document-format.md` 生成**：**最弱的一环，建议收窄或暂缓**。它是本方案里唯一"生成源不足以支撑
  生成物、退化路径也不成立"的部分，且样式对照本身变化频率低、权威源是 `01-base/技术规范`。

**对单一事实源的判定**：不存在"三个互相打架的真相源"——manifest 管结构、代码常量管事实、生成器管
派生文档，三者各司其职；一个事实值虽在"代码行 / `@docfact` 标记 / 文档 claim 锚点 / 生成表"出现多次，
但每一对相邻副本都有机器校验（守卫 / claim 检查 / 生成物逐字节），链条闭合。代价是簿记量偏大，
但这是用户"不写死 + 更新即同步"的直接结果，可接受。

本轮共发现 9 个问题：**1 严重 / 3 中 / 5 低**。
