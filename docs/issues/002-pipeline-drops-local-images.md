# 002 — 完整流水线丢失作者自带的本地图片

| 项目 | 值 |
|---|---|
| 状态 | open |
| 严重度 | 高 |
| 发现日期 | 2026-09-17 |
| 记录时 commit | `0edb265` |
| 主要位置 | `scripts/md2docx.js`：`appendImageParagraph()`（图片解析基准）、`convert()`（`srcDir` 计算与传递）、`Md2DocxConverter` 构造函数 |

## 1. 现象

按项目推荐方式转换（`./scripts/md2docx.sh` 或 `node scripts/cli.js`，即 preprocess → convert
两阶段），Markdown 中作者自己写的本地图片引用**全部丢失**，输出为 `[图片缺失: xxx]` 文字。

同一份 Markdown 若**直接**运行 `node scripts/md2docx.js`，图片正常嵌入。
即：推荐路径失效、非常规路径可用。

## 2. 最小复现

```bash
mkdir -p /tmp/m2d-issue/pics && cd /tmp/m2d-issue
# pics/diagram.png: 任意 PNG

printf -- '---\ntitle: 本地图片流水线测试\n---\n\n# 本地图片流水线测试\n\n正文一。\n\n![架构图](pics/diagram.png)\n\n**图 1-1 架构图**\n' > localimg.md
```

用两种方式各跑一次，再数产出的 DOCX 里 `<w:drawing>` 节点数：

```bash
# A) 直接运行（两阶段中的第二阶段）
node /path/to/md2docx/scripts/md2docx.js /tmp/m2d-issue/localimg.md
node -e 'const A=require("adm-zip");console.log("图片数:",(new A("/tmp/m2d-issue/output/docx/localimg.docx").readAsText("word/document.xml").match(/<w:drawing>/g)||[]).length)'

# B) 完整流水线（推荐用法）
rm -rf /tmp/m2d-issue/output
node /path/to/md2docx/scripts/cli.js /tmp/m2d-issue/localimg.md
node -e 'const A=require("adm-zip");console.log("图片数:",(new A("/tmp/m2d-issue/output/docx/localimg.docx").readAsText("word/document.xml").match(/<w:drawing>/g)||[]).length)'
```

## 3. 实测观测

| 运行方式 | `[md2docx] 嵌入图片` 日志 | DOCX 内 `<w:drawing>` 数 |
|---|---|---|
| A 直接 `md2docx.js` | `1 个` | 1 |
| B 完整流水线 `cli.js` | `0 个` | 0 |

`clean.md` 中图片引用被**原样保留**（未改写为相对 `output/clean/` 的可用路径）：

```text
10:![架构图](pics/diagram.png)
```

B 方式产出的正文可见文字为 `[图片缺失: pics/diagram.png]`。

## 4. 根因

图片路径以 `inputDir` 为基准解析，而两阶段流水线中 `inputDir` 是 `output/clean/`，
不是作者的源文件目录：

```javascript
// appendImageParagraph()
const imgPath = path.resolve(this.inputDir, decodedSrc);
```

流水线中的实际取值：

```javascript
// convert()
const inputDir = path.dirname(path.resolve(inputPath));   // = <源目录>/output/clean
```

于是 `pics/diagram.png` 被解析成 `<源目录>/output/clean/pics/diagram.png` → 不存在 →
走"图片未找到"降级分支。**preprocess 并不把作者的图片复制到 `output/clean/` 下**
（`preprocess.js` 中唯一的 `copyFileSync` 只用于 CLI 显式指定 `--output` 的场景，
与图片无关），所以该路径永远不会存在。

### 已存在但未接通的修复意图：`srcDir`

代码里已经有 `srcDir`（注释写着"图片引用解析目录"），`convert()` 也**正确算出了**它：

```javascript
const srcDir = opts.srcDir || (isInOutputClean ? outputBase : inputDir);   // 第 1273 行
const converter = new Md2DocxConverter({ inputDir, srcDir, listPoolSize }); // 第 1324 行
```

构造函数也存了下来：

```javascript
this.srcDir = opts.srcDir || this.inputDir;   // 第 331 行
```

但 `this.srcDir` **在整个文件中再无任何消费点**。`grep -n "srcDir" scripts/md2docx.js`
的全部结果只有上述 4 处（331 / 1261 / 1273 / 1324 行），即：算得出、传得进、存得下，
唯独 `appendImageParagraph()` 没有用它——那里用的是 `this.inputDir`。

因此这是一处**接线遗漏**（half-wired），而非设计上不支持本地图片。

## 5. 影响

- **高**：这是推荐入口（`md2docx.sh` / `cli.js`，也是 HTTP 服务固定的管线）的默认行为，
  即"用户按文档推荐方式使用时会静默丢图"。不是边界场景。
- 对以 mermaid / plantuml 代码块为主的文档无影响（那些图由 preprocess 渲染成 PNG 并放在
  `output/.mermaid`、`output/.plantuml`，引用路径相对 `output/clean/` 是有效的）。
  触发条件是**作者引用了 md 文件旁边的图片文件**（截图、外部生成的架构图等）。
- 与规范关系：`01-base/技术文档格式-20260525.md` 未规定图片来源，但交付物丢失作者插图
  属于输出完整性问题。
- **注意**：图片丢失是"降级为文字"而非报错退出，日志只有一行 `[md2docx] 嵌入图片: 0 个`，
  容易被忽略——符合本项目"静默失败最危险"的一贯风险模式（参见 `AGENTS.md` 已知陷阱
  第 12、14 条）。

## 6. 与既有文档的关系

`AGENTS.md` 已知陷阱第 1 条记录的"双路渲染差异"只提到**横置判定**在两路下可能不同：

> 同一图在两条路径下横置行为可能不同——改横置逻辑必须两处都验证。

本 issue 是该差异的**另一面、且更严重的一面**：两路差异不只影响横置与否，
还决定作者自带的图片**能否出现在成品里**。记录本条后，`AGENTS.md` 该条陷阱的描述
已不完整。

## 7. HTTP 服务侧的关联（未逐一验证，需补测）

`server/lib/pipeline.js` 的 `sanitizeImageRefs()` 按 `cleanDir`（=`output/clean/`）为基准
解析并校验是否越界：

```javascript
const resolved = path.resolve(cleanDir, decoded);
```

若上传的 md 引用 `![](pics/diagram.png)`，该引用会因解析到作业目录之外而被判为"越界"并剔除，
提示 `[图片引用已忽略(越界)]`。从安全设计看，剔除越界引用是**刻意的**（防路径穿越，
见 `docs/plans/http-service.md` §H3）；但配合本 issue，即便作者把图片一并放进作业目录，
`appendImageParagraph` 仍以 `output/clean/` 为基准解析，图片依旧找不到。

**此路径我未实测**（需要起服务并构造上传），仅由代码阅读推断，置信度中等。
补测时需确认：HTTP 方式下本地图片是否同样丢失，以及 `sanitizeImageRefs` 的基准
与 `appendImageParagraph` 的基准不一致是否会造成"校验通过但仍找不到文件"。

## 8. 修复时的注意点（供后续方案参考，非本记录的结论）

- `srcDir` 的语义需先明确：它应当是"作者源文件所在目录"，还是"clean.md 所在目录"？
  两者在直接运行与流水线下恰好相反，改错方向会让另一条路径回归失败——**两条路径都必须验证**。
- `preprocess` 与 `convert` 现已各自独立解析路径，任何改动都需覆盖 `cli.js`、
  `md2docx.sh`、HTTP 服务三条入口。
- 建议补一个回归用例：md 与其图片同目录，走完整流水线后断言 DOCX 内图片数 ≥ 1。
