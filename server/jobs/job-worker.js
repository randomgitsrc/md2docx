/**
 * job-worker.js — 作业执行线程（worker_threads）
 * 把 preprocess + convert（内部含 execSync 渲染 Chrome/Java/python）放进独立线程，
 * 使主线程（HTTP/轮询）永不被阻塞（评审 H1，P0）。
 *
 * 消息协议（worker → 主线程，parentPort.postMessage）：
 *   { type: 'progress', value: 0-100, message }
 *   { type: 'log', line }
 *   { type: 'done', outputPath, stats }
 *   { type: 'error', message, stack }
 *
 * workerData:
 *   { jobId, jobDir, uploadPath, overrides, originalName }
 */

const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const { preprocess } = require('../../scripts/preprocess');
const { convert } = require('../../scripts/md2docx');
const { sanitizeImageRefs, buildJobDirs } = require('../lib/pipeline');

function emit(type, payload) {
  if (parentPort) parentPort.postMessage({ type, ...payload });
}

function toPercent(inner, from, to) {
  return from + (inner / 100) * (to - from);
}

async function run() {
  const { jobId, jobDir, uploadPath, overrides, originalName } = workerData;
  const docName = originalName.replace(/\.md$/i, '') || 'document';
  const dirs = buildJobDirs(jobDir);
  const cleanPath = path.join(dirs.cleanDir, `${docName}.clean.md`);
  const docxPath = path.join(dirs.docxDir, `${docName}.docx`);

  try {
    // ---------- 阶段 1: preprocess（占整体进度 0~60%） ----------
    const preResult = preprocess(uploadPath, {
      outputDir: jobDir,
      cleanDir: dirs.cleanDir,
      mermaidCacheDir: dirs.mermaidCacheDir,
      plantumlCacheDir: dirs.plantumlCacheDir,
      overrides,
      onProgress: (inner, message) => emit('progress', {
        value: toPercent(inner, 0, 60),
        message: `[预处理] ${message}`,
      }),
      onLog: (line) => emit('log', { line }),
    });
    const actualCleanPath = preResult.outputPath || cleanPath;

    // ---------- 安全: 图片引用路径白名单（H3，P0） ----------
    const { removed } = sanitizeImageRefs(actualCleanPath, jobDir);
    for (const r of removed) {
      emit('log', { line: `[安全] 已忽略越界图片引用: ${r}` });
    }

    // ---------- 阶段 2: convert（占整体进度 60~100%） ----------
    const result = await convert(actualCleanPath, {
      outputBase: jobDir,
      srcDir: jobDir,
      // 图片解析容器边界：作者图片随上传文件落在 jobDir，越界引用一律拒绝
      imageRoot: jobDir,
      outputPath: docxPath,
      onProgress: (inner, message) => emit('progress', {
        value: toPercent(inner, 60, 100),
        message: `[转换] ${message}`,
      }),
      onLog: (line) => emit('log', { line }),
    });

    const sizeBytes = fs.statSync(result.outputPath).size;
    emit('done', {
      outputPath: result.outputPath,
      cleanPath: actualCleanPath,
      stats: { ...result.stats, sizeBytes },
    });
  } catch (e) {
    emit('error', { message: e.message || String(e), stack: e.stack });
  }
}

run();
