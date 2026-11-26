# 2026-11-24 计划中心立即执行行为修正

## 原因

计划列表遇到“blocked”最近运行时，按钮虽然显示“立刻执行”，点击事件却分支到 `openBlockedExecution`，只读取失败阶段并展示重试确认/执行详情，没有调用 `planCenter.run` 创建画布流程的新运行。这造成按钮文案和操作不一致。

## 改动

- `src/renderer/pages/PlanCenter.tsx`：移除 blocked 状态的按钮分支，点击“立刻执行”统一进入 `startExecution`，先预览、校验计划修订及摘要，再调用计划运行命令；成功后进入新运行详情查看进度。
- `src/core/plan-center/index.ts`：运行创建时沿用 `planRunBlocksDeletion` 的阻塞判定。旧运行若有派发中、等待/结果未知的阶段、发布回执或专辑绑定，仍阻止重复启动并返回活动运行 ID；纯 blocked 且没有未完成外部工作的运行不再阻止创建新的手动执行。
- 保留执行详情内对明确失败阶段的精确重试入口。

## 影响、验证与边界

“立刻执行”现在总是请求执行所选计划的当前画布。若旧 blocked 运行仍有未知或进行中的外部操作，系统仍打开该活动运行供核对，不会重复派发。此改动不自动解决旧运行，也不回放已提交作品。

未运行测试或构建，未做浏览器/Windows 原生验收。回归时需覆盖：blocked 且无未完成外部工作的计划可启动新 run；blocked 但存在 unknown/dispatching 的计划不重复启动；普通计划按钮执行画布且显示新 run 进度。

## 回退

恢复 `PlanCenter.tsx` 中 `blockedRun ? openBlockedExecution(...) : startExecution(...)` 分支，并在 `createRun` 恢复对任意 `planRunActive` 运行的一律阻止；同步恢复对应交接记录。
