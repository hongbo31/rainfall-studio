# 账号管理的艺人信息

2026-11-20

## 改动原因与行为

- 账号管理按左侧选中的账号展示「艺人信息」。新增和复制的档案归入该账号。旧档案可以用「关联已有艺人」选择归属，继续使用原来的艺人 ID。
- 每行提供「复制」。副本有独立 ID 和可区分的名称，继承艺人资料、创作默认值和提示词关联。重复请求返回同一副本。
- 新增和编辑在右侧面板进行。声线人设使用与普通字段接近的高度，仍可保存多行内容。账号详情中移除了「平台配置」按钮。
- 一位歌手用于 A、B 两版的默认署名，两位歌手分别对应 A、B 版。新计划将署名记录在现有艺人快照的默认值中。作品详情和发布版本选择显示对应歌手，发布准备优先采用用户已填写的署名。歌手配置用于分配署名，声线生成沿用当前模型请求和创作任务的设置。
- 账号归属和第二位歌手作为可选数据保存，SQLite schema 仍为 3。旧单人档案适用两版共用的默认行为。计划选艺人时按账号筛选，同时兼容尚未关联的旧档案。

## 涉及文件

- 账号数据和校验 `src/core/account-local-artists.ts`、`src/core/studio.ts`、`src/shared/local-artist.ts`、`src/shared/schemas.ts`。
- 账号与艺人界面 `src/renderer/pages/PlatformAccounts.tsx`、`src/renderer/pages/Accounts.tsx`、`src/renderer/components/LocalArtistCreator.tsx`、`src/renderer/components/ArtistProfileFields.tsx`、`src/renderer/account-style.css`。
- 创作和计划 `src/core/generation-config.ts`、`src/core/plan-workflow.ts`、`src/renderer/components/PlanWorkflowForm.tsx`、`src/renderer/components/CreationWorkspace.tsx`、`src/renderer/pages/LyricWriting.tsx`。
- 作品和版本署名 `src/renderer/pages/Track.tsx`、`src/renderer/components/PublicationMusicList.tsx`、`src/renderer/components/PublicationMetadataForm.tsx`、`src/core/simple-publication.ts`、`src/core/tme-ai-scope.ts`、`src/core/fanqie-work.ts`、`src/core/qishui-work.ts`。
- 回归测试 `tests/account-artists-ui.test.mjs`、`tests/prompt-library.test.mjs`、`tests/configuration-ui.test.mjs`。

## 验证和回退

- 浏览器端从原 BAT 完成后台构建。用刚构建的 Electron 浏览器服务、无头 Chromium 和隔离 SQLite 验证两账号切换、右侧新增双歌手档案、复制及保存结果。源码无头测试另覆盖右侧编辑、旧档案关联和声线人设高度。
- Windows 客户端完成共享渲染、Main、预加载和 Core 的构建，并用 Electron 的 Node 模式通过 11 项艺人及旧数据兼容测试。原生窗口与正式桌面包待验收。
- 类型检查和 24 项定向测试通过，计划中心 28 项测试通过。另跑的 32 项配置及发布准备测试中有两项腾讯条款的设置记录计数断言失败，`TME pending terms require exact work/A/account proof` 与 `official pending terms survive absent OAuth mapping`，已在改动前的同一运行环境复现。验收使用测试账号和隔离库，实际模型生成及平台操作待对应环节验收。
- 如需回退，先备份作品库，再在本轮涉及的文件中撤回本轮改动。旧版保存艺人档案按旧格式重写记录。包含账号归属或第二位歌手的档案宜在恢复本轮版本后继续编辑。
