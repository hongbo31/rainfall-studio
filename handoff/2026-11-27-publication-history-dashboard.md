# 数据看板发布记录

2026-11-27（北京时间）

## 界面

数据看板的主区是「歌曲上传记录」。每首记录显示歌名、发布平台、账号、歌手、提示词引擎、状态和时间。列表按北京时间倒序分日，支持「今天」、选择历史日期、独立组合筛选和分页。看板可见时约每 8 秒读取一次，打开页面、恢复可见或点击「刷新记录」也会重新读取。播放、收藏和评论仍在折叠的「CSV 指标报表」中。

## 回执与数据

- 番茄读取账号专属的单首、目录批次和计划回执。批次后续步骤出错时，已有独立官网回执的歌曲仍会入表。同一官网作品 ID 的明细只计一次，状态更新沿用原上传日。
- 腾讯读取绑定作品的客户端投稿回执和已有官网回执，按官网歌曲记录合并。明确关联的 QQ 音乐和酷狗渠道可参与平台筛选，页面保留腾讯发行主体和回执状态。
- 汽水读取计划中用户已确认的投稿。旧版通用发布模块已保存的用户回报也可见，表格在相应状态下标注「用户记录」。待授权、已投稿、审核中、已上架、审核未通过和已下架按各自状态显示。
- 提示词引擎优先取上传时记录的目录引擎、计划快照或作品已保存的归档。旧记录可从账号、歌手与归档目录的对应关系补齐。历史资料不足时相应字段显示「—」。只有本地确认时间时标注「记录时间」，没有日期时归入「日期待核对」。

同步范围为软件内已有回执和确认记录。实际官网状态随发布自动化及既有核对入口写入的回执更新。查询为只读，使用原有 SQLite 表和账号目录，附加元数据兼容旧记录。目录引擎通过附加字段传递，现有上传和素材校验指纹继续使用原字段。

## 涉及文件

- `src/core/publication-history.ts`、`src/core/fanqie-publication-history.ts`、`src/core/studio.ts` 和 `src/shared/publication-history.ts` 负责汇总、去重、日期和筛选，并通过共用的 `publish.history` 方法返回展示字段。请求校验和离线验收许可分别在 `src/shared/schemas.ts` 与 `src/shared/offline-acceptance.ts`。
- `src/core/fanqie-downloads.ts`、`src/core/download-archive.ts`、`src/main/fanqie/directory-run.ts`、`src/main/fanqie/upload-broker.ts` 和 `src/core/plan-fanqie.ts` 保存或读取番茄首条回执时间、归档引擎。汽水确认时间及歌名由 `src/core/plan-workflow-publication.ts` 记录，类型在同名共享文件。
- `src/renderer/pages/Insights.tsx`、`src/renderer/components/PublicationHistory.tsx` 和 `src/renderer/publication-history.css` 提供浏览器与 Windows 共用界面。回归覆盖见 `tests/publication-history.test.mjs`。

## 验证与回退

- 在同级构建目录 `rainfall-studio-build/publication-history-20261127` 用临时库验证。看板及浏览器桥接 8 项通过，覆盖历史记录、同名多账号、跨北京时间日期、部分成功、重复回执、提示词引擎和已确认的汽水投稿。无头浏览器通过实际本地桥接验证了自动刷新、组合筛选和 CSV 入口。Windows Main、预加载、Core 与共用界面隔离构建通过。番茄计划回归 18 项、汽水流程及界面 6 项通过。
- 全量 TypeScript 检查在番茄目录、原生上传和计划文案中有 8 条原有诊断。目录与下载组的 27 个失败、番茄日志组的 2 个失败、计划工作流组的 9 个失败均在未修改的 Git 基线复现。测试日志位于隔离目录的 `output/`。
- 本机 `verified-desktop.json` 缺失，正式库回执完整性、原生 Windows 窗口和桌面入口切换待验收。本轮验证均使用临时数据和无头浏览器。回退时撤回本页所列查询、界面、测试及附加元数据写入相关源码后重建，保留已存回执和作品。
