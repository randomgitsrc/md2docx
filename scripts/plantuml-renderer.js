/**
 * PlantUML 渲染器 — 供 preprocess.js 和 md2docx.js 共同引用
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// A4 内容区宽度(px)，与 md2docx.js 保持一致
const CONTENT_WIDTH_PX = Math.round((21 - 2.7 - 2.7) * 96 / 2.54);

// =========================================================================
// 1. 查找可用的 PlantUML
// =========================================================================

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

// =========================================================================
// 2. 自动下载 plantuml.jar
// =========================================================================

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

// =========================================================================
// 3. 组装渲染命令
// =========================================================================

function buildCommand(puml, inFile, outDir) {
  if (puml.type === 'command') {
    return `plantuml -tpng -o "${outDir}" "${inFile}"`;
  }
  // jar 方式：需要 java
  return `java -jar "${puml.jar}" -tpng -o "${outDir}" "${inFile}"`;
}

// =========================================================================
// 4. 渲染 PlantUML 源码 → PNG
// =========================================================================

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
  const downscaleRatio = width / CONTENT_WIDTH_PX;
  const aspectRatio = width / height;
  const needsLandscape = downscaleRatio > 3 && aspectRatio > 2.0;

  return { buffer, width, height, needsLandscape };
}

module.exports = { findPlantUML, downloadPlantUML, buildCommand, renderPlantUML };
