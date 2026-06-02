#!/bin/bash
# md2docx.sh - Markdown to DOCX conversion pipeline
# Usage: ./md2docx.sh <input.md> [input2.md ...]

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

usage() {
  cat <<'EOF'
Usage: md2docx.sh [OPTIONS] <input.md> [input2.md ...]

Markdown to DOCX conversion pipeline (preprocess + convert).

Options:
  -h, --help    Show this help message

Examples:
  md2docx.sh md/104-xxx.md
  md2docx.sh md/104-*.md md/105-*.md
EOF
}

if [ $# -eq 0 ]; then
  usage
  exit 1
fi

case "$1" in
  -h|--help) usage; exit 0;;
esac

failed=()

for md in "$@"; do
  if [ ! -f "$md" ]; then
    echo "ERROR: File not found: $md"
    failed+=("$md")
    continue
  fi

  input_dir="$(cd "$(dirname "$md")" && pwd)"
  basename_md="$(basename "$md" .md)"
  clean_md="${input_dir}/output/clean/${basename_md}.clean.md"
  docx="${input_dir}/output/docx/${basename_md}.docx"

  echo "=== Preprocessing: $md ==="
  if ! node "${PROJECT_DIR}/scripts/preprocess.js" "$md"; then
    echo "ERROR: Preprocess failed: $md"
    failed+=("$md")
    continue
  fi

  if [ ! -f "$clean_md" ]; then
    echo "ERROR: Clean file not found: $clean_md"
    failed+=("$md")
    continue
  fi

  echo "=== Converting to DOCX: $clean_md ==="
  if ! node "${PROJECT_DIR}/scripts/md2docx.js" "$clean_md"; then
    echo "ERROR: Conversion failed: $md"
    failed+=("$md")
    continue
  fi

  if [ -f "$docx" ]; then
    size=$(du -h "$docx" | cut -f1)
    echo "=== Done: $docx ($size) ==="
  else
    echo "ERROR: DOCX not generated: $md"
    failed+=("$md")
  fi
done

if [ ${#failed[@]} -gt 0 ]; then
  echo ""
  echo "=== Failed files ==="
  for f in "${failed[@]}"; do
    echo "  $f"
  done
  exit 1
fi
