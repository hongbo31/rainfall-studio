# ADR-001：Windows 桌面运行时与发行

日期：2026-10-15。结论：采用 Electron + TypeScript，React/Vite 渲染层，Electron Forge 构建；SQLite 使用 better-sqlite3，由 utilityProcess 内的核心服务独占写入。正式版本不依赖系统 Node，也不启动固定端口网页服务。

## 实测环境

| 项目 | 检查结果 |
|---|---|
| 主机 / OS | 目标 Windows 设备；Windows 10 Pro 22H2，build 19045，x64 目标 |
| Node / npm | v24.14.0 / 11.9.0；现有原型零依赖 |
| Git | 可用；仓库无 HEAD，所有已有项目文件尚未提交 |
| .NET | dotnet 命令存在，但 --list-sdks 无输出；未发现可用 SDK |
| Rust | rustc 1.95.0、cargo 1.95.0，stable-x86_64-pc-windows-msvc |
| C++ 工具 | vswhere 检出 D:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools；MSVC 14.44.35207 / 14.50.35717 |
| WebView2 | 注册表检出 Runtime 151.0.4129.86 |
| 媒体 | C:\ffmpeg\ffmpeg-8.1-essentials_build\bin\ffmpeg.exe；8.1；带 --enable-gpl、--enable-version3、libx264；ffprobe 同目录需实施时探测 |
| 浏览器测试 | 本机 Chrome 与 Codex 预置 Playwright 已用于原型验证 |
| Electron | 项目无依赖/安装记录，现有 electron-main.cjs 仅草案；不得宣称已可打包 |
| 执行策略 | .ps1 默认受阻；保持现有策略，使用 npm.cmd/Node/标准构建脚本 |

本次命令/注册表属于只读探测，未安装、升级或更改设置。C++ 工具被检出不等于已验证所有 Electron ABI 构建；任务 1 用实际打包证明。

## 方案比较

| 方案 | 优点 | 代价 | 决策 |
|---|---|---|---|
| Electron + Forge | 可复用 JS 领域逻辑、已认可 CSS 与 Chromium 行为；本机 Node/C++ 足够启动开发；官方文档成熟 | 安装体积/内存较大；原生 SQLite 模块需匹配 ABI | 采用，优先保证音乐播放/文件库/队列一致性 |
| Tauri 2 + Rust + WebView2 | 机器已有 Rust/MSVC/WebView2；壳更轻，Rust 文件/数据库能力好 | 核心服务需 Rust 重写；WebView2 媒体/协议与跨进程测试另行验证 | 可行备选，不因“环境缺失”排除；本期不并行维护两套壳 |
| .NET/WPF + WebView2 | Windows 集成直接 | 当前无 SDK，业务核心需跨语言桥接；本轮额外成本更高 | 不采用 |

用户已经认可视觉样式；框架迁移只把大文件拆成页面/服务，复用设计 token、布局、文案和截图基线，不进行视觉重做。

## 运行结构

Renderer React → 受限 preload bridge → Main IPC 路由 → Core utilityProcess（SQLite/队列/文件服务/网络适配器）；Main 负责窗口、文件选择、safeStorage 加解密、受管资源协议、系统浏览器跳转和退出协调。FFmpeg 是独立子进程，由 Core 以参数数组启动，shell:false。

- app.requestSingleInstanceLock 防两个 worker 同时调度；数据库还用事务租约防逻辑并发。
- Renderer sandbox:true、contextIsolation:true、nodeIntegration:false、webSecurity:true；不启用 remote、不暴露原始 ipcRenderer/任意 fs/exec/SQL。
- app://ui/ 从打包资源加载；media://asset/<uuid> 由 Main 查询资产 ID、授权工作区和 hash 路径，提供 MIME、Range/206/416；不把任意 file:// 路径交给页面。
- CSP 默认仅本地资源；真实 HTTP 只在核心适配器，通过固定 allowlist 主机；渲染器不直接调用平台接口。
- 外部 OAuth/人工发布打开系统浏览器，禁止把第三方站点装进有 preload 的窗口。
- 退出停止接收新任务，进行中的可安全步骤保存检查点；处于提交边界按未知状态落盘。无隐藏常驻/开机自启；下次启动读状态恢复，真实队列须用户确认继续。

## SQLite 选择

使用 better-sqlite3 的事务和备份接口，单写入进程、WAL、FULL synchronous。版本在实施当天从维护者 npm/官方发布锁定，并用 @electron/rebuild 匹配 Electron ABI；优先已验证预构建二进制，必要时使用已有 MSVC 和预置 Python 构建，记录工具路径。

没有选 node:sqlite 作为初版默认：当前官方文档仍标注 release candidate，且不同 Node 大版本类名变化；桌面内置 Node 与系统 Node 不是同一个运行时。若 better-sqlite3 不兼容，先修构建链并报告；不得悄悄降级成 localStorage/整库 JSON。替换数据库驱动需要更新此 ADR，但可在不改变仓储契约下进行。

## 版本与依赖安装边界

选受 Electron 官方支持的 stable 版本，不使用 beta/nightly；检索并固定 exact versions + package-lock，记录 Electron/Chromium/Node/SQLite 运行版本到诊断页。官方 stable 页面本次抓取失败，故不虚构“最新版号”；任务 1 的版本解析和最小包运行是强制门槛。

正常开发依赖：electron、@electron-forge/cli、@electron-forge/plugin-vite、@electron-forge/maker-squirrel、@electron-forge/plugin-auto-unpack-natives、@electron/rebuild、electron-squirrel-startup、typescript、vite、react/react-dom、better-sqlite3、zod、vitest、@playwright/test；流式 ZIP 使用 archiver/yauzl，随锁文件与许可证清单。包名从官方项目确认后安装到本仓库，不全局安装。运行时不要下载依赖。

本阶段用户允许正式开发，后续 Sol 可安装上述正常官方开发包并执行 npm.cmd；遇网络/组织策略阻断应报告具体限制，不改 PowerShell 策略、Defender、证书校验或防火墙。新证书、账号、购买、云服务部署另需用户授权。

## 打包与交付门槛

Forge package 产生 out/rainfall-studio-win32-x64/ 的真实 EXE；Forge make 产生 Squirrel Setup.exe + nupkg/RELEASES。Squirrel 配置 name/author/description、图标、per-user 安装，不要求管理员。处理安装事件后退出，避免安装期间启动第二个 worker。安装/卸载不能清理 userData；升级保留库并执行 schema migration。

“可打包”证据必须包括：artifact SHA256、打包日志、从 out/ EXE 启动的截图、打包运行时 SQLite native binding/音频播放/媒体 Range/重启数据保留/模拟队列恢复测试。安装器实际安装/卸载在隔离 Windows 账号或 VM 验证；没有隔离环境时明确 installer-built / installer-not-run，不能冒称安装验收通过。签名未配置则产物明确 unsigned；不保证消除 SmartScreen，不购买证书或绕过警告。自动更新暂关闭。

FFmpeg 首版复用用户已安装的受信本地路径，设置页探测版本并明确“视频包装可用”；不得自动捆绑当前 GPL 构建后称其无许可要求。无 FFmpeg 的目标机器仍可运行素材库与音频功能，视频步骤给出缺工具阻塞。需可携带视频处理包时另选可分发构建、附许可证/来源/对应源代码或提供方式，完成分发审查后再打入 extraResources；不影响基础 EXE 交付。

## 官方依据

- Electron 安全建议：https://www.electronjs.org/docs/latest/tutorial/security
- utilityProcess：https://www.electronjs.org/docs/latest/api/utility-process
- safeStorage Windows DPAPI 说明：https://www.electronjs.org/docs/latest/api/safe-storage
- Forge Squirrel.Windows：https://www.electronforge.io/config/makers/squirrel.windows
- Tauri Windows 前置条件：https://v2.tauri.app/start/prerequisites/
- SQLite 维护者 API：https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
- Node SQLite 稳定性：https://nodejs.org/api/sqlite.html
- FFmpeg 许可：https://ffmpeg.org/legal.html

以上是工程选型和依赖分发边界，不构成对第三方平台权限或作品商业权利的保证。
