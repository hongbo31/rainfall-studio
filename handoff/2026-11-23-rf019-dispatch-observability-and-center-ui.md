# 2026-11-23 RF-019 派发可观测与双中心异常提示

## 原因与范围

按 susu 授权，启动 RF-019 A-D MVP。目的是把“确定未发送”和“可能已发送、结果未知”分开，并让任务中心、计划中心说明异常原因及安全下一步。没有改自动重试、同计划并发或用量未知后的付费下游策略；这些仍待用户决策。

## 后端改动

- `src/core/workflow/yourmusic.ts`：HTTP 请求新增可选 `onDispatch` 标记；请求体完成本地序列化后、写出请求前触发。
- `src/core/workflow/provider-text.ts`、`src/shared/provider-text.ts`：增加 `confirmed_unsent`。凭证范围/格式错误、dispatch guard 拦截及网络请求发出标记前的准备失败返回确定未发送；发出标记后异常仍为 `TEXT_OUTCOME_UNKNOWN`。
- `src/core/provider-text.ts`、`src/core/lyric-writing.ts`：持久化确定未发送结果，将作词任务阻塞/停止，不计本次用量并释放对应 reservation；不会自动重试。旧记录 schema 无需迁移。
- `src/core/provider-text.ts`：明确的 `TEXT_PROVIDER_CREDITS_REQUIRED` 被优先持久化为余额拒绝（operation invalid、job blocked/stopped），不再因 usage 缺失回落成 unknown；释放本次 reservation。若响应包含模型匹配且可核验的 usage，先按现有计价记录实际用量，再释放预留。其他 invalid/usage 缺失仍沿用原状态处理。

## 前端改动

- `src/renderer/plan-execution-labels.ts`：共用任务/阶段状态文案，区分确定未发送、可能已发送待核对、用量待核对、平台已受理和明确余额不足。
- `src/renderer/components/PublicationTaskProgress.tsx`：任务卡突出待核对状态，提供查看同一 run 的核对详情入口；余额错误提供配置中心入口。
- `src/renderer/pages/PlanCenter.tsx` 与样式：阶段诊断折叠展示开始耗时、更新时间及已有脱敏外部 ID；unknown/平台回执文案区分原供应商任务核对与投稿平台核对。保留既有重试资格，不在本轮更改执行控制。
- 前端只读补充了旧记录回退（缺原因/来源/外部 ID 时显示“暂无原因记录/来源未记录/未记录”）、已保存 item 数量和更新时间；任务中心与计划中心都显示 execution source，投稿回执未知单独标注。保留原有 stage retry eligibility，没有改人工重试资格或冷却策略。
- 计划中心与任务中心对阻塞/失败记录缺少 reason 时显示“暂无原因记录”；旧数据只读呈现，不尝试补写历史原因。

## 影响与限制

- 只有 transport 的派发标记之前发生的错误才会标为 `confirmed_unsent`；标记后发生错误仍保留 unknown。该边界是本机“开始写请求”的保守标记，不证明远端已收到完整请求。
- 确定未发送时不计费/释放预留；明确余额拒绝时释放本次预留，若有可核验 usage 则先计入实际用量；派发后的其他未知结果不自动改写、不释放预留。
- 页面以明确余额 reason 优先于 unknown state 展示，避免同一条记录同时说“余额不足”和“请求可能已发送”。
- 任务中心阶段来源从同一 child run 的 `source` 投影，旧投影缺来源时显示“来源未记录”；真实投稿 `unknown` 显示平台回执核对提示。当前 publish attempt 状态 schema 没有 `not_found`，该状态只用于普通阶段 attempt。
- 任务卡只读投影已有状态与 reason；展开阶段明细时展示最新持久化的 stage/publish `updatedAt` 和由 Core 脱敏后的现存 ID，不伪造耗时或“最后核对时间”。计划中心只显示持久化字段。
- 仍无通用 AI 作词供应商回执核对工作流。并行 run、usage unknown 下游、重试/人工 reconciliation、超时升级按 RF-019 拆分等待决策。
- `not_found` 的人工重试副作用和统一重试策略仍待评审；本轮不改变既有资格，因此 UI/逻辑需要在后续决策中复核一致性。

## 验证

- 前后端定向静态审阅完成；指定变更文件的 diff 检查通过。
- 前端 TypeScript noEmit 仍报告 3 项既有远控模块依赖缺失（`reflect-metadata`、`@peculiar/x509`、`qrcode-generator`），本轮文件未出现在错误中。
- 未运行自动化测试、构建、无头 UI 或 Windows 原生验收；未调用真实 API、真实平台或正式数据。
- 手工验收设计见 [RF-019 验收清单](2026-11-23-rf019-task-plan-acceptance-checklist.md)。

## 后续与回退

- 完成 QA 清单对应的隔离验证和双端 UI 验收；检查旧记录兼容和焦点行为。
- 额外验收任务卡诊断的长/短/缺失外部 ID、无效时间戳、轮询刷新后展开态保持；展示时间是本地记录更新时间，不代表供应商最后核对时间。
- susu 决策 RF-019 E-H 后再派发对应改动。
- 回退时仅撤销本轮新增的 `onDispatch` 标记、`confirmed_unsent` 处理/类型和 renderer 提示/诊断，并恢复相关交接索引与台账状态。`yourmusic.ts`、任务中心/计划中心和交接文件已有其他未提交改动，回退必须保留非 RF-019 内容。
