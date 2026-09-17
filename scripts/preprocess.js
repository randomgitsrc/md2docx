#!/usr/bin/env node
/**
 * preprocess.js — Markdown 预处理器
 * 将原始 md 文件转换为 md2docx.js 兼容的干净格式
 *
 * 处理项:
 *   1. YAML front matter: 确保有 company 和 title 字段
 *   2. 剥离标题自带编号 (## 1 范围 → ## 范围)
 *   3. 超深标题降级 (###### → #####)
 *   4. 列表 `-` 前缀 → 编号格式 (1. / (1) / a))
 *   5. Mermaid 代码块 → 渲染为 PNG，替换为图片引用
 *   6. 题注标记: 将 md 中已有的 "表 X-X 名称" / "图 X-X 名称" 转为加粗格式
 *
 * 双入口:
 *   - CLI:   node preprocess.js <input.md> [output.md]
 *   - 编程:  const { preprocess } = require('./preprocess');
 *            preprocess(inputPath, { cleanDir, mermaidCacheDir, ... })
 *            （HTTP 服务经此入口复用，目录可参数化以隔离并发作业）
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const matter = require('gray-matter');
const yaml = require('js-yaml');
const { generateConfig } = require('./puppeteer-config');
const { renderPlantUML } = require('./plantuml-renderer');
const { runMmdc } = require('./exec-util');
const { repairUnescapedImagePaths } = require('./md-repair');

// =========================================================================
// 0. 共享常量
// =========================================================================

// Mermaid 渲染分辨率（评审 L1：统一重试/常规分辨率，避免两处不一致）
const MERMAID_WIDTH = 3600;
const MERMAID_HEIGHT = 2400;
const MERMAID_RETRY_WIDTH = 1600;
const MERMAID_RETRY_HEIGHT = 900;

// mmdc 调用统一走 exec-util.runMmdc()：用当前 node 执行 mermaid-cli 的 cli.js，
// 参数以数组传递（不经 shell）。Windows 下 node_modules/.bin/mmdc 是 .cmd shim，
// 不能直接当可执行文件调用；且字符串拼命令在路径含空格时会失败。

// =========================================================================
// 0. 进度提示工具
// =========================================================================

function logRenderProgress(type, current, total, message = '') {
  const prefix = `[${type}]`;
  const percent = Math.round((current / total) * 100);
  const line = `${prefix} 渲染进度: ${current}/${total} (${percent}%) ${message}`;
  process.stdout.write(`\r\x1b[K${line}`);
}

function logRenderDone(type, total, failed = 0) {
  if (failed > 0) {
    console.log(`\n[${type}] 渲染完成: ${total - failed}/${total} 成功, ${failed} 失败`);
  } else {
    console.log(`\n[${type}] 渲染完成: ${total}/${total} 成功`);
  }
}

function logWarnDuringRender(message) {
  process.stdout.write('\n');
  console.warn(message);
}

// =========================================================================
// 1. 剥离标题自带编号
// =========================================================================
// 多段数字 (1.2 / 1.2.3) 必定是编号; 单段数字 1-2 位 + 中文字符也视为编号
const HEADING_NUM_MULTI = /^(\d+(?:\.\d+)+)\s+/;
// 单段数字后面跟中文字符或英文字母+中文字符的组合也视为编号
// 如 "3 CSCI需求"、"1 范围" → 剥
// 但 "5G 网络"、"3D 打印"、"2026 年路线图" → 不剥
const HEADING_NUM_SINGLE = /^(\d{1,2})\s+([A-Z一-龥][A-Za-z一-龥].*)$/;

function stripHeadingNumbers(content) {
  return content.split('\n').map(line => {
    const m = line.match(/^(#{1,6})\s+(.+)$/);
    if (!m) return line;
    const hashes = m[1];
    let text = m[2];
    // 多段数字 (1.2 / 1.2.3) — 必定是编号
    if (text.match(HEADING_NUM_MULTI)) {
      text = text.replace(HEADING_NUM_MULTI, '');
      return `${hashes} ${text}`;
    }
    // 单段数字 — 只在 1-2 位且后跟中文字符时才剥
    const singleMatch = text.match(HEADING_NUM_SINGLE);
    if (singleMatch) {
      return `${hashes} ${singleMatch[2]}`;
    }
    return line;
  }).join('\n');
}

// =========================================================================
// 2. YAML front matter 修正
// =========================================================================
function fixYamlFrontMatter(raw, overrides = {}) {
  // 先去重 YAML 中的重复 key (js-yaml 不允许重复 key)
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const yamlLines = fmMatch[1].split('\n');
    const seen = new Set();
    const deduped = yamlLines.filter(line => {
      const keyMatch = line.match(/^(\w+)\s*:/);
      if (!keyMatch) return true;
      if (seen.has(keyMatch[1])) return false;
      seen.add(keyMatch[1]);
      return true;
    }).join('\n');
    raw = `---\n${deduped}\n---${raw.slice(fmMatch[0].length)}`;
  }
  const parsed = matter(raw);
  const meta = parsed.data || {};
  // 字段迁移:author → company,doc_title → title
  if (!meta.company && meta.author) {
    meta.company = meta.author;
    delete meta.author;
  }
  if (!meta.title && meta.doc_title) {
    meta.title = meta.doc_title;
    delete meta.doc_title;
  }
  // 覆盖语义（评审 M8）：表单参数优先于 YAML（真覆盖）
  if (overrides) {
    if (overrides.title !== undefined) meta.title = overrides.title;
    if (overrides.company !== undefined) meta.company = overrides.company;
    if (overrides.date !== undefined) meta.date = overrides.date;
  }
  const yamlStr = yaml.dump(meta);
  return `---\n${yamlStr}---\n\n${parsed.content}`;
}

// =========================================================================
// 3. 超深标题检查（超过 ###### 即 H6/Word标题6 不再支持）
// =========================================================================
function checkDeepHeadings(content) {
  const matches = content.split('\n')
    .map((line, i) => ({ line, i }))
    .filter(({ line }) => line.match(/^#{7,}\s+/));
  if (matches.length > 0) {
    console.warn(`[警告] 检测到 ${matches.length} 个超过6级(#######+)的标题,md2docx不支持。`);
    console.warn(`        受影响的标题:`);
    matches.forEach(({ line, i }) => console.warn(`        L${i+1}: ${line.trim()}`));
  }
  return content;
}


// =========================================================================
// 5. Mermaid 渲染
// =========================================================================

// 检测 mermaid 中可能导致渲染失败的特殊字符
function detectMermaidIssues(code) {
  const issues = [];
  const lines = code.split('\n');
  lines.forEach((line, idx) => {
    // 检测 sequenceDiagram 消息行中的特殊字符
    if (line.includes('->>') || line.includes('-->>')) {
      const msgMatch = line.match(/:\s*(.+)/);
      if (msgMatch) {
        const msg = msgMatch[1].trim();
        // 检测消息中的中文冒号
        if (msg.includes('：')) {
          issues.push({ line: idx + 1, text: line.trim(), reason: '中文冒号' });
        }
        // 检测消息中的括号（可能导致解析错误）
        if (/\(.*[：;].*\)/.test(msg)) {
          issues.push({ line: idx + 1, text: line.trim(), reason: '括号内特殊字符' });
        }
      }
    }
    // 检测 loop/alt/opt 等语句中的分号
    if (/^\s*(loop|alt|opt)\s+.*;/.test(line)) {
      issues.push({ line: idx + 1, text: line.trim(), reason: 'loop/alt/opt 语句中的分号' });
    }
    // 检测 flowchart 节点文本中的双引号
    if (/\[.*".*\]/.test(line)) {
      issues.push({ line: idx + 1, text: line.trim(), reason: 'flowchart 节点文本中的双引号' });
    }
  });
  return issues;
}

// 自动修复 mermaid 中的特殊字符
function fixMermaidCode(code) {
  return code.split('\n').map(line => {
    // sequenceDiagram 消息行
    if ((line.includes('->>') || line.includes('-->>')) && line.includes(':')) {
      const colonIdx = line.indexOf(':');
      const prefix = line.slice(0, colonIdx + 1);
      let msg = line.slice(colonIdx + 1).trim();
      // 把消息中的 ; 替换为中文 ；，避免 Mermaid 解析为分隔符
      msg = msg.replace(/;/g, '；');
      return `${prefix} ${msg}`;
    }
    // 修复 loop/alt/opt 语句中的分号
    if (/^\s*(loop|alt|opt)\s+.*;/.test(line)) {
      return line.replace(/;/g, '；');
    }
    // 修复 flowchart 节点文本中的双引号
    if (/\[.*".*\]/.test(line)) {
      return line.replace(/"/g, '');
    }
    return line;
  }).join('\n');
}

function renderMermaidBlocks(content, dirs, baseName, hooks = {}) {
  const { mermaidDir, cleanDir } = dirs;
  if (!fs.existsSync(mermaidDir)) fs.mkdirSync(mermaidDir, { recursive: true });

  // 统计 mermaid 块数量
  const mermaidMatches = content.match(/^```mermaid\s*$/gm) || [];
  const total = mermaidMatches.length;
  if (total === 0) return content;

  const report = hooks.report || console;
  report.log(`[mermaid] 发现 ${total} 个 Mermaid 图`);

  let figureIndex = 0;
  let failedCount = 0;
  const lines = content.split('\n');
  const result = [];
  let i = 0;

  while (i < lines.length) {
    if (lines[i].match(/^```mermaid\s*$/i)) {
      const mermaidStartLine = i + 1;
      const mermaidLines = [];
      i++;
      while (i < lines.length && !lines[i].match(/^```\s*$/)) {
        mermaidLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```

      figureIndex++;
      logRenderProgress('mermaid', figureIndex, total);
      if (hooks.onProgress) hooks.onProgress(figureIndex / total * 100, `渲染 Mermaid 图 ${figureIndex}/${total}`);

      let mermaidCode = mermaidLines.join('\n');

      // 注入 init 指令：neutral 主题（灰阶严谨）+ 直线连线，去除默认的彩色"AI味"
      // 用户已在代码里写 %%{init}%% 时尊重其配置，不覆盖
      const hasUserInit = /^%%\{init:/m.test(mermaidCode);
      if (!hasUserInit) {
        mermaidCode = `%%{init: {'theme': 'neutral', 'flowchart': {'curve': 'linear'}}}%%\n` + mermaidCode;
      }

      const pngName = `${baseName}_fig${figureIndex}.png`;
      const pngPath = path.join(mermaidDir, pngName);
      const mmdPath = path.join(mermaidDir, `${baseName}_fig${figureIndex}.mmd`);

      let rendered = false;
      let retryWithFix = false;
      try {
        fs.writeFileSync(mmdPath, mermaidCode);
        const cfgPath = generateConfig(mermaidDir);
        // 参数以数组传递（不经 shell）：路径含空格/中文时才不会被拆坏
        const args = [
          '-i', mmdPath,
          '-o', pngPath,
          '-b', 'white',
          '-w', String(MERMAID_WIDTH),
          '-H', String(MERMAID_HEIGHT),
        ];
        if (cfgPath) args.push('-p', cfgPath);
        runMmdc(args, { timeout: 30000, cwd: path.resolve(__dirname, '..') });
        rendered = fs.existsSync(pngPath);
      } catch (e) {
        logWarnDuringRender(`[mermaid] 渲染失败 (图${figureIndex}): ${e.message}`);
        if (hooks.onLog) hooks.onLog(`[mermaid] 渲染失败 (图${figureIndex}): ${e.message}`);
        const issues = detectMermaidIssues(mermaidCode);
        if (issues.length > 0) {
          console.warn(`  [mermaid] 检测到可能的语法问题:`);
          issues.forEach(issue => {
            const originalLine = mermaidStartLine + issue.line - 1;
            console.warn(`    原始文件第 ${originalLine} 行: ${issue.reason}`);
            console.warn(`      ${issue.text}`);
          });
          retryWithFix = true;
        }
      }

      // 如果检测到问题，询问用户是否自动修复
      if (!rendered && retryWithFix) {
        // 使用同步方式询问（因为我们在 while 循环中）
        const fixedCode = fixMermaidCode(mermaidCode);
        logWarnDuringRender(`[mermaid] 建议修复方案:`);
        // 找到有问题的行用于展示
        const originalLines = mermaidCode.split('\n');
        const fixedLines = fixedCode.split('\n');
        const issueLineIdx = originalLines.findIndex(l =>
          l.includes('->>') || l.includes('-->>') || /\[.*".*\]/.test(l)
        );
        if (issueLineIdx >= 0) {
          console.warn(`    原始: ${originalLines[issueLineIdx].trim()}`);
          console.warn(`    修复: ${fixedLines[issueLineIdx].trim()}`);
        } else {
          console.warn(`    (多行修复)`);
        }
        // 由于 Node.js 的异步限制，这里直接尝试修复而不是询问
        console.warn(`  [mermaid] 自动尝试修复并重新渲染...`);
        try {
          fs.writeFileSync(mmdPath, fixedCode);
          const cfgPath = generateConfig(mermaidDir);
          const args = [
            '-i', mmdPath,
            '-o', pngPath,
            '-b', 'white',
            '-w', String(MERMAID_RETRY_WIDTH),
            '-H', String(MERMAID_RETRY_HEIGHT),
          ];
          if (cfgPath) args.push('-p', cfgPath);
          runMmdc(args, { timeout: 30000, cwd: path.resolve(__dirname, '..') });
          rendered = fs.existsSync(pngPath);
          if (rendered) {
            console.warn(`  [mermaid] 修复成功，图${figureIndex} 已渲染`);
            if (hooks.onLog) hooks.onLog(`[mermaid] 修复成功，图${figureIndex} 已渲染`);
          }
        } catch (e2) {
          console.warn(`  [mermaid] 修复后仍失败: ${e2.message}`);
        }
      }

      if (rendered) {
        // 图片路径相对于 clean.md 输出目录
        const relPath = path.relative(cleanDir, pngPath).replace(/\\/g, '/');
        result.push(`![图 ${figureIndex}](${relPath})`);
        result.push('');
      } else {
        failedCount++;
        // 渲染失败：改为普通代码块，避免 md2docx 阶段重复尝试渲染
        result.push('```text');
        result.push(mermaidCode);
        result.push('```');
        result.push('');
      }

      // 保留 mermaid 块后方的 "图 X-X 名称" 行 (不吞掉)
      // 检查下一行是否是图注行，如果是则原样保留
      // (后续 markCaptions 会将其转为加粗)
      continue;
    }

    result.push(lines[i]);
    i++;
  }

  logRenderDone('mermaid', total, failedCount);
  return result.join('\n');
}

// =========================================================================
// 6. PlantUML 代码块 → 渲染为 PNG
// =========================================================================
function renderPlantUMLBlocks(content, dirs, baseName, hooks = {}) {
  const { pumlDir, cleanDir } = dirs;
  if (!fs.existsSync(pumlDir)) fs.mkdirSync(pumlDir, { recursive: true });

  // 统计 plantuml 块数量
  const pumlMatches = content.match(/^```plantuml\s*$/gm) || [];
  const total = pumlMatches.length;
  if (total === 0) return content;

  const report = hooks.report || console;
  report.log(`[plantuml] 发现 ${total} 个 PlantUML 图`);

  let figureIndex = 0;
  let failedCount = 0;
  const lines = content.split('\n');
  const result = [];
  let i = 0;

  while (i < lines.length) {
    if (lines[i].match(/^```plantuml\s*$/i)) {
      const pumlLines = [];
      i++;
      while (i < lines.length && !lines[i].match(/^```\s*$/)) {
        pumlLines.push(lines[i]);
        i++;
      }
      i++;  // skip closing ```

      figureIndex++;
      logRenderProgress('plantuml', figureIndex, total);
      if (hooks.onProgress) hooks.onProgress(figureIndex / total * 100, `渲染 PlantUML 图 ${figureIndex}/${total}`);

      const pumlCode = pumlLines.join('\n');

      const pngName = `${baseName}_puml${figureIndex}.png`;
      const pngPath = path.join(pumlDir, pngName);

      let rendered = false;
      try {
        const img = renderPlantUML(pumlCode, pumlDir, figureIndex);
        fs.writeFileSync(pngPath, img.buffer);
        rendered = true;
      } catch (e) {
        // 把「块内行号」换算成「原始 md 文件行号」。
        // 注意：不能基于当前 content 的 pumlStartLine 计数——本轮之前已经跑过
        // YAML 重排与 mermaid 渲染（把代码块换成图片引用），行数已发生漂移，
        // 会导致报错行号偏移、误导用户改错行。
        // 因此改用 hooks.origFenceLines（原始文件中每个 plantuml 围栏的行号，按序）
        // 取本块在原始文件中的围栏行：块内第 1 行(@startuml) = 围栏行 + 1。
        let errorMsg = e.message;
        const lineMatch = errorMsg.match(/第 (\d+) 行/);
        const origFence = hooks.origFenceLines && hooks.origFenceLines[figureIndex - 1];
        if (lineMatch && origFence) {
          const internalLine = parseInt(lineMatch[1], 10);
          const originalLine = origFence + internalLine;
          errorMsg = errorMsg.replace(/第 \d+ 行/, `原始文件第 ${originalLine} 行`);
        }
        logWarnDuringRender(`[plantuml] 渲染失败 (图${figureIndex}): ${errorMsg}`);
        if (hooks.onLog) hooks.onLog(`[plantuml] 渲染失败 (图${figureIndex}): ${errorMsg}`);
      }

      if (rendered) {
        // 图片路径相对于 clean.md 输出目录
        const relPath = path.relative(cleanDir, pngPath).replace(/\\/g, '/');
        result.push(`![](${relPath})`);
        result.push('');
      } else {
        failedCount++;
        // 渲染失败：降级为 text 代码块，避免 md2docx 阶段重复尝试渲染
        result.push('```text');
        result.push(...pumlLines);
        result.push('```');
      }
    } else {
      result.push(lines[i]);
      i++;
    }
  }

  logRenderDone('plantuml', total, failedCount);
  return result.join('\n');
}

// =========================================================================
// 7. 剥离 bullet 列表项中的手动编号前缀
// =========================================================================
// md 中 `- a) 接口优先级` 这种写法，a) 会和 Word 自动编号叠加成 "1 a)"
// 需要剥掉手动编号前缀，让 Word 自动编号接管
function stripBulletManualNumbers(content) {
  return content.split('\n').map(line => {
    // 匹配: `- a) xxx` / `- (1) xxx` / `- 1) xxx` / `- A) xxx` 等模式
    const m = line.match(/^(\s{0,6})[-*]\s+([a-zA-Z]\)|\(\d+\)|\d+\))\s+(.+)$/);
    if (m) return `${m[1]}- ${m[3]}`;
    return line;
  }).join('\n');
}

// =========================================================================
// 7.5 兼容修复：缺少分隔行的「管道表格」
// =========================================================================
// 现象：块内每行都是 `| 键 | 值 |`，但**没有** Markdown 表格必需的
//   「表头行 + 分隔行（|---|）」，于是 markdown-it 整块解析成一个普通段落，
//   输出里所有内容被挤成一行文字，完全不再是表格。
//
// 成因：这类文档多为模板批量生成的（如 GJB 438C 的八字段需求用例表），
//   生成器漏写了表头与分隔行。数据本身高度规整（实测某 1.4MB 文档 1280 个
//   此类块全部为 2 列 × 8 行、列数无一例外），因此可安全补全。
//
// 兼容策略：在该块**前面补一个空表头行 + 分隔行**，而不是把首行当表头。
//   因为这些块是「键值对」语义（需求名称/需求标识/…），若把首行提升为表头，
//   `需求名称` 会被渲染成加粗居中的表头，值反而进了表头单元格——语义反了。
//   补空表头后，md2docx 侧检测到「表头单元格全为空」即不输出表头行，
//   结果是一张纯数据的 2 列表格，与作者本意一致。
//
// 保守边界（命中任一即**不**修复，避免误改）：
//   - 代码围栏内（含图表渲染失败降级出的 ```text 块）
//   - 已有分隔行（本就是合法表格，md 表格与它无关）
//   - 不足 2 行 / 列数不一致 / 只有 1 列
//   - 块内出现转义竖线 `\|`（切分不可靠）
const LOOSE_TABLE_SEP_RE = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;

function isTableSeparator(line) {
  return LOOSE_TABLE_SEP_RE.test(line) && line.includes('-');
}

function splitPipeCells(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
}

function repairLooseTables(content) {
  const lines = content.split('\n');
  const out = [];
  let inFence = false;
  let repaired = 0;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*(```+|~~~+)/.test(line)) {
      inFence = !inFence;
      out.push(line);
      i++;
      continue;
    }
    if (inFence) {
      out.push(line);
      i++;
      continue;
    }

    // 连续的「以 | 开头且以 | 结尾」行块
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const block = [];
      let j = i;
      while (j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j])) {
        block.push(lines[j]);
        j++;
      }

      const cells = block.map(splitPipeCells);
      const colCount = cells[0] ? cells[0].length : 0;
      const uniform = cells.every(c => c.length === colCount);
      const alreadyTable = block.length >= 2 && isTableSeparator(block[1]);
      const hasEscapedPipe = block.some(l => l.includes('\\|'));

      if (!alreadyTable && !hasEscapedPipe && block.length >= 2 && uniform && colCount >= 2) {
        const emptyHeader = `|${Array.from({ length: colCount }, () => '  ').join('|')}|`;
        const separator = `|${Array.from({ length: colCount }, () => '---').join('|')}|`;
        out.push(emptyHeader, separator, ...block);
        repaired++;
      } else {
        out.push(...block);
      }
      i = j;
      continue;
    }

    out.push(line);
    i++;
  }

  return { content: out.join('\n'), repaired };
}

// =========================================================================
// 8. 题注标记: 将 md 中的 "表 X-X 名称" / "图 X-X 名称" 转为加粗
// =========================================================================
// md 中已有题注行如:
//   表 1-1 标识
//   图 3-1 安装流程图
// 需要转为:
//   **表 1-1 标识**
//   **图 3-1 安装流程图**
// 这样 md2docx.js 可以识别并格式化为题注段落

// 题注识别
// ----------
// 仅靠"图/表 + 编号"的字面模式判断会大量误判正文，例如：
//   图3显示了系统架构 / 表2中列出了参数取值 / 表 3-1 列出了主要参数
// 这些都会被字面规则吃成"题注"并被居中，属于静默破坏文档样式。
//
// 因此以**结构位置**为主判据（这也正是本项目的题注约定：图注在图下方、表注在表上方）：
//   表题注 → 向下跳过空行与其他题注行后，首个内容是表格行（`|` 开头）
//   图题注 → 向上跳过空行与其他题注行后，首个内容是图片引用（`![`）或代码块围栏
//            （围栏对应"图表渲染失败降级为代码块"的情形）
// 「跳过其他题注行」是为了支持双行题注（如 `表89 描述性标题` + `表 3-364` 编号行）。
//
// 兼容：仍保留旧的严格形式 `表 1-1 名称`（必须有空格 + 章节号）作为非相邻兜底，
//       但要求名称不以常见正文承接词开头，避免 `表 3-1 列出了主要参数` 这类误判。
//
// 需要强制指定时：手工写成 `**表 1-1 名称**` 即可（已加粗的行直接放行，
// md2docx 的 isCaptionText 会据此识别，不依赖相邻判断）。
const CAPTION_RE = /^(?:>\s*)?(表|图)\s*(\d+(?:[-.．]\d+)*)\s*(.*)$/;
const CAPTION_LEGACY_RE = /^(?:>\s*)?(表|图)\s+\d+-\d+(\s|$)/;
const CAPTION_PROSE_TAIL_RE = /[。！？；，、：]$/;
// 正文承接词：题注名称一般不会以此开头，而正文句子常以此接续编号
const CAPTION_PROSE_HEAD_RE = /^(中|所|给|如|为|是|列|说|描|显|示|该|其|由|从|在)/;
const CAPTION_MAX_LEN = 60;

function markCaptions(content) {
  const lines = content.split('\n');

  // 去掉行内 ** 与引用块前缀后再匹配：
  // 形如 `> 表 **168**名称`（编号被作者加粗）会破坏编号模式，导致漏识别；
  // 题注本身用黑体样式，行内加粗是冗余的，去掉不影响呈现。
  const normalize = (line) => line.replace(/^>\s*/, '').replace(/\*\*/g, '').trim();

  // 是否"长得像题注"（不含相邻性判断）
  const captionLike = (line) => {
    if (!line || /^\s/.test(line)) return false;
    if (line.startsWith('**') && line.endsWith('**')) return false;  // 已整体加粗 → 直接放行
    if (line.length >= CAPTION_MAX_LEN) return false;
    const m = normalize(line).match(CAPTION_RE);
    if (!m) return false;
    const name = (m[3] || '').trim();
    if (name && CAPTION_PROSE_TAIL_RE.test(name)) return false;
    return true;
  };

  const kindOf = (i) => {
    if (i < 0 || i >= lines.length) return 'eof';
    const l = lines[i].trim();
    if (!l) return 'blank';
    if (l.startsWith('|')) return 'table';
    if (l.includes('![')) return 'image';
    if (l.startsWith('```')) return 'fence';
    if (captionLike(l)) return 'caption';
    return 'text';
  };

  // 向下跳过空行与其他题注行，首个内容是否为表格。
  // 题注行最多跳 2 个（覆盖"描述行 + 编号行"的双行题注）；不设上限时，
  // 连续形似题注的正文段落会被整段跳过，导致链尾落在表格上而误判。
  const MAX_CAPTION_CHAIN = 2;
  const forwardHitsTable = (i) => {
    let j = i + 1;
    let skipped = 0;
    while (j < lines.length && kindOf(j) === 'blank') j++;
    while (j < lines.length && kindOf(j) === 'caption' && skipped < MAX_CAPTION_CHAIN) {
      skipped++;
      j++;
      while (j < lines.length && kindOf(j) === 'blank') j++;
    }
    return kindOf(j) === 'table';
  };

  // 向上跳过空行与其他题注行，首个内容是否为图片或代码块围栏
  const backwardHitsFigure = (i) => {
    let j = i - 1;
    let skipped = 0;
    while (j >= 0 && kindOf(j) === 'blank') j--;
    while (j >= 0 && kindOf(j) === 'caption' && skipped < MAX_CAPTION_CHAIN) {
      skipped++;
      j--;
      while (j >= 0 && kindOf(j) === 'blank') j--;
    }
    const k = kindOf(j);
    return k === 'image' || k === 'fence';
  };

  return lines.map((line, i) => {
    if (!captionLike(line)) return line;
    const norm = normalize(line);
    const m = norm.match(CAPTION_RE);
    const name = (m[3] || '').trim();
    const adjacent = forwardHitsTable(i) || backwardHitsFigure(i);
    const legacy = CAPTION_LEGACY_RE.test(norm) && !CAPTION_PROSE_HEAD_RE.test(name);
    if (!adjacent && !legacy) return line;
    // 输出去掉引用块前缀与行内 **（题注应为居中段落，不是引用/行内加粗样式）
    return `**${norm}**`;
  }).join('\n');
}

// =========================================================================
// 8. 可编程入口
// =========================================================================
// opts:
//   outputDir         — 输出基础目录（默认 inputDir/output）
//   cleanDir          — clean 输出目录（默认 outputDir/clean）
//   mermaidCacheDir   — mermaid 缓存目录（默认 outputDir/.mermaid）
//   plantumlCacheDir  — plantuml 缓存目录（默认 outputDir/.plantuml）
//   onProgress        — (percent, message) 渲染进度回调（0-100）
//   onLog             — (line) 日志行回调（额外，不影响 CLI 终端输出）
//   overrides         — { title, company, date } YAML 覆盖（评审 M8）
// 返回 { outputPath, cleanDir, stats: { mermaid, plantuml, failed }, warnings }
function preprocess(inputPath, opts = {}) {
  const inputDir = path.dirname(path.resolve(inputPath));
  const docName = path.basename(inputPath).replace(/\.md$/i, '');

  const baseOutputDir = opts.outputDir || path.join(inputDir, 'output');
  const cleanDir = opts.cleanDir || path.join(baseOutputDir, 'clean');
  const mermaidCacheDir = opts.mermaidCacheDir || path.join(baseOutputDir, '.mermaid');
  const plantumlCacheDir = opts.plantumlCacheDir || path.join(baseOutputDir, '.plantuml');

  const outputPath = path.join(cleanDir, `${docName}.clean.md`);

  if (!fs.existsSync(inputPath)) {
    throw new Error(`输入文件不存在: ${inputPath}`);
  }

  const baseName = path.basename(inputPath, '.md').replace(/[^a-zA-Z0-9一-鿿]/g, '_');
  const warnings = [];

  const report = opts.report || console;
  report.log(`[preprocess] 输入: ${inputPath}`);

  let raw = fs.readFileSync(inputPath, 'utf-8');

  // 统一换行符为 LF + 剥离 BOM（必须在任何行级正则之前）。
  // 陷阱 1：Windows 文档是 CRLF，而 JS 正则中 `.` 不匹配 `\r`（属行终止符），
  //   未带 m 标志的 `...$` 会因行尾残留 `\r` 而失配，导致题注标记、标题编号
  //   剥离、列表编号剥离等行级规则**静默失效**（不报错，只是没生效）。
  // 陷阱 2：Windows 记事本「UTF-8」另存会写 BOM。行首的 U+FEFF 会让
  //   `^---\n`（YAML 去重的前置判断）不匹配，于是"去重复 key"的保险被跳过，
  //   随后 gray-matter 对重复 title 直接报 `duplicated mapping key` 而失败。
  raw = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');

  // 记录原始文件中每个 plantuml 围栏的行号（按出现顺序，1-based）。
  // 后续变换（YAML 重排、mermaid 渲染）会改变行数，报错行号必须据此换算回原文，
  // 否则用户会按漂移后的行号去改错行。见 renderPlantUMLBlocks 的错误分支。
  const origFenceLines = [...raw.matchAll(/^```plantuml\s*$/gm)]
    .map(m => raw.slice(0, m.index).split('\n').length);

  raw = fixYamlFrontMatter(raw, opts.overrides);
  report.log('[preprocess] 1. YAML front matter 已修正');
  if (opts.onProgress) opts.onProgress(10, '修正 YAML front matter');

  raw = stripHeadingNumbers(raw);
  report.log('[preprocess] 2. 标题自带编号已剥离');
  if (opts.onProgress) opts.onProgress(20, '剥离标题编号');

  raw = checkDeepHeadings(raw);

  // 兼容修复：图片路径含裸空格时补 <>（必须在渲染之前——
  // 渲染阶段会写入自己的 PNG 引用，不应被本步扫描）。
  // CommonMark 规定目标里裸空格必须用 <> 或 %20，否则整段不被解析为图片，
  // 会以纯文本形式印进成品文档（Windows 文件名常含空格，见下方函数注释）。
  const spaceFix = repairUnescapedImagePaths(raw);
  raw = spaceFix.content;
  if (spaceFix.repaired > 0) {
    report.log(`[preprocess] 2.5 修复含空格的图片引用: ${spaceFix.repaired} 处`);
    if (opts.onLog) opts.onLog(`[preprocess] 修复含空格的图片引用: ${spaceFix.repaired} 处`);
  }

  const hooks = { report, onProgress: opts.onProgress, onLog: opts.onLog, origFenceLines };
  const dirs = { mermaidDir: mermaidCacheDir, pumlDir: plantumlCacheDir, cleanDir };

  raw = renderMermaidBlocks(raw, dirs, baseName, hooks);
  report.log('[preprocess] 3. Mermaid 图表已渲染');
  if (opts.onProgress) opts.onProgress(50, '渲染 Mermaid 图表');

  raw = renderPlantUMLBlocks(raw, dirs, baseName, hooks);
  report.log('[preprocess] 4. PlantUML 图表已渲染');
  if (opts.onProgress) opts.onProgress(70, '渲染 PlantUML 图表');

  raw = stripBulletManualNumbers(raw);
  report.log('[preprocess] 5. 列表手动编号已剥离');
  if (opts.onProgress) opts.onProgress(85, '剥离列表编号');

  // 兼容修复：补全缺分隔行的管道表格（必须在 markCaptions 之前——
  // 表题注的判定依赖「向下首个内容是表格行」，修好表格才能正确定位题注）
  const loose = repairLooseTables(raw);
  raw = loose.content;
  if (loose.repaired > 0) {
    report.log(`[preprocess] 5.5 补全缺分隔行的表格: ${loose.repaired} 个`);
    if (opts.onLog) opts.onLog(`[preprocess] 补全缺分隔行的表格: ${loose.repaired} 个`);
  }

  raw = markCaptions(raw);
  report.log('[preprocess] 6. 题注已标记为加粗');
  if (opts.onProgress) opts.onProgress(95, '标记题注');

  raw = raw.replace(/\n{4,}/g, '\n\n\n');

  if (!fs.existsSync(cleanDir)) fs.mkdirSync(cleanDir, { recursive: true });

  fs.writeFileSync(outputPath, raw, 'utf-8');
  report.log(`[preprocess] 输出: ${outputPath}`);
  if (opts.onProgress) opts.onProgress(100, '预处理完成');

  return { outputPath, cleanDir, warnings };
}

// =========================================================================
// 9. CLI 入口
// =========================================================================
function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('用法: node preprocess.js <input.md> [output.md]');
    process.exit(1);
  }

  const inputPath = args[0];
  const inputDir = path.dirname(path.resolve(inputPath));
  const docName = path.basename(inputPath).replace(/\.md$/i, '');
  const defaultOutput = path.join(inputDir, 'output', 'clean', `${docName}.clean.md`);
  const outputPath = args[1] || defaultOutput;

  try {
    const result = preprocess(inputPath, {});
    if (args[1] && result.outputPath !== outputPath) {
      // CLI 显式指定 output 时，把文件移动到指定位置
      fs.copyFileSync(result.outputPath, outputPath);
    }
  } catch (e) {
    console.error(`错误: ${e.message}`);
    process.exit(1);
  }
}

// 仅作为 CLI 直接执行时运行 main（HTTP 服务 require 本文件不触发）
if (require.main === module) {
  main();
}

module.exports = { preprocess };
