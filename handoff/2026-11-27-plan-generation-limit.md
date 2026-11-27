# 2026-11-27 计划中心歌曲生成次数上限

## 原因与影响

新建及编辑计划的表单和 Core 保存校验各自限制在 20 次。现在歌曲生成次数接受 1 到 100 的整数，默认 1 次。输入超出范围或含小数时，工作流程表单在保存按钮上方提示有效范围。执行沿用已保存的次数逐轮创建记录。

## 涉及文件

- `src/shared/plan-center.ts` 定义生成次数和对应素材 ID 数量的共同上限，供计划保存、执行快照和前端校验使用。
- `src/renderer/components/PlanWorkflowForm.tsx` 在新建和编辑表单使用同一校验并显示错误提示。
- `src/renderer/pages/PlanCenter.tsx` 让旧式编辑表单的「独立歌曲数量」使用相同上限。
- `tests/plan-workflow-ui.test.mjs` 和 `tests/plan-workflow-refactor.test.mjs` 覆盖表单和 Core 的上限。

## 验证

- Windows 上的无头浏览器验证了新建和编辑保存 100 次，以及 101、0 和小数的输入校验。
- 隔离 SQLite 库验证了 100 次的保存回读、拒绝 101 次，以及启动时创建第 1 到第 100 轮记录。
- `Start-Rainfall-Browser.bat -BuildOnly` 成功构建共享界面及 Windows Main、preload、Core。相关代码差异检查通过。
- 扩大回归后，计划中心 28/30、工作流程 56/65、无头界面 3/4 通过。用修改前的源码和测试在隔离副本复测，失败用例一致。全量 TypeScript 的 8 条诊断也与修改前一致。
- 真实歌曲生成和 Windows 原生窗口待验收。本机未找到 `verified-desktop.json`，桌面入口未切换。

## 回退

只还原本轮变更。低版本的 20 次校验会拒绝含有 21 到 100 次的计划或执行快照。使用旧版前须在隔离副本核对兼容性，保存包含新计划及执行记录的数据副本供新版继续使用。
