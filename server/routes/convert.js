/**
 * routes/convert.js — 上传转换作业
 */

const express = require('express');
const multer = require('multer');
const logger = require('../lib/logger');

module.exports = function convertRoutes({ conversion, config }) {
  const router = express.Router();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: config.maxFileSizeMb * 1024 * 1024,
      files: 1,
      fields: 4,
    },
  });

  // POST /api/convert — multipart: file(.md) + 可选 title/company/date
  router.post('/convert', (req, res) => {
    upload.single('file')(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({
            error: { code: 'FILE_TOO_LARGE', message: `文件超过 ${config.maxFileSizeMb}MB 上限` },
          });
        }
        if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
          return res.status(400).json({
            error: { code: 'INVALID_UPLOAD', message: '最多上传一个文件（字段名 file）' },
          });
        }
        logger.warn(`[convert] multer 错误: ${err.message}`);
        return res.status(400).json({
          error: { code: 'UPLOAD_ERROR', message: err.message },
        });
      }

      try {
        const job = conversion.submit(req.file, req.body, req.ip);
        res.status(202).json({ jobId: job.id, status: 'queued' });
      } catch (e) {
        const status = e.status || 500;
        if (status >= 500) logger.error(`[convert] 提交失败: ${e.stack || e.message}`);
        res.status(status).json({
          error: { code: e.code || 'INTERNAL', message: e.message || '服务器内部错误' },
        });
      }
    });
  });

  return router;
};
