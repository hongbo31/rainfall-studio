# 移除番茄投稿状态按钮

新版执行入口见[番茄音乐只保留执行上传](2026-11-21-fanqie-execute-only.md)。

按用户要求，移除了番茄音乐「目录上传」表单和「最近一批投稿」中的两处「核对投稿状态」按钮。正常进行中的签约和回执由窗口定时读取，程序自动刷新投稿结果和续跑状态。

- `src/renderer/components/FanqieDownloadUpload.tsx` 在本批需要恢复且无待继续歌曲时显示「恢复批次」。有剩余待处理歌曲时可使用「核对并继续下一批」。执行日志从最近一批投稿打开。
- `src/shared/fanqie-downloads.ts` 更新中断提示，`tests/platform-management-ui.test.mjs` 覆盖按钮移除、异常恢复和自动状态更新。
- 21 项隔离回归、TypeScript 检查、浏览器构建及 Windows Electron 无窗口桥接均通过。浏览器和 Windows 客户端共用执行窗口。Windows 原生窗口待验收。
- 浏览器使用原入口 `Start-Rainfall-Browser.bat`。回退时恢复本轮界面、提示和测试文件，保留批次记录。
