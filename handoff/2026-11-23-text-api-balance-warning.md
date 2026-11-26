# 2026-11-23 AI 作词 API 余额不足提示

## 原因

用户反馈 AI 作词长时间显示“结果未知，待对账”，本次原因实际为文本 API 账户余额/可用额度不足，导致接口不可继续访问。旧逻辑在核对 usage 字段时先于 HTTP 错误分类；余额错误响应通常没有 usage，于是错误地显示为用量未知。

## 改动

- `src/core/workflow/provider-text.ts`：在 usage 校验前识别 HTTP 402，以及明确的余额/额度错误码或错误消息，使用稳定原因码 `TEXT_PROVIDER_CREDITS_REQUIRED`。不记录或展示完整供应商错误正文。
- `src/renderer/plan-execution-labels.ts`：提供直接说明余额/可用额度不足、作词停止，并提示充值/提高额度及检查文本 API 配置的文案。
- `src/renderer/components/PublicationTaskProgress.tsx`、`src/renderer/pages/PlanCenter.tsx` 与对应 CSS：任务中心和计划中心对该原因码显示醒目错误及打开配置中心核对文本 API 的操作按钮。
- `docs/project/board.md`、`handoff/PROJECT-HANDOFF.md`：记录 RF-017 交付状态及验证范围。

## 影响

明确返回余额或额度错误时用户可以直接看到原因与下一步。普通网络异常和 `TEXT_USAGE_UNKNOWN` 不会被判成余额不足，仍按结果待核对处理。该识别只针对供应商明确返回的余额信号，不从超时或一般错误推断欠费。

## 验证

静态审阅错误分类顺序和共享原因码映射；按仓库 CRLF 文件格式执行 `git -c core.whitespace=cr-at-eol diff --check` 通过。未运行自动化测试、构建或浏览器/Windows 原生界面验收。

## 未验证及后续

尚未用真实供应商的余额不足响应验证错误体格式，也未在运行界面确认按钮跳转。后续可用脱敏的供应商错误样本补充映射，再进行无头或原生界面验收。

## 回退

回退本轮后端原因分类、任务/计划中心文案及样式改动，并同步移除本交接、RF-017 台账行和项目交接索引。不要修改已有运行记录或重新提交生成任务。
