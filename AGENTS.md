# AGENTS.md — md2docx 项目工作指南

面向 AI 编码助手的项目约定与操作指南，是本项目规则的**权威源**（`CLAUDE.md` 仅以 `@AGENTS.md` 引入本文件）。聚焦 **「必须遵守的约定」「已知陷阱」「工作流程」「验证方法」**。

## 项目概览

md2docx 将中文技术文档 Markdown 转换为符合《技术文档格式-20260525》规范的 DOCX（封面 + 目录 + 正文三节，Word 自动多级编号、题注、横置大图）。**任何改动不得破坏既有输出规范**，样式基准见 `01-base/技术文档格式-20260525.md`。

## 常用命令

```bash
npm install                                            # 首次安装依赖
./scripts/md2docx.sh md/xxx.md                         # 推荐：完整两阶段流水线（可批量传多文件）
node scripts/preprocess.js md/xxx.md                   # 阶段1：预处理 → md/output/clean/xxx.clean.md
node scripts/md2docx.js md/output/clean/xxx.clean.md   # 阶段2：转 DOCX → md/output/docx/xxx.docx
node scripts/build_template.js                         # 参考模板生成器（硬编码路径，不进流水线）

# HTTP 服务（详见 docs/http-service.md 与 docs/api.md）
node server/app.js                                     # 启动服务（默认 http://127.0.0.1:8080）
PORT=8080 MAX_CONCURRENT=2 node server/app.js           # 可选环境变量（见 server/config.js）
```

产物目录（均已被 .gitignore 忽略，勿提交）：
- `md/output/clean/` — 预处理后 markdown
- `md/output/docx/` — 最终 DOCX
- `md/output/.mermaid/`、`md/output/.plantuml/` — 图表 PNG / 源文件缓存
- `data/jobs/` — HTTP 服务作业工作目录（每作业一个子目录）

## 核心约定（必须遵守）

### 图表渲染配色（技术文档严谨风格）

md2docx 转换时，mermaid 与 PlantUML 图表**默认注入灰阶/黑白主题**，去除各自默认的彩色（蓝/紫/黄）"AI 味"，使输出符合技术文档的严谨风格。

**默认主题：**

| 图表类型 | 默认主题 | 注入指令 | 效果 |
|---|---|---|---|
| mermaid | `neutral` | `%%{init: {'theme': 'neutral', 'flowchart': {'curve': 'linear'}}}%%` | 浅灰节点框 + 灰边框 + 黑字 + 直线连线 |
| PlantUML | `plain` | `!theme plain` | 白底 + 黑框 + 黑线（黑白线稿） |

**改动位置：**
- mermaid：`scripts/preprocess.js` 的 `renderMermaidBlocks`——渲染前在 mermaid 代码块顶部注入 init 指令（仅当用户未写 `%%{init}%%` 时）
- PlantUML：`scripts/plantuml-renderer.js` 的 `injectTheme()`——在 `@startuml` 后注入 `!theme plain`（仅当用户未写 `!theme` 时），位于 `injectChineseFont()` 之前（字体配置需在主题之后，避免被主题覆盖）

**优先级规则（重要）：** 用户在 markdown 代码块里显式配置的主题/初始化指令永远优先，注入逻辑不覆盖（mermaid 检测 `%%{init:` 开头 → 不注入；PlantUML 检测 `!theme <name>` → 不注入）。默认走灰阶；作者想要彩色（如 `!theme cerulean`、`%%{init: {'theme':'default'}}%%`）则保留其选择。

**切换/自定义默认主题：** 修改对应注入指令即可（mermaid 极简白底用 `'theme':'base'` + themeVariables；恢复彩色则删除注入逻辑）。改动后需端到端 + vision 复核验证。

### Markdown 源文约定

- `#`（H1）仅用于封面标题（文档标题）；章节标题一律从 `##` 起。md 中存在多个 `#` 会告警且多余的被忽略。
- 章节编号由 Word 自动生成：**标题不要手写编号**。preprocess 会剥离 `## 1 范围` 这类手动编号（`5G 网络`、`3D 打印` 等已排除不剥），但直接跑 md2docx.js 时不剥离——改正则需自测。
- 题注格式：`图 X-X 名称` / `表 X-X 名称`，图注在图**下方**、表注在表**上方**。preprocess 会把题注行包成 `**加粗**` 供 md2docx 识别为 Caption 样式（居中）。
  - **判定以结构位置为主，不是字面模式**（`markCaptions`）：表题注须向下（跳过空行，最多再跳过 2 个题注行）首个内容是表格行；图题注须向上同理跳到图片引用或代码块围栏（后者对应"渲染失败降级为代码块"）。这条约束是必需的——仅按字面判断会大量误判正文并居中，如 `图3显示了系统架构`、`表 3-1 列出了主要参数`。
  - 「可跳过题注行」用于支持**双行题注**：`表89 结构体成员变量定义`（描述行）+ `表 3-364`（编号行）都在表格上方，两行都要居中。
  - 编号写法均兼容：`表 3-01 名称`、`表 3.2 名称`、`表89 名称`、`表4无分隔符`、仅编号 `表 3-354`、引用块 `> 图 3-1 名称`（识别时去掉 `>`，输出为居中题注而非引用样式）。
  - 非相邻兜底：严格形式 `表 1-1 名称`（空格 + 章节号）且名称不以正文承接词（`中/所/列/为/是/显…`，见 `CAPTION_PROSE_HEAD_RE`）开头时仍识别，避免历史文档回退。
  - **强制指定**：手工写成 `**表 1-1 名称**` 即可——已加粗行直接放行，md2docx 的 `isCaptionText` 按字面识别、不依赖相邻（这是刻意保留的非对称：preprocess 管自动识别，`isCaptionText` 管人工覆盖）。
  - 回归用例：`md/qa/caption-forms.md`（10 条各种写法的题注 + 10 条易误判正文，要求题注全中、正文 0 误判）。
- 列表一律用 `-` 前缀；`a)`、`(1)`、`1)` 等手动编号由 preprocess 剥离，交给 Word 自动编号。
- 图表代码块语言标签必须是 ` ```mermaid ` / ` ```plantuml `。

### 图表渲染失败降级

渲染失败 → 降级为 ` ```text ` 代码块（**不能**降级回原语言标签，否则 md2docx 阶段会重复渲染再次失败）。这是设计预期，不是 bug。

## 已知陷阱（改动前必读）

1. **双路渲染差异**：preprocess 已把图表渲染为 PNG 后，md2docx 走「图片引用」路径（按 PNG 实际尺寸判断横置：`downscaleRatio > 3 && aspectRatio > 2.0`）；直接跑 md2docx.js 时，mermaid/plantuml fence 由 md2docx 自己渲染（mermaid 按源码拓扑 `widthScore > 5` 判断横置）。同一图在两条路径下横置行为可能不同——**改横置逻辑必须两处都验证**。
2. **列表编号池**：每个顶层列表分配独立 numbering reference（`list-l1/l2/l3-N` 池）使编号从 1 重新开始；池大小由 `countTopLevelLists` 动态预算。**绝不回绕复用 numId**（历史 bug：复用会导致编号延续上一组）。池耗尽会抛错暴露问题，这是故意的——不要改成静默复用。
3. **横置 section 与 pendingLandscapeClose**：大图横置用独立 section，靠 `pendingLandscapeClose` 标志延迟恢复竖置（图注进来才关；无图注时遇到下一个非题注 token 也关）。题注若写在图片**前**，`keepNext` 无法把图片和图注绑定，分页控制失效。
4. **分页后处理**：`patchDocxPagination()` 用 python-docx 注入 `cantSplit`/`keepNext`/`keepLines`（依赖 python3 + python-docx）。改分页相关逻辑时，docx.js 样式层与后处理层**不要重复注入**。
5. **mermaid init 注入位置**：必须在写入 `.mmd` 文件**前**注入。preprocess 已渲染所有 mermaid，md2docx.js 的 init 注入只是兜底（实践中几乎不触发）。
6. **图片缩放**：竖置 `fitImageToPage` / 横置 `fitImageToLandscape` 都先按宽缩放再 clamp 高度；`CONTENT_HEIGHT_PX` 用 0.90 系数（为标题/图注留余量）。
7. **宽表列宽必须逐列分摊差值**：列数多时（如 33 列的位域表），若列宽下限（8%）总和超过页面总宽，把差值一次性加到"最大列"上会把该列压成负数，触发 docx 抛 `Invalid value '-N' specified. Must be a positive integer.`（整篇转换失败）。因此下限取 `min(8%, 总宽/列数)`，差值**逐列 ±1 分摊**，且取值处不能用 `||` 兜底（负值在 JS 中为 truthy）。回归用例：`md/qa/wide-table.md`。
8. **PlantUML 结束标记**：块内只有 `@startuml` 而漏 `@enduml` 时，PlantUML 退出码仍为 0、只在 stderr 提示 `No diagram found` 且不产文件。`ensureEndMarker()` 会自动补全；报错行号需减去注入的 theme/font 行数偏移（`buildRenderError` 的 `injectedLineOffset`），否则指向错误源码行。回归用例：`md/qa/plantuml-no-end.md`。
9. **PlantUML 名称需加引号**：组件/节点名含 `()`、`/`、`-` 等字符时不加引号会被当成表达式解析而渲染失败（如 `c3 as 服务进程通信(消息队列)`、`sjwz --> GMS-DM-BWJC : ...`）。正确写法：`c3 as "服务进程通信(消息队列)"`、`sjwz --> "GMS-DM-BWJC" : ...`。此类失败按约定降级为代码块，不影响整篇转换；渲染失败后会自动尝试补引号（`fixUnquotedNames`）。
10. **必须在读取后统一换行为 LF**：JS 正则中 `.` **不匹配 `\r`**（`\r` 属行终止符），CRLF 文件里不带 `m` 标志的 `...$` 会因行尾残留 `\r` 而失配。后果是**静默失效**（不报错、只是没生效）：题注加粗、标题手写编号剥离、列表手动编号剥离全部不工作，且 `\s*` 恰好吃掉 `\r` 的情况还会造成"部分生效"的假象（如仅编号题注 `表 3-354` 能中、带名称的 `表 3-01 名称` 不能）。preprocess 与 md2docx 读取后都必须执行 `.replace(/\r\n?/g, '\n')`。回归用例：`md/qa/crlf-test.md`。

## 工作流程：计划 → 评审 → 实施

本项目为较大改动维护设计文档，既定流程：
1. `docs/plans/xxx.md` — 先写方案（含背景、代码位置、风险点、验证方法）
2. `docs/review/review-xxx.md` — 评审方案并修正（可多轮：`review-xxx.md` → `review-review-xxx.md` → …）
3. 实施 + 端到端验证
4. **归档**：过时/失效文档移入 `docs/archived/`（`plans/` 与 `review/` 子目录）——包括被迭代版本替代的方案、已实施完成的方案、已放弃的方案（文件头 `status: deprecated` + `reason`）、已完成使命的评审。**归档 = 移动位置，不删除**，保留决策痕迹；当前有效的设计文档（如 `plans/large-image-landscape-v5.md`）留在活跃目录。

小改动可跳过文档流程，但需跑端到端验证。

## 样式速查

字号/字体/页面参数定义在 `scripts/md2docx.js` 顶部（`SIZE`/`FONT`/`PAGE` 常量，half-points 单位），与 `01-base/技术文档格式-20260525.md` 对应：

| 元素 | 中文字体 | 字号 |
|---|---|---|
| 正文 | 仿宋 | 小四(24) |
| 标题1 | 黑体 | 小三(30) |
| 标题2 | 楷体 | 小三(30) |
| 标题3/4 | 仿宋 | 四号(28) |
| 标题5 | 仿宋 | 小四(24) |
| 封面标题 | 方正小标宋简体 | 小一(48) |
| 表格文本 | 仿宋 | 五号(21) |
| 代码 | Consolas | 五号(21) |

- 西文一律 Times New Roman；A4 页边距上2.54 / 下2.54 / 左2.7 / 右2.7；页眉 0.70、页脚 1.45
- 表格：外框 1.5 磅(size 12)、内框细线(size 6)、表头加粗居中、跨页重复表头(`tableHeader: true`)、最小行高 0.8cm

## 验证方法

1. 端到端：`./scripts/md2docx.sh md/测试文档.md`，检查 `md/output/docx/` 生成的 DOCX。
2. 用 Word/LibreOffice 打开检查：章节编号、题注位置、表格跨页、横置大图、页码连续性（竖→横→竖）。
3. 图表验证：检查 `md/output/.mermaid/`、`.plantuml/` 的 PNG 为黑白灰风格（无彩色）；用户显式配置主题的图保留彩色。
4. 外部依赖：mmdc 需 Chrome/Chromium（`scripts/puppeteer-config.js` 自动探测）；PlantUML 需 Java + graphviz + `bin/plantuml.jar`（首次自动下载）。缺依赖时图表降级为代码块，不报致命错误。
5. mmdc 按 `node_modules/.bin/mmdc` **直调二进制**（不走 `npx`，避免每次包解析开销，并发场景收益明显）——不要改回 `npx mmdc`。
6. HTTP 服务：`node server/app.js` 起服务；`curl /api/health` 应返回全部依赖 ✓。前端 E2E 需本机 Chrome CDP：`NODE_PATH=$(npm root -g) node scripts/e2e-web.js`；无 CDP 环境时用 curl 走 API 全流程代替（见 `docs/api.md`）。
