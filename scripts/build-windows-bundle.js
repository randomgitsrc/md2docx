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
const TEMP = path.join(os.tmpdir(), `md2docx-bundle-${Date.now()}`);
const KEEP_TEMP = opt('--keep-temp');

function log(msg) { console.log(`[bundle] ${msg}`); }
function fail(msg) { console.error(`[bundle] 错误: ${msg}`); process.exit(1); }

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const go = (u, n) => {
      https.get(u, { timeout: 300000 }, (res) => {
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

async function main() {
  log(`输出目录: ${OUT_DIR}`);
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
    'set "DATA_DIR=%~dp0data"',
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
    '【不污染系统】',
    '  不改 PATH、不写全局注册表、不安装任何系统组件；删除本目录即完全卸载。',
    '',
    `构建信息：Node ${nodeVer}${chromeDir ? ' / 内置 chrome-headless-shell' : ' / 使用系统 Chrome 或 Edge'}`,
  ].join('\r\n') + '\r\n', 'utf8');

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
  log('');
  log('=== 完成 ===');
  log(`  目录: ${BUNDLE_DIR}  (${human(stats.bytes)}, ${stats.files} 个文件)`);
  log(`  压缩: ${zipPath}  (${human(zipSize)})`);
  log(`  目标机：解压 → 双击「启动 md2docx.cmd」→ 浏览器自动打开`);

  if (!KEEP_TEMP) fs.rmSync(TEMP, { recursive: true, force: true });
  else log(`  临时目录保留: ${TEMP}`);
}

main().catch((e) => { fail(e && e.stack ? e.stack : String(e)); });
