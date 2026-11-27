# Windows 客户端自助更新设计

## 意图

让用户能在 Rainfall Studio 配置中心检查新版、看到下载状态，并在下载完成后主动重启安装。继续使用现有 Squirrel Windows 安装器，使安装版本沿用原有用户数据目录。

## 目标与边界

- 只为已安装的 Windows x64 Squirrel 客户端启用更新；便携运行、浏览器预览、开发构建和未配置更新源时明确展示不可用原因。
- 仅由用户点击“检查更新”启动检查和下载；下载完成后再次由用户确认重启安装。
- 在更新页展示当前版本、检查/下载状态和可操作的错误提示。Windows 内置 Squirrel updater 没有可靠的下载百分比事件，因此只显示“正在下载”，不展示伪造进度。
- 构建产物除 Setup EXE 外，另生成可发布到 Squirrel 更新源的 `RELEASES` 与完整 `.nupkg`。
- 更新源使用构建时注入的 HTTPS 基础 URL，不含凭证，不在运行时允许任意 URL。

## 不做

- 本轮不搭建或发布更新服务器，不上传 GitHub/对象存储，也不自动切换桌面快捷方式。
- 本轮不自动后台检查、不自动重启、不实现 macOS/Linux 更新、不改数据库格式或用户数据根目录。
- 现有安装包缺少更新代码，首次升级到带更新器的版本仍需手动安装。

## 方案比较

1. **Electron 内置 `autoUpdater` + Squirrel feed（采用）**：与现有 `RainfallStudioClient` 安装器和完整 NuGet 包兼容，依赖最少，可报告下载开始/完成并主动安装；不能显示可靠的下载百分比。
2. `electron-updater`：增加依赖与另一套配置，而现有 Squirrel 安装器已能提供所需功能。
3. 只提供新版 EXE 下载链接：无法在客户端内完成检查、下载和重启安装。

## 实现约定

- Main 持有更新状态和 Electron `autoUpdater`，Renderer 只能通过已有受信 IPC 调用检查/读取状态/安装。
- 安装动作先关闭应用内工作区和后台浏览器进程，再调用 Squirrel 安装并重启，避免 SQLite/平台流程仍在运行。
- 配置中心新增“客户端更新”分类；更新状态使用短中文提示，不展示下载百分比。
- `Build-Latest.ps1 -UpdateFeedUrl https://...` 将 HTTPS 基础地址注入安装包；未设置时该构建的更新按钮明确提示未配置。
- 构建验证输出单独的 feed staging 目录，内含 `RELEASES`、完整 `.nupkg` 及校验文件。客户端会请求配置 URL 下的 `/RELEASES`；发布者需先上传 `.nupkg`，再更新 `RELEASES`，避免客户端读到不完整版本。
- 对现有版本只读旧数据，不改变 `%APPDATA%\RainfallStudio` 或现有安装 ID `RainfallStudioClient`。

## 验收

- TypeScript 与桌面构建可通过；更新器没有 feed、未安装 Squirrel、无更新、下载中、下载完成和失败状态都能安全呈现。
- 更新包中 `RELEASES` 指向同一 staging 目录下的 `.nupkg`，二者哈希/大小符合构建输出；不配置 feed 不会发起网络请求。
- 原有 ZIP/Setup EXE 交付、数据目录选择和普通退出流程不回归。
- 本轮不执行可见客户端安装或桌面入口切换；真实服务器下载及原生重启安装留待提供 HTTPS feed 并验收。
