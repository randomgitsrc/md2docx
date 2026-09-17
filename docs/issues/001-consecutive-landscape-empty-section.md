# 001 — 连续横置图之间生成空节，多出空白页

| 项目 | 值 |
|---|---|
| 状态 | fixed（待端到端复核） |
| 严重度 | 中 |
| 发现日期 | 2026-09-17 |
| 记录时 commit | `0edb265`（修复前） |
| 修复位置 | `scripts/md2docx.js`：`startPortraitSection()` / `startLandscapeSection()`（空节复用）、`convert()`（末尾空节清理） |
| 回归用例 | `scripts/verify-sections-and-images.sh` 步骤 2 |

## 1. 现象

以下三种输入都会在正文中产生**零内容的空节**（Word 中表现为多出的空白页）：

- 两张横置大图**紧邻**（中间无题注、无正文）
- 两张横置大图**各带图注**（图注在图下方，即规范写法）
- 文档**以「横置图 + 图注」结尾**

竖置图、单张横置图后再接正文等情形不触发。

## 2. 最小复现

三份输入均为纯 Markdown，图片用一张 3000×800 的 PNG（满足 `downscaleRatio > 3 && aspectRatio > 2.0`，必然判定横置）。
直接运行 `md2docx.js` 即可复现，**不依赖**预处理阶段（因此与 issue 002 的路径问题无关）。

```bash
mkdir -p /tmp/m2d-issue && cd /tmp/m2d-issue
# wide3000.png: 任意 3000x800 PNG

# a) 连续横置、无题注
printf -- '---\ntitle: a\n---\n\n# a\n\n正文一。\n\n![](wide3000.png)\n\n![](wide3000.png)\n\n结尾正文。\n' > a-nocap.md

# b) 连续横置、各带图注
printf -- '---\ntitle: b\n---\n\n# b\n\n正文一。\n\n![](wide3000.png)\n\n**图 1-1 第一张宽图**\n\n![](wide3000.png)\n\n**图 1-2 第二张宽图**\n\n结尾正文。\n' > b-cap.md

# c) 单张横置图 + 图注结尾
printf -- '---\ntitle: c\n---\n\n# c\n\n正文一。\n\n![](wide3000.png)\n\n**图 1-1 结尾宽图**\n' > c-tail.md

node /path/to/md2docx/scripts/md2docx.js a-nocap.md
```

逐节统计用以下片段（按 body 子元素顺序切节；存入 `dump-sections.js` 后执行
`node dump-sections.js <docx>`——因依赖 `adm-zip`，需在项目目录下运行，
或加 `NODE_PATH=<项目>/node_modules`）：

```javascript
const AdmZip = require('adm-zip');
const x = new AdmZip(process.argv[2]).readAsText('word/document.xml');
const body = x.slice(x.indexOf('<w:body>') + 8, x.lastIndexOf('</w:body>'));
const toks = [...body.matchAll(/<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>|<w:tbl>[\s\S]*?<\/w:tbl>|<w:sectPr[\s\S]*?<\/w:sectPr>/g)].map(m => m[0]);
let secs = [{ items: [] }];
for (const t of toks) {
  const sp = /<w:sectPr[\s\S]*?<\/w:sectPr>/.exec(t);
  if (sp) {
    const pg = /<w:pgSz w:w="(\d+)" w:h="(\d+)"/.exec(sp[0]);
    Object.assign(secs[secs.length - 1], { pg: pg && pg.slice(1).map(Number) });
    if (!(t.startsWith('<w:p') && t.replace(sp[0], '').replace(/<[^>]+>/g, '').trim())) secs.push({ items: [] });
    else secs[secs.length - 1].items.push(t);
    if (!secs[secs.length - 1].pg) secs[secs.length - 1].pg = null;
  } else secs[secs.length - 1].items.push(t);
}
secs.filter(s => s.pg).forEach((s, i) => {
  const n = s.items.filter(t => t.startsWith('<w:p')).length;
  const img = s.items.filter(t => /<w:drawing>/.test(t)).length;
  const txt = s.items.map(t => t.replace(/<[^>]+>/g, '')).join('').trim();
  console.log(`节${i + 1}: ${s.pg[0] > s.pg[1] ? '横置' : '竖置'} 段=${n} 图=${img} 文本="${txt.slice(0, 20)}"${n === 0 && img === 0 ? '   ← 空节' : ''}`);
});
```

## 3. 实测观测

`a-nocap.md`（连续横置、无题注）：

```text
节1: 竖置 段=8  图=0 文本="连续横置无题注xx公司xxxx年xx月"   ← 封面（title 取 YAML）
节2: 竖置 段=3  图=0 文本="目  录TOC ..."                    ← 目录
节3: 竖置 段=1  图=0 文本="正文一。"
节4: 横置 段=1 图=1
节5: 竖置 段=0 图=0 文本=""                 ← 空节
节6: 横置 段=1 图=1
节7: 竖置 段=1 图=0 文本="结尾正文。"
```

`b-cap.md`（连续横置、各带图注）——同样在节 4 与节 6 之间出现空节，且两张图各自与自己的
图注同节（题注归属正确，未受影响）：

```text
节3: 竖置 段=1 图=0 文本="正文一。"
节4: 横置 段=2 图=1 文本="图 1-1 第一张宽图"
节5: 竖置 段=0 图=0 文本=""                 ← 空节
节6: 横置 段=2 图=1 文本="图 1-2 第二张宽图"
节7: 竖置 段=1 图=0 文本="结尾正文。"
```

`c-tail.md`（单张横置图 + 图注结尾）：

```text
节3: 竖置 段=1 图=0 文本="正文一。"
节4: 横置 段=2 图=1 文本="图 1-1 结尾宽图"
节5: 竖置 段=0 图=0 文本=""                 ← 空节（文档末尾）
```

正文各节均为 `type=nextPage`，因此每个空节都会实际产生一次分页。

## 4. 根因

`consumeToken()` 用**单个布尔** `pendingLandscapeClose` 表示"横置节尚未收尾"，并在下一次
token 到来时无条件收尾：

```javascript
if (this.pendingLandscapeClose) {
  // ...若是加粗题注 → push 进当前(横置) section
  this.pendingLandscapeClose = false;
  this.resumePortraitSection();   // ← 无论后面还有没有内容，都会新建一个竖置节
}
```

而 `resumePortraitSection()` 只是无条件下转：

```javascript
resumePortraitSection() {
  this.startPortraitSection();    // startPortraitSection 每次 push 一个新 section
}
```

由于 `pendingLandscapeClose` 只有 true/false，无法区分"横置节后面确实还有正文"与
"横置节已经是最后一个内容"，于是：

1. 第二张横置图的 `paragraph_open` 是**非题注** token → 走进 `else` 分支 →
   `resumePortraitSection()` 先造出一个空竖置节；
2. 紧接着 `appendImageParagraph()` 判定横置 → `startLandscapeSection()` 再建一个横置节。

两步各建一节，中间那个竖置节永远没有机会被写入内容，就是观测到的空节。
文档以「横置图 + 图注」结尾时同理：题注推入横置节后立刻 `resumePortraitSection()`，
之后再无 token，末尾留下空节。

**辅助因素**：`convert()` 收尾时也没有清理"末尾空节"的步骤。

## 5. 影响

- 正文多出空白页，直接改变页码总量，与规范的页码连续性预期不符。
- 图注与图仍在同一节内（题注确实进了横置节），所以**图注归属本身没有错**；
  问题限于多出的空节。
- 对只含少量横置图的文档影响轻微；对横置图连续出现的文档（如整章都是宽架构图）
  空白页数量会与横置图数量同阶。

## 6. 未验证的相邻观察（置信度低，勿当结论）

同一段代码产出的横置节，其 `pgSz` 为：

```xml
<w:pgSz w:w="16838" w:h="11906" w:orient="portrait"/>
```

即**宽高已交换（横置尺寸），但 `w:orient` 仍是 `portrait`**。原因是本文件在装配
section 时手工交换了 `width`/`height`，而没有传 `orientation`；docx 库仅在收到
`PageOrientation.LANDSCAPE` 时才自行交换 w/h，否则按默认 `portrait` 原样写出属性。

按 ECMA-376 对 `pgSz` 的定义，`orient` 用于决定打印机实际用纸、其语义是"纸的宽高被反转"，
未验证的是：当 w/h 与 `orient` 语义冲突时 Word/LibreOffice 以谁为准、是否影响打印。

本机无 Word / LibreOffice（`which libreoffice soffice pdfinfo` 均为空），**未能验证**。
建议后续在装有 Word 的机器上打开含横置节的产物确认页面方向，再决定是否需要修。

参考：[pgSz (Page Size) — ECMA-376](https://c-rex.net/samples/ooxml/e1/Part4/OOXML_P4_DOCX_pgSz_topic_ID0ENEDT.html?hl=pgsz%2Cpage%2Csize)

## 7. 相关

- 横置判定与分节机制的设计依据见 `docs/plans/large-image-landscape-v5.md`；
  该方案未讨论"多个横置节相邻"的情形。
- `pendingLandscapeClose` 的既有说明见 `AGENTS.md` 已知陷阱第 3 条（只提到"无图注时遇到
  下一个非题注 token 也关"，未提及会留下空节）。

## 8. 修复（已实施）

改动 `scripts/md2docx.js` 三处，均为**结构性**而非补丁式：

### 8.1 空节复用（`startPortraitSection` / `startLandscapeSection`）

若当前 section 尚无任何内容，则**复用**它、只改朝向，不再 push 新节：

```javascript
startPortraitSection() {
  if (this.currentSection && this.currentSection.children.length === 0) {
    this.currentSection.orientation = 'portrait';
    return;
  }
  ...
}
```

这样"连续横置图"场景下，前一张图之后的 `resumePortraitSection()` 只是把一个空节标记为
竖置，紧接着后一张图又把它改回横置——中间不再留下永无内容的节。

### 8.2 末尾空节清理（`convert()` 收尾）

```javascript
while (this.sections.length > 0 &&
       this.sections[this.sections.length - 1].children.length === 0) {
  this.sections.pop();
}
```

覆盖"文档以横置图 + 图注结尾"的场景（图注推入横置节后立刻 resume 竖置，
之后再无 token 写入）。并加一条兜底：若整篇无正文内容，至少保留一个节，
避免 `convert()` 返回空数组。

### 8.3 为什么不做成"延迟判断"

考虑过另一种方案：让 `pendingLandscapeClose` 延迟到确认"后面还有正文"时才恢复竖置。
但那需要预读 token 流、且要区分"图注/表格/段落"多种后继，逻辑复杂；
而"空节复用 + 收尾清理"在语义上直接表达了目标——**不产生零内容节**，
不依赖对未来 token 的预测。

## 9. 验证

三份最小复现（`a-nocap.md` / `b-cap.md` / `c-tail.md`）修复前后对比：

| 用例 | 修复前 | 修复后 |
|---|---|---|
| a 连续横置、无题注 | 7 节，中间 1 个空节 | 6 节，**0 空节**（两张图各占一横置节） |
| b 连续横置、各带图注 | 7 节，中间 1 个空节 | 6 节，**0 空节**，图注仍随各自图片 |
| c 单张横置 + 图注结尾 | 5 节，末尾 1 个空节 | 4 节，**0 空节** |

回归：

- `scripts/verify-sections-and-images.sh` 步骤 2 通过；且**已确认该断言在修复前的代码上
  会失败**（报"出现 2 个零内容空节"），不是空转断言
- 既有 QA 用例（`wide-table` / `caption-forms` / `crlf-test` / `bom-duplicate-key` /
  `plantuml-no-end`）全部通过
- `scripts/verify-stale-png.sh` PASS
- 触发案例 `GMS-JD-SRS-V1.0.md`（1.4 MB）复跑：3 节、**0 空节**、258 图、1289 表，
  无回归

## 10. 仍未验证

§6 记录的 `w:orient="portrait"` 与已交换 w/h 并存问题**未在本次改动中处理**
（也不应由本 issue 处理）——本机无 Word/LibreOffice，无法判定 Word 实际以谁为准。
本次改动只保证不产生空节，未触碰 `pgSz` 的写法。建议后续在有 Word 的机器上确认。
