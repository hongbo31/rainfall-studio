# 弹窗关闭按钮固定在顶部

计划编辑原先由整个弹窗处理滚动，标题和「关闭」会随表单移出可视范围。现在标题栏单独布局，表单、节点配置和记录在下方独立滚动。用户在长表单底部也可以直接关闭。

## 改动范围

- `src/renderer/ui-system.css` 提供共用的弹窗标题栏和滚动正文布局。标题可换行，右侧关闭按钮保留操作尺寸。正文滚到边缘时在本窗口内处理滚动。
- `src/renderer/components/PlanWorkflowForm.tsx`、`src/renderer/pages/PlanCenter.tsx` 和 `src/renderer/plan-center.css` 覆盖新建、编辑、旧版计划及计划详情。切换执行记录时正文回到顶部。
- `src/renderer/pages/PublishCenter.tsx`、`src/renderer/components/PublicationTaskEditor.tsx`、`src/renderer/components/PublicationPlanPicker.tsx` 和 `src/renderer/publication-tasks.css` 覆盖任务编辑、执行记录和关联计划弹窗。
- `src/renderer/components/PlatformAutomationPanel.tsx`、`src/renderer/components/TextAutomationDialog.tsx` 和 `src/renderer/platform-management.css` 覆盖平台执行、歌曲制作与执行记录、图像模型和模型配置等右侧窗口。
- 变更范围为浏览器与 Windows 共用的前端布局。艺人编辑和作品详情已有顶部关闭栏，本轮将其加入滚动验证。

## 验证与回退

- 同级构建目录的隔离副本通过 TypeScript 检查和 12 项定向测试。测试从正文顶部滚到中段和底部，核对按钮位置及指针命中，再直接点击关闭。覆盖截图对应的苏诺之音计划编辑、计划详情、番茄目录上传、文本调试、任务记录和编辑、关联计划、艺人编辑及作品详情，并检查紧凑窗口布局。
- `scripts/Start-Rainfall-Browser.ps1 -BuildOnly` 通过 Windows 主进程、预加载、Core 和共用界面构建。浏览器交互已无头验证，Windows 原生窗口待验收。
- 回退时撤回本记录列出的布局改动以及 `tests/fixtures/pinned-close.mjs` 和对应测试断言，再用原启动入口重建。
