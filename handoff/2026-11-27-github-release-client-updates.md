# GitHub Release 客户端更新交接

## 目标与约束

使 Windows Squirrel 安装版从本仓库的 GitHub Releases 检查更新。客户端在“配置中心 → 客户端更新”由用户点击“检查更新”，下载完成后用户点击“重启并更新”。当前为手动检查和手动重启，不会后台轮询。

## 更新源

- 默认更新地址：`https://github.com/hongbo31/rainfall-studio/releases/latest/download/`。源码仓库现已公开；发布资产通过匿名 HTTPS 提供。
- `Build-Latest.ps1 -Installer` 默认将此地址注入客户端。`-UpdateFeedUrl` 或 `RAINFALL_UPDATE_FEED_URL` 可覆盖；只接受 HTTPS URL，不含凭证、查询参数或 fragment。
- 每个可更新 Release 必须附加 `RELEASES` 和它引用的、同名完整 `*-full.nupkg`。`RELEASES` 里记录的包文件名与 Release 附件名必须完全相同。另附 Setup EXE 供首次安装/手动升级，可附 `.sha256`。
- 客户端通过 GitHub `/releases/latest/download/RELEASES` 拉取清单，再由 Squirrel 按清单下载 `.nupkg`。GitHub `latest` 指向最新非预发布、非草稿 Release；因此，即使版本号/标题标注 `preview`，更新源 Release 也必须将 GitHub 的 Pre-release 选项关闭。该发布分类是更新端点的要求，不代表软件已经完成正式验收。
- Release 附件必须可匿名读取。不能把客户端可访问性建立在 GitHub 登录/token 上。

## 首次迁移与常规发布

1. 检查并提交本次要发布的源码、版本号和交接文档，不要在混合工作区盲目 `git add .`。构建脚本 `-Local` 只包含 Git 已提交内容。
2. `package.json` 与 `package-lock.json` 版本保持一致；在仓库写权限可用后推送该源码提交。
3. 使用 PowerShell 7 从该提交构建：

   ```powershell
   ./Build-Latest.ps1 -Local -Installer -DeferCleanup -BuildRoot ../rainfall-studio-build
   ```

4. GitHub 的 Releases 页面为该提交创建版本标签。上传本轮 `out/update-feed/<版本>-<构建号>/` 内的 `RELEASES` 和对应完整 `.nupkg`，再上传 `out/` 中的 Setup EXE 与 `.sha256`。核对清单中的 `.nupkg` 名称与 Release 附件名完全一致，将 Pre-release 关闭并设为 Latest 后发布。
5. 目前安装的旧版本没有更新源，至少需手动安装一次新构建的 Setup。若要验收自动升级，先安装带更新源的版本，再发布更高版本，点击检查更新并验证下载/重启安装。

## 初次接入记录（2026-11-27）

- 当时源码包版本从 `0.12.0-preview.15` 提升为 `0.12.0-preview.16`，暂设独立更新仓库地址。之后用户将现有 `rainfall-studio` 仓库改为公开，本轮改回此仓库作为匿名更新源。
- 源码与当时工作区改动已提交并推送至私有源码仓库，提交 `5813b8e5b7d7e1eb7bf4429493ff00996f2e2695`（`feat: add GitHub client self-updates`）。提交包括 111 个文件；检查未发现凭据/个人数据，`git diff --check`、更新器相关静态检查及版本一致性检查通过。没有运行测试套件。
- preview.16 已用 PowerShell 7 和 `Build-Latest.ps1 -Local -Installer -DeferCleanup -BuildRoot ../rainfall-studio-build` 构建。Setup 位于 `E:\WYX\wyx\rainfall-studio-build\out\RainfallStudio-0.12.0-preview.16-5813b8e5b7d7-win-x64-Setup.exe`，大小 563,182,592 字节，SHA-256 `4f65cb6dca835853337421991c0182cdf358968adde87b4412483cc9af4071e3`。完整更新包位于 `E:\WYX\wyx\rainfall-studio-build\out\update-feed\0.12.0-preview.16-471de136\RainfallStudioClient-0.12.0-preview16-full.nupkg`，大小 564,427,275 字节，SHA-256 `82184ca7412ab333a79ffa0a674f5c7eced6b71ab2c868a474f1b086fcfdcb68`；`RELEASES` 与 3,563 文件载荷及随包运行组件验证通过。构建记录为 `E:\WYX\wyx\rainfall-studio-build\records\rsb-471de136.json`。
- 初次构建的 preview.16 使用了尚不存在的独立 feed，未发布，不能用作客户端引导包。
- 已安装的旧版本没有更新源，需要先手动安装一次带公开 feed 的引导包；之后发布更高版本到可匿名访问的更新源，才可从客户端点击检查更新并更新。

## preview.17 构建与 GitHub 发布状态（2026-11-27）

- 用户确认源码仓库已改为公开。匿名 GitHub API 确认 `hongbo31/rainfall-studio` 的 `private=false`；源码提交 `edd2171e5ec3f7f024a6ebbb0c77126c6589811e` 已推送，更新 URL 改为此仓库。
- preview.17 Setup 和 Squirrel 更新包已构建，路径、大小和 SHA-256 见 [Windows 安装包交接](2026-11-26-windows-installer.md)。构建结果通过安装载荷 3,563 文件清单、SQLite、PowerShell、FFmpeg/FFprobe、Sharp、Chromium 与 APK 布局验证。使用 `-DeferCleanup`，旧包保留。
- 当时 GitHub 旧 Release 均为预发布，`GET /repos/hongbo31/rainfall-studio/releases/latest` 返回 404。preview.17 必须在 GitHub 作为非预发布、非草稿的 Latest Release 发布（标题/说明仍写明 preview），否则客户端的 `latest/download/RELEASES` 会不可用。
- 初次检查确认 `v0.12.0-preview.17` 已是 Latest，但没有附加 `RELEASES` 与完整 `.nupkg`；因此客户端请求 `/releases/latest/download/RELEASES` 和包文件都返回 404。不是客户端 feed URL 错误。

## preview.17 更新资产补齐与公开验证（2026-11-27）

- 已在现有公开 Latest Release `v0.12.0-preview.17` 上传并保存以下资产：
  - `RELEASES`：102 字节，SHA-256 `e5bdc7f359868650ce4b77b604f5208a90dba2d385daf3d1cb836b1acfb59793`。
  - `RainfallStudioClient-0.12.0-preview17-full.nupkg`：564,427,277 字节，SHA-256 `568952880f7dd0134e8f4392bb0af803b3b472e5974a88edf9412ea30f6d8689`。
  - `RainfallStudio-0.12.0-preview.17-edd2171e5ec3-win-x64-Setup.exe`：563,182,592 字节，SHA-256 `8929aec19ac17804dc7c1612477dc542ba97412fd9b3ce5e120571d7107c9e7d`。
  - Setup `.sha256` sidecar：131 字节。
- 未登录 `curl -I -L` 检查以上 `latest/download` 清单、完整包和 Setup 均最终返回 HTTP 200；`RELEASES` 正文匹配完整 `.nupkg` 文件名及 564,427,277 字节，和构建产物一致。GitHub Release 页面显示该版本仍为 Latest、附件已保存。
- 未修改客户端源码或 feed URL。未安装客户端、未切换桌面入口，也未做原生“检查更新/重启并更新”验收；旧安装版若未内置公开 feed，仍需先手动安装 preview.17 Setup 一次，再用“配置中心 → 客户端更新”检查更高版本。

## 后续与回退

- 更新 Release 必须保持非预发布状态，确保 `latest/download` 持续解析；不能只发布 GitHub Pre-release。
- 若 GitHub Releases URL 不能为客户端匿名返回 `RELEASES` 和同名包，保留默认值之前的安装构建，改用可匿名访问的 HTTPS 静态存储并在构建时覆盖 `-UpdateFeedUrl`。
- 回退时恢复 `Build-Latest.ps1` 的更新源默认值，恢复版本号，并在新版本构建时不注入更新源；不要改动用户作品库、数据根或桌面交付指针。
