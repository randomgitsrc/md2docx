# 大图横置页面方案 v5 — 修正触发条件

## 背景

v4 实施后发现：几乎所有宽高比 > 1.5 的图片都被推到横置页面，包括在竖置页面中完全可读的普通截图和简单 Mermaid 图。横置页面应该只用于"竖置页面里确实看不清"的情况。

## 问题根因

`aspectRatio > 1.5` 这个条件在两种图片来源上都有问题：

**普通图片：** origW 是真实像素宽度。一张 1920×1080 截图（ratio 1.78）在竖置页面显示为 156mm × 88mm，完全可读，但 ratio > 1.5 误触发横置。

**Mermaid 图：** mmdc `-w 3600` 强制所有 Mermaid 图的 origW = 3600px，不管内容复杂度。一个只有 3 个节点的 `graph LR` 也会渲染成 3600×300（ratio 12.0）触发横置，但它在竖置页面里虽然只有 13mm 高，内容简单，完全能看清。

**宽高比衡量的是图的"形状"，不是"在竖置页面里是否可读"。** 真正决定可读性的是**图的内容密度相对于显示尺寸**——同样 156mm 宽的显示区域，3 个节点和 23 个节点的可读性完全不同。但内容密度无法从 PNG 像素尺寸推断。

## 分析

### 普通图片

用户提供的图片已经按使用场景确定了尺寸。在竖置页面内容区宽度 156mm 下，绝大多数图片都可读。即使是 1920×1080 的全屏截图，缩放到 156mm 宽后文字虽小但仍可辨认。

**结论：普通图片不应自动横置。** 如果用户需要某张图横置，应由用户在 Markdown 中显式标记（不在本方案范围内）。

### Mermaid 图

Mermaid 的 SVG 输出有一个关键属性：**viewBox**。viewBox 记录的是 Mermaid 布局引擎计算出的**自然内容尺寸**，不受 mmdc `-w` 参数影响。

- 3 节点 `graph LR`：viewBox 可能是 `0 0 450 200`（自然宽 450px）
- 23 节点 `graph TD`：viewBox 可能是 `0 0 1800 1000`（自然宽 1800px）

自然宽度直接反映内容复杂度。将自然宽度与竖置内容区宽度（590px @ 96dpi）比较，就能判断内容是否"挤"：

- 自然宽 450px < 590px：内容在竖置页面里不需要缩放，完全可读 → 竖置
- 自然宽 1800px > 590px × 2：内容需要 3 倍缩放，文字节点会变得很小 → 横置

**结论：Mermaid 图使用 SVG viewBox 自然宽度作为判断依据。**

## 方案

### 改动一：普通图片去除横置逻辑

**位置：** `scripts/md2docx.js`，`appendImageParagraph` 方法（第 600-629 行）

**改动：** 删除 `aspectRatio` / `isLandscape` 判断，所有普通图片统一走 `fitImageToPage`。

```javascript
// 改动前
const aspectRatio = origW / origH;
const isLandscape = aspectRatio > 1.5;
if (isLandscape) {
  this.startLandscapeSection();
  const { width: w, height: h } = fitImageToLandscape(origW, origH);
  // ...
  this.pendingLandscapeClose = true;
} else {
  const { width: w, height: h } = fitImageToPage(origW, origH);
  // ...
}

// 改动后
const { width: w, height: h } = fitImageToPage(origW, origH);
this.currentSection.children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  indent: { firstLine: 0 },
  keepNext: true,
  spacing: { before: 120, after: 60 },
  children: [new ImageRun({
    type: 'png', data: buf,
    transformation: { width: w, height: h },
  })],
}));
```

### 改动二：Mermaid 渲染改为两步——SVG 探测 + PNG 渲染

**位置：** `scripts/md2docx.js`，`renderMermaid` 函数（第 160-184 行）

**当前流程：**

```
mmdc -i input.mmd -o output.png -w 3600 -H 2400
→ 返回 { buffer, width, height }  (PNG 像素尺寸)
```

**改为：**

```
Step 1: mmdc -i input.mmd -o output.svg
        → 解析 SVG 的 viewBox / width / height 属性，得到自然内容尺寸

Step 2: 根据自然宽度决定渲染模式
        if naturalWidth > CONTENT_WIDTH_PX * 2 (即 > 1180px):
          → 横置模式，mmdc -w 3600 -H 2400 渲染 PNG
        else:
          → 竖置模式，mmdc -w 2400 -H 2400 渲染 PNG

→ 返回 { buffer, width, height, needsLandscape }
```

**SVG viewBox 解析：** mmdc 生成的 SVG 文件头格式为：

```xml
<svg viewBox="0 0 WIDTH HEIGHT" xmlns="...">
```

用正则提取即可：

```javascript
function getMermaidNaturalSize(svgPath) {
  const svg = fs.readFileSync(svgPath, 'utf8');

  // 优先从 viewBox 取
  const vbMatch = svg.match(/viewBox\s*=\s*"[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)"/);
  if (vbMatch) return { width: parseFloat(vbMatch[1]), height: parseFloat(vbMatch[2]) };

  // 降级从 width/height 属性取
  const wMatch = svg.match(/\bwidth\s*=\s*"([\d.]+)/);
  const hMatch = svg.match(/\bheight\s*=\s*"([\d.]+)/);
  if (wMatch && hMatch) return { width: parseFloat(wMatch[1]), height: parseFloat(hMatch[1]) };

  return null;  // 解析失败，降级为竖置
}
```

### 改动三：appendMermaid 使用 needsLandscape 标志

**位置：** `scripts/md2docx.js`，`appendMermaid` 方法（第 648-690 行）

```javascript
appendMermaid(mermaidCode) {
  this.mermaidIndex += 1;
  let img;
  try {
    img = renderMermaid(mermaidCode, this.tmpDir, this.mermaidIndex);
  } catch (e) {
    console.warn(`[警告] Mermaid 渲染失败: ${e.message}`);
    this.appendCodeBlock(mermaidCode);
    return;
  }

  if (img.needsLandscape) {
    this.startLandscapeSection();
    const { width, height } = fitImageToLandscape(img.width, img.height);
    this.currentSection.children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      indent: { firstLine: 0 },
      keepNext: true,
      spacing: { before: 120, after: 60 },
      children: [new ImageRun({
        type: 'png', data: img.buffer,
        transformation: { width, height },
      })],
    }));
    this.pendingLandscapeClose = true;
  } else {
    const { width, height } = fitImageToPage(img.width, img.height);
    this.currentSection.children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      indent: { firstLine: 0 },
      keepNext: true,
      spacing: { before: 120, after: 60 },
      children: [new ImageRun({
        type: 'png', data: img.buffer,
        transformation: { width, height },
      })],
    }));
  }
}
```

### 改动四：preprocess.js 同步修改（如果 preprocess 也有横置判断）

**位置：** `scripts/preprocess.js` 第 215 行

preprocess.js 只做 Mermaid → PNG 替换（将 md 中的 mermaid 代码块替换为图片引用），不涉及横置判断。渲染参数改为 `-w 2400`（默认竖置分辨率），横置分辨率由 md2docx.js 的 `renderMermaid` 在第二步 PNG 渲染时单独处理。

## 横置触发阈值

```javascript
const LANDSCAPE_THRESHOLD = CONTENT_WIDTH_PX * 2;  // 590 * 2 = 1180px
```

**阈值含义：** Mermaid 自然内容宽度超过竖置内容区宽度的 2 倍时，内容需要缩放 2 倍以上才能放进竖置页面，文字节点会明显变小，触发横置。

**验证：**

| 图类型 | SVG 自然宽 | > 1180px? | 判定 |
|--------|-----------|-----------|------|
| 3 节点 graph LR | ~450px | 否 | 竖置 ✓ |
| 5 节点 graph LR | ~700px | 否 | 竖置 ✓ |
| 10 节点 graph TD | ~900px | 否 | 竖置 ✓ |
| 23 节点 graph TD（原始问题） | ~1800px | 是 | 横置 ✓ |
| 超复杂 graph TD | ~2500px | 是 | 横置 ✓ |

注：以上自然宽度为估算值，实际需以 mmdc SVG 输出为准。阈值可根据实际文档调整。

## 不做的事项

| 排除项 | 理由 |
|--------|------|
| 普通图片自动横置 | 用户提供的图片已经按场景确定尺寸，竖置可读 |
| 基于宽高比判断 | 宽高比不反映内容复杂度，误判率高 |
| 基于 PNG origW 判断 | mmdc -w 3600 强制所有 Mermaid 图 origW=3600，无法区分 |
| 基于竖置显示高度判断 | 不同宽高比的图在竖置下高度相近但可读性不同 |

## 代码位置汇总

| 文件 | 位置 | 改动 |
|------|------|------|
| `md2docx.js` | `renderMermaid` | 两步渲染：先 SVG 取自然尺寸，再 PNG |
| `md2docx.js` | `appendImageParagraph` | 删除横置分支，统一竖置 |
| `md2docx.js` | `appendMermaid` | 改用 `img.needsLandscape` 判断 |
| `preprocess.js` | mmdc 调用 | `-w 2400`（竖置默认分辨率）|

## 与 v4 的关系

v4 中的以下内容保持不变：
- `pendingLandscapeClose` 延迟恢复机制
- `SectionType.NEXT_PAGE`
- `CONTENT_HEIGHT_PX` 0.90 系数
- `fitImageToLandscape` 函数
- `LANDSCAPE_PAGE` 常量
- `main()` 动态 sections 装配

v4 中的以下内容被本方案修改：
- 横置触发条件：从 `aspectRatio > 1.5` 改为基于 SVG viewBox 自然宽度
- 触发范围：从"所有图片"改为"仅 Mermaid 图"
- 渲染流程：从单步 PNG 改为 SVG 探测 + PNG 渲染
