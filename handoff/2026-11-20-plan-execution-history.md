# 计划中心的执行记录与手动执行

2026-11-20

## 操作

- 「计划中心」移除「高级选项」。每条计划的「操作 → 详情」显示执行总次数、每次执行的时间和结果。选择某次记录可查看歌曲、步骤状态、失败原因、材料和版本，并可返回记录列表。立刻执行后自动打开对应记录。
- 「操作 → 删除」会先显示该计划的名称供确认。执行中的计划要在详情里停止后续步骤，待执行结束后再删除。删除移除计划配置的列表入口，保留已有作品、材料和执行记录。
- 「新建计划」的「生成封面」与封面图片配置位于「工作流程」上方，默认勾选。编辑时沿用已保存的封面设置。工作流程连到发布节点时需要封面。
- 计划中心通过「立刻执行」启动。旧计划的定时字段和已发生的定时记录保留，新版本的计划中心到点时不创建执行。先前已开始的执行仍可查看和处理。发布任务以及目录的独立触发按原有规则调用计划。

## 涉及文件与数据

- `src/renderer/pages/PlanCenter.tsx` 和 `src/renderer/plan-center.css` 复用已持久化的每次执行和各步骤结果，按计划汇总，并将原页面底部的结果移入详情。迁移前记录在对应计划的详情内可查。`src/renderer/main.tsx` 保留从发布中心直接打开关联执行的入口。
- `src/renderer/components/PlanWorkflowForm.tsx` 调整封面区并移除表单里的定时设置。`src/renderer/components/AutomationRuntime.tsx` 是随高级选项移除的设置面板。
- `src/core/plan-center-integration.ts` 停止应用的计划中心定时触发并移除对应公开接口。`src/core/plan-center/index.ts` 和 `src/shared/schemas.ts` 保留旧数据的读取格式。数据库无需迁移，确认删除复用带版本检查的删除操作。
- `tests/plan-workflow-ui.test.mjs` 和 `tests/plan-workflow-refactor.test.mjs` 覆盖历史、封面默认值、删除、过期定时和手动执行。`tests/lyric-writing.test.mjs` 验证已保存的时间对旧数据仍可读。`scripts/test-plan-center-headless.mjs` 和 `tests/fixtures/plan-center-ui-host.cjs` 使用隔离 SQLite 运行实际界面。`scripts/check-automation-desktop.mjs` 通过现有接口核对后台运行设置。

## 验证与回退

- 64 项定向测试、28 项计划数据兼容测试和 8 项 SQLite 集成测试通过。隔离无头验收覆盖默认生成封面、确认删除、手动执行后打开结果、停止后回看记录，以及历史计划的 A/B 音频和封面材料。另通过实际浏览器桥接核对同一计划手动执行两次、逐条回看和删除后保留记录。
- TypeScript 检查通过。Windows Main、Core、预加载和两端共用渲染层完成隔离构建。Windows 原生窗口和真实服务调用待验收。桌面入口仍使用当前已验收的版本。
- 如需回退，撤回本次执行记录界面、封面位置和手动执行入口改动，再重新构建。旧版可能按库中原有的启用状态继续定时，切回前先在隔离库核对这些计划的启停配置。既有作品和本轮前后的执行记录沿用现有格式。
