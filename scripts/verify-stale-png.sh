#!/usr/bin/env bash
# verify-stale-png.sh — 回归：PlantUML 陈旧产物不得被复用
#
# 背景：PlantUML 在「块内无 @startuml」时 exit code 0 且不写任何文件。
# 若渲染前不删旧产物、且仅凭 fs.existsSync 判成功，就会把上一份文档的
# PNG 当成本次结果——静默产出内容错误的正式文档。
#
# 本脚本按「先正常文档、后非法文档」顺序转换，断言后者必须降级为代码块。
# 用法: bash scripts/verify-stale-png.sh
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/md/qa/stale-png"
OUT="$DIR/output"

rm -rf "$OUT"

echo "=== 步骤 1/2：转换正常文档 docA（生成 plantuml 产物）==="
"$ROOT/scripts/md2docx.sh" "$DIR/docA.md" >/dev/null 2>&1 || { echo "FAIL: docA 转换失败"; exit 1; }
A_PNG=$(ls "$OUT/.plantuml"/*.png 2>/dev/null | head -1)
if [ -z "$A_PNG" ]; then echo "FAIL: docA 未生成 plantuml PNG"; exit 1; fi
A_SUM=$(md5sum "$A_PNG" | cut -d' ' -f1)
echo "    docA 产物: $(basename "$A_PNG")  md5=$A_SUM"

echo "=== 步骤 2/2：转换非法文档 docB（plantuml 块无 @startuml）==="
"$ROOT/scripts/md2docx.sh" "$DIR/docB.md" >/dev/null 2>&1
CLEAN="$OUT/clean/docB.clean.md"
if [ ! -f "$CLEAN" ]; then echo "FAIL: docB 未生成 clean.md"; exit 1; fi

IMG_REF=$(grep -o '!\[[^]]*\]([^)]*)' "$CLEAN" | head -1)
if [ -n "$IMG_REF" ]; then
  echo "FAIL: docB 嵌入了图片引用，应降级为代码块：$IMG_REF"
  echo "      （说明复用了陈旧产物——静默错图）"
  exit 1
fi

if ! grep -q '```text' "$CLEAN"; then
  echo "FAIL: docB 既无图片也无 text 代码块，结果异常"
  exit 1
fi

echo "    docB 已正确降级为 text 代码块（未复用 docA 的图）"
echo ""
echo "PASS: 陈旧产物未被复用"
