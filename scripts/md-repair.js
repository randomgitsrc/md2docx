/**
 * md-repair.js — Markdown 源文兼容修复（preprocess 与 md2docx 共用）
 *
 * 为什么单独成模块：同一处修复必须**两条路径都生效**。
 * preprocess → md2docx 是推荐入口，但用户也可能直接把 md 交给 md2docx.js；
 * 若只在 preprocess 里修，绕过推荐入口就会踩坑（本文件首个函数即因此抽出）。
 */

'use strict';

/**
 * 修复「图片路径含空格但未转义」的引用。
 *
 * 现象：`![图B](assets/我的 图片.png)` 这种写法，CommonMark 规定链接/图片目标
 * 中的裸空格必须用 `<>` 包裹或 `%20` 转义，否则整段**不被解析为图片**，
 * 而是作为纯文本原样输出——成品文档里会赫然印着一行 Markdown 源码。
 * Windows 上文件名含空格极常见（`我的 图片.png`、`架构 图.png`），
 * 属于会实际踩中的静默缺陷。
 *
 * 处理：`![alt](路径 含 空格)` → `![alt](<路径 含 空格>)`
 *
 * 安全约束（避免误伤正文与既有合法写法）：
 *   · 围栏代码块内不改写（``` / ~~~ 之间）
 *   · 已是 `<...>` 尖括号写法的不动
 *   · 已用 %20 转义的不动
 *   · 括号内含嵌套括号的不匹配（正则排除 ()<>）
 *   · 改写后用 markdown-it **复验能解析出 image token**，否则回滚原文
 *
 * @param {string} content
 * @returns {{ content: string, repaired: number }}
 */
function repairUnescapedImagePaths(content) {
  const MarkdownIt = require('markdown-it');
  const lines = content.split('\n');
  const out = [];
  let inFence = false;
  let repaired = 0;
  let i = 0;

  // 只处理 ![alt](target) 且 target 含空格、无 <>、无嵌套括号的情况
  const RE = /!\[([^\]]*)\]\(([^()<>]*?\s+[^()<>]*?)\)/g;

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*(```+|~~~+)/.test(line)) {
      inFence = !inFence;
      out.push(line);
      i++;
      continue;
    }
    if (inFence) {
      out.push(line);
      i++;
      continue;
    }

    const rewritten = line.replace(RE, (whole, alt, target) => {
      const t = target.trim();
      if (!t) return whole;
      if (/%20/i.test(t)) return whole;          // 已转义
      if (!/\s/.test(t)) return whole;           // 无空格，无需处理
      return `![${alt}](<${t}>)`;
    });

    if (rewritten !== line) {
      // 复验：改写后必须真能解析出图片，否则保留原文（宁可原样也不误改）
      try {
        const md = new MarkdownIt();
        const toks = md.parse(rewritten, {});
        const hasImage = toks.some((tk) =>
          tk.children && tk.children.some((c) => c.type === 'image'));
        if (hasImage) { repaired++; out.push(rewritten); i++; continue; }
      } catch (_) { /* 复验失败则回滚 */ }
      out.push(line);
      i++;
      continue;
    }

    out.push(line);
    i++;
  }

  return { content: out.join('\n'), repaired };
}

module.exports = { repairUnescapedImagePaths };
