/**
 * plantuml-core-renderer.js — 用 @plantuml/core（TeaVM 版 PlantUML）渲染
 *
 * 相对 java -jar 后端的好处：
 *  - 免 Java、免 graphviz（自带 Viz.js = WASM 版真 Graphviz）
 *  - 快：单图约 0.7s（jar 版每图起一次 JVM）
 *  - 纯 npm 依赖，离线包无需额外原生二进制 / VC++ 运行库
 *
 * 设计：上层流水线是同步的，而 core 渲染需浏览器且为异步，
 * 故每图起一个子进程（plantuml-core-helper.js）跑完整异步流程并写 PNG，
 * 本模块只做同步等待 —— 对上层保持与 jar 后端一致的行为。
 * 每次独立进程 + 独立浏览器也顺带保证了图与图之间不会互相串扰。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { runFile } = require('./exec-util');

// 截图倍率必须为 1：横置判定用的是**绝对像素**
// （`宽/CONTENT_WIDTH_PX > 3 且 宽高比 > 2.0`，见 plantuml-renderer.js），
// 而该阈值是针对 jar 版的原生输出尺寸校准的。
// 实测 scale=2 会让像素翻倍，使擦线的图被误判为横置 → 改变分节与页码。
// scale=1 时 core 的像素尺寸与 jar 基本一致（如 177 vs 175）。
const DEFAULT_SCALE = 1;

/**
 * 渲染一张 PlantUML 图，返回 { buffer, width, height }
 * 与 plantuml-renderer.renderPlantUML 的返回结构保持一致（便于切换后端）。
 *
 * @param {string} code      已注入主题/字体的 PlantUML 源码
 * @param {string} tmpDir    工作目录（PNG 与中间文件写在这里）
 * @param {number} index     图序号（用于文件名）
 * @param {{ scale?: number }} [opts]
 */
function renderPlantUMLCore(code, tmpDir, index, opts = {}) {
  const scale = opts.scale || DEFAULT_SCALE;
  const outPng = path.join(tmpDir, `p_${index}.png`);
  const helper = path.resolve(__dirname, 'plantuml-core-helper.js');

  // 渲染前删掉可能存在的旧产物：core 侧失败时不会写文件，
  // 若不清旧文件，上层可能把上一轮的 PNG 当成本次结果（静默错图）。
  fs.rmSync(outPng, { force: true });

  const jobPath = path.join(tmpDir, `core-job-${index}.json`);
  fs.writeFileSync(jobPath, JSON.stringify({
    code,
    outPng,
    workDir: tmpDir,
    scale,
    background: 'white',
  }), 'utf8');

  let stderr = '';
  try {
    const res = runFile(process.execPath, [helper, jobPath], {
      timeout: 120000,
      cwd: path.resolve(__dirname, '..'),
    });
    if (res.stdout) stderr = res.stdout;
  } catch (e) {
    // 把子进程 stderr 透出，便于定位（缺失依赖 / 浏览器问题 / PlantUML 语法错）
    const msg = (e.stderr || '').toString().trim() || e.message || String(e);
    throw new Error(msg.split('\n').slice(0, 4).join(' | '));
  }

  if (!fs.existsSync(outPng)) {
    throw new Error('core 渲染未产出 PNG');
  }

  const buffer = fs.readFileSync(outPng);
  // PNG 宽高读文件头（与 jar 后端一致）
  let width = 0, height = 0;
  if (buffer[0] === 0x89 && buffer[1] === 0x50) {
    width = buffer.readUInt32BE(16);
    height = buffer.readUInt32BE(20);
  }
  return { buffer, width, height };
}

/**
 * @plantuml/core 是否可用（包 + 静态资源齐备）。
 * 用于自动选择后端：Windows/离线包倾向 core，未安装则回退 jar。
 */
function isCoreAvailable() {
  try {
    // 静态资源是渲染必需（plantuml.js 依赖 viz-global.js 提供 Graphviz）
    const dir = require('path');
    const fs = require('fs');
    let coreDir = null;
    try {
      coreDir = dir.dirname(require.resolve('@plantuml/core/package.json'));
    } catch (_) {
      coreDir = dir.resolve(__dirname, '..', 'node_modules', '@plantuml', 'core');
    }
    return fs.existsSync(dir.join(coreDir, 'plantuml.js'))
        && fs.existsSync(dir.join(coreDir, 'viz-global.js'));
  } catch (_) {
    return false;
  }
}

module.exports = { renderPlantUMLCore, isCoreAvailable };
