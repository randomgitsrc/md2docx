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

**结论：普通图片使用"缩放倍数 > 3 且宽高比 > 2.0"双重条件判断横置。** origW 是真实内容宽度，可直接反映缩放压力。

### Mermaid 图

Mermaid 的 PNG 像素尺寸被 mmdc `-w` 参数强制拉宽，无法反映真实内容复杂度。但 Mermaid **源码**包含完整的图拓扑信息——节点、边、布局方向。

对 `graph TD` / `flowchart TD`（自顶向下）方向的图，横向宽度由**分支因子**（某节点的子节点数）和**叶节点数量**决定：
- 根节点有 6 个子节点 → 第二层 6 个节点并排 → 宽图
- 线性链 A→B→C → 每层 1 个节点 → 窄图

通过分析源码中的边关系，可以零开销估算图的横向展开程度。

**结论：Mermaid 图使用源码拓扑分析（widthScore）作为判断依据。**

## 方案

### 改动一：普通图片横置条件改为双重判断

**位置：** `scripts/md2docx.js`，`appendImageParagraph` 方法（第 600-629 行）

普通图片的 origW 是真实内容宽度（不像 Mermaid 被 `-w 3600` 强制拉宽），可以直接用于判断缩放压力。

**横置条件：缩放倍数 > 3 且 宽高比 > 2.0**

- **缩放倍数 > 3**：图片需要压缩到原始宽度的 1/3 以下才能放进竖置内容区，细节损失大（origW > 590 × 3 = 1770px）
- **宽高比 > 2.0**：图够宽，横置能显著增大显示面积；低于 2.0 的图横置收益有限

两个条件同时满足才触发，避免误判。

**验证：**

| 图片 | origW | 缩放倍数 | 宽高比 | 判定 |
|------|-------|---------|--------|------|
| 宽架构图 3000×800 | 3000 | 5.1 > 3 ✓ | 3.75 > 2.0 ✓ | 横置 ✓ |
| 宽表格截图 2500×600 | 2500 | 4.2 > 3 ✓ | 4.2 > 2.0 ✓ | 横置 ✓ |
| 普通截图 1920×1080 | 1920 | 3.25 > 3 ✓ | 1.78 < 2.0 ✗ | 竖置 ✓ |
| 小宽图 800×400 | 800 | 1.36 < 3 ✗ | — | 竖置 ✓ |
| 照片 4032×3024 | 4032 | 6.8 > 3 ✓ | 1.33 < 2.0 ✗ | 竖置 ✓ |
| 中等宽图 2000×900 | 2000 | 3.4 > 3 ✓ | 2.2 > 2.0 ✓ | 横置（边界）|

**改动：**

```javascript
// 改动前
const aspectRatio = origW / origH;
const isLandscape = aspectRatio > 1.5;

// 改动后
const downscaleRatio = origW / CONTENT_WIDTH_PX;
const aspectRatio = origW / origH;
const isLandscape = downscaleRatio > 3 && aspectRatio > 2.0;
```

其余 `if (isLandscape) { ... } else { ... }` 分支逻辑不变。

### 改动二：Mermaid 源码拓扑分析（替代 SVG 探测）

**位置：** `scripts/md2docx.js`，新增函数 + 修改 `renderMermaid`

v5 原方案使用 SVG viewBox 获取自然尺寸，但 mmdc SVG 输出同样需要 Puppeteer 启动，每个 Mermaid 图多一次浏览器启动（1-3 秒），10 个图多 10-30 秒。

**改为：直接分析 Mermaid 源码的图拓扑结构。** 零额外渲染开销。

**原理：** 对 `graph TD` / `flowchart TD` 类图，横向宽度由**分支因子**和**叶节点数量**决定。一个根节点有 6 个子节点 → 第二层就有 6 个节点并排 → 宽图。分析源码中的边关系即可估算宽度。

**新增函数：**

```javascript
function estimateMermaidWidth(mermaidCode) {
  // 1. 识别布局方向，仅 TD/TB（自顶向下）方向会产生宽图
  const dirMatch = mermaidCode.match(/^\s*(?:graph|flowchart)\s+(TD|TB|LR|RL|BT)/m);
  if (!dirMatch) return { needsLandscape: false };  // 序列图、类图等默认竖置

  const direction = dirMatch[1];
  if (!['TD', 'TB'].includes(direction)) return { needsLandscape: false };  // LR/RL 是窄高图

  // 2. 提取所有边：source --> target
  const edgePattern = /([\w]+)(?:\[[^\]]*\]|\([^)]*\)|\{[^}]*\})?\s*(?:-->|---|-\.->|==>)\s*(?:\|[^|]*\|)?\s*([\w]+)/g;
  const children = {};
  let match;
  while ((match = edgePattern.exec(mermaidCode)) !== null) {
    if (!children[match[1]]) children[match[1]] = new Set();
    children[match[1]].add(match[2]);
  }

  // 3. 收集所有节点，找叶节点（无出边的节点）
  const allNodes = new Set();
  for (const [p, cs] of Object.entries(children)) {
    allNodes.add(p);
    cs.forEach(c => allNodes.add(c));
  }
  const leafCount = [...allNodes].filter(n => !children[n] || children[n].size === 0).length;

  // 4. 宽度评分 = max(最大子节点数, 叶节点数/2)
  //    最大子节点数：某一层的最大展开宽度
  //    叶节点数/2：叶节点分布在多层，取半作为平均层宽
  const maxChildren = Math.max(0, ...Object.values(children).map(s => s.size));
  const widthScore = Math.max(maxChildren, Math.ceil(leafCount / 2));

  return { needsLandscape: widthScore > 5 };
}
```

**阈值 `widthScore > 5` 的含义：** 图的最宽层超过 5 个节点并排，在竖置 156mm 内容区中每个节点宽度 < 31mm，节点内文字开始变小。

**验证：**

| 图类型 | widthScore | > 5? | 判定 |
|--------|-----------|------|------|
| 3 节点 graph LR | — | LR 方向，跳过 | 竖置 ✓ |
| 7 节点 graph TD（3 分支各 1-2 子节点）| 3 | 否 | 竖置 ✓ |
| 线性链 graph TD（A→B→C→D→E→F）| 2 | 否 | 竖置 ✓ |
| 星形 graph TD（根 8 子节点）| 8 | 是 | 横置 ✓ |
| 23 节点 graph TD（原始问题，6 分支 18 叶）| 9 | 是 | 横置 ✓ |
| 10 节点 flowchart TD（6 分支 6 叶）| 6 | 是 | 横置 ✓ |
| 序列图 / 甘特图 / 类图 | — | 非 flowchart | 竖置 ✓ |

**修改 `renderMermaid`：**

```javascript
function renderMermaid(mermaidCode, tmpDir, index) {
  // 渲染前分析拓扑，决定横置
  const { needsLandscape } = estimateMermaidWidth(mermaidCode);

  // 根据模式选择渲染宽度（横置需要更高分辨率）
  const renderWidth = needsLandscape ? 3600 : 2400;

  const inFile = path.join(tmpDir, `m_${index}.mmd`);
  const outFile = path.join(tmpDir, `m_${index}.png`);
  const cfgPath = generateConfig(tmpDir);
  const cfgArg = cfgPath ? `-p ${cfgPath}` : '';

  fs.writeFileSync(inFile, mermaidCode);
  const mmdcDir = path.resolve(__dirname, '..');
  execSync(`npx mmdc -i ${inFile} -o ${outFile} -b white -w ${renderWidth} -H 2400 ${cfgArg}`,
    { stdio: 'pipe', cwd: mmdcDir });

  const buffer = fs.readFileSync(outFile);
  const width  = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return { buffer, width, height, needsLandscape };
}
```

单次 mmdc 调用，无额外性能开销。渲染宽度按需选择：竖置 2400（4x of 590），横置 3600（4x of 918）。

### 改动三：appendMermaid 使用 needsLandscape 标志

**位置：** `scripts/md2docx.js`，`appendMermaid` 方法（第 648-690 行）

逻辑不变，使用 `renderMermaid` 返回的 `needsLandscape`：

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

### 改动四：preprocess.js 渲染参数

**位置：** `scripts/preprocess.js` 第 215 行

preprocess.js 的 Mermaid 渲染是预处理阶段（将 md 中的 mermaid 代码块替换为图片引用），此时不做横置判断。渲染参数统一为 `-w 2400`（竖置分辨率）。如果 md2docx.js 在转换时发现该图需要横置，会通过 `renderMermaid` 重新渲染（`-w 3600`）。

注：如果 Mermaid 图已被 preprocess 渲染为 PNG 并嵌入 md，md2docx.js 会按普通图片处理（走改动一的双重条件）。只有直接以 mermaid 代码块出现在 md 中的图，才走改动二的拓扑分析。

## 横置触发阈值汇总

**普通图片：** `downscaleRatio > 3 && aspectRatio > 2.0`
- downscaleRatio = origW / CONTENT_WIDTH_PX（即 origW > 1770px）
- 两个条件同时满足才触发

**Mermaid 图：** `widthScore > 5`（仅 graph TD / flowchart TD 方向）
- widthScore = max(最大子节点数, 叶节点数 / 2)
- 非 flowchart 类型（序列图、甘特图等）默认竖置
- LR / RL 方向默认竖置

## 不做的事项

| 排除项 | 理由 |
|--------|------|
| 仅基于宽高比判断 | 宽高比不反映内容复杂度（尤其 Mermaid），误判率高 |
| 仅基于 PNG origW 判断 Mermaid | mmdc -w 强制所有 Mermaid 图 origW 相同，无法区分 |
| 基于竖置显示高度判断 | 不同内容密度的图在竖置下高度相近但可读性不同 |
| 普通图片完全禁止横置 | 宽表格截图、宽架构图等在竖置下确实不可读 |
| SVG viewBox 两步渲染 | mmdc SVG 输出同样需要 Puppeteer，每图多一次浏览器启动，性能代价高 |

## 代码位置汇总

| 文件 | 位置 | 改动 |
|------|------|------|
| `md2docx.js` | 新增函数 | `estimateMermaidWidth()` 源码拓扑分析 |
| `md2docx.js` | `renderMermaid` | 调用拓扑分析，按需选择渲染宽度，返回 `needsLandscape` |
| `md2docx.js` | `appendImageParagraph` | 横置条件改为 `downscaleRatio > 3 && aspectRatio > 2.0` |
| `md2docx.js` | `appendMermaid` | 使用 `img.needsLandscape` 判断 |
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
- 横置触发条件：普通图片从 `aspectRatio > 1.5` 改为 `downscaleRatio > 3 && aspectRatio > 2.0`；Mermaid 改为源码拓扑分析（`widthScore > 5`）
- 触发范围：两种图片各自有独立的判断逻辑
- Mermaid 渲染宽度：从固定 `-w 3600` 改为按需选择（竖置 2400 / 横置 3600）
