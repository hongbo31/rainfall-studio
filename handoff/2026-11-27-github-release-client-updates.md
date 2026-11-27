# GitHub Release 客户端更新交接

## 目标与约束

使 Windows Squirrel 安装版从本仓库的 GitHub Releases 检查更新。客户端在“配置中心 → 客户端更新”由用户点击“检查更新”，下载完成后用户点击“重启并更新”。当前为手动检查和手动重启，不会后台轮询。

## 更新源

- 默认稳定地址：`https://github.com/hongbo31/rainfall-studio-updates/releases/latest/download/`。该独立公开更新仓库尚待创建和用户确认；私有源码仓库不作为客户端源。
- `Build-Latest.ps1 -Installer` 默认将此地址注入客户端。`-UpdateFeedUrl` 或 `RAINFALL_UPDATE_FEED_URL` 可覆盖；只接受 HTTPS URL，不含凭证、查询参数或 fragment。
- 每个可更新 Release 必须附加 `RELEASES` 和它引用的、同名完整 `*-full.nupkg`。`RELEASES` 里记录的包文件名与 Release 附件名必须完全相同。另附 Setup EXE 供首次安装/手动升级，可附 `.sha256`。
- 每次更新把新 Release 标为 Latest；预览版同时标为 Pre-release。客户端请求 `/RELEASES`，Squirrel 再按清单下载 `.nupkg`。
- Release 附件必须可匿名读取。当前源码仓库为私有，客户端没有 GitHub 登录/token 能力；本轮默认地址改为独立公开更新仓库，不能擅自公开源码仓库或创建公开仓库。

## 首次迁移与常规发布

1. 检查并提交本次要发布的源码、版本号和交接文档，不要在混合工作区盲目 `git add .`。构建脚本 `-Local` 只包含 Git 已提交内容。
2. `package.json` 与 `package-lock.json` 版本保持一致；在仓库写权限可用后推送该源码提交。
3. 使用 PowerShell 7 从该提交构建：

   ```powershell
   ./Build-Latest.ps1 -Local -Installer -DeferCleanup -BuildRoot ../rainfall-studio-build
   ```

4. GitHub 的 Releases 页面为该提交创建版本标签。上传本轮 `out/update-feed/<版本>-<构建号>/` 内的 `RELEASES` 和对应完整 `.nupkg`，再上传 `out/` 中的 Setup EXE。核对清单中的 `.nupkg` 名称与 Release 附件名完全一致，之后设为 Latest 并发布。
5. 目前安装的旧版本没有更新源，至少需手动安装一次新构建的 Setup。若要验收自动升级，先安装带更新源的版本，再发布更高版本，点击检查更新并验证下载/重启安装。

## 本轮状态（2026-11-27）

- 当前源码包版本从 `0.12.0-preview.15` 提升为 `0.12.0-preview.16`，拟用的公开更新地址已加入 `Build-Latest.ps1`。
- 当前工作区存在大量未提交的代码、测试与 handoff 改动；准备提交前需检查完整 `git status`、差异、凭据/个人数据和构建结果，不要覆盖或丢弃现有修改。
- `git fetch origin main` 遇到 `Recv failure: Connection was reset`；`gh` CLI 未安装。此前已有 push 403 记录。已通过现有 GitHub 浏览器会话确认源仓库 Releases 标注为私有；独立更新仓库尚未创建。
- 本轮尚未提交/推送、构建 preview.16 或发布 GitHub Release；未安装/切换桌面客户端。构建地址目前指向尚不存在/未验证的更新仓库，需经用户确认创建后才能作为可用更新地址。

## 后续与回退

- 创建公开更新仓库前，用户需确认公开发布 Rainfall Studio 的安装程序及更新包。若不允许公开，应另选经过授权的匿名 HTTPS 静态更新源，不使用私有源码仓库。
- 若 GitHub Releases 的稳定 URL 不能为客户端匿名返回 `RELEASES` 和同名包，停止发布，保留默认值之前的安装构建，改用可匿名访问的 HTTPS 静态存储并在构建时覆盖 `-UpdateFeedUrl`。
- 回退时恢复 `Build-Latest.ps1` 的更新源默认值，恢复版本号，并在新版本构建时不注入更新源；不要改动用户作品库、数据根或桌面交付指针。
