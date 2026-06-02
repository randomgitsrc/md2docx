/**
 * 技术文档模板生成器 - 符合《技术文档格式-20260525》规范
 *
 * 单位换算备忘:
 *   1 cm  = 567 DXA (twips) 约值;精确 1 inch = 1440 DXA, 1 cm = 1440/2.54 ≈ 566.93
 *   字号 (half-points): 小一=36, 小三=30, 四号=28, 小四=24, 五号=21
 *   行距 (240 = 单倍, 360 = 1.5倍, 300 = 1.25倍)
 */

const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, PageOrientation, LevelFormat,
  TabStopType, TabStopPosition, SectionType,
  TableOfContents, HeadingLevel, BorderStyle, WidthType, ShadingType,
  VerticalAlign, PageNumber, PageBreak, NumberFormat, ImageRun,
  HorizontalPositionAlign, VerticalPositionAlign, convertInchesToTwip
} = require('docx');

// ============== 单位换算工具 ==============
const cm = (n) => Math.round(n * 566.93);   // cm -> DXA
const pt = (n) => Math.round(n * 20);       // 磅 -> DXA (1 pt = 20 DXA)
const halfPt = (n) => n * 2;                // 字号 -> half-points

// ============== 字号定义 (half-points) ==============
const SIZE = {
  小一: 36,    // 24pt
  小三: 30,    // 15pt
  四号: 28,    // 14pt
  小四: 24,    // 12pt
  五号: 21,    // 10.5pt
};

// ============== 字体定义 ==============
const FONT = {
  仿宋: '仿宋',
  方正小标宋: '方正小标宋简体',
  黑体: '黑体',
  楷体: '楷体',
  西文: 'Times New Roman',
};

// ============== 页面参数 ==============
const PAGE = {
  width: cm(21),         // A4 宽
  height: cm(29.7),      // A4 高
  marginTop: cm(2.54),
  marginBottom: cm(2.54),
  marginLeft: cm(2.7),
  marginRight: cm(2.7),
  headerDistance: cm(0.70),
  footerDistance: cm(1.45),
};
// 正文可用宽度 (用于表格)
const CONTENT_WIDTH = PAGE.width - PAGE.marginLeft - PAGE.marginRight;

// ============== 通用 run 属性 (中英文字体绑定) ==============
// 关键: 中文字符在 docx 里用 eastAsia 属性,英文用 ascii
const runFont = (cnFont, sizeHalfPt, opts = {}) => ({
  font: { ascii: FONT.西文, eastAsia: cnFont, hAnsi: FONT.西文, cs: FONT.西文 },
  size: sizeHalfPt,
  ...opts,
});

// ============================================================
// 文档样式定义
// ============================================================
const documentStyles = {
  default: {
    document: {
      run: { font: { ascii: FONT.西文, eastAsia: FONT.仿宋, hAnsi: FONT.西文 }, size: SIZE.小四 },
      paragraph: { spacing: { line: 300, lineRule: 'auto', before: 0, after: 0 } }, // 1.25倍
    },
  },
  paragraphStyles: [
    // ---- 正文 ----
    {
      id: 'Normal',
      name: 'Normal',
      run: { font: { ascii: FONT.西文, eastAsia: FONT.仿宋, hAnsi: FONT.西文 }, size: SIZE.小四 },
      paragraph: {
        spacing: { line: 360, lineRule: 'auto', before: 0, after: 0 }, // 正文 1.5倍
        indent: { firstLine: 480 }, // 2 个小四字符 ≈ 480 DXA (12pt * 20 * 2)
      },
    },
    // ---- 封面标题 ----
    {
      id: 'CoverTitle',
      name: '封面标题',
      basedOn: 'Normal',
      next: 'Normal',
      run: { font: { ascii: FONT.西文, eastAsia: FONT.方正小标宋, hAnsi: FONT.西文 }, size: SIZE.小一 },
      paragraph: {
        alignment: AlignmentType.CENTER,
        indent: { firstLine: 0 },
        spacing: { line: 360, lineRule: 'auto', before: 240, after: 240 },
      },
    },
    // ---- 标题 1 级 ----
    {
      id: 'Heading1',
      name: 'Heading 1',
      basedOn: 'Normal',
      next: 'Normal',
      quickFormat: true,
      run: { font: { ascii: FONT.西文, eastAsia: FONT.黑体, hAnsi: FONT.西文 }, size: SIZE.小三, bold: false },
      paragraph: {
        spacing: { line: 360, lineRule: 'auto', before: 240, after: 120 },
        indent: { firstLine: 0 },
        outlineLevel: 0,
      },
    },
    // ---- 标题 2 级 ----
    {
      id: 'Heading2',
      name: 'Heading 2',
      basedOn: 'Normal',
      next: 'Normal',
      quickFormat: true,
      run: { font: { ascii: FONT.西文, eastAsia: FONT.楷体, hAnsi: FONT.西文 }, size: SIZE.小三, bold: false },
      paragraph: {
        spacing: { line: 360, lineRule: 'auto', before: 180, after: 100 },
        indent: { firstLine: 0 },
        outlineLevel: 1,
      },
    },
    // ---- 标题 3 级 ----
    {
      id: 'Heading3',
      name: 'Heading 3',
      basedOn: 'Normal',
      next: 'Normal',
      quickFormat: true,
      run: { font: { ascii: FONT.西文, eastAsia: FONT.仿宋, hAnsi: FONT.西文 }, size: SIZE.四号, bold: true },
      paragraph: {
        spacing: { line: 360, lineRule: 'auto', before: 120, after: 80 },
        indent: { firstLine: 0 },
        outlineLevel: 2,
      },
    },
    // ---- 标题 4 级 ----
    {
      id: 'Heading4',
      name: 'Heading 4',
      basedOn: 'Normal',
      next: 'Normal',
      quickFormat: true,
      run: { font: { ascii: FONT.西文, eastAsia: FONT.仿宋, hAnsi: FONT.西文 }, size: SIZE.四号, bold: false },
      paragraph: {
        spacing: { line: 360, lineRule: 'auto', before: 100, after: 60 },
        indent: { firstLine: 0 },
        outlineLevel: 3,
      },
    },
    // ---- 标题 5 级 ----
    {
      id: 'Heading5',
      name: 'Heading 5',
      basedOn: 'Normal',
      next: 'Normal',
      quickFormat: true,
      run: { font: { ascii: FONT.西文, eastAsia: FONT.仿宋, hAnsi: FONT.西文 }, size: SIZE.小四, bold: true },
      paragraph: {
        spacing: { line: 360, lineRule: 'auto', before: 80, after: 60 },
        indent: { firstLine: 0 },
        outlineLevel: 4,
      },
    },
    // ---- 表格文本 ----
    {
      id: 'TableText',
      name: '表格文本',
      basedOn: 'Normal',
      run: { font: { ascii: FONT.西文, eastAsia: FONT.仿宋, hAnsi: FONT.西文 }, size: SIZE.五号 },
      paragraph: {
        spacing: { line: 240, lineRule: 'auto', before: 0, after: 0 },
        indent: { firstLine: 0 },
      },
    },
    // ---- 题注 ----
    {
      id: 'Caption',
      name: 'Caption',
      basedOn: 'Normal',
      run: { font: { ascii: FONT.西文, eastAsia: FONT.黑体, hAnsi: FONT.西文 }, size: SIZE.小四 },
      paragraph: {
        alignment: AlignmentType.CENTER,
        spacing: { line: 360, lineRule: 'auto', before: 60, after: 60 },
        indent: { firstLine: 0 },
      },
    },
  ],
};

// ============================================================
// 多级标题编号配置 (1, 1.1, 1.1.1 ...)
// ============================================================
const numberingConfig = {
  config: [
    // ---- 多级标题编号 (绑定到标题样式) ----
    {
      reference: 'heading-numbering',
      levels: [
        { level: 0, format: LevelFormat.DECIMAL, text: '%1', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 0, hanging: 0, firstLine: 0 } },
                   run: { font: { ascii: FONT.西文, eastAsia: FONT.黑体, hAnsi: FONT.西文 } } } },
        { level: 1, format: LevelFormat.DECIMAL, text: '%1.%2', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 0, hanging: 0, firstLine: 0 } } } },
        { level: 2, format: LevelFormat.DECIMAL, text: '%1.%2.%3', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 0, hanging: 0, firstLine: 0 } } } },
        { level: 3, format: LevelFormat.DECIMAL, text: '%1.%2.%3.%4', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 0, hanging: 0, firstLine: 0 } } } },
        { level: 4, format: LevelFormat.DECIMAL, text: '%1.%2.%3.%4.%5', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 0, hanging: 0, firstLine: 0 } } } },
        { level: 5, format: LevelFormat.DECIMAL, text: '%1.%2.%3.%4.%5.%6', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 0, hanging: 0, firstLine: 0 } } } },
        { level: 6, format: LevelFormat.DECIMAL, text: '%1.%2.%3.%4.%5.%6.%7', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 0, hanging: 0, firstLine: 0 } } } },
        { level: 7, format: LevelFormat.DECIMAL, text: '%1.%2.%3.%4.%5.%6.%7.%8', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 0, hanging: 0, firstLine: 0 } } } },
        { level: 8, format: LevelFormat.DECIMAL, text: '%1.%2.%3.%4.%5.%6.%7.%8.%9', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 0, hanging: 0, firstLine: 0 } } } },
      ],
    },
    // ---- 段内列表第1级: 1, 2, 3 ----
    {
      reference: 'list-l1',
      levels: [
        { level: 0, format: LevelFormat.DECIMAL, text: '%1', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: cm(0.74), hanging: cm(0.74) } } } },
      ],
    },
    // ---- 段内列表第2级: (1), (2), (3) ----
    {
      reference: 'list-l2',
      levels: [
        { level: 0, format: LevelFormat.DECIMAL, text: '(%1)', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: cm(1.48), hanging: cm(0.74) } } } },
      ],
    },
    // ---- 段内列表第3级: a), b), c) ----
    {
      reference: 'list-l3',
      levels: [
        { level: 0, format: LevelFormat.LOWER_LETTER, text: '%1)', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: cm(2.22), hanging: cm(0.74) } } } },
      ],
    },
  ],
};

// ============================================================
// 辅助构造函数
// ============================================================

// 正文段落
function P(text, opts = {}) {
  return new Paragraph({
    style: 'Normal',
    children: [new TextRun({ text, ...runFont(FONT.仿宋, SIZE.小四) })],
    ...opts,
  });
}

// 标题(自动套用多级编号)
function H(level, text) {
  const styleId = `Heading${level}`;
  return new Paragraph({
    style: styleId,
    numbering: { reference: 'heading-numbering', level: level - 1 },
    children: [new TextRun({ text })],
  });
}

// 列表项
function L(level, text) {
  const ref = `list-l${level}`;
  return new Paragraph({
    style: 'Normal',
    numbering: { reference: ref, level: 0 },
    indent: { firstLine: 0 },  // 取消首行缩进
    children: [new TextRun({ text, ...runFont(FONT.仿宋, SIZE.小四) })],
  });
}

// 题注
function Caption(text) {
  return new Paragraph({
    style: 'Caption',
    children: [new TextRun({ text, ...runFont(FONT.黑体, SIZE.小四) })],
  });
}

// 表格单元格
function TC(text, opts = {}) {
  const { isHeader = false, width, align = AlignmentType.LEFT } = opts;
  const border = { style: BorderStyle.SINGLE, size: 6, color: '000000' }; // 内框正常线
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    verticalAlign: VerticalAlign.CENTER,
    borders: { top: border, bottom: border, left: border, right: border },
    children: [
      new Paragraph({
        style: 'TableText',
        alignment: align,
        children: [new TextRun({
          text,
          bold: isHeader,
          ...runFont(FONT.仿宋, SIZE.五号),
        })],
      }),
    ],
  });
}

// 表格 (最小行高 0.8cm,外框粗线,内框细线,居中)
function makeTable(headers, rows, columnWidths) {
  const tableWidth = columnWidths.reduce((a, b) => a + b, 0);
  const minRowHeight = cm(0.8);

  // 表头行
  const headerRow = new TableRow({
    tableHeader: true,  // 跨页时重复
    height: { value: minRowHeight, rule: 'atLeast' },
    children: headers.map((h, i) =>
      TC(h, { isHeader: true, width: columnWidths[i], align: AlignmentType.CENTER })),
  });

  // 数据行
  const dataRows = rows.map(row => new TableRow({
    height: { value: minRowHeight, rule: 'atLeast' },
    children: row.map((cell, i) => TC(cell, { width: columnWidths[i] })),
  }));

  return new Table({
    width: { size: tableWidth, type: WidthType.DXA },
    columnWidths,
    alignment: AlignmentType.CENTER,
    // 外框: 1.5 磅 = 12 (size 单位是 1/8 磅,12 = 1.5 磅)
    borders: {
      top:    { style: BorderStyle.SINGLE, size: 12, color: '000000' },
      bottom: { style: BorderStyle.SINGLE, size: 12, color: '000000' },
      left:   { style: BorderStyle.SINGLE, size: 12, color: '000000' },
      right:  { style: BorderStyle.SINGLE, size: 12, color: '000000' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 6, color: '000000' },
      insideVertical:   { style: BorderStyle.SINGLE, size: 6, color: '000000' },
    },
    rows: [headerRow, ...dataRows],
  });
}

// 空行 (无样式干扰)
function blank() {
  return new Paragraph({ children: [new TextRun({ text: '', ...runFont(FONT.仿宋, SIZE.小四) })] });
}

// ============================================================
// 三大节内容构造
// ============================================================

// ---------- 第1节: 封面 ----------
function buildCoverChildren() {
  return [
    blank(), blank(), blank(), blank(), blank(),
    new Paragraph({
      style: 'CoverTitle',
      children: [new TextRun({ text: '技术文档模板', ...runFont(FONT.方正小标宋, SIZE.小一) })],
    }),
    new Paragraph({
      style: 'CoverTitle',
      children: [new TextRun({ text: '——格式样例与规范说明', ...runFont(FONT.方正小标宋, SIZE.小一) })],
    }),
    blank(), blank(), blank(), blank(), blank(), blank(), blank(),

    // 文档信息表(简单的居中文字版本)
    new Paragraph({
      alignment: AlignmentType.CENTER,
      indent: { firstLine: 0 },
      children: [new TextRun({ text: '文档版本:V1.0', ...runFont(FONT.仿宋, SIZE.四号) })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      indent: { firstLine: 0 },
      children: [new TextRun({ text: '编制日期:2026 年 05 月', ...runFont(FONT.仿宋, SIZE.四号) })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      indent: { firstLine: 0 },
      children: [new TextRun({ text: '编制单位:技术文档组', ...runFont(FONT.仿宋, SIZE.四号) })],
    }),
  ];
}

// ---------- 第2节: 目录 ----------
function buildTOCChildren() {
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      indent: { firstLine: 0 },
      spacing: { before: 0, after: 360 },
      children: [new TextRun({ text: '目  录', ...runFont(FONT.黑体, SIZE.小一), bold: false })],
    }),
    new TableOfContents('Table of Contents', {
      hyperlink: true,
      headingStyleRange: '1-5',
    }),
  ];
}

// ---------- 第3节: 正文 ----------
function buildBodyChildren() {
  return [
    // ===== 第 1 章 =====
    H(1, '引言'),
    P('本文档用于演示《技术文档格式规范》定义的全部样式与排版规则。读者可以参考本样例,以保证后续编制的技术文档在视觉效果与结构层级上保持一致。'),
    P('文档采用 A4 纸张,页边距上下 2.54 cm,左右 2.7 cm;页眉距页边 0.70 cm,页脚距页边 1.45 cm。'),

    H(2, '文档结构'),
    P('文档由封面、目录、正文三部分组成,每部分均以奇数页开始。封面节使用大写罗马数字页码,正文节使用阿拉伯数字页码并从 1 重新起编。'),

    H(2, '适用范围'),
    P('本规范适用于所有需要对外发布的中文技术文档,包括但不限于需求规格说明书、设计方案、测试报告、运维手册等。'),

    H(3, '术语与缩略语'),
    P('文档中出现的术语在首次出现时应给出完整定义。专用缩略语应在术语表中统一说明。'),

    H(4, '术语收录原则'),
    P('收录原则上限定为本文档的核心业务术语,通用计算机术语原则上不收录。'),

    H(5, '收录范围举例'),
    P('如:领域专有名词、自定义协议字段、内部系统代号等。'),

    // ===== 第 2 章 =====
    H(1, '样式样例'),
    P('以下展示在文档中可能出现的各种内容元素的标准排版效果。'),

    H(2, '段落与正文'),
    P('正文段落采用仿宋小四号字体,行距 1.5 倍,首行缩进 2 字符,两端对齐(此处规范为左对齐)。段前段后均不留空,通过行距保持版面整齐。这是一个示例段落,用以说明正文的视觉密度与可读性。'),
    P('正文中如出现西文字符,如 RESTful API、HTTP/2、TLS 1.3,均使用 Times New Roman 字体显示,与中文仿宋形成自然的混排效果。'),

    H(2, '列表样例'),
    P('技术文档中的并列说明可使用多级编号列表。下面是一个三级嵌套列表的样例:'),
    L(1, '第一类指标'),
    L(2, '功能性指标'),
    L(3, '业务功能完整性'),
    L(3, '接口规范符合性'),
    L(3, '异常处理能力'),
    L(2, '性能指标'),
    L(2, '安全性指标'),
    L(1, '第二类指标'),
    L(1, '第三类指标'),
    P('列表结束后回归正文段落。注意:列表项严禁使用 markdown 中的连字符或破折号前缀符号。'),

    H(2, '表格样例'),
    Caption('表 2-1  常用字号与字体对照表'),
    makeTable(
      ['元素', '中文字体', '字号', '行距'],
      [
        ['封面标题', '方正小标宋简体', '小一(24磅)', '1.25倍'],
        ['标题 1 级', '黑体', '小三(15磅)', '1.5倍'],
        ['标题 2 级', '楷体', '小三(15磅)', '1.5倍'],
        ['标题 3 级', '仿宋', '四号(14磅)', '1.5倍'],
        ['正文', '仿宋', '小四(12磅)', '1.5倍'],
        ['表格文本', '仿宋', '五号(10.5磅)', '最小行距 0.8cm'],
      ],
      // 列宽:总宽 ≈ 15.6 cm
      [cm(3.0), cm(4.0), cm(4.6), cm(4.0)],
    ),
    P('表格外框线为 1.5 磅,内框为正常线宽。表头加粗,跨页时自动重复。表格在文档中水平居中。'),

    H(2, '图表样例'),
    P('文档中如包含流程图、架构图等,应作为图片插入。原始 Markdown 中的 Mermaid 图表会渲染为 PNG 后嵌入。下方为一个真实示例:Mermaid 源码经 mermaid-cli 渲染为 PNG 并嵌入 Word。'),
    // 真实 Mermaid 渲染后的 PNG (居中,等比缩放至合适宽度)
    new Paragraph({
      alignment: AlignmentType.CENTER,
      indent: { firstLine: 0 },
      spacing: { before: 120, after: 60 },
      children: [new ImageRun({
        type: 'png',
        data: fs.readFileSync('/home/claude/sample_diagram.png'),
        // PNG 原始 453 x 896,等比缩放:宽 240px(约 6.35cm)→ 高 = 240 * 896/453 ≈ 474
        transformation: { width: 240, height: 474 },
        altText: { title: '业务审批流程图', description: 'Mermaid 渲染的流程图样例', name: 'sample_diagram' },
      })],
    }),
    Caption('图 2-1  业务审批流程示例(由 Mermaid 渲染)'),
    P('图注采用黑体小四,居中放置于图的下方。Mermaid 源码在 Markdown 中以代码块形式书写,转换脚本会自动识别 ```mermaid 代码块并渲染为 PNG 后嵌入。'),

    H(2, '编号深度演示'),
    P('为验证多级标题编号是否正常生成 1、1.1、1.1.1 ... 的层级,以下连续展开五级标题:'),

    H(3, '第三级标题'),
    P('对应编号格式为 X.X.X,字体仿宋四号加粗。'),

    H(4, '第四级标题'),
    P('对应编号格式为 X.X.X.X,字体仿宋四号。'),

    H(5, '第五级标题'),
    P('对应编号格式为 X.X.X.X.X,字体仿宋小四加粗。'),

    // ===== 第 3 章 =====
    H(1, '使用建议'),
    P('在实际编制文档时,建议遵循以下原则,以保证团队内交付物风格统一。'),

    H(2, '样式优先'),
    P('原则上只使用本模板提供的样式(标题 1-5、正文、表格文本、题注等),不要从其它文档复制带格式的内容,以免引入外部样式污染本模板的样式表。'),

    H(2, '编号一致'),
    P('章节编号由 Word 自动生成,作者无需手动输入。如出现编号错乱,通常是直接复制粘贴造成的,可通过"清除格式后重新套用样式"修复。'),

    H(2, '交叉引用'),
    P('图表、章节之间的引用应使用 Word 的"交叉引用"功能,这样在内容增删时编号可自动更新。'),

    // 文档结束(留一段说明文字)
    H(1, '结语'),
    P('本模板覆盖了《技术文档格式-20260525》规范中定义的全部主要样式。如发现任何与规范不符之处,请反馈以便迭代修订。'),
  ];
}

// ============================================================
// 组装文档
// ============================================================
const doc = new Document({
  creator: 'Claude',
  title: '技术文档模板',
  description: '符合《技术文档格式-20260525》规范的样例文档',
  styles: documentStyles,
  numbering: numberingConfig,
  sections: [
    // ----------- Section 1: 封面 -----------
    {
      properties: {
        page: {
          size: { width: PAGE.width, height: PAGE.height },
          margin: {
            top: PAGE.marginTop, bottom: PAGE.marginBottom,
            left: PAGE.marginLeft, right: PAGE.marginRight,
            header: PAGE.headerDistance, footer: PAGE.footerDistance,
          },
          pageNumbers: {
            start: 1,
            formatType: NumberFormat.UPPER_ROMAN, // 大写罗马数字
          },
        },
        titlePage: false,
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            indent: { firstLine: 0 },
            children: [
              new TextRun({ children: [PageNumber.CURRENT], ...runFont(FONT.仿宋, SIZE.五号) }),
            ],
          })],
        }),
      },
      children: buildCoverChildren(),
    },

    // ----------- Section 2: 目录 (奇数页开始) -----------
    {
      properties: {
        type: SectionType.ODD_PAGE,
        page: {
          size: { width: PAGE.width, height: PAGE.height },
          margin: {
            top: PAGE.marginTop, bottom: PAGE.marginBottom,
            left: PAGE.marginLeft, right: PAGE.marginRight,
            header: PAGE.headerDistance, footer: PAGE.footerDistance,
          },
          pageNumbers: {
            start: 1,
            formatType: NumberFormat.UPPER_ROMAN,
          },
        },
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            indent: { firstLine: 0 },
            children: [
              new TextRun({ children: [PageNumber.CURRENT], ...runFont(FONT.仿宋, SIZE.五号) }),
            ],
          })],
        }),
      },
      children: buildTOCChildren(),
    },

    // ----------- Section 3: 正文 (奇数页开始,页码重新计数为阿拉伯数字) -----------
    {
      properties: {
        type: SectionType.ODD_PAGE,
        page: {
          size: { width: PAGE.width, height: PAGE.height },
          margin: {
            top: PAGE.marginTop, bottom: PAGE.marginBottom,
            left: PAGE.marginLeft, right: PAGE.marginRight,
            header: PAGE.headerDistance, footer: PAGE.footerDistance,
          },
          pageNumbers: {
            start: 1,
            formatType: NumberFormat.DECIMAL, // 阿拉伯数字
          },
        },
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            indent: { firstLine: 0 },
            children: [
              new TextRun({ children: [PageNumber.CURRENT], ...runFont(FONT.仿宋, SIZE.五号) }),
            ],
          })],
        }),
      },
      children: buildBodyChildren(),
    },
  ],
});

// ============================================================
// 输出
// ============================================================
Packer.toBuffer(doc).then(buffer => {
  const out = '/home/claude/技术文档模板-样例.docx';
  fs.writeFileSync(out, buffer);
  console.log('生成完成:', out);
  console.log('文件大小:', (buffer.length / 1024).toFixed(1), 'KB');
});
