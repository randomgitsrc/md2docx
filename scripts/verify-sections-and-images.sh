#!/usr/bin/env bash
# verify-sections-and-images.sh — 回归：分节无空节 + 作者本地图片不丢失
#
# 覆盖两个已修缺陷（详见 docs/issues/）：
#   001 连续横置图之间 / 文档末尾不得产生零内容空节
#   002 完整流水线（两阶段）必须能解析作者自带的本地图片
#
# 两者都是"静默失效"型问题：不报错，只是产出多一页空白 / 少一张图，
# 因此需要断言而不是靠肉眼。
#
# 用法: bash scripts/verify-sections-and-images.sh
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE_MODULES="$ROOT/node_modules"
FAIL=0

echo "=== 步骤 1/3：作者自带本地图片不丢失（缺陷 002）==="
"$ROOT/scripts/md2docx.sh" "$ROOT/md/qa/local-image/index.md" >/dev/null 2>&1 \
  || { echo "FAIL: 转换失败"; exit 1; }
IMG_DOCX="$ROOT/md/qa/local-image/output/docx/index.docx"
if [ ! -f "$IMG_DOCX" ]; then echo "FAIL: 未生成 $IMG_DOCX"; exit 1; fi

NODE_PATH="$NODE_MODULES" node -e '
const AdmZip = require("adm-zip");
const x = new AdmZip(process.argv[1]).readAsText("word/document.xml");
const n = (x.match(/<w:drawing>/g) || []).length;
// 用例含 2 张作者图片 + 1 张 mermaid 渲染图 = 3
if (n !== 3) { console.error(`FAIL: 图片数 ${n}，期望 3（2 作者图 + 1 渲染图）`); process.exit(1); }
if (x.includes("图片缺失")) { console.error("FAIL: 出现图片缺失占位"); process.exit(1); }
console.log(`    嵌入图片 ${n} 张（2 张作者自带 + 1 张渲染），无缺失`);
' "$IMG_DOCX" || FAIL=1

echo "=== 步骤 2/3：连续横置图之间无空节（缺陷 001）==="
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# 造一张必然判定为横置的 PNG：3000x800（downscaleRatio>3 且 aspectRatio>2.0）
NODE_PATH="$NODE_MODULES" node -e '
const zlib = require("zlib"), fs = require("fs");
const w = 3000, h = 800;
const raw = Buffer.alloc((w * 3 + 1) * h);
for (let y = 0; y < h; y++) {
  raw[y * (w * 3 + 1)] = 0;
  for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = 30; raw[o + 1] = 30; raw[o + 2] = 30; }
}
const T = [...Array(256)].map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = b => { let c = 0xFFFFFFFF; for (const x of b) c = T[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
const ch = (t, d) => { const L = Buffer.alloc(4); L.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const C = Buffer.alloc(4); C.writeUInt32BE(crc(td)); return Buffer.concat([L, td, C]); };
const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
fs.writeFileSync(process.argv[1], Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch("IHDR", ih), ch("IDAT", zlib.deflateSync(raw)), ch("IEND", Buffer.alloc(0))]));
' "$TMP/wide.png"

# 关键：本步要**独立**复现缺陷 001，不能依赖缺陷 002 的修复。
# 因此不用"作者旁边的图片"（那需 002 才解析得到），而是把宽图直接放在
# output/clean/ 下——该位置在修复前后都能被解析（旧代码也只认 inputDir），
# 于是横置节必定生成，本步断言才真在检验"空节"而非"图片能否找到"。
mkdir -p "$TMP/output/clean"
cp "$TMP/wide.png" "$TMP/output/clean/wide.png"
printf -- '---\ntitle: 分节回归\n---\n\n# 分节回归\n\n## 1 连续横置\n\n正文一。\n\n![](wide.png)\n\n**图 1-1 第一张宽图**\n\n![](wide.png)\n\n**图 1-2 第二张宽图**\n\n## 2 结尾横置\n\n![](wide.png)\n\n**图 1-3 结尾宽图**\n' > "$TMP/output/clean/sec.clean.md"

node "$ROOT/scripts/md2docx.js" "$TMP/output/clean/sec.clean.md" >/dev/null 2>&1 \
  || { echo "FAIL: 分节用例转换失败"; exit 1; }

NODE_PATH="$NODE_MODULES" node -e '
const AdmZip = require("adm-zip");
const x = new AdmZip(process.argv[1]).readAsText("word/document.xml");
const body = x.slice(x.indexOf("<w:body>") + 8, x.lastIndexOf("</w:body>"));
const toks = [...body.matchAll(/<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>|<w:tbl>[\s\S]*?<\/w:tbl>|<w:sectPr[\s\S]*?<\/w:sectPr>/g)].map(m => m[0]);
let secs = [{ items: [] }];
for (const t of toks) {
  const sp = /<w:sectPr[\s\S]*?<\/w:sectPr>/.exec(t);
  if (sp) {
    const pg = /<w:pgSz w:w="(\d+)" w:h="(\d+)"/.exec(sp[0]);
    Object.assign(secs[secs.length - 1], { pg: pg && pg.slice(1).map(Number) });
    if (!(t.startsWith("<w:p") && t.replace(sp[0], "").replace(/<[^>]+>/g, "").trim())) secs.push({ items: [] });
    else secs[secs.length - 1].items.push(t);
  } else secs[secs.length - 1].items.push(t);
}
const valid = secs.filter(s => s.pg);
const empty = valid.filter(s => {
  const p = s.items.filter(t => t.startsWith("<w:p")).length;
  const tb = s.items.filter(t => t.startsWith("<w:tbl>")).length;
  const img = s.items.filter(t => /<w:drawing>/.test(t)).length;
  return p === 0 && tb === 0 && img === 0;
});
if (empty.length > 0) { console.error(`FAIL: 出现 ${empty.length} 个零内容空节（会变成空白页）`); process.exit(1); }
const land = valid.filter(s => s.pg[0] > s.pg[1]).length;
// 断言必须同时确认"横置节确实存在"，否则本步会**假通过**：
// 若图片没被解析出来（缺陷 002），压根不会产生横置节，"无空节"便成了空转断言。
const imgs = (x.match(/<w:drawing>/g) || []).length;
if (imgs !== 3) { console.error(`FAIL: 图片数 ${imgs}，期望 3（图片未解析则本步断言无效）`); process.exit(1); }
if (land < 3) { console.error(`FAIL: 横置节仅 ${land} 个，期望 >=3（3 张宽图各需一个横置节）`); process.exit(1); }
console.log(`    共 ${valid.length} 节（横置 ${land} 节，图 ${imgs} 张），零内容空节 0 个`);
' "$TMP/output/docx/sec.docx" || FAIL=1

echo "=== 步骤 3/3：既有 QA 用例未回归 ==="
for f in wide-table caption-forms crlf-test bom-duplicate-key plantuml-no-end; do
  if "$ROOT/scripts/md2docx.sh" "$ROOT/md/qa/$f.md" >/dev/null 2>&1; then
    printf "    %-20s OK\n" "$f"
  else
    printf "    %-20s FAIL\n" "$f"; FAIL=1
  fi
done

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "PASS: 分节无空节、作者本地图片不丢失、既有用例无回归"
else
  echo "FAIL: 存在未通过项（见上）"
  exit 1
fi
