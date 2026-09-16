/**
 * routes/jobs.js — 作业查询 / 下载 / 删除
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const { sanitizeLogs } = require('../lib/pipeline');

const DOCX_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

module.exports = function jobsRoutes({ conversion }) {
  const router = express.Router();

  // GET /api/jobs?limit&offset — 作业列表（不含 logs，脱敏）
  router.get('/jobs', (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const jobs = conversion.listJobs(limit, offset).map(j => j.toPublic({ includeLogs: false }));
    res.json({ jobs, limit, offset, total: conversion.store.list().length });
  });

  // GET /api/jobs/:id — 作业详情（logs 脱敏 L8）
  router.get('/jobs/:id', (req, res) => {
    const job = conversion.getJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: '作业不存在或已过期' } });
    }
    const pub = job.toPublic({ includeLogs: true });
    pub.logs = sanitizeLogs(pub.logs, job.jobDir);
    res.json(pub);
  });

  // GET /api/jobs/:id/download — 下载 docx（M2）
  router.get('/jobs/:id/download', (req, res) => {
    const job = conversion.getJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: '作业不存在或已过期' } });
    }
    if (job.status !== 'done' || !job.artifact) {
      return res.status(409).json({
        error: { code: 'JOB_NOT_DONE', message: `作业尚未完成（当前状态: ${job.status}）` },
      });
    }
    const docxPath = conversion.getDocxPath(job);
    if (!docxPath || !fs.existsSync(docxPath)) {
      return res.status(404).json({ error: { code: 'ARTIFACT_MISSING', message: '产物文件丢失' } });
    }
    res.setHeader('Content-Type', DOCX_CT);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(job.artifact.fileName)}"`);
    res.setHeader('Content-Length', job.artifact.sizeBytes);
    fs.createReadStream(docxPath).pipe(res);
  });

  // GET /api/jobs/:id/clean — 下载 clean.md（调试用，M2）
  router.get('/jobs/:id/clean', (req, res) => {
    const job = conversion.getJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: '作业不存在或已过期' } });
    }
    if (job.status !== 'done' || !job.cleanPath) {
      return res.status(409).json({
        error: { code: 'JOB_NOT_DONE', message: `作业尚未完成（当前状态: ${job.status}）` },
      });
    }
    if (!fs.existsSync(job.cleanPath)) {
      return res.status(404).json({ error: { code: 'ARTIFACT_MISSING', message: 'clean.md 丢失' } });
    }
    const cleanName = job.originalName.replace(/\.md$/i, '.clean.md');
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(cleanName)}"`);
    fs.createReadStream(job.cleanPath).pipe(res);
  });

  // DELETE /api/jobs/:id — 清理作业（幂等）
  router.delete('/jobs/:id', (req, res) => {
    const job = conversion.getJob(req.params.id);
    if (!job) {
      return res.status(204).end(); // 幂等
    }
    conversion.deleteJob(req.params.id);
    res.status(204).end();
  });

  return router;
};
