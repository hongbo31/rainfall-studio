# 将「本地音乐人」统一为「艺人信息」

日期：2026-11-20

## 改动与影响

创作中心、AI作词、计划工作流和配置中心统一使用「艺人信息」作为对应字段名称。同步调整作词模式、计划摘要、空状态按钮、错误提示、下载归档说明和番茄发行署名的无障碍文案。

- 字段与摘要：src/renderer/components/CreationWorkspace.tsx、src/renderer/pages/LyricWriting.tsx、src/renderer/components/PlanWorkflowForm.tsx、src/renderer/pages/Accounts.tsx。
- 提示与辅助标签：src/renderer/pages/PlanCenter.tsx、src/renderer/components/DownloadArchiveSettings.tsx、src/renderer/components/FanqieConfigurationPanel.tsx、src/renderer/components/AccountBinding.tsx、src/renderer/components/LiveTextWorkspace.tsx、src/renderer/components/LocalArtistCreator.tsx、src/renderer/context.tsx。

改动只涉及前端文案。艺人 ID、账号关联、作词模式值、历史计划和归档目录命名逻辑保持兼容。

## 验证

- 浏览器与 Windows 客户端共用的 React 渲染层、Electron Main、预加载及 Core 均已通过后台构建。
- 无头浏览器用隔离夹具打开创作中心、AI作词和新建计划，确认三个下拉框的可访问名称均为「艺人信息」，可以按原规则选择同一个艺人 ID；AI作词和计划表单显示「按艺人信息」。
- TypeScript 检查通过。浏览器桥接、作词、创作任务、艺人管理和提示词相关回归共 27 项通过。渲染源码中无「本地音乐人」和「本地艺人」旧词。
- 未打开 Windows 原生窗口，未进行正式桌面包验收，也未切换桌面快捷方式。验证未连接正式作品库或外部生成服务。

## 使用与回退

浏览器版用现有的 Start-Rainfall-Browser.bat 重新启动即可加载新文案。若需回退，仅恢复上面 11 个渲染文件中的本轮文案改动，再用同一入口构建。无需改动或迁移现有数据。
