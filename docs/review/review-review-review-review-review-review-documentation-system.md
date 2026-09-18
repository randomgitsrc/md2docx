# 评审（第六轮）：文档体系方案 v6

## 评审日期
2026-09-17

## 评审范围

**文档**

- `docs/plans/documentation-system.md`（v6，690 行，逐行核对，含 `## 0. 修订记录` 的 v6 段）
- `docs/review/review-documentation-system.md`（第一轮）
- `docs/review/review-review-documentation-system.md`（第二轮）
- `docs/review/review-review-review-documentation-system.md`（第三轮）
- `docs/review/review-review-review-review-documentation-system.md`（第四轮，363 行）
- `docs/review/review-review-review-review-review-documentation-system.md`（第五轮，232 行）

**代码（逐条打开核对，非仅阅读）**

- `server/config.js`、`server/app.js`、`server/services/dependency-check.js`
- `scripts/md2docx.js`、`scripts/cli.js`、`scripts/plantuml-renderer.js`、`scripts/puppeteer-config.js`
- `scripts/build-windows-bundle.js`、`scripts/self-check.js`、`scripts/preprocess.js`
- `scripts/md2docx.sh`、`package.json`、`.github/workflows/release-windows.yml`
- `docs/api.md`、`docs/http-service.md`、`docs/deployment/windows-offline.md`、`docs/plans/docker-deployment.md`

**实际执行的命令（证据）**

1. 提取方案内**全部** `file:line` 引用（约 50 处）并逐条打开核对：
   `md2docx.js:50/52/55/61/63/75-123/1432-1433/1563`、`config.js:38-73/52-57/68-72/80/83/111`、
   `puppeteer-config.js:19-20/69`、`app.js:151/154`、`build-windows-bundle.js:37/136-144/295/312/376/380/
   395/470-493/623-639/687-724/731/851/853`、`api.md:21-22/36-39`、`preprocess.js:102-136`、
   `http-service.md:84/173/174/188`、`dependency-check.js:50-76/85`、`plantuml-renderer.js:71-83/246-295/
   275-288/289-294/307/423-428/517`、`self-check.js:5/199-212/248-253`、`md2docx.sh:9-19/27-43/45-53/90-91/114`、
   `windows-offline.md:163`、`docker-deployment.md:91`。
2. 全仓扫描 `process\.env\.[A-Za-z_]\w*`（8 个文件命中），对照 v6 §6.2 注册表"参与 env 扫描"列与 20 行环境变量表。
3. **机械模拟 v6 §6.2 守卫（`:`301-313` 四种 token 形式：数字词边界 / 布尔字面量 / 引号字符串 / 点分标识符）**：
   对 v6 列出的**全部** 17 条有值事实（13 条 `default_*` + `clean_dir`/`docx_dir` + `backend_values` +
   `default_plantuml_backend` + `entry_cmds`）逐条跑，外加重放 9 条**反向探针**。脚本落在系统临时目录
   （`.../Temp/opencode/r6/guard.js`），评审后删除。
4. 抽取 v6 §6.3 的 ```json 清单块并 `JSON.parse`。
5. SemVer 比较器核验（数值段 vs 字符串序）。
6. `git status --porcelain`、`Select-String` 读 `.github/workflows/release-windows.yml` 的 artifact 名。
7. 未 `require('./server/config')`；未改动任何被跟踪文件（本评审为唯一新增）；`node` 不在 PATH，
   用 `D:\home\apps\DeepSeekHarness\node\node.exe`（v24.20.0）。

## 第五轮条件的处置核对

| 条件 | 是否到位 | 证据 |
|---|---|---|
| **条件 1 [中] 守卫三种 token 形式不含布尔字面量，`default_debug=false` FAIL** | **到位** | §6.2 `:308-313` 扩为**四种形式**（新增"布尔字面量 `true`/`false`，词边界"）；`:323` 单值示例含 `debug: bool(process.env.DEBUG, false)`；§12 `:672` 补自证"把 `default_debug=false` 改成 `true` → 失败"。机械模拟：`default_debug=false`（`config.js:111`）**PASS（bool 形式命中）**，反向探针 `false` vs `true` **被拒**（详见下表） |
| **条件 2 [中] `@docfact-nodefault` 宿主文件不在扫描清单，与"非清单文件出现标记即失败"冲突** | **到位** | §6.2 `:271-282` 改为**单一文件注册表**（一张表两个用途列）；"可携带 `@docfact`"列含全部 7 个宿主文件，`scripts/puppeteer-config.js`/`server/app.js`/`scripts/md2docx.js` 已纳入。枚举 v6 全部标记宿主并交叉核对（见下表），**7/7 覆盖，无遗漏** |
| 低：`envNotes` 判据句与清单不自洽 | **基本到位** | §6.2 `:413-416` 判据改为"由生成器报告缺注释项，实施时以报告为准"，7 条标为**预期值**。残留措辞歧义见"残留问题 1" |
| 低：`syncMap`"未映射变更提示"承诺未落文 | **到位** | §6.4 `:505` 明写 `docs:status` "并列出未被 `syncMap` 覆盖的源码变更（提示级，不失败）" |
| 低：单调性未声明按 SemVer 语义 | **到位** | §6.5 `:518` 规则①明写"按 SemVer 语义比较（主→次→修订逐段数值比较，**不是字符串排序**，否则 `1.10.0` 会被误判小于 `1.9.0`）"。核验：数值比较 `1.10.0 > 1.9.0` 成立，字符串序 `'1.10.0' > '1.9.0'` 为 false（确认非字符串排序是必要的） |
| 低：CI artifact 名未随资产改名同步 | **到位（目标态）** | §6.5 `:520`、§8 `:568`、§9.0 **C9** `:593` 三处均写"artifact 名与路径同步改为带版本"。核对现状：`release-windows.yml:58` name=`md2docx-win-x64`、`:60/:69` path=`dist/md2docx-win-x64.zip` 确与目标不符，属 C9 待改项，方案已写准 |
| 低：`SIZE.正文` 是不存在的示例 | **到位** | §6.2 `:313` 示例改为真实键名 `SIZE.小四`（`md2docx.js:50`）、`FONT.黑体`（`:55`）、`PAGE.marginTop`（`:63`）。逐条核对：`md2docx.js:50` 定义 `SIZE`（含 `小四`）、`:55` = `黑体:`、`:63` = `marginTop:`，**全部命中** |

### 条件 2 核对：v6 全部标记宿主 vs 注册表"可携带 `@docfact`"列

| 标记（v6 位置） | 宿主文件 | 在注册表第 1 列？ |
|---|---|---|
| `default_port` / `default_host` / `default_max_concurrent` / `default_queue_limit` / `default_debug`（`:319-323`） | `server/config.js` | ✅ |
| `default_max_file_size_mb` … `default_job_timeout_ms`（`:395-402` 表，对应 `config.js:93-108`） | `server/config.js` | ✅ |
| `-nodefault data_dir`（`:405`） | `server/config.js:39` | ✅ |
| `clean_dir` / `docx_dir`（`:330`） | `scripts/cli.js` | ✅ |
| `backend_values` / `default_plantuml_backend`（`:336/338`） | `scripts/plantuml-renderer.js`（`:395`） | ✅ |
| `-nodefault java_home`（`:407`） | `scripts/plantuml-renderer.js:342` | ✅ |
| `entry_cmds`（`:345`） | `scripts/build-windows-bundle.js` | ✅ |
| `-nodefault puppeteer_executable_path`（`:351`） | `scripts/puppeteer-config.js:69` | ✅ |
| `-nodefault no_open_browser` / `-nodefault md2docx_open_browser`（`:355`） | `server/app.js:151` | ✅ |
| `-nodefault enable_pagination_patch`（`:359`） | `scripts/md2docx.js:1563` | ✅ |
| `engines_node`（`jsonFacts`，非文件标记） | `package.json#engines.node` | N/A（不受扫描清单约束） |

**结论**：v6 全部 7 个宿主文件均在第 1 列，`@docfact`/`@docfact-nodefault` **无一落在注册表之外**；
第五轮的"两张清单不同步"张力已消除。

### 守卫机械模拟（v6 §6.2，四种形式逐字实现）

| 事实 | 结果 | 命中形式 |
|---|---|---|
| `default_port=8080` | PASS | number |
| `default_host=127.0.0.1` | PASS | quoted |
| `default_max_concurrent=2` | PASS | number |
| `default_queue_limit=50` | PASS | number |
| `default_max_file_size_mb=20` | PASS | number |
| `default_max_diagrams=30` | PASS | number |
| `default_job_ttl_minutes=60` | PASS | number |
| `default_cleanup_interval_minutes=10` | PASS | number |
| `default_graceful_timeout_ms=30000` | PASS | number |
| `default_rate_limit_per_minute=20` | PASS | number |
| `default_health_cache_ttl_ms=60000` | PASS | number |
| `default_job_timeout_ms=900000` | PASS | number |
| **`default_debug=false`**（`config.js:111`，第五轮 FAIL） | **PASS（已修复）** | bool |
| `clean_dir=output/clean` / `docx_dir=output/docx` | PASS | quoted |
| `backend_values=core\|jar\|auto` | PASS | quoted ×3 |
| `default_plantuml_backend=auto` | PASS | quoted |
| `entry_cmds=启动 md2docx.cmd,转换文档.cmd,自检.cmd` | PASS | quoted ×3 |
| **反向** `default_debug=false` vs 代码 `true` | 拒绝 ✓ | — |
| **反向** `default_max_concurrent=2` vs `..., 20)` | 拒绝 ✓（`2` 后紧邻数字 `0`） | — |
| **反向** `default_queue_limit=50` vs `..., 5)` | 拒绝 ✓ | — |
| **反向** `default_port=8080` vs `..., 808)` | 拒绝 ✓ | — |
| **反向** `clean_dir=output/docxs` | 拒绝 ✓ | — |
| **反向** `backend_values=core\|jar\|autox` | 拒绝 ✓ | — |
| **反向** `default_max_file_size_mb=20` vs `..., 200)` | 拒绝 ✓ | — |
| **反向** `default_host=127.0.0.1` vs `'127.0.0.2'` | 拒绝 ✓ | — |
| **反向** `entry_cmds` vs 代码改 `启动 md2docx-x.cmd` | 拒绝 ✓ | — |

**结论**：17/17 有值事实 **PASS**，9/9 反向探针**正确拒绝**（总计 26/26）。第五轮的守卫缺口**已闭合**。

### `process.env` 全仓扫描 vs v6 注册表/环境变量表

- 扫描列 5 文件实得 22 个读取点：`config.js` 15（含 `DATA_DIR`、`LOCALAPPDATA`）、`plantuml-renderer.js` 3（`WINDIR`、`JAVA_HOME`、`PLANTUML_BACKEND`）、
  `puppeteer-config.js` 1、`app.js` 2、`md2docx.js` 1。
- 扣掉黑名单在扫描列内的 2 个（`LOCALAPPDATA`、`WINDIR`）= **20**，与 §6.2 环境变量表 20 行**精确吻合**，无遗漏、无误纳。
- 注册表第 2 列与第 1 列均含 `scripts/md2docx.js`，其唯一 env 读取 `ENABLE_PAGINATION_PATCH`（`:1563`）已登记 `-nodefault`。

### 清单示例 JSON 校验

`docs/plans/documentation-system.md` 内**唯一** ```json 块 `JSON.parse` **OK**；顶层键
`version/docs/jsonFacts/factOwners/generated/syncMap/envNotes` 齐全（docs=2、jsonFacts=1、factOwners=6、
generated=3、syncMap=8、envNotes=3；docs 与 envNotes 为示意性子集）。

## 总体结论

v6 对第五轮 **2 条放行条件的处置全部实质到位**：守卫扩为四种 token 形式后，机械模拟 17/17 有值事实
PASS、9/9 反向探针被拒（`default_debug=false` 这一跨轮潜伏缺口闭合）；两清单合并为**单一文件注册表**，
v6 全部 7 个 `@docfact`/`@docfact-nodefault` 宿主文件均在第 1 列，与"非清单文件出现标记即失败"不再冲突。
5 项低问题中 4 项明确落文、1 项（`envNotes`）以"生成器报告为准"化解。manifest 示例为**严格合法 JSON**；
SemVer 单调性按数值段比较的表述经核验正确；全部约 50 处 `file:line` 引用**逐条打开无一错误**
（唯一内容是 `md2docx.js:1563` 的示例行形状，见新问题 1）。

架构判断：**不存在互相打架的真相源**。manifest 管结构（`:236/:430`），代码常量（`@docfact`）与
`package.json` 字段（`jsonFacts` 只存指针不存值）管事实，生成器/校验器只读 manifest；每个事实值在
"代码行 / 标记 / claim 锚点 / 生成表"多处出现，但相邻副本间都有机器校验（守卫 / claim 检查 / 逐字节）。
链条闭合，**设计无需重开评审**。

关于"是否过度设计"：总体**与目标相称**——仓库已有构建闸门（`assertBundleContents`/`verifyBundleCode`/
`smokeTestBundle`）与 CI，把"文档不过期"接进同一体系边际成本确实低；`document-format.md` 明确
"`documentStyles` 不自动化"、`syncMap` 首期只 warn、版本闸门与 `package.json` 解耦，都是有节制的取舍。
可挑剔之处仅在 P0 内部排序：第 1-6 步先把基础设施（注册表/生成器/C11/manifest）做在前面，而最大的两个
缺口（README、给文档作者的 how-to）排到 P0 第 7-10 步——**建议实施时把 README 与 `how-to/write-markdown.md`
提前**，以便尽早产生用户价值；这属排序偏好，不构成设计缺陷。

## 新发现的问题1：`md2docx.js:1563` 的 `-nodefault` 示例与真实代码形状不符 [低]

**位置**：方案 §6.2 `:357-359`；代码 `scripts/md2docx.js:1562-1565`

v6 给出的无默认值事实示例为：

```js
// scripts/md2docx.js
const ENABLE_PAGINATION_PATCH = process.env.ENABLE_PAGINATION_PATCH === '1';   // @docfact-nodefault enable_pagination_patch
```

但真实代码（`md2docx.js:1562-1565`）是：

```js
  // 如需回退旧行为（比对历史产物等），设 ENABLE_PAGINATION_PATCH=1。
  if (process.env.ENABLE_PAGINATION_PATCH === '1') {
    patchDocxPagination(outputPath);
  }
```

全仓 `ENABLE_PAGINATION_PATCH` 仅此一处，**并不存在 `const ENABLE_PAGINATION_PATCH`**。且 v6 自己的 §9.0 C1
把改动限定为"3 个文件有机械的常量替换改动"（`cli.js`/`plantuml-renderer.js`/`build-windows-bundle.js`），
`md2docx.js` 只列"`-nodefault` 标记"——即**本方案不打算在 `md2docx.js` 引入新常量**。两处措辞因此互相矛盾。

**影响**：`-nodefault` 只登记存在性、不做值断言，守卫**不会**因此失败（不阻断 P0）。但按示例字面实施有两种
走偏：(a) 找不到该 `const` 而无从下手；(b) 真的新建 `const` 却忘了把 `:1563` 的 `if` 改用它，使
`process.env.ENABLE_PAGINATION_PATCH` 在**两行**出现，若 `doc-facts` 按"出现点"而非"变量名"判未登记，
会触发"未登记环境变量即失败"。此外，§6.2 `:298` 的硬规则写"标记必须与它所描述的**真实常量**处于同一行"，
而 `:1563` 是 `if` 语句、本无常量，规则措辞也需放宽为"真实读取位置/常量"。

**建议（写回方案，无须再审）**：把示例改为真实形状——

```js
  if (process.env.ENABLE_PAGINATION_PATCH === '1') {   // @docfact-nodefault enable_pagination_patch
```

并将 `:298` 硬规则改为"标记必须与它所描述的真实读取位置（常量声明或 `process.env.X` 读取处）处于同一行"。
同时明确 `doc-facts` 的"未登记即失败"按**变量名**去重判定（`java_home` 在 `:342` 同行两次、
`data_dir` 在 `config.js:39` 同行两次已是同类情形）。

## 残留问题

1. **`envNotes` 判据仍留歧义（低）**：§6.2 `:413` 判据为"进表且**无同行注释**的变量必须登记"，而
   `PORT`/`HOST`/`MAX_CONCURRENT`/… /`DEBUG` 等 13 条同样没有人类可读同行说明（只有机器标记）。
   若生成器把"无同行人类注释"字面执行，报告数会**多于**列出的 7 条。v6 已用"以报告为准 + 7 为预期"
   化解了"首次生成必红"，故不阻断；但建议把判据写成"**无默认值（`-nodefault`）或默认值不足以自解释
   （如枚举型 `PLANTUML_BACKEND`）的变量**须登记"，与 7 条预期对齐。
2. **`factOwners` 双登记未收敛（低）**：§6.2 Tier A 检查项 #2 `:373` 复述了归属规则，
   §6.3 manifest `factOwners`（`:446-453`）又列一遍，仍是潜在漂移面。建议 §6.2 只引用 manifest。
3. **`jsonFacts` 用点分路径**（`package.json#engines.node`）而非 RFC6901 JSON Pointer（`/engines/node`）；
   功能无碍，措辞可统一。
4. **`syncMap` 仍缺 3 个源**（`scripts/plantuml-renderer.js`、`scripts/md2docx.sh`、`scripts/puppeteer-config.js`）：
   因关联级已降为 warn、且未覆盖源由 `docs:status` 提示，不阻断。
5. **点分标识符形式无实际 Tier A 事实使用**（示例已换真实键名，但无键采用该形式）；可注明"预留"。
6. **`entry_cmds` 值的切分约定未写死**：`重` 值含空格（`启动 md2docx.cmd`），方案未言明标记片段
   如何定界。本模拟采用"值延伸至下一个 `@docfact` 或行尾"（唯一使 `entry_cmds` 通过的读法），
   建议在 §6.2 明写。属实现细节，不阻断。
7. manifest 示例 `envNotes` 仅 3 条（预期 7 条）——示例性子集，非矛盾。

## 达成的共识 / 值得保留

1. **单一文件注册表是正确收敛**：一张表两个用途列，彻底消除"两张清单不同步"的复发面；
   "非该列文件出现标记即失败"+"已知事实缺标记即失败"提供双向完整性。
2. **守卫四形式经机械模拟自证**：17 条事实全 PASS、9 条反向全拒，第五轮缺口闭合；布尔/数字/字符串/
   点分标识符四类覆盖当前全部事实形态。
3. **`verifyVersion` 双规则自洽**：单调性（数值段比较）与发布态解耦，`1.10.0 > 1.9.0` 用数值序、
   显式禁用字符串排序，首次发布可满足，无鸡生蛋。
4. **manifest 为严格 JSON 且为唯一结构源**：导航/包内子集/锚点归属/链接范围/事实表全部派生，
   "不写死"方向成立；示例 `JSON.parse` 通过。
5. **全部 `file:line` 引用抽检正确**（约 50 处），未发现新的失实引用（唯一形状不符为 `:1563` 示例，
   已单列）。
6. **环境变量 22/22 对得上**（20 进表 + 2 黑名单在扫描列内），`-nodefault` 与 `envNotes` 逐条枚举。
7. **`documentStyles` 明确不自动化**（部分生成 + 失败即报错），是全案最克制的取舍。
8. **`@docfact` 标记不写进 `package.json`、改走 `jsonFacts` 指针**，未制造 competing source。

## 优先级

| 优先级 | 问题 | 建议 |
|---|---|---|
| P3（非阻断，实施首个 PR 内顺手改） | 新问题 1：`md2docx.js:1563` 示例行形状不符；硬规则"真实常量"措辞 | 示例改用真实 `if` 行；硬规则改"真实读取位置/常量"；明确按变量名去重 |
| P3 | 残留 1：`envNotes` 判据措辞 | 改为"无默认值或默认值不自解释者须登记" |
| P3 | 残留 2/3/4/5/6：`factOwners` 双登记、JSON Pointer 措辞、`syncMap` 缺源、点分形式无用例、`entry_cmds` 定界 | 实施中一并收敛；均不阻断 |

## 评审结论

**通过。**

第五轮 **2 条放行条件全部实质解决**：布尔字面量形式补齐（`default_debug=false` 由 FAIL 转 PASS，
且反向探针正确拒绝）；`-nodefault` 宿主文件经**单一注册表**全部纳入（7/7 覆盖），张力消除。
5 项低问题 4 项明确落文、1 项以"生成器报告为准"化解。manifest 示例为合法 JSON、SemVer 单调性表述正确、
全部 `file:line` 引用正确、环境变量表 22/22 吻合、设计无竞争真相源、**无需重开评审**。

本轮仅 1 条**非阻断**的文档级问题（`md2docx.js:1563` 的示例与真实代码形状不符，属措辞/示例修正，
不改变任何校验语义），另有若干 P3 残留项，均可在实施中随手处理，不影响放行。

**本轮共发现 1 个问题：0 严重 / 0 中 / 1 低（另 7 项 P3 残留）。**
