/**
 * exec-util.js — 跨平台外部命令执行封装
 *
 * 统一使用 execFileSync + 参数数组，**不经过 shell**：
 *  - 路径含空格/中文/括号时不会被 shell 拆坏
 *    （`C:\Program Files\...`、`C:\Users\张三\...`、`D:\项目 (2026)\...`）
 *  - 规避 Windows cmd.exe 与 POSIX sh 的引号/转义差异
 *  - 参数不再拼接进命令行，消除注入面
 *
 * 历史 bug：原先用模板字符串拼命令且 `-p ${cfgPath}` 漏了引号，
 * 导致路径含空格时 mmdc 收到被拆开的参数而失败
 * （报 `error: too many arguments`），mermaid 图静默降级为代码块。
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

/**
 * 执行外部命令（参数数组，不经 shell）
 * @param {string} cmd
 * @param {string[]} args
 * @param {object} [opts] execFileSync 选项；额外支持 allowFailure
 * @returns {{ ok: boolean, stdout?: string, error?: Error }}
 */
function runFile(cmd, args, opts = {}) {
  const { allowFailure = false, ...execOpts } = opts;
  try {
    const stdout = execFileSync(cmd, args, {
      encoding: 'utf8',
      stdio: 'pipe',
      ...execOpts,
    });
    return { ok: true, stdout: stdout == null ? '' : String(stdout) };
  } catch (e) {
    if (allowFailure) return { ok: false, error: e };
    throw e;
  }
}

/**
 * 定位 mermaid-cli 的 CLI 入口（JS 文件）。
 * 用 `node <cli.js>` 直接执行，绕开 node_modules/.bin/mmdc 这个脚本 shim：
 *  - Windows 上该 shim 是 mmdc.cmd，不能直接当可执行文件调用
 *  - shim 内部仍会把参数传给 node，路径含空格时更容易出问题
 * @returns {string} cli.js 绝对路径
 */
function resolveMmdcCli() {
  // 包 exports 字段通常不允许解析子路径，失败则回退到固定相对路径
  try {
    return require.resolve('@mermaid-js/mermaid-cli/src/cli.js');
  } catch (_) {
    const p = path.resolve(__dirname, '..', 'node_modules', '@mermaid-js', 'mermaid-cli', 'src', 'cli.js');
    if (!fs.existsSync(p)) {
      throw new Error(`找不到 mermaid-cli 入口: ${p}（请先执行 npm install）`);
    }
    return p;
  }
}

/**
 * 运行 mmdc（内部用当前 node 执行 cli.js，参数数组传递）
 * @param {string[]} args
 * @param {object} [opts]
 */
function runMmdc(args, opts = {}) {
  const env = { ...process.env, ...(opts.env || {}) };
  // Electron 打包后 process.execPath 指向 Electron 本体而非 node，
  // 必须置 ELECTRON_RUN_AS_NODE=1 才会以 Node 模式执行脚本。
  if (process.versions && process.versions.electron) {
    env.ELECTRON_RUN_AS_NODE = '1';
  }
  return runFile(process.execPath, [resolveMmdcCli(), ...args], { ...opts, env });
}

/**
 * 下载文件到本地（跟随重定向），不依赖系统 curl。
 * @param {string} url
 * @param {string} dest
 * @param {{ redirects?: number, timeoutMs?: number }} [opts]
 * @returns {Promise<string>} dest
 */
function downloadFile(url, dest, opts = {}) {
  const { redirects = 5, timeoutMs = 120000 } = opts;
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      const { statusCode, headers } = res;
      if (statusCode >= 300 && statusCode < 400 && headers.location) {
        res.resume();
        if (redirects <= 0) return reject(new Error('重定向次数过多'));
        const next = new URL(headers.location, url).toString();
        return downloadFile(next, dest, { redirects: redirects - 1, timeoutMs }).then(resolve, reject);
      }
      if (statusCode !== 200) {
        res.resume();
        return reject(new Error(`下载失败 HTTP ${statusCode}: ${url}`));
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const tmp = `${dest}.part`;
      const out = fs.createWriteStream(tmp);
      res.pipe(out);
      out.on('finish', () => out.close(() => {
        fs.renameSync(tmp, dest);
        resolve(dest);
      }));
      out.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error(`下载超时: ${url}`)));
    req.on('error', reject);
  });
}

/**
 * 同步下载文件（跨平台，不依赖系统 curl）。
 * 实现方式：用当前 node 起一个子进程执行内联下载脚本并阻塞等待。
 * Windows 无 curl，Linux 的 curl 也未必安装，故不依赖外部工具。
 * @param {string} url
 * @param {string} dest
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {string} dest
 */
function downloadFileSync(url, dest, opts = {}) {
  const { timeoutMs = 180000 } = opts;
  const code = `
    const https=require('https'),fs=require('fs'),path=require('path');
    const [url,dest]=process.argv.slice(1);
    function get(u,n){return new Promise((res,rej)=>{
      const req=https.get(u,{timeout:120000},r=>{
        if(r.statusCode>=300&&r.statusCode<400&&r.headers.location){
          r.resume();
          if(n<=0)return rej(new Error('重定向次数过多'));
          return get(new URL(r.headers.location,u).toString(),n-1).then(res,rej);
        }
        if(r.statusCode!==200){r.resume();return rej(new Error('HTTP '+r.statusCode));}
        fs.mkdirSync(path.dirname(dest),{recursive:true});
        const tmp=dest+'.part';
        const out=fs.createWriteStream(tmp);
        r.pipe(out);
        out.on('finish',()=>out.close(()=>{fs.renameSync(tmp,dest);res();}));
        out.on('error',rej);
      });
      req.on('error',rej);
      req.on('timeout',()=>req.destroy(new Error('下载超时')));
    });}
    get(url,5).then(()=>process.exit(0)).catch(e=>{console.error(e.message);process.exit(1);});
  `;
  const env = { ...process.env };
  if (process.versions && process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1';
  runFile(process.execPath, ['-e', code, url, dest], { timeout: timeoutMs, env });
  return dest;
}

module.exports = { runFile, resolveMmdcCli, runMmdc, downloadFile, downloadFileSync };
