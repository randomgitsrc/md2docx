# 大图横置页面方案 v4

## 背景

基于 `docs/review/review-large-image-landscape-v3.md` 的评审意见，对 v3 方案做修正。本文档仅列出与 v3 的差异点，未提及的部分沿用 v3。

---

## v3 → v4 变更总览

| 议题 | v3 | v3 评审意见 | v4 决策 |
|------|-----|-----------|---------|
| `CONTENT_HEIGHT_PX` 系数 | 去掉 0.80（改为 1.0）| 保留或改为 0.90 | **0.90** |
| 图注恢复竖置时机 | Caption push 后恢复 | 不够明确，无图注时有 bug | **延迟恢复机制** |
| 连续多张横置图 | 不处理，允许空 portrait section | 合并或删除空 section | **初版不处理（P2）** |
| `SectionType.CONTINUOUS` | 横置 section 用 CONTINUOUS | 应换页，改为 NEXT_PAGE | **NEXT_PAGE** |
| 页码连续性 | 非首段不设 start | 需测试验证 | 同 v3，测试验证 |

---

## 变更一：CONTENT_HEIGHT_PX 系数改为 0.90

**改动位置：** `scripts/md2docx.js` 第 188 行

```javascript
// v3 方案（去掉系数）
const CONTENT_HEIGHT_PX = Math.round((29.7 - 2.54 - 2.54) / 2.54 * 96);
// → 930px

// v4 修正（0.90 系数）
const CONTENT_HEIGHT_PX = Math.round((29.7 - 2.54 - 2.54) * 0.90 / 2.54 * 96);
// → 837px
```

**理由：** 完全去掉系数过于激进。虽然 `spacing.before/after` 控制段落间距不受图片缩放影响，但图片高度接近内容区 100% 时，如果图片前有标题或图注后有段落，Word 会将图片整体推到下一页（因为同页放不下标题+图片），反而浪费空间。0.90 保留 10% 余量，兼顾标题和图注的空间需求。

---

## 变更二：延迟恢复机制（核心变更）

### v3 的问题

v3 说"Caption push 后恢复竖置"，但有两个缺陷：

1. **无图注时不恢复**：如果宽矮图后面没有图注，后续正文段落会被错误 push 到 landscape section
2. **图注与图片必须同 section**：如果在图片 push 后立即恢复竖置，图注进入竖置 section，`keepNext` 跨 section 无效，图片和图注可能分页

### v4 方案：`pendingLandscapeClose` 标志

在 `Md2DocxConverter` 中新增状态标志：

```javascript
constructor(opts = {}) {
  // ...
  this.sections = [];
  this.currentSection = null;
  this.pendingLandscapeClose = false;  // 新增
  this.startPortraitSection();
}
```

**逻辑流程：**

```
appendImageParagraph / appendMermaid:
  if 宽高比 > 1.5:
    startLandscapeSection()
    push 图片段落（带 keepNext）
    this.pendingLandscapeClose = true    ← 标记：等图注进来后再关
  else:
    push 图片段落到 currentSection（原有逻辑）

consumeToken:
  进入任何分支前，先检查 pendingLandscapeClose:

  if this.pendingLandscapeClose:
    if 当前 token 是 Caption 段落:
      push Caption 到 currentSection（仍在 landscape section 内）
      this.pendingLandscapeClose = false
      this.resumePortraitSection()       ← 图注进来了，关闭横置
      return i + 3
    else:
      // 当前 token 不是 Caption（无图注情况）
      this.pendingLandscapeClose = false
      this.resumePortraitSection()       ← 直接关闭横置
      // 不 return，继续执行当前 token 的正常处理逻辑

  // ... 原有 switch(t.type) 逻辑 ...
```

**关键行为：**

| 场景 | 行为 |
|------|------|
| 宽矮图 + 紧跟图注 | landscape section 包含 [图片, 图注]，然后恢复竖置 |
| 宽矮图 + 无图注 | landscape section 只包含 [图片]，遇到下一个非 Caption token 时恢复竖置 |
| 宽矮图 + 图注 + 另一张宽矮图 | 第一张图的 landscape section 包含 [图片1, 图注1]，恢复竖置后遇到第二张图开启新的 landscape section |
| 竖置图 | 不触发横置，原有逻辑不变 |

**为什么不在 `appendImageParagraph` 内部直接处理图注：** 图注是独立 token，在 `consumeToken` 的 `paragraph_open` 分支中被消费。`appendImageParagraph` 执行时图注 token 还没被消费到，无法提前判断下一个 token 是否为图注。延迟恢复是 token 流式处理模型下的正确做法。

---

## 变更三：SectionType 修正

**改动位置：** `scripts/md2docx.js`，`main()` 的 sections 装配

v3 方案中 bodySections 的非首段 section 使用 `SectionType.CONTINUOUS`，修正为：

```javascript
const bodySections = converterSections.map((sec, idx) => {
  const isFirst = (idx === 0);
  const isLandscape = (sec.orientation === 'landscape');

  const pageSize = isLandscape
    ? { width: LANDSCAPE_PAGE.width, height: LANDSCAPE_PAGE.height }
    : { width: PAGE.width, height: PAGE.height };

  const pageNumbers = isFirst
    ? { start: 1, formatType: NumberFormat.DECIMAL }
    : { formatType: NumberFormat.DECIMAL };

  return {
    properties: {
      type: isFirst ? SectionType.ODD_PAGE : SectionType.NEXT_PAGE,
      //                                     ^^^^^^^^^^^^^^^^
      // v4 修正：CONTINUOUS → NEXT_PAGE
      // 竖置→横置必须换页；CONTINUOUS 在方向切换时 Word 行为不可预测
      // 不用 ODD_PAGE 是因为横置图后恢复竖置时不需要强制奇数页，避免浪费空白页
      page: {
        size: pageSize,
        margin: makePageMargin(),
        pageNumbers,
      },
    },
    footers: { default: makeFooter() },
    children: sec.children,
  };
});
```

---

## 连续多张横置图（P2，初版不处理）

评审建议合并连续的 landscape section。初版不实施，理由：

1. 连续两张宽矮图且中间无正文的情况在技术文档中极少
2. 即使产生空的 portrait section，Word 会将其渲染为一个空页（`NEXT_PAGE` 强制换页），视觉上只是多一个空白页
3. 优化方案简单（在 `startLandscapeSection` 时检查 `currentSection.orientation === 'landscape'` 则复用），可在初版验证后再加

---

## 实施步骤（v4 修订版）

1. **Step 1**：`preprocess.js` + `md2docx.js` 的 mmdc 调用改为 `-w 3600 -H 2400`
2. **Step 2a**：新增 `LANDSCAPE_PAGE`、`LANDSCAPE_CONTENT_*` 常量、`fitImageToLandscape()`
3. **Step 2b**：`CONTENT_HEIGHT_PX` 系数从 0.80 改为 **0.90**
4. **Step 2c**：converter 内部从 `bodyChildren[]` 改为 `sections[]` + `currentSection` + **`pendingLandscapeClose`**
5. **Step 2d**：`appendImageParagraph` / `appendMermaid` 宽高比 > 1.5 走横置分支，设 `pendingLandscapeClose = true`
6. **Step 2e**：`consumeToken` 入口处增加 `pendingLandscapeClose` 检查逻辑
7. **Step 2f**：`main()` sections 装配改为动态展开，非首段用 **`SectionType.NEXT_PAGE`**
8. **测试**：验证页码连续性（竖→横→竖 section 的页码递增无中断）
