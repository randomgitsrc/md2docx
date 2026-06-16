/**
 * PlantUML 渲染器 — 供 preprocess.js 和 md2docx.js 共同引用
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// A4 内容区宽度(px)，与 md2docx.js 保持一致
const CONTENT_WIDTH_PX = Math.round((21 - 2.7 - 2.7) * 96 / 2.54);

// =========================================================================
// 0. Graphviz 检测
// =========================================================================

let graphvizChecked = false;
let hasGraphviz = false;

function checkGraphviz() {
  if (graphvizChecked) return hasGraphviz;
  try {
    execSync('dot -V', { stdio: 'pipe' });
    hasGraphviz = true;
  } catch {
    hasGraphviz = false;
    console.warn('\n╔════════════════════════════════════════════════════╗');
    console.warn('║  [plantuml] 警告：未检测到 Graphviz                ║');
    console.warn('║  部分图类型可能无法渲染，请安装：                   ║');
    console.warn('║  sudo apt-get install graphviz                    ║');
    console.warn('╚════════════════════════════════════════════════════╝');
  }
  graphvizChecked = true;
  return hasGraphviz;
}

// =========================================================================
// 1. 查找可用的 PlantUML
// =========================================================================

function findPlantUML() {
  // 1. 系统 PATH 中有 plantuml 命令（apt 安装或用户手动安装）
  try {
    execSync('plantuml -version', { stdio: 'pipe' });
    return { type: 'command', cmd: 'plantuml' };
  } catch {}

  // 2. 项目 bin/ 目录下有 plantuml.jar
  const jarPath = path.resolve(__dirname, '../bin/plantuml.jar');
  if (fs.existsSync(jarPath)) {
    return { type: 'jar', jar: jarPath };
  }

  return null;  // 未找到，调用方决定是否下载
}

// =========================================================================
// 2. 自动下载 plantuml.jar
// =========================================================================

function downloadPlantUML() {
  const binDir  = path.resolve(__dirname, '../bin');
  const jarPath = path.join(binDir, 'plantuml.jar');
  fs.mkdirSync(binDir, { recursive: true });

  // Use v1.2023.0 which supports Java 8 (class file version 52)
  // Latest versions require Java 11+ (class file version 55+)
  const url = 'https://github.com/plantuml/plantuml/releases/download/v1.2023.0/plantuml.jar';
  console.log('[plantuml] 首次使用，正在下载 plantuml.jar (v1.2023.0, 兼容 Java 8)...');
  execSync(`curl -L -o "${jarPath}" "${url}"`, { stdio: 'inherit' });
  console.log('[plantuml] 下载完成');
  return { type: 'jar', jar: jarPath };
}

// =========================================================================
// 3. 自动修复 PlantUML 语法 + 中文字体注入
// =========================================================================

// 修复同一 if 块内多个 else 的问题：
// PlantUML 要求多分支用 elseif，但标准 UML 活动图允许多个 else
// 规则：如果 if 块内有多个 else，则把所有 else 都转为 elseif
//   else (起降模拟)  →  elseif (起降模拟) then (是)
function fixMultiElse(code) {
  const lines = code.split('\n');
  let fixed = false;

  // 第一遍：标记哪些 if 块有多 else
  const stack = [];
  const multiElseIfs = new Set();
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    if (trimmed.match(/^if\s*\(/)) stack.push({ elseCount: 0, ifLine: i });
    if (trimmed.match(/^else\b/) && stack.length > 0) {
      stack[stack.length - 1].elseCount++;
      if (stack[stack.length - 1].elseCount > 1) {
        multiElseIfs.add(stack[stack.length - 1].ifLine);
      }
    }
    if (trimmed.match(/^endif/)) stack.pop();
  }

  // 第二遍：对多 else 的 if 块，把所有 else 转为 elseif
  const stack2 = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    const indent = lines[i].slice(0, lines[i].length - trimmed.length);
    if (trimmed.match(/^if\s*\(/)) stack2.push({ ifLine: i });
    if (trimmed.match(/^else\b/) && stack2.length > 0) {
      if (multiElseIfs.has(stack2[stack2.length - 1].ifLine)) {
        const m = trimmed.match(/^else\s*\((.+?)\)\s*$/);
        if (m) {
          lines[i] = `${indent}elseif (${m[1]}) then (是)`;
          fixed = true;
        }
      }
    }
    if (trimmed.match(/^endif/)) stack2.pop();
  }

  return fixed ? lines.join('\n') : null;
}

// 检测系统可用中文字体，返回 PlantUML 可用的字体名
let cachedChineseFont = null;
function findChineseFont() {
  if (cachedChineseFont !== null) return cachedChineseFont;
  try {
    const output = execSync('fc-list :lang=zh', { stdio: 'pipe', encoding: 'utf8' });
    const fonts = output.split('\n');
    // 优先顺序：Noto Sans SC > WenQuanYi Zen Hei > SimSun > 其他
    for (const line of fonts) {
      if (line.includes('Noto Sans SC')) { cachedChineseFont = 'Noto Sans SC'; return cachedChineseFont; }
      if (line.includes('WenQuanYi Zen Hei')) { cachedChineseFont = 'WenQuanYi Zen Hei'; return cachedChineseFont; }
      if (line.includes('SimSun') || line.includes('宋体')) { cachedChineseFont = 'SimSun'; return cachedChineseFont; }
      if (line.includes('Microsoft YaHei') || line.includes('微软雅黑')) { cachedChineseFont = 'Microsoft YaHei'; return cachedChineseFont; }
      if (line.includes('DengXian') || line.includes('等线')) { cachedChineseFont = 'DengXian'; return cachedChineseFont; }
    }
    cachedChineseFont = '';
    return cachedChineseFont;
  } catch {
    cachedChineseFont = '';
    return cachedChineseFont;
  }
}

// 注入中文字体配置到 PlantUML 代码中
function injectChineseFont(code) {
  const font = findChineseFont();
  if (!font) return code;
  // 如果已有 font 相关配置，跳过
  if (/skinparam\s+(defaultFontName|FontName)/i.test(code)) return code;
  // 在 @startuml 后插入字体配置（放在 !theme 之后，避免被主题覆盖）
  const fontLine = `skinparam defaultFontName "${font}"`;
  // 如果代码中有 !theme plain，把字体配置放在它后面
  const themeMatch = code.match(/^(!theme\s+\w+)$/m);
  if (themeMatch) {
    return code.replace(themeMatch[0], `${themeMatch[0]}\n${fontLine}`);
  }
  // 否则放在 @startuml 后面
  return code.replace(/^(@startuml)/m, `$1\n${fontLine}`);
}

// =========================================================================
// 4. 组装渲染命令
// =========================================================================

function buildCommand(puml, inFile, outDir) {
  // 优先使用 Java 11+ 运行 PlantUML，回退到系统默认 java
  let javaCmd = 'java';
  for (const j of ['/usr/lib/jvm/java-21-openjdk-amd64/bin/java', '/usr/lib/jvm/java-17-openjdk-amd64/bin/java', '/usr/lib/jvm/java-11-openjdk-amd64/bin/java']) {
    if (fs.existsSync(j)) { javaCmd = j; break; }
  }
  if (puml.type === 'command') {
    return `plantuml -tpng -o "${outDir}" "${inFile}"`;
  }
  // jar 方式：优先使用 Java 11+
  return `${javaCmd} -jar "${puml.jar}" -tpng -o "${outDir}" "${inFile}"`;
}

// =========================================================================
// 5. 构建渲染错误信息
// =========================================================================

function buildRenderError(e, code) {
  const stderr = e.stderr?.toString() || e.message || '';
  const lineMatch = stderr.match(/Error line (\d+) in file:/);
  const lineNum = lineMatch ? lineMatch[1] : null;

  let context = '';
  if (lineNum) {
    const lines = code.split('\n');
    const idx = parseInt(lineNum, 10) - 1;
    if (idx >= 0 && idx < lines.length) {
      context = `\n  错误位置（第 ${lineNum} 行）: ${lines[idx].trim()}`;
    }
  }

  let errorMsg = 'PlantUML 渲染失败';
  if (lineNum) {
    errorMsg += `（第 ${lineNum} 行）`;
  }
  errorMsg += context;
  errorMsg += `\n  原始错误: ${stderr.split('\n')[0]}`;

  return new Error(errorMsg);
}

// =========================================================================
// 6. 渲染 PlantUML 源码 → PNG
// =========================================================================

function renderPlantUML(code, tmpDir, index) {
  // 0. 检测 Graphviz
  checkGraphviz();

  // 1. 确保有可用的 plantuml
  let puml = findPlantUML();
  if (!puml) {
    downloadPlantUML();
    puml = findPlantUML();
    if (!puml) throw new Error('plantuml 不可用，且自动下载失败');
  }

  // 2. 注入中文字体 + 写源文件（保留源文件便于调试）
  const inFile  = path.join(tmpDir, `p_${index}.puml`);
  const outFile = path.join(tmpDir, `p_${index}.png`);
  const codeWithFont = injectChineseFont(code);
  fs.writeFileSync(inFile, codeWithFont, 'utf8');

  // 3. 执行渲染
  const cmd = buildCommand(puml, inFile, tmpDir);
  try {
    execSync(cmd, { stdio: 'pipe', timeout: 30000 });
  } catch (e) {
    // 渲染失败：尝试自动修复多 else 语法问题（基于原始代码，再注入字体）
    const fixedCode = fixMultiElse(code);
    if (fixedCode) {
      const fixedWithFont = injectChineseFont(fixedCode);
      fs.writeFileSync(inFile, fixedWithFont, 'utf8');
      try {
        execSync(cmd, { stdio: 'pipe', timeout: 30000 });
        console.warn(`[plantuml] 图${index}: 自动修复多 else 语法后渲染成功`);
      } catch (e2) {
        // 修复后仍失败，用修复后的代码报告错误
        throw buildRenderError(e2, fixedWithFont);
      }
    } else {
      throw buildRenderError(e, code);
    }
  }

  if (!fs.existsSync(outFile)) {
    throw new Error(`plantuml 渲染无输出: ${outFile}`);
  }

  // 4. 读取 PNG 尺寸
  const buffer = fs.readFileSync(outFile);
  const width  = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);

  // 5. 横置判断：基于渲染后图片实际尺寸（统一与 appendImageParagraph 一致）
  const downscaleRatio = width / CONTENT_WIDTH_PX;
  const aspectRatio = width / height;
  const needsLandscape = downscaleRatio > 3 && aspectRatio > 2.0;

  return { buffer, width, height, needsLandscape };
}

module.exports = { findPlantUML, downloadPlantUML, buildCommand, renderPlantUML };
