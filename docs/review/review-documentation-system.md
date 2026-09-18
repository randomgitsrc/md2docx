# 评审：文档体系方案（跨平台）

## 评审日期
2026-09-17

## 评审范围

- `docs/plans/documentation-system.md`（待评审方案，327 行）
- 代码（逐条核对，非仅阅读）：
  - `scripts/cli.js`、`scripts/md2docx.sh`、`scripts/preprocess.js`、`scripts/md2docx.js`
  - `scripts/puppeteer-config.js`、`scripts/plantuml-renderer.js`、`scripts/plantuml-core-renderer.js`
  - `scripts/build-windows-bundle.js`、`scripts/self-check.js`、`scripts/exec-util.js`
  - `server/config.js`、`server/app.js`、`server/services/dependency-check.js`、`server/public/app.js`
- 文档：`AGENTS.md`、`CLAUDE.md`、`docs/api.md`、`docs/http-service.md`、
  `docs/deployment/windows-offline.md`、`docs/plans/windows-native.md`、
  `docs/plans/docker-deployment.md`、`docs/issues/README.md`、`01-base/技术文档格式-20260525.md`
- 约定与历史评审：`docs/review/review-windows-native.md`、`docs/archived/review/review-large-image-landscape-v5.md`
- 外部事实核查：本机（Windows，Node v24.20.0）实跑 `require('./server/config')`、
  `require('./scripts/plantuml-renderer')` 等验证模块副作用与导出面。

## 总体结论

**方向正确，但地基有两处硬伤，需修订后再评审。**

方案对"用户文档空白"的盘点基本准确（`README.md`/`CHANGELOG.md`/`docs/index.md`/`docs/glossary.md` 经本机确认均不存在），
Diátaxis 分层、单一事实源、构建期注入版本、"示例即用例"这些方向也都站得住。`md2docx.sh` 陈旧的判断是正确的
（Java/curl/npm install 三段代码确实还在，见 §4.3）。

但方案把自己的地基建立在一个**未经验证的事实**和一个**技术上不成立的核心机制**上：

1. §4.1 声称 **Linux「✅ 核心链路实测」**，但仓库里没有 Linux 的验证记录；方案自己在 §12.4 又要求
   "在 Linux 上实跑一遍（无 Linux 环境时至少 Docker 里跑）"——自相矛盾，且与 `windows-offline.md` §5
   的"Windows 构建机实测"冲突。
2. §6.2 的 `doc-facts.js` 声称"从真实代码派生"每个事实，但实测表明：`server/config.js` **require 即产生
   文件系统副作用、且能抛错**；端口等值受环境变量影响，派生的是"生效值"而非"默认值"；而
   `plantuml-renderer.js` **根本没有导出后端取值**、`puppeteer-config.js` 没有导出平台分支、入口文件名与
   产物目录常量全是内联字面量。按方案字面实现会得到一个**会写盘、会被环境变量骗、且大半事实派生不出来**
   的闸门。

因此本次结论为**需修订后再评审**，必须先解决下面"优先级"表中的 B1/B2 两条，才谈得上接入构建闸门。

---

## 问题一：§6.2 `doc-facts.js` 的事实无法按方案从代码可靠派生（require 有副作用、有环境依赖、导出面不存在） [严重]

**位置**：方案 §6.2 第 216–218 行

方案原文：

> `require('../server/config')` 取端口与环境变量；`require('./puppeteer-config')` 取平台分支；
> 构建脚本导出入口文件名常量；`plantuml-renderer.js` 导出后端取值

逐条实测反驳（本机 Windows / Node v24.20.0，工作树 `c88c54a` + 未提交改动）：

**(a) `require('../server/config')` 不是纯读取，它会 mkdir + 写探针，还会抛错。**

`server/config.js:83` 在模块加载时就执行 `dataDir: resolveDataDir()`；而
`resolveDataDir()`（`server/config.js:38-73`）会对候选目录 `fs.mkdirSync(dir,{recursive:true})`
并写一个 `.write-probe` 再删（`server/config.js:52-57`）；两个候选都不可写时 **throw**
（`server/config.js:68-72`）。

实测：评审前 `Test-Path .\data` = `False`；执行 `node -e "require('./server/config')"` 后
`.\data` 被创建（随后我已删除）。也就是说，一个"文档事实检查"脚本会**在仓库里创建 `data/` 目录**，
在只读 CI 检出目录或受限环境下会直接抛错。`self-check.js:86` 调用它也带着"安装目录只读会回退"的假设，
并非纯函数——把它加进构建闸门是新增失败面。

**(b) 端口等值受环境变量影响，派生的是"生效值"不是"默认值"。**

`server/config.js:77` 是 `port: num(process.env.PORT, 8080)`。实测：
默认 8080，但 `$env:PORT=9999` 时 `require('./server/config').port === 9999`。
若开发机/CI 恰好设了 `PORT`，闸门会拿 9999 去和文档里的 `default_port: 8080` 比对——**误报**；
更糟的是若有人把文档写成当前环境的值，闸门也会"通过"，反而固化错误。方案 §10 只担心"解析失败误报"，
没有担心"成功但比错对象"。

**(c) `config_keys` 无法经 require 得到。** `config` 导出的是一批 camelCase 值
（`maxConcurrent`/`maxFileSizeMb`/…，`server/config.js:75-112`），环境变量名（`MAX_CONCURRENT`/
`MAX_FILE_SIZE_MB`/…）只作为字面量散落在源码里，**没有任何导出**；且名字与键名并非一一对应
（`MAX_FILE_SIZE_MB` → `maxFileSizeMb`）。要得到 §6.2 示例里的 `config_keys: PORT,HOST,DATA_DIR,...`
必须改源码（例如导出一个 `envKeys` 表），这不是"从真实代码派生"能自动完成的。

**(d) `plantuml-renderer.js` 没有导出后端取值。** 实测
`Object.keys(require('./scripts/plantuml-renderer'))` =
`['findPlantUML','downloadPlantUML','buildCommand','renderPlantUML']`（导出定义在 `plantuml-renderer.js:517`）。
`core|jar|auto` 三个字面量只存在于 `resolveBackend()` 内的字符串分支（`plantuml-renderer.js:394-397`）
以及环境变量读取处，**外部拿不到**。"plantuml-renderer.js 导出后端取值"是**不成立的事实描述**。

**(e) `puppeteer-config.js` 不导出"平台分支"。** 导出只有
`{ generateConfig, findChrome }`（`puppeteer-config.js:91`）；平台路径只是 `CANDIDATES` 数组里的字符串
（`puppeteer-config.js:12-27`）。没有可推导出 `platform_status` 的结构。

**(f) 入口文件名与产物目录常量全是内联字面量。** `启动 md2docx.cmd`/`转换文档.cmd` 直接写在
`build-windows-bundle.js:295/312`，`自检.cmd` 写在 `:731`；`output/clean` 写在
`preprocess.js:674/678` 与 `cli.js:50`、`md2docx.sh:90-91`，`output/docx` 写在
`md2docx.js:1416`。方案说的"构建脚本导出入口文件名常量"**现在并不存在**，需要新增导出，方案没把它列为改动。

**(g) `platform_status` 天生不是"可派生事实"。** 它是人工验证结论，不是代码属性。把它放进"逐项与代码比对"
的 `docfacts` 里自相矛盾：闸门只能校验"该键存在"，无法校验 `linux=verified` 是否为真——反而会把它伪装成
"机器校验过的事实"。

**影响**：这是方案称为"核心"的机制（§6.2 标题、§9 P0 第 1 步）。按字面做出来会：写盘、污染工作区、
受环境变量欺骗、且大半 fact 派生不出来。若硬编码这些 fact，闸门就退化成"文档自己和自己比对"，失去意义。

**建议**：
- 把"可从代码派生"限定为**无副作用的纯常量**：新增一个 `scripts/doc-facts.js`，其中的值全部来自
  **显式登记的导出常量**（如给 `preprocess.js`/`md2docx.js`/`build-windows-bundle.js` 增加
  `OUTPUT_DIRS`、`ENTRY_SCRIPTS`、`BACKEND_VALUES` 等 `module.exports`），而不是 `require` 带副作用的
  运行时模块。若坚持读 `config.js`，必须改成惰性函数（`resolveDataDir()` 延迟到真正启动时），这是对
  `server/config.js` 的实质性重构，应写进方案与风险表。
- 环境变量相关的事实改为：读**源码里的默认字面量**（可用受控正则或"导出 default 值"），并在闸门运行时
  **显式隔离 env**（清空 `PORT`/`HOST`/`DATA_DIR` 等）或断言 `process.env` 相关键未被设置。
- `platform_status` 改为"手工维护的清单"，与"代码派生 fact"分表存放；对它只做**存在性/格式**校验，
  不冒充"代码一致性"。§4.1 的验证状态必须另有**可指认的证据**（见问题二）。

---

## 问题二：§4.1「Linux 核心链路实测」缺乏证据，且与方案自身及现有文档矛盾 [严重]

**位置**：方案 §4.1 第 78 行；§12.4 第 323–324 行；`docs/deployment/windows-offline.md` §5；仓库现状

方案原文（`:78`）：

> **Linux x64** | 源码安装（`npm ci` + 系统依赖）；Docker | ✅ 核心链路实测（本仓库开发/构建机即 Linux 系）

反证：

1. **仓库里唯一成文的真机验证是 Windows**。`windows-offline.md` §7.1（`:186`）逐项列出 Windows 真机结果；
   `windows-native.md` §7（`:170-187`）同样是 Windows。**没有任何文件记录 Linux 的端到端实测**。
   按本仓库自己的证据标准（`docs/issues/README.md:28-32` 要求"给出可复现最小输入与实测观测值"），
   这条 `✅` 不达标。
2. **方案自己否认了它**。§12.4（`:323-324`）写："`linux-install.md` 的每条命令在 Linux 上实跑一遍
   （无 Linux 环境时至少在 Docker 容器内跑）"——这是**待办**口吻，与 §4.1 的 `✅ 已实测` 直接冲突。
3. **现有文档对构建机平台自相矛盾**。`self-check.js:4` 写"本包在 Linux 上构建"，
   而 `windows-offline.md:163` 写"打包耗时（**Windows 构建机实测**）"。方案在引用时选择性采用了前者。
4. **本评审机就是 Windows**（工作目录 `D:\home\oclab\md2docx`，`process.platform==='win32'`），
   与"本仓库开发/构建机即 Linux 系"的断言不符（历史评审 `review-windows-native.md:20` 确曾声明 Linux，
   但那是 2026-09-17 的另一次会话，不足以支撑当前断言的".sh 即现实"）。
5. 唯一间接支持 Linux 的是 `.github/workflows/release-windows.yml`：它 `runs-on: ubuntu-latest`，
   会跑 `smokeTestBundle`（`build-windows-bundle.js:687-724`），即在 Linux 上执行一次合成文档的核心链路。
   但 (a) `.github/` 在当前工作树是**未跟踪**目录（`git status` 显示 `?? .github/`）；(b) 方案没有引用它；
   (c) 它只跑一份内联合成文档，不等于"手册里每条 Linux 安装/依赖命令可用"。

**影响**：§4.1 是全案"地基"，`supported-platforms.md`、`getting-started.md` 三条路径、
`platform_status` 事实块都建立在它之上。把未验证写成 `✅ 已验证`，恰恰违反方案 §4.1 自己立的硬规则
（`:82-83`"未验证的平台必须显式标注为「未验证」"）。

**建议**：
- 将 Linux 行改为与事实相符的措辞，例如"核心脚本可在 Linux（CI `ubuntu-latest`）跑通合成用例；
  **面向使用者的安装/依赖/字体流程尚未在 Linux 上逐条实测**"，或在实施前补一份
  `linux-install.md` 的实跑记录（命令 + 输出）作为附件。
- 修复仓库内"构建机是 Linux 还是 Windows"的自相矛盾（`self-check.js:4` vs `windows-offline.md:163`），
  否则任何"平台状态"文档都不可信。
- 若采用 §6.1 的 `docs/.build-stamp` + CI 校验，应顺带补一个 **Linux 的 CI 工作流**；目前只有
  `release-windows.yml`，"CI 构建时替换"没有落脚点。

---

## 问题三：把 `docs/http-service.md` 标为「✅ 最新」是错的，迁移会把陈旧内容固化 [中]

**位置**：方案 §1.1 第 17 行、§7 第 248 行；`docs/http-service.md`

方案把 `docs/http-service.md` 判为"✅ 最新"，并计划原样迁到 `docs/contributing/architecture.md`
（`:248`）。但该文档与当前代码冲突：

- `http-service.md:173` 写 `HOST # 默认 0.0.0.0`；实际 `server/config.js:80` 是
  `host: process.env.HOST || '127.0.0.1'`。
- `http-service.md:174` 写 `DATA_DIR # 默认 ./data`；实际 `server/config.js:83` 走
  `resolveDataDir()`（安装目录 `data/`，只读时回退 `%LOCALAPPDATA%\md2docx` 或 `~/.local/share/md2docx`）。
- `http-service.md:84` 仍称底层渲染调用含 `python3`；`:188` 仍写"python-docx 校验"。
  而 `dependency-check.js:85` 明确注释"python-docx 已不再是依赖"。

若按 §7 直接迁移，这三个错误会进入"权威架构文档"。**方案必须在迁移前先修正它们**（这也说明 §6.2 的
闸门若只校验 `docfacts` 小块，是抓不到这类正文错误的——恰好印证问题一(g)）。

**建议**：迁移 = 迁移 + 修订。把 `HOST`/`DATA_DIR` 的现状写成事实块纳入闸门；顺带扫掉
`http-service.md:84/188` 的 python 残留。可参考 `docs/api.md:48-49` 已经写对的说明。

---

## 问题四：无法用 `require` 派生的"平台分支"夸大了 macOS 支持，且 macOS 退化为 Linux 分支 [中]

**位置**：方案 §4.1 第 80 行、§11 T4；`plantuml-renderer.js:242-295`、`server/app.js:153-155`

方案称 macOS"代码有分支（`fc-list`、Chrome 路径、`open` 开浏览器）"。逐条核对：

- `open` 开浏览器：**属实**（`server/app.js:154` `process.platform === 'darwin'` → `open`）。
- Chrome 路径：**部分属实**（`puppeteer-config.js:19-20` 有 macOS 的 Chrome/Edge 路径）。
- `fc-list` 中文字体：**不成立**。`findChineseFont()`（`plantuml-renderer.js:242-295`）没有 macOS 专属分支：
  `process.platform==='win32'` 走注册表字体目录，**其余（含 macOS）统一走 `fc-list :lang=zh`**
  （`plantuml-renderer.js:275-288` 注释即写"Linux / macOS：用 fc-list"）。而 macOS **默认不带 fontconfig/fc-list**，
  于是 `catch` 落到 `tryWindowsFonts()`（`:289-294`）在南半球必然失败，返回空字体，
  `injectChineseFont()` 直接原样返回（`plantuml-renderer.js:307`）——**不会报错，只是静默不注入中文字体**。
  这与方案把 macOS 描述成"有处理分支"的乐观语气不符。

**影响**：§4.1 的 macOS 行与可能生成的 `supported-platforms.md` 会高估能力；用户按文档在 macOS 上遇到
PlantUML 中文方块时，文档无法解释。§11 T4"只写未验证 + 源码安装路径，不承诺"方向正确，但方案正文
（`:80`）的括号说明应改为"无 macOS 专属字体分支，中文渲染未验证，可能不注入字体"。

**建议**：§4.1 的 macOS 证据改为只保留"Chrome 路径与 `open` 有分支"；明确写出"中文字体探测无 macOS 分支、
未验证"。若要在 macOS 上支持，需另立改动（改用系统字体目录/`system_profiler`/直接指定字体），
这属于**产品能力**，方案 §2 已声明非目标，就不应把它写成已具备的分支。

---

## 问题五：§6.3「示例即用例」的绑定远比方案描述的重 [中]

**位置**：方案 §6.3 第 235–241 行；`scripts/self-check.js`、`scripts/build-windows-bundle.js:687-724`

方案称"把 `docs/examples/` **纳入 `smokeTestBundle` 的自检转换范围**：…（图数/表数/题注数）"。实际：

- `smokeTestBundle`（`build-windows-bundle.js:687-724`）**只做一件事**：`execFileSync(node,
  [bundleDir/scripts/self-check.js, '--allow-no-browser'])`。
- `self-check.js` 的端到端用例是**写死在源码里的单一文档**（`self-check.js:199-212`），
  断言只有"图片 ≥3、表格 ≥1、无 `![` 残留"（`self-check.js:248-253`）——**没有题注计数**，
  也没有"遍历一个文档列表"的机制。
- 因此"纳入 `docs/examples/`"需要改 `self-check.js`（参数化输入 + 期望断言表）和/或
  `smokeTestBundle`，这是一次**小型重构**；方案完全没提。而且把"教学用 md 的期望值（图数/表数/题注数）"
  硬编码进自检，本身又引入新的维护面（示例改了、期望没改 → 误报）。

**建议**：明确写清改造点（`self-check.js` 支持 `--expect <json>` 或内置 `EXAMPLES` 清单；断言扩展为
题注计数），并给出"新增示例必须同时登记期望值"的约定；否则 §6.3 只是一句口号。方案 §12.5 的验收标准
（"断言图/表/题注数量符合预期"）也应同步到 `self-check.js` 的现有断言。

---

## 问题六：§7/§8 把文档打进 Windows 包，但构建脚本当前不拷贝 docs，闸门也不覆盖 docs [中]

**位置**：方案 §6.1/§6.2/§8；`build-windows-bundle.js:282-285/374-376/645-667`

- 组装阶段只拷 `['scripts','server','bin','package.json']`（`build-windows-bundle.js:282-285`），
  **不含 `docs/`**。
- `verifyBundleCode` 只遍历 `scripts` 与 `server`（`build-windows-bundle.js:661`），
  `assertBundleContents` 的必需清单（`:472-493`）里也没有任何文档。
- 方案 §8 要求"`使用说明.txt` + `docs/` 用户子集"进包，§6.2 还要求"`verifyDocClaims` 的检查范围**包含
  包内子集**"。这意味着需要在构建脚本里新增：拷贝 `docs/` 子集 + 占位符替换 + "包内文档与仓库文档一致"
  的校验 + `assertBundleContents` 增列文档项。方案把这些当成"接一下闸门"的边际成本（§1.3），实际是
  新的组装与校验逻辑。

另有一个连带风险：`assertCleanTree`（`build-windows-bundle.js:623-639`）要求工作区干净，
而"构建期替换占位符"如果改的是**仓库内文件**（而非拷出去的副本），会立刻把工作区弄脏、触发自我否决。
方案 §6.1 说"替换后的文档进包"，应明确是**替换副本**，不是原地改 `README.md`/`docs/`。

**建议**：§8 增加"构建脚本改动清单"：拷贝子集 → 在**临时副本**上替换 `{{VERSION}}/{{COMMIT}}/{{BUILD_TIME}}`
→ 纳入 `assertBundleContents` 与 `verifyBundleCode`（或新增 `verifyBundledDocs`）。§12.2 的验收据此细化。

---

## 问题七：Docker 方案本身已过时，提炼 `docker.md` 前必须先更新，否则把陈旧基座复制成手册 [中]

**位置**：方案 §4.2/§7；`docs/plans/docker-deployment.md`

方案 §7（`:251`）计划"从 `plans/docker-deployment.md` 提炼出 `docs/deployment/docker.md`"，并如实标注
Docker"未验证"（§4.1 `:79`）。但该方案文档停留在 `@plantuml/core` 之前：

- 依赖表仍含 `python3`、`python-docx`（`docker-deployment.md:22-23`）。
- Dockerfile 草案仍 `apt-get install openjdk-17-jre-headless graphviz python3 python3-docx`
  （`docker-deployment.md:57-65`），并 `COPY bin/`、依赖 `bin/plantuml.jar`（`:74-79`）。
  而当前 `package.json:23` 已是 `@plantuml/core`，`build-windows-bundle.js:286` 甚至主动删除
  `bin/plantuml.jar`。
- ENTRYPOINT 仍指 `./scripts/md2docx.sh`（`docker-deployment.md:91`）——与方案 D1 要把 `.sh` 收敛为
  薄封装的动议叠加，实施时容易两边打架。

**影响**：若不先修订，`docker.md` 会告诉 Linux 用户"要装 Java/graphviz/python-docx + 下 jar"，与
§4.2 依赖矩阵（"都已移除"）直接冲突——同一份发布物里出现两套互相矛盾的依赖说明。

**建议**：把"修订 `plans/docker-deployment.md`（去掉 python/Java/graphviz/jar，改用 core 后端，
重跑 `docker build` 至少到能构建）"列为 §9 P1/Docker 项的前置任务，而不是"提炼"。

---

## 问题八：Windows 之外的"分发对等"仍是缺口（用户明确要求不得 Windows 中心） [中]

**位置**：方案 §2 目标 4、§8；仓库现状

用户明确要求"必须覆盖 Linux，不得 Windows 中心"。方案的文档**覆盖**是够的
（安装/系统依赖/字体/CLI/服务/Docker/卸载都有对应文件），但**分发对等**仍是空的：

- 唯一已实现的分发物是 Windows 离线包（`build-windows-bundle.js`）；Linux 只能源码安装或未验证的
  Docker（§4.1 `:79`），方案 §11 T1 明确"不做 Linux 便携包"。
- 文档随物分发只有 Windows 做了（§8 `:261`）；Linux 是"仓库内 `README.md` + `docs/`"，Docker 是"镜像内
  `docs/`（可选）+ 仓库链接"——即 Linux/Docker 用户拿到的文档永远跟着**仓库 HEAD**走，与发布版本解耦。
- 没有 Linux 的发布/构建 CI（只有 `release-windows.yml`），§6.1 的 `docs/.build-stamp` "CI 校验"
  在 Linux 侧无落脚点。

这可以接受（T1 已声明本次不做 Linux 便携包），但方案应把"Linux 用户获得的是仓库文档而非版本化手册"
**写明为已知不对等**，否则"跨平台对等"（§2 目标 2）名不副实。

**建议**：在 `supported-platforms.md` 显式列一张"分发物 × 随附文档 × 版本绑定方式"表；对 Linux 说明
"文档随仓库版本，不随发布物"，并在 §10 风险表登记该不对等。

---

## 问题九：§5 有低价值/易腐烂文件，且缺少若干高价值跨平台文档 [中]

**位置**：方案 §5.1/§5.2

- **易腐烂**：`contributing/known-pitfalls.md`（`:157`）被定义为"由 `AGENTS.md` 的陷阱清单**引用，不复制**"。
  一个只含链接、且与 `AGENTS.md` 内容必然同步漂移的页面，价值近乎为零，还会诱导后续把内容复制进来
  （违反 §5.2）。建议直接删掉该文件，在 `contributing/development.md` 里指向 `AGENTS.md`。
- **重叠**：`getting-started.md`（三条安装路径）+ `deployment/linux-install.md` + `deployment/install-uninstall.md`
  + `reference/supported-platforms.md` 在"平台/依赖/安装"上高度重叠。§5.2 单一事实源表只列了
  "平台支持状态"，没有覆盖"安装步骤"。建议明确：安装步骤以 `install-uninstall.md`（或各平台 deploy 文）
  为唯一源，`getting-started.md` 只给最短路径并链接。
- **缺失（对"跨平台 HTTP 服务"是高价值）**：
  - **安全/暴露面**：服务**无鉴权**（`docs/review/review-windows-native.md` H5 已指出），
    `HOST=0.0.0.0` 等于把"任意 md → 文档下载"暴露给同网段。`reference/web-ui.md`/`operations.md`
    应含"默认仅绑 `127.0.0.1`；对外暴露无鉴权风险"的明确警示。方案完全没有安全类文档。
  - **Linux 服务化（systemd unit）**：`how-to/run-as-service.md` 说"前台/后台/Docker"，但没点名 systemd；
    跨平台服务化 Linux 用 systemd 是最常见路径，应给 unit 示例。
  - **Linux 桌面/无头运行库**：headless Chromium 在 Debian/Ubuntu 需一组共享库（`libnss3` 等），
    `linux-install.md` 应列出；方案只提了"中文字体"。
  - **macOS 说明**：至少一页"未验证 + 已知字体限制"（见问题四），方案只在 T4 一笔带过。

**建议**：§5.1 删除 `known-pitfalls.md`；补 `reference/security.md`（或并入 `operations.md`）与
systemd 片段；明确安装步骤的唯一源。

---

## 问题十：§4.2 依赖矩阵若干措辞与代码不符 [低]

**位置**：方案 §4.2 第 87–95 行

- **浏览器"包内 chrome-headless-shell"**：仅在未传 `--skip-chromium` 时成立
  （`build-windows-bundle.js:39/230/260/493`；`windows-offline.md:92` 将该选项列为公开参数）。
  应加注"（默认内置；`--skip-chromium` 时用系统 Chrome/Edge）"。
- **PlantUML（core 后端）"必需"**：更准确的是"**PlantUML 渲染能力必需，core 或 jar 任一**"。
  `dependency-check.js:104` 的必需键是 `plantuml`，其判定是"core 可用或 jar 可用"
  （`dependency-check.js:50-76`）。写成"core 后端必需"与代码语义不同。
- **Java + `plantuml.jar`"需自备"**：不准确。`renderPlantUML()` 在 `backend==='jar'` 且找不到 PlantUML 时
  会**自动下载** `plantuml.jar`（`plantuml-renderer.js:423-428` + `downloadPlantUML():71-83`，
  下载 URL 在 `:77`）；`md2docx.sh:45-53` 也仍用 `curl` 自动下载。应写"可自动下载（需联网）/或自备"。
- **Node.js Linux "≥18"**：**无依据**。`package.json` 无 `engines` 字段，代码也无最低版本检查
  （全仓 grep `engines` 为空；`self-check.js:51` 只打印版本）。
  代码确实用到了 `fs.rmSync`（Node 14.14+）、`fs.cpSync`（Node 16.7+，见
  `build-windows-bundle.js:279`）等，18 大概率可用，但**未声明、未验证**。要么补 `engines`，要么把
  "≥18"标注为未验证需求。

**建议**：按上述逐条修订 §4.2；并把 `engines` 写进 `package.json`（这本身就是一个可被 `doc-facts` 派生的
纯事实，正好补上问题一里"缺少可派生事实"的空缺）。

---

## 问题十一：§6.2「正文包含该值」校验脆弱，易假阳/假阴 [低]

**位置**：方案 §6.2 第 232–233 行

- 对 `default_port: 8080`，`"8080"` 作为子串在文档里极易偶然出现（年份、其他端口、示例），
  断言"正文包含 8080"几乎恒真，**挡不住"事实块改了、正文没改"**。
- 对 `backend_values: core|jar|auto`，正文若写成"core / jar / auto"或分点列出，**字符串并不出现**，
  会假阳性地判失败。
- 对 `clean_dir: output/clean` 与 `docx_dir: output/docx`，正文里两者互相包含，容易一改俱改。

**建议**：改为**结构化占位锚点**（方案 §11 T3 里被否掉的 `<!-- claim:x -->值<!-- /claim -->`），
或对每个 fact 声明"正文中的唯一必须字面量"（如 `8080` 必须出现在 `默认端口` 同一行）。
当前"文末事实块 + 子串包含"的组合既不够严也不够稳。

---

## 问题十二：§4.3 对 `cli.js` 的"等价"描述遗漏行为差异 [低]

**位置**：方案 §4.3 第 99–108 行；`scripts/cli.js`、`scripts/md2docx.sh`

方案说 D1 收敛后"只需讲一套 CLI 语义，跨平台行为天然一致"。核对代码：**输出路径确实一致**
（`cli.js:50` 的 `inputDir/output/docx/<name>.docx` 与 `md2docx.js:1410-1417` 由 clean 目录反推的输出
一致；`md2docx.sh:90-91` 同）。但 `cli.js` 与 `md2docx.sh` 仍有下列差异，方案未提：

- **引导行为**：`md2docx.sh:9-19` 会检测 `node_modules` 并**交互式** `npm install`；
  `cli.js` 完全没有（缺依赖时会在 `require` 处直接抛错）。D1 若要保留"首次自动 npm ci"，
  需在薄封装或 `cli.js` 里新写，且要处理**非交互/CI**（`read < /dev/tty` 在 CI 会卡死，
  `docker-deployment.md:163` 已把这点列为风险）。
- **平台命令**：`md2docx.sh:114` 用 `du -h`（Linux/macOS 专属）；`cli.js` 用 `statSync`。
  文档写"一套语义"没问题，但大小显示格式不同。
- **Java/jar 处理**：`md2docx.sh:27-53` 的检查与 `curl` 下载在 `cli.js` 里不存在（这正是要删的）。
- **Docker 依赖**：`docker-deployment.md:91` 的 ENTRYPOINT 是 `./scripts/md2docx.sh`。
  D1 把 `.sh` 变薄封装后，Docker 入口语义随之改变，需同步修订 Docker 方案（见问题七）。

**建议**：§4.3 加一行"已知行为差异（引导、大小格式、Docker ENTRYPOINT）"，并在 D1 实施时同步更新
Docker 方案。

---

## 问题十三：§5.1 目录树与实际留存目录不一致 [低]

**位置**：方案 §5.1 第 118–161 行 vs §7 第 252–253 行

§5.1 的 `docs/` 树只列了 `index/how-to/reference/explanation/deployment/contributing/glossary`，
**没有** `plans/`、`review/`、`archived/`；但 §7 明确保留 `plans/docker-deployment.md`、
`plans/windows-native.md`（并按 §6 流程后续归档），`review/`、`archived/` 也在 `AGENTS.md`
工作流中持续使用。目录树应把这几个"过程档案"目录画全（标注"维护者过程档案，不属用户文档体系"），
否则读者会以为要删掉它们。

**建议**：补齐 §5.1 树；并把 `docs/plans/large-image-landscape-v5.md`（`AGENTS.md` 明示的当前有效设计文档）
在树的说明里体现。

---

## 达成的共识 / 值得保留的设计

以下为**已核实成立**的部分：

1. **缺口盘点属实**：`README.md`、`CHANGELOG.md`、`docs/index.md`、`docs/glossary.md` 经本机
   `Test-Path` 确认均不存在；`docs/issues/README.md` 等处确实没有面向"写 md 的人"的文档。
   "最大用户群零覆盖"的判断成立。
2. **`md2docx.sh` 陈旧的判断准确**：`md2docx.sh:9-19`（`npm install` 兜底）、
   `:27-43`（Java 检查与警告）、`:45-53`（`curl` 下载 jar）三处确实存在，与
   `@plantuml/core` 免 Java（`package.json:23`）、`downloadPlantUML` 用 Node `https`
   （`plantuml-renderer.js:79-80`）的现状矛盾。
3. **依赖矩阵主干正确**：必需项 `node/chrome/plantuml`、可选 `java/graphviz`、python 已移除，
   与 `dependency-check.js:95-105` 完全一致；"core 后端免 Java/graphviz"与
   `plantuml-renderer.js:422-424`（仅 jar 后端才 `checkGraphviz`）、`windows-offline.md:173-182`
   一致。
4. **"示例即用例"的取源正确**：`caption-forms.md`、`wide-table.md`、`plantuml-no-end.md`、
   `crlf-test.md` 均存在于 `md/qa/`（本机列目录确认），复用它而不另造一套是对的。
5. **构建期版本注入可行**：`buildStamp()`（`build-windows-bundle.js:136-144`）已提供 commit/time，
   `package.json:3` 提供 version，注入有现成落点——前提是"改副本不改仓库"（见问题六）。
6. **T1（不做 Linux 便携包）的取舍合理**；把不确定性显式登记为"未验证"的做法本身是好的，
   只是 §4.1 的 Linux 行没有做到。

---

## 优先级

| 优先级 | 问题 | 建议 |
|---|---|---|
| P0（阻断） | 问题一：`doc-facts.js` 无法按方案从代码派生（config require 副作用/抛错、env 敏感、多个导出面不存在） | 改为"显式导出无副作用常量"；`config.js` 改惰性；env 隔离；`platform_status` 与代码派生 fact 分表 |
| P0（阻断） | 问题二：Linux「✅ 实测」无证据且自相矛盾 | 降级措辞/补 Linux 实跑记录；修复"构建机是 Linux 还是 Windows"的文档矛盾 |
| P1 | 问题三：`http-service.md` 误判为最新 | 迁移时同步修正 HOST/DATA_DIR/python 残留 |
| P1 | 问题四：macOS 无字体分支却写成"有分支" | §4.1 改写；`supported-platforms.md` 如实标注 |
| P1 | 问题五：`smokeTestBundle` 不支持额外示例、无题注断言 | 明列 `self-check.js`/`smokeTestBundle` 改造点与期望值约定 |
| P1 | 问题六：构建脚本不拷 docs、闸门不覆盖 docs | 增补组装/校验步骤；占位符替换改副本，避免 `assertCleanTree` 自我否决 |
| P1 | 问题七：Docker 源方案过时 | 先修订 `plans/docker-deployment.md`（去 python/Java/graphviz/jar）再提炼 |
| P1 | 问题八：Linux 分发/版本绑定不对等 | `supported-platforms.md` 显式登记；风险表补一行 |
| P2 | 问题九：`known-pitfalls.md` 易腐烂、缺安全/systemd/运行库文档 | 删冗余页；补安全提示与 systemd/运行库 |
| P2 | 问题十：依赖矩阵措辞与代码不符（浏览器/PlantUML/jar/Node ≥18） | 逐条修订；补 `package.json` `engines` |
| P2 | 问题十一："正文包含"校验脆弱 | 改结构化锚点或声明唯一字面量 |
| P2 | 问题十二：`cli.js` 行为差异未提 | §4.3 加差异清单，D1 同步 Docker |
| P3 | 问题十三：§5.1 目录树缺 plans/review/archived | 补齐目录树 |

## 评审结论

**需修订后再评审。**

方案的方向（Diátaxis 分层、单一事实源、构建期注入、示例即用例、D1 收敛 CLI）值得保留，但驳回其两份
"地基"：

- §6.2 的 `doc-facts.js` 是**技术上不成立**的核心机制——`require` 派生既不可靠也非无副作用，且方案声称
  存在的多个导出面（`plantuml-renderer.js` 后端取值、`puppeteer-config.js` 平台分支、构建脚本入口常量）
  **在当前代码里并不存在**。必须先做"事实来源"的重新设计（显式导出常量 + 惰性 config + env 隔离），
  再谈接入构建。
- §4.1 对 Linux 的 `✅ 核心链路实测` **没有可指认的证据**，且与方案 §12.4 及
  `windows-offline.md` 自相矛盾。跨平台文档的"如实标注验证状态"是用户明确要求，不能从一条不成立的
  `✅` 起步。

**重新评审前必须先完成的条件：**

1. 重写 §6.2 的机制设计（问题一），给出"哪些 fact 可派生、用什么纯导出派生、哪些只能人工维护"的明确分表，
   并演示 `verify:docs` 能在"改错值"时失败、在"未改"时通过。
2. 修正 §4.1 的平台验证状态（问题二），并为 Linux 提供至少一份可指认的实跑证据或改为"未验证"措辞；
   同时消除 `self-check.js:4` 与 `windows-offline.md:163` 的平台矛盾。
3. 在方案中补上问题三、五、六、七的**具体改动清单**（迁移即修订 `http-service.md`；`self-check.js`/
   `smokeTestBundle` 的示例参数化；构建脚本的 docs 组装与校验；Docker 方案的先行修订）。

其余中/低问题可在实施过程中一并处理，但不应推迟上述三项。
