# 评审：大图横置页面方案 v3（最终版）

## 评审日期
2026-06-02

## 评审范围
- `docs/plans/large-image-landscape-v3.md`

---

## 总体结论

**方案成熟度高，但仍有几个细节需要澄清。**

---

## 问题一：`CONTENT_HEIGHT_PX` 去掉 0.80 系数的风险 [中]

方案建议去掉 0.80 系数，让图片占满整页高度。

**质疑：**
- 去掉 0.80 系数后，图片可能紧贴页边距，与上下方文字没有间距
- 虽然 `spacing.before/after` 可以控制间距，但如果图片本身高度接近页面高度，间距会被压缩
- 更重要的是：如果图片高度 > 内容区高度，`fitImageToPage` 会按高度缩放，最终宽度会更小

**建议：**
- 保留 0.80 系数，或者改为 0.90
- 或者明确说明：去掉系数后，图片高度限制为内容区高度的 100%，但 `spacing` 仍保证上下间距

---

## 问题二：图注恢复竖置的时机不够明确 [高]

方案说"在 Caption 检测分支末尾判断 `currentSection.orientation === 'landscape'` 则恢复"。

**质疑：**
- 如果图注是多行文本（虽然很少见），或者图注后面紧跟其他内容（如段落），恢复时机是否正确？
- 如果宽矮图后面没有图注（如用户忘记写），landscape section 只含图片，之后的内容会进入 landscape section 还是 portrait section？

**建议：**
- 明确恢复竖置的时机：在检测到 Caption 段落被 push 后，**且下一个 token 不是图片相关 token 时**
- 或者更简单：在 `consumeToken` 的每个分支开头检查，如果当前是 portrait section 且不需要横置，则保持；如果需要恢复，则在处理完当前 token 后恢复

---

## 问题三：连续多张横置图的处理 [中]

方案提到"连续多张横置图"的风险：

**质疑：**
- 如果两张宽矮图连续出现，中间没有正文，会产生两个 landscape section
- 两个 landscape section 之间会有 portrait section（即使为空），导致页面布局混乱

**建议：**
- 在 `startLandscapeSection` 时，检查上一个 section 是否也是 landscape，如果是，合并到同一个 section
- 或者在 `resumePortraitSection` 时，检查中间是否有空的 portrait section，如果有，删除它

---

## 问题四：`SectionType.CONTINUOUS` 的使用 [中]

方案使用 `SectionType.CONTINUOUS` 让横置 section 紧跟上一 section。

**质疑：**
- `CONTINUOUS` 在 Word 中表示"不换页"，但横置 section 需要换页（从竖置到横置）
- 如果上一页是竖置，当前 section 是横置，Word 会自动换页
- 但如果上一页刚好是横置（连续多张横置图），`CONTINUOUS` 会导致它们在同一页

**建议：**
- 横置 section 使用 `SectionType.NEXT_PAGE` 或 `SectionType.ODD_PAGE`
- 恢复竖置时使用 `SectionType.ODD_PAGE`（与当前一致）

---

## 问题五：页码连续性验证 [低]

方案说"非首段不设 start，Word 自动续页码"。

**质疑：**
- 需要验证：横置 section 的页码是否从上一 section 的末尾继续
- 如果封面和目录使用罗马数字，正文使用阿拉伯数字，横置 section 的页码格式是否正确

**建议：**
- 在测试时验证页码连续性
- 确保横置 section 的页码格式与正文一致

---

## 修正后的优先级

| 优先级 | 问题 | 建议 |
|--------|------|------|
| 高 | 图注恢复竖置时机 | 明确恢复条件，处理无图注情况 |
| 中 | 连续多张横置图 | 合并或删除空的 portrait section |
| 中 | `SectionType.CONTINUOUS` | 改为 `NEXT_PAGE` 或 `ODD_PAGE` |
| 中 | `CONTENT_HEIGHT_PX` 系数 | 保留或改为 0.90 |
| 低 | 页码连续性 | 测试验证 |

---

## 总体建议

1. **明确图注恢复竖置的时机**，处理无图注情况
2. **处理连续多张横置图**，避免产生空的 portrait section
3. **横置 section 使用 `NEXT_PAGE`**，而不是 `CONTINUOUS`
4. **保留 `CONTENT_HEIGHT_PX` 的 0.80 系数**，或改为 0.90
5. **测试页码连续性**
