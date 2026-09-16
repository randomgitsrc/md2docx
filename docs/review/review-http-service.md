# 评审：HTTP 服务方案（REST API + Web 上传页面）

## 评审日期

2026-08-30

## 评审范围

- `docs/plans/http-service.md`（待评审方案）
- `docs/plans/docker-deployment.md`（后续 Docker 化既有方案）
- 现有核心代码：`scripts/preprocess.js`、`scripts/md2docx.js`、`scripts/md2docx.sh`、`scripts/puppeteer-config.js`、`scripts/plantuml-renderer.js`
- 项目约定：`CLAUDE.md`、`AGENTS.md`

## 评审结论速览

**结论：修改后通过。**

方案整体方向正确——分层清晰、坚持复用现有 scripts 核心、异步作业模型、并发受限队列、作业目录隔离，这些都是合理的设计选择。但存在 **4 个高严重级问题**（`execSync` 阻塞事件循环、共享图表缓存目录并发冲突、上传 md 图片引用的路径穿越、缺孤儿清理与优雅关闭），必须在实施前落实进方案；另有 9 个中等问题（API 语义缺定义、DoS 防护不全、Docker 合并笼统等）建议在动手前补齐。问题均可在不改变架构方向的前提下修复。

---

## 问题清单

### 【高】H1 — `execSync` 阻塞事件循环，HTTP 服务可用性的根本性隐患

- **位置**：方案「决策 1 / 决策 3」；`scripts/preprocess.js` L256-258、L300-302；`scripts/md2docx.js` L227-228、L778（`renderPlantUML`）、L1195（`patchDocxPagination`）
- **问题**：方案要求 `convert(cleanPath, opts)` 为 `async`，但底层渲染仍是 `execSync`：
  - `preprocess.js` 的 `renderMermaidBlocks` 用 `execSync('npx mmdc ...')`，`renderPlantUMLBlocks` 经 `renderPlantUML` 同步调 Java
  - `md2docx.js` 的 `renderMermaid` / `appendPlantUML` / `patchDocxPagination` 全部 `execSync`
  - 单次 mermaid 渲染 5~30s，期间整个 Node 事件循环被冻结——`maxConcurrent=2` 也无济于事：第二个作业的渲染同样阻塞，`/api/health`、`/api/jobs/:id` 轮询、其他作业的 `onProgress` 回调全部卡住，前端进度条会"成块跳变"
- **建议**：
  - 在 `lib/pipeline.js` 封装层把 mmdc / plantuml / python3 调用改为 `child_process.exec`（异步）或 `execFile`（无 shell）
  - 或把整个 preprocess+convert 流程放进 `worker_threads`，主线程只做 HTTP 与状态管理（推荐：改动最小，且天然隔离 `execSync`）
  - 方案必须把这一改造点写进「决策 1」或新增「决策 6：渲染调用异步化」，明确不阻塞事件循环是硬约束

### 【高】H2 — 共享图表缓存目录导致并发作业 PNG 互相覆盖

- **位置**：`scripts/preprocess.js` L205（`renderMermaidBlocks`）、L345（`renderPlantUMLBlocks`）
- **问题**：两个函数把 PNG 写到 `inputDir/output/.mermaid/` 与 `inputDir/output/.plantuml/`，文件名是 `baseName_figN.png`。`baseName = path.basename(inputPath,'.md').replace(/[^a-zA-Z0-9一-鿿]/g,'_')`（L487）。两个作业上传同名文件（都叫 `index.md`、`README.md`、`测试文档.md`）时，`baseName` 相同、`figN` 都从 1 起——PNG 互相覆盖，作业 A 嵌入作业 B 的图。方案「决策 4」虽提"每作业独立工作目录 `data/jobs/<id>/`"，但现有 `preprocess.js` 的缓存路径**硬编码**为 `inputDir/output/.mermaid`，没有参数化入口，作业隔离形同虚设
- **建议**：
  - 重构 `preprocess(inputPath, opts)` 时，`opts` 必须含 `outputDir` / `cleanDir` / `mermaidCacheDir` / `plantumlCacheDir`，由服务端按 `jobId` 生成绝对路径传入
  - CLI 入口保留原默认路径逻辑（`inputDir/output/...`），保证 CLI 行为不变
  - 回归测试增加"两个同名文件并发提交"用例（见测试意见 L6）

### 【高】H3 — 上传 md 中的图片引用可路径穿越读取宿主文件

- **位置**：`scripts/md2docx.js` L656-659（`appendImageParagraph`）
- **问题**：`md2docx.js` 解析 `![](path)` 后用 `path.resolve(this.inputDir, decodedSrc)` 读文件。CLI 场景是用户自己的 md，无风险；HTTP 场景下，攻击者上传的 md 可写 `![](../../../../etc/passwd)` 或 `![](/etc/shadow)`，服务端会读取并嵌入 docx，或通过"图片缺失"报错探测文件存在性。方案「决策 4」只说"产物路径服务端生成"，**未覆盖"输入 md 内引用的图片路径"这一穿越面**
- **建议**：
  - 在 `lib/pipeline.js` 对 clean.md 里的所有 `![](xxx)` 做路径白名单：只允许引用作业目录内的相对路径，禁止 `..`、禁止绝对路径；越界的剔除并记 warning
  - 或预处理阶段把图片 src 重写为作业目录绝对路径，越界者降级为 `[图片缺失]`
  - 这条与 L8（日志脱敏）叠加防护：避免前端 logs 泄露绝对路径辅助穿越

### 【高】H4 — 缺少优雅关闭与崩溃后的孤儿作业目录清理

- **位置**：方案「决策 4」
- **问题**：方案说"重启即清空可接受"，但未提重启时 `data/jobs/` 下残留的孤儿目录如何处理。服务崩溃时正在 `running` 的作业会留下半成品文件 + 内存状态丢失，重启后这些目录**永不被清理**（TTL 清理任务只认内存 store 里的作业）。也未提 `SIGTERM` 优雅关闭（容器停机、`docker stop` 的标准信号）
- **建议**：
  - 启动时扫 `data/jobs/`，清理所有残留目录（v1 内存存储无恢复语义，全清即可）
  - 注册 `SIGTERM`/`SIGINT` handler：停止入队新作业、等待 `running` 完成（带超时如 30s）后退出
  - 在「决策 4」补"启动清扫 + 优雅关闭"两条

### 【中】M1 — "双路一致性"论述不完整，且忽视既有的 mermaid init 注入差异

- **位置**：方案「决策 1 双路一致性」；`scripts/preprocess.js` L241；`scripts/md2docx.js` L222
- **问题**：方案称"服务端调用 CLI 同一套函数天然消除双路差异"。AGENTS.md 陷阱#1 的双路差异是"preprocess 已渲染→md2docx 走图片引用路径"vs"直接跑 md2docx.js 时 fence 由 md2docx 自渲染"。服务端固定走 preprocess→md2docx，内部确实一致。但方案没指出一个既有事实：`preprocess.js` 注入 mermaid init 是 `'theme':'neutral' + 'curve':'linear'`（L241），而 `md2docx.js` 的 `renderMermaid` 只注入 `'curve':'linear'`、**无 neutral 主题**（L222）。服务端走 preprocess 路径不受影响，但 `md2docx.js` 的 fence 自渲染是兜底——若后续维护者误以为两条 init 注入需对齐并"修复"差异，反而破坏既有行为
- **建议**：在 `docs/http-service.md` 明确"服务端管线固定为 preprocess（全量渲染）→ convert（仅图片引用），`md2docx.js` 的 fence 自渲染在服务端是死路径"；标注 init 注入差异是既有设计（preprocess 给 neutral、md2docx 兜底不给），不是 bug

### 【中】M2 — 下载端点缺状态约束与 `Content-Disposition`

- **位置**：方案「API 设计」`GET /api/jobs/:id/download`、`GET /api/jobs/:id/clean`
- **问题**：
  - 未规定作业非 `done` 时下载返回什么（应 `409 Conflict` 或 `404`，而非 200 空体或 500）
  - 未规定 `Content-Disposition: attachment; filename="xxx.docx"`——浏览器默认用 URL 末段当文件名，会得到 `jobId` 或无扩展名串
- **建议**：
  - `download`/`clean` 端点先校验 `status === 'done'`，否则 `409 { error: { code: 'JOB_NOT_DONE' } }`
  - 响应头加 `Content-Disposition`，文件名用原始上传文件名（存于 job 元数据）派生：`xxx.md` → `xxx.docx` / `xxx.clean.md`
  - `clean` 端点 `Content-Type: text/markdown; charset=utf-8`

### 【中】M3 — DoS 防护只看文件大小，缺图表数量与速率限制

- **位置**：方案「API 设计 校验」（扩展名 `.md`、大小 20MB）
- **问题**：20MB 防不住"10KB 的 md 里塞 200 个 ` ```mermaid ` 块"——每个块 spawn 一个 Chrome 进程，`maxConcurrent=2` 也会排队 200 次、耗时极长、占满磁盘缓存。也未提速率限制（同一 IP 短时大量上传可打满队列）
- **建议**：
  - 预处理前先正则统计 `^```mermaid\s*$` / `^```plantuml\s*$` 块数量，超阈值（如 30）直接 `400 { error: { code: 'TOO_MANY_DIAGRAMS' } }`
  - 加最简 IP 速率限制（如 `express-rate-limit`，或自写令牌桶：每 IP 每分钟 N 次提交）
  - 队列长度上限：排队作业超过阈值时 `429 Too Many Requests`

### 【中】M4 — Docker 合并方案过于笼统

- **位置**：方案「实施步骤 9」+ `docs/plans/docker-deployment.md`
- **问题**：docker 方案的 Dockerfile 只 `COPY scripts/ bin/`，`ENTRYPOINT` 是 `./scripts/md2docx.sh`（形态 A CLI）。HTTP 服务需 `COPY server/ public/`、装 `express`/`multer`、`EXPOSE` 端口、`ENTRYPOINT` 改 `node server/app.js`。方案只说"合并 Docker 规划"未给具体形态：单 Dockerfile 双 target？两个 Dockerfile 共享 base？`npm ci --omit=dev` 需包含 express/multer（当前 docker 方案的 deps 层只装了既有 7 个依赖）
- **建议**：
  - 明确采用 `multi-stage` + `build-arg TARGET=cli|server` 或两个 Dockerfile 共享 base stage
  - 给出服务形态的 Dockerfile 增量：`COPY server/ public/`、`npm ci`（含新依赖）、`EXPOSE 8080`、`CMD ["node","server/app.js"]`
  - 统一 Node 版本：docker 用 `node:22`，现状实测 `v24.15.0`，建议对齐到 22 LTS（或两边都升 24），避免 24-only API 在容器炸

### 【中】M5 — 健康检查可能阻塞且无缓存

- **位置**：方案「API 设计 `GET /api/health`」+ `scripts/puppeteer-config.js` + `scripts/plantuml-renderer.js` L19-34
- **问题**：`findChrome()` 做多次 `fs.existsSync`（开销小）；`checkGraphviz()` 用 `execSync('dot -V')`（阻塞）。若 `services/dependency-check.js` 每次请求都实时探测，会阻塞事件循环（与 H1 同源）且慢。前端若每秒轮询作业时顺带刷健康徽标，放大问题
- **建议**：
  - 启动时探测一次并缓存结果（带 TTL 如 60s），`/api/health` 返回缓存值
  - 前端健康徽标只拉一次或低频刷新（如 30s），不与作业轮询耦合

### 【中】M6 — 进度回调粒度与现有日志机制不匹配

- **位置**：方案「决策 1 进度回调」；`scripts/preprocess.js` L31-49（`logRenderProgress` 用 `\r\x1b[K` 终端回车覆盖写）
- **问题**：`preprocess.js` 的逐图进度用 `process.stdout.write('\r\x1b[K...')`，是终端 hack，无法直接喂给 `opts.onProgress`。方案的"管线各阶段调用 onProgress"只覆盖 6 个粗阶段，未覆盖"第 3/10 张图"这种细粒度——而这恰是用户最想看到的。`md2docx.js` 的渲染进度散落在 converter 内部 `console.warn`
- **建议**：
  - 重构时把 `logRenderProgress`/`logRenderDone` 的调用点改为 `if (opts.onProgress) opts.onProgress(percent, msg)`，CLI 不传则降级为原终端输出
  - `converter` 的 `appendMermaid`/`appendPlantUML` 也回调进度
  - 明确进度百分比口径：如 preprocess 占 60%（内部按图数加权）、convert 占 40%，避免两个阶段各自 0~100% 跳变

### 【中】M7 — mmdc 经 `npx` 调用，并发下有额外开销

- **位置**：`scripts/preprocess.js` L256、L300；`scripts/md2docx.js` L227
- **问题**：两处都用 `npx mmdc`，`npx` 每次做包解析。并发 2 个作业 ×多图时，`npx` 开销累积；容器内 `npx` 还可能有 PATH 查找差异
- **建议**：改用 `node_modules/.bin/mmdc` 或 `require.resolve('@mermaid-js/mermaid-cli/src/cli')` 直接调，消除 `npx` 解析。HTTP 并发场景收益明显

### 【中】M8 — `title`/`company`/`date` 覆盖语义未定义

- **位置**：方案「API 设计 `POST /api/convert` 可选 `title/company/date` 覆盖」
- **问题**："覆盖"是覆盖 YAML 里的值，还是只在 YAML 缺失时填入？上传的 md 已有 YAML，再传 `title` 参数，谁优先？这直接影响封面渲染
- **建议**：
  - 明确"表单参数优先于 YAML"（真覆盖），以匹配 Web 表单场景（用户上传后想在页面改标题）
  - 在 `lib/pipeline.js` 生成 clean.md 前注入或改写 YAML front matter
  - `docs/api.md` 给出"有 YAML + 传参"与"无 YAML + 传参"两个示例

### 【中】M9 — 内存 store 与磁盘目录清理可能不一致

- **位置**：方案「决策 4」（TTL 清理 + `DELETE`）
- **问题**：TTL 清理任务基于内存 store 的作业列表删 `data/jobs/<id>`。若 store 里某作业被删但其目录因权限/异常残留，或反过来目录被外部删了但 store 还在，会出现幽灵作业（前端看到作业但下载 404）
- **建议**：
  - 清理任务同时校验目录存在性；store 记录 `artifactPath`，删除时幂等（目录不存在不算错）
  - `GET /api/jobs/:id` 时若 store 有记录但目录缺失，标记为 `failed` 并附 `error: 'artifact lost'`

### 【低】L1 — mermaid 渲染失败重试时分辨率降级（既有问题）

- **位置**：`scripts/preprocess.js` L300（首次 `-w 3600 -H 2400`，重试 `-w 1600 -H 900`）
- **问题**：修复后重渲染的图分辨率更低。非本次方案引入，但方案声称"双路一致"应知晓
- **建议**：重构时统一重试分辨率，或记 warning 让前端可见

### 【低】L2 — 前端轮询无退避

- **位置**：方案「Web 页面」（每 1s 轮询）
- **问题**：固定 1s 轮询，60s 作业 60 次请求；进度停滞时仍高频轮询
- **建议**：progress 不变时延长到 2~3s，有变化时回 1s；v2 可改 SSE

### 【低】L3 — 未提 CORS

- **位置**：方案「API 设计」
- **问题**：同源 Web 页面不需 CORS，但未来有独立前端或第三方调用会需要
- **建议**：v1 默认同源不配；`docs/api.md` 注明"跨域需自行加 `cors` 中间件"

### 【低】L4 — Node 版本不一致

- **位置**：方案「现状约束 Node v24.15.0」+ `docs/plans/docker-deployment.md`（`node:22-bookworm-slim`）
- **问题**：现状实测 24，Docker 用 22。服务端若用 24-only API 会在容器炸
- **建议**：服务端代码避开 24-only API；Docker base 对齐到与开发一致的 LTS 版本（见 M4）

### 【低】L5 — `preprocess.js` 存在死代码 `askUser`

- **位置**：`scripts/preprocess.js` L191-202
- **问题**：`askUser` 定义了但未被调用（重试逻辑改为自动修复，见 L277-292 注释"由于 Node.js 的异步限制，这里直接尝试修复而不是询问"）。重构时易引起误解
- **建议**：重构时移除

### 【低】L6 — 回归测试缺黄金文件策略

- **位置**：方案「测试与验证 回归」（重构后 `md2docx.sh` 输出与重构前一致）
- **问题**："输出一致"难确定性验证。docx 是 zip，二进制比对受时间戳/元数据影响
- **建议**：存重构前的 golden docx，回归时解压比对 `word/document.xml`（忽略时间戳），或用 python-docx 比对段落数/样式/图片数；并发测试补"两个同名文件同时提交"用例（验证 H2 修复）

### 【低】L7 — YAML 解析风险

- **位置**：方案上传校验
- **问题**：`gray-matter` 解析 YAML，恶意 YAML（超大嵌套、`!!js/function`）有理论风险。`js-yaml` 默认禁用危险标签，但应确认版本
- **建议**：确认 `gray-matter`/`js-yaml` 版本禁用 unsafe loads；限制 YAML front matter 大小（如 64KB）

### 【低】L8 — 日志/产物暴露可能含敏感路径

- **位置**：方案「决策 5」作业 `logs`
- **问题**：作业 `logs` 收集 `console` 输出，含文件绝对路径、错误堆栈。内网工具风险低，但若 `logs` 经 API 返回前端，绝对路径泄露可辅助路径穿越攻击（与 H3 叠加）
- **建议**：返回前端的 `logs` 脱敏（去掉 `data/jobs/<id>/` 前缀，只保留相对路径）

---

## 修改优先级列表

### P0（必须改，实施前落实进方案）

1. **H1** — 渲染调用异步化（`execSync` → `exec`/`execFile` 或 `worker_threads`），不阻塞事件循环
2. **H2** — `preprocess.js` 缓存目录参数化，服务端按 `jobId` 隔离，消除同名文件并发覆盖
3. **H3** — 上传 md 图片引用路径白名单，禁止 `..` 与绝对路径，防路径穿越
4. **H4** — 启动清扫 `data/jobs/` 残留 + `SIGTERM` 优雅关闭

### P1（建议改，动手前补齐定义）

5. **M1** — 明确服务端管线固定 preprocess→convert，标注 init 注入差异是既有设计
6. **M2** — 下载端点状态约束（`409`）+ `Content-Disposition` 文件名
7. **M3** — 图表数量上限 + IP 速率限制 + 队列长度上限
8. **M4** — Docker 合并具体形态（multi-stage / 双 Dockerfile）+ 依赖与 ENTRYPOINT 增量
9. **M5** — 健康检查结果缓存（TTL 60s），前端低频刷新
10. **M6** — 进度回调覆盖逐图粒度，明确百分比口径
11. **M7** — mmdc 直接调二进制，去 `npx` 开销
12. **M8** — 定义 `title`/`company`/`date` 覆盖语义（参数优先于 YAML）
13. **M9** — store 与目录清理一致性校验，幽灵作业标记 `failed`

### P2（可选，实施中顺手做）

14. **L1** — 统一 mermaid 重试分辨率
15. **L2** — 前端轮询退避
16. **L3** — CORS 注明
17. **L4** — Node 版本对齐
18. **L5** — 移除 `askUser` 死代码
19. **L6** — 黄金文件回归 + 同名并发测试用例
20. **L7** — YAML 大小限制与 unsafe load 确认
21. **L8** — 前端 logs 路径脱敏

---

## 最终结论

**修改后通过。**

架构方向正确：六层分离（路由/服务/作业/基础设施/核心/前端）清晰；坚持"服务端复用 scripts 核心"是避免双路差异的正确策略；异步作业模型 + 并发受限队列 + 作业目录隔离的方向都对。但 4 个 P0 问题（`execSync` 阻塞、缓存目录并发冲突、路径穿越、孤儿清理）是服务可用性与安全性的硬伤，必须在实施前写进方案——其中 H1 不解决则服务基本不可用（进度条卡死、健康检查无响应），H2 不解决则并发产出错乱文档，H3 不解决则上线即带目录读取漏洞。P1 的 API 语义与 Docker 合并细节也应在编码前补齐定义，避免实施中途反复。

建议处理顺序：先把 4 个 P0 与 M1/M2/M3/M4 补进 `docs/plans/http-service.md`（更新方案而非另起评审），再进入「实施步骤 1 重构核心」。
