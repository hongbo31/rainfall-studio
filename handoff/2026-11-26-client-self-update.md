# Windows 客户端自助更新

## 本轮改动

配置中心新增“客户端更新”页。用户可手动检查更新；Squirrel 检测到新版后由 Electron 自动下载，页面持续显示检查/下载状态；下载完成后用户点击“重启并更新”，Main 先关闭 Core、浏览器工作区、平台会话和后台服务，再让 Squirrel 安装并重启。开发版、便携版、浏览器预览以及没有 `Update.exe` 的运行方式会显示不支持；安装包未注入 HTTPS 更新源时会显示未配置。不会自动检查、自动安装或切换桌面快捷方式。

改动文件：

- `src/main/app-updater.ts`、`src/shared/app-update.ts`、`src/main/bootstrap.ts`
- `src/renderer/components/SoftwareUpdateSettings.tsx`、`src/renderer/pages/ConfigurationCenter.tsx`
- `scripts/build-desktop.mjs`、`scripts/package-windows-installer.mjs`、`Build-Latest.ps1`
- `docs/superpowers/specs/2026-11-26-client-self-update-design.md`、`docs/superpowers/plans/2026-11-26-client-self-update.md`

保留 Squirrel 安装标识 `RainfallStudioClient` 和用户数据根，不改作品、账号、配置或数据库格式。Electron 的 Squirrel Windows updater 不提供可靠下载百分比，因此页面显示“正在下载”而不虚报百分比。

## 构建与更新源

Windows 安装包默认使用独立的公开更新仓库 Release 地址 `https://github.com/hongbo31/rainfall-studio-updates/releases/latest/download/`；也可用 `-UpdateFeedUrl <HTTPS 目录 URL>` 或 `RAINFALL_UPDATE_FEED_URL` 覆盖。更新源 URL 由构建时注入 Main，不接受凭证、查询参数或 fragment。安装器生成的完整 `*-full.nupkg` 与 `RELEASES` 会验证 SHA-1 引用、文件长度和 SHA-256，并另存到 `out/update-feed/<版本>-<构建号>/`，附 `.sha256` 校验文件和构建记录字段。

GitHub Release 部署时，每个 Release 都要附上名称严格匹配 `RELEASES` 条目的完整 `.nupkg`，并附上文件名为 `RELEASES` 的更新清单。Release 应设为 Latest；预览版本还应设为 Pre-release。安装 Setup EXE 供首次安装及手动升级。安装中的旧客户端没有更新器代码或更新源，用户需要先手动安装一次带更新器的新版本；此后可在配置中心手动检查、下载并确认重启安装。当前更新器不做后台轮询。源代码仓库目前为私有，更新地址改指独立公开发布仓库，待用户确认创建后才能发布；不能把私有仓库设为客户端源。

## 验证与限制

- `node node_modules/typescript/bin/tsc --noEmit` 执行失败：仓库中 11 条现有诊断，涉及未修改的 `src/main/fanqie/directory-run.ts`（2）、`src/main/fanqie/native-upload.ts`（1）、缺少 `reflect-metadata`、`@peculiar/x509`、`qrcode-generator`（3）和 `src/renderer/plan-execution-labels.ts` 重复键（5）。本轮更新相关 TypeScript 文件没有出现诊断。
- `node --check scripts/build-desktop.mjs`、`node --check scripts/package-windows-installer.mjs`、PowerShell 7 Parser 对 `Build-Latest.ps1` 的语法解析、`git -c core.whitespace=cr-at-eol diff --check` 均通过。
- 未添加或运行测试；未运行正式构建、安装器解包、真实更新服务器下载或原生重启验收。未更新桌面入口。由于没有 feed URL，当前代码不能在客户端执行真实更新；构建和部署时需要提供可用的 HTTPS 静态更新目录。

## 回退

只回退本功能新增的 updater 状态模块、共享类型、配置页组件、配置分类、Main 中 `appUpdate.*` IPC/初始化/关闭逻辑，以及构建脚本的更新源注入和 feed staging 逻辑。保留此前的 Squirrel 安装器与 ZIP 打包实现，并保留本检出中其他未提交的修改；不要对这些混合改动文件执行整文件 `git restore`。
