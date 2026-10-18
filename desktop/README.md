# Windows 壳状态

start.ps1 是 Windows 启动入口，运行本地 Node 服务，可用 -OpenBrowser 打开系统浏览器。它不是 Windows 原生客户端，也不是已打包 Electron 应用。

electron-main.cjs 仅为未来安全隔离壳源代码草案，尚未构建/执行/验证。当前 ES 模块前端应通过 loopback 服务加载；打包阶段需把 host 改为内置服务或受控协议，完成 CSP、IPC 白名单、文件权限和签名评估。没有安装 Electron、没有下载依赖、没有生成 EXE/MSI。

真实桌面打包是下一阶段阻塞：需要批准并提供选定桌面运行时/打包工具；本机没有 .NET SDK，不把浏览器原型声称为已打包客户端。

本机 PowerShell 执行策略禁止 .ps1，未改动该策略。推荐使用 start.cmd（前台 Node 服务，Ctrl+C 停止），或直接 node server.mjs。start.cmd --check 已执行验证。
