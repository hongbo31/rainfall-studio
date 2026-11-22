# 发布任务沿用关联计划的发布节点

2026-11-20

## 改动

- 发布中心的「新建任务」和「编辑任务」删除「上传并发布」区域。任务保存名称、执行方式和有序的关联计划。发布平台、账号及相关条件由计划中心的发布节点配置。
- 发布任务按保存顺序执行各个计划。全部成功后记录「关联计划已全部完成」。出现单项错误时记录原因后继续推进。番茄、腾讯平台和汽水等计划节点继续由原执行器处理，平台条款由用户确认。[关联计划失败处理](./2026-11-20-publication-plan-error-isolation.md)
- 同版本计划已经按对应的发布授权运行时，任务关联该次执行并等待结果。停止任务只停止由它启动的未完成计划。
- 旧任务的历史和已登记的投稿回执仍可读取及核对。旧任务首次改用关联计划中的发布节点时，需在编辑任务中确认后保存。已经启动的关联计划沿用它的执行快照。新任务及编辑后的任务采用只有「关联计划」步骤的格式。

## 涉及文件

- 任务格式和历史兼容在 `src/shared/publication-tasks.ts`。
- 关联执行、原投稿回执和计划授权在 `src/core/publication-tasks.ts`、`src/core/publication-task-integration.ts` 和 `src/core/plan-center/index.ts`。
- 表单、列表和样式在 `src/renderer/components/PublicationTaskEditor.tsx`、`src/renderer/pages/PublishCenter.tsx` 和 `src/renderer/publication-tasks.css`。
- 回归覆盖在 `tests/publication-tasks.test.mjs`、`tests/plan-workflow-refactor.test.mjs`、`tests/simple-publishing-ui.test.mjs` 和 `tests/platform-management-ui.test.mjs`。

## 验证与回退

- TypeScript 检查及 55 项定向自动测试通过，覆盖关联计划保存、顺序执行、继承计划发布配置、已有执行复用、停止与回执核对。番茄与汽水节点使用隔离夹具，任务完成后只存在计划自己的发布记录。
- 使用原 BAT 的构建模式完成 React、Core、Windows Main 和预加载构建。无头 Chromium 加载实际构建并连接隔离 SQLite，验证新建、打开旧任务编辑、选择顺序、保存和完成状态。Windows 原生窗口与真实平台投稿待验收。
- 浏览器沿用原 `Start-Rainfall-Browser.bat`。数据库表沿用当前版本。回退时使用升级前的库备份在隔离环境验证，旧运行包按桌面交付策略保留。
