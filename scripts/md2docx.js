#!/usr/bin/env node
/**
 * md2docx.js — Markdown → DOCX 转换器
 * 符合《技术文档格式-20260525》规范
 *
 * 使用方法:
 *   node md2docx.js <input.md> [output.docx]
 *
 * Markdown 约定:
 *   - 顶部 YAML front matter: title / company / date
 *   - # = 文档标题(仅用于封面)
 *   - ## ~ ###### = 1~5 级章节标题
 *   - ```mermaid ...``` 代码块 → 自动渲染为 PNG 并嵌入
 *   - 其它代码块、表格、列表、加粗、斜体、行内代码、超链接均按规范样式渲染
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');
const { runMmdc } = require('./exec-util');

// markdown-it 与 gray-matter 装在全局,通过 NODE_PATH 引入
const matter = require('gray-matter');
const MarkdownIt = require('markdown-it');

const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Footer, AlignmentType, LevelFormat, SectionType,
  TableOfContents, BorderStyle, WidthType, VerticalAlign,
  PageNumber, NumberFormat, ImageRun, ExternalHyperlink,
} = require('docx');

const { generateConfig } = require('./puppeteer-config');
const { renderPlantUML } = require('./plantuml-renderer');

// =========================================================================
// 1. 基础工具与样式定义(从模板生成器原样照搬,保持视觉一致)
// =========================================================================

const cm = (n) => Math.round(n * 566.93);

// 中文字号 ↔ 磅值 ↔ half-points(Word 内部用 half-points)
//   小一=48(24pt) 一号=52(26pt)
//   小二=36(18pt) 二号=44(22pt)
//   小三=30(15pt) 三号=32(16pt)
//   小四=24(12pt) 四号=28(14pt)
//   小五=18(9pt)  五号=21(10.5pt)
const SIZE = { 小一:48, 三号:32, 小三:30, 四号:28, 小四:24, 五号:21 };

const FONT = {
  仿宋: '仿宋',
  方正小标宋: '方正小标宋简体',
  黑体: '黑体',
  楷体: '楷体',
  西文: 'Times New Roman',
  等宽: 'Consolas',
};

const PAGE = {
  width: cm(21), height: cm(29.7),
  marginTop: cm(2.54), marginBottom: cm(2.54),
  marginLeft: cm(2.7), marginRight: cm(2.7),
  headerDistance: cm(0.70), footerDistance: cm(1.45),
};
const CONTENT_WIDTH = PAGE.width - PAGE.marginLeft - PAGE.marginRight;

const runFont = (cnFont, sizeHalfPt, opts = {}) => ({
  font: { ascii: FONT.西文, eastAsia: cnFont, hAnsi: FONT.西文, cs: FONT.西文 },
  size: sizeHalfPt, ...opts,
});

// ---- 文档级样式 ----
const documentStyles = {
  default: {
    document: {
      run: { font: { ascii: FONT.西文, eastAsia: FONT.仿宋, hAnsi: FONT.西文 }, size: SIZE.小四 },
      paragraph: { spacing: { line: 300, lineRule: 'auto', before: 0, after: 0 } },
    },
  },
  paragraphStyles: [
    { id: 'Normal', name: 'Normal',
      run: { font: { ascii: FONT.西文, eastAsia: FONT.仿宋, hAnsi: FONT.西文 }, size: SIZE.小四 },
      paragraph: { spacing: { line: 360, lineRule: 'auto' }, indent: { firstLine: 480 } } },
    { id: 'CoverTitle', name: '封面标题', basedOn: 'Normal', next: 'Normal',
      run: { font: { ascii: FONT.西文, eastAsia: FONT.方正小标宋, hAnsi: FONT.西文 }, size: SIZE.小一 },
      paragraph: { alignment: AlignmentType.CENTER, indent: { firstLine: 0 },
        spacing: { line: 360, lineRule: 'auto', before: 240, after: 240 } } },
    { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
      run: { font: { ascii: FONT.西文, eastAsia: FONT.黑体, hAnsi: FONT.西文 }, size: SIZE.小三 },
      paragraph: { spacing: { line: 360, lineRule: 'auto', before: 240, after: 120 },
        indent: { firstLine: 0 }, outlineLevel: 0 } },
    { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
      run: { font: { ascii: FONT.西文, eastAsia: FONT.楷体, hAnsi: FONT.西文 }, size: SIZE.小三 },
      paragraph: { spacing: { line: 360, lineRule: 'auto', before: 180, after: 100 },
        indent: { firstLine: 0 }, outlineLevel: 1 } },
    { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
      run: { font: { ascii: FONT.西文, eastAsia: FONT.仿宋, hAnsi: FONT.西文 }, size: SIZE.四号, bold: true },
      paragraph: { spacing: { line: 360, lineRule: 'auto', before: 120, after: 80 },
        indent: { firstLine: 0 }, outlineLevel: 2 } },
    { id: 'Heading4', name: 'Heading 4', basedOn: 'Normal', next: 'Normal', quickFormat: true,
      run: { font: { ascii: FONT.西文, eastAsia: FONT.仿宋, hAnsi: FONT.西文 }, size: SIZE.四号 },
      paragraph: { spacing: { line: 360, lineRule: 'auto', before: 100, after: 60 },
        indent: { firstLine: 0 }, outlineLevel: 3 } },
    { id: 'Heading5', name: 'Heading 5', basedOn: 'Normal', next: 'Normal', quickFormat: true,
      run: { font: { ascii: FONT.西文, eastAsia: FONT.仿宋, hAnsi: FONT.西文 }, size: SIZE.小四 },
      paragraph: { spacing: { line: 360, lineRule: 'auto', before: 80, after: 60 },
        indent: { firstLine: 0 }, outlineLevel: 4 } },
    { id: 'TableText', name: '表格文本', basedOn: 'Normal',
      run: { font: { ascii: FONT.西文, eastAsia: FONT.仿宋, hAnsi: FONT.西文 }, size: SIZE.五号 },
      paragraph: { spacing: { line: 240, lineRule: 'auto' }, indent: { firstLine: 0 } } },
    { id: 'Caption', name: 'Caption', basedOn: 'Normal',
      run: { font: { ascii: FONT.西文, eastAsia: FONT.黑体, hAnsi: FONT.西文 }, size: SIZE.小四 },
      paragraph: { alignment: AlignmentType.CENTER,
        keepLines: true,
        spacing: { line: 360, lineRule: 'auto', before: 60, after: 60 }, indent: { firstLine: 0 } } },
    { id: 'CodeBlock', name: '代码块', basedOn: 'Normal', next: 'Normal',
      run: { font: { ascii: FONT.等宽, eastAsia: FONT.等宽, hAnsi: FONT.等宽 }, size: SIZE.五号 },
      paragraph: { spacing: { line: 280, lineRule: 'auto', before: 60, after: 60 },
        indent: { firstLine: 0, left: cm(0.5) } } },
  ],
};

// ---- 多级编号(标题、列表) ----
// 注:列表编号在 Word 里是按 numId 实例延续的。为了每个"顶层列表"都能从 1 开始,
// 我们为每层预注册一个 reference 池,转换时按需轮换使用。
// 池大小由文档实际列表数决定（先扫描再构建），不设硬上限。

function buildNumberingConfig(poolSize) {
  return {
    config: [
      { reference: 'heading-numbering',
        levels: Array.from({ length: 9 }, (_, i) => ({
          level: i, format: LevelFormat.DECIMAL,
          text: Array.from({ length: i + 1 }, (_, j) => `%${j + 1}`).join('.'),
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 0, hanging: 0, firstLine: 0 } } },
        })),
      },
      // 列表 L1 池: list-l1-0, list-l1-1, ...
      ...Array.from({ length: poolSize }, (_, n) => ({
        reference: `list-l1-${n}`,
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: cm(0.74), hanging: cm(0.74) } } } }],
      })),
      // 列表 L2 池
      ...Array.from({ length: poolSize }, (_, n) => ({
        reference: `list-l2-${n}`,
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '(%1)',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: cm(1.48), hanging: cm(0.74) } } } }],
      })),
      // 列表 L3 池
      ...Array.from({ length: poolSize }, (_, n) => ({
        reference: `list-l3-${n}`,
        levels: [{ level: 0, format: LevelFormat.LOWER_LETTER, text: '%1)',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: cm(2.22), hanging: cm(0.74) } } } }],
      })),
    ],
  };
}

// =========================================================================
// 2. Mermaid 渲染辅助(调用 mmdc)
// =========================================================================

// =========================================================================
// 2. Mermaid 渲染辅助(调用 mmdc)
// =========================================================================

// 分析 Mermaid 源码拓扑结构，估算是否需要横置
function estimateMermaidWidth(mermaidCode) {
  // 1. 识别布局方向，仅 TD/TB（自顶向下）方向会产生宽图
  const dirMatch = mermaidCode.match(/^\s*(?:graph|flowchart)\s+(TD|TB|LR|RL|BT)/m);
  if (!dirMatch) return { needsLandscape: false };  // 序列图、类图等默认竖置

  const direction = dirMatch[1];
  if (!['TD', 'TB'].includes(direction)) return { needsLandscape: false };  // LR/RL 是窄高图

  // 2. 提取所有边：source --> target
  const edgePattern = /([\w]+)(?:\[[^\]]*\]|\([^)]*\)|\{[^}]*\})?\s*(?:-->|---|-\.->|==>)\s*(?:\|[^|]*\|)?\s*([\w]+)/g;
  const children = {};
  let match;
  while ((match = edgePattern.exec(mermaidCode)) !== null) {
    if (!children[match[1]]) children[match[1]] = new Set();
    children[match[1]].add(match[2]);
  }

  // 3. 收集所有节点，找叶节点（无出边的节点）
  const allNodes = new Set();
  for (const [p, cs] of Object.entries(children)) {
    allNodes.add(p);
    cs.forEach(c => allNodes.add(c));
  }
  const leafCount = [...allNodes].filter(n => !children[n] || children[n].size === 0).length;

  // 4. 宽度评分 = max(最大子节点数, 叶节点数/2)
  const maxChildren = Math.max(0, ...Object.values(children).map(s => s.size));
  const widthScore = Math.max(maxChildren, Math.ceil(leafCount / 2));

  return { needsLandscape: widthScore > 5 };
}

// 在临时目录里渲染 mermaid 代码 → PNG buffer + 宽高
function renderMermaid(mermaidCode, tmpDir, index) {
  // 渲染前分析拓扑，决定横置
  const { needsLandscape } = estimateMermaidWidth(mermaidCode);

  // 根据模式选择渲染宽度（横置需要更高分辨率）
  const renderWidth = needsLandscape ? 3600 : 2400;

  const inFile = path.join(tmpDir, `m_${index}.mmd`);
  const outFile = path.join(tmpDir, `m_${index}.png`);

  const cfgPath = generateConfig(tmpDir);

  // 注入 init 指令：使用直线连线，去除"AI味"
  const hasUserInit = /^%%\{init:/m.test(mermaidCode);
  if (!hasUserInit) {
    mermaidCode = `%%{init: {'flowchart': {'curve': 'linear'}}}%%\n` + mermaidCode;
  }

  fs.writeFileSync(inFile, mermaidCode);
  const mmdcDir = path.resolve(__dirname, '..');
  // 参数数组传递（不经 shell）：路径含空格/中文时不会被拆坏；
  // 同时不经 npx，省掉每次包解析开销。
  const mmdcArgs = [
    '-i', inFile,
    '-o', outFile,
    '-b', 'white',
    '-w', String(renderWidth),
    '-H', '2400',
  ];
  if (cfgPath) mmdcArgs.push('-p', cfgPath);
  runMmdc(mmdcArgs, { cwd: mmdcDir });

  // 读出 PNG,顺便取宽高用于 docx 嵌入时计算缩放
  const buffer = fs.readFileSync(outFile);
  // PNG 宽高在文件头 16-23 字节(大端)
  const width  = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return { buffer, width, height, needsLandscape };
}

// 图片按页面内容区等比缩放,超宽超高都限制
const CONTENT_WIDTH_PX = Math.round(CONTENT_WIDTH / 566.93 / 2.54 * 96);
const CONTENT_HEIGHT_PX = Math.round((29.7 - 2.54 - 2.54) * 0.90 / 2.54 * 96);

// 横置页面参数
const LANDSCAPE_PAGE = {
  width:  cm(29.7),
  height: cm(21),
  marginTop:    cm(2.54),
  marginBottom: cm(2.54),
  marginLeft:   cm(2.7),
  marginRight:  cm(2.7),
};
const LANDSCAPE_CONTENT_WIDTH  = LANDSCAPE_PAGE.width  - LANDSCAPE_PAGE.marginLeft - LANDSCAPE_PAGE.marginRight;
const LANDSCAPE_CONTENT_HEIGHT = LANDSCAPE_PAGE.height - LANDSCAPE_PAGE.marginTop  - LANDSCAPE_PAGE.marginBottom;
const LANDSCAPE_CONTENT_WIDTH_PX  = Math.round(LANDSCAPE_CONTENT_WIDTH  / 566.93 / 2.54 * 96);
const LANDSCAPE_CONTENT_HEIGHT_PX = Math.round(LANDSCAPE_CONTENT_HEIGHT / 566.93 / 2.54 * 96);

function fitImageToPage(origW, origH) {
  let w = origW, h = origH;
  if (w > CONTENT_WIDTH_PX) {
    const r = CONTENT_WIDTH_PX / w;
    w = CONTENT_WIDTH_PX;
    h = Math.round(origH * r);
  }
  if (h > CONTENT_HEIGHT_PX) {
    const r = CONTENT_HEIGHT_PX / h;
    h = CONTENT_HEIGHT_PX;
    w = Math.round(w * r);
  }
  return { width: w, height: h };
}

function fitImageToLandscape(origW, origH) {
  let w = origW, h = origH;
  if (w > LANDSCAPE_CONTENT_WIDTH_PX) {
    const r = LANDSCAPE_CONTENT_WIDTH_PX / w;
    w = LANDSCAPE_CONTENT_WIDTH_PX;
    h = Math.round(origH * r);
  }
  if (h > LANDSCAPE_CONTENT_HEIGHT_PX) {
    const r = LANDSCAPE_CONTENT_HEIGHT_PX / h;
    h = LANDSCAPE_CONTENT_HEIGHT_PX;
    w = Math.round(w * r);
  }
  return { width: w, height: h };
}

// 题注判定（供两处 Caption 分支复用）
// 规则必须与 preprocess.js 的 markCaptions 保持一致（双路一致）：
//   以「图/表 + 可选空格 + 编号」开头（编号可为 1-1 / 3.2 / 89），
//   整段 < 60 字符，且不以句末标点结尾（否则是正文句子）。
function isCaptionText(text) {
  const s = (text || '').trim();
  if (!s || s.length >= 60) return false;
  if (!/^[图表]\s*\d/.test(s)) return false;
  if (/[。！？；，、：]$/.test(s)) return false;
  return true;
}

// 统计 markdown 中顶层列表数量（用于动态确定列表池大小）
// 顶层列表 = 不缩进的 `- ` 或 `* ` 开头的连续行块
// 统计所有列表（顶层 + 嵌套 + 有序 + 无序）的数量。
// 这等于 allocListRefs() 的实际调用次数，用于预建足够大的编号池。
// 旧实现只按行级正则数顶层无序列表，会漏数有序列表和嵌套子列表，
// 导致列表多时池不够、allocListRefs 回绕复用 numId → 编号延续上一组（bug）。
function countTopLevelLists(content) {
  const md = new MarkdownIt({ html: false });
  const tokens = md.parse(content, {});
  let count = 0;
  for (const t of tokens) {
    if (t.type === 'bullet_list_open' || t.type === 'ordered_list_open') count++;
  }
  return count;
}

// =========================================================================
// 3. Markdown → docx 元素的核心转换器
// =========================================================================

class Md2DocxConverter {
  constructor(opts = {}) {
    this.tmpDir = opts.tmpDir || fs.mkdtempSync(path.join(os.tmpdir(), 'md2docx-'));
    this.inputDir = opts.inputDir || process.cwd();
    // 图片来源解析目录：用于解析 markdown 里作者自带的 `![](相对路径)`。
    // 与 inputDir 分开是必要的——两阶段流水线里 inputDir 是 output/clean/，
    // 而作者的图片在源文件旁边，用 inputDir 解析必然找不到（见 docs/issues/002）。
    // 兼容性：以 clean.md 所在目录解析也常见（preprocess 渲染出的图表 PNG 就是
    // 相对 cleanDir 引用的），故最终解析时两个基准都会尝试。
    this.srcDir = opts.srcDir || this.inputDir;
    // 图片解析的容器边界（用户上传场景传 jobDir；不传表示无隔离需求）
    this.imageRoot = opts.imageRoot || null;
    this.md = new MarkdownIt({
      html: true, breaks: false, linkify: true, typographer: false,
    });
    // 计数器
    this.tableIndex = 0;
    this.mermaidIndex = 0;
    this.plantUMLIndex = 0;
    this.imageIndex = 0;
    // 列表 reference 池索引
    this.listPoolIndex = 0;
    this.listPoolSize = opts.listPoolSize || 200;
    // 分段结构
    this.sections = [];
    this.currentSection = null;
    this.pendingLandscapeClose = false;
    this.startPortraitSection();
  }

  // 开启新的竖置 section。
  // 若当前 section 还是空的（尚未写入任何内容）则**复用**它，只改朝向，
  // 不再另起一个——否则会留下一个零内容的空节（Word 里表现为空白页）。
  // 触发场景：连续两张横置图时，前一张图之后的"恢复竖置"会先建出一个空竖置节，
  // 紧接着后一张图又把当前节切成横置；中间那个竖置节永远没机会写入内容。
  startPortraitSection() {
    if (this.currentSection && this.currentSection.children.length === 0) {
      this.currentSection.orientation = 'portrait';
      return;
    }
    const sec = { orientation: 'portrait', children: [] };
    this.sections.push(sec);
    this.currentSection = sec;
  }

  // 开启新的横置 section（空节同样复用，理由见上）
  startLandscapeSection() {
    if (this.currentSection && this.currentSection.children.length === 0) {
      this.currentSection.orientation = 'landscape';
      return;
    }
    const sec = { orientation: 'landscape', children: [] };
    this.sections.push(sec);
    this.currentSection = sec;
  }

  // 恢复竖置 section
  resumePortraitSection() {
    this.startPortraitSection();
  }

  // 为一组(顶层)列表分配一组新的 l1/l2/l3 reference,使编号从 1 重新开始
  // 同一颗列表树共用同一组 ref;遇到下一个顶层列表时切换到下一组
  // 注意：绝不回绕复用——复用 numId 会导致编号延续上一组（bug）。
  // 池大小由 countTopLevelLists 预算（含嵌套+有序），正常够用；
  // 若意外超池，宁可抛错暴露问题，也不静默复用。
  allocListRefs() {
    const n = this.listPoolIndex++;
    if (n >= this.listPoolSize) {
      throw new Error(
        `列表编号池耗尽：已分配 ${n + 1} 组列表，但池大小仅 ${this.listPoolSize}。` +
        `文档列表数量超出预期，请增大 listPoolSize 或检查 countTopLevelLists 统计。`
      );
    }
    return {
      l1: `list-l1-${n}`,
      l2: `list-l2-${n}`,
      l3: `list-l3-${n}`,
    };
  }

  // ---------- token 流的核心解析 ----------
  // markdown-it 把 md 解析成一个扁平的 token 数组,我们按顺序消费
  convert(markdown) {
    const tokens = this.md.parse(markdown, {});
    let i = 0;
    while (i < tokens.length) {
      i = this.consumeToken(tokens, i);
    }
    // 收尾：去掉末尾可能残留的零内容空节。
    // 场景：文档以「横置图 + 图注」结尾时，图注推入横置节后会立刻
    // resumePortraitSection() 建出一个竖置节，但后面已无 token 写入，
    // 该空节会变成一张多余空白页。中间的空节已由 startXxxSection() 的
    // 空节复用逻辑消除，这里只处理末尾。
    while (this.sections.length > 0 &&
           this.sections[this.sections.length - 1].children.length === 0) {
      this.sections.pop();
    }
    // 极端情况：整篇没有任何正文内容。保证至少留一个节，避免生成的
    // 文档没有正文节（封面/目录仍由 convert() 另外装配）。
    if (this.sections.length === 0) {
      this.startPortraitSection();
    }
    return this.sections;
  }

  // 处理一个块级 token,返回下一个待处理的 index
  consumeToken(tokens, i) {
    // 延迟恢复机制：检查 pendingLandscapeClose
    if (this.pendingLandscapeClose) {
      const t = tokens[i];
      const isCaption = t.type === 'paragraph_open' && tokens[i + 1] && tokens[i + 1].children;
      if (isCaption) {
        const inline = tokens[i + 1];
        const children = inline.children;
        let first = 0, last = children.length - 1;
        while (first < last && children[first].type === 'text' && !children[first].content) first++;
        while (last > first && children[last].type === 'text' && !children[last].content) last--;
        const isAllBoldWrapped =
          first < last &&
          children[first].type === 'strong_open' &&
          children[last].type === 'strong_close';
        const fullText = this.flattenInlineToText(inline);
        const captionMatch = isCaptionText(fullText);
        if (isAllBoldWrapped && captionMatch) {
          // 是 Caption，push 到 currentSection（landscape），然后恢复竖置
          const captionPara = new Paragraph({
            style: 'Caption',
            // keepNext：题注与表格/图片同页；keepLines：题注内部不分页
            keepNext: true,
            keepLines: true,
            children: [new TextRun({
              text: fullText,
              ...runFont(FONT.黑体, SIZE.小四),
            })],
          });
          this.currentSection.children.push(captionPara);
          this.pendingLandscapeClose = false;
          this.resumePortraitSection();
          return i + 3;
        }
      }
      // 不是 Caption，直接恢复竖置
      this.pendingLandscapeClose = false;
      this.resumePortraitSection();
      // 继续执行当前 token 的正常处理
    }

    const t = tokens[i];

    switch (t.type) {
      case 'heading_open': {
        const level = parseInt(t.tag.substring(1), 10);
        const wordLevel = level - 1;
        const inline = tokens[i + 1];
        const text = this.flattenInlineToText(inline);
        if (wordLevel >= 1 && wordLevel <= 5) {
          this.currentSection.children.push(new Paragraph({
            style: `Heading${wordLevel}`,
            numbering: { reference: 'heading-numbering', level: wordLevel - 1 },
            children: [new TextRun({ text })],
          }));
        } else {
          this.currentSection.children.push(new Paragraph({
            style: 'Heading1',
            numbering: { reference: 'heading-numbering', level: 0 },
            children: [new TextRun({ text })],
          }));
        }
        return i + 3;
      }

      case 'paragraph_open': {
        const inline = tokens[i + 1];
        // 检查是否为纯图片段落 (预处理后的 Mermaid PNG)
        if (inline && inline.children) {
          const imgs = inline.children.filter(c => c.type === 'image');
          const nonImgs = inline.children.filter(c => c.type !== 'image' && c.type !== 'softbreak' && c.type !== 'hardbreak');
          if (imgs.length > 0 && nonImgs.length === 0) {
            // 纯图片段落:居中嵌入 PNG
            for (const img of imgs) {
              const src = (img.attrs && img.attrs.find(([k]) => k === 'src') || [])[1] || '';
              const alt = (img.attrs && img.attrs.find(([k]) => k === 'alt') || [])[1] || '';
              this.appendImageParagraph(src, alt);
            }
            return i + 3;
          }
        }
        // 检查是否为题注段落 (**图 X** 或 **表 X** 格式)
        // 要求: (1) 段落整体被 strong 包裹 (2) 起头是"图 N"或"表 N" (3) 长度<60避免误判正文
        if (inline && inline.children) {
          const children = inline.children;
          // 跳过首尾空 text 节点(markdown-it 可能在 ** 前后生成空 text)
          let first = 0, last = children.length - 1;
          while (first < last && children[first].type === 'text' && !children[first].content) first++;
          while (last > first && children[last].type === 'text' && !children[last].content) last--;
          const isAllBoldWrapped =
            first < last &&
            children[first].type === 'strong_open' &&
            children[last].type === 'strong_close';
          const fullText = this.flattenInlineToText(inline);
          const captionMatch = isCaptionText(fullText);

          if (isAllBoldWrapped && captionMatch) {
            const captionPara = new Paragraph({
              style: 'Caption',
              // keepNext：题注与表格/图片同页；keepLines：题注内部不分页
              keepNext: true,
              keepLines: true,
              children: [new TextRun({
                text: fullText,
                ...runFont(FONT.黑体, SIZE.小四),
              })],
            });
            this.currentSection.children.push(captionPara);
            return i + 3;
          }
        }
        const runs = this.inlineToRuns(inline);
        this.currentSection.children.push(new Paragraph({
          style: 'Normal',
          children: runs,
        }));
        return i + 3;
      }

      case 'fence': {
        // 代码块
        const lang = (t.info || '').trim().toLowerCase();
        if (lang === 'mermaid') {
          this.appendMermaid(t.content);
        } else if (lang === 'plantuml') {
          this.appendPlantUML(t.content);
        } else {
          this.appendCodeBlock(t.content);
        }
        return i + 1;
      }

      case 'code_block': {
        // 4 空格缩进的代码块
        this.appendCodeBlock(t.content);
        return i + 1;
      }

      case 'bullet_list_open':
      case 'ordered_list_open': {
        return this.consumeList(tokens, i, 1);
      }

      case 'table_open': {
        return this.consumeTable(tokens, i);
      }

      case 'hr':
        // 分割线:用一个段落空行简单替代
        this.currentSection.children.push(new Paragraph({ children: [new TextRun('')] }));
        return i + 1;

      case 'blockquote_open': {
        // 引用块:暂用普通段落(可后续优化,目前规范没要求专门样式)
        return this.consumeBlockquote(tokens, i);
      }

      default:
        // 未知 / 未处理 token,跳过
        return i + 1;
    }
  }

  // ---------- 内联文本处理 ----------

  // 把 inline token 的 children 转成 TextRun 数组
  // ctx 可选:
  //   { mode: 'normal' }  普通正文上下文 (默认: 仿宋小四)
  //   { mode: 'table', isHeader: bool }  表格单元格上下文 (仿宋五号, header 加粗)
  inlineToRuns(inlineToken, ctx = { mode: 'normal' }) {
    if (!inlineToken || !inlineToken.children) return [new TextRun('')];

    // 解析为中间表示数组,每项形如:
    //   { kind: 'text' | 'code' | 'link', text, bold, italic, href? }
    // 然后根据 ctx 渲染为 TextRun
    const items = [];
    let bold = false, italic = false;
    let linkHref = null;

    for (const c of inlineToken.children) {
      switch (c.type) {
        case 'text':
          if (c.content) items.push({ kind: 'text', text: c.content, bold, italic, href: linkHref });
          break;
        case 'code_inline':
          items.push({ kind: 'code', text: c.content, bold, italic, href: linkHref });
          break;
        case 'strong_open':  bold = true; break;
        case 'strong_close': bold = false; break;
        case 'em_open':      italic = true; break;
        case 'em_close':     italic = false; break;
        case 'link_open':
          linkHref = (c.attrs && c.attrs.find(([k]) => k === 'href') || [])[1] || null;
          break;
        case 'link_close':
          linkHref = null;
          break;
        case 'softbreak':
          items.push({ kind: 'text', text: ' ', bold, italic, href: linkHref });
          break;
        case 'hardbreak':
          items.push({ kind: 'break', bold, italic, href: linkHref });
          break;
        case 'html_inline':
          if (c.content && c.content.match(/<br\s*\/?>/i)) {
            items.push({ kind: 'break', bold, italic, href: linkHref });
          }
          break;
        case 'image':
          items.push({ kind: 'text',
            text: `[图片: ${c.attrs?.find(([k]) => k === 'alt')?.[1] || ''}]`,
            bold, italic, href: linkHref });
          break;
      }
    }

    // 渲染:把同一个 href 的连续 items 合并成一个 ExternalHyperlink
    const isTable = ctx.mode === 'table';
    const baseFont = FONT.仿宋;
    const baseSize = isTable ? SIZE.五号 : SIZE.小四;
    const codeSize = isTable ? SIZE.五号 : SIZE.五号;
    const tableHeaderBold = isTable && ctx.isHeader;

    const buildRun = (item) => {
      if (item.kind === 'break') {
        const props = runFont(baseFont, baseSize);
        return new TextRun({ text: '', ...props, break: 1 });
      }
      const props = item.kind === 'code'
        ? { font: { ascii: FONT.等宽, eastAsia: FONT.等宽, hAnsi: FONT.等宽 }, size: codeSize }
        : runFont(baseFont, baseSize);
      return new TextRun({
        text: item.text || '',
        ...props,
        bold: item.bold || tableHeaderBold,
        italics: item.italic,
      });
    };

    const buildLinkRun = (item) => new TextRun({
      text: item.text || '',
      ...runFont(baseFont, baseSize),
      color: '0563C1',
      underline: { type: 'single' },
      bold: item.bold,
      italics: item.italic,
    });

    const result = [];
    let i = 0;
    while (i < items.length) {
      const it = items[i];
      if (it.href) {
        // 收集同 href 的连续 items
        const group = [];
        const href = it.href;
        while (i < items.length && items[i].href === href) {
          group.push(items[i]);
          i++;
        }
        result.push(new ExternalHyperlink({
          link: href,
          children: group.map(g => buildLinkRun(g)),
        }));
      } else {
        result.push(buildRun(it));
        i++;
      }
    }

    return result.length > 0 ? result : [new TextRun('')];
  }

  // 把 inline token 拍平成纯文本(用于标题文字等场景)
  flattenInlineToText(inlineToken) {
    if (!inlineToken || !inlineToken.children) return '';
    return inlineToken.children
      .map(c => c.type === 'text' || c.type === 'code_inline' ? c.content : '')
      .join('');
  }

  // ---------- 图片段落(预处理后的 Mermaid PNG 等) ----------
  //
  // 路径解析：按候选基准目录依次尝试，取第一个存在的文件。
  //   1) inputDir —— clean.md 所在目录。markdown 语义上引用本就是相对本文档的，
  //                  故**优先生效**：这样 preprocess 渲染出的图表 PNG（相对 cleanDir
  //                  引用，如 ../.mermaid/x.png）行为与改动前完全一致，零回归。
  //   2) srcDir   —— 作者源文件所在目录，兜底解析作者自带的 `![](pics/x.png)`。
  // 两阶段流水线里两者必然不同（inputDir=<源目录>/output/clean、srcDir=<源目录>），
  // 只认其一就会出现"作者图片丢失"或"渲染图表丢失"（见 docs/issues/002）。
  //
  // 安全：当 opts.imageRoot 指定时，解析结果必须落在该目录内，否则视为找不到。
  // 这是 HTTP 服务的必需防护——服务端 srcDir=jobDir、inputDir=jobDir/clean，
  // 若无此守卫，`![](../x.png)` 经 srcDir 解析会越过作业目录读到别的作业甚至宿主任意文件
  // （而 sanitizeImageRefs 只按 cleanDir 基准校验，会放行该引用）。
  // CLI/本地使用不传 imageRoot（用户自己的文件，无隔离需求）。
  resolveImagePath(decodedSrc) {
    const bases = [];
    for (const b of [this.inputDir, this.srcDir]) {
      if (b && !bases.includes(b)) bases.push(b);
    }
    const candidates = [];
    for (const base of bases) {
      const p = path.resolve(base, decodedSrc);
      // 容器边界守卫：越界即跳过（不报错，按"未找到"处理）
      if (this.imageRoot) {
        const rel = path.relative(this.imageRoot, p);
        if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
      }
      candidates.push(p);
      if (fs.existsSync(p)) return { path: p, candidates };
    }
    return { path: null, candidates };
  }

  appendImageParagraph(src, alt) {
    // markdown-it 会 URL 编码路径，需要解码
    let decodedSrc;
    try {
      decodedSrc = decodeURIComponent(src);
    } catch (_) {
      decodedSrc = src;  // 非法百分号编码（如 100%.png）时按原文处理
    }
    const { path: imgPath, candidates } = this.resolveImagePath(decodedSrc);
    if (!imgPath) {
      console.warn(`  [md2docx] 图片未找到: ${decodedSrc}`);
      console.warn(`            已尝试: ${candidates.join(' , ') || '(无可用的解析基准)'}`);
      this.currentSection.children.push(new Paragraph({
        alignment: AlignmentType.CENTER, indent: { firstLine: 0 },
        children: [new TextRun({ text: `[图片缺失: ${src}]`, ...runFont(FONT.仿宋, SIZE.小四) })],
      }));
      return;
    }
    const buf = fs.readFileSync(imgPath);
    let origW = 480, origH = 360;
    try {
      if (buf[0] === 0x89 && buf[1] === 0x50) { // PNG signature
        origW = buf.readUInt32BE(16);
        origH = buf.readUInt32BE(20);
      }
    } catch (_) {}

    const downscaleRatio = origW / CONTENT_WIDTH_PX;
    const aspectRatio = origW / origH;
    const isLandscape = downscaleRatio > 3 && aspectRatio > 2.0;

    if (isLandscape) {
      this.startLandscapeSection();
      const { width: w, height: h } = fitImageToLandscape(origW, origH);
      this.currentSection.children.push(new Paragraph({
        alignment: AlignmentType.CENTER, indent: { firstLine: 0 },
        keepNext: true,
        spacing: { before: 120, after: 60 },
        children: [new ImageRun({
          type: 'png',
          data: buf,
          transformation: { width: w, height: h },
        })],
      }));
      this.pendingLandscapeClose = true;
    } else {
      const { width: w, height: h } = fitImageToPage(origW, origH);
      this.currentSection.children.push(new Paragraph({
        alignment: AlignmentType.CENTER, indent: { firstLine: 0 },
        keepNext: true,
        spacing: { before: 120, after: 60 },
        children: [new ImageRun({
          type: 'png',
          data: buf,
          transformation: { width: w, height: h },
        })],
      }));
    }
    this.imageIndex += 1;
  }

  // ---------- 代码块 ----------
  appendCodeBlock(content) {
    const lines = content.replace(/\n$/, '').split('\n');
    for (const line of lines) {
      this.currentSection.children.push(new Paragraph({
        style: 'CodeBlock',
        children: [new TextRun({
          text: line || ' ',
          font: { ascii: FONT.等宽, eastAsia: FONT.等宽, hAnsi: FONT.等宽 },
          size: SIZE.五号,
        })],
      }));
    }
  }

  // ---------- Mermaid 块 ----------
  appendMermaid(mermaidCode) {
    this.mermaidIndex += 1;
    let img;
    try {
      img = renderMermaid(mermaidCode, this.tmpDir, this.mermaidIndex);
    } catch (e) {
      console.warn(`[警告] Mermaid 渲染失败 (#${this.mermaidIndex}): ${e.message}`);
      console.warn('  → 已降级为普通代码块');
      this.appendCodeBlock(mermaidCode);
      return;
    }
    // 自适应缩放:横图填满正文区,纵图按最大宽度等比
    if (img.needsLandscape) {
      this.startLandscapeSection();
      const { width, height } = fitImageToLandscape(img.width, img.height);
      this.currentSection.children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        indent: { firstLine: 0 },
        keepNext: true,
        spacing: { before: 120, after: 60 },
        children: [new ImageRun({
          type: 'png',
          data: img.buffer,
          transformation: { width, height },
        })],
      }));
      this.pendingLandscapeClose = true;
    } else {
      const { width, height } = fitImageToPage(img.width, img.height);
      this.currentSection.children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        indent: { firstLine: 0 },
        keepNext: true,
        spacing: { before: 120, after: 60 },
        children: [new ImageRun({
          type: 'png',
          data: img.buffer,
          transformation: { width, height },
        })],
      }));
    }
    this.imageIndex += 1;

    // 图注由预处理脚本插入,此处不再自动生成
  }

  // ---------- PlantUML 块 ----------
  appendPlantUML(plantUMLCode) {
    this.plantUMLIndex += 1;
    let img;
    try {
      img = renderPlantUML(plantUMLCode, this.tmpDir, this.plantUMLIndex);
    } catch (e) {
      console.warn(`[警告] PlantUML 渲染失败 (#${this.plantUMLIndex}): ${e.message}`);
      console.warn('  → 已降级为普通代码块');
      this.appendCodeBlock(plantUMLCode);
      return;
    }

    if (img.needsLandscape) {
      this.startLandscapeSection();
      const { width, height } = fitImageToLandscape(img.width, img.height);
      this.currentSection.children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        indent: { firstLine: 0 },
        keepNext: true,
        spacing: { before: 120, after: 60 },
        children: [new ImageRun({
          type: 'png', data: img.buffer,
          transformation: { width, height },
        })],
      }));
      this.pendingLandscapeClose = true;
    } else {
      const { width, height } = fitImageToPage(img.width, img.height);
      this.currentSection.children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        indent: { firstLine: 0 },
        keepNext: true,
        spacing: { before: 120, after: 60 },
        children: [new ImageRun({
          type: 'png', data: img.buffer,
          transformation: { width, height },
        })],
      }));
    }
  }

  // 找上一段正文段落的文字(用于图注的启发式提取)
  findLastParagraphText() {
    for (let k = this.currentSection.children.length - 1; k >= 0; k--) {
      const p = this.currentSection.children[k];
      if (p && p.constructor && p.constructor.name === 'Paragraph') {
        // 取段落内所有 TextRun 的拼接文本
        const text = this.extractParagraphText(p);
        if (text && text.trim()) return text.trim();
      }
    }
    return null;
  }

  extractParagraphText(paragraph) {
    // Paragraph 内部 root 数组:[ParagraphProperties, ...children]
    if (!paragraph.root) return '';
    let text = '';
    const walk = (node) => {
      if (!node) return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (node.root) walk(node.root);
      // Text 节点:rootKey === 'w:t', root[1] 是文字
      if (node.rootKey === 'w:t' && node.root && node.root[1]) {
        text += node.root[1];
      }
    };
    walk(paragraph.root);
    return text;
  }

  // ---------- 列表(递归处理嵌套) ----------
  // listLevel: 1, 2, 或 3+ (md 嵌套深度,对应 l1/l2/l3 编号样式)
  // 注意:每次进入一个列表(无论顶层还是嵌套)都分配独立 ref,这样编号能各自从 1 重新开始
  consumeList(tokens, i, listLevel, _unused) {
    // 为本次"这一个列表"分配独立 ref(每个 list_open 一组)
    const refs = this.allocListRefs();

    const openType = tokens[i].type;
    const closeType = openType.replace('_open', '_close');
    i += 1;

    while (i < tokens.length && tokens[i].type !== closeType) {
      if (tokens[i].type === 'list_item_open') {
        i += 1;
        let firstParaHandled = false;
        while (i < tokens.length && tokens[i].type !== 'list_item_close') {
          const inner = tokens[i];

          if (inner.type === 'paragraph_open') {
            const inlineTok = tokens[i + 1];
            const runs = this.inlineToRuns(inlineTok);
            if (!firstParaHandled) {
              const refKey = ['l1', 'l2', 'l3'][Math.min(listLevel, 3) - 1];
              this.currentSection.children.push(new Paragraph({
                style: 'Normal',
                numbering: { reference: refs[refKey], level: 0 },
                indent: { firstLine: 0 },
                children: runs,
              }));
              firstParaHandled = true;
            } else {
              this.currentSection.children.push(new Paragraph({
                style: 'Normal',
                indent: { left: cm(0.74 * Math.min(listLevel, 3)), firstLine: 0 },
                children: runs,
              }));
            }
            i += 3;
          } else if (inner.type === 'bullet_list_open' || inner.type === 'ordered_list_open') {
            // 嵌套子列表:递归(内部会再分配自己的 ref)
            i = this.consumeList(tokens, i, listLevel + 1);
          } else {
            i += 1;
          }
        }
        i += 1;
      } else {
        i += 1;
      }
    }
    return i + 1;
  }

  // ---------- 表格 ----------
  consumeTable(tokens, i) {
    i += 1; // 跳过 table_open
    const headers = [];
    const headerInlineTokens = [];
    const rows = [];
    const rowInlineTokens = [];

    // thead
    if (tokens[i] && tokens[i].type === 'thead_open') {
      i += 1;
      while (tokens[i] && tokens[i].type !== 'thead_close') {
        if (tokens[i].type === 'tr_open') {
          i += 1;
          while (tokens[i] && tokens[i].type !== 'tr_close') {
            if (tokens[i].type === 'th_open') {
              const inline = tokens[i + 1];
              headerInlineTokens.push(inline);
              headers.push(this.inlineToRuns(inline, { mode: 'table', isHeader: true }));
              i += 3;
            } else {
              i += 1;
            }
          }
          i += 1;
        } else {
          i += 1;
        }
      }
      i += 1;
    }

    // tbody
    if (tokens[i] && tokens[i].type === 'tbody_open') {
      i += 1;
      while (tokens[i] && tokens[i].type !== 'tbody_close') {
        if (tokens[i].type === 'tr_open') {
          i += 1;
          const row = [];
          const rowInlines = [];
          while (tokens[i] && tokens[i].type !== 'tr_close') {
            if (tokens[i].type === 'td_open') {
              const inline = tokens[i + 1];
              rowInlines.push(inline);
              row.push(this.inlineToRuns(inline, { mode: 'table', isHeader: false }));
              i += 3;
            } else {
              i += 1;
            }
          }
          rows.push(row);
          rowInlineTokens.push(rowInlines);
          i += 1;
        } else {
          i += 1;
        }
      }
      i += 1;
    }

    this.tableIndex += 1;

    const colCount = headers.length || (rows[0] || []).length;
    if (colCount === 0) return i + 1;

    // 按列内容宽度比例分配列宽
    const textWidthOfInline = (tok) => {
      if (!tok || !tok.children) return 1;
      let len = 0;
      for (const c of tok.children) {
        if (c.type === 'text' || c.type === 'code_inline') {
          for (const ch of c.content) len += ch.charCodeAt(0) > 127 ? 2 : 1;
        }
      }
      return Math.max(len, 1);
    };

    const colWeights = [];
    for (let col = 0; col < colCount; col++) {
      const headerW = textWidthOfInline(headerInlineTokens[col]);
      let maxDataW = headerW;
      for (const ri of rowInlineTokens) {
        if (ri[col]) {
          const w = textWidthOfInline(ri[col]);
          if (w > maxDataW) maxDataW = w;
        }
      }
      colWeights.push(maxDataW);
    }

    // 列宽分配：内容感知（content-aware）。
    //
    // 背景：原先只用「按内容权重等比分配 + 固定 8% 下限」。当同一张表里既有
    // 极短列（键值表的「需求名称」4 字）又有极长列（「处理过程」数百字）时，
    // 权重比可达 32×，短列被压到不足一个字宽 → 文字**逐字竖排**。
    // 更糟的是 8% 下限会被随后的「差值修正」循环逐列 -1 抹掉（该循环本意只是
    // 抹平舍入误差），下限形同虚设（实测下限 707 → 实际 509）。
    //
    // 现在改为三层：
    //   1) 每列算「自然宽度」= min(该列最长内容, 可读上限)，作为**不可压下限**。
    //      内容短的列（标签列）因此保住完整词宽，不再逐字换行；内容长的列只保
    //      一个适度地板（反正要折行，给多了是浪费）。
    //   2) **迭代钉下限**：先按权重分比例份额，凡份额低于自己下限的列钉在下限，
    //      剩余宽度只在未钉住的列之间重新按比例分，重复至无新列触底。这样短列
    //      刚好拿到"够写一个词"的宽度而不过度占用，长列分走真正的剩余空间。
    //   3) 舍入修正**只从高于下限的列回收**，触底列不再被削——修掉吞下限的 bug。
    //
    // 陷阱保护（沿用，不可破）：列数极多时（如 33 位列宽表）若下限总和已超页宽，
    // 按比例整体压缩下限，且每列始终 >= 1 DXA——避免出现负列宽使 docx 抛
    // "Invalid value '-N' specified. Must be a positive integer."（整篇转换失败）。
    const TABLE_HALF_UNIT_DXA = SIZE.五号 * 5;  // 表格五号字：半角 105 DXA / 全角 210 DXA
    const CELL_PADDING_DXA = 200;               // 左右内边距各 100，与 buildCell 的 margins 一致
    const READABLE_CAP_UNITS = 16;              // 可读上限 16 单位 = 8 个中文字（权重单位：中文=2）
    // 安全余量：中文全角字宽理论值 = 字号（210 DXA），但字体实际 advance 可能略大，
    // 且列宽会被 Word 内部舍入。若下限精确等于"4 字 × 210"，标签会卡在换行边界上，
    // 稍有偏差就退化成 3 字 + 换行。乘 1.08 留出约 1/3 字宽的余量，稳妥不换行。
    const WIDTH_SAFETY = 1.08;

    const naturalWidths = colWeights.map(w =>
      Math.round(Math.min(w, READABLE_CAP_UNITS) * TABLE_HALF_UNIT_DXA * WIDTH_SAFETY) + CELL_PADDING_DXA);

    let sumNatural = naturalWidths.reduce((a, b) => a + b, 0);
    let floors = naturalWidths;
    if (sumNatural > CONTENT_WIDTH) {
      // 下限总和已超页宽（宽表）：整体等比压缩，保证每列 >= 1
      floors = naturalWidths.map(w => Math.max(1, Math.floor(w * CONTENT_WIDTH / sumNatural)));
    }

    // 迭代钉下限：先按权重拿比例份额，凡低于自己下限的列「钉」在下限，
    // 剩余宽度只在未钉住的列之间重新按比例分配，直到没有新的列触底。
    // 这样短列刚好拿到"够写一个词"的宽度而不多占，长列分走真正的剩余空间。
    const pinned = new Array(colCount).fill(false);
    const columnWidths = new Array(colCount).fill(0);
    for (let iter = 0; iter <= colCount; iter++) {
      const freeIdx = [];
      let used = 0;
      for (let i = 0; i < colCount; i++) {
        if (pinned[i]) used += floors[i];
        else freeIdx.push(i);
      }
      if (freeIdx.length === 0) break;
      const freeWidth = Math.max(0, CONTENT_WIDTH - used);
      const freeTotal = freeIdx.reduce((a, i) => a + colWeights[i], 0) || 1;
      let newlyPinned = false;
      for (const i of freeIdx) {
        const share = Math.floor(freeWidth * colWeights[i] / freeTotal);
        if (share < floors[i]) {
          pinned[i] = true;
          columnWidths[i] = floors[i];
          newlyPinned = true;
        } else {
          columnWidths[i] = share;
        }
      }
      if (!newlyPinned) break;
    }
    // 兜底：确保每列都不低于下限、且为正整数（宽表压缩后亦成立）
    for (let i = 0; i < colCount; i++) {
      if (columnWidths[i] < floors[i]) columnWidths[i] = floors[i];
      if (columnWidths[i] < 1) columnWidths[i] = 1;
    }

    // 修正舍入误差：逐列 ±1，且**只从高于下限的列回收**——
    // 原先的实现对所有列一律 -1，会把已触底的窄列继续削薄，
    // 使下限形同虚设（实测下限 707 被削到 509，导致标签逐字竖排）。
    let diff = CONTENT_WIDTH - columnWidths.reduce((a, b) => a + b, 0);
    let guard = Math.abs(diff) + colCount * 2;
    let ci = 0;
    while (diff !== 0 && guard-- > 0) {
      const k = ci % columnWidths.length;
      if (diff > 0) {
        columnWidths[k] += 1;
        diff -= 1;
      } else if (columnWidths[k] > floors[k]) {
        columnWidths[k] -= 1;
        diff += 1;
      }
      ci++;
    }

    const buildCell = (runs, isHeader = false, colIdx = 0) => {
      const border = { style: BorderStyle.SINGLE, size: 6, color: '000000' };
      // 兜底也必须为正整数（负值在 JS 中为 truthy，不能靠 || 兜底）
      const cw = columnWidths[colIdx] > 0
        ? columnWidths[colIdx]
        : Math.max(1, Math.floor(CONTENT_WIDTH / Math.max(colCount, 1)));
      return new TableCell({
        width: { size: cw, type: WidthType.DXA },
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        verticalAlign: VerticalAlign.CENTER,
        borders: { top: border, bottom: border, left: border, right: border },
        children: [new Paragraph({
          style: 'TableText',
          alignment: isHeader ? AlignmentType.CENTER : AlignmentType.LEFT,
          // 表头行首段 keepNext：让表头行与后续数据行保持同页
          ...(isHeader ? { keepNext: true } : {}),
          children: runs.length > 0 ? runs : [new TextRun('')],
        })],
      });
    };

    const minRowHeight = cm(0.8);
    // cantSplit：禁止行内部跨页断裂（docx 库原生支持，无需后处理）
    const headerRow = new TableRow({
      tableHeader: true,
      cantSplit: true,
      height: { value: minRowHeight, rule: 'atLeast' },
      children: headers.map((h, idx) => buildCell(h, true, idx)),
    });
    // 空表头（所有表头单元格均无文字）不渲染表头行。
    // 场景：preprocess 的 repairLooseTables 为「键值对」型无分隔行表格补了
    // 空表头 + 分隔行，使 markdown-it 能解析成表格；但那种表的首行是数据
    // （需求名称/需求标识…）而非列名，若照常输出会出现一条表头行——
    // 首行被当成列名加粗居中，语义错误。故此处整行略去。
    const isEmptyHeader = headers.length > 0 && headerInlineTokens
      .every(tok => !this.flattenInlineToText(tok).trim());
    const dataRows = rows.map(row => new TableRow({
      cantSplit: true,
      height: { value: minRowHeight, rule: 'atLeast' },
      children: row.map((cell, idx) => buildCell(cell, false, idx)),
    }));

    const table = new Table({
      width: { size: columnWidths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
      columnWidths,
      alignment: AlignmentType.CENTER,
      borders: {
        top:    { style: BorderStyle.SINGLE, size: 12, color: '000000' },
        bottom: { style: BorderStyle.SINGLE, size: 12, color: '000000' },
        left:   { style: BorderStyle.SINGLE, size: 12, color: '000000' },
        right:  { style: BorderStyle.SINGLE, size: 12, color: '000000' },
        insideHorizontal: { style: BorderStyle.SINGLE, size: 6, color: '000000' },
        insideVertical:   { style: BorderStyle.SINGLE, size: 6, color: '000000' },
      },
      rows: [...(isEmptyHeader ? [] : [headerRow]), ...dataRows],
    });
    this.currentSection.children.push(table);
    // 表格后追加空行,避免连续表格直接粘连
    this.currentSection.children.push(new Paragraph({ children: [new TextRun('')] }));
    return i + 1;
  }


  // ---------- 引用块(暂用普通段落) ----------
  consumeBlockquote(tokens, i) {
    i += 1;
    while (i < tokens.length && tokens[i].type !== 'blockquote_close') {
      if (tokens[i].type === 'paragraph_open') {
        const inline = tokens[i + 1];
        const runs = this.inlineToRuns(inline);
        // 引用块:左缩进 0.74cm,无首行缩进
        this.currentSection.children.push(new Paragraph({
          style: 'Normal',
          indent: { left: cm(0.74), firstLine: 0 },
          children: runs,
        }));
        i += 3;
      } else {
        i += 1;
      }
    }
    return i + 1;
  }
}

// =========================================================================
// 4. 装配整篇文档(封面/目录/正文 三节)
// =========================================================================

function blank() {
  return new Paragraph({ children: [new TextRun({ text: '', ...runFont(FONT.仿宋, SIZE.小四) })] });
}

function buildCover(title, company, date) {
  const children = [];
  for (let i = 0; i < 5; i++) children.push(blank());

  // 大标题(支持单行或多行)
  const titleLines = (title || '未命名文档').split('\n');
  for (const line of titleLines) {
    children.push(new Paragraph({
      style: 'CoverTitle',
      children: [new TextRun({ text: line, ...runFont(FONT.方正小标宋, SIZE.小一) })],
    }));
  }

  // 落款用 spacing.before 推到页底
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    indent: { firstLine: 0 },
    spacing: { before: cm(13.5), line: 480, lineRule: 'auto', after: 0 },
    children: [new TextRun({ text: company || 'xx公司', ...runFont(FONT.黑体, SIZE.三号) })],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    indent: { firstLine: 0 },
    spacing: { line: 480, lineRule: 'auto', before: 0, after: 0 },
    children: [new TextRun({ text: date || 'xxxx年xx月', ...runFont(FONT.黑体, SIZE.三号) })],
  }));
  return children;
}

function buildTOC() {
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      indent: { firstLine: 0 },
      spacing: { before: 0, after: 360 },
      children: [new TextRun({ text: '目  录', ...runFont(FONT.黑体, SIZE.三号) })],
    }),
    new TableOfContents('Table of Contents', { hyperlink: true, headingStyleRange: '1-3' }),
  ];
}

function makePageMargin() {
  return { top: PAGE.marginTop, bottom: PAGE.marginBottom,
    left: PAGE.marginLeft, right: PAGE.marginRight,
    header: PAGE.headerDistance, footer: PAGE.footerDistance };
}

function makeFooter(currentOnly = true) {
  const runs = currentOnly
    ? [new TextRun({ children: [PageNumber.CURRENT], ...runFont(FONT.仿宋, SIZE.五号) })]
    : [
        new TextRun({ children: [PageNumber.CURRENT], ...runFont(FONT.仿宋, SIZE.五号) }),
        new TextRun({ text: ' / ', ...runFont(FONT.仿宋, SIZE.五号) }),
        new TextRun({ children: [PageNumber.TOTAL_PAGES], ...runFont(FONT.仿宋, SIZE.五号) }),
      ];
  return new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER, indent: { firstLine: 0 },
      children: runs,
    })],
  });
}

// =========================================================================
// 6. DOCX 后处理: 防止表格跨页时题注+表头单独出现在页底
// =========================================================================

/**
 * 调用 python-docx 修改 DOCX 分页属性:
 * 1. 所有行加 <w:cantSplit/> — 防止行内部跨页断裂
 * 2. Caption 段落加 <w:keepNext/> + <w:keepLines/> — 题注与表格同页
 * 3. 表头行首段落加 <w:keepNext/> — 表头行与数据行同页
 */
function patchDocxPagination(docxPath) {
  const script = `
import sys
from docx import Document
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

doc = Document(sys.argv[1])

# 1. cantSplit on ALL rows — 防止行内部跨页断裂
for tbl in doc.tables:
    for row in tbl.rows:
        trPr = row._tr.get_or_add_trPr()
        if trPr.find(qn('w:cantSplit')) is None:
            trPr.append(OxmlElement('w:cantSplit'))

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

# 3. 表头行首段落加 keepNext — 将表头行与数据行绑定
for tbl in doc.tables:
    for row in tbl.rows:
        trPr = row._tr.get_or_add_trPr()
        if trPr.find(qn('w:tblHeader')) is not None:
            cells = row._tr.findall(qn('w:tc'))
            if cells:
                paras = cells[0].findall(qn('w:p'))
                if paras:
                    pPr = paras[0].get_or_add_pPr()
                    if pPr.find(qn('w:keepNext')) is None:
                        pPr.append(OxmlElement('w:keepNext'))

doc.save(sys.argv[1])
`;
  try {
    execSync(`python3 -c '${script.replace(/'/g, "'\\''")}' "${docxPath}"`, { stdio: 'pipe' });
  } catch (e) {
    console.warn(`[md2docx] 分页后处理失败(非致命): ${e.message}`);
  }
}

// =========================================================================
// 7. 可编程入口 + CLI 入口
// =========================================================================

// convert(cleanPath, opts) — 可编程 API（HTTP 服务经此复用）
// opts:
//   outputBase     — 输出基础目录（默认自动推导）
//   srcDir         — 作者源文件目录（图片引用解析基准之一；默认 outputBase）
//   imageRoot      — 图片解析的容器边界；越界引用视为不存在（HTTP 服务传 jobDir）
//   outputPath     — 显式指定输出 docx 路径（默认 outputBase/output/docx/）
//   onProgress     — (percent, message) 进度回调（0-100）
//   onLog          — (line) 日志行回调
// 返回 { outputPath, stats: { paragraphs, images, tables } }
async function convert(cleanPath, opts = {}) {
  const inputPath = cleanPath;
  const inputDir = path.dirname(path.resolve(inputPath));
  // 判断是否在 output/clean/ 目录下,自动定位到 output/docx/
  const isInOutputClean = inputDir.endsWith(path.join('output', 'clean')) ||
                           inputDir.endsWith(path.join('output', 'clean') + path.sep);
  const outputBase = opts.outputBase || (isInOutputClean ? path.resolve(inputDir, '..', '..') : inputDir);
  const srcDir = opts.srcDir || (isInOutputClean ? outputBase : inputDir);
  const docName = path.basename(inputPath).replace(/\.clean\.md$/i, '.md').replace(/\.md$/i, '');
  const defaultOutput = path.join(outputBase, 'output', 'docx', `${docName}.docx`);
  const outputPath = opts.outputPath || defaultOutput;

  const report = opts.report || console;

  if (!fs.existsSync(inputPath)) {
    throw new Error(`输入文件不存在: ${inputPath}`);
  }

  // 统一换行符为 LF + 剥离 BOM，与 preprocess 一致：
  //   CRLF → 不带 m 标志的 `...$` 正则失配（JS 中 `.` 不匹配 `\r`）
  //   BOM  → 行首 U+FEFF 会让 `^---` 之类锚定匹配失效
  const raw = fs.readFileSync(inputPath, 'utf-8')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n');
  // 解析 YAML front matter
  const parsed = matter(raw);
  const meta = parsed.data || {};
  let content = parsed.content;

  // 剥离 H1(# 文档标题)作为封面标题
  // 规则:整个 md 文件中,# 一级标题只能用于"文档标题",章节起始用 ##
  // 实现:把所有 # 标题统统剥离;若 YAML 没给 title,取第一个 # 作为 title
  const h1Matches = [...content.matchAll(/^#\s+(.+?)$/gm)];
  let docTitle = meta.title;
  if (h1Matches.length > 0) {
    if (!docTitle) docTitle = h1Matches[0][1].trim();
    if (h1Matches.length > 1) {
      console.warn(`[警告] md 中检测到 ${h1Matches.length} 个 "# " 一级标题。`);
      console.warn(`        规则:# 仅用于文档标题(封面),章节起始请用 ## 起。`);
      console.warn(`        额外的 # 标题:${h1Matches.slice(1).map(m => `"${m[1].trim()}"`).join(', ')}`);
      console.warn(`        这些标题在转换中会被忽略。`);
    }
    // 剥离所有 # 行
    content = content.replace(/^#\s+.+$/gm, '').replace(/^\n+/, '');
  }

  report.log(`[md2docx] 输入: ${inputPath}`);
  report.log(`[md2docx] 文档标题: ${docTitle || '(未设置)'}`);
  report.log(`[md2docx] 公司: ${meta.company || '(未设置)'}`);
  report.log(`[md2docx] 日期: ${meta.date || '(未设置)'}`);
  if (opts.onProgress) opts.onProgress(5, '解析 YAML front matter');

  // 预扫描：统计顶层列表数量，动态确定列表池大小
  const listCount = countTopLevelLists(content);
  const listPoolSize = Math.max(listCount + 10, 50);  // 预留余量，最少 50
  const numberingConfig = buildNumberingConfig(listPoolSize);

  // 转换正文
  const converter = new Md2DocxConverter({
    inputDir, srcDir, listPoolSize,
    imageRoot: opts.imageRoot || null,
  });
  // 临时目录归属：只有本函数自己创建时才负责清理。
  // 外部传入 tmpDir（如复用同一目录做多篇转换）时归调用方管理。
  // 不清理会持续泄漏——实测本机曾积累 288 个 /tmp/md2docx-*。
  const ownsTmpDir = !opts.tmpDir;
  const cleanupTmpDir = () => {
    if (!ownsTmpDir) return;
    try { fs.rmSync(converter.tmpDir, { recursive: true, force: true }); }
    catch (_) { /* 清理失败不影响产物 */ }
  };
  // 图片（mermaid / plantuml / 作者自带）都在 convert() 阶段读入内存
  // （renderMermaid / renderPlantUML 返回 buffer），之后不再需要临时目录。
  // 因此用 try/finally 包住这一句：**成功与抛错都清理**，
  // 否则失败路径会持续泄漏（实测本机曾积累 288 个 /tmp/md2docx-*）。
  let converterSections;
  try {
    converterSections = converter.convert(content);
  } finally {
    cleanupTmpDir();
  }
  if (opts.onProgress) opts.onProgress(70, '解析并转换正文');
  report.log(`[md2docx] 正文段落/元素数: ${converterSections.reduce((sum, sec) => sum + sec.children.length, 0)}`);
  report.log(`[md2docx] 嵌入图片: ${converter.imageIndex} 个`);
  report.log(`[md2docx] 自动表注: ${converter.tableIndex} 个`);

  // 装配正文 sections
  const bodySections = converterSections.map((sec, idx) => {
    const isFirst = (idx === 0);
    const isLandscape = (sec.orientation === 'landscape');

    const pageSize = isLandscape
      ? { width: LANDSCAPE_PAGE.width, height: LANDSCAPE_PAGE.height }
      : { width: PAGE.width, height: PAGE.height };

    const pageNumbers = isFirst
      ? { start: 1, formatType: NumberFormat.DECIMAL }
      : { formatType: NumberFormat.DECIMAL };

    return {
      properties: {
        type: isFirst ? SectionType.ODD_PAGE : SectionType.NEXT_PAGE,
        page: {
          size: pageSize,
          margin: makePageMargin(),
          pageNumbers,
        },
      },
      footers: { default: makeFooter() },
      children: sec.children,
    };
  });

  // 装配文档
  const doc = new Document({
    creator: 'md2docx',
    title: docTitle || 'Untitled',
    styles: documentStyles,
    numbering: numberingConfig,
    updateFields: true,
    sections: [
      // 封面
      { properties: { page: { size: { width: PAGE.width, height: PAGE.height },
          margin: makePageMargin() } },
        children: buildCover(docTitle, meta.company, meta.date) },
      // 目录
      { properties: { type: SectionType.ODD_PAGE,
          page: { size: { width: PAGE.width, height: PAGE.height },
            margin: makePageMargin(),
            pageNumbers: { start: 1, formatType: NumberFormat.UPPER_ROMAN } } },
        footers: { default: makeFooter() },
        children: buildTOC() },
      // 正文（动态展开）
      ...bodySections,
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outputPath, buffer);
  // 分页属性（cantSplit / keepNext / keepLines）已由 docx 库**原生输出**，
  // 无需再调用 python-docx 后处理——语义等价性经真实文档实测验证
  // （4427 表格行 + 13514 段落，0 处差异；见 scripts/compare-pagination.js）。
  // 因此默认不再依赖 Python，两个平台都少一套运行时。
  // 如需回退旧行为（比对历史产物等），设 ENABLE_PAGINATION_PATCH=1。
  if (process.env.ENABLE_PAGINATION_PATCH === '1') {
    patchDocxPagination(outputPath);
  }
  const finalSize = fs.statSync(outputPath).size;
  report.log(`[md2docx] 已生成: ${outputPath} (${(finalSize / 1024).toFixed(1)} KB)`);
  if (opts.onProgress) opts.onProgress(100, 'DOCX 生成完成');

  return {
    outputPath,
    stats: {
      paragraphs: converterSections.reduce((sum, sec) => sum + sec.children.length, 0),
      images: converter.imageIndex,
      tables: converter.tableIndex,
      sizeBytes: finalSize,
    },
  };
}

// ---- CLI 入口 ----
async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('用法: node md2docx.js <input.md> [output.docx]');
    process.exit(1);
  }
  try {
    await convert(args[0], args[1] ? { outputPath: args[1] } : {});
  } catch (e) {
    console.error(`错误: ${e.message}`);
    process.exit(1);
  }
}

// 仅作为 CLI 直接执行时运行 main（HTTP 服务 require 本文件不触发）
if (require.main === module) {
  main();
}

module.exports = { convert, Md2DocxConverter };
