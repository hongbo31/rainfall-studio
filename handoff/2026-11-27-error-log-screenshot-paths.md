# 错误日志附截图完整路径

## 原因与修改

番茄目录执行错误日志的 trace.jsonl 记录截图时，screenshot 字段只有相对路径（例如 screenshots/event-142-….png），直接查看日志不容易定位文件。

src/main/fanqie/directory-trace.ts 保存截图后，现在同时写入 screenshotPath 绝对路径；现有 screenshot 相对路径字段保留，避免影响既有读取方。截图未成功生成时仍只记录 screenshotReason，不伪造文件路径。

## 验证及未验证

- 静态核对 capture 先写入截图，再将该文件的绝对路径放进同一条错误 trace 记录。
- 未运行测试、类型检查、构建或 Windows 原生验收；未启动客户端或操作现有日志。新版客户端尚未更新。

## 回退

恢复 directory-trace.ts 中 screenshotPath 的新增字段，并删除本交接文件及 handoff/PROJECT-HANDOFF.md 中对应条目。
