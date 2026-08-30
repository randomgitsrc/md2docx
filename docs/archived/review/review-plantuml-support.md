# Code Review: PlantUML 支持方案

**评审日期：** 2026-06-03
**评审范围：** `docs/plans/plantuml-support.md`
**评审人：** Claude Code

---

## 总体评价

方案设计思路清晰，与现有 Mermaid 支持架构保持一致，复用横置页面、图注延迟恢复等机制。整体可行，但存在 3 处中等问题、5 处低等问题需要修正。

---

## 问题 1：`appendCodeBlock` 调用签名不匹配 [中]

**位置：** `scripts/md2docx.js` 新增 `appendPlantUML` 方法

方案中降级调用：
```javascript
this.appendCodeBlock(plantUMLCode, 'plantuml');
```

但 `appendCodeBlock` 实际只接受一个参数：
```javascript
// scripts/md2docx.js:684
appendCodeBlock(content) {
  const lines = content.replace(/\n$/, '').split('\n');
  // ...
}
```

**影响：** 第二个参数 `'plantuml'` 被静默忽略，不影响功能但造成误导。

**建议：** 改为 `this.appendCodeBlock(plantUMLCode);`

---

## 问题 2：`appendPlantUML` 中 `this.imageIndex += 1` 冗余 [低]

**位置：** `scripts/md2docx.js` 新增 `appendPlantUML` 方法末尾

方案复制了 `appendMermaid` 末尾的 `this.imageIndex += 1;`，但 `imageIndex` 仅在 `appendImageParagraph` 中使用，用于跟踪通过 `![](path)` 引用的图片。`appendPlantUML` 直接嵌入 PNG buffer，不经过 `appendImageParagraph`，因此这行代码无实际作用。

**建议：** 移除 `this.imageIndex += 1;`，保持代码语义清晰。

---

## 问题 3：`renderPlantUMLBlocks` 不保留 `.puml` 源文件 [低]

**位置：** `scripts/preprocess.js` 新增 `renderPlantUMLBlocks` 函数

`renderMermaidBlocks` 会同时保留 `.mmd` 源文件（用于调试和重试）：
```javascript
const mmdPath = path.join(mermaidDir, `${baseName}_fig${figureIndex}.mmd`);
fs.writeFileSync(mmdPath, mermaidCode);
```

但 `renderPlantUMLBlocks` 方案中没有提到保留 `.puml` 源文件。

**建议：** 与 mermaid 保持一致，保留 `.puml` 源文件便于调试。

---

## 问题 4：两条路径横置判断逻辑不一致 [低]

**位置：** `scripts/md2docx.js`

- **preprocess 路径**：plantuml 块 → `renderPlantUMLBlocks` → PNG 文件 → `appendImageParagraph` → 横置判断基于图片实际尺寸（`downscaleRatio > 3 && aspectRatio > 2.0`）
- **md2docx 路径**：plantuml 块 → `appendPlantUML` → 横置判断基于源码分析（`estimatePlantUMLWidth`）

同一张 plantuml 图在两条路径下可能得到不同的横置结果。例如：源码分析判断需要横置，但渲染后的 PNG 尺寸较小，实际走 `appendImageParagraph` 时不会横置。

**建议：** 在方案文档中明确说明这一差异，或统一为基于图片实际尺寸判断（将 `needsLandscape` 写入 PNG 文件名/元数据中传递）。

---

## 问题 5：`downloadPlantUML` 标记为 `async` 但内部无真正异步操作 [低]

**位置：** `scripts/plantuml-renderer.js`

```javascript
async function downloadPlantUML() {
  // ...内部全部使用 execSync / fs.writeFileSync
}
```

函数标记为 `async` 但内部没有 `await` 任何 Promise，调用方也不需要 `await`。`async` 标记是多余的。

**建议：** 移除 `async` 关键字，改为同步函数。

---

## 问题 6：`appendPlantUML` 中 `|| 0` 防御性写法冗余 [低]

**位置：** `scripts/md2docx.js` 新增 `appendPlantUML` 方法

```javascript
appendPlantUML(plantUMLCode) {
  this.plantUMLIndex = (this.plantUMLIndex || 0) + 1;
```

但 `constructor` 中已经初始化了 `this.plantUMLIndex = 0;`，`|| 0` 永远不会触发。

**建议：** 改为 `this.plantUMLIndex += 1;`，与 `appendMermaid` 保持一致。

---

## 问题 7：preprocess 渲染失败时保留原始代码块 [低]

**位置：** `scripts/preprocess.js` 新增 `renderPlantUMLBlocks` 函数

方案中渲染失败时保留原始代码块：
```javascript
result.push('```plantuml');
result.push(...pumlLines);
result.push('```');
```

但 `renderMermaidBlocks` 在渲染失败时改为 `text` 代码块（避免 md2docx 重复尝试渲染）：
```javascript
result.push('```text');
result.push(mermaidCode);
result.push('```');
```

**建议：** 与 mermaid 保持一致，渲染失败时改为 `text` 代码块，避免 md2docx 阶段再次尝试渲染 plantuml。

---

## 问题 8：方案中未提及 `appendCodeBlock` 的 `lang` 参数扩展 [低]

**位置：** `scripts/md2docx.js` `fence` token 处理

方案中 `fence` 分支：
```javascript
case 'fence': {
  const lang = (t.info || '').trim().toLowerCase();
  if (lang === 'mermaid') {
    this.appendMermaid(t.content);
  } else if (lang === 'plantuml') {
    this.appendPlantUML(t.content);
  } else {
    this.appendCodeBlock(t.content);
  }
```

但 `appendCodeBlock` 目前只接受 `content` 一个参数。如果未来需要为不同语言设置不同样式（如代码块标题高亮），需要扩展签名。

**建议：** 当前方案无需改动，但可在注释中预留扩展点。

---

## 修正后实施顺序

1. 新建 `scripts/plantuml-renderer.js`（核心）
2. 改 `scripts/md2docx.js`（fence 分支 + `appendPlantUML`，修正问题 1、2、6）
3. 改 `scripts/preprocess.js`（`renderPlantUMLBlocks`，修正问题 3、7）
4. 改 `scripts/md2docx.sh`（Java 检查 + jar 下载）
5. 改 `.gitignore`
6. 端到端测试：WBS、时序图、活动图各一张

---

## 文件变更汇总（修正后）

| 文件 | 操作 | 内容 |
|------|------|------|
| `scripts/plantuml-renderer.js` | **新建** | `findPlantUML`、`downloadPlantUML`、`renderPlantUML`、`estimatePlantUMLWidth` |
| `scripts/md2docx.js` | 修改 | 引入模块、fence 分支、`appendPlantUML`（修正签名问题） |
| `scripts/preprocess.js` | 修改 | 引入模块、`renderPlantUMLBlocks`（保留源文件、降级为 text） |
| `scripts/md2docx.sh` | 修改 | Java 检查、plantuml.jar 自动下载 |
| `.gitignore` | 修改 | 添加 `bin/plantuml.jar` |
