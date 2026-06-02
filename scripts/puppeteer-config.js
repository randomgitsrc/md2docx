/**
 * 共享 puppeteer 配置 — 供 mmdc (mermaid-cli) 使用
 * 自动检测本机 Chrome/Chromium 路径
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_FILE = 'puppeteer.json';

const CANDIDATES = [
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/snap/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

function findPuppeteerCachedChrome() {
  const bases = [
    path.join(os.homedir(), '.cache', 'puppeteer', 'chrome-headless-shell'),
  ];
  for (const base of bases) {
    if (!fs.existsSync(base)) continue;
    const versions = fs.readdirSync(base).sort().reverse();
    for (const v of versions) {
      const candidate = path.join(base, v, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
      if (fs.existsSync(candidate)) return candidate;
      // macOS
      const macCandidate = path.join(base, v, 'chrome-headless-shell-mac-64', 'chrome-headless-shell');
      if (fs.existsSync(macCandidate)) return macCandidate;
    }
  }
  return null;
}

function findChrome() {
  return findPuppeteerCachedChrome()
      || CANDIDATES.find(p => fs.existsSync(p))
      || null;
}

function generateConfig(workDir) {
  const chrome = findChrome();
  if (!chrome) return null;

  const config = {
    executablePath: chrome,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  };

  const configPath = path.join(workDir, CONFIG_FILE);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  return configPath;
}

module.exports = { generateConfig, findChrome };