# PlantUML 支持方案（修正版）

## 目标

在 md2docx 中支持 ` ```plantuml ``` ` 代码块，渲染为 PNG 嵌入 DOCX，与现有 Mermaid 支持并存，保持一致的处理架构。

---

## 总体设计

### 架构复用

PlantUML 的处理架构与 Mermaid 保持完全一致：

```
preprocess.js（可选预处理）
  mermaid 块 → renderMermaidBlocks() → PNG 文件 → ![](xxx.png) 引用
  plantuml 块 → renderPlantUMLBlocks() → PNG 文件 → ![](xxx.png) 引用

md2docx.js（转换主流程）
  fence token: lang=mermaid  → appendMermaid()  → renderMermaid()  → 嵌入 PNG
  fence token: lang=plantuml → appendPlantUML() → renderPlantUML() → 嵌入 PNG
  ![](xxx.png) 引用 → appendImage() → 嵌入 PNG（同现有逻辑）
```

preprocess 和 md2docx 两条路径都能独立工作。preprocess 先跑时，plantuml 块已变成图片引用，md2docx 不会再遇到 plantuml 块；直接跑 md2docx 时，plantuml 块由 md2docx 自身渲染。

### 共享模块

新建 `scripts/plantuml-renderer.js`，导出两个函数，供 preprocess.js 和 md2docx.js 共同引用：

- `findPlantUML()` — 找到可用的 plantuml 运行方式
- `renderPlantUML(code, tmpDir, index)` — 渲染一段 plantuml 源码为 PNG

---

## 模块一：plantuml-renderer.js

### findPlantUML()

按优先级查找 plantuml 可用方式，返回可调用的命令字符串：

```javascript
function findPlantUML() {
  // 1. 系统 PATH 中有 plantuml 命令（apt 安装或用户手动安装）
  try {
    execSync('plantuml -version', { stdio: 'pipe' });
    return { type: 'command', cmd: 'plantuml' };
  } catch {}

  // 2. 项目 bin/ 目录下有 plantuml.jar
  const jarPath = path.resolve(__dirname, '../bin/plantuml.jar');
  if (fs.existsSync(jarPath)) {
    return { type: 'jar', jar: jarPath };
  }

  return null;  // 未找到，调用方决定是否下载
}
```

### downloadPlantUML()

首次运行时自动下载 plantuml.jar 到 `bin/plantuml.jar`：

```javascript
function downloadPlantUML() {
  const binDir  = path.resolve(__dirname, '../bin');
  const jarPath = path.join(binDir, 'plantuml.jar');
  fs.mkdirSync(binDir, { recursive: true });

  const url = 'https://github.com/plantuml/plantuml/releases/latest/download/plantuml.jar';
  console.log('[plantuml] 首次使用，正在下载 plantuml.jar...');
  execSync(`curl -L -o "${jarPath}" "${url}"`, { stdio: 'inherit' });
  console.log('[plantuml] 下载完成');
  return { type: 'jar', jar: jarPath };
}
```

### buildCommand(puml, inFile)

根据运行方式组装命令：

```javascript
function buildCommand(puml, inFile, outDir) {
  if (puml.type === 'command') {
    return `plantuml -tpng -o "${outDir}" "${inFile}"`;
  }
  // jar 方式：需要 java
  return `java -jar "${puml.jar}" -tpng -o "${outDir}" "${inFile}"`;
}
```

### renderPlantUML(code, tmpDir, index)

```javascript
function renderPlantUML(code, tmpDir, index) {
  // 1. 确保有可用的 plantuml
  let puml = findPlantUML();
  if (!puml) {
    downloadPlantUML();
    puml = findPlantUML();
    if (!puml) throw new Error('plantuml 不可用，且自动下载失败');
  }

  // 2. 写源文件（保留源文件便于调试）
  const inFile  = path.join(tmpDir, `p_${index}.puml`);
  const outFile = path.join(tmpDir, `p_${index}.png`);
  fs.writeFileSync(inFile, code, 'utf8');

  // 3. 执行渲染
  const cmd = buildCommand(puml, inFile, tmpDir);
  try {
    execSync(cmd, { stdio: 'pipe', timeout: 30000 });
  } catch (e) {
    throw new Error(`plantuml 渲染失败: ${e.stderr?.toString() || e.message}`);
  }

  if (!fs.existsSync(outFile)) {
    throw new Error(`plantuml 渲染无输出: ${outFile}`);
  }

  // 4. 读取 PNG 尺寸
  const buffer = fs.readFileSync(outFile);
  const width  = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);

  // 5. 横置判断：基于渲染后图片实际尺寸（统一与 appendImageParagraph 一致）
  //    CONTENT_WIDTH_PX 在 plantuml-renderer.js 内部定义，与 md2docx.js 保持一致
  const CONTENT_WIDTH_PX = Math.round((21 - 2.7 - 2.7) * 96 / 2.54); // A4 内容区宽度(px)
  const downscaleRatio = width / CONTENT_WIDTH_PX;
  const aspectRatio = width / height;
  const needsLandscape = downscaleRatio > 3 && aspectRatio > 2.0;

  return { buffer, width, height, needsLandscape };
}
```

**横置判断修正说明：**

原方案使用源码分析（`estimatePlantUMLWidth`）判断横置，但 preprocess 路径渲染为图片后由 `appendImageParagraph` 基于实际尺寸判断，导致两条路径可能不一致。

**修正：** `renderPlantUML` 返回的 `needsLandscape` 基于渲染后图片的实际尺寸计算，与 `appendImageParagraph` 保持一致。移除 `estimatePlantUMLWidth` 函数。

---

## 模块二：md2docx.js 改动

### 2.1 引入共享模块

```javascript
const { renderPlantUML } = require('./plantuml-renderer');
```

### 2.2 fence token 处理加 plantuml 分支

**位置：** `consumeToken` 方法，`case 'fence'`：

```javascript
case 'fence': {
  const lang = (t.info || '').trim().toLowerCase();
  if (lang === 'mermaid') {
    this.appendMermaid(t.content);
  } else if (lang === 'plantuml') {
    this.appendPlantUML(t.content);     // ← 新增
  } else {
    this.appendCodeBlock(t.content);
  }
  return i + 1;
}
```

### 2.3 新增 appendPlantUML 方法

紧跟 `appendMermaid` 方法之后，结构完全对称：

```javascript
appendPlantUML(plantUMLCode) {
  this.plantUMLIndex += 1;
  let img;
  try {
    img = renderPlantUML(plantUMLCode, this.tmpDir, this.plantUMLIndex);
  } catch (e) {
    console.warn(`[警告] PlantUML 渲染失败 (#${this.plantUMLIndex}): ${e.message}`);
    console.warn('  → 已降级为普通代码块');
    this.appendCodeBlock(plantUMLCode);
    return;
  }

  if (img.needsLandscape) {
    this.startLandscapeSection();
    const { width, height } = fitImageToLandscape(img.width, img.height);
    this.currentSection.children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      indent: { firstLine: 0 },
      keepNext: true,
      spacing: { before: 120, after: 60 },
      children: [new ImageRun({
        type: 'png', data: img.buffer,
        transformation: { width, height },
      })],
    }));
    this.pendingLandscapeClose = true;
  } else {
    const { width, height } = fitImageToPage(img.width, img.height);
    this.currentSection.children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      indent: { firstLine: 0 },
      keepNext: true,
      spacing: { before: 120, after: 60 },
      children: [new ImageRun({
        type: 'png', data: img.buffer,
        transformation: { width, height },
      })],
    }));
  }
}
```

**修正说明：**
- 移除了原方案中的 `this.imageIndex += 1;`（`imageIndex` 仅用于统计通过图片引用嵌入的图像，渲染图不计入）
- 横置判断由 `renderPlantUML` 基于图片实际尺寸返回，与 `appendImageParagraph` 保持一致

### 2.4 constructor 初始化

```javascript
constructor(opts = {}) {
  // ...existing...
  this.mermaidIndex  = 0;
  this.plantUMLIndex = 0;   // ← 新增
}
```

---

## 模块三：preprocess.js 改动

新增 `renderPlantUMLBlocks()` 函数，结构与现有 `renderMermaidBlocks()` 完全对称：

```javascript
const { renderPlantUML } = require('./plantuml-renderer');

function renderPlantUMLBlocks(content, inputDir, baseName) {
  const pumlDir = path.join(inputDir, 'output', '.plantuml');
  if (!fs.existsSync(pumlDir)) fs.mkdirSync(pumlDir, { recursive: true });

  let figureIndex = 0;
  const lines = content.split('\n');
  const result = [];
  let i = 0;

  while (i < lines.length) {
    if (lines[i].match(/^```plantuml\s*$/i)) {
      const pumlLines = [];
      i++;
      while (i < lines.length && !lines[i].match(/^```\s*$/)) {
        pumlLines.push(lines[i]);
        i++;
      }
      i++;  // skip closing ```

      const pumlCode = pumlLines.join('\n');
      figureIndex++;

      const pngName = `${baseName}_puml${figureIndex}.png`;
      const pngPath = path.join(pumlDir, pngName);

      let rendered = false;
      try {
        const img = renderPlantUML(pumlCode, pumlDir, figureIndex);
        fs.writeFileSync(pngPath, img.buffer);
        rendered = true;
      } catch (e) {
        console.warn(`\n  [plantuml] 渲染失败 (图${figureIndex}): ${e.message}`);
      }

      if (rendered) {
        const relPath = path.relative(inputDir, pngPath).replace(/\\/g, '/');
        result.push(`![](${relPath})`);
      } else {
        // 渲染失败：降级为 text 代码块，避免 md2docx 阶段重复尝试渲染
        result.push('```text');
        result.push(...pumlLines);
        result.push('```');
      }
    } else {
      result.push(lines[i]);
      i++;
    }
  }

  return result.join('\n');
}
```

在 `main()` 中调用（紧跟 `renderMermaidBlocks` 之后）：

```javascript
content = renderMermaidBlocks(content, inputDir, baseName);
content = renderPlantUMLBlocks(content, inputDir, baseName);  // ← 新增
```

**修正说明：**
- 渲染失败时降级为 `text` 代码块（与 mermaid 保持一致），避免 md2docx 阶段重复尝试渲染
- 保留 `.puml` 源文件（`renderPlantUML` 内部写入），便于调试

---

## 模块四：md2docx.sh 改动

在依赖检查阶段增加 Java 检查：

```bash
# ---- Java 检查（PlantUML 依赖）----
if ! java -version >/dev/null 2>&1; then
  echo "[警告] 未找到 Java，PlantUML 图表将无法渲染。"
  echo "       请安装 Java: https://adoptium.net"
fi

# ---- plantuml.jar 检查 ----
PLANTUML_JAR="$(dirname "$0")/../bin/plantuml.jar"
if java -version >/dev/null 2>&1 && [ ! -f "$PLANTUML_JAR" ] && ! which plantuml >/dev/null 2>&1; then
  echo "[plantuml] 首次使用，正在下载 plantuml.jar..."
  mkdir -p "$(dirname "$PLANTUML_JAR")"
  curl -L -o "$PLANTUML_JAR" \
    "https://github.com/plantuml/plantuml/releases/latest/download/plantuml.jar"
  echo "[plantuml] 下载完成"
fi
```

`.gitignore` 新增：

```
bin/plantuml.jar
```

---

## 错误处理策略

| 错误情况 | 处理方式 |
|----------|---------|
| Java 未安装 | sh 脚本打印警告，不阻断执行；plantuml 块降级显示为代码块 |
| plantuml.jar 下载失败 | 打印提示，plantuml 块降级为代码块 |
| plantuml 语法错误 | 捕获 stderr，打印错误信息，plantuml 块降级为代码块 |
| 渲染超时（>30s）| execSync timeout 触发，降级为代码块 |
| 图片尺寸超限 | `-DPLANTUML_LIMIT_SIZE` 动态调整，一般不触发 |

降级行为：渲染失败时保留原始 plantuml 代码块文本，在 DOCX 中以等宽字体代码块呈现，不阻断整体转换流程。

---

## 文件变更汇总

| 文件 | 操作 | 内容 |
|------|------|------|
| `scripts/plantuml-renderer.js` | **新建** | `findPlantUML`、`downloadPlantUML`、`renderPlantUML` |
| `scripts/md2docx.js` | 修改 | 引入模块、fence 分支、`appendPlantUML`、constructor 初始化 |
| `scripts/preprocess.js` | 修改 | 引入模块、`renderPlantUMLBlocks`、main 调用 |
| `scripts/md2docx.sh` | 修改 | Java 检查、plantuml.jar 自动下载 |
| `.gitignore` | 修改 | 添加 `bin/plantuml.jar` |
| `package.json` | 修改 | 文档注释更新（无新 npm 依赖） |

无新 npm 依赖。唯一的系统依赖是 Java（JRE），通过 sh 脚本检测并提示。

---

## 与现有功能的交互

**横置页面（landscape section）：** `renderPlantUML` 返回的 `needsLandscape` 基于渲染后图片实际尺寸计算（`downscaleRatio > 3 && aspectRatio > 2.0`），与 `appendImageParagraph` 的横置判断完全一致。无论 preprocess 路径还是 md2docx 路径，同一图片的横置行为一致。

**图注（keepNext）：** 与 Mermaid 相同，图片段落设置 `keepNext: true`，图注由 `pendingLandscapeClose` 延迟恢复机制处理。

**preprocess 预渲染：** plantuml 块被 preprocess 渲染为 `![](xxx.png)` 后，md2docx 走 `appendImageParagraph` 路径（普通图片），横置判断基于图片实际尺寸，与 `appendPlantUML` 路径一致。

---

## 实施顺序

1. 新建 `scripts/plantuml-renderer.js`（核心）
2. 改 `scripts/md2docx.js`（fence 分支 + `appendPlantUML`）
3. 改 `scripts/preprocess.js`（`renderPlantUMLBlocks`）
4. 改 `scripts/md2docx.sh`（Java 检查 + jar 下载）
5. 改 `.gitignore`
6. 端到端测试：WBS、时序图、活动图各一张
