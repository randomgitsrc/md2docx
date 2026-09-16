#!/usr/bin/env node
/**
 * e2e-web.js — Web 页面端到端验证（Playwright + CDP）
 *
 * 本机需有 Chrome CDP 环境（默认 http://127.0.0.1:18800）与全局 playwright：
 *   NODE_PATH=$(npm root -g) node scripts/e2e-web.js [url] [md-file]
 *
 * 验证链路：页面加载 → 依赖徽标 → 选择文件 → 提交 → 轮询进度 → 完成 → 下载链接。
 * 无 CDP 环境时跳过本脚本，改用 curl 走 API 全流程（见 docs/api.md §7）。
 */

'use strict';

const path = require('path');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  console.error('缺少 playwright。请用：NODE_PATH=$(npm root -g) node scripts/e2e-web.js');
  process.exit(1);
}

const CDP = process.env.CDP_URL || 'http://127.0.0.1:18800';
const URL = process.argv[2] || 'http://127.0.0.1:8080/';
const MD_FILE = path.resolve(process.argv[3] || 'md/test-comprehensive.md');
const HARD = 120000;

let lastStep = 'init';
const hardTimer = setTimeout(() => {
  console.error(`[e2e] HARD TIMEOUT at ${lastStep}`);
  process.exit(2);
}, HARD);

async function main() {
  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0] || await browser.newContext();
  const page = await ctx.newPage();

  try {
    lastStep = 'goto';
    await page.goto(URL, { timeout: 15000 });
    await page.waitForSelector('#dropzone', { timeout: 10000 });
    console.log('[1] 页面加载成功, title =', await page.title());

    lastStep = 'health badges';
    await page.waitForSelector('#dep-node.ok, #dep-node.fail', { timeout: 20000 });
    const badges = await page.$$eval('.dep', els => els.map(e => e.textContent.trim()));
    console.log('[2] 依赖徽标:', badges.join(' | '));

    lastStep = 'select file';
    await page.setInputFiles('#file-input', MD_FILE);
    await page.waitForSelector('#btn-submit:not([disabled])', { timeout: 5000 });
    console.log('[3] 文件已选择，提交按钮可用');

    lastStep = 'fill overrides';
    await page.fill('#field-title', 'Web E2E 覆盖标题');
    await page.fill('#field-company', 'E2E公司');

    lastStep = 'submit';
    await page.click('#btn-submit');
    await page.waitForSelector('#progress-card:not([hidden])', { timeout: 5000 });
    console.log('[4] 已提交，进度卡显示');

    lastStep = 'wait done';
    await page.waitForFunction(() => {
      const el = document.querySelector('#status-chip');
      return el && (el.classList.contains('done') || el.classList.contains('failed'));
    }, { timeout: 110000 });
    const status = (await page.textContent('#status-chip')).trim();
    const pct = (await page.textContent('#progress-percent')).trim();
    console.log('[5] 作业状态:', status, '| 进度:', pct);
    if (status !== '完成') throw new Error(`作业未成功: ${status}`);

    lastStep = 'download link';
    await page.waitForSelector('#btn-download:not([hidden])', { timeout: 5000 });
    console.log('[6] 下载链接:', await page.getAttribute('#btn-download', 'href'));

    lastStep = 'screenshot';
    const shot = 'md/output/web-e2e.png';
    await page.screenshot({ path: shot, fullPage: true });
    console.log('[7] 截图已保存', shot);

    lastStep = 'logs';
    const logsText = (await page.textContent('#logs')) || '';
    console.log('[8] 日志行数:', logsText.trim().split('\n').filter(Boolean).length);

    console.log('=== WEB E2E PASS ===');
  } finally {
    await page.close();
  }

  clearTimeout(hardTimer);
  process.exit(0);
}

main().catch(err => {
  console.error(`[e2e] FAILED at ${lastStep}:`, err.message);
  process.exit(1);
});
