# 发布中心移除平台记录区块

2026-11-20

- 按截图移除发布中心任务列表下方的「平台处理与投稿记录」，同时移除任务记录里跳转到该区块的「查看平台处理」按钮。发布任务的查询、新建和逐项执行记录继续在发布中心使用。现有投稿和账号数据保存在原有数据格式中。
- `src/renderer/pages/PublishCenter.tsx` 删除区块、筛选状态和跳转。`src/renderer/publication-tasks.css` 删除区块专用样式。浏览器发布台与 Windows 客户端共用该页面。
- `tests/publication-scope-ui.test.mjs` 和 `tests/fixtures/publication-scope-ui.tsx` 验证浏览器和 Windows 共用页面在已有番茄账号和投稿数据时均移除该区块，以及任务列表、新建入口和执行记录可用。发布相关的 27 项定向测试与 TypeScript 检查通过。
- 实际浏览器服务在隔离库通过无头验收，核对保存番茄测试账号后发布中心的任务列表和新建任务入口。Windows Main、Core、预加载和共享界面构建通过，Windows 原生窗口待验收。
- 回退时恢复共用页面的区块、专用样式和对应测试，再重新构建。既有数据沿用当前格式。
