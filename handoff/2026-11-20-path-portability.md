# 路径可移植性排查与修复

2026-11-20。修改已落在当前检出。目标是将源码移到另一位置、换 Windows 用户或换工具安装目录后，程序仍能找到同一类资源。

## 排查范围与结果

复查了程序源码、浏览器启动入口、PowerShell 和 Node 构建脚本、桌面启动器、维护工具及测试。移除了绑定开发机盘符、用户名、Chrome 安装目录和旧 PowerShell 位置的代码。测试中模拟其他盘符、非法路径和采集路径的固定字符串仍用于边界验证。已验收指针、数据库、回退记录和快捷方式按需继续保存经过解析的绝对路径。历史记录、第三方依赖、IDE 配置和生成产物不在源码改写范围内。

## 具体变更

- `src/shared/host-executable-paths.ts` 统一 Windows 程序目录、Chromium 和 PATH 上的可执行文件定位。`src/main/fanqie/chrome-executable.ts` 使用系统提供的安装目录和用户目录；系统盘信息没有提供时，不再猜测盘符。`src/core/assets.ts` 继续优先使用随包媒体工具，Linux 接受 `RAINFALL_MEDIA_TOOLS` 的显式目录并保留标准系统回退。媒体测试夹具也使用同一定位函数。
- `scripts/lib/headless-chromium.mjs` 供 24 个原本写死浏览器路径的脚本和测试使用。优先采用显式 `RAINFALL_TEST_CHROME` 或原有 `CHROME_PATH`，也保留番茄夹具的 `TME_TEST_BROWSER`。普通相对覆盖从仓库根解析。默认查找系统安装、PATH 或 Playwright 管理的浏览器，始终以无头模式启动。`tests/publication-pipeline-ui.test.mjs` 移除固定的 HOME 目录，`tests/workspace-lease-errors.test.mjs` 使用系统临时目录。
- `scripts/lib/verified-desktop.mjs` 从当前用户的 `%LOCALAPPDATA%` 读取已验收的桌面指针并验证数据根。`scripts/authorized-music-main.ts`、`scripts/debug-daily-local-candidate.mjs` 和 `scripts/tme-desktop-qa.mjs` 复用该入口。授权音乐工具继续检查候选库与正式库的物理路径是否重叠。每日候选诊断输出放在同级构建目录或显式 `RAINFALL_BUILD_ROOT` 下。
- `scripts/lib/powershell-7.mjs`、`scripts/deliver-local-release.mjs`、`launcher/Launch.ps1` 和 `launcher/Install-Shortcut.ps1` 使用 PowerShell 7，支持通过 `RAINFALL_PWSH` 定位非默认安装。桌面路径通过系统已知文件夹获取，支持桌面重定向。发布脚本将其依赖的定位工具一并复制到管理目录。对应启动器和交付测试调用同一套定位规则。
- `Start-Rainfall-Browser.bat` 支持 `RAINFALL_PWSH` 和系统中的 PowerShell 7，去掉对开发机缓存目录的依赖。`scripts/Start-Rainfall-Browser.ps1` 声明 PowerShell 7 要求。`scripts/build-desktop.mjs` 和 `scripts.mjs` 从脚本位置定位输入及输出，可从另一个目录执行。`AGENTS.md` 补充路径、双端兼容与交接规则。

## 验证与交付边界

- 在同级构建目录的 `path-audit-5616a6d2/relocated source` 测试。从检出外完成桌面 Main、Core、预加载和两端共用渲染页面的构建，并验证旧原型构建的输出位置。TypeScript 检查通过，解析了 15 个 PowerShell 脚本，检查了 36 个 Node 入口和工具的语法，另在内存中打包了授权音乐维护入口。
- 26 项针对性测试通过，覆盖模拟换盘、重定向桌面、相对配置、Chrome 和 Edge 发现、PowerShell 7 启动器、无头浏览器和共享浏览器接口。隔离目录中的合成快捷方式通过 PowerShell 7 COM 创建及读回。
- `tests/publication-pipeline-ui.test.mjs` 另有一项旧问题，夹具导入 CSS 时 esbuild 缺少输出路径，在浏览器启动前失败。使用改动前的测试源码在同一隔离检出复现。本次未调整发布界面的测试夹具。
- 验证使用隔离目录及合成数据。正式桌面入口、已验收数据根和回退版本未切换。真实发布、付费生成、完整正式打包和原生窗口验收不在本轮验证范围内。

需要回退时，按本文件所列范围撤回本轮路径定位代码和测试改动，保留同文件中的其他工作。后续发布继续遵循已有部署流程，使用当前用户的已验收指针核对作品库与桌面入口。
