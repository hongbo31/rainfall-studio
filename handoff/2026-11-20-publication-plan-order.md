# 发布任务的关联计划选择与顺序执行

日期：2026-11-20

后续发布设置见 [发布任务沿用关联计划的发布节点](2026-11-20-publication-by-linked-plan.md)。

## 原因与改动

原来新建任务会把所有计划直接列在表单里，任务启动时也会同时发起所有关联计划。发布中心现在通过「选择关联计划」打开独立窗口，可以按计划名或艺人搜索、多选，并用上移、下移调整执行顺序。初始顺序按勾选先后，确认后主表单和任务列表按同一顺序显示。同名计划会显示艺人、更新时间或短标识供区分。取消或按 Esc 会丢弃本次选窗内的改动，焦点回到入口。

发布任务按启动时保存的计划顺序推进。当前的单项失败处理和任务结算见[关联计划失败处理](./2026-11-20-publication-plan-error-isolation.md)。发布配置由关联计划的发布节点提供。账号核对、投稿去重和条款确认沿用各发布流程。任务停止时停止由它启动且未完成的关联计划。

## 涉及文件

- 渲染：`src/renderer/components/PublicationPlanPicker.tsx`、`PublicationTaskEditor.tsx`、`src/renderer/pages/PublishCenter.tsx`、`src/renderer/publication-tasks.css`。
- 执行与数据：`src/core/publication-tasks.ts`、`src/core/publication-task-integration.ts`、`src/shared/publication-tasks.ts`。
- 回归：`tests/publication-tasks.test.mjs`。任务原有的有序 planIds、启动快照及已经关联的运行记录继续使用，无需迁移。

## 验证与交付

- TypeScript 检查通过，35 项相关测试通过。覆盖反向选择顺序、服务重新实例化后续跑、早期计划失败或无作品时停止、上传只入列一次、平台条款状态与停止规则。
- 共用 React、Electron Main、Core 和预加载已通过后台构建。使用实际构建页面、浏览器桥接和隔离 SQLite 验证搜索同名计划、多选、上下排序、键盘取消与焦点恢复、小窗口布局、保存顺序和最后统一登记上传。所有平台动作接的是本地夹具。
- 未启动 Windows 原生窗口，未更换桌面入口，也未触发真实生成、上传或条款确认。浏览器继续使用原有 `Start-Rainfall-Browser.bat`。

## 回退

仅撤回上列文件的本轮改动，再使用先前已验证入口。若切回旧版，旧程序仍可读取任务顺序，但旧执行逻辑会并行启动计划。切换前先确认没有需要保留在当前版本继续执行的任务。
