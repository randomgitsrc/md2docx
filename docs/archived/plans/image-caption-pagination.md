# 图注与图分页问题解决方案

## 问题描述

当前生成的 DOCX 中，图片和图注（Caption）可能出现在不同页：
- 图片在第 n 页
- 图注在第 n+1 页

## 根本原因

1. 图片和图注是**两个独立的 Paragraph**
2. 图片段落没有设置分页控制属性
3. Word 默认分页行为：当页面空间不足时，会把后面的内容推到下一页

## 方案分析

### 方案 A：keepNext + keepLines（推荐）

**实现方式：**
- 图片段落：加 `keepNext: true`
- 图注段落：加 `keepLines: true`

**原理：**
- `keepNext`：当前段落与下一段尽量保持同页
- `keepLines`：段落内部不分页（图注本身很短，主要是防止图注被拆分到两页）

**优点：**
- 改动小，容易实现
- 不需要重构 token 消费逻辑

**风险：**
- 如果图片和图注之间有空白段落，`keepNext` 会绑定到空白段落
- 但从代码看，图片和图注之间没有显式插入空白段落

### 方案 B：图片+图注合并为一个段落

**实现方式：**
- 检测到"图片+图注"模式时，把两者合并为一个 Paragraph
- 用 `ImageRun` + `TextRun` 组合

**优点：**
- 绝对绑定，不会分页

**缺点：**
- 需要重构 `consumeToken` 逻辑
- 需要检测"图片后面紧跟图注"的模式
- 代码复杂度高

### 方案 C：空段落插入 keepNext

**实现方式：**
- 图片和图注之间如果有空段落，给空段落加 `keepNext`

**缺点：**
- 空段落本身不应该有分页控制
- 逻辑复杂，难以维护

## 推荐方案：A

## 实现步骤

1. 修改 `appendImageParagraph`，给图片段落加 `keepNext: true`
2. 修改 Caption 样式定义，加 `keepLines: true`
3. 测试验证

## 代码位置

- `scripts/md2docx.js` 中的 `appendImageParagraph` 方法
- `scripts/md2docx.js` 中的 `documentStyles` 定义
