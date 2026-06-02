# 图注与图分页问题修正方案

## 评审反馈

基于 `docs/review/review-image-caption-pagination.md` 的评审意见，修正原方案。

## 修正后的方案

### 问题 1：Caption 样式 `keepNext` 方向错误 [高]

**现状：**
- Caption 样式已有 `keepNext: true`，但方向错误
- `keepNext` 语义：当前段落与下一段保持同页
- Caption 的下一段是正文，不是图片

**修正：**
- 从 Caption 样式移除 `keepNext: true`
- 在图片段落（`appendImageParagraph` 和 `appendMermaid`）加 `keepNext: true`

### 问题 2：`patchDocxPagination` 与样式定义重叠 [高]

**现状：**
- `patchDocxPagination` 已通过 python-docx 给 Caption 注入 `keepNext` + `keepLines`
- 与 docx.js 层面的样式定义重复

**修正：**
- 移除 `patchDocxPagination` 中对 Caption 的注入
- 统一在 docx.js 层面处理

### 问题 3：`appendMermaid` 遗漏 [中]

**修正：**
- 同时修改 `appendImageParagraph` 和 `appendMermaid`
- 或抽取为公共方法

### 问题 4：图注位置假设 [低]

**修正：**
- 方案假设图注在图片下方
- 技术文档规范已要求如此

## 实施步骤

1. **`appendImageParagraph` 和 `appendMermaid`**：图片 Paragraph 加 `keepNext: true`
2. **Caption 样式定义**：移除 `keepNext: true`，加 `keepLines: true`
3. **`patchDocxPagination`**：移除对 Caption 的 `keepNext` + `keepLines` 注入
4. **（可选）** `preprocess.js` 增加图注位置校验

## 代码位置

- `scripts/md2docx.js`：
  - `appendImageParagraph` 方法
  - `appendMermaid` 方法
  - `documentStyles` 中 Caption 样式
  - `patchDocxPagination` 函数
