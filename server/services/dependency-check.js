/**
 * dependency-check.js — 运行时依赖探测 + 缓存（M5）
 * 启动时探测一次，TTL 缓存；探测含外部命令（java -version / dot -V），
 * 只在缓存过期时刷新，不进入高频请求路径。
 */

const fs = require('fs');
const path = require('path');
const logger = require('../lib/logger');
const { runFile } = require('../../scripts/exec-util');

/**
 * 探测一条外部命令。
 * 一律走 exec-util.runFile（execFileSync + 参数数组，不经 shell）——
 * 原实现用 `execSync(`${cmd} ${args}`)` 拼命令行，正是项目约定禁止的写法
 * （见 AGENTS.md 已知陷阱 #11：路径含空格/中文时会被 shell 拆参数）。
 * java -version 与 dot -V 都把版本写到 stderr，故 stdout 取不到时看 stderr。
 */
function run(cmd, args) {
  const r = runFile(cmd, args, { allowFailure: true, timeout: 15000 });
  if (r.ok) {
    const out = String(r.stdout || '').split('\n').map((s) => s.trim()).filter(Boolean);
    return { ok: true, version: out[0] || '' };
  }
  const e = r.error || {};
  const errText = String(e.stderr || '').split('\n').map((s) => s.trim()).filter(Boolean)[0];
  return { ok: false, error: errText || e.message || 'not found' };
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
    //   java    —— 可选：仅 jar 后端需要（core 后端不需要）
    //   graphviz—— 可选：仅 jar 后端可能用到（core 自带 WASM 版 Graphviz）
    // 注意：python-docx 已不再是依赖（分页属性改由 docx 库原生输出）。
    //
    // 每条依赖都带 required / applicable 两个标记：
    //   界面据此区分"红色 ✗（必需项缺失，真有问题）"与"灰色（不适用/可选）"。
    //   此前界面把 java/graphviz 一律按必需渲染成红色 ✗，core 后端下纯属误导。
    const plantuml = this._plantuml();
    const backend = /core/.test(String(plantuml.version || '')) ? 'core' : 'jar';
    const needsJavaEcosystem = backend === 'jar';

    const result = {
      node: { ok: true, version: process.version, required: true, applicable: true },
      chrome: { ...this._findChrome(), required: true, applicable: true },
      plantuml: { ...plantuml, required: true, applicable: true },
      java: { ...run('java', ['-version']), required: false, applicable: needsJavaEcosystem },
      graphviz: { ...run('dot', ['-V']), required: false, applicable: needsJavaEcosystem },
    };
    // 后端信息作为 result 的附加字段（不是依赖项，日志/汇总时须排除）
    result.plantumlBackend = backend;
    // 必需项：node / chrome / plantuml
    result.requiredKeys = ['node', 'chrome', 'plantuml'];
    result.optionalKeys = ['java', 'graphviz'];
    result.allOk = result.requiredKeys.every(k => result[k].ok);
    this.cache = result;
    this.cachedAt = Date.now();
    return result;
  }

  /** 取依赖状态（TTL 缓存；首次或过期才重新探测） */
  get() {
    if (!this.cache || Date.now() - this.cachedAt > this.ttlMs) {
      const r = this.probe();
      // 只打印真正的依赖项：allOk 是布尔汇总、requiredKeys/optionalKeys 是数组、
      // plantumlBackend 是字符串，它们都没有 .ok 字段，混进来会一律显示 ✗（此坑已犯过一次）。
      const skip = new Set(['allOk', 'requiredKeys', 'optionalKeys', 'plantumlBackend']);
      const detail = Object.entries(r)
        .filter(([k]) => !skip.has(k))
        .map(([k, v]) => `${k}=${v.ok ? '✓' : (v.applicable ? '✗' : '–')}`)
        .join(' ');
      logger.info(`[deps] 依赖探测完成: ${detail} | 后端=${r.plantumlBackend} | allOk=${r.allOk ? '✓' : '✗'}`);
      return r;
    }
    return this.cache;
  }
}

module.exports = { DependencyCheck };
