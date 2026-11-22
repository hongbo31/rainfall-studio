# 艺人信息的 A/B 歌手与共用音色

## 改动

- `src/renderer/components/ArtistProfileFields.tsx` 在双歌手档案中显示 A 版和 B 版歌手姓名。档案共用一组「性别」和「音色」，「音色」沿用原声线字段的数据。
- `src/renderer/components/PlanWorkflowForm.tsx` 在计划摘要和编辑页显示各版歌手姓名及共用性别，高级设置使用「音色」。
- `src/shared/local-artist.ts`、`src/shared/plan-center.ts` 和 `src/core/account-local-artists.ts` 保持旧档案与历史计划的读取兼容。旧档案以原 A 版性别和音色作为共享值。重新保存、复制和冻结新计划时，B 版字段保存姓名。历史计划快照按原形状读取，A/B 署名和归档继续使用各自歌手姓名。

## 验证

- 在同级隔离目录 `artist-shared-timbre-9635d303/source` 完成 53 项测试。无头浏览器验证艺人编辑、复制和计划摘要，Core 验证旧字段兼容、共享设置保存、历史快照读取及 A/B 音频归档。
- 浏览器和 Windows 共用同一渲染层与 Core。TypeScript 检查、Windows Electron Main、Core、预加载和渲染层构建通过。原生窗口与正式桌面交付尚未验收，验证使用隔离夹具。

## 回退

撤销上述源码改动及 `tests/account-artists-ui.test.mjs`、`tests/plan-workflow-ui.test.mjs`、`tests/plan-workflow-refactor.test.mjs`、`tests/prompt-library.test.mjs` 内本次调整。旧版可继续读取姓名字段。已重新保存档案的原 B 版独立设置需从保存前的备份恢复。
