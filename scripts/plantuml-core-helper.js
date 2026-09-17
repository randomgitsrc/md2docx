/**
 * plantuml-core-helper.js — 在无头 Chromium 中用 @plantuml/core 渲染一张 PlantUML 图
 *
 * 由 plantuml-core-renderer.js 以子进程方式调用（保持上层同步 API）。
 * 每次独立进程 + 独立浏览器：天然隔离，不会跨图串扰（避免复用陈旧产物类问题）。
 *
 * 用法: node plantuml-core-helper.js <jobJsonPath>
 *   jobJson: { code, outPng, workDir, scale, background }
 * 退出码 0 = 成功写出 PNG；非 0 = 失败（stderr 带原因）
 */
'use strict';

const fs = require('fs');
const path = require('path');

function fail(msg) {
  process.stderr.write(String(msg) + '\n');
  process.exit(1);
}

const jobPath = process.argv[2];
if (!jobPath) fail('缺少 jobJson 参数');

let job;
try {
  job = JSON.parse(fs.readFileSync(jobPath, 'utf8'));
} catch (e) {
  fail(`读取 job 失败: ${e.message}`);
}

const { code, outPng, workDir, scale = 1, background = 'white' } = job;

let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch (e) {
  fail(`需要 puppeteer-core: ${e.message}`);
}

let chromeExe;
try {
  chromeExe = require('./puppeteer-config').findChrome();
} catch (e) {
  fail(`探测浏览器失败: ${e.message}`);
}
if (!chromeExe) fail('未找到 Chrome/Chromium/Edge（设置 PUPPETEER_EXECUTABLE_PATH 可显式指定）');

// 定位 @plantuml/core 的静态资源
function resolveCoreDir() {
  const candidates = [];
  try {
    candidates.push(path.dirname(require.resolve('@plantuml/core/package.json')));
  } catch (_) { /* 包 exports 可能不暴露 package.json */ }
  candidates.push(path.resolve(__dirname, '..', 'node_modules', '@plantuml', 'core'));
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'plantuml.js')) && fs.existsSync(path.join(c, 'viz-global.js'))) return c;
  }
  return null;
}

(async () => {
  const coreDir = resolveCoreDir();
  if (!coreDir) fail('未找到 @plantuml/core（请执行 npm install @plantuml/core）');

  const stageDir = path.join(workDir, 'core-stage');
  fs.mkdirSync(stageDir, { recursive: true });
  // 复制静态资源到同一目录：ES module 需要同源，且 themes.js 需与 plantuml.js 同目录
  for (const f of ['plantuml.js', 'viz-global.js', 'themes.js']) {
    const src = path.join(coreDir, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(stageDir, f));
  }

  const indexPath = path.join(stageDir, 'index.html');
  fs.writeFileSync(indexPath, `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head><body style="margin:0">
<div id="out"></div>
<script src="viz-global.js"></script>
<script>
  window.__err = null;
  window.onerror = (m) => { window.__err = String(m); };
</script>
<script type="module">
  import { renderToString } from './plantuml.js';
  window.__render = (code) => new Promise((resolve, reject) => {
    try {
      renderToString(code.split('\\n'), svg => resolve(svg), err => reject(new Error(String(err))));
    } catch (e) { reject(e); }
  });
  window.__ready = true;
</script>
</body></html>`, 'utf8');

  const launchArgs = ['--no-sandbox', '--disable-setuid-sandbox', '--allow-file-access-from-files'];
  const browser = await puppeteer.launch({
    executablePath: chromeExe,
    headless: 'shell',
    args: launchArgs,
  });

  try {
    const page = await browser.newPage();
    await page.goto('file://' + indexPath, { timeout: 30000 });
    await page.waitForFunction('window.__ready === true', { timeout: 30000 });

    const svg = await page.evaluate((c) => window.__render(c), code);
    if (!svg || !svg.includes('<svg')) fail('渲染未返回有效 SVG');

    // 【关键】@plantuml/core 在语法错误时**不抛异常**，而是把错误信息
    // 画成一张图（含红色提示与源码回显）当作成功结果返回。
    // 若不拦截，用户会拿到"图里写着语法错误"的文档，而日志却报渲染成功——
    // 比降级为代码块糟糕得多。
    // 实测错误图会命中下列文案之一（正常图完全不含）：
    //   Syntax Error? / From textarea / Assumed diagram type
    //   Diagram not supported by this release / is not recognized / Sorry, but
    const errMarkers = [
      /Syntax Error/i,
      /From textarea/i,
      /Assumed diagram type/i,
      /Diagram not supported by this release/i,
      /is not recognized/i,
      /Sorry, but/i,
      /Suggested actions:/i,
    ];
    const hit = errMarkers.find(re => re.test(svg));
    if (hit) {
      // 尽力提取行号与原因，供上层换算成原始文件行号
      const lineM = svg.match(/line\s*(\d+)/i);
      const msgM = svg.match(/((?:Syntax Error|Diagram not supported)[^<]*)/i);
      const detail = msgM ? msgM[1].trim() : 'PlantUML 未能识别该图（语法或指令有误）';
      fail(lineM ? `Error line ${lineM[1]} in file: ${detail}` : detail);
    }

    // 用 SVG 自身尺寸决定视口与截图范围（保持与 jar 版相近的自然像素尺寸）
    const wMatch = svg.match(/width="([\d.]+)(pt|px)?"/);
    const hMatch = svg.match(/height="([\d.]+)(pt|px)?"/);
    const svgW = wMatch ? Math.ceil(parseFloat(wMatch[1])) : 800;
    const svgH = hMatch ? Math.ceil(parseFloat(hMatch[1])) : 600;

    await page.setViewport({
      width: Math.max(1, svgW),
      height: Math.max(1, svgH),
      deviceScaleFactor: scale,
    });
    await page.setContent(
      `<body style="margin:0;background:${background}">${svg}</body>`,
      { waitUntil: 'load' },
    );

    const el = await page.$('svg');
    const buf = el
      ? await el.screenshot({ type: 'png', omitBackground: background === 'transparent' })
      : await page.screenshot({ type: 'png' });

    fs.mkdirSync(path.dirname(outPng), { recursive: true });
    fs.writeFileSync(outPng, buf);
    await browser.close();
    process.exit(0);
  } catch (e) {
    try { await browser.close(); } catch (_) { /* ignore */ }
    fail(e && e.message ? e.message : String(e));
  }
})().catch((e) => fail(e && e.message ? e.message : String(e)));
