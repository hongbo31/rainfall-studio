# Rainfall Studio · Windows 音乐工作台

这是当前产品源码的独立快照，用于在其他 Windows 设备克隆、构建和运行。仓库不包含原开发仓库的提交历史、现场验收记录、账号/作品数据、凭据、日志、依赖缓存或编译产物。

Electron 桌面壳与 React/TypeScript 前端分层；Core 使用 SQLite 和受管素材目录。支持创作参数与歌词版本、系列、音频 A/B 导入和真实本地播放、封面任务与图片排版、发布材料准备、CSV 统计导入及备份。没有音频时不会假播放。

## 在另一台 Windows 设备运行

目标环境是 Windows x64。构建目标为 Node 24；原环境验证使用 Node v24.14.0。需要 Git、Node/npm 和安装依赖所需的网络访问。私有仓库仅对已获权限的 GitHub 账号开放；使用你自己的正常 GitHub 登录，不要将 token 写入 URL 或仓库。

```powershell
git clone https://github.com/hongbo31/rainfall-studio.git
cd rainfall-studio
node --version
npm.cmd ci
npm.cmd test
npm.cmd run typecheck
npm.cmd run desktop:build
```

`desktop:build` 只构建 Main/preload/Core/renderer，不打开客户端。运行桌面前，原生 SQLite 模块需匹配 Electron ABI：

```powershell
.\node_modules\.bin\electron-rebuild.cmd -f -w better-sqlite3

# 独立源码运行目录，避免接触该电脑上已安装客户端的数据。
$env:RAINFALL_DATA_ROOT = Join-Path $env:LOCALAPPDATA 'RainfallStudioSource'
$env:RAINFALL_MODE = 'production'
npm.cmd run desktop:dev
```

若原生依赖没有对应的预编译二进制，安装/重建可能需要可用的本机 C++ 和 Python 构建工具链；项目不会自动安装系统工具。源码快照已复用原环境的现有依赖验证类型检查和构建，尚未在全新 Windows VM 重跑 `npm ci`。

默认 production 首次为空作品库；右上角可切换独立 simulation 演练。模拟歌词/评分不代表真实模型效果；诊断音不是 AI 歌曲。不要在真实用户数据目录进行自动化 QA。

## 构建独立客户端

```powershell
npm.cmd run desktop:package
# 可选：生成 Windows 安装器
npm.cmd run desktop:make
```

Forge 会重建 Electron 原生模块。完整应用目录通常位于 `out/RainfallStudio-win32-x64`，必须整体保留；可独立下载并安装的 Squirrel Setup EXE 位于 `out/make/squirrel.windows/x64`。

包版本从本次起为 `0.5.1`，作为预览版交付。版本只说明此源码及构建，不代表真实 AI 生成、平台发布或跨机器安装验收已经完成。安装包没有代码签名，使用前应核对本仓库 Release 的 SHA256。

## FFmpeg 与媒体功能

音频探测、音视频封装目前使用 `src/core/assets.ts` 中的固定工具路径：

- `C:\ffmpeg\ffmpeg-8.1-essentials_build\bin\ffmpeg.exe`
- `C:\ffmpeg\ffmpeg-8.1-essentials_build\bin\ffprobe.exe`

若已有安装位置不同，请在本地调整该文件的两个常量后重新构建；没有工具时相应媒体功能会报告阻塞，不会自动下载安装。仓库不附带 FFmpeg 二进制，分发时需核对其实际许可。

## 数据与凭据

`RAINFALL_DATA_ROOT` 可指定独立根；未设置时源码默认使用 `%APPDATA%/RainfallStudio`。production 与 simulation 使用独立数据库；受管媒体与加密凭据在数据根下，均不属于 Git 源码。

备份/恢复请使用客户端功能并先保留原库。Windows 加密凭据绑定本机用户，不能把复制密文当成跨电脑登录成功；新设备需要自行重新配置。旧 schema 与新版不一定向后兼容，不要用旧 EXE 直接打开已升级的数据库。

## 开发验证

在执行 Electron 原生重建前，可用 Node 原生模块运行离线 Core 回归：

```powershell
node scripts/test-headless.mjs
node scripts/test-inbox-unit.mjs --regression
node --test tests/local-upgrade.test.mjs tests/production-upgrade.test.mjs tests/launcher-upgrade.test.mjs
```

如果此前已将 better-sqlite3 重建为 Electron ABI，先用 `npm.cmd rebuild better-sqlite3` 恢复 Node ABI，再跑 Node 回归；之后运行桌面时再次执行 electron-rebuild。最后一组包含 Windows PowerShell 校验，不适用于非 Windows 环境。

`tests/delivery-driver.test.mjs` 依赖额外的已验收发布包和旧版包夹具，源码仓库不附带这些二进制，不能直接把它当作纯源码开箱测试。`test:e2e`/`test:packaged` 会打开窗口，请仅在受控时间和隔离数据下运行。

## 本地升级管理器

`src/updater`、`launcher` 和 `scripts/deliver-local-release.mjs` 保留已验收包校验、备份、代际迁移、稳定入口、排队与回退逻辑。它是本机交付工具，不是联网自动下载更新服务。

初次管理器初始化依赖可核验的旧包/旧数据与已验收发布包，不能在新设备上照搬原设备的安装命令或数据路径。普通源码运行不需要初始化管理器。后续 schema 或发布合同变更需要相应迁移与验收。

## 接入状态与文档

DeepSeek 目前提供配置和本机加密 Key 管理，真实文本传输/模型评分未启用。Suno、谱乐真实音乐调用、真实平台上传、OAuth 和自动统计抓取均未在本快照中启用。Codex/Claude Code 为独立待配置选项，不读取登录凭据或把订阅当作 API。

封面工作室导出人工协作任务，再导入生成图像和排版；没有内置免费 Codex 图像 API。网易云/汽水/QQ/酷狗音频发行材料与抖音视频发布材料分别准备，不承诺无人值守跨平台发布。

- [架构阅读入口](docs/architecture/README.md)
- [本地收件箱数据合同](docs/integrations/dot-inbox-delivery-contract.md)
- [依赖许可记录](docs/release/dependency-licenses.md)
- `web/` 保留早期网页原型，与桌面客户端的数据和功能范围不同。

本仓库为私有源码交付；不要提交真实 Key、账户数据库、原创作品、生产备份或运行日志。

