/**
 * 共享 puppeteer 配置 — 供 mmdc (mermaid-cli) 使用
 * 自动检测本机 Chrome/Chromium 路径
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_FILE = 'puppeteer.json';

const CANDIDATES = [
  // Linux
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/snap/bin/chromium',
  // macOS
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  // Windows —— Chrome
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  // Windows —— Edge（系统自带，可省去打包 Chromium 的体积）
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

// 用户级安装路径（无需管理员权限的 Chrome/Edge）
function userInstallCandidates() {
  const home = os.homedir();
  return [
    path.join(home, 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(home, 'AppData', 'Local', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ];
}

function findPuppeteerCachedChrome() {
  const bases = [
    path.join(os.homedir(), '.cache', 'puppeteer', 'chrome-headless-shell'),
    // Windows: %USERPROFILE%\.cache\puppeteer\chrome-headless-shell
    path.join(os.homedir(), 'AppData', 'Local', 'puppeteer', 'chrome-headless-shell'),
  ];
  // 各平台的解压目录名与可执行文件名不同
  const layouts = [
    ['chrome-headless-shell-linux64', 'chrome-headless-shell'],
    ['chrome-headless-shell-mac-64', 'chrome-headless-shell'],
    ['chrome-headless-shell-mac-arm64', 'chrome-headless-shell'],
    ['chrome-headless-shell-win64', 'chrome-headless-shell.exe'],
    ['chrome-headless-shell-win32', 'chrome-headless-shell.exe'],
    ['chrome-win64', 'chrome.exe'],
    ['chrome-win32', 'chrome.exe'],
  ];
  for (const base of bases) {
    if (!fs.existsSync(base)) continue;
    const versions = fs.readdirSync(base).sort().reverse();
    for (const v of versions) {
      for (const [dir, exe] of layouts) {
        const candidate = path.join(base, v, dir, exe);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

function findChrome() {
  // 显式指定优先（Windows 打包/自定义安装时用）
  const override = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (override && fs.existsSync(override)) return override;
  return findPuppeteerCachedChrome()
      || CANDIDATES.find(p => fs.existsSync(p))
      || userInstallCandidates().find(p => fs.existsSync(p))
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