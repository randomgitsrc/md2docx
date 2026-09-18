# 评审（第二轮）：文档体系方案 v2

## 评审日期
2026-09-17

## 评审范围

**文档**

- `docs/plans/documentation-system.md`（v2，470 行，逐条核对）
- `docs/review/review-documentation-system.md`（上轮评审，462 行）
- `docs/http-service.md`、`docs/api.md`、`docs/plans/docker-deployment.md`、
  `docs/deployment/windows-offline.md`、`.github/workflows/release-windows.yml`、`package.json`、`.gitignore`

**代码（逐条打开核对，非仅阅读）**

- `server/config.js`、`server/app.js`、`server/services/dependency-check.js`
- `scripts/cli.js`、`scripts/md2docx.js`、`scripts/preprocess.js`、`scripts/plantuml-renderer.js`
- `scripts/puppeteer-config.js`、`scripts/self-check.js`、`scripts/md2docx.sh`
- `scripts/build-windows-bundle.js`

**实际执行的命令（证据）**

在本机（Windows，工作树含未提交改动）执行：

1. `node --version` → `v22.22.2`（node 不在 PATH，用 `D:\home\.data\.workbuddy\binaries\node\versions\22.22.2-2\node.exe`）
2. `node scripts/preprocess.js <temp>\doccheck-test\doccheck-test.md` —— 实测 YAML 多出 `doccheck` 键
3. `node scripts/md2docx.js <temp>\...\doccheck-test.clean.md` —— 实测 DOCX 生成成功
4. `Select-String` 全仓扫描 `process\.env\.([A-Za-z0-9_]+)`、`output/docx|output/clean`、
   `'core'|'jar'|'auto'`、三个 `*.cmd` 字面量、`.cmd` 行号、`engines`
5. `git status --porcelain`、`Test-Path` 校验文档缺口与遗留目录
6. 临时产物已清理（`C:\...\Temp\opencode\doccheck-test` 删除；仓库内未生成 `data/`，`git status` 与评审前一致）

## 上一轮问题的处置核对

| 上轮问题 | 严重度 | 处置是否到位 | 证据 |
|---|---|---|---|
| 一：`doc-facts.js` 无法从代码 require 派生 | 严重 | **方向到位，但具体标记设计仍有不可实施点**（见新问题 1） | v2 §6.2（`:259-306`）已改为静态扫描，不再 require；`config.js:83`/`:52-57`/`:68-72` 的副作用描述属实；但 §6.2 的"同行字面量"守卫对 4 个拟议事实不可满足 |
| 二：Linux「✅ 核心链路实测」无证据 | 严重 | **到位** | v2 §4.1（`:113`）降为 `⚠️ 部分`，证据指向 `.github/workflows/release-windows.yml`（`runs-on: ubuntu-latest` 且 `npm run release:win` 内含 `smokeTestBundle`，`build-windows-bundle.js:376`）；措辞与证据相符 |
| 三：`http-service.md` 误判为最新 | 中 | **到位** | v2 §7（`:358`）"迁移 + 修订"，三处 file:line 全部核对正确：`:173` HOST 默认、`:174` DATA_DIR、`:84/:188` python 残留；对应 `server/config.js:80`、`:38-73`、`dependency-check.js:85` 属实 |
| 四：macOS 无字体分支却写成"有分支" | 中 | **到位** | v2 §4.1（`:117-122`）如实描述：`plantuml-renderer.js:246-295` 无 darwin 分支，`:275-288` 走 `fc-list`，`:289-294` catch 落 `tryWindowsFonts()` 必败，`:307` 静默不注入。与实际代码一致 |
| 五：§6.3「示例即用例」绑定过重 | 中 | **到位** | v2 §6.3（`:329-351`）给出三处具体改造点；`self-check.js:199-212` 单文档、`:248-253` 无题注断言、`smokeTestBundle` 仅调 `--allow-no-browser`（`build-windows-bundle.js:687-724`）均属实 |
| 六：构建脚本不拷 docs、闸门不覆盖 docs | 中 | **到位** | v2 §8（`:371-376`）改动清单；拷贝清单 `:282-285`、`assertBundleContents` `:470-493`、`verifyBundleCode` 只遍历 `scripts/server`（`:661`）均属实；"改副本不改仓库"的 `assertCleanTree` 规避思路正确 |
| 七：Docker 源方案过时 | 中 | **到位** | v2 §9 P1（`:417`）改为"先修订再提炼"；`plans/docker-deployment.md:20-24`（python3/python-docx/openjdk/graphviz）、`:55-65`（apt 装）、`:74-79`（COPY bin/）、`:91`（ENTRYPOINT `./scripts/md2docx.sh`）全部属实 |
| 八：Linux 分发/版本绑定不对等 | 中 | **基本到位** | v2 §8（`:378-385`）+ §10（`:438`）显式登记；但"CI 构建时替换"在 Linux 侧仍无落脚点（见新问题 6） |
| 九：缺安全/systemd/运行库，`known-pitfalls.md` 易腐烂 | 中 | **到位** | v2 §5.1（`:215-220`）删除 `known-pitfalls.md`、新增 `reference/security.md`、`run-as-service.md` 补 systemd、`linux-install.md` 补 `libnss3` |
| 十：依赖矩阵措辞与代码不符 | 低 | **到位** | v2 §4.2（`:124-135`）逐条修订；实测 `package.json` 无 `engines`（33 行）、`dependency-check.js:50-76` 是"core 或 jar 任一"、`:85` python 注释、`:104-105` required/optional 全部属实 |
| 十一："正文包含该值"校验脆弱 | 低 | **方案到位，落点待修** | v2 §6.2 改 claim 锚点（`:303`），但范围内涵过宽（见新问题 3） |
| 十二：`cli.js` 行为差异未提 | 低 | **到位** | v2 §4.3（`:146-157`）；`md2docx.sh:9-19` 交互 `npm install`、`:27-43` Java、`:45-53` curl、`:114` `du -h`、`:90-91` 输出路径全部属实 |
| 十三：目录树缺 plans/review/archived | 低 | **基本到位** | v2 §5.1（`:212`）补齐三个目录并标注"过程档案"；未点名 `plans/large-image-landscape-v5.md`（上轮建议，低） |
| 条件 3 之一（问题三） | — | **到位** | §7 迁移即修订，三处改动具体且核对正确 |
| 条件 3 之二（问题五） | — | **到位** | §6.3 + §9 C4，改造点具体 |
| 条件 3 之三（问题六/七） | — | **到位** | §8 改动清单 + §9 P1 前置修订，具体且行号正确 |

## 总体结论

**v2 相较 v1 是实质性修订，不是文字游戏。** 上轮两条 P0 里，问题二（Linux 验证状态）**已真正解决**：
降为 `partial` 且证据可指认（CI `ubuntu-latest` 确实执行 `smokeTestBundle`）；问题一（doc-fact 机制）
的**设计哲学已被正确纠正**——去掉 require、去掉环境敏感值、把 `platform_status` 移出"机器校验"，
这些都逐一对应了上轮的 (a)~(g)。上轮条件 3 要求的三份具体改动清单也都写了，且 file:line 大部分核对正确。

**但 v2 的 P0 核心机制（§6.2）仍有一处"按字面写会实现不出来"的硬缺陷**：它自己立的"标记必须与
同一行真实字面量同时出现"这条双层防漂移断言，对 4 个拟议事实（`clean_dir`/`docx_dir`/`backend_values`/
`entry_cmds`）**不可满足**——因为这些值在源码里根本不以连续字面量出现，或分散在多行。这不是措辞问题，
是"照方案实施会立刻卡住"的问题。此外 §5.1 与 §6.2 在"configuration.md 是否含全部环境变量/默认值"上
自相矛盾，§6.2 检查项 2 的"每篇文档对每个键"范围过宽。这三条是新引入/未收敛的问题。

因此本轮结论为**有条件通过**：机制方向可继续，但下面 2 条阻断条件必须在 P0 动手前写回方案。

## 新发现的问题1：`@docfact` 的"同行字面量"断言对 4 个拟议事实不可满足 [严重]

**位置**：方案 §6.2（`:284-296`、风险表 `:434`）；`scripts/cli.js:50`、`scripts/plantuml-renderer.js:394-404`、
`scripts/build-windows-bundle.js:295/312/731`

方案原文：

> 标记必须与其**同一行**的真实字面量同时出现——校验时断言该行包含标记值
> （如 `@docfact default_port=8080` 所在行必须也含 `8080`）

这句断言对 `default_port`/`default_host` 成立（`server/config.js:77` 同行含 `8080`，`:80` 同行含
`127.0.0.1`）。但对方案自己列出的另外 4 个事实**不成立**（已逐条实扫）：

1. **`// @docfact clean_dir=output/clean` / `docx_dir=output/docx`（方案 `:281-282`）**：
   `cli.js:50` 是 `path.join(inputDir, 'output', 'docx', ...)`——`output` 与 `docx` 是**两个独立参数**，
   整行不含连续子串 `output/docx`。全仓扫描 `output/docx|output/clean`，命中**全部是注释**
   （`cli.js:13/14/30/31`、`md2docx.js:333/723/1403/1410`），真实代码里不存在连续字面量。
   在 `cli.js:50` 挂标记，断言（去掉标记片段后）必然失败；挂到 `:30-31` 会落进 `USAGE` 模板字符串，破坏输出。
2. **`// @docfact backend_values=core|jar|auto`（方案 `:277`）**：
   三个字面量分散在 `plantuml-renderer.js:395`（`'auto'`）、`:396`（`'jar'`）、`:397`（`'core'`），
   任何单行都不含 `core|jar|auto`（已扫 `'core'|'jar'|'auto'`）。
3. **`// @docfact entry_cmds=启动 md2docx.cmd,转换文档.cmd,自检.cmd`（方案 `:286`）**：
   三个文件名分别在 `build-windows-bundle.js:295`、`:312`、`:731`（安装器里还有 `:851/853`），
   单行不可能同时包含三者。

**影响**：§6.2 是 §9 P0 第 1 步，且 §12.1 验收要求"把某个 `@docfact` 标记值改错 → 失败"。
若照字面实施，要么这 4 条断言恒假（校验永远红），要么实现者偷偷放宽成"值在文件任意处出现即可"，
双层防漂移就名存实亡——恰是上轮问题一要防的"标记与代码各改一半"。

**建议（择一，须写回方案）**：

- **A（推荐）**：为这 4 条事实各引入**单行常量**并让现有代码改用它（行为不变）：
  ```js
  const OUT_DIRS = { clean: 'output/clean', docx: 'output/docx' }; // @docfact clean_dir=output/clean @docfact docx_dir=output/docx
  const BACKEND_VALUES = ['core', 'jar', 'auto'];                 // @docfact backend_values=core|jar|auto
  const ENTRY_CMDS = ['启动 md2docx.cmd', '转换文档.cmd', '自检.cmd']; // @docfact entry_cmds=启动 md2docx.cmd,转换文档.cmd,自检.cmd
  ```
  相应地 §9.0 的 **C1 不能再写"只加注释、无行为变更"**，而应写"新增常量并把 `cli.js:50`/`plantuml-renderer.js:395-404`/
  `build-windows-bundle.js:295/312/474-476/731` 的内联字面量改为引用常量（行为不变）"。
- **B**：把守卫改为"按分隔符（`,`/`|`）拆 token，要求每个 token 在同一行出现"，并把值改写为单行聚合字面量——
  实质仍需 A 的常量。
- 另需在方案里写明：断言前必须**先剔除 `@docfact key=value` 片段本身**再判断，否则该行必然包含标记值，
  断言退化为恒真。

## 新发现的问题2：`configuration.md` 的生成范围与"全部环境变量"自相矛盾 [中]

**位置**：方案 §5.1（`:187`「全部环境变量（由代码生成）」）、§6.2（`:289-292`、`:296`）

§6.2 第 2/3 步只**静态扫描 `server/config.js`**，但 §5.1 把 `configuration.md` 描述为"全部环境变量"，
§6.2 又要求生成表"含默认字面量与代码注释"。两端都对不上实测：

- 实测全仓用户可见环境变量至少还有：`PLANTUML_BACKEND`（`plantuml-renderer.js:395`、
  `dependency-check.js:61`，且 `cli.js:34` 的 USAGE 明确列为可选项）、`PUPPETEER_EXECUTABLE_PATH`
  （`puppeteer-config.js:69`、`cli.js:35`）、`MD2DOCX_OPEN_BROWSER`/`NO_OPEN_BROWSER`（`server/app.js:151`）、
  `ENABLE_PAGINATION_PATCH`（`md2docx.js:1563`）。只扫 `config.js` 会全部漏掉，其中 `PLANTUML_BACKEND`
  正是方案 §4.2/§6.2 自己反复引用的事实。
- 只扫 `config.js` 又会**误纳** OS 变量 `LOCALAPPDATA`（`config.js:41-42`）——它不是用户配置项。
- "默认字面量"并非都能正则提取：`DATA_DIR` 无字面默认（`config.js:39`），`HOST` 是 `|| '127.0.0.1'`，
  其余变量是 `num(process.env.X, N)`。方案只为 `port`/`host` 加了 `@docfact`，其余默认值没有来源。

**影响**：`configuration.md`（用户子集随包分发，§8 `:384`）会既不全又不准；`verify-doc-facts.js`
第 3 项"逐字节一致"只是保证"错得一致"。

**建议**：明确 `configuration.md` 的生成契约——扫描文件白名单（`server/config.js` + 显式列出的
CLI/服务入口），并声明判定规则"哪些 `process.env.X` 进表、哪些是内部/OS 变量（黑白名单）"；
每个进表的变量要么由 `@docfact default_<key>=..` 提供默认值，要么明确标"无默认/由代码推导"。
否则把 §5.1 的"全部环境变量"收窄为"HTTP 服务环境变量（`server/config.js`）"，其余归 `reference/cli.md`。

## 新发现的问题3：claim 锚点检查"每篇文档对每个键"范围过宽，按字面实施会批量误报 [中]

**位置**：方案 §6.2 检查项 2（`:303`）

原文：

> 每篇文档对每个 Tier A 键须有**恰好一个** `<!-- claim:key -->值<!-- /claim -->`

Tier A 键至少有 `default_port`、`default_host`、`backend_values`、`clean_dir`、`docx_dir`、`entry_cmds`
（未来还有 `engines`）。按字面，`explanation/pipeline.md`、`reference/security.md`、
`reference/document-format.md` 等**每一篇**都必须为**每一个**键各放一个锚点（包括 `entry_cmds` 这种与
该文毫无关系的键），否则 `verify:docs` 失败。这既荒谬又会把"单一事实源"（§5.2）反着做——同一事实被迫
在几十篇文档里重复。

**建议**：改为"**每个 Tier A 键在整个文档体系中恰好一个** claim 锚点，归属文档由 §5.2 单一事实源表指定"；
校验失败信息输出"键 / 缺失 / 重复出现于哪些文件"。这样才与 §5.2 一致。

## 新发现的问题4：包内用户子集文档引用 `md/qa/`（不进包）→ 分发后死链；且与 §6.3 的 smoke-test 取源冲突 [中]

**位置**：方案 §6.3 第 3 点（`:350-351`）、§8 用户子集（`:384`）、`md/qa/`（实测存在
`caption-forms.md`、`wide-table.md`、`plantuml-no-end.md`、`crlf-test.md`）

- §6.3 规定"手册中的 md 写法示例**引用 `md/qa/` 已有回归用例**"；而 §8 的包内用户子集 =
  `getting-started.md + how-to/* + reference/{...} + glossary.md`，**不含 `md/`**。于是打进 Windows 包的
  `how-to/write-markdown.md`、`write-captions.md` 里指向 `../../md/qa/caption-forms.md` 的链接，
  在用户解压后是**死链**。§6.2 检查项 4"仓库内相对链接可解析"在仓库里会通过，抓不到这个"包内不可解析"。
- 同时 §6.3 第 2 点要求 `smokeTestBundle` 把 `docs/examples/` 传进去当用例，但 §8 子集列表里
  **也没有 `docs/examples/`**。要么它进包（与子集列表矛盾），要么 smoke test 读的是仓库而非包内副本，
  就违背了 `build-windows-bundle.js:670-686` 注释里"验目标机将要跑的那份"的初衷。

**建议**：二者取一——(a) 把 `docs/examples/` 加入包内子集，并把 how-to 的示例**内联或放进
`docs/examples/`**，不链接 `md/qa/`（`md/qa/` 留作仓库内回归，不进用户文档）；或 (b) 明确"包内文档允许
指向仓库外链接"并在包内标注，且 `verifyBundledDocs` 增加"包内相对链接可解析"的独立检查。

## 新发现的问题5：两处 file:line 引用错误（低，但应改对） [低]

**位置**：方案 `:357`、`:15`、`:396`

- 方案 §7（`:357`）称"内容已是最新（`api.md:48-49` 已写对 requiredKeys/optionalKeys）"。
  实测 `docs/api.md:21-22` 才是 `requiredKeys`/`optionalKeys`，`:36-39` 是档位表；
  `:48-49` 是"python/pythonDocx 已不再是依赖"的说明。引用张冠李戴。
- 方案 §0（`:15`）、§9.0 C4（`:396`）称 `self-check.js:4` 写"本包在 Linux 上构建"。
  实测该句在 **`self-check.js:5`**（`:4` 是空注释行）。轮一评审同样引错，应一并订正。

**建议**：改为 `docs/api.md:21-22/36-39`、`scripts/self-check.js:5`。

## 新发现的问题6：Linux 侧"版本注入 + CI 校验"仍无落脚点，且 `.github/` 未被跟踪 [低]

**位置**：方案 §6.1（`:256-257`）、§4.1 证据（`:113`）

§6.1 称 Linux/源码用 `docs/.docstamp` + README 占位符"由 CI 在构建时替换（GitHub Release 说明亦同）"，
但仓库里**唯一**的工作流是 `.github/workflows/release-windows.yml`（`ubuntu-latest`，只建 Windows 包），
其中**没有任何** docstamp 生成/占位符替换/`verify:docs` 步骤。上轮问题二/建议 3 与问题八都提过"Linux 无
CI 落脚点"，v2 未新增。另外 `git status` 显示 `.github/` 当前仍是 `??`（未跟踪）——把它当作 Linux
证据引用时，应说明"该工作流尚未纳入版本控制"，否则证据在干净检出里并不存在。

**建议**：新增一个最小 Linux 工作流（`npm ci` → `npm run verify:docs` → `npm run docs:stamp`），
或在方案中改为"源码 checkout 即 HEAD 文档，不做 CI 注入"，并删除 §6.1 中无落脚点的承诺。

## 新发现的问题7：Tier B 的 `evidence_linux` 指向尚不存在的文件，与 P0 实施顺序冲突 [低]

**位置**：方案 §6.2 Tier B（`:310-317`）、§9 P0（`:404-407`）

Tier B 校验"evidence 链接可解析"，而 `evidence_linux: docs/deployment/linux-install.md` 是**待建**文件
（§9 P0 第 3、5 项才产出）。P0 第 1 项先落地机制时，链接校验会因文件不存在而失败。需要显式排定顺序，
或允许 Tier B 的 evidence 在"同 PR 内创建"。

**建议**：把"创建 `deployment/linux-install.md` 骨架"排在机制落地之前，或在 Tier B 校验中把
"该文件是否已列入本次实施范围"作为前置，避免 P0 内部自我阻塞。

## 新发现的问题8：`self-check.js:5` 与 `windows-offline.md:163` 未必是硬矛盾，措辞需更准 [低]

**位置**：方案 §4.1/§9 C4；`self-check.js:5`、`docs/deployment/windows-offline.md:32/96-97/163`、
`.github/workflows/release-windows.yml`

上轮与 v2 都把这两句当作"构建机平台自相矛盾"。但实测二者可能指**不同渠道**：官方发布包由 CI
（`release-windows.yml`，`runs-on: ubuntu-latest`）在 Linux 上构建，`windows-offline.md:32/96-97` 也明确
安装器"在 Linux 上即可"生成；而 `:163` 的"Windows 构建机实测"是指本地开发机对打包耗时的实测。因此
C4 改成"平台中性"时，建议直接写清事实——"**官方发布包由 CI（ubuntu-latest）构建**；`windows-offline.md:163`
的耗时为 Windows 本地实测"——比单纯删除字面更准确，也顺带消除歧义。

## 残留问题（上轮未处置干净的）

1. **上轮问题十三（低）**：§5.1（`:212`）只写了 `plans/ review/ archived/`，未点名
   `AGENTS.md` 明示的当前有效设计文档 `docs/plans/large-image-landscape-v5.md`（轮一建议体现）。
2. **上轮问题八 / §6.1 的 Linux CI**：见新问题 6，仍未解决。
3. **T2、T6 仍挂在 §11"待决"**：T2（`md2docx.sh` 收敛）已是 §4.3/§5.2 单一口径的前提，T6（front matter
   vs `expect.json`）本轮已可结论（见下），建议直接落定，减少实施期决策。
4. **上轮问题一 (d)(f)**：v2 用 `@docfact` 规避了 require，但对多值/跨行字面量未给出可实施落点——即新问题 1，
   属于上轮硬伤在同一处的残留。

## 达成的共识 / 值得保留

以下均经本机核对成立：

1. **B1 的设计纠偏正确**：不再 require 运行时模块；`config.js:83` 加载即 `resolveDataDir()`、`:52-57`
   写探针、`:68-72` 抛错，v2 §0（`:30-31`）的引用全部属实，`platform_status` 移入 Tier B 人工表是对的。
2. **B2 证据真实**：`.github/workflows/release-windows.yml` 确为 `runs-on: ubuntu-latest` 且
   `npm run release:win` 会在 `build-windows-bundle.js:376` 跑 `smokeTestBundle`；§4.1 的 `partial` 措辞准确。
3. **`@docfact` 同行守卫对单值事实确实成立**：`server/config.js:77/80` 同行分别含 `8080`/`127.0.0.1`。
4. **迁移即修订的具体性正确**：`http-service.md:84/173/174/188` 与 `config.js:80`、`config.js:38-73`、
   `dependency-check.js:85` 一一对应。
5. **构建改动清单行号正确**：拷贝清单 `build-windows-bundle.js:282-285`、必需清单 `:470-493`、
   `assertCleanTree` `:623-639`、`smokeTestBundle` `:687-724`、`verifyBundleCode` 只遍历
   `scripts/server`（`:645-667`、`:661`）。
6. **Docker 前置修订正确**：`plans/docker-deployment.md:20-24/55-65/74-79/91` 的陈旧点全部属实。
7. **依赖矩阵修订正确**：`package.json`（33 行）确无 `engines`；`dependency-check.js:50-76` 是
   "core 或 jar 任一"语义；`:85` 有 python 已移除注释；`:104-105` 为 required/optional 权威。
8. **macOS 如实描述正确**：`plantuml-renderer.js:246-295/275-288/289-294/305-307` 无 darwin 字体分支；
   `server/app.js:151/154` 有 `open` 分支；`puppeteer-config.js:19-20` 有 macOS Chrome 路径。
9. **`doccheck` front matter 方案可用（本轮实测结论）**：把
   `doccheck: { images: 2, tables: 1, captions: 3 }` 放进 `preprocess.js` 后，
   `fixYamlFrontMatter()`（`preprocess.js:102-136`）的去重正则 `^(\w+)\s*:`（`:109`）不会误删它，
   `matter()`（`:117`）+ `yaml.dump()`（`:134`）原样保留；`md2docx.js:1432-1433` 只取
   `title/company/date`，多出的键被忽略。实测 clean.md 保留 `doccheck` 且 DOCX 正常生成（12.4KB）。
   **T6 可以定为 front matter，方案可停止 hedge**；同目录 `expect.json` 仅作冗余回退。

## 优先级

| 优先级 | 问题 | 建议 |
|---|---|---|
| P0（阻断） | 新问题 1：`@docfact` 同行字面量断言对 `clean_dir`/`docx_dir`/`backend_values`/`entry_cmds` 不可满足 | 采用问题 1 的 A 案（单行常量 + 改引用），并把 §9.0 C1 从"只加注释"改为"新增常量（行为不变）"；守卫需先剔除标记片段 |
| P0（阻断） | 新问题 3：claim 锚点"每篇文档对每个键"范围过宽 | 改为"每个键全体系恰好一个，归属由 §5.2 指定" |
| P0（阻断） | 新问题 2：`configuration.md` 生成范围与"全部环境变量/默认值"矛盾 | 明确扫描白名单与变量进/出规则，或收窄文档范围 |
| P1 | 新问题 4：包内文档链接 `md/qa/` 死链 + `docs/examples/` 未进子集 | 打包前定：示例内联进 `docs/examples/` 并随包，或明确允许外链 |
| P2 | 问题 5：`api.md:21-22`、`self-check.js:5` 引用错位 | 改正 file:line |
| P2 | 问题 6：Linux 版本注入/CI 无落脚点、`.github/` 未跟踪 | 加最小 Linux 工作流，或删除无落点的承诺 |
| P2 | 问题 7：Tier B evidence 指向待建文件 | 排定顺序或允许同 PR 创建 |
| P3 | 问题 8：`self-check.js:5` vs `windows-offline.md:163` | 措辞改为"CI(ubuntu) 出包 / Windows 本地实测" |
| P3 | T2、T6 仍未决 | T6 定为 front matter（已实测）；T2 按 §9.0 C5 落定 |

## 评审结论

**有条件通过。**

v2 是一份可实施的方案，上轮两条 P0 中"Linux 验证状态"已真正修复，"doc-fact 机制"的**设计方向**也正确
（静态扫描、无 require、人工事实分层）。剩余问题集中在**同一机制的落点细节**，属于"照字面写会卡住、
但不改架构"的可控缺陷。因此不再要求整体重写，但下列条件必须在 **§9 P0 第 1 步动手之前**写回方案：

1. **修正 `@docfact` 同行守卫（新问题 1）**：为多值/跨行事实引入单行常量（方案问题 1 的 A 案），
   并同步修正 §9.0 C1 的"无行为变更"表述；明确断言需先剔除 `@docfact key=value` 片段。
2. **修正 claim 锚点范围（新问题 3）**：由"每篇文档对每个键"改为"每个键全体系恰好一个、归属见 §5.2"。
3. **明确 `configuration.md` 的生成契约（新问题 2）**：扫描白名单、变量进/出规则、默认值来源，
   或把 §5.1 的"全部环境变量"收窄到 `server/config.js`。

以下可在实施中处理，但**第 4 项应在 P0 第 8 项（打包装箱）之前解决**：

4. 包内文档不得指向未随包的 `md/qa/`（新问题 4）；`docs/examples/` 是否进子集需与 §6.3 统一。
5. 改正 `docs/api.md:21-22`、`scripts/self-check.js:5` 两处引用（新问题 5）。
6. 补 Linux CI/docstamp 落脚点或删除承诺（新问题 6）；Tier B evidence 顺序（新问题 7）。
7. `self-check.js:5` 与 `windows-offline.md:163` 的措辞按"CI 出包 / 本地实测"厘清（新问题 8）。
8. T6 定为 front matter（已实测无害）；T2 按 §9.0 C5 落定。

本轮共发现 8 个问题：**1 严重 / 3 中 / 4 低**（另有 4 项上轮残留，皆为低）。
