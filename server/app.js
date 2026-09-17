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

  // 端口被占用时自动向后找一个空闲端口（离线单机上 8080 常被占用，
  // 若直接失败用户只会看到"页面打不开"）。PORT=0 表示交给系统分配。
  const net = require('net');
  const probePort = (port) => new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, config.host);
  });

  (async () => {
    let port = config.port;
    if (port !== 0) {
      const maxTry = 20;
      for (let i = 0; i < maxTry; i++) {
        if (await probePort(port + i)) { port = port + i; break; }
        if (i === maxTry - 1) {
          logger.warn(`[app] ${config.port}~${config.port + maxTry - 1} 均被占用，改由系统分配端口`);
          port = 0;
        }
      }
    }

    const server = app.listen(port, config.host, () => {
      const actual = server.address().port;
      const url = `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${actual}/`;
      logger.info(`md2docx HTTP 服务已启动: ${url}`);
      logger.info(`  作业目录: ${config.jobsDir}（并发上限 ${config.maxConcurrent}）`);
      // 供启动脚本/桌面端读取实际端口（避免硬编码 8080 打不开）。
      // 失败不致命，但必须留痕——静默吞错会让"启动脚本读不到地址"难以排查。
      try {
        fs.mkdirSync(config.dataDir, { recursive: true });
        fs.writeFileSync(path.join(config.dataDir, 'server-url.txt'), url, 'utf8');
      } catch (e) {
        logger.warn(`[app] 写入 server-url.txt 失败（不影响服务）: ${e.message}`);
      }
      // 启动时探测依赖（预热缓存，M5）
      deps.probe();
      // 自动打开浏览器（离线一键启动时用；设 NO_OPEN_BROWSER=1 可关闭）
      if (process.env.NO_OPEN_BROWSER !== '1' && process.env.MD2DOCX_OPEN_BROWSER === '1') {
        const { runFile } = require('../scripts/exec-util');
        if (process.platform === 'win32') runFile('cmd', ['/c', 'start', '', url], { allowFailure: true });
        else if (process.platform === 'darwin') runFile('open', [url], { allowFailure: true });
        else runFile('xdg-open', [url], { allowFailure: true });
      }
    });
  })();
}

module.exports = { createApp };
