# 评审：大图横置页面方案 v5（修正版）

## 评审日期
2026-06-03

## 评审范围
- `docs/plans/large-image-landscape-v5.md`
- 相关代码：`scripts/md2docx.js`、`scripts/preprocess.js`

---

## 总体结论

**方案成熟，普通图片双重条件判断合理，Mermaid SVG 探测是正确方向。**

---

## 问题一：普通图片横置条件合理 [确认]

双重条件 `downscaleRatio > 3 && aspectRatio > 2.0`：

- **downscaleRatio > 3**：图片像素宽度超过内容区宽度的 3 倍，竖置下细节损失大
- **aspectRatio > 2.0**：图够宽，横置有显著收益

验证表格中的边界情况：
- 1920×1080 截图：ratio 1.78 < 2.0 → 竖置 ✓
- 3000×800 架构图：ratio 3.75 > 2.0，downscale 5.1 > 3 → 横置 ✓
- 2000×900 宽图：ratio 2.2 > 2.0，downscale 3.4 > 3 → 横置（边界，合理）

**结论：双重条件有效，保留。**

---

## 问题二：SVG 探测需要增加错误处理 [中]

`getMermaidNaturalSize` 解析 SVG 时：
- mmdc 生成的 SVG 文件可能很大（几 MB）
- `viewBox` 格式可能有变体

**建议增加：**
- 流式读取或限制读取大小
- 多种 viewBox 格式匹配（单引号、无空格等）
- 解析失败时降级为竖置

---

## 问题三：mmdc SVG 输出支持需验证 [中]

方案假设 `mmdc -i input.mmd -o output.svg` 可行。

**建议：** 先验证 mmdc 是否支持 SVG 输出，如果不支持，改用其他方式（如先输出 PNG 再用其他工具提取尺寸）。

---

## 问题四：preprocess.js 渲染参数 [低]

preprocess.js 改为 `-w 2400`，md2docx.js 根据情况用 `-w 2400` 或 `-w 3600`。

**建议：** 统一默认参数为 `-w 2400`，横置时再单独用 `-w 3600`。

---

## 优先级

| 优先级 | 问题 | 建议 |
|--------|------|------|
| 中 | SVG 探测错误处理 | 增加容错逻辑 |
| 中 | mmdc SVG 输出支持 | 验证并调整 |
| 低 | 渲染参数统一 | 统一默认参数 |
