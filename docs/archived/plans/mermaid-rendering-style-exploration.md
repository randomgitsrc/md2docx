# Mermaid 渲染风格探索记录

> **状态：** 已放弃（2026-06-03）
>
> 本记录总结了多次尝试优化 Mermaid 渲染风格的过程，最终结论：**Mermaid 的 flowchart 语法不适合复杂的需求分解树，建议复杂图使用专业工具（draw.io、Visio）绘制后插入。**

---

## 背景

用户希望改善 md2docx 生成的 Mermaid 图的专业度，解决以下问题：
- 连接线用贝塞尔曲线（basis），"AI 味"重
- 配色是蓝紫渐变，不符合技术文档规范
- 字体不匹配（默认 sans-serif）
- 节点圆角太大、边框太细

---

## 探索历程

### 第一阶段：ELK 引擎自动选择（v1）

**思路：** 按图拓扑自动选择引擎
- 纯 DAG → ELK（正交直角连线）
- 有回路 → dagre + linear（直线）

**方案文件：** `docs/plans/mermaid-rendering-style.md`

**实现：**
- 新增 `scripts/mermaid-config.js` 共享模块
- 新增 `scripts/mermaid.css` 样式文件
- 修改 `preprocess.js` 和 `md2docx.js` 注入 init 指令

**问题：**
- ELK 正交布局把节点排成网格，连线呈直角
- 节点有多个出边时，线条从节点不同位置出发，视觉上"乱起八糟"
- 不适合需求分解树等复杂层级图

---

### 第二阶段：修正执行路径（v2）

**发现：** `preprocess.js` 已渲染所有 mermaid，md2docx.js 中的 init 注入逻辑不会被执行。

**修正：** 将 init 注入逻辑从 md2docx.js 移到 preprocess.js。

**评审文件：**
- `docs/review/review-mermaid-rendering-style.md`
- `docs/review/review-mermaid-rendering-style-expert.md`
- `docs/review/review-mermaid-rendering-style-v2.md`

---

### 第三阶段：取消 ELK，统一 dagre + monotoneX（v3）

**思路：** ELK 效果不佳，统一用 dagre + monotoneX 曲线

**验证结果：**

| 曲线类型 | 简单图 | 分支图 | 复杂交叉图 |
|---------|--------|--------|-----------|
| basis（默认） | ✅ | 交叉多 | 最乱 |
| monotoneX | ✅ | 比 basis 收敛 | 中等 |
| linear | ✅ | 最清晰 | 最清晰 |

**dagre 参数生效性：**
- `curve`：✅ 生效
- `padding`：✅ 生效
- `nodeSpacing`：✅ 生效
- `rankSpacing`：✅ 生效

**问题：** 即使使用 monotoneX，复杂需求分解树仍然显得拥挤、不专业。

---

### 第四阶段：实际文档测试（v4）

**测试用例：** 实际的需求分解树（6 个一级模块，每个下面多个子模块）

**尝试方案：**
1. **subgraph 分组** — 改变了原始树形结构，效果不佳
2. **classDef 样式** — 无法改变布局，只是颜色变化
3. **简化节点文本** — 减少换行，略有改善但有限
4. **LR 方向** — 横向展开，不适合竖置页面

**结论：** Mermaid 的 `graph TD` 语法本质上是一个通用有向图，不是专门的"需求分解树"或"用例图"工具。它缺少：
- 树形布局（层级对齐）
- 专业图形（椭圆、小人等 UML 元素）
- 自动避障（连线交叉严重）

---

## 最终结论

### Mermaid 的定位

**适合：**
- 简单流程图（3-10 个节点）
- 状态转换图
- 时序图
- 简单架构图

**不适合：**
- 复杂需求分解树（节点多、层级深）
- 标准 UML 用例图
- 专业架构图

### 建议

1. **简单图**：使用 Mermaid，保持默认渲染（或简单 init 配置）
2. **复杂图**：使用专业工具（draw.io、Visio、PlantUML）绘制后导出 PNG，插入 markdown

### 回退操作

如需恢复到探索前的状态：
```bash
git reset --hard c62a260  # v5 大图横置版本
```

---

## 附件：相关文件

| 文件 | 说明 |
|------|------|
| `scripts/mermaid-config.js` | 共享模块（已删除）— 拓扑分析、环检测、init 构建 |
| `scripts/mermaid.css` | 样式文件（已删除）— 节点圆角、线条粗细、字体 |
| `docs/plans/mermaid-rendering-style.md` | 方案文档（已更新为最终结论） |
| `docs/review/review-mermaid-rendering-style.md` | 初版评审 |
| `docs/review/review-mermaid-rendering-style-expert.md` | 专家评审 |
| `docs/review/review-mermaid-rendering-style-v2.md` | v2 评审 |
