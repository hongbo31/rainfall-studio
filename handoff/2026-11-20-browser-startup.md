# 浏览器启动入口修复

2026-11-20

## 原因与改动

用 Windows 用户和系统的 PATH 从项目外运行 BAT，入口在构建前报出 `PowerShell 7 is required`。当前主机的 PowerShell 7 位于 Codex 工具目录，资源管理器双击时找不到它。

- 根目录的 `Start-Rainfall-Browser.bat` 在显式配置、PATH 和标准安装目录之后，查找源码同级预览目录中的 `tools/pwsh/pwsh.exe`。预览目录名由当前检出目录名推导。
- 本机已在该位置部署 Microsoft 签名的 PowerShell 7.6.9 便携副本。可执行文件和关键程序集的 SHA-256 与工具源一致。副本通过版本查询。

## 验证

- 使用桌面环境的 PATH，从项目外运行原 BAT 的 `-BuildOnly`，成功构建两端共用的 Main、Core、预加载和渲染页面。
- 使用构建后的 Electron 进程在离线隔离库中启动浏览器服务。无头浏览器加载「总览」，读取隔离的生产模式快照，确认空测试库和渲染页面均可用。
- 只读确认当前预览库的 SQLite 文件头和 schema 3。路径定位、浏览器服务和基础回归共 12 项通过，TypeScript 检查通过。
- 桌面双击打开默认浏览器与 Windows 原生窗口验收待完成。本次验证使用隔离库。

## 回退

恢复 BAT 原有的 PowerShell 查找顺序，即可回退这次便携查找改动。回退后可用 `RAINFALL_PWSH` 指向一份 PowerShell 7，或通过系统安装路径启动。
