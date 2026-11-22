# 账号管理的艺人权重

2026-11-22

账号管理的「新增艺人信息」和「编辑艺人信息」在音色下方提供「音色权重」与「风格权重」。两个字段分别填写 0–100 的百分比数值，可用小数。留空表示未设置，输入 0 会保存为有效数值。

- `src/renderer/components/ArtistProfileFields.tsx` 负责输入、保存转换和回显。复制艺人或复制上一位资料时会带出已保存的权重。谱乐 AI 共用的艺人资料区域以只读方式显示已设置的值。
- `src/shared/local-artist.ts` 校验艺人档案中的可选权重，现有保存流程沿用 SQLite 的记录结构。既有艺人档案缺省显示为空。
- `tests/account-artists-ui.test.mjs` 和 `tests/prompt-library.test.mjs` 验证新增、编辑、回显、清空、复制和范围校验。

## 验证与回退

- 在同级构建目录 `verification/artist-weights-6c048c44` 运行 65 项账号、艺人、计划和归档回归及 1 项旧艺人档案兼容集成测试，均通过。
- TypeScript 检查和 `scripts/Start-Rainfall-Browser.ps1 -BuildOnly` 通过，核对了快照源码及 Windows 共用 Main、Core、预加载和渲染层的构建文件。界面通过无头浏览器验证，Windows 原生窗口待验收。
- 回退前备份作品库和计划记录，在隔离库检查旧版读取带权重档案和计划快照的行为。
