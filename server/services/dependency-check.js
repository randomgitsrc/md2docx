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
    // PlantUML 有三个来源，按实际生效的后端报告（不能只看 jar）：
    //   1. core 后端 —— @plantuml/core（纯 npm 依赖，免 Java/graphviz）
    //   2. PATH 中的 plantuml / bin 下的原生 exe
    //   3. bin/plantuml.jar（需 Java）
    const coreAvailable = () => {
      try { return require('../../scripts/plantuml-core-renderer').isCoreAvailable(); }
      catch (_) { return false; }
    };
    try {
      // 与 renderPlantUML 的后端选择保持一致
      let backend = (process.env.PLANTUML_BACKEND || 'auto').toLowerCase();
      if (backend !== 'core' && backend !== 'jar') {
        backend = coreAvailable() ? 'core' : 'jar';
      }
      if (backend === 'core') {
        return coreAvailable()
          ? { ok: true, version: 'core（免 Java/graphviz）' }
          : { ok: false, error: '@plantuml/core 不可用' };
      }
      const puml = require('../../scripts/plantuml-renderer').findPlantUML();
      if (!puml) return { ok: false, error: 'not found（既无 @plantuml/core 也无 jar）' };
      return { ok: true, version: puml.type === 'command' ? 'native/command' : 'jar (needs java)' };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  probe() {
    // 依赖清单说明：
    //   node    —— 必需（运行时）
    //   chrome  —— 渲染必需（Chrome/Chromium/Edge 任一；mermaid 与 core 后端都用它）
    //   plantuml—— PlantUML 渲染必需（@plantuml/core / 原生 exe / jar 任一）
    //   java    —— 仅当 PlantUML 走 jar 方式时需要（core 后端不需要）
    //   graphviz—— 仅 jar 方式可能用到（core 自带 WASM 版 Graphviz）
    // 注意：python-docx 已不再是依赖（分页属性改由 docx 库原生输出）。
    const plantuml = this._plantuml();
    const result = {
      node: { ok: true, version: process.version },
      chrome: this._findChrome(),
      plantuml,
      java: run('java', '-version 2>&1'),
      graphviz: run('dot', '-V 2>&1'),
    };
    // 后端信息作为 result 的附加字段（不是依赖项，日志/汇总时须排除）
    result.plantumlBackend = /core/.test(String(plantuml.version || '')) ? 'core' : 'jar';
    // 必需项：node / chrome / plantuml
    result.allOk = ['node', 'chrome', 'plantuml'].every(k => result[k].ok);
    result.requiredKeys = ['node', 'chrome', 'plantuml'];
    this.cache = result;
    this.cachedAt = Date.now();
    return result;
  }

  /** 取依赖状态（TTL 缓存；首次或过期才重新探测） */
  get() {
    if (!this.cache || Date.now() - this.cachedAt > this.ttlMs) {
      const r = this.probe();
      // 只打印真正的依赖项：allOk 是布尔汇总、requiredKeys 是数组、plantumlBackend 是字符串，
      // 它们都没有 .ok 字段，混进来会一律显示 ✗（此坑已犯过一次）。
      const skip = new Set(['allOk', 'requiredKeys', 'plantumlBackend']);
      const detail = Object.entries(r)
        .filter(([k]) => !skip.has(k))
        .map(([k, v]) => `${k}=${v.ok ? '✓' : '✗'}`)
        .join(' ');
      logger.info(`[deps] 依赖探测完成: ${detail} | 后端=${r.plantumlBackend} | allOk=${r.allOk ? '✓' : '✗'}`);
      return r;
    }
    return this.cache;
  }
}

module.exports = { DependencyCheck };
