/**
 * compare-pagination.js — 语义比对两个 docx 的分页属性
 *
 * 用途：验证「docx 库原生输出 cantSplit/keepNext/keepLines」是否与
 *       「python-docx 后处理注入」语义等价。
 *
 * 为什么不能逐字节比对：python-docx 保存时必然重新序列化 XML，
 * 字节差异不代表语义差异。必须比对「属性落在哪些表格行 / 哪些段落」。
 *
 * 用法: node compare-pagination.js <a.docx> <b.docx>
 */
'use strict';

const AdmZip = require('adm-zip');

function fingerprint(p) {
  const xml = new AdmZip(p).readAsText('word/document.xml');

  const rows = [...xml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)].map(m => ({
    cantSplit: /<w:cantSplit\b/.test(m[0]),
    tblHeader: /<w:tblHeader\b/.test(m[0]),
  }));

  const paras = [...xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map(m => {
    const s = m[0];
    return {
      style: (s.match(/<w:pStyle\b[^>]*w:val="([^"]+)"/) || [])[1] || null,
      keepNext: /<w:keepNext\b/.test(s),
      keepLines: /<w:keepLines\b/.test(s),
    };
  });

  return { rows, paras };
}

const [fa, fb] = process.argv.slice(2);
if (!fa || !fb) {
  console.error('用法: node compare-pagination.js <a.docx> <b.docx>');
  process.exit(1);
}

const A = fingerprint(fa);
const B = fingerprint(fb);

function stat(name, list, key) {
  const n = list.filter(x => x[key]).length;
  return `${name}.${key}=${n}/${list.length}`;
}

console.log('=== 属性覆盖统计 ===');
console.log('  A(原生):', stat('rows', A.rows, 'cantSplit'), stat('paras', A.paras, 'keepNext'), stat('paras', A.paras, 'keepLines'));
console.log('  B(补丁):', stat('rows', B.rows, 'cantSplit'), stat('paras', B.paras, 'keepNext'), stat('paras', B.paras, 'keepLines'));

let diff = 0;
if (A.rows.length !== B.rows.length) {
  console.log(`\n表格行数不同: A=${A.rows.length} B=${B.rows.length}`);
  diff++;
}
const rowDiff = [];
for (let i = 0; i < Math.min(A.rows.length, B.rows.length); i++) {
  if (A.rows[i].cantSplit !== B.rows[i].cantSplit) {
    rowDiff.push(`  行${i}: cantSplit A=${A.rows[i].cantSplit} B=${B.rows[i].cantSplit}`);
  }
}
console.log(`\n表格行 cantSplit 差异: ${rowDiff.length} 处`);
rowDiff.slice(0, 10).forEach(l => console.log(l));
diff += rowDiff.length;

if (A.paras.length !== B.paras.length) {
  console.log(`\n段落数不同: A=${A.paras.length} B=${B.paras.length}`);
  diff++;
}
const pDiff = [];
for (let i = 0; i < Math.min(A.paras.length, B.paras.length); i++) {
  const a = A.paras[i], b = B.paras[i];
  if (a.keepNext !== b.keepNext || a.keepLines !== b.keepLines) {
    pDiff.push(`  段${i}(style=${a.style}/${b.style}): keepNext A=${a.keepNext} B=${b.keepNext} | keepLines A=${a.keepLines} B=${b.keepLines}`);
  }
}
console.log(`\n段落 keepNext/keepLines 差异: ${pDiff.length} 处`);
pDiff.slice(0, 15).forEach(l => console.log(l));
diff += pDiff.length;

console.log(`\n=== 结论 ===`);
console.log(diff === 0 ? '语义等价：原生属性已完全覆盖 python-docx 后处理' : `存在 ${diff} 处语义差异，不能直接去掉 Python 后处理`);
process.exit(diff === 0 ? 0 : 1);
