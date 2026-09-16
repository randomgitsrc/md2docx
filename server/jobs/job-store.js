/**
 * job-store.js — 内存作业存储
 * 职责：
 *  - 持有 Job 对象（Map，id → Job）
 *  - 过期清理（TTL，基于内存记录）
 *  - 启动清扫孤儿目录（H4，P0）：扫描 jobsDir 下不在内存 store 的目录并删除
 *  - 一致性校验（M9）：store 有记录但目录缺失 → 标记 failed
 */

const fs = require('fs');
const path = require('path');
const logger = require('../lib/logger');
const { Job, STATUS } = require('./job');

class JobStore {
  constructor({ jobsDir, ttlMs }) {
    this.jobsDir = jobsDir;
    this.ttlMs = ttlMs;
    this.jobs = new Map(); // id → Job
  }

  set(job) {
    this.jobs.set(job.id, job);
  }

  get(id) {
    const job = this.jobs.get(id);
    if (!job) return null;
    // M9：目录一致性校验
    if (job.jobDir && !fs.existsSync(job.jobDir)) {
      if (job.status === STATUS.QUEUED || job.status === STATUS.RUNNING) {
        job.setStatus(STATUS.FAILED);
        job.error = 'artifact lost: job directory missing';
        job.addWarning('作业目录已丢失（可能被清理或服务异常）');
      }
    }
    return job;
  }

  list() {
    return [...this.jobs.values()];
  }

  delete(id) {
    const job = this.jobs.get(id);
    if (!job) return false;
    this.jobs.delete(id);
    // 幂等删除作业目录
    if (job.jobDir) {
      try {
        fs.rmSync(job.jobDir, { recursive: true, force: true });
        logger.debug(`[store] 已删除作业目录 ${job.jobDir}`);
      } catch (e) {
        logger.warn(`[store] 删除作业目录失败 ${job.jobDir}: ${e.message}`);
      }
    }
    return true;
  }

  /** 清理过期作业（done/failed 且超过 TTL；queued/running 不清理） */
  cleanupExpired(now = Date.now()) {
    let removed = 0;
    for (const job of this.jobs.values()) {
      if (job.status === STATUS.QUEUED || job.status === STATUS.RUNNING) continue;
      const finished = job.finishedAt || job.createdAt;
      if (now - finished > this.ttlMs) {
        this.delete(job.id);
        removed++;
      }
    }
    if (removed > 0) logger.debug(`[store] 过期清理: ${removed} 个作业`);
    return removed;
  }

  /** 启动清扫：删除 jobsDir 下所有不在内存 store 的孤儿目录（H4，P0） */
  cleanupOrphans() {
    if (!fs.existsSync(this.jobsDir)) {
      fs.mkdirSync(this.jobsDir, { recursive: true });
      return 0;
    }
    let removed = 0;
    for (const entry of fs.readdirSync(this.jobsDir)) {
      const p = path.join(this.jobsDir, entry);
      if (!fs.statSync(p).isDirectory()) continue;
      if (!this.jobs.has(entry)) {
        try {
          fs.rmSync(p, { recursive: true, force: true });
          logger.info(`[store] 启动清扫: 删除孤儿目录 ${p}`);
          removed++;
        } catch (e) {
          logger.warn(`[store] 清理孤儿目录失败 ${p}: ${e.message}`);
        }
      }
    }
    return removed;
  }
}

module.exports = { JobStore };
