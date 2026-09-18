# 变更日志

本项目的所有重要变更都将记录在此文件。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 新增

- 文档体系方案（跨平台）：`docs/plans/documentation-system.md`
  （manifest 驱动、`@docfact` 标记 + claim 锚点、SemVer + CHANGELOG 闸门）
- 运行时/应用拆包方案：`docs/plans/runtime-app-split.md`
  （固定运行时资源 + 每次 release 仅上传约 0.2 MB 应用包）

### 修复

- 构建脚本在 Windows 上可用：`execFileSync('npm')` 在 Windows 必失败
  （`'npm'`→ENOENT、`'npm'`→EINVAL），改为 `process.execPath` 执行 `npm-cli.js`
- 构建脚本打包改用系统 `bsdtar`（约 6 分钟），`adm-zip` 降为回退
  （2.3 万文件时 adm-zip 需 20 分钟以上且内存压力大）；`bsdtar` 必须带
  `--options hdrcharset=UTF-8` 否则中文名在非中文 Windows 解压为乱码
- CI 工作流（`ubuntu-latest`）增加 `apt-get install libarchive-tools`，
  使 bsdtar 在 Linux 上可用（GNU tar 不能建 zip）

### 文档

- `AGENTS.md` 新增已知陷阱 #16（zip 中文名必须带 UTF-8 flag）、
  #17（Windows 上 `execFileSync('npm')` 必失败）、常用命令与验证方法同步
- `docs/api.md` 依赖清单重写，补充 `requiredKeys`/`optionalKeys`/`applicable`
- `docs/deployment/windows-offline.md`：打包工具与中文名编码、6 道构建闸门、
  Windows 真机验证状态更新（2026-09，12 项逐项通过）
- `docs/plans/windows-native.md` 勾选状态与新增实施项同步

## [0.1.0] - 2026-09-18

### 新增

- Windows 完全离线包构建 `scripts/build-windows-bundle.js`：
  便携 Node + chrome-headless-shell + win32 定向依赖 + 6 道构建闸门
  （干净工作区 / 必需文件齐全 / 代码逐字节一致 / 包自检真渲染 /
   zip 中文名 UTF-8 flag / 体积预算），产物带 SHA256 的 `RELEASE-INFO.txt`
- 一键安装器（NSIS，按用户安装到 `%LOCALAPPDATA%\Programs\md2docx`，无需管理员）
- 目标机自检入口：目标机双击 `自检.cmd` 即可产出可回传的自检报告
- CI 出包工作流：`.github/workflows/release-windows.yml`
  （`v*` tag 自动构建并挂 Release，发布件来自 CI 而非开发机）
- `/api/health` 暴露 `requiredKeys` / `optionalKeys` / `applicable`；
  界面把 core 后端下用不到的 java/graphviz 显示为灰色「不适用」而非红色 ✗
- `package.json` 补 `build:win` / `release:win` / `self-check` / `serve` / `convert`

### 修复

- 卸载流程会留下回退数据目录（`%LOCALAPPDATA%\md2docx`）+ 缺卸载确认提示
- 目标机自检把「显式指定 DATA_DIR」误报为"回退到安装目录之外"
- 安装目录只读时服务启动崩溃（mkdir EACCES），改为自动回退可写目录
- `dependency-check.js` 的 `execSync` 拼字符串改为 `exec-util.runFile`
  （符合项目「外部命令用参数数组、不经 shell」约定）

[Unreleased]: https://github.com/randomgitsrc/md2docx/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/randomgitsrc/md2docx/releases/tag/v0.1.0
