---
status: deprecated
reason: 方案已放弃，详见 docs/plans/mermaid-rendering-style-exploration.md
date: 2026-06-03
---


# 专家评审：Mermaid 渲染配置方案（修正版）

## 评审日期
2026-06-03

## 评审范围
- `docs/plans/mermaid-rendering-style.md`（修正版）
- 相关代码：`scripts/md2docx.js`、`scripts/preprocess.js`

---

## 总体结论

**方案修正方向正确，执行路径问题已解决，但仍存在几个需要关注的问题。**

---

## 问题一：共享模块的循环依赖风险 [中]

### 现状

`scripts/mermaid-config.js` 需要被 `preprocess.js` 和 `md2docx.js` 同时引用。

### 风险

如果共享模块内部又引用了 `preprocess.js` 或 `md2docx.js` 中的内容，会导致循环依赖。

### 建议

确保 `mermaid-config.js` 是纯函数模块，不引用任何其他项目文件：

```javascript
// mermaid-config.js — 纯函数，无外部依赖
function estimateMermaidWidth(mermaidCode) { ... }
function hasCycle(children) { ... }
function buildMermaidInit(analysis) { ... }
module.exports = { estimateMermaidWidth, hasCycle, buildMermaidInit };
```

---

## 问题二：preprocess.js 渲染失败后的降级路径 [中]

### 现状

`preprocess.js` 的 `renderMermaidBlocks` 中已有错误处理（`try-catch`），但降级逻辑是"自动修复特殊字符"而非"降级引擎"。

### 风险

如果 ELK 渲染失败，当前代码会抛出异常并降级为文本块，不会尝试用 dagre 重新渲染。

### 建议

在 `renderMermaidBlocks` 的 catch 块中增加 ELK 降级逻辑：

```javascript
try {
  // 先尝试 ELK
  execSync(`npx mmdc ...`);
} catch (e) {
  if (analysis.isDag) {
    console.warn('[mermaid] ELK 渲染失败，尝试 dagre...');
    // 重写 init 为 dagre + linear
    const fallbackInit = buildMermaidInit({ ...analysis, isDag: false });
    fs.writeFileSync(mmdPath, fallbackInit + mermaidCode);
    try {
      execSync(`npx mmdc ...`); // 不带 ELK
      rendered = true;
    } catch (e2) {
      console.warn('[mermaid] dagre 也失败: ' + e2.message);
    }
  }
  // 如果还是失败，走现有降级逻辑（文本块）
}
```

---

## 问题三：CSS 对 mmdc 的实际影响范围 [中]

### 现状

方案中的 CSS：
```css
.node rect, .node polygon { rx: 2; ry: 2; }
.flowchart-link { stroke-width: 1.5px; }
```

### 风险

mmdc 生成的 SVG 中，CSS 选择器可能不匹配：
- mmdc 可能使用内联样式（`style="..."`）而非 class
- 不同版本的 mermaid 生成的 SVG 结构可能不同

### 建议

1. 先手动测试 CSS 是否生效
2. 如果 CSS 无效，考虑改用 init 指令中的 `themeVariables` 控制尽可能多的样式
3. 记录 CSS 生效的 mmdc 版本范围

---

## 问题四：init 指令中的 `defaultRenderer` vs `layout` [高]

### 现状

方案中：
```javascript
init.flowchart = { defaultRenderer: 'elk' };
```

### 风险

验证测试使用的是 `defaultRenderer: 'elk'`，但方案原文（改动二）中写的是 `init.layout = 'elk'`。

`layout` 字段在 mermaid 中用于指定整体布局引擎（如 `dagre`、`elk`），而 `defaultRenderer` 是 `flowchart` 子配置中的字段。

### 建议

统一使用 `defaultRenderer: 'elk'`，并确认这是正确的字段名。验证测试已通过，说明该字段有效。

---

## 问题五：横置判断与 init 注入的耦合 [低]

### 现状

`estimateMermaidWidth` 返回 `{ needsLandscape, isFlowchart, isDag }`，既用于横置判断，又用于引擎选择。

### 风险

横置判断（`widthScore > 5`）和引擎选择（`isDag`）是两个独立的需求，耦合在一个函数中可能导致未来修改困难。

### 建议

可以接受当前设计，但建议在未来需要扩展时拆分为两个独立函数：
- `analyzeMermaidTopology(mermaidCode)` → 返回拓扑分析结果
- `shouldLandscape(topology)` → 基于拓扑判断横置
- `selectEngine(topology)` → 基于拓扑选择引擎

---

## 问题六：preprocess.js 中的渲染宽度 [低]

### 现状

当前 preprocess.js 使用固定 `-w 3600`，方案未明确修改。

### 建议

如果 init 注入后 ELK 引擎的图更宽，`-w 3600` 可能不够。建议：
- ELK 图使用 `-w 3600`（保持当前）
- 或根据横置判断动态调整（但 preprocess.js 不做横置判断）

考虑到 preprocess.js 的输出 PNG 后续会被 md2docx.js 的 `appendImageParagraph` 按普通图片处理（走双重条件判断横置），当前 `-w 3600` 是合理的。

---

## 修正后的实施优先级

| 优先级 | 问题 | 建议 |
|--------|------|------|
| 高 | `defaultRenderer` vs `layout` | 确认并统一字段名 |
| 中 | 共享模块循环依赖 | 确保纯函数 |
| 中 | ELK 降级路径 | 在 catch 块中增加 dagre 降级 |
| 中 | CSS 实际影响 | 手动测试验证 |
| 低 | 横置与引擎耦合 | 接受当前设计 |
| 低 | 渲染宽度 | 保持 `-w 3600` |

---

## 最终建议

方案可以实施，但建议按以下顺序：
1. 先确认 `defaultRenderer: 'elk'` 是正确的字段名
2. 手动测试 CSS 是否对 mmdc 生效
3. 实施共享模块和 init 注入
4. 添加 ELK 降级逻辑
