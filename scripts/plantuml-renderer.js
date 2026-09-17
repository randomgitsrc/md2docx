/**
 * PlantUML 渲染器 — 供 preprocess.js 和 md2docx.js 共同引用
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { downloadFileSync, runFile } = require('./exec-util');

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
  // 1. 系统 PATH 中有 plantuml 命令（apt 安装 / Windows 原生 exe）
  //    Windows 的 CreateProcess 会自动补 .exe，故无需显式后缀
  if (runFile('plantuml', ['-version'], { allowFailure: true }).ok) {
    return { type: 'command' };
  }

  // 2. 项目 bin/ 下的原生可执行文件（Windows 打包用，免 Java）
  //    对应官方 native-plantuml-windows-amd64-<ver>.zip 解压出的可执行文件
  const nativeNames = process.platform === 'win32'
    ? ['plantuml.exe', 'native-plantuml.exe']
    : ['plantuml', 'native-plantuml'];
  for (const n of nativeNames) {
    const p = path.resolve(__dirname, '../bin', n);
    if (fs.existsSync(p)) return { type: 'command', exe: p };
  }

  // 3. 项目 bin/ 目录下有 plantuml.jar（需 Java）
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

  // 版本与 scripts/md2docx.sh、bin/plantuml.jar 保持一致
  const url = 'https://github.com/plantuml/plantuml/releases/download/v1.2025.2/plantuml.jar';
  console.log('[plantuml] 首次使用，正在下载 plantuml.jar (v1.2025.2)...');
  // 用 Node 内置 https 下载，不依赖系统 curl（Windows 无 curl）
  downloadFileSync(url, jarPath);
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

// 活动图关键字/指令行：原样保留，绝不包裹成 :...;
const ACTIVITY_KEYWORD_RE = /^(?:@\w+|!|'|start|stop|end|if|else|elseif|endif|while|endwhile|repeat|backward|fork|split|kill|detach|partition|note|endnote|legend|header|footer|title|caption|skinparam|skin|hide|show|scale|left|right|top|bottom|style|together|swimlane|group|alt|opt|loop|par|break|critical)(?:\s|\(|$)/i;
// 块内出现这些关键字才认定是活动图
const ACTIVITY_HINT_RE = /^\s*(?:start|stop|if\s*\(|while\s*\(|repeat)\b/m;

/**
 * 修复「旧式活动图」写法：活动名裸写一行（没有 :...; 包裹）。
 *
 * 新版 PlantUML（1.2025+，core 与 jar 后端均已实测）对下面这种写法直接报
 * `Syntax Error? (Assumed diagram type: activity)`：
 *
 *   @startuml
 *   start
 *   接收外部输入或操作指令     ← 裸写，非法
 *   stop
 *   @enduml
 *
 * 官方新语法要求 `:接收外部输入或操作指令;`；官方 legacy 语法也不支持裸写
 * （legacy 用 `(*)` + 带引号的名称）。因此这是**源文件写法过时**，
 * 但批量文档里很常见，这里按兼容处理。
 *
 * 安全性：与 fixMultiElse / fixUnquotedNames 一样，**只在渲染失败后**作为补救尝试，
 * 成功才采用，因此不可能影响本来就能正常渲染的图。另外仅当块内确有活动图关键字
 * （start / stop / if( / while( / repeat）时才介入，避免误伤用例图、类图里
 * 合法的裸标识符行。
 */
function fixBareActivityNames(code) {
  if (!ACTIVITY_HINT_RE.test(code)) return null;  // 不是活动图，不介入

  let changed = false;
  const lines = code.split('\n').map(line => {
    const t = line.trim();
    if (!t) return line;
    if (t.startsWith(':')) return line;              // 已是新语法
    if (t.startsWith('|')) return line;              // 泳道定义
    if (ACTIVITY_KEYWORD_RE.test(t)) return line;    // 关键字/指令行
    if (/->|\.\.>|==/.test(t)) return line;          // 箭头/连接线
    // 含 ASCII 特殊字符时不冒险（可能破坏语义）
    if (/[:;"'{}\[\]<>=@#$%^&*~`\\]/.test(t)) return line;
    // 必须以中文、字母或数字开头，排除剩余符号行
    if (!/^[\u4e00-\u9fa5A-Za-z0-9]/.test(t)) return line;
    changed = true;
    return `:${t};`;
  });

  return changed ? lines.join('\n') : null;
}

// 自动补全缺失的结束标记。
// 常见手写遗漏：写了 @startuml 但漏掉 @enduml。PlantUML 对这类不完整块
// 只在 stderr 提示 "No diagram found"、退出码仍为 0、且不产出任何文件，
// 结果是整块降级为代码块且用户无从定位。这里直接按 @start<type> 补 @end<type>。
// @returns {{ code: string, fixed: string|null }}
function ensureEndMarker(code) {
  const m = code.match(/@start(\w+)/);
  if (!m) return { code, fixed: null };
  const type = m[1];
  // 已有对应结束标记（或任意 @endxxx）则不处理
  if (new RegExp(`@end${type}\\b`).test(code)) return { code, fixed: null };
  return { code: `${code.replace(/\s*$/, '')}\n@end${type}\n`, fixed: `@end${type}` };
}

// 自动为「名称含特殊字符但未加引号」的组件/节点名补引号。
// 名称里的 - ( ) / 等字符不加引号会被 PlantUML 当作运算符/表达式解析而渲染失败：
//   `c3 as 服务进程通信(消息队列)`  → `c3 as "服务进程通信(消息队列)"`
//   `c7 as 无效值/保留位处理`      → `c7 as "无效值/保留位处理"`
//   `sjwz --> GMS-DM-BWJC : 告警`  → `sjwz --> "GMS-DM-BWJC" : 告警`
// 仅在渲染失败后作为补救尝试，成功才采用，因此不影响本来正常的图。
// @returns {string|null} 修复后的代码；无需修复时返回 null
function fixUnquotedNames(code) {
  const NEEDS_QUOTE = /[-()/]/;
  // 判断某 token 是否为箭头（全部由运算符字符组成且含 < > =）
  const isArrow = (t) => /^[<>=.|*o-]{2,}$/.test(t) && /[<>=]/.test(t);
  const quoteTok = (t) => {
    if (!t || /^".*"$/.test(t) || !NEEDS_QUOTE.test(t)) return null;
    return `"${t}"`;
  };

  let changed = false;
  const lines = code.split('\n').map(line => {
    // 形式 A：`别名 as 名称`（如 c3 as 服务进程通信(消息队列)）
    let m = line.match(/^(\s*)(\S+)(\s+as\s+)(.+?)(\s*)$/i);
    if (m) {
      const q = quoteTok(m[4]);
      if (q) { changed = true; return `${m[1]}${m[2]}${m[3]}${q}${m[5]}`; }
      return line;
    }
    // 形式 B：`关键字 名称 as 别名`（如 component GMS-DM-BWJC as x）
    m = line.match(/^(\s*)([A-Za-z]\w*)(\s+)(\S+)(\s+as\s+)(\S+)(\s*)$/);
    if (m) {
      const q = quoteTok(m[4]);
      if (q) { changed = true; return `${m[1]}${m[2]}${m[3]}${q}${m[5]}${m[6]}${m[7]}`; }
      return line;
    }
    // 形式 C：`左 箭头 右 [: 标签]`（如 sjwz --> GMS-DM-BWJC : 告警）
    m = line.match(/^(\s*)(\S+)(\s+)(\S+)(\s+)(\S+)((?:\s*:.*)?)(\s*)$/);
    if (m && isArrow(m[4])) {
      const ql = quoteTok(m[2]);
      const qr = quoteTok(m[6]);
      if (ql || qr) {
        changed = true;
        return `${m[1]}${ql || m[2]}${m[3]}${m[4]}${m[5]}${qr || m[6]}${m[7]}${m[8]}`;
      }
    }
    return line;
  });
  return changed ? lines.join('\n') : null;
}

// 检测系统可用中文字体，返回 PlantUML 可用的字体名
// Windows 没有 fc-list，必须走平台分支；否则注入不到中文字体，
// PlantUML 渲染出的图里中文会变成方块。
let cachedChineseFont = null;
function findChineseFont() {
  if (cachedChineseFont !== null) return cachedChineseFont;

  const WINDIR = process.env.WINDIR || 'C:\\Windows';
  const winFonts = [
    // [字体名, 字体文件]  按优先级排列
    ['Microsoft YaHei', 'msyh.ttc'],
    ['Microsoft YaHei', 'msyh.ttf'],
    ['SimSun', 'simsun.ttc'],
    ['DengXian', 'Deng.ttf'],
    ['SimHei', 'simhei.ttf'],
    ['KaiTi', 'simkai.ttf'],
  ];
  const tryWindowsFonts = () => {
    for (const [name, file] of winFonts) {
      if (fs.existsSync(path.join(WINDIR, 'Fonts', file))) {
        cachedChineseFont = name;
        return true;
      }
    }
    return false;
  };

  if (process.platform === 'win32') {
    if (tryWindowsFonts()) return cachedChineseFont;
    cachedChineseFont = '';
    return cachedChineseFont;
  }

  // Linux / macOS：用 fc-list
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
    // 没有 fc-list（或执行失败）时，兜底尝试 Windows 字体目录
    if (tryWindowsFonts()) return cachedChineseFont;
    cachedChineseFont = '';
    return cachedChineseFont;
  }
}

// 注入简洁主题：plain（黑白灰线框，技术文档风格），去除默认的蓝黄彩色
// 用户已在代码里写 !theme 时尊重其配置，不覆盖
function injectTheme(code) {
  if (/^!theme\s+\w+/m.test(code)) return code;
  return code.replace(/^(@startuml)/m, `$1\n!theme plain`);
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

/**
 * 组装 PlantUML 渲染命令，返回 { cmd, args }。
 * 用参数数组而非命令字符串：Windows 路径含空格/中文时字符串拼命令会被拆坏，
 * 且 Windows 下 java/plantuml 需要 .exe 后缀。
 */
function buildCommand(puml, inFile, outDir) {
  const args = ['-tpng', '-o', outDir, inFile];

  if (puml.type === 'command') {
    // 系统 PATH 中的 plantuml（apt / 手动安装 / Windows 原生 exe）
    const exe = process.platform === 'win32' ? 'plantuml.exe' : 'plantuml';
    return { cmd: puml.exe || exe, args };
  }

  // jar 方式：优先用已知的 Java 11+ 路径，回退系统 java
  let javaCmd = process.platform === 'win32' ? 'java.exe' : 'java';
  const javaHomes = [
    process.env.JAVA_HOME && path.join(process.env.JAVA_HOME, 'bin', 'java'),
    '/usr/lib/jvm/java-21-openjdk-amd64/bin/java',
    '/usr/lib/jvm/java-17-openjdk-amd64/bin/java',
    '/usr/lib/jvm/java-11-openjdk-amd64/bin/java',
  ].filter(Boolean);
  for (const j of javaHomes) {
    if (fs.existsSync(j)) { javaCmd = j; break; }
  }
  return { cmd: javaCmd, args: ['-jar', puml.jar, ...args] };
}

// =========================================================================
// 5. 构建渲染错误信息
// =========================================================================

function buildRenderError(e, code, injectedLineOffset = 0) {
  const stderr = e.stderr?.toString() || e.message || '';
  const lineMatch = stderr.match(/Error line (\d+) in file:/);
  const reportedLine = lineMatch ? parseInt(lineMatch[1], 10) : null;

  let context = '';
  let lineNum = reportedLine;
  if (reportedLine) {
    // PlantUML 报的是「注入后文件」的行号，而注入会在 @startuml 后插入
    // !theme / skinparam 行，必须减去偏移才能对应到用户原始块的行号，
    // 否则会指向错误的位置、误导用户改错行。
    const rawLine = Math.max(1, reportedLine - injectedLineOffset);
    lineNum = rawLine;
    const lines = code.split('\n');
    const idx = rawLine - 1;
    if (idx >= 0 && idx < lines.length) {
      // 行号只在这里之外出现一次（标题中），便于上层替换成"原始文件第 N 行"
      context = `\n  错误位置: ${lines[idx].trim()}`;
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
// 6. 渲染后端选择
// =========================================================================
// - core：@plantuml/core（TeaVM 版，免 Java / 免 graphviz，纯 npm 依赖）
// - jar ：java -jar plantuml.jar（原有方式，需 Java + graphviz）
// 环境变量 PLANTUML_BACKEND=core|jar 可强制指定；默认 auto（优先 core，不可用则 jar）。
function resolveBackend(puml) {
  const want = (process.env.PLANTUML_BACKEND || 'auto').toLowerCase();
  if (want === 'jar') return 'jar';
  if (want === 'core') return 'core';

  // auto：core 可用就用 core（离线包与 Windows 场景下更省事）
  try {
    const { isCoreAvailable } = require('./plantuml-core-renderer');
    if (isCoreAvailable()) return 'core';
  } catch (_) { /* 未安装则回退 */ }
  return puml ? 'jar' : 'core';
}

// =========================================================================
// 7. 渲染 PlantUML 源码 → PNG
// =========================================================================

function renderPlantUML(code, tmpDir, index) {
  // 自动补全缺失的结束标记（常见：有 @startuml 无 @enduml）
  const closed = ensureEndMarker(code);
  if (closed.fixed) {
    console.warn(`[plantuml] 图${index}: 缺少结束标记 ${closed.fixed}，已自动补全`);
  }
  const baseCode = closed.code;

  const puml = findPlantUML();
  const backend = resolveBackend(puml);

  // jar 后端才需要 graphviz（core 自带 WASM 版 Graphviz）
  if (backend === 'jar') {
    checkGraphviz();
    if (!puml) {
      downloadPlantUML();
      if (!findPlantUML()) throw new Error('plantuml 不可用，且自动下载失败');
    }
  }

  const inFile  = path.join(tmpDir, `p_${index}.puml`);
  const outFile = path.join(tmpDir, `p_${index}.png`);
  let renderStderr = '';

  // 渲染一段代码（两后端统一入口）：成功则以产物为准
  const renderWith = (srcCode) => {
    const codeWithFont = injectChineseFont(injectTheme(srcCode));
    // 【关键】渲染前必须删掉可能存在的同名旧产物。
    // 缓存目录是持久的，而 PlantUML 在"块内无 @startuml"等情况下的行为是
    // **exit code 0 且不写任何文件**（stderr 仅提示 No diagram found）。
    // 若不先删旧文件，靠 fs.existsSync(outFile) 判断成功就会把
    // **上一份文档的 PNG** 当成本次结果，静默产出内容错误的文档。
    fs.rmSync(outFile, { force: true });
    fs.writeFileSync(inFile, codeWithFont, 'utf8');

    if (backend === 'core') {
      const { renderPlantUMLCore } = require('./plantuml-core-renderer');
      renderPlantUMLCore(codeWithFont, tmpDir, index);
    } else {
      const { cmd, args } = buildCommand(findPlantUML(), inFile, tmpDir);
      const res = runFile(cmd, args, { timeout: 30000 });
      if (res.stdout) renderStderr = res.stdout;
    }
    // 不能只看退出码：PlantUML 可能 exit 0 却不写文件
    if (!fs.existsSync(outFile)) {
      throw new Error(`渲染未产出图像${renderStderr ? `: ${renderStderr.split('\n')[0]}` : ''}`);
    }
    return codeWithFont;
  };

  let rendered = false;
  let firstError = null;
  try {
    renderWith(baseCode);
    rendered = true;
  } catch (e) {
    firstError = e;
    // 渲染失败：依次尝试已知的自动修复（均基于原始代码，再注入主题字体）。
    // 只在失败后作为补救，成功才采用，因此不会影响本来正常的图。
    const candidates = [
      { label: '多 else 语法', code: fixMultiElse(baseCode) },
      { label: '名称加引号',   code: fixUnquotedNames(baseCode) },
      { label: '旧式活动图裸写活动名', code: fixBareActivityNames(baseCode) },
    ];
    let lastFailure = null;
    for (const c of candidates) {
      if (!c.code) continue;
      try {
        const used = renderWith(c.code);
        console.warn(`[plantuml] 图${index}: 自动修复（${c.label}）后渲染成功`);
        rendered = true;
        break;
      } catch (e2) {
        lastFailure = {
          err: e2,
          code: c.code,
          offset: injectChineseFont(injectTheme(c.code)).split('\n').length - c.code.split('\n').length,
        };
      }
    }
    if (!rendered) {
      if (lastFailure) throw buildRenderError(lastFailure.err, lastFailure.code, lastFailure.offset);
      throw buildRenderError(e, baseCode, injectChineseFont(injectTheme(baseCode)).split('\n').length - baseCode.split('\n').length);
    }
  }

  if (!fs.existsSync(outFile)) {
    const hint = /no diagram found|no image/i.test(renderStderr)
      ? '未找到完整图，通常是块内缺少 @enduml 等结束标记'
      : 'PlantUML 未生成图像（请检查图语法是否完整）';
    throw new Error(`plantuml 渲染无输出: ${outFile} — ${hint}`);
  }

  // 读取 PNG 尺寸
  const buffer = fs.readFileSync(outFile);
  const width  = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);

  // 横置判断：基于渲染后图片实际尺寸（统一与 appendImageParagraph 一致）
  const downscaleRatio = width / CONTENT_WIDTH_PX;
  const aspectRatio = width / height;
  const needsLandscape = downscaleRatio > 3 && aspectRatio > 2.0;

  return { buffer, width, height, needsLandscape, backend };
}

module.exports = { findPlantUML, downloadPlantUML, buildCommand, renderPlantUML };
