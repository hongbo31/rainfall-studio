# 番茄音乐只保留执行上传

用户指出目录上传窗口只需要执行操作。现场对应账号的上一批有 3 条作品回执及 0 首剩余歌曲，回查在官网标签页关闭后暂停。上版的「恢复批次」占用了表单的主按钮，挡住了当前目录中的新歌曲。

- `src/renderer/components/FanqieDownloadUpload.tsx` 将表单主操作统一为「执行上传」。勾选发布确认后，按当前账号、目录预览及批量设置直接发起。执行日志与上传结果仍在最近一批投稿区域查看。
- `src/main/fanqie/upload-broker.ts`、`directory-run.ts` 与 `src/shared/fanqie-downloads.ts` 校验当前预览、账号、上一批 ID 和正在运行的步骤。新批次接替暂停批次时，在该账号的 `download-history` 保存旧记录。查重继续使用已有作品回执、官网标题和录音哈希。原编辑器已关闭且官网查重通过，才重新尝试同一文件在确认上传前中断的操作。提交结果不明的记录继续保留。
- `tests/fanqie-downloads.test.mjs` 验证新歌直传、旧回执留存和传输重试。`tests/platform-management-ui.test.mjs` 验证单按钮、发布确认与签约状态刷新。26 项隔离回归通过，归档调整后关键 3 项复验通过。TypeScript 检查及浏览器构建通过。Windows Electron 无窗口桥接确认，载入已暂停批次后仍可启用「执行上传」。Windows 原生窗口和真实账号新投稿待验收。
- 浏览器版沿用 `Start-Rainfall-Browser.bat`。回退时恢复本轮源文件和测试，保留账号数据、作品回执和批次归档。
