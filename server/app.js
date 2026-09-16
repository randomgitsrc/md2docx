/**
 * app.js — md2docx HTTP 服务入口
 * 职责：
 *  - Express 装配（静态资源、路由、错误中间件）
 *  - 依赖注入（config / store / queue / conversion / deps）
 *  - 启动清扫孤儿目录（H4）
 *  - 定时 TTL 清理
 *  - 优雅关闭（SIGTERM/SIGINT，H4）
 */

const path = require('path');
const express = require('express');
const fs = require('fs');

const config = require('./config');
const logger = require('./lib/logger');
const { createRateLimiter } = require('./lib/rate-limit');
const { JobStore } = require('./jobs/job-store');
const { JobQueue } = require('./jobs/job-queue');
const { ConversionService } = require('./services/conversion-service');
const { DependencyCheck } = require('./services/dependency-check');

function createApp(overrides = {}) {
  const cfg = { ...config, ...overrides };

  // ---------- 依赖装配 ----------
  const store = new JobStore({ jobsDir: cfg.jobsDir, ttlMs: cfg.jobTtlMinutes * 60 * 1000 });
  const queue = new JobQueue({
    maxConcurrent: cfg.maxConcurrent,
    queueLimit: cfg.queueLimit,
    jobTimeoutMs: cfg.jobTimeoutMs,
  });
  const conversion = new ConversionService({
    jobsDir: cfg.jobsDir,
    store,
    queue,
    maxFileSizeMb: cfg.maxFileSizeMb,
    maxDiagrams: cfg.maxDiagrams,
  });
  const deps = new DependencyCheck({ ttlMs: cfg.healthCacheTtlMs });

  // ---------- 启动清扫孤儿目录（H4，P0） ----------
  store.cleanupOrphans();

  // ---------- Express 应用 ----------
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  // 静态资源（Web 页面）
  const publicDir = path.join(__dirname, 'public');
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir, { index: 'index.html' }));
  }

  // JSON 解析（用于未来扩展；上传走 multer）
  app.use(express.json({ limit: '100kb' }));

  // 限流（只对提交端点）
  const submitLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: cfg.rateLimitPerMinute,
  });
  app.use('/api/convert', submitLimiter);

  // 路由
  app.use('/api', require('./routes/health')({ deps }));
  app.use('/api', require('./routes/convert')({ conversion, config: cfg }));
  app.use('/api', require('./routes/jobs')({ conversion }));

  // 404（API）
  app.use('/api', (req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: `未知 API: ${req.method} ${req.path}` } });
  });

  // 统一错误中间件
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    logger.error(`[app] 未处理错误: ${err.stack || err.message}`);
    res.status(500).json({ error: { code: 'INTERNAL', message: '服务器内部错误' } });
  });

  // ---------- 定时清理 ----------
  const cleanupTimer = setInterval(() => {
    store.cleanupExpired();
  }, cfg.cleanupIntervalMinutes * 60 * 1000);
  cleanupTimer.unref();

  // ---------- 优雅关闭 ----------
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`[app] 收到 ${signal}，开始优雅关闭...`);
    clearInterval(cleanupTimer);
    await queue.shutdown(cfg.gracefulTimeoutMs);
    logger.info('[app] 已关闭');
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  app.locals = { ...app.locals, config: cfg, store, queue, conversion, deps };

  return { app, store, queue, conversion, deps };
}

// 直接运行时启动服务（require 时不启动，便于测试）
if (require.main === module) {
  const { app, deps } = createApp();
  app.listen(config.port, config.host, () => {
    logger.info(`md2docx HTTP 服务已启动: http://${config.host}:${config.port}`);
    logger.info(`  Web 页面: http://localhost:${config.port}/`);
    logger.info(`  作业目录: ${config.jobsDir}（并发上限 ${config.maxConcurrent}）`);
    // 启动时探测依赖（预热缓存，M5）
    deps.probe();
  });
}

module.exports = { createApp };
