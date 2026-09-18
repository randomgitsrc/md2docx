# 评审（第五轮）：文档体系方案 v5

## 评审日期
2026-09-17

## 评审范围

**文档**

- `docs/plans/documentation-system.md`（v5，667 行，逐行核对，含 `## 0. 修订记录` 的 v5 段）
- `docs/review/review-documentation-system.md`（第一轮）
- `docs/review/review-review-documentation-system.md`（第二轮）
- `docs/review/review-review-review-documentation-system.md`（第三轮）
- `docs/review/review-review-review-review-documentation-system.md`（第四轮，363 行）

**代码（逐条打开核对，非仅阅读）**

- `server/config.js`、`server/app.js`、`server/services/dependency-check.js`
- `scripts/md2docx.js`、`scripts/cli.js`、`scripts/plantuml-renderer.js`、`scripts/puppeteer-config.js`
- `scripts/build-windows-bundle.js`、`scripts/self-check.js`、`scripts/preprocess.js`
- `scripts/md2docx.sh`、`package.json`、`.github/workflows/release-windows.yml`、`docs/api.md`

**实际执行的命令（证据）**

1. 提取方案内**全部** 35 处 `@docfact` 出现点（`grep`），逐处判定宿主文件是否在 `DOCFACT_SCAN_FILES`（`:269`）。
2. 全仓扫描 `process\.env\.[A-Za-z_]\w*`（30 命中），逐一归属到 `ENV_SCAN_FILES`（`:270`）并核对 §6.2 环境变量表（`:359-381`）。
3. **机械模拟 v5 §6.2 守卫**（按 `:293-299` 字面实现：剔 `@docfact…=…` → 按 `|`/`,` 切 token → 数字词边界 / 引号字符串 / 点分标识符三种形式），对 v5 列出的**全部有值事实**逐条跑（17 条）+ 点分标识符探针 1 条 + 反向探针 4 条。
4. 从方案 `:405-445` 抽出 ```json 代码块 → `JSON.parse`。
5. `require('./package.json')` 读 `engines`/`version`；`git ls-files .github`、`git status --porcelain`。
6. 提取方案内全部 `file:line` 引用并逐条打开核对。
7. `node --version` → `v24.20.0`（本机 node 不在 PATH，用 `D:\home\apps\DeepSeekHarness\node\node.exe`）。
8. 临时脚本写在系统临时目录（`.../Temp/opencode/r5/`）并在评审后删除；未 `require('./server/config')`；`git status` 与评审前一致（本评审文件为唯一新增）。

## 第四轮条件的处置核对

| 条件 | 是否到位 | 证据 |
|---|---|---|
| **N1 [严重] 定义 Tier A `@docfact` 扫描白名单，必须含 `cli.js`/`build-windows-bundle.js`** | **到位** | §6.2 `:267-273` 明确两张清单：`DOCFACT_SCAN_FILES = {server/config.js, scripts/cli.js, scripts/plantuml-renderer.js, scripts/build-windows-bundle.js}`；v5 显式给出的 4 个 `@docfact key=value` 宿主文件**全部在内**（详见下表）。第四轮的"三个多值事实无人扫描"硬伤已消除，`§12.1 :650` 的防复发自证成立。**但**：`@docfact-nodefault` 的 4 个标记落在 `app.js`/`md2docx.js`/`puppeteer-config.js`（不在该清单），见新问题 2 |
| **N2 [中] `verifyVersion` 规则③"严格大于最近已发布版本"恒假** | **到位** | §6.5 `:498` 改为两条规则：① **单调性**（CHANGELOG 已发布版本段自上而下严格递减，**与 `package.json` 无关**，无鸡生蛋）；② **发布态一致性**（仅 `release:win`/CI：`package.json.version` == CHANGELOG 最大已发布段，且 `Unreleased` 为空）；③ 开发态只跑 ①。首次 `1.0.0` 场景：单调性平凡成立、发布态 `1.0.0==1.0.0`，**可满足**。`§12.1 :653` 补了乱序失败自证 |
| **N3 [中] `document-format.md` 提取源不足 + 退化守卫拒绝 `FONT.黑体`** | **到位** | ① §6.3 `:461-468` 改为**部分生成 + 部分人工**：生成器只产出顶层 `SIZE`(`md2docx.js:50`)/`FONT`(`:52-59`)/`PAGE`(`:61-66`)；表格线宽/行高/题注（实为 `documentStyles`，`md2docx.js:75-123`）**人工维护**并纳入 `syncMap`（`:435`）。② 守卫 `:296-299` 新增第三种 token 形式"点分标识符"，机械模拟 `heading1_font=FONT.黑体` **PASS**。**但**：新增形式未覆盖布尔字面量，见新问题 1 |
| **N4 [中] `engines` 无注释可打、`factOwners` 无条目** | **到位** | §6.2 `:275-280` 新增第二种 Tier A 来源：`manifest.json` 的 `jsonFacts`（`:414-416` `{"key":"engines_node","source":"package.json#engines.node"}`）；`factOwners` `:423` 增 `"engines_node": "reference/supported-platforms.md"`。`package.json` 当前确无 `engines`（已 `require` 核对），C7 补齐后指针可解析 |
| 低：`syncMap` 漏源文件 / 偏重 | **部分到位** | §6.4 `:481-487` 已把关联级降为 **warn**、硬门禁只留事实级；`factOwners`/`manifest` 一致。已补 `scripts/md2docx.js`、`scripts/self-check.js`、`server/public/app.js`（`:435-437`）。**残留**：仍缺 `scripts/plantuml-renderer.js`、`scripts/md2docx.sh`、`scripts/puppeteer-config.js`；且 `:17` 承诺的"未映射代码变更也提示"未写入 §6.4（新问题 4） |
| 低：zip 名与版本无关 / RELEASE-INFO 无 SemVer | **到位（目标态）** | §6.5 `:500` 明确 `md2docx-win-x64-<ver>.zip`、`md2docx-Setup-<ver>-win-x64.exe`，`RELEASE-INFO.txt` 记录 SemVer + commit + SHA256；现状 `build-windows-bundle.js:37/380` 与 `:395` 确与目标不符，属 C3 待改项，方案已写准。**残留**：CI 的 artifact 名/路径未同步（新问题 6） |
| 低：`manifest.json` 示例含 `//` 注释 | **到位** | `:405-445` 实测 `JSON.parse` **OK**，顶层键 `version/docs/jsonFacts/factOwners/generated/syncMap/envNotes` 齐全 |
| 低：`@docfact-nodefault` 与 `envNotes` 未枚举 | **基本到位** | §6.2 `:359-381` 逐条枚举 20 个变量（13+1 有默认、6 无默认）；`:383-385` 列 7 条 `envNotes`。**残留**：判据句"无同行注释的变量须登记"与只列 7 条不自洽（新问题 3） |
| 低：`docs:status` 无基线 | **到位** | §6.4 `:487` 基线 = 最近发布 tag（无 tag 时 `HEAD~10`）；§6.5 `:499` 增 tag↔`package.json.version` 一致性校验 |

### N1 核对：`@docfact key=value` 宿主文件 vs `DOCFACT_SCAN_FILES`

| 键 | 宿主文件（v5 位置） | 在 `DOCFACT_SCAN_FILES`？ |
|---|---|---|
| `default_port` / `default_host` / `default_max_concurrent` / `default_queue_limit` | `server/config.js`（`:305-308`） | ✅ |
| `default_max_file_size_mb` / `default_max_diagrams` / `default_job_ttl_minutes` / `default_cleanup_interval_minutes` / `default_graceful_timeout_ms` / `default_rate_limit_per_minute` / `default_health_cache_ttl_ms` / `default_job_timeout_ms` / `default_debug` | `server/config.js`（`:361-373` 表，对应 `config.js:93-111`） | ✅ |
| `clean_dir` / `docx_dir` | `scripts/cli.js`（`:315`） | ✅ |
| `backend_values` / `default_plantuml_backend` | `scripts/plantuml-renderer.js`（`:321/323`） | ✅ |
| `entry_cmds` | `scripts/build-windows-bundle.js`（`:330`） | ✅ |
| `engines_node` | 非文件标记，走 `jsonFacts` JSON 指针 | N/A（不受扫描清单约束） |
| **`data_dir` / `java_home`** | `server/config.js:39` / `scripts/plantuml-renderer.js:342` | ✅（nodefault） |
| **`puppeteer_executable_path` / `md2docx_open_browser` / `no_open_browser` / `enable_pagination_patch`** | `scripts/puppeteer-config.js:69` / `server/app.js:151` / `scripts/md2docx.js:1563` | ❌ **三个文件均不在清单** → 新问题 2 |

**结论**：N1 针对的**有值 Tier A 事实**（`clean_dir`/`docx_dir`/`entry_cmds` 等）已 **100% 纳入扫描**，第四轮的严重缺陷**确已修复**；豁免的 `-nodefault`（无值、不产锚点）宿主文件存在清单张力，见新问题 2。

### 守卫机械模拟（v5 §6.2，逐字实现）

| 事实 | 结果 |
|---|---|
| `default_port=8080` | PASS |
| `default_host=127.0.0.1` | PASS |
| `default_max_concurrent=2` | PASS |
| `default_queue_limit=50` | PASS |
| `default_max_file_size_mb=20` | PASS |
| `default_max_diagrams=30` | PASS |
| `default_job_ttl_minutes=60` | PASS |
| `default_cleanup_interval_minutes=10` | PASS |
| `default_graceful_timeout_ms=30000` | PASS |
| `default_rate_limit_per_minute=20` | PASS |
| `default_health_cache_ttl_ms=60000` | PASS |
| `default_job_timeout_ms=900000` | PASS |
| **`default_debug=false`**（`config.js:111`） | **FAIL**（`false` 非数字、非引号字符串、非点分标识符）→ 新问题 1 |
| `clean_dir=output/clean` / `docx_dir=output/docx` | PASS |
| `backend_values=core\|jar\|auto` | PASS |
| `default_plantuml_backend=auto` | PASS |
| `entry_cmds=启动 md2docx.cmd,转换文档.cmd,自检.cmd` | PASS |
| `heading1_font=FONT.黑体`（点分标识符探针） | PASS |
| **反向** `default_queue_limit=5` vs `50` | 拒绝 ✓ |
| **反向** `default_port=808` vs `8080` | 拒绝 ✓ |
| **反向** `clean_dir=output/docxs` vs `output/docx` | 拒绝 ✓ |
| **反向** `backend_values=core\|jar\|autox` | 拒绝 ✓ |

**结论**：v5 列出的**有值事实 17/18 PASS，1 FAIL**（`default_debug=false`）；反向探针 4/4 正确拒绝。与第四轮"9/9 PASS"相比，v5 扩大了事实面，暴露出一个**此前从未被模拟到的布尔字面量缺口**。

### 新事实的代码核对（抽检全部正确）

- `md2docx.js:75-123` 确为 `documentStyles`（`:75` 起、`:123` 收）✅；顶层 `SIZE :50`、`FONT :52-59`、`PAGE :61-66` ✅
- `config.js:39` = `if (process.env.DATA_DIR) …` ✅；`config.js:111` = `debug: bool(process.env.DEBUG, false)` ✅
- `cli.js:50` 当前实为内联 `path.join(inputDir,'output','docx',…)`，**尚无 `OUT_DIRS` 常量**——与 §9.0 C1 宣布的"本次新增 `OUT_DIRS`"一致（`:315` 为改后态，非现状）✅
- `plantuml-renderer.js:71-83/246-295/250-257/275-288/289-294/299-302/307/342/395/423-428/517` 全部命中 ✅
- `build-windows-bundle.js:37/376/380/393-401/687-724/819/851/853` 全部命中；NSI `:851/853` 确为引用 `启动 md2docx.cmd` 的 `CreateShortcut` ✅
- `puppeteer-config.js:19-20/69`、`app.js:151/154`、`dependency-check.js:50-76/85/104-105`、`md2docx.sh:9-19/27-43/45-53/90-91/114`、`api.md:21-22/36-39`、`windows-offline.md:163`、`docker-deployment.md:91` 全部命中 ✅
- `ENV_SCAN_FILES` 实扫 22 个变量（config.js 15 + plantuml-renderer 3 + puppeteer-config 1 + app.js 2 + md2docx.js 1）与 §6.2 表 20 行 + 黑名单 2（`LOCALAPPDATA`/`WINDIR`）**精确吻合，无遗漏、无误纳** ✅

## 总体结论

v5 对第四轮 **4 条放行条件的处置全部实质到位**：两张扫描清单定义清楚、`DOCFACT_SCAN_FILES` 覆盖了全部有值 `@docfact` 宿主文件（N1 的严重缺陷消除）；`verifyVersion` 改为自洽的双规则、首次发布可满足（N2 消除）；`document-format.md` 收敛为部分生成并新增点分标识符形式（N3）；`jsonFacts` + `factOwners` 让 `package.json` 事实有了正式入口（N4）。manifest 示例是**严格合法 JSON**，`envNotes`/`-nodefault` 已逐条枚举，`docs:status` 基线已定义，发布资产命名与 RELEASE-INFO 目标态写准。全部新引入/沿用的 `file:line` 经逐条打开**无一错误**。

架构与单一事实源判断：**不存在互相打架的真相源**——manifest 管结构（`:403`），代码常量（`@docfact`）与 `package.json` 字段（`jsonFacts` 指针，只存指针不存值）管事实，生成器与校验器只读 manifest（`:234/:403`）；一个事实值虽在"代码行 / 标记 / claim 锚点 / 生成表"多处出现，但每对相邻副本都有机器校验（守卫 / claim 检查 / 逐字节），链条闭合。设计**无需重开评审**。

但本轮机械模拟暴露出 v5 自身引入的事实面上有 **1 条守卫缺口**（`default_debug=false`），另有 **1 处由两清单修正派生的张力**（`-nodefault` 标记宿主不在 `DOCFACT_SCAN_FILES`）。二者都会在"照字面实现"时让 `verify:docs` 硬门禁**误报失败**，故本轮仍为**有条件通过**，2 条须在 §9 P0 第 1/2 步动手前写回方案。

## 新发现的问题1：守卫的三种合法形式不含布尔字面量，`default_debug=false` 会被拒绝 [中]

**位置**：方案 §6.2 `:296-299`（三种合法形式）、`:373`（`default_debug=false`）；`server/config.js:111`（`debug: bool(process.env.DEBUG, false)`）

v5 守卫规定 token 合法形式**三种**：数字（词边界）、字符串（`'token'`/`"token"`）、**点分标识符**（`FONT.黑体`）。`default_debug` 的值是 **布尔字面量 `false`**，在源码里以**裸 `false`** 出现（`config.js:111`），既非数字、无引号、也不是"点分"标识符。

本机按 `:293-299` 字面实现守卫，对 v5 列出的有值事实逐条模拟：**`default_debug=false` FAIL**（其余 17 条 PASS，反向探针 4/4 拒绝）。注意：该事实在第四轮的 9 条模拟中被遗漏，属**跨轮潜伏**，直到 v5 把环境变量表逐条枚举后才显形。

**影响**：`default_debug` 是 Tier A 事实（进 `configuration.md` 表、产 `default_*` 锚点）。按字面实现：
- 加 `// @docfact default_debug=false` 后守卫**拒绝**，`verify:docs`（硬门禁）红；
- §9 P0 第 1 步要求"闸门自身要成功一次"，此处必然失败——**照字面写会卡住 P0**。

**建议（写回方案）**：将第三种形式从"点分标识符"扩为"**裸标识符/关键字字面量**"（即 `false`/`true`/`FONT.黑体` 一视同仁，用词边界匹配）；或在 `:296-299` 明示"布尔字面量按裸标识符形式断言"。并在 §12.1 加一条自证（把 `default_debug` 改成 `true` → 失败）。

## 新发现的问题2：`-nodefault` 标记的宿主文件不在 `DOCFACT_SCAN_FILES`，与"非清单文件出现标记即失败"存在张力 [中]

**位置**：方案 §6.2 `:269`（`DOCFACT_SCAN_FILES` 定义）、`:270`（`ENV_SCAN_FILES`）、`:272-273`（"不在 `DOCFACT_SCAN_FILES` 中的文件里出现 `@docfact` 标记 → 失败"）、`:374-380`（`-nodefault` 登记）；代码：`scripts/puppeteer-config.js:69`、`server/app.js:151`、`scripts/md2docx.js:1563`

v5 的两个清单：
- `DOCFACT_SCAN_FILES` = config.js / cli.js / plantuml-renderer.js / build-windows-bundle.js
- `ENV_SCAN_FILES` = config.js / plantuml-renderer.js / **puppeteer-config.js** / **app.js** / **md2docx.js**

§6.2 要求 `ENV_SCAN_FILES` 中每个 `process.env.X` 都要有同行 `@docfact default_<key>=…` **或** `@docfact-nodefault <key>`（`:356`）。按"标记与常量同行"的硬规则（`:288`），下面 4 个 `-nodefault` 标记必须落在**不在 `DOCFACT_SCAN_FILES`** 的文件里：

| 变量 | 真实读取位置 | 是否在 `DOCFACT_SCAN_FILES` |
|---|---|---|
| `PUPPETEER_EXECUTABLE_PATH` | `scripts/puppeteer-config.js:69` | ❌ |
| `MD2DOCX_OPEN_BROWSER` / `NO_OPEN_BROWSER` | `server/app.js:151` | ❌ |
| `ENABLE_PAGINATION_PATCH` | `scripts/md2docx.js:1563` | ❌ |

于是 `:272-273` 的"非清单文件出现 `@docfact` 标记即失败"与 §6.2 的 `-nodefault` 登记**互相拉扯**：
- 若判定按 `@docfact` **前缀**匹配 → 这 4 个合法标记会触发"非清单文件出现标记"失败（**误报**）；
- 若判定只匹配 `@docfact key=value` → 不误报，但这 4 个标记**不被 Tier A 收集器读取**，只能依赖 `ENV_SCAN_FILES` 上另一套扫描，方案未言明。

**澄清**：这**不重演**第四轮的严重缺陷——`-nodefault` 无值、不产 claim 锚点（`:386-387`），其"存在性"由"未登记即失败"兜底，不存在"删标记即静默绕过"。故定级为中（契约自相矛盾/需一句话澄清），非严重。

**建议**：在 `:272-273` 明确"该失败规则仅针对 `@docfact <key>=<value>`（Tier A 有值标记），`@docfact-nodefault` 允许出现在 `ENV_SCAN_FILES` 的文件中并由 `doc-gen.js` 独立收集"；或把 `app.js`/`md2docx.js`/`puppeteer-config.js` 并入 `DOCFACT_SCAN_FILES`（则两清单=ENV_SCAN_FILES ∪ {cli, build-windows-bundle}）。

## 新发现的问题3：`envNotes` 判据句与枚举清单不自洽 [低]

**位置**：方案 §6.2 `:383-385`

判据句是"**无同行注释的变量**须在 `envNotes` 登记中文说明；登记缺失 → 失败"，随后列出 7 条：`DATA_DIR`、`PUPPETEER_EXECUTABLE_PATH`、`JAVA_HOME`、`MD2DOCX_OPEN_BROWSER`、`NO_OPEN_BROWSER`、`ENABLE_PAGINATION_PATCH`、`PLANTUML_BACKEND`。

但 `:359-381` 表中有 20 个变量，其中 `PORT`/`HOST`/`MAX_CONCURRENT`/`MAX_FILE_SIZE_MB`/… /`DEBUG` 等 13 个**同样没有人类可读说明**（只有机器标记）。若按判据句字面（"无同行注释即登记"），这 13 个也要 `envNotes`，首次生成必红——正是第四轮问题 8 的复发形态。显式清单（6 个 `-nodefault` + 1 个枚举型 `PLANTUML_BACKEND`）表明真实判据是"**无默认值 / 无法从标记自解释者**"。

**建议**：把判据句改写为"**无默认值（`-nodefault`）或默认值不足以自解释（如 `PLANTUML_BACKEND`）的变量**须登记 `envNotes`"，与 7 条清单对齐。

## 新发现的问题4：v5 修订记录承诺的"未映射代码变更提示"未写入 §6.4 [低]

**位置**：方案 `:17`（v5 处置）vs §6.4 `:481-487`

`:17` 称"并把'未映射的代码变更'也提示出来（不作为失败）"，但 §6.4 的关联级只有"命中 `source` 而 `docs` 未 touch → 警告"，**没有**"改动文件不在 `syncMap` 任何 `source` 中 → 提示"这条；§12 验证方法也无对应用例。承诺与正文不一致。

**建议**：或把该条写入 §6.4/§12，或删除 `:17` 的该半句。

## 新发现的问题5：`verifyVersion` 单调性未声明必须按 SemVer 语义比较 [低]

**位置**：方案 §6.5 `:498` 规则①

"已发布版本段自上而下**严格递减**"若用字符串比较，`1.10.0` < `1.9.0` 会误判（字符串序），而 SemVer 语义相反。§6.5 只写"SemVer"作为版本号格式，未写"比较须解析 major/minor/patch 而非字典序"。实现者可能踩坑。

**建议**：在规则①后加一句"版本比较按 SemVer 数值字段，禁用字典序"。

## 新发现的问题6：发布资产改名未覆盖 CI workflow 的引用 [低]

**位置**：方案 §6.5 `:500`；`.github/workflows/release-windows.yml:58-62/69-70`

§6.5 要求 zip 名带版本（`md2docx-win-x64-<ver>.zip`），但 `release-windows.yml` 的 `upload-artifact.name`、`path` 与 `action-gh-release.files` 仍写死 `dist/md2docx-win-x64.zip`。C3 只说"发布资产名带版本"，未点明要同步改 workflow 引用；漏改时 `upload-artifact` 匹配不到文件会**静默上传空产物**。

**建议**：在 C3 或 C9 明确"同步更新 `release-windows.yml` 的 artifact 名/路径/release files"。

## 新发现的问题7：`SIZE.正文` 是不存在的示例；点分标识符形式无实际事实使用 [低]

**位置**：方案 §6.2 `:299`；`scripts/md2docx.js:50/52-59`

守卫示例写 `FONT.黑体`、`SIZE.正文`，但 `SIZE` 只有 `小一/三号/小三/四号/小四/五号`（`:50`），**无 `正文`**；`FONT.正文` 亦不存在。且 N3 已把表格/题注划为人工维护，**方案中没有任何 Tier A 事实真正使用点分标识符形式**，该第三形式仅被本评审的探针验证、无实际用例。

**建议**：示例改用真实成员（如 `SIZE.小四`）；并决定该形式是否有真实用途（若仅备将来，注明"预留、当前无事实使用"）。

## 残留问题

1. **`factOwners` 双登记**：§6.2 `:343` 散文与 §6.3 manifest `:417-424` 重复列出归属规则，是潜在漂移面（第四轮已注意，v5 未收敛）。建议 §6.2 只引用 manifest，不重列。
2. **`jsonFacts` 命名**：`package.json#engines.node` 是**点分属性路径**，非 RFC6901 JSON Pointer（应为 `/engines/node`）。功能无碍，但"JSON 指针"的措辞与格式不符，建议统一措辞或改用标准指针。
3. **macOS 字体、`disabled/applicable`、`doccheck` 无害**等前几轮结论，本轮未发现回退。
4. **`syncMap` 仍缺 3 个源**（plantuml-renderer/md2docx.sh/puppeteer-config）：因关联级已降为 warn，不构成阻断，但 §2 目标 4 的"不依赖人记得"仍只在事实级闭合。

## 达成的共识 / 值得保留

1. **N1 的修正扎实**：两张清单显式声明、`DOCFACT_SCAN_FILES` 覆盖全部有值标记宿主、且"非清单文件出现标记即失败"提供了纵深防御；文档内 35 处 `@docfact` 出现点经 grep 全覆盖核对。
2. **`verifyVersion` 重写正确**：单调性与发布态解耦，首次发布可满足，无鸡生蛋；配套 tag↔version 校验补上了第四轮问题 9 的缝。
3. **`jsonFacts` 是干净的第二种来源**：只存指针不存值，`package.json` 仍是唯一事实源，未制造 competing source。
4. **manifest 示例为严格 JSON**（实测 `JSON.parse` OK），生成物/包内子集/导航/锚点归属均由 manifest 派生，"不写死"方向成立。
5. **全部 `file:line` 抽检正确**（含 `md2docx.js:75-123`、`config.js:39/111`、`cli.js:50`、`plantuml-renderer.js:246-307/342/395`、`bbw.js:376/819/851/853`），未发现新的失实引用。
6. **环境变量表 22/22 对得上**（20 进表 + 2 黑名单），生成契约的 `<key>` 映射与三开关登记完备。

## 优先级

| 优先级 | 问题 | 建议 |
|---|---|---|
| **P0（放行条件）** | 新问题 1：守卫三形式不含布尔字面量，`default_debug=false` 会失败 | 扩为"裸标识符/关键字"，或明示布尔按裸标识符断言；补自证 |
| **P0（放行条件）** | 新问题 2：`-nodefault` 标记宿主不在 `DOCFACT_SCAN_FILES`，与"非清单文件出现标记即失败"张力 | 一句话豁免 `-nodefault`，或把三文件并入清单 |
| P2 | 新问题 3：`envNotes` 判据句与 7 条清单不自洽 | 改写判据为"无默认值/需语义说明者" |
| P3 | 新问题 4：`syncMap`"未映射变更提示"承诺未落文 | 补入 §6.4/§12 或删承诺 |
| P3 | 新问题 5：单调性未声明按 SemVer 语义比较 | 加一句禁用字典序 |
| P3 | 新问题 6：CI artifact 名/路径未随资产改名同步 | C3/C9 明确同步 |
| P3 | 新问题 7：`SIZE.正文` 示例不存在；点分形式无实际用例 | 换真实示例并注明用途 |
| P3 | 残留：`factOwners` 双登记、`jsonFacts` 非标准 JSON Pointer 措辞 | 收敛为单处 / 统一措辞 |

## 评审结论

**有条件通过。**

第四轮 4 条放行条件**全部实质解决**（N1 扫描清单覆盖全部有值标记、N2 版本闸门自洽且首次可满足、N3 内容收敛 + 点分标识符、N4 JSON 指针 + 归属），5 项低优先亦基本到位；全部代码 `file:line` 抽检正确，manifest 示例为合法 JSON，单一事实源无竞争。方案架构**无需重开评审**。

但 v5 把事实面从 9 条扩到 18 条后，机械模拟暴露出 **1 条守卫缺口 + 1 处两清单张力**，二者在"照字面实现"时会让 `verify:docs` 硬门禁**误报失败、卡住 P0**：

1. **守卫须接受布尔/裸标识符字面量**（新问题 1）——否则 `default_debug=false` 恒失败，§9 P0 第 1 步"闸门自身成功一次"过不了。
2. **`@docfact-nodefault` 与 `DOCFACT_SCAN_FILES` 的关系须澄清**（新问题 2）——否则 `puppeteer-config.js`/`app.js`/`md2docx.js` 里的合法标记会触发"非清单文件出现标记即失败"。

其余（新问题 3-7 与残留项）为 P2/P3，可在实施中一并处理，不阻断。

**本轮共发现 7 个问题：0 严重 / 2 中 / 5 低。**
