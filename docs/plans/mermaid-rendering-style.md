---
status: deprecated
reason: 方案已放弃，详见 docs/plans/mermaid-rendering-style-exploration.md
date: 2026-06-03
---


# Mermaid 渲染配置方案 — 技术文档风格

## 问题描述

当前 mmdc 调用没有传任何 mermaid 配置（`-c`）或 CSS（`-C`），全部走默认值。默认渲染在技术文档场景下有以下问题：

1. **连接线用贝塞尔曲线**：默认 `curve: "basis"`，弯弯绕绕，"AI 味"的主要来源
2. **配色是蓝紫渐变**：不符合技术文档的黑白灰规范
3. **字体不匹配**：默认 `sans-serif`，与文档规范的仿宋/Times New Roman 不一致
4. **节点圆角太大**：看起来像按钮，不像技术文档中的功能模块框
5. **节点内边距偏小**：中文字符紧贴边框，尤其双行节点
6. **连接线和边框太细**：高分辨率渲染后缩放到页面里显得发虚
7. **布局引擎单一**：dagre 对纯树/DAG 图的正交布局不如 ELK

## 方案概述

**混合配置策略：** init 指令按图动态选引擎 + CSS 文件全局统一样式。

在渲染前修改 mermaid 源码，前置 `%%{init: {...}}%%` 指令来控制引擎、主题、曲线；通过 `-C mermaid.css` 统一控制节点视觉样式（圆角、边框粗细、内边距）。

---

## 改动一：引擎自动选择（ELK / dagre）

### 选择规则

基于之前的讨论结论：

| 图拓扑 | 引擎 | 曲线 | 理由 |
|--------|------|------|------|
| 纯 DAG（无回路）| ELK | —（ELK 自带正交连线）| 正交直角连线，专业感最强 |
| 有回路 | dagre | `linear`（直线）| dagre 严格尊重声明顺序，反向边只绕回不影响分层 |
| 非 flowchart（序列图等）| 不注入引擎配置 | — | 这些图类型有独立的渲染器 |

### 回路检测

在 `estimateMermaidWidth` 已有的边解析基础上，新增 DFS 环检测：

```javascript
function hasCycle(children) {
  const visited = new Set(), stack = new Set();
  function dfs(node) {
    if (stack.has(node)) return true;
    if (visited.has(node)) return false;
    visited.add(node);
    stack.add(node);
    for (const child of (children[node] || [])) {
      if (dfs(child)) return true;
    }
    stack.delete(node);
    return false;
  }
  for (const node of Object.keys(children)) {
    if (dfs(node)) return true;
  }
  return false;
}
```

### 修改 estimateMermaidWidth 返回值

```javascript
function estimateMermaidWidth(mermaidCode) {
  const dirMatch = mermaidCode.match(/^\s*(?:graph|flowchart)\s+(TD|TB|LR|RL|BT)/m);
  if (!dirMatch) return { needsLandscape: false, isFlowchart: false };

  const direction = dirMatch[1];
  const isTopDown = ['TD', 'TB'].includes(direction);

  // ... 已有的边解析逻辑 ...

  const cyclic = hasCycle(children);

  return {
    needsLandscape: isTopDown && widthScore > 5,
    isFlowchart: true,
    isDag: !cyclic,      // 新增：是否为 DAG
  };
}
```

> **注意：** `estimateMermaidWidth` 当前位于 `scripts/md2docx.js` 中，但 preprocess 阶段需要用到它。详见[改动五：共享模块提取](#改动五共享模块提取)。

---

## 改动二：init 指令注入

**位置：** `scripts/preprocess.js`，`renderMermaidBlocks` 函数中（写入 `.mmd` 文件前）

> **重要修正：** 由于 `preprocess.js` 已将所有 mermaid 代码块渲染为 PNG，`md2docx.js` 的 `renderMermaid` 函数在常规流程中不会被调用。因此 init 注入逻辑必须放在 `preprocess.js` 的渲染阶段。

在写入 `.mmd` 文件前，根据分析结果在 mermaid 源码前面注入 init 指令：

```javascript
function buildMermaidInit(analysis) {
  const init = {
    theme: 'base',
    themeVariables: {
      // 黑白灰配色 — 技术文档标准
      primaryColor:       '#ffffff',    // 节点填充：白色
      primaryTextColor:   '#000000',    // 节点文字：黑色
      primaryBorderColor: '#333333',    // 节点边框：深灰
      lineColor:          '#333333',    // 连接线：深灰
      secondaryColor:     '#f5f5f5',    // 次级节点：极浅灰
      tertiaryColor:      '#e8e8e8',    // 第三级：浅灰
      fontFamily: 'FangSong, STFangsong, SimSun, serif',
      fontSize: '14px',
    },
  };

  if (analysis.isFlowchart) {
    if (analysis.isDag) {
      // 纯 DAG → ELK 引擎（正交直角连线）
      init.flowchart = { defaultRenderer: 'elk' };
    } else {
      // 有回路 → dagre + linear 直线
      init.flowchart = { curve: 'linear' };
    }
  }

  // flowchart 通用配置（ELK 和 dagre 都生效）
  if (!init.flowchart) init.flowchart = {};
  init.flowchart.padding = 12;          // 节点内边距（默认 8）
  init.flowchart.nodeSpacing = 30;      // 节点水平间距
  init.flowchart.rankSpacing = 40;      // 层级垂直间距

  return `%%{init: ${JSON.stringify(init)}}%%\n`;
}
```

**注入位置：** `renderMermaidBlocks` 中写文件前：

```javascript
function renderMermaidBlocks(content, inputDir, baseName) {
  // ... 现有逻辑 ...
  
  let mermaidCode = mermaidLines.join('\n');
  
  // 分析拓扑结构
  const analysis = estimateMermaidWidth(mermaidCode);
  
  // 注入 init 指令（仅 flowchart 类型，且用户未显式配置）
  const hasUserInit = /^%%\{init:/m.test(mermaidCode);
  if (analysis.isFlowchart && !hasUserInit) {
    const initDirective = buildMermaidInit(analysis);
    mermaidCode = initDirective + mermaidCode;
  }
  
  // ... 写入文件并渲染 ...
}
```

---

## 改动三：CSS 样式文件

**新增文件：** `scripts/mermaid.css`

CSS 控制 init 指令无法覆盖的视觉属性（圆角、边框粗细、连接线粗细）：

```css
/* === 技术文档风格 === */

/* 节点：小圆角（默认 rx=5 太大） */
.node rect,
.node polygon {
  rx: 2;
  ry: 2;
  stroke-width: 1.5px;
}

/* 连接线：加粗，与节点边框匹配 */
.flowchart-link {
  stroke-width: 1.5px;
}

/* 箭头：加粗 */
marker path {
  stroke-width: 1px;
}

/* 节点文字：确保仿宋字体 */
.nodeLabel,
.label {
  font-family: FangSong, STFangsong, SimSun, serif;
}

/* 边标签文字 */
.edgeLabel {
  font-family: FangSong, STFangsong, SimSun, serif;
  font-size: 12px;
}
```

### mmdc 调用加 -C 参数

```javascript
const cssPath = path.resolve(__dirname, 'mermaid.css');
const cssArg = fs.existsSync(cssPath) ? `-C ${cssPath}` : '';

execSync(`npx mmdc -i ${inFile} -o ${outFile} -b white -w ${renderWidth} -H 2400 ${cfgArg} ${cssArg}`,
  { stdio: 'pipe', cwd: mmdcDir });
```

> **注意：** CSS 参数需要在 `preprocess.js` 和 `md2docx.js` 的 mmdc 调用中都添加。

---

## 改动四：ELK 引擎依赖安装

ELK 引擎已通过 `@mermaid-js/layout-elk` 包内置在 mmdc 中（mmdc ≥ 10）。当前环境 mmdc 11.15.0 已内置支持，**无需额外安装**。

**降级处理：** 如果 ELK 未安装或加载失败，mmdc 会报错。在 `renderMermaidBlocks` 中捕获错误后降级为 dagre：

```javascript
// preprocess.js 中的降级逻辑
try {
  execSync(`npx mmdc -i ${inFile} -o ${outFile} ...`);
} catch (e) {
  if (analysis.isDag && e.message.includes('elk')) {
    console.warn('[警告] ELK 引擎不可用，降级为 dagre + linear');
    // 重写 init 指令，去掉 defaultRenderer:'elk'，加 curve:'linear'
    const fallbackInit = buildMermaidInit({ ...analysis, isDag: false });
    fs.writeFileSync(inFile, fallbackInit + mermaidCode);
    execSync(`npx mmdc -i ${inFile} -o ${outFile} ...`);
  } else {
    throw e;
  }
}
```

---

## 改动五：preprocess.js 同步修改

`preprocess.js` 的 `renderMermaidBlocks` 是 mermaid 渲染的主要入口（预处理阶段将所有 mermaid 代码块替换为 PNG）。需要在此阶段注入 init 指令和 CSS 样式。

**位置：** `scripts/preprocess.js` 第 179-295 行

**修改内容：**
1. 引入共享模块 `scripts/mermaid-config.js`
2. `renderMermaidBlocks` 中：分析 mermaid → 注入 init → 渲染
3. mmdc 调用加 `-C` 参数

由于 `preprocess.js` 已渲染所有 mermaid，`md2docx.js` 的 `appendMermaid` 仅在处理未预处理的 mermaid 时才会被调用。为保持代码一致性，`md2docx.js` 也引用相同的共享模块。

---

## 改动六：共享模块提取

**新建文件：** `scripts/mermaid-config.js`

导出内容：
- `estimateMermaidWidth(mermaidCode)` → 返回 `{ needsLandscape, isFlowchart, isDag }`
- `hasCycle(children)` → DFS 环检测
- `buildMermaidInit(analysis)` → 生成 init 指令

**引用方式：**
- `scripts/preprocess.js`：`const { estimateMermaidWidth, hasCycle, buildMermaidInit } = require('./mermaid-config');`
- `scripts/md2docx.js`：`const { estimateMermaidWidth, buildMermaidInit } = require('./mermaid-config');`

---

## 渲染效果预期

### 改动前（默认渲染）

- 贝塞尔曲线连线
- 蓝紫色节点
- sans-serif 字体
- 大圆角
- 细线条

### 改动后

| 属性 | DAG（ELK）| 有回路（dagre）|
|------|----------|---------------|
| 连线 | 正交直角折线 | 直线（linear）|
| 节点颜色 | 白底、深灰边框 | 白底、深灰边框 |
| 字体 | 仿宋 | 仿宋 |
| 圆角 | 2px（接近直角）| 2px |
| 线条粗细 | 1.5px | 1.5px |
| 节点内边距 | 12px | 12px |

---

## 实施步骤

1. 新建 `scripts/mermaid-config.js` — 共享模块（`estimateMermaidWidth`、`hasCycle`、`buildMermaidInit`）
2. 新建 `scripts/mermaid.css` — 节点/连线视觉样式
3. 修改 `scripts/preprocess.js` — 引入共享模块，`renderMermaidBlocks` 注入 init 指令 + `-C` 参数
4. 修改 `scripts/md2docx.js` — 引入共享模块，`renderMermaid` 作为兜底（处理未预处理的 mermaid）

## 代码位置汇总

| 文件 | 操作 | 内容 |
|------|------|------|
| `scripts/mermaid-config.js` | 新建 | `estimateMermaidWidth`（含环检测）、`buildMermaidInit` |
| `scripts/mermaid.css` | 新建 | 节点圆角、线条粗细、字体 |
| `scripts/preprocess.js` | 修改 | 引入共享模块，渲染前注入 init，mmdc 加 `-C` |
| `scripts/md2docx.js` | 修改 | 引入共享模块，`renderMermaid` 作为兜底 |

## 风险点

| 风险 | 说明 | 缓解 |
|------|------|------|
| ELK 引擎不可用 | mmdc 版本过低未内置 ELK | 降级为 dagre + linear，有 try-catch |
| 用户已有 init 指令 | 双重注入冲突 | 检测 `%%{init:` 存在则跳过注入 |
| 仿宋字体未安装 | 渲染环境可能没有仿宋字体 | CSS 写 fallback 字体链：`FangSong, STFangsong, SimSun, serif` |
| ELK 重排兄弟节点顺序 | TD2/TD3/CMD 的排列顺序可能与源码声明不一致 | 对需求分解树可接受；如不可接受，用户可自行加 `%%{init: ...}%%` 指定 dagre |
| mermaid-cli 版本兼容性 | 旧版 mmdc 可能不支持 ELK layout 字段 | 降级兜底 + 文档说明最低版本要求 |
| CSS 选择器版本差异 | mermaid 不同版本的 SVG class 名称可能不同 | 使用稳定的 class 名（`.node`、`.flowchart-link`），必要时测试验证 |
