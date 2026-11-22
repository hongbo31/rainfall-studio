# 计划中心删除已阻塞计划

## 改动与影响

- 计划列表、详情和删除确认都允许删除按现有规则可以立即停止的「已阻塞」计划。确认窗口会说明本次执行将停止。正在执行、停止中或有待核对操作的计划沿用原有保护。界面改动在 `src/renderer/pages/PlanCenter.tsx`。
- `src/shared/plan-center.ts` 将现有停止规则提供给界面和 Core。该规则覆盖阶段请求、投稿回执和专辑操作，并允许取消可停止的本地阶段。
- `src/core/plan-center/index.ts` 在同一事务中核对计划版本、停止阻塞的执行，再移除计划定义和调度游标。遇到无法立即停止的执行时会回滚。`src/core/plan-center-integration.ts` 让删除和现有停止入口共用子任务停止逻辑。保留作品、执行快照、阶段证据和投稿回执。

## 验证

- `tests/plan-workflow-refactor.test.mjs` 验证结果未知时拒绝删除，核对完成后可直接删除，版本冲突时保留原状态，以及删除后保留作品和执行证据。`tests/plan-workflow-ui.test.mjs` 覆盖阻塞行、详情的删除按钮和取消、确认。
- 计划工作流、界面、发布任务和作词回归共 56 项通过。隔离构建中的计划中心引擎回归 28 项通过。TypeScript 检查和 `Start-Rainfall-Browser.bat -BuildOnly` 通过。
- 无头 Chromium 通过构建后的本地浏览器桥接和独立 SQLite 库验证取消、确认及列表移除。Windows 随包 Electron 在 Node 模式用实际 Core 验证停止和删除。两端重开隔离数据后都能读到原作品和执行记录。验证记录在同级构建目录 `blocked-plan-qa-b23a3216`。
- Windows 原生窗口待验收。

## 使用与回退

沿用 `Start-Rainfall-Browser.bat`。在计划中心对可以结束的「已阻塞」计划点击「删除」并确认。回退时撤销本次四个源码文件和两处回归用例的改动即可。数据库使用既有执行状态及计划删除记录格式。
