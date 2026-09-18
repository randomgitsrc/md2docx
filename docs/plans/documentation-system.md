# 文档体系方案（跨平台）

> 状态：**v6.1 — 第六轮评审"通过"**（`docs/review/review-review-review-review-review-review-documentation-system.md`）；
> v6.1 仅修正评审指出的一处示例（`ENABLE_PAGINATION_PATCH` 的实际代码形状，见下），无实质改动
> 范围：为 md2docx 建立面向**使用者**的文档体系，并把它做成**可随发布物分发、可扩展、不会过期、可版本追溯**的东西。
> **不限于 Windows**——Linux（源码 / Docker）与 Windows 离线包是一等公民。

## 0. 修订记录

### v6.1（第六轮评审通过后的编辑性修正）

| 项 | 处置 |
|---|---|
| 示例与真实代码形状不符：`ENABLE_PAGINATION_PATCH` 在 `scripts/md2docx.js` 中并非 `const` 赋值，而是 `:1563` 的 `if (process.env.ENABLE_PAGINATION_PATCH === '1') {` | 已把 `@docfact-nodefault` 示例挂到真实行（§6.2）；该标记无值断言，不影响守卫，也不引入行为改动 |

### v6 — 第五轮放行条件

| 放行条件 | 严重度 | v6 处置 |
|---|---|---|
| **问题 1：守卫的三种 token 形式不含布尔字面量**——`default_debug=false`（`config.js:111`）机械模拟 FAIL（17/18 PASS） | 中 | §6.2 守卫改为**四种形式**：数字（词边界）/ 布尔字面量 `true`\|`false`（词边界）/ 引号字符串 / 点分标识符；§12 自证项加入 `default_debug=false` |
| **问题 2：`@docfact-nodefault` 的宿主文件不在 `DOCFACT_SCAN_FILES`**——`PUPPETEER_EXECUTABLE_PATH`（`puppeteer-config.js:69`）、`MD2DOCX_OPEN_BROWSER`/`NO_OPEN_BROWSER`（`server/app.js:151`）、`ENABLE_PAGINATION_PATCH`（`md2docx.js:1563`）所在文件未列入，与"非清单文件出现标记即失败"冲突 | 中 | §6.2 改为**单一文件注册表**（一张表两个用途列），把 `scripts/puppeteer-config.js`、`server/app.js`、`scripts/md2docx.js` 一并纳入"可携带 `@docfact`"；同时消除两张清单的重复表述 |
| 低：`envNotes` 判据句与清单不自洽 | 低 | §6.2 判据改为"**由生成器报告**缺注释项，实施时以报告为准"，并注明 7 条为**预期值** |
| 低：`syncMap` "未映射变更提示"承诺未落文 | 低 | §6.4 明写：`syncMap` 未覆盖的源码变更由 `docs:status` **提示**（不失败） |
| 低：单调性未声明按 SemVer 语义 | 低 | §6.5 明写"按 SemVer 语义比较（主→次→修订），非字符串排序" |
| 低：CI artifact 名未随资产改名同步 | 低 | §9.0 C3/C9 与 §8 补：`.github/workflows/release-windows.yml` 的 artifact 名与路径同步改为带版本 |
| 低：`SIZE.正文` 是不存在的示例 | 低 | §6.2 的点分标识符示例改用**真实键名**：`SIZE.小四`（`md2docx.js:50`）、`FONT.黑体`（`:55`）、`PAGE.marginTop`（`:63`） |

### v5 — 第四轮放行条件

第四轮 4 条件（`DOCFACT_SCAN_FILES` 未定义[严重]、`verifyVersion` 恒假、`document-format.md` 边界与守卫标识符、`engines` 无注释载体）
+ 5 低项已处置：两张清单显式声明、版本闸门改为"单调性 + 发布态一致性"、部分生成 + 点分标识符、
`jsonFacts` JSON 指针、manifest 示例改严格 JSON、资产带版本、`envNotes` 枚举、`docs:status` 基线。

### v4 — 第三轮放行条件 + 三项新要求

第三轮 3 条放行条件（多值标记同行、锚点归属规则化 + 生成文件参与锚点、生成契约映射）已处置；
新增 **§6.3 manifest 驱动**（可扩展/不写死）、**§6.4 程序更新→文档同步**、**§6.5 版本管理**。
第四轮机械模拟确认：守卫对 9 条事实**全部 PASS**，反向探针（`50` vs `5`、`8080` vs `808`、`output/docxs`）**全部被拒**；
`resolveBackend` 改写与 `ENTRY_CMDS` 替换的**行为等价性经逐输入核对成立**。

### v3 / v2 — 历史处置（摘要）

v2 修正了"`require()` 派生事实"（`config.js:83` 加载即 `resolveDataDir()` 有副作用且会 `throw`；
`plantuml-renderer.js:517` 并不导出后端取值；三个 `.cmd` 名是内联字面量），把 Linux 验证状态从虚假的 ✅ 降为 `⚠️ 部分`，
并把 `http-service.md` 判为陈旧。v3 引入单行常量 + token 守卫 + 生成契约 + claim 锚点收窄。

**v1 中不成立、已删除的说法**（留痕以免再犯）：

- ❌「`require('../server/config')` 取端口」——加载即 `mkdir` + 写探针（`config.js:52-57`），失败 `throw`（`config.js:68-72`）。
- ❌「`plantuml-renderer.js` 导出后端取值」——`:517` 只导出 `{findPlantUML, downloadPlantUML, buildCommand, renderPlantUML}`。
- ❌「构建脚本导出入口文件名常量」——三个 `.cmd` 名是内联字面量（`build-windows-bundle.js:295/312/731`）。
- ❌「本仓库开发/构建机即 Linux 系」——无法证明。
- ❌「`http-service.md` 是最新文档」——实际陈旧（§1.1、§7）。
- ❌「macOS 有 `fc-list` 字体分支」——实为**没有 darwin 分支**，走 `fc-list` 会静默失败（§4.1）。

## 1. 背景

### 1.1 现状盘点

| 现有文档 | 面向谁 | 类型 | 状态 |
|---|---|---|---|
| `AGENTS.md` / `CLAUDE.md` | AI / 维护者 | 内部约定 | ✅ 最新（权威源） |
| `01-base/技术文档格式-20260525.md` | 全部 | 输出格式规范 | ✅ 基准 |
| `docs/api.md` | 集成方 | HTTP API 参考 | ✅ 最新 |
| `docs/http-service.md` | 开发者 | 服务架构 | ❌ **陈旧**（HOST 写 `0.0.0.0`、`DATA_DIR` 写 `./data`、仍提 `python3`/`python-docx`；见 §7） |
| `docs/deployment/windows-offline.md` | 交付 / 运维 | Windows 构建+部署 | ✅ 最新（含真机验证记录） |
| `docs/plans/docker-deployment.md` | 交付 / 运维 | Docker 方案 | ❌ **陈旧**（仍装 `openjdk`/`graphviz`/`python3`/`python3-docx`、`COPY bin/plantuml.jar`、ENTRYPOINT 指 `md2docx.sh`） |
| `docs/plans/{windows-native,large-image-landscape-v5,http-service,documentation-system}.md` | 维护者 | 方案 | ✅ |
| 包内 `使用说明.txt` | 使用者 | 快速上手 | ⚠️ 仅 25 行，Windows 专属 |
| `docs/issues/` `plans/` `review/` `archived/` | 维护者 | 过程档案 | — |
| `README.md`、`CHANGELOG.md` | — | 入口 / 版本 | ❌ 不存在 |
| 写 Markdown 的约定 | **文档作者** | — | ❌ 完全空白 |

### 1.2 缺口（按影响排序）

1. **没有给"写 md 的人"的文档**（最大用户群，零覆盖）。
2. **没有仓库入口**（`README.md`）。
3. **Linux 侧没有面向使用者的文档**（安装、系统依赖、字体、无头 Chromium 运行库、systemd、Docker）。
4. **没有安装/卸载/升级/运维手册**。
5. **没有时效性机制**：项目已为此付出代价（`windows-offline.md` §4.1「把旧包当新包发出去」）。
6. **没有版本管理**：无 `CHANGELOG.md`，`package.json` 版本长期 1.0.0（而安装器文件名依赖它）。
7. **文档与发布物脱节**：手册不在包里。
8. **两处陈旧文档会在迁移中被"固化"**（`http-service.md`、`plans/docker-deployment.md`）。

### 1.3 为什么现在做

- 跨平台事实已收敛（`@plantuml/core` 免 Java/graphviz、分页属性原生输出、纯 Node CLI）。
- 上一轮已把构建闸门做成体系，**顺势把"文档不过期"也做成闸门**的边际成本低。
- 把"能不写死的不写死"做在前面（manifest + 生成器），后期加文档/加平台/加环境变量时成本线性。

## 2. 目标与非目标

**目标**

1. 四类读者各有清晰路径。
2. **跨平台对等**：Windows、Linux（源码 / Docker）在安装、依赖、CLI、服务、排障上都有文档，且**如实标注验证状态**。
3. **可扩展、不写死**：导航、包内子集、事实归属、检查范围由**清单派生**；派生内容由生成器产出。
4. **更新即同步**：代码变更后，该改的文档会在**校验或 CI 中显式暴露**，不依赖人记得。
5. **版本可追溯**：SemVer + `CHANGELOG.md` + 升级/回滚手册；随包文档与版本绑定。
6. **不会过期**：可机检的事实与代码不一致时，**校验失败**。

**非目标**

- 不做多语言；目录与文件名用英文（预留 i18n）。
- 不新增**产品能力**（不因为写文档而实现 Linux 便携包、macOS 字体适配、鉴权）。
- 不把 `AGENTS.md` 内容搬进用户文档（它是维护者权威源）。

## 3. 读者与场景

| 角色 | 典型场景 | 主入口 |
|---|---|---|
| **文档作者**（最多） | "我写了一份 md，怎么变成合规 Word？题注怎么写？图为什么不显示？" | `how-to/write-markdown.md`、`how-to/use-diagrams.md`、`how-to/write-captions.md`、`reference/markdown-conventions.md` |
| **使用者**（网页 / 命令行） | "怎么启动？怎么传文件？产物在哪？报错了怎么办？" | `getting-started.md`、`reference/cli.md`、`reference/web-ui.md`、`how-to/troubleshoot.md` |
| **交付 / 运维** | "怎么构建、分发、安装、卸载、**升级**、排障？对外暴露安全吗？" | `deployment/*`（含 `upgrade.md`）、`reference/security.md` |
| **集成开发者** | "怎么调 API、字段语义、错误码？" | `reference/http-api.md` |
| **维护者** | "改了代码要改哪些文档？" | `AGENTS.md`、`contributing/*`、`docs/manifest.json` |

## 4. 平台与依赖矩阵（本方案的地基）

### 4.1 支持级别（如实标注）

> **硬规则**：未经真机端到端验证的平台，不得写「已验证」。验证状态必须能指向**可指认的证据**。

| 平台 | 分发形式 | 验证状态 | 证据 |
|---|---|---|---|
| **Windows 10/11 x64** | 离线包（免安装 zip / 一键安装器） | ✅ **已验证** | `deployment/windows-offline.md` §7.1（2026-09，12 项逐项通过） |
| **Linux x64** | 源码安装；Docker | ⚠️ **部分**：核心脚本可在 Linux 跑通合成用例（CI `ubuntu-latest` → `npm run release:win` → 内含 `smokeTestBundle`，`build-windows-bundle.js:376`）；**面向使用者的安装/系统依赖/字体/服务化流程尚未逐条实测** | `.github/workflows/release-windows.yml`；**待补**：`deployment/linux-install.md` 实跑记录 |
| **Docker** | 镜像（CLI 一次性容器 / HTTP 服务容器） | ⚠️ **未验证**（源方案本身已过时，见 §9 P1） | — |
| **macOS** | 源码安装 | ⚠️ **未验证** | 仅 Chrome 路径（`puppeteer-config.js:19-20`）与 `open` 开浏览器（`server/app.js:154`）有分支 |

**构建机平台的事实澄清**：官方发布包由 **CI（`ubuntu-latest`）** 构建；`windows-offline.md:163`
的"打包耗时"是**本地 Windows 机器**实测值。二者不是矛盾，是不同渠道。

**macOS 的如实描述**：`findChineseFont()`（`plantuml-renderer.js:246-295`）**没有 macOS 专属分支**——
`win32` 走注册表字体目录，**其余（含 macOS）统一走 `fc-list :lang=zh`**（`:275-288`）。
macOS 默认不带 fontconfig/fc-list，于是落到 `catch` → `tryWindowsFonts()`（`:289-294`）必然失败 →
返回空字体 → `injectChineseFont()` 原样返回（`:307`）→ **静默不注入字体**。
结论：macOS 上图内中文**可能变方块**且无报错。只写「未验证 + 已知字体限制」。

### 4.2 依赖矩阵

| 依赖 | 必需性 | Windows | Linux / Docker |
|---|---|---|---|
| Node.js | 必需 | 包内自带 `node.exe`（22.x） | 系统安装；最低版本由 `package.json#engines` 给出（本次补，见 §6.2 JSON 指针事实） |
| 浏览器 | 必需 | 包内 `chrome-headless-shell`（**默认内置**；`--skip-chromium` 时用系统 Chrome/Edge） | 系统 Chrome/Chromium（含 puppeteer 缓存）；Debian/Ubuntu 需一组共享库（`libnss3` 等） |
| PlantUML **渲染能力** | 必需 | **core 或 jar 任一可用**（`dependency-check.js:50-76`） | 同左 |
| `@plantuml/core`（core 后端） | 推荐 | 包内自带 | npm 依赖，`npm ci` 即得 |
| Java + graphviz | **可选** | 仅 jar 后端需要 | 同左 |
| `plantuml.jar` | 可选 | `PLANTUML_BACKEND=jar` 且找不到时可**自动下载**（`plantuml-renderer.js:71-83`、`:423-428`）→ **需联网**，或自备 | 同左 |
| 中文字体 | 必需（否则图内中文方块） | 系统自带（`plantuml-renderer.js:250-257`） | 需装，如 `fonts-noto-cjk`；探测走 `fc-list :lang=zh`（`:275-288`） |
| Python / python-docx | **已移除** | — | — |

### 4.3 入口现状与一处不一致

| 入口 | 平台 | 状态 |
|---|---|---|
| `scripts/cli.js` | 全平台（纯 Node） | ✅ 推荐入口 |
| `scripts/md2docx.sh` | Linux / macOS（bash） | ⚠️ **陈旧**：`:9-19` 交互式 `npm install`、`:27-43` 检查 Java、`:45-53` 用 `curl` 下载 `plantuml.jar` |
| `启动 md2docx.cmd` / `转换文档.cmd` | Windows 离线包 | ✅ |
| `node server/app.js` | 全平台 | ✅ |

**已知行为差异**：

| 维度 | `md2docx.sh` | `cli.js` |
|---|---|---|
| 缺依赖时 | 交互式 `npm install`（`read < /dev/tty`，**CI/容器会卡死**） | 直接抛错 |
| 文件大小显示 | `du -h`（`:114`） | `statSync` |
| Java / jar | 检查 + `curl` 下载（`:27-53`） | 无 |
| Docker ENTRYPOINT | `docker-deployment.md:91` 指向它 | — |

**处置（D1，已定）**：`md2docx.sh` 收敛为**薄封装**（`exec node scripts/cli.js "$@"`），引导改**非交互**。

**输出路径一致性**（已核对）：`cli.js:50` 与 `md2docx.js:1410-1417` 一致，`md2docx.sh:90-91` 同。

## 5. 文档架构（Diátaxis 四分法）

### 5.1 目录结构

```
README.md                            入口（版本号由构建注入）：定位 + 三平台 5 分钟上手 + 角色导航
CHANGELOG.md                         版本变更（Keep a Changelog + SemVer；含「文档」小节）
docs/
  manifest.json                      **文档清单**：导航/包内子集/锚点归属/事实来源/同步映射的单一数据源（§6.3）
  index.md                           [生成] 文档中心：按「角色 × 类型」两张导航表
  getting-started.md                 [Tutorial] 从零到第一份 docx（Windows / Linux / Docker 三条路径）

  how-to/                            [How-to] 任务导向
    write-markdown.md                  写出合规 md：标题层级、编号、列表、表格、图片
    use-diagrams.md                    mermaid / PlantUML 怎么写、默认灰阶、如何改主题
    write-captions.md                  题注格式与位置、自动编号
    troubleshoot.md                    常见问题：中文方块、降级代码块、编号乱、图丢失
    run-as-service.md                  服务化：前台 / 后台 / **systemd（Linux）** / Docker

  reference/                         [Reference] 精确清单
    markdown-conventions.md            Markdown 源文约定（识别 / 不识别规则表）
    cli.md                             命令行：参数、退出码、产物路径、CLI 环境变量
    web-ui.md                          网页端：字段、状态机、端口、数据目录
    http-api.md                        HTTP API（由 docs/api.md 迁入）
    configuration.md                   [生成] 环境变量总表（契约见 §6.2）
    supported-platforms.md             平台与依赖矩阵（含验证状态、证据、Node 最低版本）
    security.md                        安全与暴露面：默认仅绑 127.0.0.1、**无鉴权**、
                                       `HOST=0.0.0.0` 的风险与前置条件、数据目录敏感内容
    document-format.md                 [部分生成] 字体/字号/页边距由 SIZE/FONT/PAGE 生成；
                                       表格线宽/行高/题注规则**人工维护**（文首标注，见 §6.3）

  explanation/                       [Explanation] 原理与取舍
    pipeline.md                        两阶段流水线；clean.md 是什么
    why-no-java.md                     core 后端选型；为什么免 Java/Graphviz/Python
    landscape-and-pagination.md        长图横置、题注分页的规则与已知取舍

  deployment/                        [运维 / 交付]
    build-release.md                   打包与发布：构建闸门、CI、校验和、版本号
    windows-offline.md                 （现有，扩充；安装/卸载/升级拆出）
    linux-install.md                   Linux 源码安装 / 系统依赖 / 字体 / 卸载（**含实跑记录**）
    docker.md                          容器化部署（**由"先修订后"的 plans/docker-deployment.md 提炼**）
    install-uninstall.md               安装 / 卸载 / 残留清理（按平台分节；**安装步骤的唯一权威源**）
    upgrade.md                         **升级与回滚**：Windows 包 / 安装器 / 源码 / Docker；数据兼容
    operations.md                      运维：数据目录、日志、端口、清理、备份

  contributing/                      [维护者]
    architecture.md                    （由 docs/http-service.md **迁移 + 修订**）
    development.md                     开发环境、验证方法、发布流程（指向 AGENTS.md）

  glossary.md                        术语表：题注、横置、降级为代码块、clean.md、core 后端…

  examples/                          教学用最小示例（带期望值，进包内子集，见 §6.6）

  plans/  review/  archived/         过程档案（维护者用，**不属用户文档体系**）
    plans/ 当前含：documentation-system.md、windows-native.md、large-image-landscape-v5.md、
           docker-deployment.md、http-service.md（迁移去向后归档）
```

### 5.2 单一事实源规则（防膨胀、防重叠）

| 事实 | 唯一权威位置 | 其他位置 |
|---|---|---|
| Markdown 写法规则 | `reference/markdown-conventions.md` | how-to 只链接 |
| 环境变量 | `reference/configuration.md`（生成） | 各文档只链接 |
| 平台支持状态与证据 | `reference/supported-platforms.md` | 各文档只链接 |
| **安装/卸载/升级步骤** | `deployment/{install-uninstall,upgrade}.md` | `getting-started.md` 只给最短路径 + 链接 |
| 输出样式 | `reference/document-format.md`（部分生成） | `01-base/技术文档格式-20260525.md` 仍是**规范基准** |
| 内部约定与陷阱 | `AGENTS.md` | 用户文档**不复制** |
| **结构类信息**（有哪些文档、进不进包、谁负责哪个事实、改代码要动哪篇） | `docs/manifest.json` | 生成器与校验器**只读它** |
| **代码事实**（常量/默认值/路径/入口名） | **代码本身**（`@docfact` 标记或 `package.json` 字段） | 文档只通过 claim 锚点引用 |

### 5.3 每篇的"不做什么"

- `getting-started.md`：不讲原理、不讲全部选项，只保证"照做能出结果"。
- `how-to/*`：不解释为什么，只给可执行步骤 + 期望结果 + 失败怎么办。
- `reference/*`：不写教程，只给清单与语义。
- `explanation/*`：不给操作步骤，只讲原理与取舍。

## 6. 时效性、可扩展性、版本管理

### 6.1 ① 版本信息由构建期注入（不可手写）

每份**随包发布**的用户文档头部带占位符：

```
> 适用版本 {{VERSION}} · 构建 {{COMMIT}} · {{BUILD_TIME}}
```

- **Windows 包**：组装时在**临时副本**上替换（版本取 `package.json`，commit/time 取 `buildStamp()`，
  已有落点 `:136-144`）。**绝不在仓库内原地替换**——否则弄脏工作区，触发自己的 `assertCleanTree`（`:623-639`）。
- **Linux / 源码**：`.github/workflows/docs-linux.yml`（`npm ci` → `verify:docs` → 生成 `docs/.docstamp`）。
  （`.github/` 当前未跟踪，须在实施首个 PR 纳入版本控制。）

### 6.2 ② 事实一致性校验（v6 已补全文件注册表与守卫形式）

**设计原则**：只校验**能无副作用、无环境依赖地取得**的事实；其余归"人工维护"并**如实标注**。

#### 单一文件注册表（v6：一张表，两个用途列）

> v4 只定义了环境变量白名单，导致 `clean_dir`/`docx_dir`/`entry_cmds` 所在文件不在扫描范围（第四轮严重问题）；
> v5 拆成两张清单，但 `-nodefault` 标记的宿主文件又漏登记（第五轮问题 2）。
> **v6 合并为一张注册表**，消除"两张清单不同步"的可能：

| 文件 | 可携带 `@docfact`（Tier A 标记） | 参与 env 扫描（生成 `configuration.md`） |
|---|---|---|
| `server/config.js` | ✓ | ✓ |
| `scripts/cli.js` | ✓ | — |
| `scripts/plantuml-renderer.js` | ✓ | ✓ |
| `scripts/build-windows-bundle.js` | ✓ | — |
| `scripts/puppeteer-config.js` | ✓（`-nodefault`） | ✓ |
| `server/app.js` | ✓（`-nodefault`） | ✓ |
| `scripts/md2docx.js` | ✓（`-nodefault`） | ✓ |

- **不在"可携带 `@docfact`"列的文件里出现 `@docfact` 标记 → 失败**（防"标记写在我没扫的文件里"）。
- **在"参与 env 扫描"列的文件里出现未登记的 `process.env.X` → 失败**（见下方生成契约）。

#### Tier A 的两种事实来源

| 来源 | 形式 | 适用 |
|---|---|---|
| **① 代码标记** | 源码行尾注释 `// @docfact key=value` | 常量、默认值、路径、入口名 |
| **② JSON 指针** | `manifest.json` 的 `jsonFacts` 登记 `{ "key": "engines_node", "source": "package.json#engines.node" }` | `package.json` 这类**不能写注释**的结构化文件 |

**标记语法与硬性排版规则**：

```
// @docfact <key>=<value>              // 有值事实
// @docfact-nodefault <key>            // 无默认值事实（只登记存在，不参与值断言）
```

> **硬性规则**：`@docfact` 标记**必须与它所描述的真实常量处于同一行**（行尾注释）。
> 扫描器**只断言标记所在行**，不回溯上一行、不搜索整个文件。

**守卫（v6：四种合法 token 形式）**：

1. 扫描注册表中"可携带 `@docfact`"的文件，收集 `@docfact key=value`；
2. 取**标记所在行**，**先剔除所有 `@docfact …=…` 片段**（否则恒真）；
3. 把 value 按 **`|` 与 `,`** 切分为 token（**不**按 `/` 切）；
4. 断言每个 token 以**完整字面量**形式出现在剩余文本中，合法形式**四种**：

| 形式 | 判定 | 例 |
|---|---|---|
| 数字 | 前后不得紧邻其他数字或字母（词边界） | `8080`、`30000` |
| **布尔字面量**（v6 新增） | `true` / `false`，词边界 | `false`（`config.js:111`） |
| 引号字符串 | `'token'` 或 `"token"` | `'output/clean'`、`'core'` |
| 点分标识符 | 裸标识符（含 `.`） | `SIZE.小四`（`md2docx.js:50`）、`FONT.黑体`（`:55`）、`PAGE.marginTop`（`:63`） |

**单值事实**：

```js
// server/config.js
port: num(process.env.PORT, 8080),                  // @docfact default_port=8080
host: process.env.HOST || '127.0.0.1',              // @docfact default_host=127.0.0.1
maxConcurrent: num(process.env.MAX_CONCURRENT, 2),   // @docfact default_max_concurrent=2
queueLimit: num(process.env.QUEUE_LIMIT, 50),        // @docfact default_queue_limit=50
debug: bool(process.env.DEBUG, false),               // @docfact default_debug=false
```

**多值/跨行事实**（**标记与常量同行**）：

```js
// scripts/cli.js
const OUT_DIRS = { clean: 'output/clean', docx: 'output/docx' };  // @docfact clean_dir=output/clean @docfact docx_dir=output/docx
...
const out = path.join(inputDir, OUT_DIRS.docx, `${path.basename(abs, '.md')}.docx`);
```
```js
// scripts/plantuml-renderer.js
const BACKEND_VALUES = ['core', 'jar', 'auto'];                   // @docfact backend_values=core|jar|auto
function resolveBackend(puml) {
  const raw = (process.env.PLANTUML_BACKEND || 'auto').toLowerCase();  // @docfact default_plantuml_backend=auto
  const want = BACKEND_VALUES.includes(raw) ? raw : 'auto';       // 非法值回退 auto，与现状逐输入等价
  ...
}
```
```js
// scripts/build-windows-bundle.js
const ENTRY_CMDS = ['启动 md2docx.cmd', '转换文档.cmd', '自检.cmd']; // @docfact entry_cmds=启动 md2docx.cmd,转换文档.cmd,自检.cmd
```
**无默认值事实**（只登记，不做值断言）：

```js
// scripts/puppeteer-config.js
const override = process.env.PUPPETEER_EXECUTABLE_PATH;   // @docfact-nodefault puppeteer_executable_path
```
```js
// server/app.js
if (process.env.NO_OPEN_BROWSER !== '1' && process.env.MD2DOCX_OPEN_BROWSER === '1') {   // @docfact-nodefault no_open_browser @docfact-nodefault md2docx_open_browser
```
```js
// scripts/md2docx.js
  if (process.env.ENABLE_PAGINATION_PATCH === '1') {   // @docfact-nodefault enable_pagination_patch
```

并把内联字面量改为引用常量（行为不变）：`:295`（`ENTRY_CMDS[0]`）、`:312`（`ENTRY_CMDS[1]`）、
`:731`（`ENTRY_CMDS[2]`）、`:474-476`（展开 `ENTRY_CMDS`）、**安装器 NSI `:851/853`**。

> 因此 §9.0 **C1 不是"只加注释"**：对 3 个文件有机械的常量替换改动，行为不变
> （等价性已逐输入核对：`resolveBackend` 对 `jar/core/auto`、大小写、空格、非法值、未设、空串映射一致）。

**Tier A 检查项**

| # | 检查 | 说明 |
|---|---|---|
| 1 | 文档 `<!-- docfacts -->` 块 vs 事实表（①+②） | 逐键比对，失败输出「文件 / 键 / 文档值 / 实际值」 |
| 2 | **claim 锚点** | **每个 Tier A 键全体系恰好一个** `<!-- claim:key -->值<!-- /claim -->`。**归属规则化**：`default_*` 与 `backend_values` → `reference/configuration.md`（**锚点由生成器产出**）；`clean_dir`/`docx_dir` → `reference/cli.md`；`entry_cmds` → `deployment/windows-offline.md`；`engines_node` → `reference/supported-platforms.md`；`-nodefault` 类**不产生锚点**（无可断言的值） |
| 3 | 生成文件与生成器输出**逐字节一致** | `index.md`、`configuration.md`、`document-format.md`（生成部分）；不一致提示 `npm run docs:gen` |
| 4 | 仓库内相对链接可解析 | 防迁移断链 |
| 5 | 注册表完整性 | "可携带 `@docfact`"列中的**已知事实缺标记** → 失败；**非该列文件出现标记** → 失败 |

#### `configuration.md` 的生成契约

- **范围**：**用户可配置**的环境变量。
- **扫描**：注册表"参与 env 扫描"列。
- **键名映射**：`<key> = 环境变量名小写`（`PORT`→`default_port`、`MAX_FILE_SIZE_MB`→`default_max_file_size_mb`）。
- **黑名单（OS / 构建内部，不进表）**：`LOCALAPPDATA`、`WINDIR`、`SystemRoot`、`NSIS_DEB_BASE`、
  `NSISDIR`、`NODE_ENV`、`CDP_URL`、`PUPPETEER_SKIP_DOWNLOAD`。
- **未知即失败**：扫描列的 `process.env.X` 若既不属黑名单，也没有 `@docfact default_<key>=…`
  或 `@docfact-nodefault <key>` → **校验失败**。
- **逐条登记**：

  | 环境变量 | 处置 |
  |---|---|
  | `PORT` | `default_port=8080` |
  | `HOST` | `default_host=127.0.0.1` |
  | `MAX_CONCURRENT` | `default_max_concurrent=2` |
  | `QUEUE_LIMIT` | `default_queue_limit=50` |
  | `MAX_FILE_SIZE_MB` | `default_max_file_size_mb=20` |
  | `MAX_DIAGRAMS` | `default_max_diagrams=30` |
  | `JOB_TTL_MINUTES` | `default_job_ttl_minutes=60` |
  | `CLEANUP_INTERVAL_MINUTES` | `default_cleanup_interval_minutes=10` |
  | `GRACEFUL_TIMEOUT_MS` | `default_graceful_timeout_ms=30000` |
  | `RATE_LIMIT_PER_MINUTE` | `default_rate_limit_per_minute=20` |
  | `HEALTH_CACHE_TTL_MS` | `default_health_cache_ttl_ms=60000` |
  | `JOB_TIMEOUT_MS` | `default_job_timeout_ms=900000` |
  | `DEBUG` | `default_debug=false`（`config.js:111`） |
  | `PLANTUML_BACKEND` | `default_plantuml_backend=auto` |
  | `DATA_DIR` | `-nodefault data_dir` |
  | `PUPPETEER_EXECUTABLE_PATH` | `-nodefault puppeteer_executable_path` |
  | `JAVA_HOME` | `-nodefault java_home` |
  | `MD2DOCX_OPEN_BROWSER` | `-nodefault md2docx_open_browser` |
  | `NO_OPEN_BROWSER` | `-nodefault no_open_browser` |
  | `ENABLE_PAGINATION_PATCH` | `-nodefault enable_pagination_patch` |
  | 黑名单各项 | 不进表 |

- **`envNotes`（人工登记的语义说明）**：判据是"**进表且无同行注释**的变量必须登记"，
  **由生成器报告缺失项**，实施时以报告为准（不靠人工维护清单）。**预期需登记 7 条**：
  `DATA_DIR`、`PUPPETEER_EXECUTABLE_PATH`、`JAVA_HOME`、`MD2DOCX_OPEN_BROWSER`、`NO_OPEN_BROWSER`、
  `ENABLE_PAGINATION_PATCH`、`PLANTUML_BACKEND`。

#### Tier B — 人工维护（不冒充机器校验）

```
<!-- docfacts-manual
platform_status: windows=verified,linux=partial,docker=unverified,macos=unverified
evidence_windows: docs/deployment/windows-offline.md
evidence_linux: docs/deployment/linux-install.md
-->
```
只校验**存在性、取值域、evidence 链接可解析**；不声称与代码一致。
（`evidence_linux` 指向的骨架页由 §9 **P0 第 0 步**先创建。）

### 6.3 ③ 文档清单（manifest）驱动 —— 可扩展、不写死

**清单是唯一数据源；其余全部派生。** 严格 JSON（**不带注释**）：

```json
{
  "version": 1,
  "docs": [
    { "id": "getting-started", "path": "getting-started.md", "type": "tutorial",
      "audience": ["user"], "platforms": ["windows", "linux", "docker"], "inBundle": true },
    { "id": "reference/cli", "path": "reference/cli.md", "type": "reference",
      "audience": ["user"], "platforms": ["windows", "linux"], "inBundle": true }
  ],
  "jsonFacts": [
    { "key": "engines_node", "source": "package.json#engines.node" }
  ],
  "factOwners": {
    "default_*": "reference/configuration.md",
    "backend_values": "reference/configuration.md",
    "clean_dir": "reference/cli.md",
    "docx_dir": "reference/cli.md",
    "entry_cmds": "deployment/windows-offline.md",
    "engines_node": "reference/supported-platforms.md"
  },
  "generated": [
    { "path": "index.md", "from": "manifest" },
    { "path": "reference/configuration.md", "from": "code:env" },
    { "path": "reference/document-format.md", "from": "code:md2docx-layout", "partial": true }
  ],
  "syncMap": [
    { "source": "server/config.js", "docs": ["reference/configuration.md", "deployment/operations.md"] },
    { "source": "scripts/cli.js", "docs": ["reference/cli.md", "getting-started.md"] },
    { "source": "scripts/build-windows-bundle.js", "docs": ["deployment/build-release.md", "deployment/windows-offline.md"] },
    { "source": "scripts/preprocess.js", "docs": ["how-to/write-markdown.md", "reference/markdown-conventions.md"] },
    { "source": "scripts/md2docx.js", "docs": ["reference/document-format.md", "explanation/landscape-and-pagination.md"] },
    { "source": "scripts/self-check.js", "docs": ["deployment/windows-offline.md"] },
    { "source": "server/public/app.js", "docs": ["reference/web-ui.md"] },
    { "source": "package.json", "docs": ["CHANGELOG.md", "deployment/upgrade.md"] }
  ],
  "envNotes": {
    "DATA_DIR": "作业数据目录；默认安装目录下 data/，只读时回退用户级目录",
    "PUPPETEER_EXECUTABLE_PATH": "显式指定 Chrome/Chromium/Edge 可执行文件",
    "PLANTUML_BACKEND": "PlantUML 后端：core（免 Java/graphviz）| jar（需 Java）| auto"
  }
}
```

**由 manifest 派生的东西**（都**不手写**）：`docs/index.md` 导航、**包内子集清单**、
Docker 镜像内文档、claim 锚点归属、链接检查范围、事实表（①+②）。

**`document-format.md` 的生成边界**：

- **生成部分**：`scripts/md2docx.js` 顶部 `SIZE`（`:50`）/ `FONT`（`:52`）/ `PAGE`（`:61`）三块
  （受控静态提取；**提取失败即报错**，不静默降级）。
- **人工部分**：表格线宽/行高、题注规则等（实为 `md2docx.js:75-123` 的 `documentStyles`，
  结构复杂、静态提取脆弱）。文首显式标注"以下章节为人工维护"，并纳入 `syncMap`。
- **不追求把 `documentStyles` 自动化**：收益小、脆弱性高。

**新增一篇文档 / 一个环境变量 / 一个平台时的改动面**：

| 场景 | 需要改的地方 |
|---|---|
| 新增一篇文档 | 建文件 + `manifest.docs` 加一条 → 导航、包内子集、链接检查自动更新 |
| 新增一个环境变量 | 代码里加 `@docfact default_<key>`（或 `-nodefault`）+ 必要时 `envNotes` → 表格与锚点自动更新 |
| 新增一个 Tier A 事实 | 常量行尾加 `@docfact` 标记 + `factOwners` 加规则/条目（`package.json` 字段走 `jsonFacts`） |
| 新增一个平台 | `manifest` 的 `platforms` 取值 + `supported-platforms.md` 一行 + Tier B 状态 |

### 6.4 ④ 程序更新 → 文档同步

**三层，首期只把"事实级"设为硬门禁**：

| 层 | 机制 | 强度 |
|---|---|---|
| **事实级** | `@docfact` 标记 / claim 锚点 / 生成文件逐字节 / 未知环境变量即失败 | **硬门禁**（构建 + CI 失败） |
| **关联级** | `manifest.syncMap`：CI 比对 PR 改动文件，命中 `source` 而对应 `docs` 未被 touch → **警告**（首期）；可 `docs-sync-exempt` 标签豁免 | **首期 warn** |
| **人工级** | `npm run docs:status`：列出"代码已变、文档未更新"与生成物过期项；**并列出未被 `syncMap` 覆盖的源码变更**（提示级，不失败） | 辅助 |

**基线**：`docs:status` 以**最近发布 tag** 为基线（无 tag 时退化 `HEAD~10`）。

**为什么不做"自动改文档"**：事实类（端口/路径/默认值）**可自动同步**（生成器已覆盖）；
语义类（这段说明是否还准确）**无法自动判断**。方案不假装能自动写文档。

### 6.5 ⑤ 版本管理

| 项 | 内容 |
|---|---|
| **版本号** | `package.json` 的 `version` 为唯一来源（SemVer） |
| **`CHANGELOG.md`** | Keep a Changelog：`## [Unreleased]` 与 `## [x.y.z] - YYYY-MM-DD`；分类 `新增/变更/修复/移除/安全`，并固定含一节 **`文档`** |
| **闸门 `verifyVersion()`** | ① **单调性**：CHANGELOG 中的已发布版本段**自上而下严格递减**——**按 SemVer 语义比较**（主→次→修订逐段数值比较，**不是字符串排序**，否则 `1.10.0` 会被误判小于 `1.9.0`）；与 `package.json` 解耦，无鸡生蛋。② **发布态一致性**：仅在 `release:win` / CI 发布时要求 `package.json.version` 等于 CHANGELOG 中**最大**的已发布版本段，且 `Unreleased` 为空。③ 开发态（普通 PR）只跑 ①。 |
| **tag ↔ 版本** | 发布 tag（`v*`）必须与 `package.json.version` 一致，否则 CI 失败 |
| **发布资产命名** | 带版本：`md2docx-win-x64-<ver>.zip`、`md2docx-Setup-<ver>-win-x64.exe`；`RELEASE-INFO.txt` 记录 **SemVer** + commit + SHA256；**CI 工作流的 artifact 名与路径同步更新**（§9.0 C9） |
| **文档版本绑定** | 随包文档头部 `适用版本` 由构建注入；`docs/index.md` 显示当前版本；CHANGELOG 的「文档」节让用户知道某版文档改了什么 |
| **升级手册** `deployment/upgrade.md` | 按平台给升级与回滚：**Windows**（免安装包替换目录 / 安装器覆盖安装）· **源码**（`git pull` + `npm ci` + 重建图表缓存）· **Docker**（拉新镜像 / 重建卷）· **数据与产物兼容性**（`data/jobs/`、`output/` 缓存处置）· **回滚** |

### 6.6 ⑥ 示例即用例

**现状**：`smokeTestBundle`（`build-windows-bundle.js:687-724`）只跑 `self-check.js --allow-no-browser`；
`self-check.js` 的端到端用例写死（`:199-212`），断言只有"图片 ≥3、表格 ≥1、无 `![` 残留"（`:248-253`），
**没有题注计数**。

**改造点**：

1. `self-check.js` 支持 `--examples <dir>`，对每个示例跑转换，读取示例 YAML front matter 的期望值断言：
   ```yaml
   ---
   title: 题注写法示例
   doccheck: { images: 2, tables: 1, captions: 3 }
   ---
   ```
   **已实测**：`doccheck` 键对 `preprocess.js:102-136` 与 `md2docx.js:1432-1433` 无害。
2. `smokeTestBundle` 传**包内** `docs/examples/`；**示例转换输出到临时目录**——
   `preprocess` 默认写输入同级（`cli.js:50`），就地转换会在 `BUNDLE_DIR` 里生成 `output/` 并被一起打进 zip。
3. **示例来源规则**：`md/qa/` 不进包，**包内文档不得链接 `md/qa/`**；示例内联或放 `docs/examples/`。

## 7. 与现有文档的映射（迁移即修订）

| 现有 | 去向 | 处理 |
|---|---|---|
| `docs/api.md` | `docs/reference/http-api.md` | **迁移**；旧路径留跳转说明。内容已是最新（`api.md:21-22` 含 requiredKeys/optionalKeys，`:36-39` 档位表） |
| `docs/http-service.md` | `docs/contributing/architecture.md` | **迁移 + 修订**：① `:173` `HOST` 默认应为 `127.0.0.1`（`server/config.js:80`）；② `:174` `DATA_DIR` 默认应为"安装目录 `data/`，只读时回退"（`server/config.js:38-73`）；③ `:84`/`:188` 的 `python3`/`python-docx` 残留（`dependency-check.js:85` 已注明移除） |
| `docs/issues/*` | `docs/contributing/issues/*` | 迁移 + 更新引用 |
| `docs/deployment/windows-offline.md` | 同名 | 扩充；安装/卸载/升级拆出 |
| `docs/plans/docker-deployment.md` | 保留为方案 | **先修订**（§9 P1 前置）→ 提炼 `deployment/docker.md` |
| `docs/plans/{windows-native,large-image-landscape-v5,http-service}.md` | 保留为方案 | 按流程后续归档 |
| `AGENTS.md` | 不动 | 补文档/版本相关命令 |
| 包内 `使用说明.txt` | 升级为导航页 + 包内 `docs/` 子集 | 见 §8 |
| 新增 | `README.md`、`CHANGELOG.md`、`docs/manifest.json`、`docs/index.md`(生成)、`docs/glossary.md`、`docs/reference/security.md`、`docs/deployment/upgrade.md`、`docs/examples/` | 新建 |

迁移硬要求：**同 PR 内更新全部引用**，`git grep` 确认无残留旧路径。

## 8. 随发布物分发（含对等性说明）

**构建脚本改动清单**：

1. 按 `manifest.docs[].inBundle` **派生**包内文档子集（**不写死列表**）
2. 在**临时副本**上替换 `{{VERSION}}/{{COMMIT}}/{{BUILD_TIME}}`（不改仓库）
3. 新增 `verifyBundledDocs`：包内文档与仓库一致（占位符除外）；**并校验包内相对链接在包内可解析**
4. `assertBundleContents` 必需清单增列文档项（`:470-493`）
5. 发布资产名带版本（`md2docx-win-x64-<ver>.zip`），CI artifact 名同步（§9.0 C3/C9）

| 分发物 | 随附文档 | 版本绑定方式 | 对等性 |
|---|---|---|---|
| **Windows 离线包** | `使用说明.txt`（导航页）+ 按 manifest 派生的 `docs/` 子集 | 包内版本信息由构建注入，**文档随包固定** | ✅ 完整 |
| **Linux 源码** | 仓库 `README.md` + `docs/` | 文档随**仓库 HEAD**，不随发布物 | ⚠️ **已知不对等**（T1 不做 Linux 便携包）；缓解：CHANGELOG 的「文档」节 + `supported-platforms.md` 写明 |
| **Docker 镜像** | 镜像内 `docs/` 子集（按 manifest 过滤）+ 仓库链接 | 同源码 | ⚠️ 同上 |

包内子集默认 = `inBundle: true` 的全部文档；**不含** `deployment/`、`contributing/`、`explanation/`、
`plans|review|archived`、`md/`。

## 9. 实施步骤

### 9.0 本方案涉及的代码改动（非文档）

| # | 文件 | 改动 | 风险 |
|---|---|---|---|
| **C1** | `server/config.js`（注释）、`scripts/cli.js`（`OUT_DIRS` + 引用）、`scripts/plantuml-renderer.js`（`BACKEND_VALUES` + 等价回退）、`scripts/build-windows-bundle.js`（`ENTRY_CMDS` + 替换 `:295/:312/:731/:474-476` 与安装器 `:851/853`）、`scripts/puppeteer-config.js`/`server/app.js`/`scripts/md2docx.js`（`-nodefault` 标记） | 同行 `@docfact` + 常量替换 | 中（机械替换，等价性已核对；由 `verifyBundleCode` + `smokeTestBundle` 覆盖） |
| **C2** | `scripts/doc-facts.js`、`scripts/verify-doc-facts.js`（新）、`package.json` | 文件注册表 + 标记/JSON 指针扫描 + 校验 + `verify:docs` / `docs:gen` / `docs:status` | 低（无 require、无写盘） |
| C3 | `scripts/build-windows-bundle.js` | 按 manifest 组装 docs 子集 + 副本占位符替换 + `verifyBundledDocs` + 闸门 `verifyDocClaims`；发布资产名带版本 | 中 |
| C4 | `scripts/self-check.js` | 注释写清平台事实（`self-check.js:5`）+ 示例参数化 + 题注断言 + 输出到临时目录 | 中 |
| C5 | `scripts/md2docx.sh` | 收敛为薄封装（D1），引导改非交互 | 中 |
| C6 | `docs/plans/docker-deployment.md` | 去 python/Java/graphviz/jar，改 core 后端，ENTRYPOINT 改 `node scripts/cli.js` | 中 |
| C7 | `package.json` | 补 `engines`（经 `jsonFacts` 成为 Tier A 事实） | 低 |
| C8 | `docs/http-service.md` | 迁移即修订（§7） | 低 |
| C9 | `.github/workflows/release-windows.yml`（改）、`docs-linux.yml`、`docs-sync.yml`（新） | 资产/artifact 名带版本；`verify:docs`；生成物一致性；`syncMap` 漂移（首期 warn） | 低 |
| C10 | `scripts/doc-gen.js`（新） | 生成 `index.md` / `configuration.md` / `document-format.md`（部分） | 中（依赖受控提取，失败即报错） |
| C11 | `scripts/verify-version.js`（新）、`CHANGELOG.md`（新） | 版本闸门（SemVer 单调性 + 发布态一致性 + tag↔version） | 低 |

### P0 — 地基与最高价值

0. 建 `deployment/linux-install.md` 骨架（标「未验证」）——供 Tier B 的 `evidence_linux` 指向
1. **C2**：文件注册表 + `doc-facts.js` + `verify-doc-facts.js` + `verify:docs`（**必须能证明它会失败**）
2. **C1**：常量 + 同行标记（含安装器对齐、`-nodefault` 宿主）
3. **C11**：`CHANGELOG.md` + `verifyVersion` 闸门
4. **C4 注释部分**：平台口径写清事实
5. **Linux 实跑证据**：补 `linux-install.md` 实跑记录，否则该页与 §4.1 的 Linux 行保持"未验证"
6. `docs/manifest.json` + **C10**（先做 `index.md` 生成）→ 确立"清单驱动、不写死"的地基
7. `README.md`、`docs/glossary.md`
8. `reference/markdown-conventions.md`、`supported-platforms.md`、`cli.md`、`configuration.md`(生成)、`security.md`、`document-format.md`(部分生成)
9. `getting-started.md`
10. `how-to/write-markdown.md`、`use-diagrams.md`、`write-captions.md`、`troubleshoot.md`
11. **C3 + C9**：按 manifest 打进包 + 构建闸门 + Linux/漂移工作流

### P1 — 运维、交付与升级对等

12. **C6** → `deployment/docker.md`（标注未验证）
13. `deployment/install-uninstall.md`、`operations.md`、`upgrade.md`、`linux-install.md`（补全）
14. `how-to/run-as-service.md`（含 systemd）、`reference/web-ui.md`、`http-api.md`（迁移）
15. **C5**：`md2docx.sh` 收敛（D1）

### P2 — 维护者与原理

16. `explanation/*`
17. **C8**：`contributing/architecture.md` 迁移+修订；`development.md`；`issues/` 迁移
18. **C4 示例部分**：`docs/examples/` 纳入 smoke test（输出到临时目录）

## 10. 风险与取舍

| 风险 | 取舍 / 缓解 |
|---|---|
| 文档重组产生外链 404 | 旧路径留跳转说明；`index.md`（生成）集中登记；`git grep` 校验 |
| **同行守卫的能力边界** | 四种 token 形式覆盖数字/布尔/字符串/点分标识符，但仍**挡不住同一行内两处同名字面量互换**——如实登记，不夸大。真正兜底的是生成器（`configuration.md` 整表生成，不靠守卫） |
| **注册表漏登记**（第四/五轮同类问题复发） | 单一注册表（一张表两个用途列），非该列文件出现标记即失败；"已知事实缺标记即失败"做完整性检查 |
| C1 的机械改动引入行为差异 | 三处均为常量替换/等价回退；由 `verifyBundleCode` + `smokeTestBundle` + 端到端转换覆盖 |
| 生成器过度设计 / 提取脆弱 | `document-format.md` 明确"部分生成"，`documentStyles` **不自动化**；提取**失败即报错** |
| manifest 成为新的单点 | manifest 是被校验的一方（路径存在、生成物一致、归属完整），改错会立刻失败而非静默 |
| 校验脚本自身误报阻断构建 | 只用静态扫描（无 require、无副作用、无 env 依赖）；解析失败**明确报错**；失败信息含文件/键/期望/实际 |
| **syncMap 误伤 / 假阴性** | 首期 **warn**（非阻断）+ 豁免标签；未覆盖源文件由 `docs:status` 提示；硬门禁只保留事实级 |
| **版本闸门阻断日常开发** | 单调性检查与 `package.json` 解耦且按 SemVer 语义；发布态检查只在 `release:win`/CI 跑 |
| 包内文档死链 | 包内文档禁止引用 `md/qa/`；`verifyBundledDocs` 校验包内相对链接 |
| 文档数量增加反而过得更快 | §5.2 单一事实源 + §6.2 校验 + manifest 派生 + 每篇"不做什么" |
| 跨平台文档写成"Windows 为主、Linux 附注" | §4 矩阵前置；how-to 按平台分节；Linux 路径**在 Linux 实跑后才写** |
| Linux 分发/版本绑定不对等 | §8 显式登记；`supported-platforms.md` 写明 |
| 包体积增加 | 纯文本，量级可忽略（< 500KB） |

## 11. 已决与待决

### 已决

| 编号 | 结论 |
|---|---|
| **D1 / T2** | `md2docx.sh` 收敛为薄封装，引导改**非交互**；同步修订 Docker ENTRYPOINT |
| **T3** | 正文一致性用 **claim 锚点**，范围"每个键全体系恰好一个" |
| **T6** | `docs/examples/` 期望值用 **YAML front matter 的 `doccheck` 键**（已实测无害） |
| **T7** | 文档结构、包内子集、锚点归属、检查范围由 **`docs/manifest.json`** 派生 |
| **T8** | 版本号以 `package.json` 为唯一来源；`CHANGELOG.md` 必有对应版本段（`verifyVersion`） |
| **T9** | `document-format.md`：**部分生成**（`SIZE/FONT/PAGE`）+ 部分人工（`documentStyles` 相关） |
| **T10** | Tier A 事实有两种来源：代码 `@docfact` 标记（①）与 `jsonFacts` JSON 指针（②） |
| **T11（新）** | 扫描范围用**单一文件注册表**（一张表两个用途列），不再维护两张清单 |

### 待决

| 编号 | 问题 | 建议 |
|---|---|---|
| **T1** | 是否新增 **Linux 便携包/离线包**？ | **本次不做**；`supported-platforms.md` 记为「源码安装 / Docker，无便携包」 |
| **T4** | 是否覆盖 macOS？ | 只写「未验证 + 已知字体限制」，不承诺 |
| **T5** | 是否需要英文版 | 本次不做；目录/文件名用英文预留 |

## 12. 验证方法

1. **机制自证（必须有"能失败"的证明）**：
   - 改错某文档 claim 锚点值 → `verify:docs` **失败**并指出文件/键/期望/实际
   - 改错 `@docfact` 标记值，**含多值事实**（把 `OUT_DIRS.docx` 改成 `output/docxs`）→ 失败
   - **改错布尔默认值**（把 `default_debug=false` 改成 `true`）→ 失败
   - **把 `@docfact` 标记搬到注册表之外的文件** → 失败
   - 在扫描列文件里加一个未登记的环境变量 → 失败；删掉 `PLANTUML_BACKEND` 的默认标记 → 失败
   - 把 `index.md` / `configuration.md` / `document-format.md`（生成部分）任改一字 → 失败并提示 `docs:gen`
   - 制造版本段乱序（`1.1.0` 在 `1.2.0` 之上）→ `verifyVersion` 失败；`1.10.0` 与 `1.9.0` 的次序
     必须按 SemVer 判定正确；发布态下 `package.json.version` 与最大版本段不符 → 失败
   - 全部改回 → 通过
2. **构建期**：`npm run build:win` 必须包含并跑过 `verifyDocClaims` + `verifyBundledDocs` + `verifyVersion`；
   不一致时构建中止，**且该构建自身要成功一次**（证明闸门不会无条件失败）。
3. **可扩展性验收**：临时在 `manifest.docs` 加一条新文档 → `index.md` 自动出现该条目、包内子集自动包含、
   链接检查自动覆盖，**除 manifest 外无需改动任何脚本或手写列表**。
4. **随包**：解压后确认包内文档子集与 manifest 一致、占位符**已被替换**、发布资产名含版本、
   `使用说明.txt` 指向的文件存在、**包内相对链接全部可解析**（含 `examples/`）。
5. **跨平台文档准确性**：`linux-install.md` 每条命令在 Linux 上实跑并留存输出；`getting-started.md`
   三条路径各自走通一次。**未完成前的措辞必须是"未验证"**。
6. **示例即用例**：`docs/examples/` 参与 `smokeTestBundle`，断言图/表/题注数与 front matter 一致，
   且**不在包目录内产生 `output/`**。
7. **链接完整性**：`verify:docs`（仓库内）+ `verifyBundledDocs`（包内）。
8. **单一事实源**：`git grep` 确认关键事实只在权威文档出现一次。
