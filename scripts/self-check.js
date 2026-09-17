#!/usr/bin/env node
/**
 * self-check.js — 离线包自检（在目标机上运行，一键出报告）
 *
 * 目的：本包在 Linux 上构建，无法预知 Windows 实际行为。与其让用户
 * 遇到问题时描述现象，不如让他双击一次就把环境与渲染能力全部验完，
 * 直接得到可回传的报告。
 *
 * 覆盖（每项独立判定，失败不中断，最后汇总）：
 *   1. 运行环境：Node 版本、平台、路径可写性、是否处于中文/含空格路径
 *   2. 浏览器：能否探测到浏览器（内置 chrome-headless-shell 或系统 Chrome/Edge）
 *   3. PlantUML：core 后端渲染**含中文**的图 —— 中文是否变方块的关键验证
 *   4. mermaid：渲染含中文的流程图
 *   5. 端到端：跑一次完整转换，校验 DOCX 结构（图片/表格/题注）
 *
 * 用法：
 *   node scripts/self-check.js            # 交互式查看
 *   node scripts/self-check.js --report   # 额外写出 self-check-report.txt
 *
 * 退出码：0 全部通过；1 存在失败项。
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const WANT_REPORT = process.argv.includes('--report');
// 构建机可能没有浏览器（纯 CI 容器）。带此标志时把「无浏览器」降级为
// 跳过并计为注意项，而非失败——否则构建会因环境缺浏览器而中断。
const ALLOW_NO_BROWSER = process.argv.includes('--allow-no-browser');
const ROOT = path.resolve(__dirname, '..');
const lines = [];
let failures = 0;
let warnings = 0;

function out(s = '') { console.log(s); lines.push(s); }
function pass(name, detail = '') { out(`  [通过] ${name}${detail ? '  — ' + detail : ''}`); }
function fail(name, detail = '') { failures++; out(`  [失败] ${name}${detail ? '  — ' + detail : ''}`); }
function warn(name, detail = '') { warnings++; out(`  [注意] ${name}${detail ? '  — ' + detail : ''}`); }
function section(t) { out(''); out(`=== ${t} ===`); }

function safe(fn, name) {
  try { return fn(); } catch (e) { fail(name, (e && e.message) || String(e)); return null; }
}

// ---------------------------------------------------------------- 1. 运行环境
function checkEnv() {
  section('1. 运行环境');
  pass('Node', `${process.version}（${process.platform}/${process.arch}）`);
  out(`         可执行文件: ${process.execPath}`);

  const hasNonAscii = /[^\x00-\x7F]/.test(ROOT);
  const hasSpace = /\s/.test(ROOT);
  if (hasNonAscii || hasSpace) {
    // 不是错误，但要显式确认——路径含中文/空格是本包特意支持并测过的场景
    out(`         安装路径含${hasNonAscii ? '中文' : ''}${hasNonAscii && hasSpace ? '与' : ''}${hasSpace ? '空格' : ''}（本包已支持，继续验证）`);
  } else {
    out('         安装路径为纯 ASCII 无空格');
  }

  // 写权限：作业目录与转换产物都要写盘
  const probe = path.join(ROOT, '.selfcheck-write-probe');
  try {
    fs.writeFileSync(probe, 'ok', 'utf8');
    fs.rmSync(probe, { force: true });
    pass('安装目录可写');
  } catch (e) {
    fail('安装目录可写', e.message);
  }

  const tmp = os.tmpdir();
  try {
    const t = path.join(tmp, '.selfcheck-probe');
    fs.writeFileSync(t, 'ok', 'utf8');
    fs.rmSync(t, { force: true });
    pass('临时目录可写', tmp);
  } catch (e) {
    fail('临时目录可写', `${tmp} — ${e.message}`);
  }
}

// ---------------------------------------------------------------- 2. 浏览器
function checkBrowser() {
  section('2. 浏览器（mermaid 与 PlantUML core 后端都依赖它）');
  const cfg = safe(() => require('./puppeteer-config'), '加载 puppeteer-config');
  if (!cfg) return null;
  const chrome = safe(() => cfg.findChrome(), '探测浏览器');
  if (!chrome) {
    const msg = '未找到 Chrome/Chromium/Edge；可用 PUPPETEER_EXECUTABLE_PATH 显式指定';
    if (ALLOW_NO_BROWSER) warn('探测浏览器', msg + '（已允许跳过）');
    else fail('探测浏览器', msg);
    return null;
  }
  pass('探测到浏览器', chrome);
  if (!fs.existsSync(chrome)) fail('浏览器文件存在', chrome);
  else pass('浏览器文件存在');
  return chrome;
}

// ---------------------------------------------------------------- 3/4. 渲染
function renderDiagram(kind, code, workDir) {
  const { renderPlantUML } = require('./plantuml-renderer');
  if (kind === 'plantuml') {
    const r = renderPlantUML(code, workDir, 1);
    return { width: r.width, height: r.height, backend: r.backend };
  }
  return null;
}

function checkPlantUML(chrome) {
  section('3. PlantUML 渲染（含中文）—— 中文变方块是本包最高风险项');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'selfcheck-puml-'));
  try {
    const code = [
      '@startuml',
      'component "数据接收与处理" as A',
      'component "完整性校验" as B',
      'A --> B : 配置下发',
      '@enduml',
    ].join('\n');
    const r = safe(() => renderDiagram('plantuml', code, work), 'PlantUML 渲染');
    if (!r) return;
    pass('渲染成功', `${r.width}x${r.height} 像素，后端=${r.backend || '未知'}`);

    // 校验产出文件确实是 PNG 且非空白（空白图往往意味着字体缺失）
    const png = path.join(work, 'p_1.png');
    if (!fs.existsSync(png)) { fail('产出 PNG 文件'); return; }
    const buf = fs.readFileSync(png);
    if (!(buf[0] === 0x89 && buf[1] === 0x50)) { fail('PNG 文件签名合法'); return; }
    pass('PNG 文件签名合法', `${(buf.length / 1024).toFixed(1)}KB`);

    // 内容非空判定：PNG 太小通常说明渲染成了空白或纯色
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    if (w < 40 || h < 40) warn('图像尺寸偏小', `${w}x${h}，可能未正常渲染内容`);
    else pass('图像尺寸正常');
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

function checkMermaid(chrome) {
  section('4. mermaid 渲染（含中文）');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'selfcheck-mmdc-'));
  try {
    const { runMmdc } = require('./exec-util');
    const { generateConfig } = require('./puppeteer-config');
    const mmd = path.join(work, 't.mmd');
    const png = path.join(work, 't.png');
    fs.writeFileSync(mmd, 'graph TD\n    A[开始处理] --> B{判断条件}\n    B -->|是| C[结束]\n', 'utf8');
    const args = ['-i', mmd, '-o', png, '-b', 'white', '-w', '1200', '-H', '800'];
    const cfg = generateConfig(work);
    if (cfg) args.push('-p', cfg);
    const r = safe(() => runMmdc(args, { timeout: 180000 }), 'mermaid 渲染');
    if (r === null) return;
    if (!fs.existsSync(png)) { fail('产出 PNG 文件'); return; }
    const buf = fs.readFileSync(png);
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    pass('渲染成功', `${w}x${h} 像素，${(buf.length / 1024).toFixed(1)}KB`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- 5. 端到端
function checkEndToEnd() {
  section('5. 端到端转换（mermaid + PlantUML + 表格 + 题注 + 含空格图片名）');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'selfcheck-e2e-'));
  const imgDir = path.join(work, 'assets');
  fs.mkdirSync(imgDir, { recursive: true });

  // 造一张 1x1 PNG 作为"作者自带图片"，文件名含空格（Windows 高发场景）
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64');
  fs.writeFileSync(path.join(imgDir, '我的 图片.png'), png);

  const md = path.join(work, 'check.md');
  fs.writeFileSync(md, [
    '---', 'title: 离线包自检文档', 'company: 自检', 'date: 2026年9月', '---', '',
    '# 离线包自检文档', '',
    '## 流程图', '',
    '```mermaid', 'graph TD', '    A[开始] --> B[结束]', '```', '',
    '## 时序图', '',
    '```plantuml', '@startuml', '客户端 -> 服务端: 请求', '服务端 --> 客户端: 响应', '@enduml', '```', '',
    '## 键值表', '',
    '| 需求名称 | 加载本地基础影像数据 |',
    '| 需求标识 | GMS-JD-ZCCX-010 |', '',
    '**表 1-1 需求信息**', '',
    '## 含空格的图片名', '',
    '![架构图](assets/我的 图片.png)', '',
  ].join('\n'), 'utf8');

  try {
    const { preprocess } = require('./preprocess');
    // 目录结构必须符合项目约定 <base>/output/clean/：
    // convert() 依据「clean 目录是否以 output/clean 结尾」推导 srcDir
    // （作者图片的解析基准），自检若用自定义结构会让作者图片解析不到。
    const outBase = path.join(work, 'output');
    const pre = safe(() => preprocess(md, {
      outputDir: outBase,
      cleanDir: path.join(outBase, 'clean'),
      mermaidCacheDir: path.join(outBase, '.mermaid'),
      plantumlCacheDir: path.join(outBase, '.plantuml'),
      report: { log() {}, warn() {}, error() {} },
    }), '预处理');
    if (!pre) return;

    const docx = path.join(outBase, 'docx', 'out.docx');
    // convert 是异步的，而本脚本整体是同步风格：用子进程执行并等待，
    // 既避免顶层 async 改造，也顺带验证「真正的 CLI 调用路径」可用。
    const { execFileSync } = require('child_process');
    execFileSync(process.execPath, ['-e', `
      const { convert } = require(${JSON.stringify(path.join(ROOT, 'scripts', 'md2docx.js'))});
      convert(${JSON.stringify(pre.outputPath)}, { outputPath: ${JSON.stringify(docx)},
        report: { log(){}, warn(){}, error(){} } })
        .then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
    `], { stdio: 'pipe', timeout: 300000, cwd: ROOT });

    if (!fs.existsSync(docx)) { fail('产出 DOCX'); return; }
    const AdmZip = require('adm-zip');
    const xml = new AdmZip(docx).readAsText('word/document.xml');
    const drawings = (xml.match(/<w:drawing>/g) || []).length;
    const tables = (xml.match(/<w:tbl>/g) || []).length;
    const leftover = /!\[/.test(xml);

    out(`         图片 ${drawings} 张，表格 ${tables} 个，DOCX ${(fs.statSync(docx).size / 1024).toFixed(1)}KB`);
    if (drawings < 3) fail('图片嵌入', `期望 ≥3（mermaid + PlantUML + 作者图片），实得 ${drawings}`);
    else pass('图片嵌入', `${drawings} 张`);
    if (tables < 1) fail('表格生成', `期望 ≥1（无分隔行的键值表应被修复），实得 ${tables}`);
    else pass('表格生成', `${tables} 个`);
    if (leftover) fail('无残留 Markdown 源码', '正文里出现了 "![" 字面文本');
    else pass('无残留 Markdown 源码');
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- 主流程
function main() {
  out('md2docx 离线包自检');
  out('='.repeat(52));
  out(`时间: ${new Date().toISOString()}`);
  out(`安装目录: ${ROOT}`);

  checkEnv();
  const chrome = checkBrowser();
  if (chrome) {
    checkPlantUML(chrome);
    checkMermaid(chrome);
  } else {
    warn('跳过渲染类检查', '未找到浏览器');
  }
  checkEndToEnd();

  section('汇总');
  if (failures === 0 && warnings === 0) {
    out('  全部通过。这个包在本机可正常使用。');
  } else if (failures === 0) {
    out(`  通过，但有 ${warnings} 项注意（通常不影响使用，可回传此报告确认）。`);
    if (ALLOW_NO_BROWSER) out('  （本次带 --allow-no-browser，渲染类检查可能被跳过）');
  } else {
    out(`  存在 ${failures} 项失败、${warnings} 项注意。`);
    out('  请把本报告完整回传，以便定位。');
  }
  out('');
  out('提示：图内中文若显示为方块，属最高风险项，请打开产出文档目视确认。');

  if (WANT_REPORT) {
    // 写到**当前工作目录**而非安装目录：
    //   · 构建期由 build-windows-bundle.js 调用，cwd 是临时目录 → 随临时目录清理
    //   · 目标机上由「自检.cmd」调用，脚本内 cd 到安装目录 → 报告就在用户手边
    const p = path.join(process.cwd(), 'self-check-report.txt');
    try {
      fs.writeFileSync(p, lines.join('\r\n') + '\r\n', 'utf8');
      console.log('');
      console.log(`报告已写入: ${p}`);
    } catch (e) {
      console.error(`写入报告失败: ${e.message}`);
    }
  }

  process.exit(failures === 0 ? 0 : 1);
}

main();
