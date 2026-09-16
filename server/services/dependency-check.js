/**
 * dependency-check.js — 运行时依赖探测 + 缓存（M5）
 * 启动时探测一次，TTL 缓存；探测含 execSync（dot -V 等），
 * 只在缓存过期时刷新，不进入高频请求路径。
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('../lib/logger');

function run(cmd, args) {
  try {
    const out = execSync(`${cmd} ${args || ''}`, {
      stdio: 'pipe', timeout: 15000, encoding: 'utf-8',
    });
    return { ok: true, version: String(out).split('\n')[0].trim() };
  } catch (e) {
    const stderr = (e.stderr || '').toString().trim().split('\n')[0] || e.message;
    return { ok: false, error: stderr };
  }
}

class DependencyCheck {
  constructor({ ttlMs }) {
    this.ttlMs = ttlMs;
    this.cache = null;
    this.cachedAt = 0;
  }

  _findChrome() {
    // 复用 puppeteer-config 的探测逻辑
    try {
      const { findChrome } = require('../../scripts/puppeteer-config');
      const p = findChrome();
      if (p) return { ok: true, version: path.basename(p) };
      return { ok: false, error: 'not found' };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  _pythonDocx() {
    try {
      execSync('python3 -c "import docx; print(docx.__version__)"', {
        stdio: 'pipe', timeout: 15000, encoding: 'utf-8',
      });
      return { ok: true, version: 'installed' };
    } catch (e) {
      const msg = String(e.stderr || e.message).trim().split('\n')[0] || e.message;
      return { ok: false, error: msg };
    }
  }

  probe() {
    const result = {
      node: { ok: true, version: process.version },
      chrome: this._findChrome(),
      java: run('java', '-version 2>&1'),
      graphviz: run('dot', '-V 2>&1'),
      python: run('python3', '--version'),
      pythonDocx: this._pythonDocx(),
    };
    result.allOk = Object.values(result).every(v => v.ok);
    this.cache = result;
    this.cachedAt = Date.now();
    return result;
  }

  /** 取依赖状态（TTL 缓存；首次或过期才重新探测） */
  get() {
    if (!this.cache || Date.now() - this.cachedAt > this.ttlMs) {
      const r = this.probe();
      logger.info(`[deps] 依赖探测完成: ${Object.entries(r).map(([k, v]) => `${k}=${v.ok ? '✓' : '✗'}`).join(' ')}`);
      return r;
    }
    return this.cache;
  }
}

module.exports = { DependencyCheck };
