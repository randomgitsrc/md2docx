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
      // requiredKeys：缺失即为真问题（status 会变 degraded）。
      // 其余为可选依赖，界面应显示为灰色而非红色 ✗。
      // 每条依赖自身也带 required / applicable（applicable=false 表示
      // 当前 PlantUML 后端用不到它，例如 core 后端下的 java/graphviz）。
      requiredKeys: d.requiredKeys,
      optionalKeys: d.optionalKeys,
      plantumlBackend: d.plantumlBackend,
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
