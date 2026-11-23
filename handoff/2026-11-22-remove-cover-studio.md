# 移除独立封面工作室

2026-11-22

按用户要求删除侧栏「封面工作室」、对应页面和专用样式。独立页面的排版导出、提示词编辑和手动出图控件随页面退役。作品详情可直接导入或更换封面，A、B 版仍各自使用对应封面。历史计划的补图操作放在该次执行详情中，支持导入、选用和重试封面阶段。已停止的执行锁定补图操作。作品、封面和配置沿用现有存储格式。

## 涉及文件

- `src/renderer/main.tsx`、`src/renderer/ui-system.css` 移除导航、渲染分支和页面专用规则，删除 `src/renderer/pages/CoverStudio.tsx` 与 `src/renderer/cover-studio.css`。
- `src/renderer/pages/Track.tsx` 复用现有素材导入。 `src/renderer/components/PlanRunAssets.tsx` 与 `PlanCoverRecovery.tsx` 在计划详情处理补图。 `CoverInbox.tsx` 保留计划使用的专属封面接收目录和出图重试。
- `web/app.js` 同步移除旧网页原型中的独立页面，作品详情提供导入。 `package.json`、`scripts/` 与 `tests/` 更新导航与封面验证，撤下仅针对旧页面的检查。

## 验证与回退

- TypeScript 检查通过。使用 `Start-Rainfall-Browser.bat -BuildOnly` 构建了 Windows 主进程、预加载、Core 和两端共用的渲染层。
- 58 项定向测试通过，覆盖创作中心、平台管理、计划工作流、封面接收、歌词材料和浏览器桥接。用正式构建的渲染层通过 17 项无头界面检查。使用隔离 SQLite 验证了从最终歌词保存到补图、选用和重试完成的流程，以及停止后锁定写入。19 个更新的 JavaScript 文件通过语法检查。
- 验证使用隔离测试数据。Windows 原生窗口及桌面脚本待验收，桌面入口按既有验收规则更新。
- 回退时撤回本次文件改动，再用原浏览器启动入口重建。既有作品库可直接复用。
