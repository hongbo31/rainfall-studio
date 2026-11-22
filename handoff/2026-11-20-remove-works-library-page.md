# 作品统一从创作中心进入

2026-11-20

创作中心已有作品列表。删除独立「作品库」侧栏入口、页面、专用样式和列表专用的状态汇总。总览的「整理已有作品」「查看全部」以及腾讯资料工具的作品入口都指向创作中心。原有作品、草稿、资产、系列和发布记录继续使用现有数据格式。

创作中心补齐了未绑定创作任务且尚无音频的旧作品。带音频的作品仍按 A、B 版显示并可直接试听。打开版本详情后可进入「作品资料」查看整首作品、导入素材和准备发布。列表支持按歌名、风格或故事搜索。「多选」对同一作品只勾选一次，支持全选筛选结果和批量发布。批量发布沿用现有的发布准备与预检入口。总览的「管理系列」读取这批勾选作品的曲序，可保存新系列。

## 涉及文件

- `src/renderer/main.tsx` 删除页面路由和侧栏注册。移除 `src/renderer/pages/Library.tsx`、`src/renderer/library.css` 和 `src/renderer/publication-status.ts` 中的独立列表汇总。
- `src/renderer/components/CreationWorkspace.tsx`、`src/renderer/pages/ChatCreation.tsx` 和 `src/renderer/creation-workspace.css` 更新作品列表、版本详情、搜索和多选。`HelpNote.tsx`、`HelpHint.tsx` 在关闭帮助提示时让详情保持打开。
- `src/renderer/pages/Overview.tsx` 移入系列管理并更新查看入口。`Track.tsx`、`ConfigurationCenter.tsx`、`QuickPublish.tsx`、`TmeDraftStudio.tsx` 和 `TmeLiveStudio.tsx` 更新作品选择及发布准备跳转。浏览器工作台和 Windows 客户端共用页面和数据。
- `tests/creation-work-detail.test.mjs`、`tests/ui-copy.test.mjs`、`tests/fixtures/ui-copy.tsx` 和 `tests/publication-music-list.test.mjs` 更新回归覆盖。调整原来依赖作品库导航的 QA 脚本，使用 `scripts/lib/open-creation-work.mjs` 从创作中心定位作品。

## 验证与回退

- 27 项定向自动测试通过，覆盖作品库入口移除、旧草稿、A/B 试听、完整详情、多选、发布准备和按勾选顺序保存系列。用隔离样本和构建后页面通过 18 项无头界面检查，覆盖不同窗口宽度。已调整的 12 个 QA 脚本通过语法检查。
- TypeScript 检查和 `scripts/Start-Rainfall-Browser.ps1 -BuildOnly` 通过。Windows Main、预加载、Core 和共用渲染层构建通过。原生窗口及相应桌面 QA 脚本待验收。验证期间使用隔离库及网页夹具。
- 回退时只撤回本次页面、样式、脚本及测试改动，再用现有预览入口重建。无需迁移数据库。桌面切换按既有验收策略执行。
