# 002 — 完整流水线丢失作者自带的本地图片

| 项目 | 值 |
|---|---|
| 状态 | fixed（CLI/本地路径）；HTTP 上传路径**另见 §9** |
| 严重度 | 高 |
| 发现日期 | 2026-09-17 |
| 记录时 commit | `0edb265`（修复前） |
| 修复位置 | `scripts/md2docx.js`：新增 `resolveImagePath()`、`appendImageParagraph()`、`convert()` 的 `imageRoot` 透传 |
| 回归用例 | `md/qa/local-image/` + `scripts/verify-sections-and-images.sh` 步骤 1 |

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

## 7. HTTP 服务侧的关联（已在修复中实测，见 §9）

`server/lib/pipeline.js` 的 `sanitizeImageRefs()` 按 `cleanDir`（=`clean/`）为基准
解析并校验是否越界：

```javascript
const resolved = path.resolve(cleanDir, decoded);
```

从安全设计看，剔除越界引用是**刻意的**（防路径穿越，见 `docs/plans/http-service.md` §H3）。
修复时必须保证新增的 `srcDir` 解析路径不会绕过这道防线——见 §8.3。

## 8. 修复（已实施）

### 8.1 新增 `resolveImagePath()`：多基准依次尝试

```javascript
resolveImagePath(decodedSrc) {
  const bases = [];
  for (const b of [this.inputDir, this.srcDir]) {   // inputDir 优先
    if (b && !bases.includes(b)) bases.push(b);
  }
  ...
}
```

**顺序很关键**：`inputDir`（clean.md 所在目录）**优先**，因为 markdown 语义上图片引用
本就相对本文档；这样 preprocess 渲染出的图表 PNG（形如 `../.mermaid/x.png`）行为与
改动前**完全一致，零回归**。`srcDir` 只作为兜底，用于解析作者自带的
`![](pics/x.png)`。

两阶段流水线里两者必然不同（`inputDir=<源目录>/output/clean`、`srcDir=<源目录>`），
只认其一就会出现"作者图片丢失"或"渲染图表丢失"。

### 8.2 顺带修正：非法百分号编码不再抛异常

原 `decodeURIComponent(src)` 遇到 `100%.png` 这类非法编码会抛 `URIError`，
导致整篇转换失败。现包 try/catch 按原文处理。

### 8.3 安全：新增 `imageRoot` 容器边界（HTTP 必需）

服务端 `srcDir = jobDir`、`inputDir = jobDir/clean`。若只加 `srcDir` 解析而不设边界，
上传的 md 写 `![](../x.png)` 会经 `srcDir` 解析到 **`jobDir` 之外**（相邻作业目录、
乃至宿主任意文件）；而 `sanitizeImageRefs` 只按 cleanDir 基准校验，**会放行该引用**——
等于在修复本 issue 时新开一个路径穿越口子。

因此新增 `opts.imageRoot`：指定时解析结果必须落在该目录内，否则按"未找到"处理。
CLI/本地使用不传（用户自己的文件，无隔离需求），HTTP worker 传 `jobDir`。

### 8.4 未采用的做法

没有把 `sanitizeImageRefs` 的校验基准一并改为 `jobDir`——那会放宽既有防线（原本
`clean/../x.png` 会被拦，改基准后就放行了）。保持"校验用 cleanDir、解析多基准 +
独立容器守卫"，两道防线互不削弱。

## 9. 验证

### 9.1 CLI / 本地路径

| 运行方式 | 修复前 | 修复后 |
|---|---|---|
| 直接 `md2docx.js` | 嵌入 1 张 | 嵌入 1 张（无变化） |
| 完整流水线 `cli.js` | **嵌入 0 张** | **嵌入 1 张** ✅ |

新增回归用例 `md/qa/local-image/`（2 张作者图片 + 1 张 mermaid 渲染图）：
走完整流水线后 DOCX 内 `<w:drawing>` = **3**，`[图片缺失]` 占位 0，
证明**两类图片来源可共存**。

### 9.2 安全（越界引用必须被拒）

构造 `job1/clean/doc.clean.md` 引用 `../job2/secret.png`，以 HTTP 相同参数
（`srcDir=job1`、`imageRoot=job1`）转换：

```text
[md2docx] 图片未找到: ../job2/secret.png
          已尝试: /tmp/sec-test/job1/job2/secret.png
嵌入图片数: 1（本目录的 mine.png）
含 SECRET 内容: ✅ 未泄露
```

越界引用被拒、本目录图片正常嵌入。

### 9.3 回归

既有 QA 用例与 `verify-stale-png.sh` 全部通过；`GMS-JD-SRS-V1.0.md`
（1.4 MB）复跑仍为 258 图 / 1289 表，无回归。

## 10. HTTP 上传路径的真实缺口（新发现，未修，需产品决策）

按 §7 的推断起服务实测后，发现真实情况与推断**不同、且更根本**：

HTTP 接口是 `upload.single('file')`（`server/routes/convert.js`），
**只接收一个 .md 文件**，图片资产从未被上传。实测上传上述用例后，作业目录里只有：

```text
jobs/<id>/upload.md
jobs/<id>/clean/upload.clean.md
jobs/<id>/docx/http-test.docx
```

没有 `pics/` —— 因此 `![架构图](pics/diagram.png)` 必然找不到，与解析基准无关。

即：**HTTP 场景不是本 issue 的代码缺陷，而是 API 设计缺失**——
没有"随 md 一起上传图片资产"的能力（如多文件上传 / zip 上传）。
这需要产品决策（改 API 契约、前端交互、体积与安全限制），**不在本 issue 范围**。
本 issue 的修复让"图片确实存在于合理位置"时能正常解析；HTTP 侧要让图片存在，
需另立需求。

建议后续方向（未实施）：接受 zip 上传并按安全规则解压到 `jobDir`，
或允许 `file` 字段多选、图片放 `assets/` 子路径。

