当前独立候选为 **0.10.0-preview.1**。已接通已有生成、A/B 素材、dot 请求及发布队列；真实专辑与线上完成仍按证据阻塞。详见 [本轮能力、启动与限制](docs/release/provider-wiring-0.10.md)。历史版本说明保留如下。

当前 0.7.1 修订：北京时间 09:00（Asia/Shanghai / 01:00 UTC）与腾讯 AI 作品准备执行器，明确停在新三年条款待确认。真实、离线与未接入边界见 [本轮说明](docs/release/beijing-tme-ai-0.7.1.md)。官网可选保存的未知结果保留，不重试，不冒充成功。

# Rainfall Studio · Windows 音乐工作台

SOURCE_WINDOWS_HOST 当前源码 `0.7.0-preview.1` 新增持久生产流水线：本机每日候选、DeepSeek评分及有界改写、逐版本确认、作品/音乐/素材/待发布/回执与独立预算。沿用原桌面入口和数据根，验收后更新，不上传远端。缺Key、未核验音乐价格及真实投稿权限均具体阻塞；离线整链路不冒充真实服务联调。启动、能力矩阵和证据见 [0.7生产流程](docs/release/production-flow-0.7.md)。下文0.5.1安装包及远端Release为历史版本。

这是当前产品源码的独立快照，用于在其他 Windows 设备克隆、构建和运行。仓库不包含原开发仓库的提交历史、现场验收记录、账号/作品数据、凭据、日志、依赖缓存或编译产物。

Electron 桌面壳与 React/TypeScript 前端分层；Core 使用 SQLite 和受管素材目录。支持创作参数与歌词版本、系列、音频 A/B 导入和真实本地播放、封面任务与图片排版、发布材料准备、CSV 统计导入及备份。没有音频时不会假播放。

当前本地 `feature/clarity-first-pass` 分支继承封面交接与歌词发布增量，并完善首页入口、本地模板命名、作品材料下一步和统计缺失值显示。统计仅在明确日期、平台并确认同口径后汇总；缺失值显示“—”，实测零值保留0。真实腾讯连接和表单仍待校准；现场 UIA 操作与客户端上传分别验收。此分支未推送，也未进入下方 0.5.1 安装包。参阅 [界面验证与启动方法](docs/release/clarity-first-pass-verification.md)、[封面歌词设计](docs/superpowers/specs/2026-10-16-cover-lyrics-design.md)、[封面歌词阶段验证](docs/release/cover-lyrics-verification.md)、[腾讯连接缺口](docs/integrations/tencent-browser-connection.md)。

## 直接下载安装包（Windows x64 预览版 0.5.1）

无需为安装版安装 Git、Node.js 或 npm。登录有本私有仓库访问权限的 GitHub 账号后，打开 [0.5.1 Release](https://github.com/hongbo31/rainfall-studio/releases/tag/v0.5.1)，下载完整安装器 [RainfallStudio-0.5.1-Setup.exe](https://github.com/hongbo31/rainfall-studio/releases/download/v0.5.1/RainfallStudio-0.5.1-Setup.exe)。安装器内含 Electron 应用及运行依赖，不要下载应用目录中单独的 RainfallStudio.exe。

- 安装器大小：178,689,024 字节（约 170.4 MiB）。
- SHA256：`7a8a84f45b78f84f17b922bee18f0796bee00ba518559e97cd403064367e00c1`。
- 构建源码：[7f3ef68716de280cf561ae89db2ef4da5541e6ad](https://github.com/hongbo31/rainfall-studio/commit/7f3ef68716de280cf561ae89db2ef4da5541e6ad)，与 `v0.5.1` 标签对应；main 后续可包含下载说明更新。

1. 下载后运行 `Get-FileHash .\RainfallStudio-0.5.1-Setup.exe -Algorithm SHA256`，与上述值及 Release 的 `SHA256SUMS.txt` 核对。
2. 这是**未签名预览包**，Windows 可能提示未知发布者或 SmartScreen。请先核实来源和校验和，不要关闭安全软件或修改系统安全策略。
3. 双击 Setup 安装。Squirrel 使用当前 Windows 用户的 `%LOCALAPPDATA%\RainfallStudio` 安装应用；通过开始菜单中的 Rainfall Studio 启动。
4. 首次真实本地库应为空。平台账号、API 和外部生成服务均需后续按支持情况另行配置；本包不会自动绑定真实账号或执行发布。

**验证范围**：本机完成构建、Setup 内嵌包与 ASAR 一致性检查、许可与数据排除检查；从安装器解出的客户端完成启动、8 页导航、本地保存及一次重启持久化验证，现有桌面入口和原有数据库哈希不变。没有可用隔离 Windows Sandbox/VM，因此**尚未执行 Setup 的真实安装/卸载，也未在全新电脑验收**；这些结果不等于安装成功或所有 Windows 设备兼容性承诺。

默认用户数据在 `%APPDATA%\RainfallStudio`，与程序目录分开。已有旧版用户须先退出客户端并导出备份：新版打开同一目录可能迁移 schema，不要让旧 EXE 打开已升级的库，也不要用本安装器覆盖现有受管理预览版。需要并存测试时，使用独立 `RAINFALL_DATA_ROOT` 并确保每次启动保持相同设置。卸载行为未实测，卸载前请保留独立备份。

安装包不包含 FFmpeg；音频探测/导入和视频封装需要下文指定的本地工具。缺少时相关功能会受阻，不会自动安装。真实 AI 生成、平台上传、OAuth、在线统计和自动更新服务均未启用。

## 从源码在另一台 Windows 设备运行

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
