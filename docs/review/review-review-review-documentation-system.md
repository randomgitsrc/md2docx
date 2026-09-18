# 评审（第三轮）：文档体系方案 v3

## 评审日期
2026-09-17

## 评审范围

**文档**

- `docs/plans/documentation-system.md`（v3，552 行，逐行核对，含 §0 修订记录）
- `docs/review/review-documentation-system.md`（第一轮，462 行）
- `docs/review/review-review-documentation-system.md`（第二轮，291 行）

**代码（逐条打开核对，非仅阅读）**

- `server/config.js`、`server/app.js`、`server/services/dependency-check.js`、`server/lib/logger.js`
- `scripts/cli.js`、`scripts/plantuml-renderer.js`、`scripts/puppeteer-config.js`
- `scripts/build-windows-bundle.js`、`scripts/self-check.js`、`scripts/md2docx.js`、`scripts/preprocess.js`、`scripts/md2docx.sh`
- `package.json`、`.gitignore`、`.github/workflows/release-windows.yml`
- `docs/api.md`、`docs/http-service.md`、`docs/plans/docker-deployment.md`、`docs/deployment/windows-offline.md`

**实际执行的命令（证据）**

1. 全仓 `grep process\.env\.[A-Za-z_]\w*`（30 命中）——用于核 `configuration.md` 生成契约的白/黑名单是否自洽。
2. **机械模拟 §6.2 守卫**（按方案 `:306-308` 字面实现：取标记所在行 → 剔除 `@docfact key=value` 片段 →
   按 `|`/`,` 切 token → 断言 token 出现在剩余文本），对 v3 `:313-345` 列出的**全部**事实逐条跑：
   - v3 字面写法（标记在常量**上一行**）：`clean_dir`/`docx_dir`/`backend_values`/`entry_cmds` **4 条全 FAIL**；
   - 第二轮 A 案写法（标记作常量**同行尾注**）：**全 PASS**；
   - 单值事实（`default_port`/`default_host`/`default_max_concurrent`）：PASS；
   - 反向探针：`default_queue_limit=5` 在 `... QUEUE_LIMIT, 50)` 行上**误判 PASS**。
3. `git status --porcelain`、`git ls-files .github`、`Test-Path`（README/CHANGELOG/index/glossary/examples/v5）。
4. `node --version` → `v24.20.0`（本机 `node` 可用，另备 `D:\home\apps\DeepSeekHarness\node\node.exe`）。
5. 临时模拟脚本已删除；未生成 `data/`（`Test-Path data` = `False`）；`git status` 与评审前一致。

## 三条阻断条件的处置核对

| 条件 | 是否到位 | 证据 |
|---|---|---|
| 1. `@docfact` 多值事实断言可满足 + C1 改写 + 先剔标记 | **未完全到位**（设计对，落点照字面会失败） | 方案已引入单行常量（`:324/331/341`），§9.0 C1 已改为"新增常量 + 引用（行为不变）"（`:346/463`），`:306` 已写明"先剔除标记片段"。**但 `:323/330/340` 把标记写在常量上一行**；机械模拟显示按 `:306-308` 守卫实测 4 条多值事实**全部 FAIL**（剩余文本仅 `// `）。改成第二轮 A 案的同行尾注则全 PASS |
| 2. `configuration.md` 生成契约 | **基本到位** | `:358-368` 给出扫描白名单（5 文件）、黑名单、未知变量即失败、无默认标注、默认值来源 `default_<key>`。实扫白名单文件的 `process.env`：`config.js:41` 的 `LOCALAPPDATA`、`plantuml-renderer.js:249` 的 `WINDIR` **都已在黑名单**；`JAVA_HOME`（`:342`）、`DEBUG`（`config.js:111`）**未被误黑**，与"无默认/用户可配"一致。残留：`<key>` 与变量名的对应约定未写明，且示例缺 `default_plantuml_backend`（见新问题 3） |
| 3. claim 锚点范围收窄 | **方向到位，但有新矛盾** | `:353` 与 §11 T3（`:525`）已改为"每个 Tier A 键全体系**恰好一个**，归属由 §5.2 指定"。但归属表**漏了 `default_max_concurrent`**；且 `:354` 称 `configuration.md`"整体派生，故不参与 claim 锚点"，与 `:353` 把 `default_port`/`default_host`/`backend_values` 的锚点指定到 `configuration.md` **直接冲突**（见新问题 2） |

## 总体结论

v3 在本轮要求的三条阻断条件上**逐条落地了**：单行常量已引入、C1 表述已改正、守卫已明确"先剔标记"；
`configuration.md` 的白/黑名单机制自洽且黑名单覆盖了白名单文件里真正的两个 OS 变量；claim 锚点已收窄为
"全体系恰好一个"；第二轮其余 5 条中/低问题（包内死链、file:line、Linux CI、Tier B 顺序、C4 措辞）与两条
残留（§5.1 点名 v5、T2/T6 落定）也都改了，且**本轮新引入的 file:line（`self-check.js:5`、
`api.md:21-22/36-39`、`preprocess.js:102-136`、`md2docx.js:1432-1433`、`build-windows-bundle.js:376`）
逐条核对全部正确**。

但第一轮阻断条件的**落点仍有一处"照字面写就实现不出来"**：v3 自己给出的多值事实代码块把 `@docfact` 标记写在
常量**上一行**，而守卫规则是"取该行"，于是 4 条多值断言恒假。这不是措辞问题——它是 §9 P0 第 1 步的核心，
且 §12.1 明确要求"改错某个 `@docfact` 标记值 → 失败、全部改回 → 通过"。此外 claim 锚点的归属表与
`configuration.md` 是否参与锚点在 v3 内部自相矛盾，`configuration.md` 示例又缺了自己规则要求的默认值标记。

因此本轮结论为**有条件通过**：下面 3 条必须在 **§9 P0 第 1 步动手之前**写回方案（均为文字级修正，不需重开架构评审）。

## 新发现的问题1：v3 示例把多值 `@docfact` 标记写在常量上一行，守卫按字面仍对 4 条事实恒假 [严重]

**位置**：方案 §6.2 `:306-308`（守卫）、`:319-345`（A 案代码）、`:463`（C1）；第二轮评审建议 A 案在 `review-review-documentation-system.md:101-112`

方案 `:319-345` 的三段示例：

```js
// scripts/cli.js
// @docfact clean_dir=output/clean @docfact docx_dir=output/docx      // ← :323 标记独占一行
const OUT_DIRS = { clean: 'output/clean', docx: 'output/docx' };      // ← :324 真实常量在下一行
```
```js
// @docfact backend_values=core|jar|auto                              // ← :330
const BACKEND_VALUES = ['core', 'jar', 'auto'];                       // ← :331
```
```js
// @docfact entry_cmds=启动 md2docx.cmd,转换文档.cmd,自检.cmd            // ← :340
const ENTRY_CMDS = ['启动 md2docx.cmd', '转换文档.cmd', '自检.cmd'];    // ← :341
```

守卫规则 `:305-308` 是"对每个标记，取**该行**，先剔除所有 `@docfact …=…` 片段，再断言每个 token 出现在
剩余文本中"。按此字面实现，标记所在的上一行被剔除后只剩 `// `（本机模拟原文）：

```
== cli.js clean_dir/docx_dir ==
  rest : "// "
  marker clean_dir="output/clean"  => FAIL missing=["output/clean"]
  marker docx_dir="output/docx"    => FAIL missing=["output/docx"]
== plantuml backend_values ==
  rest : "// "
  marker backend_values="core|jar|auto" => FAIL missing=["core","jar","auto"]
== bundle entry_cmds ==
  rest : "// "
  marker entry_cmds="启动 md2docx.cmd,转换文档.cmd,自检.cmd" => FAIL missing=[全部三个]
```

而把标记改回第二轮 A 案的**同行尾注**（`const OUT_DIRS = {...}; // @docfact …`），同一守卫**全部 PASS**。

**影响**：§6.2 是 §9 P0 第 1 步；若照 `:323/330/340` 实施，`verify:docs` 对这 4 个键**恒红**（要么实现者
偷偷放宽成"值在文件任意处出现即通过"，恰好退化为上轮要防的"标记与代码各改一半"）。方案文字"在真实常量
**旁边**加标记"（`:297`）与守卫"取**该行**"（`:306`）本身也留了歧义。

**建议（写回方案，二选一）**：

- **A（推荐）**：把 `:323/330/340` 三处标记改为**常量行的行尾注释**（即第二轮 A 案原始排版），并在 §6.2
  明写"标记必须与真实常量**同一行**；扫描器只断言标记所在行"。
- **B**：守卫增加"若标记所在行剔除后无剩余，则回退到下一非空行"的规则，并在 `:306` 写明。

无论哪种，§12.1 应补一条"4 条多值事实的标记行断言必须真实生效（改 `output/docxs` 等应失败）"。

## 新发现的问题2：claim 锚点归属表漏键，且"configuration.md 是否参与锚点"自相矛盾 [中]

**位置**：方案 §6.2 检查项 2（`:353`）与检查项 3（`:354`）、§5.2（`:263`）

`:353` 规定"每个 Tier A 键在整个文档体系中恰好一个 claim 锚点，归属由 §5.2 指定"，随后枚举：
`default_port`/`default_host`→`configuration.md`；`clean_dir`/`docx_dir`→`cli.md`；`backend_values`→
`configuration.md`；`entry_cmds`→`windows-offline.md`。但 Tier A 键还包括
**`default_max_concurrent`（方案 `:316` 自己列的）**，归属表里没有它。按 `:353` 字面，该键"恰好一个"的
断言无落点，`verify:docs` 会缺锚点失败或迫使实现者临时决定（超出方案）。

更硬的是 `:354`：

> `configuration.md` 与生成结果**逐字节一致** ……（**该文件整体派生，故不参与 claim 锚点**）

与 `:353` 把 `default_port`/`default_host`/`backend_values` 三个锚点指定到 `configuration.md` **正面冲突**：
如果 `configuration.md` 不参与 claim 锚点，这三个键就没有归属；如果它参与，`:354` 的括注就是错的。

**影响**：这正是第二轮阻断条件 3 所修的那张表；实现 `verify-doc-facts.js` 检查项 2/3 时无法同时满足。

**建议**：二者取一并写清——(a) `configuration.md` **参与** claim 锚点，锚点由 `docs:gen` 一并生成，把
`:354` 括注改为"其锚点由生成器产出，不要求人工维护"；或 (b) `configuration.md` 不参与，把
`default_port`/`default_host`/`backend_values` 的锚点移到非生成文档（如 `security.md`/`web-ui.md`，但这会
与"环境变量唯一权威位置"分叉）。无论哪种，**补上 `default_max_concurrent` 的归属**。

## 新发现的问题3：`configuration.md` 契约的 `<key>`↔环境变量映射未定义，示例缺自身规则要求的默认值标记 [中]

**位置**：方案 §6.2 `:358-368`、`:329-336`

`:365-366` 的"未知即失败"规则要求白名单文件中的每个 `process.env.X` 要么有 `@docfact default_<key>=…`，
要么显式 `@docfact-nodefault <key>`。但：

1. `<key>` 与 `X` 的对应关系**从未写明**（只能从 `default_port`↔`config.js:77` 等示例反推为
   "`<key>` = 变量名小写"）。实现者按字面无法确定 `PORT` 该配 `default_port` 还是 `default_Port`。
2. 白名单文件 `scripts/plantuml-renderer.js` 含 `process.env.PLANTUML_BACKEND`（`:395`）。按 `:365-366`，
   它需要一个 `default_plantuml_backend=auto`（或 `-nodefault`）标记；但方案 `:329-336` 只给了
   `backend_values=core|jar|auto`。**照方案实施，`verify:docs` 会在自己的示例上因 `PLANTUML_BACKEND` 未登记而失败。**
3. 未被枚举但按规则必被扫到的用户变量至少还有：`NO_OPEN_BROWSER`、`MD2DOCX_OPEN_BROWSER`
   （`server/app.js:151`）、`ENABLE_PAGINATION_PATCH`（`md2docx.js:1563`）。方案应至少声明它们的处置
   （进表 / 无默认 / 归入黑名单），否则实现者逐个临时决策。
4. 生成器如何取得每个变量的**中文说明**（`configuration.md` 的表格除变量名/默认值外还需语义）未定义。

**说明**：白名单文件的 OS 变量已被黑名单覆盖——实扫确认只有 `LOCALAPPDATA`（`config.js:41`）与
`WINDIR`（`plantuml-renderer.js:249`），二者均在 `:363-364` 黑名单内；黑名单里 `SystemRoot`/`NSISDIR`/
`NSIS_DEB_BASE`/`NODE_ENV`/`CDP_URL`/`PUPPETEER_SKIP_DOWNLOAD` 虽出现在非白名单文件（`build-windows-bundle.js`、
`logger.js`、`e2e-web.js`），属冗余但**无害**。因此 condition 2 的"黑名单完整、无用户变量被误黑"成立，
问题只在上面的映射/示例。

**建议**：在 §6.2 写明 `<key> = 环境变量名小写`（或改为直接以环境变量名为标记键），给
`PLANTUML_BACKEND` 补 `@docfact default_plantuml_backend=auto`，并声明上述三个开关的内/出规则与表格中
"说明"的来源（代码同行注释 / 人工登记）。

## 新发现的问题4：守卫的子串断言过弱，数字型默认值与键值互换会"误判通过" [低]

**位置**：方案 §6.2 `:307-308`

守卫是"token 出现在剩余文本中"。对 `default_max_concurrent=2`，token 是单字符 `2`——本机反向探针：

```
行: queueLimit: num(process.env.QUEUE_LIMIT, 50), // @docfact default_queue_limit=5
rest: "  queueLimit: num(process.env.QUEUE_LIMIT, 50), // "
=> PASS        ← 期望 5、代码是 50，却因 "50" 含 "5" 而通过
```

同类：`default_port=808` 会被 `8080` 满足；`clean_dir=output/docx` 与 `docx_dir=output/clean` **互换**在同一条
常量行上仍双双 PASS（两子串都在行内）。这不推翻机制（§12.1 用"改成 `output/docxs`"能失败），但方案
§10（`:506`）"同行守卫防各改一半"的承诺应适度下调：**它挡不住子串包含与键值互换**。

**建议**：token 断言改为**词边界/完整字面量**匹配（如要求 `'<token>'` 或 `\b<token>\b`，数字要求不被其他
数字邻接）；或在方案 §10 如实标注该守卫的能力边界。属低优先，不阻断。

## 新发现的问题5：§5.1 的 `plans/` 枚举漏了 `docs/plans/http-service.md`；入口常量未覆盖安装器 [低]

**位置**：方案 §5.1 `:246-247`、§9.0 C1 `:463`、`build-windows-bundle.js:851/853`

- `docs/plans/` 实际含 `docker-deployment.md`、`documentation-system.md`、`http-service.md`、
  `large-image-landscape-v5.md`、`windows-native.md`（本机列目录确认），而 §5.1 只枚举了 4 个，漏
  `http-service.md`（它是已跟踪的 HTTP 服务方案 v2）。建议补入或说明其归档去向。
- §6.2 的 `entry_cmds` 常量只替换 `:295/:312/:731/:474-476` 四处，但安装器 NSI 的
  `CreateShortcut … "$INSTDIR\启动 md2docx.cmd"`（`:851/853`）仍是硬编码同名。若日后改 `ENTRY_CMDS[0]`
  而漏改安装器，会产生指向不存在文件的快捷方式，且 `verify:docs`（只校验常量行与标记一致）**抓不到**。
  低优先，但建议在 §9.0 C1 备注"安装器内的同名引用一并对齐或加校验"。

## 残留问题

1. **T1（不做 Linux 便携包）** 与 §8 的"已知不对等"已如实登记，可接受。
2. **`docs/examples/` smoke test 的产物落点未定义**：`preprocess` 默认把 clean/docx 写到**输入文件同级**
   （`cli.js:50`）。若 `smokeTestBundle` 直接就地转换包内 `docs/examples/*.md`，会在 `BUNDLE_DIR` 内生成
   `output/` 目录并随之打进 zip。建议在 §6.3/C4 写明"示例转换输出到临时目录（`--out` 或临时 outputDir）"。
   属实施细节，低优先。
3. 上轮"残留"三项（§5.1 点名 v5、T2、T6）本版均已处置，无残留。

## 达成的共识 / 值得保留

以下均经本机核对成立：

1. **三条阻断条件的"设计"已落地**：单行常量（`:324/331/341`）、C1 改写（`:463`）、先剔标记（`:306`）、
   生成契约（`:358-368`）、锚点收窄（`:353`）。问题只在多值标记的**落点排版**与两处**枚举/措辞**。
2. **`resolveBackend()` 改写行为等价（已逐输入核对）**：现状 `plantuml-renderer.js:394-405` 是
   `want='jar'|'core'` 直返、其余落 auto 分支。`BACKEND_VALUES.includes(raw) ? raw : 'auto'` 对
   `jar/core/auto`、大写、带空格、非法值、未设、空串**逐一映射相同**（非法/未设/空串现状亦落 auto 分支）。
3. **入口常量替换行为等价**：`:295`（`启动 md2docx.cmd`）、`:312`（`转换文档.cmd`）、`:731`（`自检.cmd`）、
   `:474-476` 必需清单，均为**同一字符串**的引用替换，与 `ENTRY_CMDS` 顺序 `[0]/[1]/[2]` 一致，无行为差异
   （遗漏的 `:851/853` 见问题 5，属覆盖不全而非等价性问题）。
4. **本轮新引入的 file:line 全部正确**：`self-check.js:5`（"本包在 Linux 上构建"）、
   `api.md:21-22`（requiredKeys/optionalKeys）、`:36-39`（档位表）、`preprocess.js:102-136`
   （`fixYamlFrontMatter`）、`md2docx.js:1432-1433`（`matter` + `parsed.data`）、
   `build-windows-bundle.js:376`（`smokeTestBundle`）——逐条打开核对，无误。
5. **Linux 证据链真实**：`.github/workflows/release-windows.yml:29` `runs-on: ubuntu-latest`、
   `:50` `npm run release:win`，而 `build-windows-bundle.js:376` 确实执行 `smokeTestBundle`；
   `windows-offline.md:163` 的耗时为本地 Windows 实测——v3 §4.1 `:145-147` 的"CI 出包 / 本地实测"
   区分正确。
6. **黑名单完整、无误黑**：白名单文件里仅 `LOCALAPPDATA`、`WINDIR` 两个 OS 变量，均被黑名单覆盖；
   `JAVA_HOME`/`DEBUG` 正确地未被黑。
7. **其余条件与残留处置到位**：包内不引 `md/qa/`、`docs/examples/` 进子集（§6.3 `:414-416`、§8 `:452`）、
   Tier B 前置于 P0 第 0 步（`:475-476`）、C4 措辞写清事实（`:466`）、§5.1 点名 v5（`:246`）、
   T6 定 front matter（`:524`）——均已写回。

## 优先级

| 优先级 | 问题 | 建议 |
|---|---|---|
| P0（阻断） | 新问题 1：v3 示例把多值标记写在常量上一行，守卫对 4 条事实恒假 | 改为常量行尾注释，或守卫回退到下一非空行；§12.1 补对应自证 |
| P0（阻断） | 新问题 2：claim 锚点归属漏 `default_max_concurrent`，且 `configuration.md` 是否参与锚点自相矛盾 | 定死 configuration.md 的锚点归属并统一 `:353`/`:354`；补全归属表 |
| P0（阻断） | 新问题 3：`<key>`↔变量名映射未定义，示例缺 `default_plantuml_backend`（按自身规则会失败） | 写明映射约定；给 `PLANTUML_BACKEND` 补默认标记；声明三个未枚举开关 |
| P2 | 新问题 4：守卫子串断言过弱（`5` 匹配 `50`、键值互换） | 改词边界匹配，或在 §10 下调能力承诺 |
| P3 | 新问题 5：§5.1 漏 `plans/http-service.md`；安装器 `:851/853` 未纳入常量 | 补枚举；常量对齐安装器 |
| P3 | 残留 2：`docs/examples/` smoke 产物可能写进包 | 在 C4 明确用临时输出目录 |

## 评审结论

**有条件通过。**

v3 对第二轮两条 P0 条件（`configuration.md` 契约、claim 锚点收窄）与全部中/低问题、残留问题的处置**实质到位**，
新增的 file:line 与"平台口径"事实经本机逐条核对**全部正确**，`resolveBackend()` 与入口常量的行为等价性也**经代码确认成立**。
方案的架构与机制方向**已可实施**，无需重开评审。

但第一轮阻断条件（多值 `@docfact` 断言）在 v3 的**示例排版**上仍会失败，加上锚点归属与生成契约的两处
自相矛盾，属于"照字面写会立刻卡住 P0 第 1 步"的可控缺陷。以下 3 条为放行条件，须在 **§9 P0 第 1 步动手之前**
写回方案（均为文字/排版级修正，改完即可实施，不必再评审）：

1. **修正多值标记落点**（新问题 1）：`@docfact` 标记与真实常量**同一行**（行尾注释），或守卫回退下一非空行；
   并在 §12.1 增加"把 `OUT_DIRS.docx` 改错必须失败"的自证项。
2. **收敛 claim 锚点归属**（新问题 2）：补 `default_max_concurrent` 归属；统一 `:353` 与 `:354` 关于
   `configuration.md` 是否参与锚点的表述。
3. **补齐生成契约映射**（新问题 3）：写明 `<key>` 与变量名的对应约定；给 `PLANTUML_BACKEND` 补
   `default_plantuml_backend=auto`；声明 `NO_OPEN_BROWSER`/`MD2DOCX_OPEN_BROWSER`/`ENABLE_PAGINATION_PATCH`
   的内/出规则。

**对两个核心机制的安全性判定：**

- **守卫机制**：**设计安全、可在小修正后实施**。守卫规则本身（剔标记 + 按 `|`/`,` 切 token + 同行断言）
  对单值事实与"常量行尾注"形式的多值事实**实测全部 PASS**；唯一缺陷是 v3 示例把多值标记放在了上一行，
  以及子串断言对数字/键值互换偏弱（问题 4，非阻断）。**按上述条件 1 修正后，守卫机制安全可实施。**
- **C1 重构**：**安全可实施**。`BACKEND_VALUES.includes(raw) ? raw : 'auto'` 与现状 `resolveBackend()`
  在含非法值/未设/空串在内的所有输入上等价；`ENTRY_CMDS` 对 `:295/:312/:731/:474-476` 的替换为同一字符串的
  引用替换，行为不变；仅需注意安装器 `:851/853` 未纳入（问题 5，覆盖不全而非等价性缺陷）。

本轮共发现 5 个问题：**1 严重 / 2 中 / 2 低**（另有 1 项低优先残留）。
