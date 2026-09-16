/**
 * rate-limit.js — 最简 IP 速率限制（滑动窗口计数，M3）
 * 不引入 express-rate-limit 依赖，自写令牌桶式滑动窗口。
 */

const logger = require('../lib/logger');

function createRateLimiter({ windowMs, max }) {
  const hits = new Map(); // ip → number[]（时间戳数组）
  setInterval(() => {
    const now = Date.now();
    for (const [ip, arr] of hits) {
      while (arr.length && arr[0] < now - windowMs) arr.shift();
      if (arr.length === 0) hits.delete(ip);
    }
  }, windowMs).unref();

  return (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const arr = hits.get(ip) || [];
    while (arr.length && arr[0] < now - windowMs) arr.shift();
    if (arr.length >= max) {
      logger.warn(`[rate-limit] IP ${ip} 触发限流 (${arr.length}/${max})`);
      return res.status(429).json({
        error: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试' },
      });
    }
    arr.push(now);
    hits.set(ip, arr);
    next();
  };
}

module.exports = { createRateLimiter };
