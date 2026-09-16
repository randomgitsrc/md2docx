/**
 * pipeline.js — 管线辅助库
 * 职责：
 *  - 图表数量统计（评审 M3：DoS 防护）
 *  - 图片引用路径白名单（评审 H3：防路径穿越）
 *  - 日志脱敏（评审 L8：防绝对路径泄露）
 * 纯函数 + 同步文件操作，可安全用于主线程与 worker。
 */

const fs = require('fs');
const path = require('path');

/**
 * 统计 markdown 中 mermaid / plantuml 块数量（M3）
 * @param {string} content
 * @returns {{ mermaid: number, plantuml: number, total: number }}
 */
function countDiagrams(content) {
  const mermaid = (content.match(/^```mermaid\s*$/gm) || []).length;
  const plantuml = (content.match(/^```plantuml\s*$/gm) || []).length;
  return { mermaid, plantuml, total: mermaid + plantuml };
}

/**
 * 校验并重写 clean.md 中的图片引用（H3，P0）
 * 规则：只允许引用「作业目录内」的相对路径；
 *       禁止绝对路径；禁止 `..` 越出作业目录。
 * 越界引用被替换为可见占位文本，并记入 removed。
 * @param {string} cleanPath  clean.md 的绝对路径（位于 <jobDir>/clean/）
 * @param {string} jobDir     作业工作目录绝对路径
 * @returns {{ removed: string[] }}
 */
function sanitizeImageRefs(cleanPath, jobDir) {
  const cleanDir = path.resolve(path.dirname(cleanPath));
  const jobDirResolved = path.resolve(jobDir);
  let content = fs.readFileSync(cleanPath, 'utf-8');
  const removed = [];

  const out = content.split('\n').map(line => {
    return line.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (whole, alt, src) => {
      const raw = src.trim();
      let decoded;
      try {
        decoded = decodeURIComponent(raw);
      } catch (_) {
        decoded = raw;
      }
      // 绝对路径一律拒绝（攻击面：![](/etc/shadow) 或 Windows 盘符）
      if (path.isAbsolute(decoded) || /^[A-Za-z]:[\\/]/.test(decoded)) {
        removed.push(raw);
        return `[图片引用已忽略(绝对路径): ${raw}]`;
      }
      // 以 cleanDir 为基准解析（与 md2docx appendImageParagraph 的 path.resolve(this.inputDir) 一致）
      const resolved = path.resolve(cleanDir, decoded);
      const rel = path.relative(jobDirResolved, resolved);
      const escaped = rel.startsWith('..') || path.isAbsolute(rel);
      if (escaped) {
        removed.push(raw);
        return `[图片引用已忽略(越界): ${raw}]`;
      }
      return whole; // 在作业目录内，保留
    });
  });

  if (removed.length > 0) {
    fs.writeFileSync(cleanPath, out.join('\n'), 'utf-8');
  }
  return { removed };
}

/**
 * 日志脱敏（L8）：把返回前端的日志中的作业目录绝对路径替换为 <job>
 * @param {string[]} logs
 * @param {string} jobDir
 * @returns {string[]}
 */
function sanitizeLogs(logs, jobDir) {
  const abs = path.resolve(jobDir);
  return (logs || []).map(l => String(l).split(abs).join('<job>'));
}

/**
 * 创建作业目录结构（幂等）
 * @param {string} jobDir
 * @returns {{ cleanDir, mermaidCacheDir, plantumlCacheDir, docxDir }}
 */
function buildJobDirs(jobDir) {
  const cleanDir = path.join(jobDir, 'clean');
  const mermaidCacheDir = path.join(jobDir, '.mermaid');
  const plantumlCacheDir = path.join(jobDir, '.plantuml');
  const docxDir = path.join(jobDir, 'docx');
  for (const d of [jobDir, cleanDir, mermaidCacheDir, plantumlCacheDir, docxDir]) {
    fs.mkdirSync(d, { recursive: true });
  }
  return { cleanDir, mermaidCacheDir, plantumlCacheDir, docxDir };
}

module.exports = { countDiagrams, sanitizeImageRefs, sanitizeLogs, buildJobDirs };
