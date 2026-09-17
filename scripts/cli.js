#!/usr/bin/env node
/**
 * cli.js — 跨平台 CLI 入口（替代仅支持 bash 的 md2docx.sh）
 *
 * 为什么需要它：`md2docx.sh` 是 bash 脚本，Windows 上不可用。
 * 本入口用纯 Node 实现同样的两阶段流水线，Windows / Linux / macOS 通用。
 *
 * 用法:
 *   node scripts/cli.js <input.md> [more.md ...]
 *   node scripts/cli.js --help
 *
 * 输出（与 md2docx.sh 一致）:
 *   <输入文件所在目录>/output/clean/<名字>.clean.md
 *   <输入文件所在目录>/output/docx/<名字>.docx
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { preprocess } = require('./preprocess');
const { convert } = require('./md2docx');

const USAGE = `用法: node scripts/cli.js <input.md> [input2.md ...]

把 Markdown 转换为符合规范的 DOCX（两阶段流水线：预处理 + 转换）。

产物位置（与输入文件同级）:
  <输入目录>/output/clean/<名字>.clean.md
  <输入目录>/output/docx/<名字>.docx

可选环境变量:
  PLANTUML_BACKEND=core|jar|auto   PlantUML 渲染后端（默认 auto）
  PUPPETEER_EXECUTABLE_PATH=<path> 显式指定 Chrome/Chromium/Edge

示例:
  node scripts/cli.js md/手册.md
  node scripts/cli.js md/a.md md/b.md
`;

async function convertOne(mdPath) {
  const abs = path.resolve(mdPath);
  const inputDir = path.dirname(abs);

  // 两阶段：preprocess 负责渲染图表并产出 clean.md，convert 负责生成 docx
  const pre = preprocess(abs, {});
  const cleanPath = pre.outputPath;

  const out = path.join(inputDir, 'output', 'docx', `${path.basename(abs, '.md')}.docx`);
  const result = await convert(cleanPath, { outputPath: out });

  const size = fs.statSync(result.outputPath).size;
  return { docx: result.outputPath, size };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
    console.log(USAGE);
    process.exit(argv.length === 0 ? 1 : 0);
  }

  const failed = [];
  for (const md of argv) {
    if (!fs.existsSync(md)) {
      console.error(`错误: 文件不存在: ${md}`);
      failed.push(md);
      continue;
    }
    console.log(`=== 处理: ${md} ===`);
    try {
      const r = await convertOne(md);
      console.log(`=== 完成: ${r.docx} (${(r.size / 1024).toFixed(1)} KB) ===`);
    } catch (e) {
      console.error(`错误: 转换失败: ${md}`);
      console.error(`  ${e && e.message ? e.message : e}`);
      failed.push(md);
    }
  }

  if (failed.length > 0) {
    console.error('');
    console.error('=== 失败的文件 ===');
    for (const f of failed) console.error(`  ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`错误: ${e && e.stack ? e.stack : e}`);
  process.exit(1);
});
