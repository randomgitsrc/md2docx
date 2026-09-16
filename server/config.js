/**
 * config.js — md2docx HTTP 服务配置
 * 全部可通过环境变量覆盖（便于 Docker 部署）
 */

const path = require('path');

function num(envVal, def) {
  const n = parseInt(envVal, 10);
  return Number.isFinite(n) && n > 0 ? n : def;
}

function bool(envVal, def) {
  if (envVal === undefined) return def;
  return !['0', 'false', 'no'].includes(String(envVal).toLowerCase());
}

const config = {
  // 服务监听
  port: num(process.env.PORT, 8080),
  host: process.env.HOST || '0.0.0.0',

  // 数据目录（作业工作目录）
  dataDir: path.resolve(process.env.DATA_DIR || 'data'),
  get jobsDir() {
    return path.join(this.dataDir, 'jobs');
  },

  // 并发与队列
  maxConcurrent: num(process.env.MAX_CONCURRENT, 2),
  queueLimit: num(process.env.QUEUE_LIMIT, 50),          // 排队上限（超出 429）

  // 上传校验
  maxFileSizeMb: num(process.env.MAX_FILE_SIZE_MB, 20),
  maxDiagrams: num(process.env.MAX_DIAGRAMS, 30),        // mermaid+plantuml 块数上限

  // 作业生命周期
  jobTtlMinutes: num(process.env.JOB_TTL_MINUTES, 60),
  cleanupIntervalMinutes: num(process.env.CLEANUP_INTERVAL_MINUTES, 10),
  gracefulTimeoutMs: num(process.env.GRACEFUL_TIMEOUT_MS, 30000),

  // 防护
  rateLimitPerMinute: num(process.env.RATE_LIMIT_PER_MINUTE, 20), // 每 IP 每分钟提交上限

  // 依赖探测缓存（毫秒）
  healthCacheTtlMs: num(process.env.HEALTH_CACHE_TTL_MS, 60000),

  // 作业处理超时（毫秒，worker 内转换超时保护）
  jobTimeoutMs: num(process.env.JOB_TIMEOUT_MS, 900000),

  // 调试
  debug: bool(process.env.DEBUG, false),
};

module.exports = config;
