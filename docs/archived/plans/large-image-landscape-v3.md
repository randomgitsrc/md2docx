# 大图横置页面方案 v3（最终版）

## 背景

基于 `docs/plans/large-image-landscape.md`（v1）及两轮评审意见，修正方案。

### 各方意见汇总

| 议题 | v1 方案 | 第一轮评审 | 第二轮评审 | 最终决策 |
|------|---------|-----------|-----------|---------|
| mmdc `-H` | 去掉 | 保留，放宽到 1200-1600 | 保留，放宽到 2400 | **保留 `-H 2400`** |
| 横置 section | 实施 | 暂不实施，竖置内优化 | 保留方案，增加触发阈值 | **实施**（行业标准做法） |
| 触发阈值 | 1.2 | — | 收紧到 1.5 | **1.5** |
| converter 返回值 | 改为分段结构 | 保持 Paragraph[] 兼容 | 直接改，不需兼容层 | **直接改** |
| 横置高度限制 | 不限高 | — | 需明确 | **限高 159mm** |

---

## 问题描述

宽矮图（如多分支 `graph TD`）在竖置 A4 内被等比压缩到极小尺寸，不可读。根本原因是 `fitImageToPage` 将所有图强制约束在竖置内容区（156mm × 246mm）内，没有横置页面支持。

---

## 实际显示尺寸对照

以下按 `fitImageToPage` / `fitImageToLandscape` 的实际 clamp 逻辑计算（先按宽缩放，再 clamp 高度）：

| 原始宽高比 | 竖置显示尺寸 | 横置显示尺寸 | 面积增益 |
|-----------|------------|------------|---------|
| 1.2 | 156 × 130mm | 191 × 159mm | +50% |
| 1.3 | 156 × 120mm | 207 × 159mm | +76% |
| **1.5** | **156 × 104mm** | **239 × 159mm** | **+134%** |
| 2.0 | 156 × 78mm | 243 × 122mm | +144% |
| 2.5 | 156 × 62mm | 243 × 97mm | +144% |

阈值 1.5 时面积增益超过 130%，可读性从"不可读"变为"清晰"，且不会对接近正方形的图误触发。

---

## 实施步骤

### Step 1：提高渲染分辨率

**改动位置：**
- `scripts/preprocess.js` 第 215 行：mmdc 调用
- `scripts/md2docx.js` 第 175 行：mmdc 调用

**改动内容：**

```
# 当前
npx mmdc -i ... -o ... -b white -w 1600 -H 900

# 改为
npx mmdc -i ... -o ... -b white -w 3600 -H 2400
```

**说明：**
- `-w 3600`：横置内容区 918px @ 96dpi，4x 超采样 = 3672px，取整 3600
- `-H 2400`：保留高度上限防止极端情况（评审建议），2400px 足够覆盖绝大多数图

---

### Step 2a：新增横置页面常量和缩放函数

**改动位置：** `scripts/md2docx.js`，常量区域（第 58-63 行附近）

**新增：**

```javascript
const LANDSCAPE_PAGE = {
  width:  cm(29.7),
  height: cm(21),
  marginTop:    cm(2.54),
  marginBottom: cm(2.54),
  marginLeft:   cm(2.7),
  marginRight:  cm(2.7),
};
const LANDSCAPE_CONTENT_WIDTH  = LANDSCAPE_PAGE.width  - LANDSCAPE_PAGE.marginLeft - LANDSCAPE_PAGE.marginRight;
const LANDSCAPE_CONTENT_HEIGHT = LANDSCAPE_PAGE.height - LANDSCAPE_PAGE.marginTop  - LANDSCAPE_PAGE.marginBottom;
// → 243mm × 159mm

const LANDSCAPE_CONTENT_WIDTH_PX  = Math.round(LANDSCAPE_CONTENT_WIDTH  / 566.93 / 2.54 * 96); // 918
const LANDSCAPE_CONTENT_HEIGHT_PX = Math.round(LANDSCAPE_CONTENT_HEIGHT / 566.93 / 2.54 * 96); // 602
```

**新增函数：**

```javascript
function fitImageToLandscape(origW, origH) {
  let w = origW, h = origH;
  if (w > LANDSCAPE_CONTENT_WIDTH_PX) {
    const r = LANDSCAPE_CONTENT_WIDTH_PX / w;
    w = LANDSCAPE_CONTENT_WIDTH_PX;
    h = Math.round(origH * r);
  }
  if (h > LANDSCAPE_CONTENT_HEIGHT_PX) {
    const r = LANDSCAPE_CONTENT_HEIGHT_PX / h;
    h = LANDSCAPE_CONTENT_HEIGHT_PX;
    w = Math.round(w * r);
  }
  return { width: w, height: h };
}
```

逻辑与 `fitImageToPage` 完全一致，使用横置内容区尺寸。先按宽缩放，再 clamp 高度。

---

### Step 2b：converter 返回分段结构

**改动位置：** `scripts/md2docx.js`，`Md2DocxConverter` 类

**当前：**

```javascript
constructor(opts = {}) {
  // ...
  this.bodyChildren = [];
}

convert(markdown) {
  // ...
  return this.bodyChildren;
}
```

**改为：**

```javascript
constructor(opts = {}) {
  // ...
  this.sections = [];          // [{ orientation: 'portrait'|'landscape', children: [] }]
  this.currentSection = null;  // 指向 this.sections 末尾的当前 section
  this.startPortraitSection(); // 初始化第一个竖置 section
}

// 开启新的竖置 section
startPortraitSection() {
  const sec = { orientation: 'portrait', children: [] };
  this.sections.push(sec);
  this.currentSection = sec;
}

// 开启新的横置 section（仅含图片+图注），之后自动恢复竖置
startLandscapeSection() {
  const sec = { orientation: 'landscape', children: [] };
  this.sections.push(sec);
  this.currentSection = sec;
}

// 恢复竖置 section
resumePortraitSection() {
  this.startPortraitSection();
}

convert(markdown) {
  const tokens = this.md.parse(markdown, {});
  let i = 0;
  while (i < tokens.length) {
    i = this.consumeToken(tokens, i);
  }
  return this.sections;
}
```

所有原来 `this.bodyChildren.push(...)` 的地方改为 `this.currentSection.children.push(...)`。

---

### Step 2c：appendImageParagraph / appendMermaid 横置判定

**改动位置：** `scripts/md2docx.js`，`appendImageParagraph` 和 `appendMermaid` 方法

**逻辑：**

```javascript
const aspectRatio = origW / origH;
const isLandscape = aspectRatio > 1.5;

if (isLandscape) {
  // 切到横置 section
  this.startLandscapeSection();
  const { width: w, height: h } = fitImageToLandscape(origW, origH);
  this.currentSection.children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    indent: { firstLine: 0 },
    keepNext: true,
    spacing: { before: 120, after: 60 },
    children: [new ImageRun({ type: 'png', data: buf, transformation: { width: w, height: h } })],
  }));
  // 注意：图注由后续 token 消费时 push 到 this.currentSection
  // 图注 push 完后，需要恢复竖置 section
} else {
  // 原有逻辑不变，push 到 currentSection
  const { width: w, height: h } = fitImageToPage(origW, origH);
  this.currentSection.children.push(new Paragraph({ /* 同原来 */ }));
}
```

**图注后恢复竖置的时机：** 在 `consumeToken` 的 `paragraph_open` 分支中，检测到 Caption 段落被 push 后，如果当前 section 是 landscape，调用 `this.resumePortraitSection()`。

---

### Step 2d：main() 动态装配 sections

**改动位置：** `scripts/md2docx.js`，`main()` 函数第 1019-1044 行

**当前（静态三段）：**

```javascript
sections: [
  // 封面
  { properties: { ... }, children: buildCover(...) },
  // 目录
  { properties: { type: SectionType.ODD_PAGE, ... }, children: buildTOC() },
  // 正文（单个 section）
  { properties: { type: SectionType.ODD_PAGE, ... }, children: bodyChildren },
]
```

**改为（动态展开）：**

```javascript
const converterSections = converter.convert(content);

const bodySections = converterSections.map((sec, idx) => {
  const isFirst = (idx === 0);
  const isLandscape = (sec.orientation === 'landscape');

  const pageSize = isLandscape
    ? { width: LANDSCAPE_PAGE.width, height: LANDSCAPE_PAGE.height }
    : { width: PAGE.width, height: PAGE.height };

  const pageNumbers = isFirst
    ? { start: 1, formatType: NumberFormat.DECIMAL }
    : { formatType: NumberFormat.DECIMAL };
    // 非首段不设 start，Word 自动从上一 section 续页码

  return {
    properties: {
      type: SectionType.CONTINUOUS,  // 不强制换页，紧跟上一 section
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

// 第一个 body section 改为 ODD_PAGE（从奇数页开始）
if (bodySections.length > 0) {
  bodySections[0].properties.type = SectionType.ODD_PAGE;
}

const doc = new Document({
  // ...
  sections: [
    // 封面
    { properties: { ... }, children: buildCover(...) },
    // 目录
    { properties: { type: SectionType.ODD_PAGE, ... }, children: buildTOC() },
    // 正文（动态展开）
    ...bodySections,
  ],
});
```

---

### Step 2e：去除 fitImageToPage 的高度限制系数

**改动位置：** `scripts/md2docx.js` 第 188 行

**当前：**

```javascript
const CONTENT_HEIGHT_PX = Math.round((29.7 - 2.54 - 2.54) * 0.80 / 2.54 * 96);
// → 744px，实际内容区高度的 80%
```

**改为：**

```javascript
const CONTENT_HEIGHT_PX = Math.round((29.7 - 2.54 - 2.54) / 2.54 * 96);
// → 930px，实际内容区高度 100%
```

0.80 系数过于保守，会让竖置内的图也被不必要地压缩。图片与页面其他元素（标题、段落）的间距已由 spacing 控制，不需要在缩放时额外预留 20%。

---

## 不做的事项

| 排除项 | 理由 |
|--------|------|
| 图片旋转 90° | 阅读体验差，不符合技术文档惯例 |
| 分栏显示 | 技术文档不使用分栏排版图片 |
| 文本框旋转 | docx 库实现复杂度高于 section break，且不是标准做法 |
| mermaid 自动拆分/重排 | 破坏原始语义，工程复杂度极高 |
| converter 返回值兼容层 | `convert()` 是内部 API，仅 `main()` 调用，无需兼容 |

---

## 代码位置汇总

| 文件 | 位置 | 改动 |
|------|------|------|
| `preprocess.js` | 第 215 行 mmdc 调用 | `-w 3600 -H 2400` |
| `md2docx.js` | 第 175 行 mmdc 调用 | `-w 3600 -H 2400` |
| `md2docx.js` | 第 58-63 行附近 | 新增 `LANDSCAPE_PAGE`、`LANDSCAPE_CONTENT_*` 常量 |
| `md2docx.js` | 第 188 行 | `CONTENT_HEIGHT_PX` 去掉 0.80 系数 |
| `md2docx.js` | 第 190-203 行附近 | 新增 `fitImageToLandscape()` |
| `md2docx.js` | `Md2DocxConverter` 构造函数 | `bodyChildren` → `sections` + `currentSection` |
| `md2docx.js` | `appendImageParagraph` | 宽高比 > 1.5 走横置分支 |
| `md2docx.js` | `appendMermaid` | 同上 |
| `md2docx.js` | `consumeToken` Caption 检测 | Caption push 后恢复竖置 section |
| `md2docx.js` | `main()` sections 装配 | 静态三段 → 动态展开 `converter.sections` |

---

## 风险点

| 风险 | 说明 | 缓解 |
|------|------|------|
| 页码连续性 | 多 section 页码依赖 `start` 设置 | 仅首段设 `start: 1`，其余不设，Word 自动续页码 |
| 横置 section 页眉页脚 | 每个 section 需要独立设置 footer | 统一调用 `makeFooter()` |
| 图注恢复竖置时机 | 图注是下一个 token，push 到 landscape section 后才恢复 | 在 Caption 检测分支末尾判断 `currentSection.orientation === 'landscape'` 则恢复 |
| 图后无图注 | 如果宽矮图后面没有图注，landscape section 只含图片 | 无害：section 仍正常渲染，只是图注缺失 |
| 连续多张横置图 | 如果两张宽矮图连续出现 | 每张图各自一个 landscape section，中间可能出现空的 portrait section；可优化为合并，但初版不处理 |
| 阈值误判 | 1.5 可能对某些"刚好偏宽"的图触发横置 | 初始 1.5 偏保守；后续可根据实际文档微调 |
