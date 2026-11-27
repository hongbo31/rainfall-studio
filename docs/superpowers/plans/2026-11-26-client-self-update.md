# Windows 客户端自助更新实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Windows Squirrel 安装版增加用户手动检查更新、查看下载状态及主动重启安装的功能。

**Architecture:** Electron Main 使用内置 `autoUpdater` 管理 Squirrel 更新，Renderer 经 `rainfall:call` 调用状态/检查/安装。构建时只为 Main 注入固定 HTTPS feed URL；安装包生成器另行保存并校验完整 `.nupkg` 与 `RELEASES`。

**Tech Stack:** Electron 44、TypeScript、React、Electron Squirrel.Windows、PowerShell 7、esbuild。

**Spec:** `docs/superpowers/specs/2026-11-26-client-self-update-design.md`

## Global Constraints

- 只启用 Windows Squirrel 已安装客户端；便携包、开发构建和浏览器预览显示不可用。
- 检查和安装都必须由用户点击；下载完成后等待用户主动重启。
- 更新源只接受构建时设置的 HTTPS URL，不含用户名、密码、查询参数或 fragment。
- 保留安装标识 `RainfallStudioClient` 和 `%APPDATA%\RainfallStudio` 数据根。
- 不发布到外部、不启动可见客户端、不切换桌面快捷方式；不添加或运行自动化测试。
- Electron `autoUpdater` 的 Squirrel Windows 实现没有可靠下载百分比事件，只显示不带百分比的下载状态。

## Review Focus

- 没配置 HTTPS feed：按钮应说明未配置，不能访问网络。
- 非 Squirrel/便携运行：不调用 `autoUpdater`，显示当前更新功能不可用。
- 首次 Squirrel 启动的锁：在 `--squirrel-firstrun` 后 10 秒内不调用检查。
- 连续点击检查：已有检查或下载期间不能第二次调用 `checkForUpdates()`。
- 重启安装：仅下载完成后允许，先结束 Core、浏览器和后台工作区。
- 更新发布物：完整 `.nupkg`、`RELEASES` 和 `RELEASES` 引用的文件名/字节长度必须匹配，失败不得清理旧包。

## 文件职责

- `src/main/app-updater.ts`：状态机、feed 校验、事件映射及检查/安装接口。
- `src/shared/app-update.ts`：Main/Renderer 共用的更新状态类型。
- `src/main/bootstrap.ts`：集成 IPC，并在重启安装前有序关闭应用工作区。
- `src/renderer/components/SoftwareUpdateSettings.tsx`：更新状态、检查和重启安装面板。
- `src/renderer/pages/ConfigurationCenter.tsx`：增加“客户端更新”分类。
- `scripts/build-desktop.mjs`：只向 Main bundle 注入固定 feed URL。
- `scripts/package-windows-installer.mjs`：检查并报告 Squirrel 更新元数据和 full package。
- `Build-Latest.ps1`：暴露 `-UpdateFeedUrl`、保存 feed staging 目录并记录 SHA-256。
- `handoff/2026-11-26-client-self-update.md`、`handoff/PROJECT-HANDOFF.md`：记录结果、验证与剩余外部发布事项。

## Tasks

### Task 1: Main 更新服务

**Files:** Create `src/main/app-updater.ts`; Modify `src/main/bootstrap.ts`.

**Interface:** `createAppUpdater(options)` returns `status(): AppUpdateStatus`, `check(): AppUpdateStatus`, `install(): void`. Status fields: `supported`, `state`, `currentVersion`, optional `releaseName`; states are `unsupported | not-configured | initializing | idle | checking | downloading | downloaded | up-to-date | error`.

- [x] 用 Electron `autoUpdater` 事件实现上述状态；对 feed 与 Squirrel 安装路径做严格校验。
- [x] 阻止 checking/downloading 状态下重复检查；对 Squirrel firstrun 前 10 秒返回 `initializing`。
- [x] 在 Main 提供 `appUpdate.status/check/install` IPC；仅 `downloaded` 可安装，安装前关闭 Core、网页和后台服务。

### Task 2: 配置中心界面

**Files:** Create `src/renderer/components/SoftwareUpdateSettings.tsx`; Modify `src/renderer/pages/ConfigurationCenter.tsx`.

**Interface:** 调用现有 `useStudio().call` 执行 `appUpdate.status/check/install`，不扩展 preload IPC 表面。

- [x] 增加“客户端更新” tab。
- [x] 显示当前版本、简短状态和检查按钮；下载期间禁用重复检查，显示不带百分比的下载状态。
- [x] 只在 `downloaded` 显示“重启并更新”；点击后禁用交互并等待 Main 关闭工作区。

### Task 3: feed 构建参数和发布物

**Files:** Modify `scripts/build-desktop.mjs`, `scripts/package-windows-installer.mjs`, `Build-Latest.ps1`.

**Interface:** `Build-Latest.ps1 -UpdateFeedUrl <https-url>` injects a directory URL; its `/RELEASES` and the referenced full `.nupkg` are deployed together.

- [x] build script 校验 HTTPS、无凭证/查询/fragment 后，以 esbuild define 将 URL 注入 Main；不写入 renderer 或 API secret。
- [x] installer script 验证唯一 `*-full.nupkg` 和 `RELEASES` 引用，并返回其名称与 SHA-256。
- [x] Build-Latest 把文件复制到 `out/update-feed/<version>-<build-id>/`，附校验摘要和构建记录字段，构建失败只清理本轮创建项。
- [x] 保持已有 Setup EXE 和 ZIP 产物、校验与清理逻辑不变。

### Task 4: 交接和静态验证

**Files:** Modify `handoff/PROJECT-HANDOFF.md`; Create `handoff/2026-11-26-client-self-update.md`.

- [x] 运行 `tsc --noEmit`；没有报告本轮新加/修改 TypeScript 文件错误，但仓库既有类型错误和缺失依赖仍令检查失败。
- [x] 运行 `git diff --check`（按仓库 CRLF 行尾配置）、PowerShell/JavaScript 语法检查并审查更新状态、HTTPS 检查、安装卸载次序和构建清理范围。
- [x] 未提供更新服务 URL；真实服务器下载/原生安装未验收，也未进行桌面入口切换。
