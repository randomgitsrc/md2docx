# docs/issues — 缺陷记录

本目录记录**已复现坐实、但尚未处理**的缺陷。与 `plans/`、`review/` 的分工：

- `plans/` — 打算怎么做（方案设计）
- `review/` — 方案评审意见
- `issues/` — **发现了什么问题**（现象、复现、根因定位、影响面），不含实施方案

处理完的 issue 移入 `docs/archived/issues/`（归档 = 移动位置，不删除），
并在文件头部把 `status` 改为 `fixed` 或 `wontfix`。

## 问题清单

| 编号 | 标题 | 严重度 | 状态 | 主要位置 |
|---|---|---|---|---|
| [001](001-consecutive-landscape-empty-section.md) | 连续横置图之间生成空节，多出空白页 | 中 | open | `scripts/md2docx.js` `consumeToken` / `resumePortraitSection` |
| [002](002-pipeline-drops-local-images.md) | 完整流水线丢失作者自带的本地图片 | 高 | open | `scripts/md2docx.js` `appendImageParagraph` / `convert` |
| [003](003-bare-activity-names.md) | 旧式活动图（裸写活动名）渲染失败 | 中 | fixed | `scripts/plantuml-renderer.js` `fixBareActivityNames` |
| [004](004-missing-table-separator-row.md) | 缺分隔行的管道表格被当作普通段落 | 高 | fixed | `scripts/preprocess.js` `repairLooseTables`、`scripts/md2docx.js` `consumeTable` |
| [005](005-table-column-width-vertical-text.md) | 表格窄列被压到逐字竖排（列宽算法缺陷） | 中 | fixed | `scripts/md2docx.js` `consumeTable` 列宽分配段 |

> 003 / 004 / 005 均由外部批量生成文档 `GMS-JD-SRS-V1.0.md`（1.4 MB，258 图 + 1289 表）
> 暴露，已实施兼容修复并完成回归；详细证据与验证见各自文档。

## 记录约定

- 每条须给出**可复现的最小输入**与**实测观测值**，不写"疑似""可能"当成结论；
  未能验证的部分单列一节并明确标注置信度。
- 引用代码位置以**符号名（函数 / 方法名）为主**、行号为辅——行号会随改动漂移，
  项目既有文档已因此踩过坑（见 `docs/review/review-windows-native.md` 的"行号时效性"说明）。
- 记录行号时注明所在 commit，便于回溯。
