# AGENTS.md

## 图表渲染配色约定（技术文档严谨风格）

md2docx 转换时，mermaid 与 PlantUML 图表**默认注入灰阶/黑白主题**，去除各自默认的彩色（蓝/紫/黄）"AI 味"，使输出符合技术文档的严谨风格。

### 默认主题

| 图表类型 | 默认主题 | 注入指令 | 效果 |
|---|---|---|---|
| mermaid | `neutral` | `%%{init: {'theme': 'neutral', 'flowchart': {'curve': 'linear'}}}%%` | 浅灰节点框 + 灰边框 + 黑字 + 直线连线 |
| PlantUML | `plain` | `!theme plain` | 白底 + 黑框 + 黑线（黑白线稿） |

### 改动位置

- **mermaid**：`scripts/preprocess.js` 的 `renderMermaidBlocks`——渲染前在 mermaid 代码块顶部注入 init 指令（仅当用户未写 `%%{init}%%` 时）
- **PlantUML**：`scripts/plantuml-renderer.js` 的 `injectTheme()`——在 `@startuml` 后注入 `!theme plain`（仅当用户未写 `!theme` 时），位于 `injectChineseFont()` 之前（字体配置需在主题之后，避免被主题覆盖）

### 优先级规则（重要）

**用户在 markdown 代码块里显式配置的主题/初始化指令永远优先**，注入逻辑不覆盖：

- mermaid：检测到 `%%{init:` 开头 → 不注入
- PlantUML：检测到 `!theme <name>` → 不注入

即：默认走灰阶；作者想要彩色（如 `!theme cerulean`、`%%{init: {'theme':'default'}}%%`）则保留其选择。

### 切换/自定义默认主题

如需改默认风格（如更极简的纯白线稿、或恢复彩色），修改对应注入指令即可：

- mermaid 极简白底：`'theme': 'base'` + `themeVariables`（primaryColor 白、lineColor 黑）
- PlantUML 极简：`!theme plain` 已是极简；其他可选 `!theme blueprint` 等
- 恢复彩色：删除注入逻辑，或把默认改回 `default` / 不写 `!theme`

### 验证

端到端已验证（2026-08-29）：
- 默认 mermaid/PlantUML 图 → 渲染为黑白灰（vision-engine 复核确认）
- 用户写 `!theme cerulean` / `%%{init: theme:default}%%` 的图 → 保留彩色（优先级正确）

## 相关文档

- `CLAUDE.md`——项目架构、命令、流水线两阶段说明
- `01-base/技术文档格式-20260525.md`——文档样式规范
