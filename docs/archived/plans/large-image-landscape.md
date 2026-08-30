# 大图横置页面方案

## 问题描述

对于节点多、层级深的 `graph TD` 类 Mermaid 图，当前实现存在两个叠加问题：

**问题一：渲染分辨率损失**
mmdc 固定用 `-w 1600` 渲染，嵌入 Word 时内容区宽仅 590px（156mm @ 96dpi），缩放比 0.37，损失 63% 像素密度，字体渲染模糊。

**问题二：宽矮图被压缩到不可读**
`graph TD` 布局会将子节点横向铺开，产生宽矮图（宽高比 > 1.2）。当前 `fitImageToPage` 先按宽压到内容区宽（156mm），再检查高度限制，最终嵌入尺寸可能仅 100mm 宽 × 80mm 高，字号等效 4-5pt，完全不可读。

这不是"图太高"的问题，是**图太宽**的问题。

## 根本原因

`fitImageToPage` 假设所有图都适合在竖置 A4 的内容区（156mm × 246mm）内显示，没有区分宽矮图和瘦高图，也没有横置页面的支持。

## A4 页面尺寸对照

| | 竖置 A4 | 横置 A4 |
|---|---|---|
| 页面宽 | 210mm | 297mm |
| 页面高 | 297mm | 210mm |
| 内容区宽（左右边距各 2.7cm）| **156mm** | **243mm** |
| 内容区高（上下边距各 2.54cm）| 246mm | **159mm** |
| 内容区宽（px @ 96dpi）| 590px | 918px |

横置内容区宽是竖置的 **1.56 倍**，对宽矮图来说可读性提升显著。

## 方案

### Step 1：提高渲染分辨率（Quick Win）

**改动：** `preprocess.js` 第 215 行 和 `md2docx.js` 第 175 行，将 mmdc 调用的 `-w 1600` 改为 `-w 2400`。

**理由：**
- 竖置内容区 590px，4x 超采样需要 2360px，取整为 2400px
- 横置内容区 918px，4x 超采样需要 3672px；但渲染时还不知道是否横置，统一用 2400px 先行处理；横置时再单独用 3600px（见 Step 2）
- `-H 900` 参数对 `graph TD` 无实质约束（mmdc 按内容自然撑高），可保留或去掉，不影响结果

**效果：** 字体渲染质量提升，消除模糊，但宽矮图尺寸过小的问题未解决。

---

### Step 2：宽矮图自动横置页面（核心方案）

#### 触发条件

渲染出 PNG 后，读取实际宽高比：

```
宽高比 = origW / origH
```

若 `宽高比 > 1.2`，判定为宽矮图，触发横置页面逻辑。

**阈值 1.2 的依据：**
- 宽高比 1.2 时，竖置显示高约 130mm；横置显示高约 202mm，提升 56%
- 低于 1.2 的图（接近方形或瘦高图）在竖置页面内已可正常显示
- 1.2 高于 1.0（正方形），避免对正方形图触发横置

#### DOCX 层实现方式

Word 的横置页面通过插入 **Section Break** 实现：

```
[竖置 section 内容]
  ...段落...
  [Section Break: Odd Page, landscape]
  [横置图片段落]
  [图注段落]
  [Section Break: Odd Page, portrait, 恢复竖置]
[竖置 section 内容继续]
  ...段落...
```

`docx` 库通过在 `children` 数组中插入带 `properties` 的特殊 Paragraph 来触发 section break（`SectionType`），或者通过把 `Document.sections` 动态分拆来实现。

**当前代码的 sections 装配方式（`md2docx.js` 第 1019 行）** 是静态的三段式（封面、目录、正文），正文 section 的 `children` 是一个平坦数组。要支持行内 section break，需要改为**动态 section 分拆**：

将 `bodyChildren` 数组在遇到宽矮图时切割，拆成若干段：

```
sections = [
  封面 section,
  目录 section,
  正文 section A（竖置，图前内容）,
  图片 section（横置，含图片+图注）,
  正文 section B（竖置，图后内容，页码连续）,
  ...
]
```

#### 页码连续性处理

每个 section 的 `pageNumbers` 不设 `start`（不指定起始页码），则 Word 自动从上一 section 继续计数，页码天然连续。

只有正文的第一个 section 需要 `start: 1`；后续所有 section（包括横置图片 section 和恢复竖置的 section）均不设 `start`。

#### 横置 section 的尺寸参数

```javascript
const LANDSCAPE_PAGE = {
  width:  cm(29.7),  // A4 横置宽
  height: cm(21),    // A4 横置高
  marginTop:    cm(2.54),
  marginBottom: cm(2.54),
  marginLeft:   cm(2.7),
  marginRight:  cm(2.7),
};
const LANDSCAPE_CONTENT_WIDTH  = LANDSCAPE_PAGE.width  - LANDSCAPE_PAGE.marginLeft - LANDSCAPE_PAGE.marginRight;
const LANDSCAPE_CONTENT_HEIGHT = LANDSCAPE_PAGE.height - LANDSCAPE_PAGE.marginTop  - LANDSCAPE_PAGE.marginBottom;
// → 内容区 243mm × 159mm
```

#### 横置图片缩放

新增 `fitImageToLandscape(origW, origH)`，逻辑与 `fitImageToPage` 相同，但使用横置内容区尺寸，且**不限制高度**（横置内容区高 159mm 已足够，宽矮图在横置内不会超高）。

#### mmdc 渲染宽度

横置 section 内容区宽 918px（@ 96dpi），4x 超采样为 3672px，取 `-w 3600`。

渲染时暂不知道最终是否横置（需要先渲染才能知道宽高比），因此：
- 统一用 `-w 3600` 渲染所有 Mermaid 图
- 竖置图（宽高比 ≤ 1.2）用 `fitImageToPage` 缩放，会从 3600px 压到 590px，4x 超采样，字体清晰
- 横置图（宽高比 > 1.2）用 `fitImageToLandscape` 缩放，从 3600px 压到 918px，约 3.9x 超采样

#### converter 返回值变更

当前 `Md2DocxConverter.convert()` 返回 `Paragraph[]`（平坦数组）。要支持横置 section，需要返回**分段结构**：

```javascript
// 当前
return this.bodyChildren; // Paragraph[]

// 改后
return this.sections;
// [
//   { orientation: 'portrait', children: [...] },
//   { orientation: 'landscape', children: [imagePara, captionPara] },
//   { orientation: 'portrait', children: [...] },
// ]
```

主函数在装配 `Document.sections` 时遍历这个数组，为每个 section 设置对应的页面尺寸。

## 实施步骤

1. **Step 1**：`preprocess.js` + `md2docx.js` 的 mmdc 调用改为 `-w 3600`，去掉 `-H 900`
2. **Step 2a**：在 `md2docx.js` 中新增 `LANDSCAPE_PAGE`、`LANDSCAPE_CONTENT_WIDTH/HEIGHT`、`fitImageToLandscape()`
3. **Step 2b**：`Md2DocxConverter` 内部从单一 `bodyChildren[]` 改为 `sections[]`（分段数组），`appendImageParagraph` 和 `appendMermaid` 在检测到宽高比 > 1.2 时开启新的 landscape section
4. **Step 2c**：`main()` 的 `Document` 装配逻辑从静态三段改为动态展开 `converter.sections`
5. **Step 2d**：横置 section 的 `keepNext` 逻辑验证（图片+图注绑定，已有基础）

## 代码位置

- `scripts/preprocess.js`：`renderMermaidBlocks` 中的 mmdc 调用（第 214-216 行）
- `scripts/md2docx.js`：
  - `renderMermaid` 中的 mmdc 调用（第 175 行）
  - `fitImageToPage`（第 190-203 行）→ 新增 `fitImageToLandscape`
  - `CONTENT_WIDTH_PX` / `CONTENT_HEIGHT_PX` 常量（第 187-188 行）→ 新增 landscape 版本
  - `Md2DocxConverter`：`appendImageParagraph`、`appendMermaid`、返回值结构
  - `main()`：`Document` sections 装配（第 1019-1044 行）

## 风险点

| 风险 | 说明 | 缓解 |
|------|------|------|
| 页码连续性 | 多 section 时 Word 页码行为依赖 `start` 设置是否正确 | 只有正文第一 section 设 `start:1`，其余不设 |
| 图注 keepNext 跨 section | 图片和图注在同一 landscape section 内，keepNext 有效，无问题 | 无需额外处理 |
| 宽高比阈值误判 | 部分方形图（比如流程图）宽高比略高于 1.2 但不需要横置 | 阈值可调，初始设 1.2，后续根据实际文档调整 |
| preprocess 与 md2docx 双路渲染 | preprocess 渲染一次，md2docx 内部也有 `renderMermaid`（处理未经 preprocess 直接输入的 md）| 两处 mmdc 调用均需修改，已在代码位置中列出 |
