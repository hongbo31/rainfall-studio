# 侧栏的计划中心与发布中心顺序

2026-11-20

- 按截图调整共用侧栏顺序。`src/renderer/main.tsx` 将「计划中心」和「发布中心」依次放在「平台管理」之后。浏览器和 Windows 客户端使用同一份导航顺序。
- 在 `tests/platform-management-ui.test.mjs` 增加侧栏相邻顺序断言。平台管理与计划工作流的 3 项无头回归通过，覆盖侧栏、打开页面和任务入口。
- TypeScript 检查及 `Start-Rainfall-Browser.bat -BuildOnly` 构建通过。无头 Chromium 加载实际构建，核对三个入口相邻、依次可打开并显示选中样式。Windows 原生窗口待验收。
- 浏览器继续使用原启动 BAT。回退时撤销本轮的导航顺序和对应断言，再使用相同入口构建。
