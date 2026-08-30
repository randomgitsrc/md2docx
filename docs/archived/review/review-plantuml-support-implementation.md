# 实施评审：PlantUML 支持方案（修正版）

**评审日期：** 2026-06-03
**评审范围：** `docs/plans/plantuml-support.md`（修正版）
**评审人：** Claude Code

---

## 总体评价

方案经过评审修正后，设计合理，与现有代码架构保持一致。但发现 1 处遗留问题（方案未完全修正）、1 处不一致、1 处遗漏。以下是逐项分析。

---

## 问题 1：`estimatePlantUMLWidth` 仍在共享模块列表中 [遗留]

**位置：** 方案"共享模块"小节

方案正文：
> 新建 `scripts/plantuml-renderer.js`，导出三个函数：
> - `findPlantUML()`
> - `renderPlantUML(code, tmpDir, index)`
> - `estimatePlantUMLWidth(code)` — 分析源码宽度，决定是否横置

但后续"横置判断修正说明"明确说明：
> **修正：** `renderPlantUML` 返回的 `needsLandscape` 基于渲染后图片的实际尺寸计算...**移除 `estimatePlantUMLWidth` 函数。**

**结论：** 共享模块列表中仍包含已移除的 `estimatePlantUMLWidth`，需要删除。

**建议修正：**
```markdown
新建 `scripts/plantuml-renderer.js`，导出两个函数：

- `findPlantUML()` — 找到可用的 plantuml 运行方式
- `renderPlantUML(code, tmpDir, index)` — 渲染一段 plantuml 源码为 PNG
```

---

## 问题 2：`renderPlantUML` 使用 `CONTENT_WIDTH_PX` 但不在同一作用域 [中]

**位置：** `scripts/plantuml-renderer.js` 中的 `renderPlantUML` 函数

```javascript
// 5. 横置判断：基于渲染后图片实际尺寸（统一与 appendImageParagraph 一致）
const downscaleRatio = width / CONTENT_WIDTH_PX;
const aspectRatio = width / height;
const needsLandscape = downscaleRatio > 3 && aspectRatio > 2.0;
```

`CONTENT_WIDTH_PX` 定义在 `md2docx.js` 中（第 236 行），而 `plantuml-renderer.js` 是独立模块，无法访问该常量。

**当前代码：**
```javascript
// md2docx.js:236
const CONTENT_WIDTH_PX = Math.round(CONTENT_WIDTH / 566.93 / 2.54 * 96);
```

**影响：** `plantuml-renderer.js` 中 `CONTENT_WIDTH_PX` 为 `undefined`，`downscaleRatio` 为 `NaN`，`needsLandscape` 始终为 `false`。

**建议修正方案 A（推荐）：**

在 `plantuml-renderer.js` 中定义自己的常量：

```javascript
// plantuml-renderer.js
const CONTENT_WIDTH_PX = Math.round((21 - 2.7 - 2.7) * 96 / 2.54); // A4 内容区宽度(px)
```

**建议修正方案 B：**

将 `CONTENT_WIDTH_PX` 提取到共享常量模块中，供 `md2docx.js` 和 `plantuml-renderer.js` 共同引用。

**建议修正方案 C：**

`renderPlantUML` 不返回 `needsLandscape`，由调用方（`md2docx.js` 和 `preprocess.js`）基于图片实际尺寸判断。但这会破坏与 Mermaid 的一致性（`renderMermaid` 返回 `needsLandscape`）。

---

## 问题 3：`appendMermaid` 中 `this.imageIndex += 1` 未修正 [低]

**位置：** `md2docx.js` 中 `appendMermaid` 方法

当前代码（第 740 行）：
```javascript
appendMermaid(mermaidCode) {
  this.mermaidIndex += 1;
  // ...渲染...
  this.imageIndex += 1;  // ← 此处
}
```

方案"修正说明"中提到：
> 移除了原方案中的 `this.imageIndex += 1;`（`imageIndex` 仅用于统计通过图片引用嵌入的图像，渲染图不计入）

但方案只修正了 `appendPlantUML`，未修正 `appendMermaid` 中的同样问题。

**结论：** `appendMermaid` 中的 `this.imageIndex += 1` 是历史遗留问题，与 PlantUML 方案无关。当前方案不处理此问题是合理的，但应在注释中注明这是已知问题。

**建议：** 在方案中增加说明：
> 注：`appendMermaid` 中的 `this.imageIndex += 1` 是历史遗留问题，不影响 PlantUML 功能。如需修正，应单独处理。

---

## 问题 4：`plantuml-renderer.js` 未导出 `CONTENT_WIDTH_PX` 相关常量 [低]

**位置：** `scripts/plantuml-renderer.js`

`renderPlantUML` 返回的 `needsLandscape` 基于 `CONTENT_WIDTH_PX` 计算，但 `plantuml-renderer.js` 中该常量未定义。如果调用方（如 `preprocess.js`）需要基于同一规则判断横置，则需要访问该常量。

**当前设计：** `renderPlantUML` 返回 `needsLandscape`，调用方直接使用，无需关心内部计算。这是合理的封装。

**潜在问题：** 如果 `preprocess.js` 中的 `renderPlantUMLBlocks` 需要独立判断横置（如将 `needsLandscape` 写入 PNG 元数据），则需要访问 `CONTENT_WIDTH_PX`。

**结论：** 当前设计下不需要导出。如果未来需要，可以后续补充。

---

## 评审总结

| 问题 | 严重程度 | 说明 | 建议 |
|------|---------|------|------|
| 1. `estimatePlantUMLWidth` 仍在列表中 | 中 | 方案已移除该函数，但列表未更新 | 删除列表中的 `estimatePlantUMLWidth` |
| 2. `CONTENT_WIDTH_PX` 作用域 | **中** | `plantuml-renderer.js` 无法访问该常量 | 在模块内定义或使用共享常量 |
| 3. `appendMermaid` 未修正 | 低 | 历史遗留问题，与 PlantUML 无关 | 增加注释说明 |
| 4. 常量导出 | 低 | 当前设计不需要 | 保持现状 |

---

## 修正后方案确认

修正以下问题后，方案可以实施：

1. **删除共享模块列表中的 `estimatePlantUMLWidth`**
2. **在 `plantuml-renderer.js` 中定义 `CONTENT_WIDTH_PX`**（或提取到共享模块）

其他问题不影响功能，可在实施时一并处理。
