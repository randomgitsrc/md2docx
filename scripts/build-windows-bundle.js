#!/usr/bin/env node
/**
 * build-windows-bundle.js — 组装 Windows 完全离线包
 *
 * 在**有网机器**上运行一次，产出可在**完全离线**的 Windows 机器上直接使用的包：
 *   dist/md2docx-win-x64/          ← 免安装目录（解压即用）
 *   dist/md2docx-win-x64.zip       ← 便于拷贝分发
 *
 * 包内自带全部运行时，目标机无需预装 Node / Java / Python / graphviz / Chrome：
 *   - 便携 node.exe（Windows 版）
 *   - node_modules（win32 定向安装 + 裁剪冗余）
 *   - chrome-headless-shell（win64，用于 mermaid 与 PlantUML 渲染）
 *   - @plantuml/core（纯 JS，自带 WASM 版 Graphviz）
 *
 * 用法:
 *   node scripts/build-windows-bundle.js [--out dir] [--skip-chromium] [--keep-temp]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const https = require('https');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const opt = (name) => args.includes(name);
const optVal = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const OUT_DIR = path.resolve(optVal('--out', path.join(ROOT, 'dist')));
const BUNDLE_NAME = 'md2docx-win-x64';
const BUNDLE_DIR = path.join(OUT_DIR, BUNDLE_NAME);
const SKIP_CHROMIUM = opt('--skip-chromium');
const MAKE_INSTALLER = opt('--installer');   // 额外产出 Windows 一键安装器（EXE）
const ALLOW_DIRTY = opt('--allow-dirty');  // 允许在脏工作区构建（不推荐用于分发）
const TEMP = path.join(os.tmpdir(), `md2docx-bundle-${Date.now()}`);
const KEEP_TEMP = opt('--keep-temp');

function log(msg) { console.log(`[bundle] ${msg}`); }
function fail(msg) { console.error(`[bundle] 错误: ${msg}`); process.exit(1); }

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const go = (u, n) => {
      // 按协议选模块：Ubuntu 归档的 .deb 是 http 地址，
      // 之前只用 https 会报 'Protocol "http:" not supported'。
      const mod = u.startsWith('http:') ? http : https;
      mod.get(u, { timeout: 300000 }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (n <= 0) return reject(new Error('重定向过多'));
          return go(new URL(res.headers.location, u).toString(), n - 1);
        }
        if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}: ${u}`)); }
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        const tmp = dest + '.part';
        const out = fs.createWriteStream(tmp);
        let bytes = 0;
        res.on('data', (c) => { bytes += c.length; });
        res.pipe(out);
        out.on('finish', () => out.close(() => {
          fs.renameSync(tmp, dest);
          log(`  下载完成 ${path.basename(dest)} (${(bytes / 1048576).toFixed(1)}MB)`);
          resolve(dest);
        }));
        out.on('error', reject);
      }).on('error', reject).on('timeout', function () { this.destroy(new Error('下载超时')); });
    };
    go(url, 6);
  });
}

/** 用 adm-zip 解压（不依赖系统 unzip/7z） */
function unzip(zipPath, destDir) {
  const AdmZip = require(path.join(ROOT, 'node_modules', 'adm-zip'));
  fs.mkdirSync(destDir, { recursive: true });
  new AdmZip(zipPath).extractAllTo(destDir, true);
}

/** 递归统计体积与文件数 */
function dirStats(dir) {
  let bytes = 0, files = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) { bytes += fs.statSync(p).size; files++; }
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return { bytes, files };
}

function human(bytes) { return `${(bytes / 1048576).toFixed(1)}MB`; }

/**
 * 构建戳：写入包内，便于区分包的新旧。
 * 起因：曾用旧包排查新代码的 bug，白费一轮——包里带的是构建时的代码快照。
 */
function buildStamp() {
  let git = 'nogit';
  try {
    git = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim();
    if (dirty) git += '-dirty';
  } catch (_) { /* 非 git 环境 */ }
  return { git, time: new Date().toISOString() };
}

async function main() {
  log(`输出目录: ${OUT_DIR}`);
  // 先固定构建戳、再校验工作区：两者必须来自同一时点。
  // 此前 buildStamp() 在组装后才调用，若期间工作区变脏（或构建中改了文件），
  // 戳会显示 -dirty 却已通过开头的干净检查，二者自相矛盾。
  const stamp = buildStamp();
  assertCleanTree(stamp);
  fs.mkdirSync(TEMP, { recursive: true });

  // ---------------------------------------------------------------- 1. 便携 Node
  log('步骤 1/6：下载 Windows 便携 Node');
  const nodeIdx = await new Promise((resolve, reject) => {
    https.get('https://nodejs.org/dist/index.json', { timeout: 60000 }, (res) => {
      let s = ''; res.on('data', (c) => s += c);
      res.on('end', () => { try { resolve(JSON.parse(s)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
  // 取最新的 22.x（与 Docker 方案保持一致的 LTS 线）
  const nodeRel = nodeIdx.find((x) => x.version.startsWith('v22.') && x.files.includes('win-x64-zip'));
  if (!nodeRel) fail('未找到 Node 22 win-x64 zip');
  const nodeVer = nodeRel.version;
  log(`  选用 Node ${nodeVer} (LTS: ${nodeRel.lts})`);
  const nodeZip = path.join(TEMP, `node-${nodeVer}-win-x64.zip`);
  await download(`https://nodejs.org/dist/${nodeVer}/node-${nodeVer}-win-x64.zip`, nodeZip);

  // ---------------------------------------------------------------- 2. win32 node_modules
  log('步骤 2/6：安装 win32 定向依赖（npm ci --os=win32 --cpu=x64）');
  const depStage = path.join(TEMP, 'deps');
  fs.mkdirSync(depStage, { recursive: true });
  for (const f of ['package.json', 'package-lock.json']) {
    fs.copyFileSync(path.join(ROOT, f), path.join(depStage, f));
  }
  execFileSync('npm', ['ci', '--omit=dev', '--os=win32', '--cpu=x64', '--no-audit', '--no-fund'], {
    cwd: depStage,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PUPPETEER_SKIP_DOWNLOAD: 'true', npm_config_cache: path.join(TEMP, 'npmcache') },
    timeout: 900000,
  });
  log(`  依赖安装完成: ${fs.readdirSync(path.join(depStage, 'node_modules')).length} 个顶层条目`);

  // ---------------------------------------------------------------- 3. 裁剪冗余
  log('步骤 3/6：裁剪冗余文件（source map / 类型声明 / 文档），删后仍会验证渲染');
  const before = dirStats(path.join(depStage, 'node_modules'));
  const prune = (dir, patterns) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== '.bin') prune(p, patterns); }
      else if (e.isFile() && patterns.some((re) => re.test(e.name))) {
        try { fs.unlinkSync(p); } catch (_) { /* ignore */ }
      }
    }
  };
  prune(path.join(depStage, 'node_modules'), [
    /\.map$/, /\.d\.ts$/, /\.d\.mts$/, /\.ts$/, /\.md$/, /\.markdown$/,
  ]);

  // 只裁「已验证对我们用不到的图类型才需要」的原生包。
  // 注意：不要删 elkjs / @mermaid-js/layout-elk / @mermaid-js/mermaid-zenuml——
  // mermaid-cli 启动时会 resolve 它们（源码 index.js 顶部），属声明依赖；
  // 虽然实测本工具的图不触发，但删掉会在 layout:elk / zenuml 图类型下失败，
  // 为省 ~17MB 不值得冒这个险。
  // @napi-rs/* 是各平台原生图形库，仅被 @zenuml/core 依赖；已实测移除后
  // mermaid 渲染正常（见下方"渲染自检"）。只保留 win32-x64-msvc 以防运行时探测。
  const napiDir = path.join(depStage, 'node_modules', '@napi-rs');
  if (fs.existsSync(napiDir)) {
    const keep = 'canvas-win32-x64-msvc';
    let total = 0;
    for (const sub of fs.readdirSync(napiDir)) {
      if (sub === keep) continue;
      const p = path.join(napiDir, sub);
      total += dirStats(p).bytes;
      fs.rmSync(p, { recursive: true, force: true });
    }
    fs.rmSync(path.join(napiDir, 'canvas'), { recursive: true, force: true });
    if (fs.readdirSync(napiDir).length === 0) fs.rmSync(napiDir, { recursive: true, force: true });
    log(`  移除非 win32 原生包: 省 ${human(total)}`);
  }

  const after = dirStats(path.join(depStage, 'node_modules'));
  log(`  裁剪: ${human(before.bytes)} → ${human(after.bytes)}（省 ${human(before.bytes - after.bytes)}）`);

  // ---------------------------------------------------------------- 4. Chromium
  let chromeDir = null;
  if (!SKIP_CHROMIUM) {
    log('步骤 4/6：下载 chrome-headless-shell (win64)');
    const cft = await new Promise((resolve, reject) => {
      https.get('https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json',
        { timeout: 60000 }, (res) => {
          let s = ''; res.on('data', (c) => s += c);
          res.on('end', () => { try { resolve(JSON.parse(s)); } catch (e) { reject(e); } });
        }).on('error', reject);
    });
    const stable = cft.channels.Stable;
    const asset = stable.downloads['chrome-headless-shell'].find((x) => x.platform === 'win64');
    if (!asset) fail('未找到 win64 chrome-headless-shell');
    log(`  Chrome for Testing ${stable.version}`);
    const chromeZip = path.join(TEMP, 'chrome-win64.zip');
    await download(asset.url, chromeZip);
    chromeDir = path.join(TEMP, 'chrome');
    unzip(chromeZip, chromeDir);

    // 剪掉多余语言包：Chrome 自带 220 个 .pak（~43MB），本工具界面为中文，
    // 只保留 zh-CN / en-US 即可（Chromium 缺语言包时回退 en-US，不影响渲染）。
    const localeDir = path.join(chromeDir, fs.readdirSync(chromeDir)[0], 'locales');
    if (fs.existsSync(localeDir)) {
      const keepRe = /^(zh-CN|zh-TW|en-US|en-GB)\.pak$/;
      let removed = 0;
      for (const f of fs.readdirSync(localeDir)) {
        if (keepRe.test(f)) continue;
        try { fs.unlinkSync(path.join(localeDir, f)); removed++; } catch (_) { /* ignore */ }
      }
      log(`  裁剪语言包: 移除 ${removed} 个，保留 zh-CN/zh-TW/en-US/en-GB`);
    }
  } else {
    log('步骤 4/6：跳过 Chromium（--skip-chromium，目标机需自带 Chrome/Edge）');
  }

  // ---------------------------------------------------------------- 5. 组装
  log('步骤 5/6：组装目录');
  fs.rmSync(BUNDLE_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUNDLE_DIR, { recursive: true });

  // 便携 node
  unzip(nodeZip, path.join(BUNDLE_DIR, '_node'));
  const nodeExtract = fs.readdirSync(path.join(BUNDLE_DIR, '_node'))[0];
  const nodeInner = path.join(BUNDLE_DIR, '_node', nodeExtract);
  for (const f of ['node.exe']) {
    fs.copyFileSync(path.join(nodeInner, f), path.join(BUNDLE_DIR, f));
  }
  fs.rmSync(path.join(BUNDLE_DIR, '_node'), { recursive: true, force: true });

  // 依赖
  fs.cpSync(path.join(depStage, 'node_modules'), path.join(BUNDLE_DIR, 'node_modules'), { recursive: true });

  // 应用代码（只拷运行必需）
  for (const item of ['scripts', 'server', 'bin', 'package.json']) {
    const src = path.join(ROOT, item);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(BUNDLE_DIR, item), { recursive: true });
  }
  fs.rmSync(path.join(BUNDLE_DIR, 'bin', 'plantuml.jar'), { force: true });  // core 后端不需要

  // Chromium
  if (chromeDir) {
    const inner = path.join(chromeDir, fs.readdirSync(chromeDir)[0]);
    fs.cpSync(inner, path.join(BUNDLE_DIR, 'chrome-headless-shell'), { recursive: true });
  }

  // 启动脚本 + 说明
  fs.writeFileSync(path.join(BUNDLE_DIR, '启动 md2docx.cmd'), [
    '@echo off',
    'chcp 65001 >nul',
    'setlocal',
    'cd /d "%~dp0"',
    'set "MD2DOCX_HOME=%~dp0"',
    'rem 不强制 DATA_DIR：交给 server/config.js 自动选择——优先安装目录下 data/，',
    'rem 若安装目录只读（如放入 Program Files）会自动回退到 %LOCALAPPDATA%\\md2docx',
    'set "PLANTUML_BACKEND=core"',
    'if exist "%~dp0chrome-headless-shell\\chrome-headless-shell.exe" set "PUPPETEER_EXECUTABLE_PATH=%~dp0chrome-headless-shell\\chrome-headless-shell.exe"',
    'set "MD2DOCX_OPEN_BROWSER=1"',
    'echo 正在启动 md2docx 服务...',
    '"%~dp0node.exe" "%~dp0server\\app.js"',
    'if errorlevel 1 pause',
    'endlocal',
  ].join('\r\n') + '\r\n', 'utf8');

  fs.writeFileSync(path.join(BUNDLE_DIR, '转换文档.cmd'), [
    '@echo off',
    'chcp 65001 >nul',
    'setlocal',
    'cd /d "%~dp0"',
    'set "PLANTUML_BACKEND=core"',
    'if exist "%~dp0chrome-headless-shell\\chrome-headless-shell.exe" set "PUPPETEER_EXECUTABLE_PATH=%~dp0chrome-headless-shell\\chrome-headless-shell.exe"',
    'if "%~1"=="" ( echo 用法: 把 .md 文件拖到本脚本上，或 转换文档.cmd "路径\\文件.md" & pause & exit /b 1 )',
    '"%~dp0node.exe" "%~dp0scripts\\cli.js" %*',
    'if errorlevel 1 pause',
    'endlocal',
  ].join('\r\n') + '\r\n', 'utf8');

  fs.writeFileSync(path.join(BUNDLE_DIR, '使用说明.txt'), [
    'md2docx Windows 离线版',
    '=====================',
    '',
    '免安装：整个目录拷到目标机即可用，无需联网、无需预装任何运行时',
    '（Node/Java/Python/graphviz/Chrome 均已内置）。',
    '',
    '【启动网页服务】',
    '  双击  启动 md2docx.cmd',
    '  浏览器会自动打开；若被拦截，手动访问窗口里显示的地址（默认 http://127.0.0.1:8080）。',
    '  关闭：直接关掉那个命令行窗口。',
    '',
    '【批量转换（命令行）】',
    '  转换文档.cmd "C:\\路径\\文档.md"',
    '  或把 .md 文件直接拖到  转换文档.cmd  上。',
    '  产物在该 md 同级的 output/docx/ 下。',
    '',
    '【数据位置】',
    '  服务上传产生的作业文件在  本目录\\data\\  下，可随时整体删除。',
    '',
    '【遇到问题先自检】',
    '  双击  自检.cmd  —— 会逐项检查环境/浏览器/两种图表渲染/端到端转换，',
    '  并把结果写到本目录的 self-check-report.txt。请把该文件回传以便定位。',
    '',
    '【不污染系统】',
    '  不改 PATH、不写全局注册表、不安装任何系统组件；删除本目录即完全卸载。',
    '',
    `构建信息：Node ${nodeVer}${chromeDir ? ' / 内置 chrome-headless-shell' : ' / 使用系统 Chrome 或 Edge'}`,
  ].join('\r\n') + '\r\n', 'utf8');

  // 构建戳已在 main 开头固定（与干净检查同一时点）
  fs.writeFileSync(path.join(BUNDLE_DIR, 'BUILD-INFO.txt'), [
    `构建时间: ${stamp.time}`,
    `代码版本: ${stamp.git}`,
    `Node: ${nodeVer}`,
    `浏览器: ${chromeDir ? '内置 chrome-headless-shell' : '未内置（用系统 Chrome/Edge）'}`,
    `PlantUML: @plantuml/core（core 后端，免 Java/graphviz）`,
    '',
    '注：本目录代码是构建时的快照；改了源码需重新运行 build-windows-bundle.js。',
  ].join('\r\n') + '\r\n', 'utf8');

  // 放入目标机自检入口（双击即出报告，便于回传定位问题）
  addSelfCheckEntry(BUNDLE_DIR);

  // ---- 打包前闸门：先证明这个包是对的，再打包 ----
  verifyBundleCode(BUNDLE_DIR);
  smokeTestBundle(BUNDLE_DIR);

  // ---------------------------------------------------------------- 6. 打包 zip
  log('步骤 6/6：打包 zip');
  const AdmZip = require(path.join(ROOT, 'node_modules', 'adm-zip'));
  const zip = new AdmZip();
  // 手工递归加入，保证解压后顶层就是 BUNDLE_NAME 目录
  const addDir = (dir, base) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      const rel = `${base}/${e.name}`;
      if (e.isDirectory()) addDir(p, rel);
      else zip.addFile(rel, fs.readFileSync(p));
    }
  };
  addDir(BUNDLE_DIR, BUNDLE_NAME);
  const zipPath = path.join(OUT_DIR, `${BUNDLE_NAME}.zip`);
  zip.writeZip(zipPath);

  const stats = dirStats(BUNDLE_DIR);
  const zipSize = fs.statSync(zipPath).size;

  // 可选：一键安装器（EXE）
  let installer = null;
  if (MAKE_INSTALLER) {
    installer = await buildInstaller(BUNDLE_DIR, `${BUNDLE_NAME}.zip`, stamp, nodeVer);
  }
  log('');
  log('=== 完成 ===');
  log(`  目录: ${BUNDLE_DIR}  (${human(stats.bytes)}, ${stats.files} 个文件)`);
  log(`  压缩: ${zipPath}  (${human(zipSize)})`);
  if (installer) log(`  安装器: ${installer.path}  (${human(installer.size)})`);
  log(`  代码版本: ${stamp.git} @ ${stamp.time}`);
  log(`  目标机：解压 → 双击「启动 md2docx.cmd」→ 浏览器自动打开`);
  log(`  排障用：目标机双击「自检.cmd」可产出可回传的自检报告`);


/**
 * 构建前：确认代码状态可追溯。
 * 分发包必须能对应到确定版本——曾出现"包内是旧提交的代码"导致
 * 排查方向被误导（见 BUILD-INFO.txt 的引入原因），故默认拒绝脏工作区。
 */
function assertCleanTree(stamp) {
  let status = '';
  try {
    status = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch (_) {
    log('  ⚠ 非 git 环境，跳过代码可追溯性检查');
    return;
  }
  if (!status) { log(`  代码状态：干净（${stamp ? stamp.git : 'unknown'}）`); return; }
  if (!ALLOW_DIRTY) {
    fail('工作区有未提交改动，构建出的包无法对应确定版本。\n'
      + '  请先提交，或加 --allow-dirty 强制构建（不推荐用于分发）。\n'
      + '  改动文件：\n'
      + status.split('\n').slice(0, 10).map((l) => '    ' + l).join('\n'));
  }
  log('  ⚠ 工作区有未提交改动（--allow-dirty），包内容不可追溯');
}

/**
 * 构建后：校验包内应用代码与当前源码**逐字节一致**。
 * 防的是"拷贝遗漏 / 旧文件残留"——包内代码不等于源码，是最难察觉的一类坏包。
 */
function verifyBundleCode(bundleDir) {
  log('附加步骤：校验包内代码与当前源码一致');
  const mismatch = [];
  let checked = 0;
  const walk = (rel) => {
    const src = path.join(ROOT, rel);
    const dst = path.join(bundleDir, rel);
    if (!fs.existsSync(src)) return;
    if (fs.statSync(src).isDirectory()) {
      for (const e of fs.readdirSync(src)) walk(path.join(rel, e));
      return;
    }
    checked++;
    if (!fs.existsSync(dst)) { mismatch.push(`${rel}（包内缺失）`); return; }
    if (!fs.readFileSync(src).equals(fs.readFileSync(dst))) mismatch.push(`${rel}（内容不一致）`);
  };
  for (const item of ['scripts', 'server']) walk(item);
  if (mismatch.length > 0) {
    fail(`包内代码与源码不一致（${mismatch.length} 处）：\n`
      + mismatch.slice(0, 10).map((m) => '    ' + m).join('\n'));
  }
  log(`  一致（比对 ${checked} 个文件）`);
}

/**
 * 构建后：用**包内**代码与依赖跑一次真实转换。
 * 这是最关键的一道闸门——"能构建"不等于"能运行"（缺依赖、平台包不全、
 * 裁剪误删等只有真跑一次才暴露）。
 *
 * 自检用例刻意覆盖近期修过的缺陷路径：
 *   002 作者本地图片可解析 / 003 裸写活动名的活动图 / 004 无分隔行的键值表
 */
/**
 * 构建后：用**包内**代码与依赖跑自检。
 *
 * 直接复用包自带的目标机自检脚本（scripts/self-check.js）而非另写一套：
 *  · 构建期验的就是"目标机将要跑的那份代码"，避免两套校验逻辑漂移
 *  · 自检覆盖运行环境/浏览器/PlantUML(中文)/mermaid/端到端五组检查，
 *    比只验一次转换更强
 * 带 --allow-no-browser：构建机可能没浏览器，此时渲染类检查降级为跳过，
 * 不因此中断构建（真机仍应跑一次完整自检）。
 */
function smokeTestBundle(bundleDir) {
  log('附加步骤：包自检（复用包内 scripts/self-check.js）');
  const work = path.join(TEMP, 'smoke');
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });

  const env = {
    ...process.env,
    PLANTUML_BACKEND: 'core',
    DATA_DIR: path.join(work, 'data'),
  };
  // 有浏览器就显式指定，让渲染类检查真正跑起来
  try {
    const c = require(path.join(ROOT, 'scripts', 'puppeteer-config')).findChrome();
    if (c) env.PUPPETEER_EXECUTABLE_PATH = c;
  } catch (_) { /* 无浏览器，交给 --allow-no-browser 处理 */ }

  let output = '';
  let ok = true;
  try {
    output = execFileSync(
      process.execPath,
      [path.join(bundleDir, 'scripts', 'self-check.js'), '--allow-no-browser'],
      { cwd: work, stdio: 'pipe', timeout: 900000, env },
    ).toString();
  } catch (e) {
    ok = false;
    output = ((e.stdout || '') + (e.stderr || '')).toString();
  }

  // 把自检的关键行转述到构建日志（完整报告留在 work 目录里）
  const keep = output.split('\n').filter((l) =>
    /\[通过\]|\[失败\]|\[注意\]|汇总|全部通过|存在 \d+ 项失败/.test(l));
  for (const l of keep) log('  ' + l.trim());
  if (!ok) {
    fail(`包自检未通过（完整报告：${path.join(work, 'self-check-report.txt')}）`);
  }
}

/**
 * 构建后：把目标机自检脚本与一键自检入口放进包里。
 * 用户双击「自检.cmd」即可产出可回传的报告。
 */
function addSelfCheckEntry(bundleDir) {
  fs.writeFileSync(path.join(bundleDir, '自检.cmd'), [
    '@echo off',
    'chcp 65001 >nul',
    'setlocal',
    'cd /d "%~dp0"',
    'set "PLANTUML_BACKEND=core"',
    'if exist "%~dp0chrome-headless-shell\\chrome-headless-shell.exe" set "PUPPETEER_EXECUTABLE_PATH=%~dp0chrome-headless-shell\\chrome-headless-shell.exe"',
    'echo 正在自检，请稍候（首次运行约需 1-2 分钟）...',
    'echo.',
    '"%~dp0node.exe" "%~dp0scripts\\self-check.js" --report',
    'echo.',
    'echo 报告已保存到本目录的 self-check-report.txt',
    'echo 若有不通过项，请把该文件完整回传。',
    'pause',
    'endlocal',
  ].join('\r\n') + '\r\n', 'utf8');
}

/** 让 makensis 可用：优先 PATH，否则本地解包 Linux 版 NSIS（不改系统、不需 root） */
async function ensureMakensis() {
  // 1) PATH 中已有
  try {
    execFileSync('makensis', ['-VERSION'], { stdio: 'pipe' });
    return { bin: 'makensis', dir: process.env.NSISDIR || null };
  } catch (_) { /* 继续 */ }

  // 2) 本地解包（Ubuntu 归档的 nsis + nsis-common 两个 deb）
  // 优先 https；部分镜像只提供 http，download() 已支持两种协议
  const bases = process.env.NSIS_DEB_BASE
    ? [process.env.NSIS_DEB_BASE]
    : ['https://archive.ubuntu.com/ubuntu/pool/universe/n/nsis',
       'http://archive.ubuntu.com/ubuntu/pool/universe/n/nsis'];
  const nsisDeb = path.join(TEMP, 'nsis.deb');
  const commonDeb = path.join(TEMP, 'nsis-common.deb');
  let fetched = false;
  let lastErr = null;
  for (const base of bases) {
    try {
      await download(`${base}/nsis_3.09-4ubuntu1_amd64.deb`, nsisDeb);
      await download(`${base}/nsis-common_3.09-4ubuntu1_all.deb`, commonDeb);
      fetched = true;
      break;
    } catch (e) { lastErr = e; }
  }
  if (!fetched) {
    log(`  未能下载 NSIS（${lastErr && lastErr.message}）→ 跳过安装器生成`);
    return null;
  }
  const root = path.join(TEMP, 'nsis-root');
  fs.mkdirSync(root, { recursive: true });
  try {
    for (const deb of [nsisDeb, commonDeb]) {
      execFileSync('dpkg-deb', ['-x', deb, root], { stdio: 'pipe' });
    }
  } catch (e) {
    log(`  解包 NSIS 失败（${e.message}）→ 跳过安装器生成`);
    return null;
  }
  const bin = path.join(root, 'usr', 'bin', 'makensis');
  const dir = path.join(root, 'usr', 'share', 'nsis');
  if (!fs.existsSync(bin) || !fs.existsSync(dir)) {
    log('  NSIS 文件不完整 → 跳过安装器生成');
    return null;
  }
  fs.chmodSync(bin, 0o755);
  return { bin, dir };
}

/** 生成并编译 Windows 一键安装器（NSIS，交叉编译，无需 Windows） */
async function buildInstaller(bundleDir, zipName, stamp, nodeVer) {
  log('附加步骤：生成 Windows 一键安装器（NSIS）');
  const nsis = await ensureMakensis();
  if (!nsis) return null;

  // 版本号取自 package.json
  let appVer = '1.0.0';
  try { appVer = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || appVer; } catch (_) {}
  const outExe = path.join(OUT_DIR, `md2docx-Setup-${appVer}-win-x64.exe`);

  // 每用户安装（$LOCALAPPDATA）：无需管理员、不触发 UAC，契合"不污染系统"
  // 用 String.raw 保持反斜杠原样：普通模板串会把 \P、\m、\$ 这类
  // 无效转义的反斜杠吞掉（`"$LOCALAPPDATA\Programs"` → `"$LOCALAPPDATAPrograms"`），
  // 导致 NSIS 里所有 Windows 路径与注册表键全部损坏。
  const nsi = String.raw`
Unicode true
SetCompressor /SOLID lzma
Name "md2docx 文档转换工具"
OutFile "${outExe.replace(/\\/g, '/')}"
InstallDir "$LOCALAPPDATA\Programs\md2docx"
InstallDirRegKey HKCU "Software\md2docx" "InstallDir"
RequestExecutionLevel user

!include "MUI2.nsh"
!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

Section "主程序" SecMain
  SetOutPath "$INSTDIR"
  File /r "${bundleDir.replace(/\\/g, '/')}/*.*"

  WriteRegStr HKCU "Software\md2docx" "InstallDir" "$INSTDIR"
  WriteUninstaller "$INSTDIR\卸载 md2docx.exe"
  CreateDirectory "$SMPROGRAMS\md2docx"
  CreateShortcut "$SMPROGRAMS\md2docx\启动 md2docx.lnk" "$INSTDIR\启动 md2docx.cmd" "" "$INSTDIR\node.exe" 0
  CreateShortcut "$SMPROGRAMS\md2docx\卸载 md2docx.lnk" "$INSTDIR\卸载 md2docx.exe"
  CreateShortcut "$DESKTOP\md2docx.lnk" "$INSTDIR\启动 md2docx.cmd" "" "$INSTDIR\node.exe" 0
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\md2docx.lnk"
  RMDir /r "$SMPROGRAMS\md2docx"
  DeleteRegKey HKCU "Software\md2docx"
  ; 作业数据（用户上传与产物）一并清理
  RMDir /r "$INSTDIR"
SectionEnd
`;
  const nsiPath = path.join(TEMP, 'md2docx.nsi');
  fs.writeFileSync(nsiPath, nsi, 'utf8');

  const env = { ...process.env };
  if (nsis.dir) env.NSISDIR = nsis.dir;
  try {
    execFileSync(nsis.bin, ['-V2', nsiPath], { stdio: ['ignore', 'pipe', 'pipe'], env, timeout: 3600000 });
  } catch (e) {
    const msg = (e.stderr || e.stdout || '').toString().trim().split('\n').slice(-3).join(' | ');
    log(`  安装器编译失败: ${msg || e.message}`);
    return null;
  }
  if (!fs.existsSync(outExe)) { log('  安装器未产出'); return null; }
  return { path: outExe, size: fs.statSync(outExe).size };
}

  if (!KEEP_TEMP) fs.rmSync(TEMP, { recursive: true, force: true });
  else log(`  临时目录保留: ${TEMP}`);
}

main().catch((e) => { fail(e && e.stack ? e.stack : String(e)); });
