/**
 * routes/health.js — 健康检查
 */

const express = require('express');
const router = express.Router();

module.exports = function healthRoutes({ deps }) {
  // GET /api/health — 服务状态 + 依赖（TTL 缓存，M5）
  router.get('/health', (req, res) => {
    const d = deps.get();
    res.json({
      status: d.allOk ? 'ok' : 'degraded',
      uptimeSec: Math.round(process.uptime()),
      deps: {
        node: d.node,
        chrome: d.chrome,
        plantuml: d.plantuml,
        java: d.java,
        graphviz: d.graphviz,
      },
    });
  });

  return router;
};
