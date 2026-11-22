# 发布任务的合同选项

2026-11-21

发布中心的新建和编辑任务表单增加「是否签署合同」，手动和定时任务都可以选择「是」或「否」。新任务先选择再保存。编辑时回显已保存的选项，执行记录保留当次选择。缺少该字段的旧任务沿用合同准备流程。

番茄音乐选「是」时，上传后按账号配置准备合同，最终签署由本人确认。选「否」时，核对到上传回执后结束番茄步骤，保留平台「待授权」状态并跳过合同准备。该回执作为上传记录，统计时与已投稿的回执区分。腾讯和汽水的合同与平台条款通过对应的本人确认流程处理。

## 涉及文件

- `src/renderer/components/PublicationTaskEditor.tsx` 和 `src/renderer/pages/PublishCenter.tsx` 提供下拉框、已保存选项和执行记录展示。浏览器工作台与 Windows 客户端共用界面。
- `src/shared/publication-tasks.ts`、`src/shared/plan-center.ts`、`src/core/publication-tasks.ts`、`src/core/publication-task-integration.ts` 和 `src/core/plan-center/index.ts` 验证并保存任务选项，将当次选择传入关联计划。同一正在执行的番茄计划使用不同的签约选项时保留原有执行作用域。
- `src/core/plan-workflow-publication.ts`、`src/core/publication-queue.ts`、`src/core/plan-fanqie.ts`、`src/main/fanqie/plan-publisher.ts` 和 `src/main/fanqie/upload-broker.ts` 传递番茄合同选项，校验上传回执，按设置准备或跳过合同。作业沿用原去重和对账流程。
- `tests/platform-management-ui.test.mjs`、`tests/plan-workflow-refactor.test.mjs`、`tests/fanqie-upload-broker.cjs` 增加回归覆盖。`scripts/test-plan-fanqie.mjs` 与 `tests/plan-fanqie.test.cjs` 为已有封面测试配置隔离下载目录及测试账号。

## 验证与回退

- 51 项发布任务、界面及桥接测试通过。番茄 95 项离线测试、15 项无头浏览器测试和 16 项计划番茄测试通过。其中覆盖选项保存回显、跳过合同的上传回执、回执未知时的拦截和同一计划的去重。
- TypeScript 检查及 `scripts/Start-Rainfall-Browser.ps1 -BuildOnly` 通过，构建了浏览器及 Windows 共用的 Main、预加载、Core 和渲染层。测试使用隔离库和模拟回执。实际平台操作与 Windows 原生窗口待验收。
- 数据库表结构沿用现有版本。旧版执行快照校验早于该字段，回退前需用对应备份在隔离库验证，再按桌面验收策略切换。
