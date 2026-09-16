/**
 * job.js — 作业模型（内存对象，不落盘）
 * 状态机: queued → running → done | failed
 */

const crypto = require('crypto');

const STATUS = Object.freeze({
  QUEUED: 'queued',
  RUNNING: 'running',
  DONE: 'done',
  FAILED: 'failed',
});

class Job {
  /**
   * @param {object} opts
   * @param {string} [opts.id]
   * @param {string} opts.originalName  原始上传文件名（含 .md）
   * @param {string} opts.jobDir        作业工作目录绝对路径
   * @param {object} [opts.overrides]   { title, company, date }
   * @param {string} [opts.clientIp]
   */
  constructor(opts = {}) {
    this.id = opts.id || crypto.randomBytes(8).toString('hex');
    this.originalName = opts.originalName || 'document.md';
    this.jobDir = opts.jobDir;
    this.overrides = opts.overrides || {};
    this.clientIp = opts.clientIp || '';
    this.status = STATUS.QUEUED;
    this.progress = 0;
    this.logs = [];
    this.warnings = [];
    this.artifact = null;   // { docxPath, fileName, sizeBytes }
    this.cleanPath = null;  // clean.md 路径（调试下载用）
    this.error = null;
    this.createdAt = Date.now();
    this.startedAt = null;
    this.finishedAt = null;
  }

  setStatus(s) {
    this.status = s;
    if (s === STATUS.RUNNING) this.startedAt = Date.now();
    if (s === STATUS.DONE || s === STATUS.FAILED) this.finishedAt = Date.now();
  }

  setProgress(p) {
    this.progress = Math.max(0, Math.min(100, Math.round(p)));
  }

  addLog(line) {
    const l = String(line).trim();
    if (!l) return;
    // 去重（worker 与 pipeline 可能重复上报同一行）
    if (this.logs[this.logs.length - 1] === l) return;
    this.logs.push(l);
    if (this.logs.length > 500) this.logs.splice(0, this.logs.length - 500);
  }

  addWarning(msg) {
    this.warnings.push(String(msg));
  }

  setArtifact(docxPath, sizeBytes) {
    const docName = this.originalName.replace(/\.md$/i, '');
    this.artifact = {
      docxPath,
      fileName: `${docName}.docx`,
      sizeBytes,
    };
  }

  /** 序列化给前端（不含敏感路径，日志可选脱敏） */
  toPublic({ includeLogs = true } = {}) {
    return {
      id: this.id,
      status: this.status,
      progress: this.progress,
      originalName: this.originalName,
      overrides: this.overrides,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      warnings: this.warnings,
      error: this.error,
      hasArtifact: !!this.artifact,
      artifact: this.artifact ? {
        fileName: this.artifact.fileName,
        sizeBytes: this.artifact.sizeBytes,
      } : null,
      ...(includeLogs ? { logs: this.logs } : {}),
    };
  }
}

module.exports = { Job, STATUS };
