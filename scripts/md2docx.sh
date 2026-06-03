#!/bin/bash
# md2docx.sh - Markdown to DOCX conversion pipeline
# Usage: ./md2docx.sh <input.md> [input2.md ...]

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Ensure dependencies are installed (idempotent)
if [ ! -d "$PROJECT_DIR/node_modules" ]; then
  echo "node_modules not found. Install dependencies now? [Y/n]"
  read -r answer < /dev/tty
  if [[ -z "$answer" || "$answer" =~ ^[Yy]$ ]]; then
    echo "=== Installing dependencies ==="
    (cd "$PROJECT_DIR" && npm install) || { echo "npm install failed"; exit 1; }
  else
    echo "Dependencies not installed. Exiting."
    exit 1
  fi
fi

# Check Node.js is available
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js is not installed or not in PATH"
  exit 1
fi

# ---- Java 检查（PlantUML 依赖）----
if ! java -version >/dev/null 2>&1; then
  echo "[警告] 未找到 Java，PlantUML 图表将无法渲染。"
  echo "       请安装 Java: https://adoptium.net"
fi

# ---- plantuml.jar 检查 ----
PLANTUML_JAR="${PROJECT_DIR}/bin/plantuml.jar"
if java -version >/dev/null 2>&1 && [ ! -f "$PLANTUML_JAR" ] && ! which plantuml >/dev/null 2>&1; then
  echo "[plantuml] 首次使用，正在下载 plantuml.jar..."
  mkdir -p "$(dirname "$PLANTUML_JAR")"
  curl -L -o "$PLANTUML_JAR" \
    "https://github.com/plantuml/plantuml/releases/latest/download/plantuml.jar"
  echo "[plantuml] 下载完成"
fi

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
