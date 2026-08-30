---
status: deprecated
reason: 方案已放弃，详见 docs/plans/mermaid-rendering-style-exploration.md
date: 2026-06-03
---


# 专家评审：Mermaid 渲染配置方案（修正版 v2）

## 评审日期
2026-06-03

## 评审范围
- `docs/plans/mermaid-rendering-style.md`（修正版 v2）
- 相关代码：`scripts/preprocess.js`、`scripts/md2docx.js`

---

## 总体结论

**方案大幅简化，取消 ELK 是正确决策。但存在几个需要关注的问题。**

---

## 问题一：`monotoneX` 曲线的实际效果未验证 [高]

### 现状

方案选择 `curve: 'monotoneX'`，理由是"比 basis 更收敛"。

### 风险

`monotoneX` 是 d3 的一种曲线插值方式，它在保持单调性的同时生成平滑曲线。但：
- 对于复杂图（多节点、多交叉），`monotoneX` 可能仍然产生大量交叉线
- 对于简单图（线性流程），`monotoneX` 可能过于弯曲

### 建议

**验证 `monotoneX` 在不同场景下的实际效果：**
- 简单线性图（A→B→C）
- 分支图（A→B, A→C）
- 复杂交叉图（多节点多连接）

如果效果不佳，考虑：
- 简单图用 `linear`（直线）
- 复杂图用 `monotoneX`
- 或统一用 `linear`（最保守，不会出错）

---

## 问题二：init 注入是否对 dagre 生效 [中]

### 现状

方案中：
```javascript
flowchart: {
  curve: 'monotoneX',
  padding: 12,
  nodeSpacing: 30,
  rankSpacing: 40,
}
```

### 风险

`flowchart` 子配置在 dagre 引擎下是否完全生效？验证测试显示 `curve` 有效，但 `padding`、`nodeSpacing`、`rankSpacing` 是否对 dagre 生效需要确认。

### 建议

手动测试 dagre 引擎下这些参数是否生效。

---

## 问题三：删除 `mermaid-config.js` 的向后兼容性 [中]

### 现状

上一版方案创建了 `scripts/mermaid-config.js`，当前代码已引用它。

### 风险

如果直接删除 `mermaid-config.js`，`preprocess.js` 和 `md2docx.js` 中的 `require('./mermaid-config')` 会报错。

### 建议

1. 保留 `mermaid-config.js` 但简化内容（只保留 `buildMermaidInit`）
2. 或修改 `preprocess.js` 和 `md2docx.js` 移除引用

---

## 问题四：`isFlowchart` 检测的准确性 [低]

### 现状

```javascript
const isFlowchart = /^\s*(?:graph|flowchart)\s+/m.test(mermaidCode);
```

### 风险

- `graph` 关键字也可能出现在其他 mermaid 图类型中（如 `requirementDiagram` 内部）
- 用户可能在注释中包含 `graph` 字样

### 建议

使用更精确的正则：
```javascript
const isFlowchart = /^\s*(?:graph|flowchart)\s+(?:TD|TB|LR|RL|BT|\w+)/im.test(mermaidCode);
```

---

## 问题五：删除 `estimateMermaidWidth` 后的横置判断 [中]

### 现状

上一版方案中 `estimateMermaidWidth` 用于判断横置（`needsLandscape`）。

### 风险

如果删除 `mermaid-config.js`，`md2docx.js` 中的横置判断逻辑需要保留。

### 建议

`md2docx.js` 中的 `estimateMermaidWidth` 函数（第 170-200 行）应保留，因为它用于 `renderMermaid` 和 `appendImageParagraph` 的横置判断。

---

## 修正建议

### 建议 1：验证 `monotoneX` 效果

在实施方案前，先用实际 mermaid 代码测试 `monotoneX` 效果。

### 建议 2：保留 `mermaid-config.js`

保留文件但简化内容：
```javascript
// mermaid-config.js
function buildMermaidInit() {
  const init = {
    theme: 'base',
    themeVariables: {
      primaryColor: '#ffffff',
      primaryTextColor: '#000000',
      primaryBorderColor: '#333333',
      lineColor: '#333333',
      secondaryColor: '#f5f5f5',
      tertiaryColor: '#e8e8e8',
      fontFamily: 'FangSong, STFangsong, SimSun, serif',
      fontSize: '14px',
    },
    flowchart: {
      curve: 'monotoneX',
      padding: 12,
      nodeSpacing: 30,
      rankSpacing: 40,
    },
  };
  return `%%{init: ${JSON.stringify(init)}}%%\n`;
}

module.exports = { buildMermaidInit };
```

### 建议 3：简化实施步骤

1. 修改 `scripts/mermaid-config.js` — 简化为只导出 `buildMermaidInit`
2. 修改 `scripts/preprocess.js` — 引入 `buildMermaidInit`，注入 init
3. 修改 `scripts/md2docx.js` — 引入 `buildMermaidInit`，注入 init（兜底）

---

## 优先级

| 优先级 | 问题 | 建议 |
|--------|------|------|
| 高 | `monotoneX` 效果未验证 | 先测试再实施 |
| 中 | init 对 dagre 是否生效 | 手动测试确认 |
| 中 | `mermaid-config.js` 向后兼容 | 保留并简化 |
| 低 | `isFlowchart` 检测 | 使用更精确的正则 |
| 低 | 横置判断 | 保留 `md2docx.js` 中的函数 |
