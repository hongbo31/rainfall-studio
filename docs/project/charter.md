# Rainfall Studio 立项书

| 项目 | 内容 |
| --- | --- |
| 立项日期 | 2026-11-23，北京时间 |
| 项目负责人 | susu，管理团队、项目方向与优先级，决定正式验收及上线 |
| 项目经理 | xb，负责需求记录、派工、跟进、进度统计和交付汇报 |
| 工作区 | 现有 Rainfall Studio 源码仓库及 Codex 项目 |
| 当前工程基线 | 源码声明的版本为 `0.12.0-preview.14`，实际验证范围见相关交接记录 |

## 项目目标

持续完善 Rainfall Studio 的音乐创作和发布工作台。覆盖账号与艺人资料、作词、歌曲和封面、素材归档、计划与任务执行、平台发布及回执。浏览器预览和 Windows 客户端共用业务流程，已有作品库、配置和账号按交付约定保留。

## 团队

| 角色 | 主要交付 |
| --- | --- |
| [xb](../../.codex/agents/xb.toml) · 项目经理 | 需求记录、派工、项目台账和交付汇报 |
| [product](../../.codex/agents/product.toml) · 资深产品 | 业务流程、需求范围和验收条件 |
| [frontend](../../.codex/agents/frontend.toml) · 资深前端 | 页面、组件、交互和双端界面 |
| [backend](../../.codex/agents/backend.toml) · 资深后端 | 核心逻辑、数据、平台集成和执行状态 |
| [fullstack](../../.codex/agents/fullstack.toml) · 资深全栈 | 跨端功能和界面到数据的集成 |
| [qa](../../.codex/agents/qa.toml) · 测试 | 复现、回归、验收证据和质量风险 |
| [operations](../../.codex/agents/operations.toml) · 项目运营 | 发布准备、版本说明、反馈和试运行 |
| [data_analyst](../../.codex/agents/data_analyst.toml) · 数据分析 | 统计口径、异常分析和进展报表 |

## 协作与验收

1. susu 在「xb · Rainfall Studio 项目管理」告诉 xb 想法、优先级或当前问题。xb 登记原始需求和期望结果，梳理依赖与验收条件。
2. xb 从团队中按需调用角色。任务单包括 ID、负责人、目标、交付、文件或数据范围及验证方式。工作可以并行时，各角色拥有明确的修改范围。
3. Agent 向 xb 回报实际结果、证据、当前状态与阻塞。xb 更新台账并统计各状态数量。一个任务有多个协作者时按一个任务 ID 计数。
4. 可验收的变更同时记录验证结果、适用端、未验证项和回退方式。真实账号、收费、投稿、签约与正式交付按 susu 已明确的授权和仓库的交付约定执行。

项目状态统一从[项目台账](board.md)读取。团队在不同会话中继续工作时，先核对最新台账和对应交接记录。

项目约定见 [AGENTS.md](../../AGENTS.md)。桌面基线和验收见[桌面交付规范](../release/desktop-delivery-policy.md)。
