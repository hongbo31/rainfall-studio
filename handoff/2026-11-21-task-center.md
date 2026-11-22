# 任务中心界面与执行详情

## 改动原因

任务列表原先只显示总结果和关联计划名称。遇到部分失败时，需要打开执行日志逐项查找。现在点击任务名称即可核对关联计划、执行状态和阶段失败原因。

## 界面和操作

- 侧栏、面包屑、页标题及项目内入口统一使用「任务中心」。任务页原有的「在浏览器打开」按钮已移除。
- 列表保留搜索、执行结果筛选、执行方式、关联计划和原有编辑操作。宽窗口显示表格，窄窗口改用分行布局，状态样式适配原主题和白色主题。
- 同时展开一项任务。未执行的任务按当前配置显示关联计划。已经执行过的任务展开本次或最近一次执行的计划快照，按当时的顺序展示。每个计划有独立状态，失败原因就地显示。可进一步展开该计划的阶段明细，或转到计划中心查看对应执行。
- 待执行时显示「立即执行」。执行中、等待计划或待处理时，同一位置显示「停止」，以当前执行记录 ID 调用原停止接口。停止结束本次任务的后续步骤。已有独立执行继续按原计划运行，已提交的操作按平台回执核对。后续定时执行按任务设置处理。

## 涉及文件与兼容

- `src/shared/publication-tasks.ts` 给 `publicationTasks.list` 增加可选的展开任务 ID。`src/core/publication-task-integration.ts` 只为选中的任务读取已关联的计划运行、各轮阶段和保存的失败原因。未展开时沿用原列表格式。执行与计划关联继续使用原有记录，历史任务无需迁移。
- `src/renderer/pages/PublishCenter.tsx`、`src/renderer/components/PublicationTaskProgress.tsx` 和 `src/renderer/publication-tasks.css` 实现列表、展开区域和执行按钮。`src/renderer/plan-execution-labels.ts` 提供任务中心和计划中心共用的阶段及状态说明。
- `src/renderer/main.tsx`、`src/renderer/pages/PlanCenter.tsx`、`src/renderer/pages/ConfigurationCenter.tsx` 和 `src/renderer/components/ProductionFlowWorkspace.tsx` 更新导航及相关说明。`src/renderer/pages/PublicationDiagnostics.tsx` 和 `src/renderer/pages/Track.tsx` 的返回按钮及试听说明调整到对应功能。浏览器与 Windows 客户端使用相同的页面和任务 RPC。
- `tests/publication-tasks.test.mjs`、`tests/simple-publishing-ui.test.mjs`、`tests/platform-management-ui.test.mjs`、`tests/publish-workbench.test.mjs` 增补了关联计划失败、停止后的执行记录、导航和浏览器交互覆盖。`scripts/e2e.mjs`、`scripts/test-ui-consistency-headless.mjs`、`scripts/test-theme.mjs`、`scripts/test-provider-directory-ui.mjs` 和 `scripts/lib/deep-copy-audit.mjs` 更新了导航名称。

## 验证结果

所有测试在源码同级 `rainfall-studio-build/task-center-bf9640e6/source` 内使用隔离库和合成记录执行。任务关联及阶段状态、改版后的历史快照、停止后的未执行计划都已在 Core 回归中核对。

| 范围 | 结果 |
| --- | --- |
| 任务、计划工作流与界面结构 | 55 项通过 |
| 浏览器 HTTP 会话与界面 | 6 项通过。使用构建后的页面验证展开、窄窗口、主题切换和开始、停止。预览在隔离目录的 `preview/` 中 |
| Windows 客户端共用页面 | 3 项无头界面测试通过，用 IPC 夹具核对侧栏、展开、停止与记录。TypeScript、Main、preload、Core、UI 构建和语法检查通过 |
| 番茄目录工作流 | 28 项模拟回归通过 |

## 交付与回退

浏览器从现有 `Start-Rainfall-Browser.bat` 启动时从当前源码构建。Windows 原生窗口尚未验收，桌面入口尚未切换。本轮执行和停止均使用合成任务夹具。

回退时撤回上述本轮源码、样式、导航和测试改动后重新构建。任务、计划及历史回执仍由原工作区读取。
