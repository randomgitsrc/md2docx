/**
 * job-queue.js — 并发受限作业队列（worker_threads 池）
 * 职责：
 *  - 并发上限 maxConcurrent（超出排队）
 *  - 每个作业 spawn 一个 Worker 线程跑 job-worker.js（隔离 execSync，H1）
 *  - 转发 worker 的 progress/log/done/error 消息到 Job 对象
 *  - 队列长度上限（M3）
 *  - 优雅关闭（H4，P0）：停止入队，等待 running 完成（带超时）
 */

const { Worker } = require('worker_threads');
const path = require('path');
const logger = require('../lib/logger');
const { STATUS } = require('./job');

class JobQueue {
  constructor({ maxConcurrent, queueLimit, jobTimeoutMs }) {
    this.maxConcurrent = maxConcurrent;
    this.queueLimit = queueLimit;
    this.jobTimeoutMs = jobTimeoutMs;
    this.pending = [];   // queued jobs (FIFO)
    this.running = 0;    // 当前运行中的 worker 数
    this.shuttingDown = false;
    this._workers = new Map(); // jobId → worker（用于 cancel 运行中作业）
  }

  get length() {
    return this.pending.length;
  }

  /** 入队。返回 true 成功；队列满返回 false（调用方回 429） */
  enqueue(job) {
    if (this.shuttingDown) return false;
    if (this.pending.length + this.running >= this.queueLimit) return false;
    this.pending.push(job);
    job.setStatus(STATUS.QUEUED);
    logger.info(`[queue] 作业 ${job.id} 入队 (pending=${this.pending.length}, running=${this.running})`);
    this._pump();
    return true;
  }

  _pump() {
    while (!this.shuttingDown && this.running < this.maxConcurrent && this.pending.length > 0) {
      const job = this.pending.shift();
      this._start(job);
    }
  }

  _start(job) {
    this.running++;
    job.setStatus(STATUS.RUNNING);
    job.addLog(`作业开始执行 (并发槽位 ${this.running}/${this.maxConcurrent})`);

    const workerPath = path.join(__dirname, 'job-worker.js');
    const workerData = {
      jobId: job.id,
      jobDir: job.jobDir,
      uploadPath: path.join(job.jobDir, 'upload.md'),
      overrides: job.overrides,
      originalName: job.originalName,
    };

    let worker;
    try {
      worker = new Worker(workerPath, { workerData });
      this._workers.set(job.id, worker);
    } catch (e) {
      logger.error(`[queue] 启动 worker 失败 ${job.id}: ${e.message}`);
      this.running--;
      job.setStatus(STATUS.FAILED);
      job.error = `worker spawn failed: ${e.message}`;
      this._pump();
      return;
    }

    // 超时保护
    const timer = setTimeout(() => {
      logger.warn(`[queue] 作业 ${job.id} 超时(${this.jobTimeoutMs}ms)，终止 worker`);
      worker.terminate();
    }, this.jobTimeoutMs);

    const settle = { done: false };

    worker.on('message', (msg) => {
      switch (msg.type) {
        case 'progress':
          job.setProgress(msg.value);
          if (msg.message) job.addLog(msg.message);
          break;
        case 'log':
          job.addLog(msg.line);
          break;
        case 'done': {
          if (settle.done) return;
          settle.done = true;
          clearTimeout(timer);
          job.setProgress(100);
          job.setArtifact(msg.outputPath, msg.stats ? msg.stats.sizeBytes : 0);
          job.cleanPath = msg.cleanPath || null;
          job.setStatus(STATUS.DONE);
          logger.info(`[queue] 作业 ${job.id} 完成 → ${msg.outputPath}`);
          this._finish(job, worker);
          break;
        }
        case 'error': {
          if (settle.done) return;
          settle.done = true;
          clearTimeout(timer);
          job.setStatus(STATUS.FAILED);
          job.error = msg.message || 'conversion failed';
          job.addLog(`[错误] ${msg.message}`);
          if (msg.stack) logger.debug(`[queue] 作业 ${job.id} 错误堆栈:\n${msg.stack}`);
          logger.warn(`[queue] 作业 ${job.id} 失败: ${job.error}`);
          this._finish(job, worker);
          break;
        }
        default:
          break;
      }
    });

    worker.on('error', (err) => {
      if (settle.done) return;
      settle.done = true;
      clearTimeout(timer);
      job.setStatus(STATUS.FAILED);
      job.error = `worker error: ${err.message || err}`;
      job.addLog(`[错误] ${job.error}`);
      this._finish(job, worker);
    });

    worker.on('exit', (code) => {
      clearTimeout(timer);
      if (!settle.done) {
        // worker 意外退出（未发 done/error）
        settle.done = true;
        job.setStatus(STATUS.FAILED);
        job.error = `worker exited unexpectedly (code=${code})`;
        job.addLog(`[错误] worker 异常退出 (code=${code})`);
        this._finish(job, worker);
      }
    });
  }

  _finish(job, worker) {
    this.running--;
    this._workers.delete(job.id);
    worker.terminate().catch(() => {});
    this._pump();
  }

  /**
   * 取消作业：终止运行中的 worker（用于 DELETE 运行中作业）
   * @param {string} jobId
   * @returns {boolean} 是否取消了运行中的 worker
   */
  cancel(jobId) {
    const worker = this._workers.get(jobId);
    if (!worker) return false;
    this._workers.delete(jobId);
    logger.info(`[queue] 作业 ${jobId} 被取消，终止 worker`);
    worker.terminate().catch(() => {});
    return true;
  }

  /**
   * 优雅关闭（H4，P0）：拒绝新作业，等待 running 完成。
   * @returns {Promise<void>} 所有 running 结束后 resolve（超时由调用方控制）
   */
  async shutdown(timeoutMs) {
    this.shuttingDown = true;
    if (this.running === 0) return;
    logger.info(`[queue] 优雅关闭: 等待 ${this.running} 个运行中作业完成 (超时 ${timeoutMs}ms)`);
    const deadline = Date.now() + timeoutMs;
    while (this.running > 0 && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 200));
    }
    if (this.running > 0) {
      logger.warn(`[queue] 优雅关闭超时，仍有 ${this.running} 个作业在运行`);
    }
  }
}

module.exports = { JobQueue };
