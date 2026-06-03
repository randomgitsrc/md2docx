---
status: deprecated
reason: 方案已放弃，详见 docs/plans/mermaid-rendering-style-exploration.md
date: 2026-06-03
---


# 评审：Mermaid 渲染配置方案

## 评审日期
2026-06-03

## 评审范围
- `docs/plans/mermaid-rendering-style.md`
- 相关代码：`scripts/md2docx.js`、`scripts/preprocess.js`

---

## 总体结论

**方案方向正确，init 指令注入 + CSS 样式控制是合理的技术路线。但存在关键架构问题：preprocess.js 已渲染所有 mermaid，md2docx.js 中的 init 注入逻辑实际上不会被执行。**

---

## 问题一：执行路径错位 [高]

### 现状

当前执行流程：
1. `preprocess.js`：渲染所有 mermaid → PNG，替换为 `![图 X](path)`
2. `md2docx.js`：遇到 `![图 X]` → 走 `appendImageParagraph` → 按普通图片处理

方案中的 init 注入和引擎选择逻辑放在 `md2docx.js` 的 `renderMermaid` 函数中，但该函数在 preprocess 后**几乎不会被调用**。

### 影响

- ELK 引擎选择、黑白灰配色、仿宋字体等配置**无法生效**
- 所有 mermaid 图仍使用默认的蓝紫配色 + 贝塞尔曲线

### 建议

**将 init 注入和引擎选择逻辑移到 `preprocess.js` 的 `renderMermaidBlocks` 函数中。**

`md2docx.js` 中的 `appendMermaid` 作为兜底（处理未预处理的 mermaid 代码块）。

---

## 问题二：共享模块提取 [中]

### 现状

方案建议新建 `scripts/mermaid-config.js` 共享模块，导出 `estimateMermaidWidth`、`hasCycle`、`buildMermaidInit`。

当前 `estimateMermaidWidth` 在 `md2docx.js` 中，preprocess.js 没有横置判断逻辑。

### 建议

如果按问题一的调整（逻辑移到 preprocess.js），则：
- `estimateMermaidWidth` 需要移到 preprocess.js（用于引擎选择）
- `hasCycle` 和 `buildMermaidInit` 放在 preprocess.js
- md2docx.js 的 `appendMermaid` 作为简化版兜底

或者保持共享模块方案，但确保两个脚本都能正确 `require`。

---

## 问题三：preprocess.js 渲染参数不一致 [中]

### 现状

当前 preprocess.js 的 mmdc 调用：
```bash
npx mmdc -i "${mmdPath}" -o "${pngPath}" -b white -w 3600 -H 2400
```

方案提到 preprocess.js 应改为 `-w 2400`，但当前代码仍是 `-w 3600`。

### 建议

统一渲染参数：
- preprocess.js 阶段：根据引擎选择动态决定宽度（ELK 用 3600，dagre 用 2400）
- 或者统一用 3600（高分辨率，后续缩放不影响质量）

---

## 问题四：CSS 文件路径问题 [中]

### 现状

方案中 CSS 路径：
```javascript
const cssPath = path.resolve(__dirname, 'mermaid.css');
```

但 mmdc 的 `-C` 参数需要 CSS 文件存在。如果用户删除或移动了该文件，渲染会失败。

### 建议

增加容错：
```javascript
const cssPath = path.resolve(__dirname, 'mermaid.css');
const cssArg = fs.existsSync(cssPath) ? `-C ${cssPath}` : '';
```

同时 CSS 内容需要验证是否适用于 mmdc 生成的 SVG。

---

## 问题五：ELK 对循环图的处理 [低]

### 验证结果

测试显示 ELK 可以渲染循环图（`A --> B --> C --> A`），文件大小与 dagre 不同，说明布局确实不同。

但 ELK 对循环图的处理方式（正交直角连线 + 循环边）可能与 dagre 有视觉差异，需要确认是否可接受。

### 建议

保留方案中的降级逻辑：如果 ELK 渲染失败，降级为 dagre + linear。

---

## 问题六：用户已有 init 指令的处理 [低]

### 现状

方案提到检测 `%%{init:` 存在则跳过注入，这个逻辑正确。

### 建议

确保正则匹配准确：
```javascript
const hasUserInit = /^%%\{init:/m.test(mermaidCode);
```

注意 `%%{` 中的 `{` 在正则中不需要转义，但 `%%` 需要准确匹配。

---

## 修正后的实施建议

### 步骤调整

1. **新建 `scripts/mermaid-config.js`**（共享模块）：
   - `estimateMermaidWidth(mermaidCode)` → 返回 `{ needsLandscape, isFlowchart, isDag }`
   - `hasCycle(children)` → DFS 环检测
   - `buildMermaidInit(analysis)` → 生成 init 指令

2. **修改 `scripts/preprocess.js`**：
   - 引入共享模块
   - `renderMermaidBlocks` 中：分析 mermaid → 注入 init → 渲染
   - mmdc 调用加 `-C` 参数

3. **修改 `scripts/md2docx.js`**：
   - `appendMermaid` 中：引入共享模块，应用相同的 init 注入逻辑（兜底）
   - 保持现有横置判断逻辑

4. **新建 `scripts/mermaid.css`**：
   - 节点圆角、线条粗细、字体

5. **`package.json`**：
   - 不需要添加 `@mermaid-js/layout-elk`（mmdc 11.15.0 已内置）

### 优先级

| 优先级 | 问题 | 建议 |
|--------|------|------|
| 高 | 执行路径错位 | 将 init 注入移到 preprocess.js |
| 中 | 共享模块提取 | 新建 mermaid-config.js |
| 中 | 渲染参数不一致 | 统一 preprocess.js 参数 |
| 中 | CSS 文件路径 | 增加容错判断 |
| 低 | ELK 循环图 | 保留降级逻辑 |
| 低 | 用户 init 检测 | 确保正则准确 |

---

## 附录：验证结果

| 测试项 | 结果 |
|--------|------|
| mmdc 版本 | 11.15.0 |
| ELK 通过 config 文件 | ✅ 成功 |
| ELK 通过 init 指令 | ✅ 成功 |
| `@mermaid-js/layout-elk` | ✅ 存在（v0.2.1），但 mmdc 已内置 |
| `theme: 'base'` | ✅ 成功 |
| `themeVariables` | ✅ 成功 |
| `flowchart.padding/nodeSpacing` | ✅ 成功 |
| `curve: 'linear'` | ✅ 成功 |
| `-C` CSS 参数 | ✅ 成功 |
| 复杂图 ELK vs dagre | ✅ 布局不同 |
| 循环图 ELK | ✅ 成功 |
