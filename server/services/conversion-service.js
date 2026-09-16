/**
 * conversion-service.js — 转换编排服务
 * 职责：
 *  - 校验上传（扩展名 .md、大小、图表数量上限 M3）
 *  - 创建作业工作目录、保存上传文件
 *  - 构建 Job、入队
 *  - 提供下载/清理作业的能力
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('../lib/logger');
const { countDiagrams } = require('../lib/pipeline');
const { Job, STATUS } = require('../jobs/job');

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

class ConversionService {
  constructor({ jobsDir, store, queue, maxFileSizeMb, maxDiagrams }) {
    this.jobsDir = jobsDir;
    this.store = store;
    this.queue = queue;
    this.maxFileSizeMb = maxFileSizeMb;
    this.maxDiagrams = maxDiagrams;
  }

  /**
   * 提交转换作业
   * @param {object} file  multer 解析出的文件对象 { originalname, buffer, size }
   * @param {object} body  表单字段（title/company/date）
   * @param {string} clientIp
   * @returns {Job}
   */
  submit(file, body, clientIp) {
    if (!file || !file.buffer) {
      throw new HttpError(400, 'NO_FILE', '缺少上传文件（表单字段名应为 file）');
    }

    // 扩展名校验
    const name = (file.originalname || '').replace(/\\/g, '/').split('/').pop();
    if (!/\.md$/i.test(name)) {
      throw new HttpError(400, 'INVALID_EXTENSION', `仅支持 .md 文件，收到: ${name}`);
    }

    // 大小校验（双保险，multer limits 也会拦截）
    if (file.size > this.maxFileSizeMb * 1024 * 1024) {
      throw new HttpError(413, 'FILE_TOO_LARGE',
        `文件超过 ${this.maxFileSizeMb}MB 上限`);
    }

    // 图表数量校验（M3，P0 DoS 防护）
    const content = file.buffer.toString('utf-8');
    const diagrams = countDiagrams(content);
    if (diagrams.total > this.maxDiagrams) {
      throw new HttpError(400, 'TOO_MANY_DIAGRAMS',
        `图表数量 ${diagrams.total} 超过上限 ${this.maxDiagrams}（mermaid ${diagrams.mermaid} + plantuml ${diagrams.plantuml}）`);
    }

    // 队列上限校验（M3）
    if (this.queue.length >= this.queue.queueLimit) {
      throw new HttpError(429, 'QUEUE_FULL', '转换队列已满，请稍后再试');
    }

    // 覆盖字段（M8：表单参数优先于 YAML，真覆盖）
    const overrides = {};
    for (const k of ['title', 'company', 'date']) {
      if (body && body[k] !== undefined && body[k] !== '') overrides[k] = String(body[k]).trim();
    }

    // 创建作业目录 + 保存上传
    const id = crypto.randomBytes(8).toString('hex');
    const jobDir = path.join(this.jobsDir, id);
    fs.mkdirSync(jobDir, { recursive: true });
    const uploadPath = path.join(jobDir, 'upload.md');
    fs.writeFileSync(uploadPath, content, 'utf-8');

    const job = new Job({
      id,
      originalName: name,
      jobDir,
      overrides,
      clientIp,
    });

    const ok = this.queue.enqueue(job);
    if (!ok) {
      // 入队失败（极端情况：关闭中）
      fs.rmSync(jobDir, { recursive: true, force: true });
      throw new HttpError(429, 'QUEUE_FULL', '转换队列不可用，请稍后再试');
    }

    this.store.set(job);
    logger.info(`[convert] 作业 ${id} 已提交 (${name}, ${(file.size / 1024).toFixed(1)}KB, 图表 ${diagrams.total})`);
    return job;
  }

  /** 取作业（含 M9 一致性校验） */
  getJob(id) {
    return this.store.get(id);
  }

  listJobs(limit = 20, offset = 0) {
    const all = this.store.list()
      .sort((a, b) => b.createdAt - a.createdAt);
    return all.slice(offset, offset + limit);
  }

  /** 删除作业（幂等；若在运行则先终止 worker） */
  deleteJob(id) {
    const job = this.store.get(id);
    if (!job) return false;
    if (job.status === STATUS.QUEUED || job.status === STATUS.RUNNING) {
      this.queue.cancel(id);
      job.setStatus(STATUS.FAILED);
      job.error = 'deleted by user';
    }
    return this.store.delete(id);
  }

  getDocxPath(job) {
    if (!job.artifact) return null;
    return job.artifact.docxPath;
  }

  getCleanPath(job) {
    return job.cleanPath || null;
  }
}

module.exports = { ConversionService, HttpError };
