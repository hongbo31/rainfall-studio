# Windows x64 完整安装包

Windows 用户需要一个可直接安装的 EXE。使用 PowerShell 7 在仓库根目录运行：

```powershell
./Build-Latest.ps1 -Local -Installer -DeferCleanup -BuildRoot ../rainfall-studio-build
```

这会先生成并校验 Windows x64 免安装 ZIP，再用项目已有的 Squirrel 工具把同一应用装入 Setup EXE。安装包随附 Electron、SQLite、Sharp、FFmpeg、FFprobe、Chrome for Testing、PowerShell 7 和经校验的安卓远控附件。输出在源码同级构建目录的 `out/`，同时保留 `.sha256` 校验文件、Squirrel 完整更新包和 `RELEASES` staging 目录，以及 JSON 构建记录。使用 `-DeferCleanup` 保留先前构建产物，不能切换桌面入口；桌面升级另按桌面交付规范验收。

打包前将 `package.json`、`package-lock.json` 的项目版本同步递增（例如 `0.12.0-preview.14` → `0.12.0-preview.15`），并在交接中记录版本。`-Local` 只构建 Git 提交源码；若工作区有需包含的未提交改动，先在同级构建目录建立隔离源码快照，将当前受版本控制的改动和必要新增源码文件纳入快照，再从该快照调用 `Build-Latest.ps1 -Local`。不要为打包把当前工作分支的未提交修改强行提交，也不要直接复制或覆盖生产安装目录。

`scripts/package-portable.mjs` 为安装包加入运行组件并设置 Windows 应用名称与图标。`scripts/package-windows-installer.mjs` 和 `scripts/windows-installer.nuspec.template` 打包完整应用目录，并从成品 EXE 解出安装载荷核对应用清单。`scripts/verify-portable-build.cjs` 使用隔离库运行随包组件。Main 和 Core 从应用目录解析随包工具，已有浏览器仍沿用现有优先顺序。`src/main/remote-assist-apk.ts` 兼容安卓构建脚本产出的 `Rainfall-SMS.apk` 文件名，并统一为客户端现行下载名。

隔离构建使用锁定的 Windows 预编译依赖，并按 SHA-256 校验 Electron、Chrome for Testing、PowerShell 7、FFmpeg 和构建用的压缩工具。安装程序采用 `RainfallStudioClient` 作为安装目录标识。

首次使用第三方音乐或模型服务需要联网，并配置使用者自己的平台账号和 API Key。安装程序使用当前 Windows 用户的默认应用数据目录。正式桌面入口继续由已验收指针管理。

## 构建与验证结果

- 成品 `RainfallStudio-0.12.0-preview.14-463810745f7b-win-x64-Setup.exe` 位于同级构建目录的 `out/`，构建记录为 `records/rsb-b58d8b7e.json`。源快照提交 `463810745f7bce777d71b5f2a50ffd02085508f7` 取自隔离检出的本轮变更，基线为本地 `5a201f2`。
- EXE 为 563,158,528 字节，SHA-256 `2af924d9b124eb91a89cf973e6e6e74679a23bda362d3c3c708937d21f746eb5`。从 EXE 提取的完整 Squirrel 包与构建载荷哈希一致，3563 个清单文件与两份附加说明文件全部校验通过。
- 在省略用户 PATH 的隔离进程中创建并重开 SQLite 库，执行 PowerShell 的原子重命名、用 FFmpeg 和 FFprobe 生成并读取 WAV、用 Sharp 生成 PNG、用随包浏览器无头加载本地页面。单独验证打包后的 Main 与 Core 启动，并通过随包浏览器打开工作台。
- 安装程序未签名。交互安装、Windows 原生窗口及真实第三方账号流程未验收。全量 TypeScript 检查仍报告未改动的番茄类型问题及计划执行标签重名。桌面指针未找到，未读取生产库或切换入口。

回退可继续用 `Build-Latest.ps1 -Local` 构建原免安装包。若要撤销源码变更，移除 `-Installer` 分支、新安装脚本及随包工具解析，并恢复原校验脚本。用户数据与安装文件分开保存。

## 2026-11-27 当前包与复用步骤

- 当前版本号 0.12.0-preview.15 已同步写入 package.json 与 package-lock.json。
- 本轮工作区包含大量未提交改动，不能直接以原工作区调用 -Local，因为正式脚本只克隆 Git 已提交版本。为确保当前代码进入安装包，先在构建根的 source-snapshots/ 建立隔离源码快照：克隆当前 HEAD，应用 git diff HEAD，复制 git ls-files --others --exclude-standard 列出的新源码/文档，再只在隔离快照提交以取得精确 sourceCommit。没有改写原仓库分支、索引或提交。
- 使用 PowerShell 7 执行：./Build-Latest.ps1 -Local -Installer -DeferCleanup -BuildRoot ../rainfall-studio-build。本轮未提供 -UpdateFeedUrl，因此更新文件已打包和校验，但 Setup 内客户端自助更新 feed 未配置；本轮不部署更新服务。
- 当前 Setup：E:\WYX\wyx\rainfall-studio-build\out\RainfallStudio-0.12.0-preview.15-8645b544d973-win-x64-Setup.exe。大小 563,182,080 字节，SHA-256 a3e16df6146d0567f7f24f542a88ce4893aeda069bb23611ae94b2a5e3158092，旁边 .sha256 文件已复核。
- 同轮 ZIP：RainfallStudio-0.12.0-preview.15-8645b544d973-win-x64.zip，SHA-256 33f826f915899f410f1e1acbbfe7a21ceaaa80e933dc10fcff656322e0fa668b。构建记录 E:\WYX\wyx\rainfall-studio-build\records\rsb-4fd77dad.json；Squirrel feed staging 在 E:\WYX\wyx\rainfall-studio-build\out\update-feed\0.12.0-preview.15-4fd77dad。
- 验证：Setup 内完整 Squirrel 载荷与 3,563 个清单文件逐项匹配；隔离运行验证 SQLite、PowerShell 7、FFmpeg/FFprobe、Sharp、Chromium 与 APK 通过。未安装 Setup、未打开客户端或更新桌面指针；安装器未签名，Google/Suno 账号未做原生登录验收。
- 隔离源码快照保留于 E:\WYX\wyx\rainfall-studio-build\source-snapshots\rainfall-studio-preview.15-7332999e，提交 8645b544d973738786102197a9bfa1cb7a4a4795；可用于追溯该包源文件。旧产物按 -DeferCleanup 要求保留。

## 2026-11-27 preview.17 GitHub 自更新引导包

- 源码提交 `edd2171e5ec3f7f024a6ebbb0c77126c6589811e` 已推送至公开仓库 `origin/main`。包版本为 `0.12.0-preview.17`；Setup 内的默认更新 feed 为 `https://github.com/hongbo31/rainfall-studio/releases/latest/download/`。
- 使用 PowerShell 7 执行 `./Build-Latest.ps1 -Local -Installer -DeferCleanup -BuildRoot ../rainfall-studio-build`。Setup：`E:\WYX\wyx\rainfall-studio-build\out\RainfallStudio-0.12.0-preview.17-edd2171e5ec3-win-x64-Setup.exe`，563,182,592 字节，SHA-256 `8929aec19ac17804dc7c1612477dc542ba97412fd9b3ce5e120571d7107c9e7d`。
- 更新包：`E:\WYX\wyx\rainfall-studio-build\out\update-feed\0.12.0-preview.17-c8749191\RainfallStudioClient-0.12.0-preview17-full.nupkg`，564,427,277 字节，SHA-256 `568952880f7dd0134e8f4392bb0af803b3b472e5974a88edf9412ea30f6d8689`。同目录 `RELEASES` 为 102 字节，SHA-256 `e5bdc7f359868650ce4b77b604f5208a90dba2d385daf3d1cb836b1acfb59793`；其中包名和附件名逐字一致。
- Setup `.sha256` 文件为 `RainfallStudio-0.12.0-preview.17-edd2171e5ec3-win-x64-Setup.exe.sha256`，SHA-256 `7433dfeff0b927344eb4961d06b4066ee3aecfffb115b14e3716f14c0058b1d2`。构建记录 `E:\WYX\wyx\rainfall-studio-build\records\rsb-c8749191.json`。安装载荷清单和随包 SQLite、PowerShell 7、FFmpeg/FFprobe、Sharp、Chromium、APK 布局验证通过。
- GitHub 更新源的 latest endpoint 只接受非预发布、非草稿 Release。为了使 `/releases/latest/download/RELEASES` 有效，v0.12.0-preview.17 Release 的 GitHub Pre-release 选项必须关闭；Release 标题与说明仍明确称其为预览版。旧客户端首次需手动安装 Setup，此后才能点击检查更新。
- 使用 `-DeferCleanup`，没有清理旧包、安装 Setup、打开客户端、运行测试套件或更新桌面指针。Release 上传及匿名 feed 检查待完成。

## 2026-11-27 preview.16 GitHub 更新引导包

- 源码提交 `5813b8e5b7d7e1eb7bf4429493ff00996f2e2695` 已推送至私有 `origin/main`。包版本为 `0.12.0-preview.16`，Setup 默认 feed 指向 `https://github.com/hongbo31/rainfall-studio-updates/releases/latest/download/`。
- 使用 PowerShell 7 执行 `./Build-Latest.ps1 -Local -Installer -DeferCleanup -BuildRoot ../rainfall-studio-build`。Setup：`E:\WYX\wyx\rainfall-studio-build\out\RainfallStudio-0.12.0-preview.16-5813b8e5b7d7-win-x64-Setup.exe`，563,182,592 字节，SHA-256 `4f65cb6dca835853337421991c0182cdf358968adde87b4412483cc9af4071e3`。
- 更新包：`E:\WYX\wyx\rainfall-studio-build\out\update-feed\0.12.0-preview.16-471de136\RainfallStudioClient-0.12.0-preview16-full.nupkg`，564,427,275 字节，SHA-256 `82184ca7412ab333a79ffa0a674f5c7eced6b71ab2c868a474f1b086fcfdcb68`。`RELEASES` SHA-256 为 `2056fa70416d3b1a977a5dbec5a3151dc13cb92b30d3fbb5539a8241df315830`；包内 3,563 个文件及随包运行组件验证通过。构建记录 `E:\WYX\wyx\rainfall-studio-build\records\rsb-471de136.json`。
- 旧版没有自助更新源，首次需手动安装该引导包。尚未创建/公开更新仓库，也未上传附件、安装客户端或改桌面指针；公开分发二进制需用户明确确认。未运行测试套件、原生安装和更新验收。
