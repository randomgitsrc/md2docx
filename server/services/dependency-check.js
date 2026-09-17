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


  _plantuml() {
    // PlantUML 可以来自：PATH 中的 plantuml、bin/ 下的原生 exe、或 bin/plantuml.jar（需 Java）
    try {
      const { findPlantUML } = require('../../scripts/plantuml-renderer');
      const p = findPlantUML();
      if (!p) return { ok: false, error: 'not found' };
      return { ok: true, version: p.type === 'command' ? 'native/command' : 'jar (needs java)' };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  probe() {
    // 依赖清单说明：
    //   node    —— 必需（运行时）
    //   chrome  —— mermaid 渲染必需（Chrome/Chromium/Edge 任一）
    //   plantuml—— PlantUML 渲染必需（原生 exe 或 jar 任一）
    //   java    —— 仅当 PlantUML 走 jar 方式时需要
    //   graphviz—— 可选；PlantUML 内置 Smetana 布局可替代（见 !pragma layout smetana）
    // 注意：python-docx 已不再是依赖（分页属性改由 docx 库原生输出）。
    const result = {
      node: { ok: true, version: process.version },
      chrome: this._findChrome(),
      plantuml: this._plantuml(),
      java: run('java', '-version 2>&1'),
      graphviz: run('dot', '-V 2>&1'),
    };
    // 必需项：node / chrome / plantuml
    result.allOk = ['node', 'chrome', 'plantuml'].every(k => result[k].ok);
    this.cache = result;
    this.cachedAt = Date.now();
    return result;
  }

  /** 取依赖状态（TTL 缓存；首次或过期才重新探测） */
  get() {
    if (!this.cache || Date.now() - this.cachedAt > this.ttlMs) {
      const r = this.probe();
      // 只打印各项依赖；allOk 是布尔汇总，不能按 v.ok 取值（否则永远显示 ✗）
      const detail = Object.entries(r)
        .filter(([k]) => k !== 'allOk')
        .map(([k, v]) => `${k}=${v.ok ? '✓' : '✗'}`)
        .join(' ');
      logger.info(`[deps] 依赖探测完成: ${detail} | allOk=${r.allOk ? '✓' : '✗'}`);
      return r;
    }
    return this.cache;
  }
}

module.exports = { DependencyCheck };
