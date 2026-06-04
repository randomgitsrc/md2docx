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
 * 用法:
 *   node preprocess.js <input.md> [output.md]
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const readline = require('readline');
const matter = require('gray-matter');
const yaml = require('js-yaml');
const { generateConfig } = require('./puppeteer-config');
const { renderPlantUML } = require('./plantuml-renderer');

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
function fixYamlFrontMatter(raw) {
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

// 交互式询问用户
function askUser(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

function renderMermaidBlocks(content, inputDir, baseName) {
  const mermaidDir = path.join(inputDir, 'output', '.mermaid');
  if (!fs.existsSync(mermaidDir)) fs.mkdirSync(mermaidDir, { recursive: true });

  // 统计 mermaid 块数量
  const mermaidMatches = content.match(/^```mermaid\s*$/gm) || [];
  const total = mermaidMatches.length;
  if (total === 0) return content;

  console.log(`[mermaid] 发现 ${total} 个 Mermaid 图`);

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

      let mermaidCode = mermaidLines.join('\n');

      // 注入 init 指令：使用直线连线，去除"AI味"
      const hasUserInit = /^%%\{init:/m.test(mermaidCode);
      if (!hasUserInit) {
        mermaidCode = `%%{init: {'flowchart': {'curve': 'linear'}}}%%\n` + mermaidCode;
      }

      const pngName = `${baseName}_fig${figureIndex}.png`;
      const pngPath = path.join(mermaidDir, pngName);
      const mmdPath = path.join(mermaidDir, `${baseName}_fig${figureIndex}.mmd`);

      let rendered = false;
      let retryWithFix = false;
      try {
        fs.writeFileSync(mmdPath, mermaidCode);
        const cfgPath = generateConfig(mermaidDir);
        const cfgArg = cfgPath ? `-p ${cfgPath}` : '';
        // 从 md2docx 项目目录执行 npx，确保能找到 mermaid-cli 依赖
        const mmdcDir = path.resolve(__dirname, '..');
        execSync(
          `npx mmdc -i "${mmdPath}" -o "${pngPath}" -b white -w 3600 -H 2400 ${cfgArg}`,
          { stdio: 'pipe', timeout: 30000, cwd: mmdcDir }
        );
        rendered = fs.existsSync(pngPath);
      } catch (e) {
        logWarnDuringRender(`[mermaid] 渲染失败 (图${figureIndex}): ${e.message}`);
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
          const cfgArg = cfgPath ? `-p ${cfgPath}` : '';
          const mmdcDir = path.resolve(__dirname, '..');
          execSync(
            `npx mmdc -i "${mmdPath}" -o "${pngPath}" -b white -w 1600 -H 900 ${cfgArg}`,
            { stdio: 'pipe', timeout: 30000, cwd: mmdcDir }
          );
          rendered = fs.existsSync(pngPath);
          if (rendered) {
            console.warn(`  [mermaid] 修复成功，图${figureIndex} 已渲染`);
          }
        } catch (e2) {
          console.warn(`  [mermaid] 修复后仍失败: ${e2.message}`);
        }
      }

      if (rendered) {
        // 图片路径相对于 clean.md 输出目录
        const cleanDir = path.join(inputDir, 'output', 'clean');
        const relPath = path.relative(cleanDir, pngPath);
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
function renderPlantUMLBlocks(content, inputDir, baseName) {
  const pumlDir = path.join(inputDir, 'output', '.plantuml');
  if (!fs.existsSync(pumlDir)) fs.mkdirSync(pumlDir, { recursive: true });

  // 统计 plantuml 块数量
  const pumlMatches = content.match(/^```plantuml\s*$/gm) || [];
  const total = pumlMatches.length;
  if (total === 0) return content;

  console.log(`[plantuml] 发现 ${total} 个 PlantUML 图`);

  let figureIndex = 0;
  let failedCount = 0;
  const lines = content.split('\n');
  const result = [];
  let i = 0;

  while (i < lines.length) {
    if (lines[i].match(/^```plantuml\s*$/i)) {
      const pumlStartLine = i + 1; // 记录 plantuml 代码块在原始文件中的起始行号（1-based）
      const pumlLines = [];
      i++;
      while (i < lines.length && !lines[i].match(/^```\s*$/)) {
        pumlLines.push(lines[i]);
        i++;
      }
      i++;  // skip closing ```

      figureIndex++;
      logRenderProgress('plantuml', figureIndex, total);

      const pumlCode = pumlLines.join('\n');

      const pngName = `${baseName}_puml${figureIndex}.png`;
      const pngPath = path.join(pumlDir, pngName);

      let rendered = false;
      try {
        const img = renderPlantUML(pumlCode, pumlDir, figureIndex);
        fs.writeFileSync(pngPath, img.buffer);
        rendered = true;
      } catch (e) {
        // 解析错误信息，提取内部行号并转换为原始文件行号
        let errorMsg = e.message;
        const lineMatch = errorMsg.match(/第 (\d+) 行/);
        if (lineMatch) {
          const internalLine = parseInt(lineMatch[1], 10);
          const originalLine = pumlStartLine + internalLine - 1;
          errorMsg = errorMsg.replace(/第 \d+ 行/, `原始文件第 ${originalLine} 行`);
        }
        logWarnDuringRender(`[plantuml] 渲染失败 (图${figureIndex}): ${errorMsg}`);
      }

      if (rendered) {
        // 图片路径相对于 clean.md 输出目录
        const cleanDir = path.join(inputDir, 'output', 'clean');
        const relPath = path.relative(cleanDir, pngPath).replace(/\\/g, '/');
        result.push(`![](${relPath})`);
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
// 7. 题注标记: 将 md 中的 "表 X-X 名称" / "图 X-X 名称" 转为加粗
// =========================================================================
// md 中已有题注行如:
//   表 1-1 标识
//   图 3-1 安装流程图
// 需要转为:
//   **表 1-1 标识**
//   **图 3-1 安装流程图**
// 这样 md2docx.js 可以识别并格式化为题注段落

const CAPTION_RE = /^(表|图)\s+(\d+-\d+)\s+(.+)$/;
// 也匹配无名称的题注: "表 1-1" 或 "图 3-1"
const CAPTION_NUM_ONLY_RE = /^(表|图)\s+(\d+-\d+)$/;

function markCaptions(content) {
  return content.split('\n').map(line => {
    const m = line.match(CAPTION_RE);
    if (m) {
      // 已是加粗则跳过
      if (line.startsWith('**') && line.endsWith('**')) return line;
      return `**${m[1]} ${m[2]} ${m[3]}**`;
    }
    const m2 = line.match(CAPTION_NUM_ONLY_RE);
    if (m2) {
      if (line.startsWith('**') && line.endsWith('**')) return line;
      return `**${m2[1]} ${m2[2]}**`;
    }
    return line;
  }).join('\n');
}

// =========================================================================
// 主流程
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

  if (!fs.existsSync(inputPath)) {
    console.error(`输入文件不存在: ${inputPath}`);
    process.exit(1);
  }

  const baseName = path.basename(inputPath, '.md').replace(/[^a-zA-Z0-9一-鿿]/g, '_');

  console.log(`[preprocess] 输入: ${inputPath}`);

  let raw = fs.readFileSync(inputPath, 'utf-8');

  raw = fixYamlFrontMatter(raw);
  console.log('[preprocess] 1. YAML front matter 已修正');

  raw = stripHeadingNumbers(raw);
  console.log('[preprocess] 2. 标题自带编号已剥离');

  raw = checkDeepHeadings(raw);

  raw = renderMermaidBlocks(raw, inputDir, baseName);
  console.log('[preprocess] 3. Mermaid 图表已渲染');

  raw = renderPlantUMLBlocks(raw, inputDir, baseName);
  console.log('[preprocess] 4. PlantUML 图表已渲染');

  raw = stripBulletManualNumbers(raw);
  console.log('[preprocess] 5. 列表手动编号已剥离');

  raw = markCaptions(raw);
  console.log('[preprocess] 6. 题注已标记为加粗');

  raw = raw.replace(/\n{4,}/g, '\n\n\n');

  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  fs.writeFileSync(outputPath, raw, 'utf-8');
  console.log(`[preprocess] 输出: ${outputPath}`);
}

main();
