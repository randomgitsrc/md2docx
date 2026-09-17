/**
 * config.js — md2docx HTTP 服务配置
 * 全部可通过环境变量覆盖（便于 Docker 部署）
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

function num(envVal, def) {
  const n = parseInt(envVal, 10);
  return Number.isFinite(n) && n > 0 ? n : def;
}

function bool(envVal, def) {
  if (envVal === undefined) return def;
  return !['0', 'false', 'no'].includes(String(envVal).toLowerCase());
}

/**
 * 解析数据目录，并在**首选位置不可写时自动回退**。
 *
 * 为什么需要回退：默认数据目录在安装目录下，而安装目录可能只读——
 * 放到 `C:\Program Files`、企业策略限制、或从只读介质运行。
 * 此时若不回退，`cleanupOrphans()` 的 mkdir 会以 EACCES 抛错，
 * **服务在启动阶段直接崩溃**（用户只看到窗口一闪而过，无从排查）。
 *
 * 优先级：
 *   1. 显式 DATA_DIR（用户意图明确，不做回退，失败应当暴露）
 *   2. 安装目录下 data/          —— 便携版首选，删目录即卸载
 *   3. 用户级数据目录            —— 只读安装时回退
 *      Windows: %LOCALAPPDATA%\md2docx    （用户配置的标准位置）
 *      其他:    ~/.local/share/md2docx
 *
 * **刻意不把临时目录作为兜底**：%TEMP% 会被系统清理，把作业数据放那里
 * 等于静默丢数据——比启动失败更糟。全部候选都不可写时抛错并给出可操作提示。
 */
function resolveDataDir() {
  if (process.env.DATA_DIR) return path.resolve(process.env.DATA_DIR);

  const userDataDir = process.platform === 'win32' && process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'md2docx')
    : path.join(os.homedir(), '.local', 'share', 'md2docx');

  const candidates = [
    path.join(__dirname, '..', 'data'),   // 安装目录（便携首选）
    userDataDir,                          // 用户级回退
  ];

  const failures = [];
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      // mkdir 成功不代表可写（目录可能已存在但只读），故实测一次写权限
      const probe = path.join(dir, '.write-probe');
      fs.writeFileSync(probe, 'ok', 'utf8');
      fs.rmSync(probe, { force: true });
      if (dir !== candidates[0]) {
        // 回退了就要说清楚，否则用户不知道数据去哪了
        console.warn(`[config] 安装目录不可写，数据目录改用: ${dir}`);
      }
      return dir;
    } catch (e) {
      failures.push(`${dir}（${e.code || e.message}）`);
    }
  }

  throw new Error(
    '找不到可写的数据目录，服务无法启动。\n'
    + `  已尝试:\n${failures.map((f) => '    ' + f).join('\n')}\n`
    + '  可用环境变量 DATA_DIR 显式指定一个可写目录。'
  );
}

const config = {
  // 服务监听
  port: num(process.env.PORT, 8080),
  // 默认只绑本机：离线单机部署无需对外暴露，也不会触发 Windows 防火墙弹窗。
  // 需要局域网访问时设 HOST=0.0.0.0 并放行防火墙。
  host: process.env.HOST || '127.0.0.1',

  // 数据目录（作业工作目录）——见 resolveDataDir 的只读回退说明
  dataDir: resolveDataDir(),
  get jobsDir() {
    return path.join(this.dataDir, 'jobs');
  },

  // 并发与队列
  maxConcurrent: num(process.env.MAX_CONCURRENT, 2),
  queueLimit: num(process.env.QUEUE_LIMIT, 50),          // 排队上限（超出 429）

  // 上传校验
  maxFileSizeMb: num(process.env.MAX_FILE_SIZE_MB, 20),
  maxDiagrams: num(process.env.MAX_DIAGRAMS, 30),        // mermaid+plantuml 块数上限

  // 作业生命周期
  jobTtlMinutes: num(process.env.JOB_TTL_MINUTES, 60),
  cleanupIntervalMinutes: num(process.env.CLEANUP_INTERVAL_MINUTES, 10),
  gracefulTimeoutMs: num(process.env.GRACEFUL_TIMEOUT_MS, 30000),

  // 防护
  rateLimitPerMinute: num(process.env.RATE_LIMIT_PER_MINUTE, 20), // 每 IP 每分钟提交上限

  // 依赖探测缓存（毫秒）
  healthCacheTtlMs: num(process.env.HEALTH_CACHE_TTL_MS, 60000),

  // 作业处理超时（毫秒，worker 内转换超时保护）
  jobTimeoutMs: num(process.env.JOB_TIMEOUT_MS, 900000),

  // 调试
  debug: bool(process.env.DEBUG, false),
};

module.exports = config;
