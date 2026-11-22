# 番茄上传后后台回收被占用的下载文件

## 原因

- 19:00 的批次有两首歌保存了番茄上传回执。两份音频和歌词已移动，两张封面在快速重试后仍未能移入回收站。随后只读检查两张封面时，Windows 已允许取得删除权限。原执行日志无法确定当时的占用进程。
- 目录上传使用导出的上传材料。隔离测试对封面完成读取、缩放和编码后，原文件可以取得删除权限。系统级独占可在发布之后发生，持续时间可能超过单次清理的快速重试。
- Windows 文件占用方未共享删除权限时，系统会拒绝删除。文件解锁后可以继续通过系统回收站处理。[Microsoft DeleteFileW 文档](https://learn.microsoft.com/zh-cn/windows/win32/api/fileapi/nf-fileapi-deletefilew)

## 改动

- `src/main/fanqie/directory-run.ts` 和 `src/main/fanqie/recycle-file.ts` 继续对单个文件快速重试，随后把系统拒绝回收或暂时无法检查的文件记录为后台待回收。已核对的上传结果、后续上传轮次及用户确认的合同流程继续推进。执行日志按歌曲序号和材料类型区分待回收文件。
- `src/core/fanqie-download-cleanup.ts` 为每个账号下的原批次和轮次原子保存待回收记录。`src/main/fanqie/upload-broker.ts`、`src/main/fanqie/account-sessions.ts` 和 `src/main/bootstrap.ts` 按账号串行处理，约每 15 秒调度一次。每次按原回执、文件身份、当前下载目录和版权证明保护范围复核。程序重启后从原记录继续。
- `src/core/plan-fanqie-directory.ts`、`src/core/plan-center/storage.ts` 和 `src/main/fanqie/plan-directory-publisher.ts` 在后台查找历史上因回收失败的目录上传。完整上传回执和无需准备合同的原批次自动补回收，失败时也可保存为后台重试。新批次以实际上传结果结束，待回收原因单独显示。
- `src/core/publication-task-integration.ts`、`src/shared/plan-center.ts`、`src/shared/fanqie-downloads.ts`、`src/renderer/pages/PlanCenter.tsx` 和 `src/renderer/components/FanqieDownloadUpload.tsx` 显示后台回收和完成状态。浏览器和 Windows 客户端共用本地回收及数据逻辑。

## 验证

- 改动前的回归中，被占用的歌词导致已上传批次进入待复核。修复后，`tests/fanqie-downloads.test.mjs` 验证继续处理本批其余文件和后续轮次、保留合同确认流程、重开程序续跑及从历史回执补回收。`tests/plan-workflow-ui.test.mjs` 验证详情页状态从后台回收更新至完成。
- 番茄、归档、计划和任务专项 159 项通过，旧计划专项 18 项通过，界面及桥接 9 项通过。TypeScript 与同一个 `Start-Rainfall-Browser.bat -BuildOnly` 的 Main、preload、Core 和渲染构建通过。
- 用 Windows Electron 无窗口实例和隔离库持有独占的测试封面。首个实例自动接手旧失败记录并保存待回收，重启隔离实例后释放占用。后台完成清理，通过回收站数据核对了测试封面的原路径和内容，也核对了原上传回执。
- 全量集成 233 项通过，6 项既有失败。日志在 `../rainfall-studio-build/fanqie-lock-integration-20261122/temp/integration-with-media.log`。
- 只读核验两批真实记录，32 首都有上传回执，49 个早期遗留文件和最新的 2 张封面符合自动补回收范围。51 个文件待新版接手。正式上传及 Windows 原生窗口待验收。

## 使用与回退

- 退出旧的浏览器预览后，通过原 `Start-Rainfall-Browser.bat` 加载新版。原失败批次由后台自动核对并补回收，任务中心的执行详情可查看当前状态。
- 回退时恢复上述源码和测试后重建。保存各账号 `download-cleanup` 下的待回收记录，重新使用新版后可继续处理。已经回收的下载文件可从系统回收站还原。
