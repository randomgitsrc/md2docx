# 评审：图注与图分页方案（image-caption-pagination.md）

## 评审日期
2026-06-02

## 评审范围
- `docs/plans/image-caption-pagination.md`
- 相关代码：`scripts/md2docx.js`（`appendImageParagraph`、`appendMermaid`、Caption 样式定义、`patchDocxPagination`）

---

## 总体结论

**方案方向正确，但方案文档对现有代码的描述存在重大偏差，导致实现步骤不准确。**

当前代码中已经有相当复杂的分页处理逻辑（`patchDocxPagination`），方案文档完全没有提及，直接跳到"加两个属性"的简化方案，会导致实施者踩坑。

---

## 问题一：Caption 样式已存在 `keepNext: true`，但方向反了 [高]

方案文档建议：
- 图片段落加 `keepNext: true`
- 图注段落加 `keepLines: true`

**实际代码（第 110-114 行）：**

```javascript
{ id: 'Caption', name: 'Caption', basedOn: 'Normal',
  run: { ... },
  paragraph: { alignment: AlignmentType.CENTER,
    keepNext: true,   // ← 已存在！
    spacing: { ... }, indent: { firstLine: 0 } } },
```

Caption 样式上已经有 `keepNext: true`，但这个方向是**错的**。

`keepNext` 的语义是：**当前段落**与**下一段**保持同页。图注（Caption）通常在图片的**下方**，它的下一段是正文，不是图片。把 `keepNext` 加在图注上，绑定的是"图注 + 图注后面的正文"，而不是"图片 + 图注"。

要解决"图片和图注不分页"，正确做法是：**在图片段落上加 `keepNext: true`**，让图片段落与紧跟其后的图注绑在一起。

方案文档把"图片加 `keepNext`、图注加 `keepLines`"描述对了，但没有发现代码里 Caption 样式上已有一个**方向错误的 `keepNext`**，这是当前代码的存量 bug，需要在实施时一并修复（从 Caption 样式移除 `keepNext`，加到 `appendImageParagraph` 和 `appendMermaid` 中）。

---

## 问题二：`patchDocxPagination` 里已有 Caption 的 keepNext + keepLines 注入，与方案重叠 [高]

方案文档完全没有提到 `patchDocxPagination`（第 906-954 行）。但这个函数在生成 DOCX 之后、通过 python-docx 对 XML 做后处理，其中第 922-932 行已经对所有 Caption 段落注入了 `keepNext` + `keepLines`：

```python
# 2. Caption 段落加 keepNext + keepLines
for p in doc.paragraphs:
    s = p.style
    if s is not None and s.style_id == 'Caption':
        pPr = p._element.get_or_add_pPr()
        if pPr.find(qn('w:keepNext')) is None:
            pPr.append(OxmlElement('w:keepNext'))
        if pPr.find(qn('w:keepLines')) is None:
            pPr.append(OxmlElement('w:keepLines'))
```

这意味着：
1. 目前图注段落实际上已经有 `keepNext` + `keepLines`（来自后处理），只是方向错误（绑的是图注→正文，而非图片→图注）。
2. 方案提出的"修改 Caption 样式定义加 `keepLines`"与现有的 python 后处理逻辑重叠，两者都给 Caption 注入，但互不知晓，维护风险高。

**建议明确决策**：是在 docx.js 层面完成（放弃 `patchDocxPagination` 中对 Caption 的处理），还是继续在后处理层面做。不应两条路同时走，否则未来行为难以预测。

---

## 问题三：`appendMermaid` 与 `appendImageParagraph` 逻辑分叉，方案只提到其中一个 [中]

方案文档提到修改 `appendImageParagraph`，但 Mermaid 图走的是 `appendMermaid`（第 541-568 行），两个方法都独立构建图片 Paragraph，代码几乎一样，但**互相没有复用**。

如果只修改 `appendImageParagraph`，Mermaid 图的分页问题不会被修复。方案文档应明确两处都需要修改，或者更好的做法是在实施时将两者合并成一个私有方法，避免将来再度分叉。

---

## 问题四：方案对"图注在图片之前"的情况没有说明 [低]

技术文档规范要求图注在图片**下方**（`图注：在图的下方`），但实际写作中有人可能把图注写在图片前面。

`keepNext` 只能绑定"当前段落与下一段"，如果图注写在图片前，当前方案完全失效。方案文档应说明这个假设，并建议在 `preprocess.js` 中对图注位置做校验或强制规范化。

---

## 对三个方案的评价

| 方案 | 评价 |
|------|------|
| A（keepNext + keepLines）| 正确方向，但实施位置需调整（放在图片段落，不是图注段落） |
| B（合并为一个 Paragraph）| 过于激进，ImageRun + TextRun 混在同一段落在 Word 中渲染不稳定，且图注的独立样式（黑体、居中）会丢失 |
| C（空段落 keepNext）| 方案文档已正确排除，不建议 |

---

## 实施建议（修正后的步骤）

1. **`appendImageParagraph` 和 `appendMermaid`**：在各自的图片 Paragraph 构造中加 `keepNext: true`，或抽取为公共私有方法 `appendImageParagraphBase`，统一加。

2. **Caption 样式定义（第 110-114 行）**：移除现有的 `keepNext: true`（方向错误），加 `keepLines: true`（防止图注自身断页，虽然极短的图注通常不会触发，加上更保险）。

3. **`patchDocxPagination`（第 922-932 行）**：移除对 Caption 段落的 `keepNext` + `keepLines` 注入（因为已在 docx.js 层正确处理，避免双重注入）。

4. **可选**：在 `preprocess.js` 中增加对图注位置的校验，提示"图注应在图片后面"。

---

## 修复优先级

| 优先级 | 位置 | 问题 |
|--------|------|------|
| 高 | `documentStyles` Caption + `patchDocxPagination` | Caption 上的 `keepNext` 方向错误，且两处重叠注入 |
| 高 | `appendMermaid` | 方案遗漏，Mermaid 图不会被修复 |
| 中 | `appendImageParagraph` + `appendMermaid` | 建议合并为公共方法，消除分叉 |
| 低 | `preprocess.js` | 图注位置校验 |
