# 表格题注与表格同页修复方案

## 问题描述

当前生成的 DOCX 中，表格题注（Caption）和表格可能分页显示：

```
[页尾]
...正文...
表 3-1 系统接口列表     ← Caption（题注）

[下一页]
[表格内容]              ← 表格
```

同样的问题也可能出现在图片题注和图片之间。

## 根因分析

`patchDocxPagination()` 后处理函数中，注释写明要给 Caption 段落加 `keepNext + keepLines`，但实际代码只加了 `keepLines`，**漏掉了 `keepNext`**。

```python
# 当前代码（有 bug）
# 2. Caption 段落加 keepLines
for p in doc.paragraphs:
    if p.style.style_id == 'Caption':
        pPr = p._element.get_or_add_pPr()
        if pPr.find(qn('w:keepLines')) is None:
            pPr.append(OxmlElement('w:keepLines'))
        # ❌ 缺少: pPr.append(OxmlElement('w:keepNext'))
```

## 修复方案

### 修改 `patchDocxPagination` 函数

**位置：** `scripts/md2docx.js` 第 1143-1150 行

**修改前：**
```python
# 2. Caption 段落加 keepLines
#    keepLines: 图注段落内部不分页
for p in doc.paragraphs:
    s = p.style
    if s is not None and s.style_id == 'Caption':
        pPr = p._element.get_or_add_pPr()
        if pPr.find(qn('w:keepLines')) is None:
            pPr.append(OxmlElement('w:keepLines'))
```

**修改后：**
```python
# 2. Caption 段落加 keepNext + keepLines
#    keepNext: 题注与表格/图片保持同页
#    keepLines: 题注段落内部不分页
for p in doc.paragraphs:
    s = p.style
    if s is not None and s.style_id == 'Caption':
        pPr = p._element.get_or_add_pPr()
        if pPr.find(qn('w:keepNext')) is None:
            pPr.append(OxmlElement('w:keepNext'))
        if pPr.find(qn('w:keepLines')) is None:
            pPr.append(OxmlElement('w:keepLines'))
```

## 机理说明

### `keepNext` 的作用

- 设置在段落 A 上
- 效果：段落 A 和下一段落 B 保持同页
- 如果段落 A 在页尾，装不下段落 B，则段落 A 会整体移到下一页

### 应用到本题

- Caption 段落设置 `keepNext` → Caption 和表格/图片保持同页
- 如果 Caption 在页尾，装不下表格/图片，则 Caption 会整体移到下一页

### `keepLines` 的作用（已有，保持不变）

- Caption 段落设置 `keepLines` → Caption 段落内部不分页
- 如 "表 3-1 系统接口列表" 不会拆成两行分别在两页

### 与 `tableHeader` 的关系

- `tableHeader: true` — Word 自动在跨页时重复表头（已有功能）
- `keepNext` — 表头行首段落与数据行保持同页（已有功能）
- 两者不冲突：`tableHeader` 处理跨页重复，`keepNext` 处理表头与第一行数据的关系

### `keepNext` 的副作用（预期行为）

如果 Caption 段落很长，且后面紧跟着大表格，可能导致整页内容被挤到下一页，当前页留下空白。这是 Word 的正常分页行为，无需处理。

## 验证方法

1. 生成包含表格的 DOCX
2. 在 Word 中打开，切换到"视图" → "页面视图"
3. 找到靠近页边界的表格
4. 观察表格题注和表格是否在同一页
5. 如果题注在页尾，应自动移到下一页与表格在一起
6. 也可以右键点击题注段落 → "段落" → "换行和分页"，查看"与下段同页"是否勾选

## 文件变更

| 文件 | 操作 | 内容 |
|------|------|------|
| `scripts/md2docx.js` | 修改 | `patchDocxPagination` 中 Caption 段落补加 `keepNext` |
