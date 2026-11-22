# 计划中心评分阻塞恢复

2026-11-21

「日藏歌曲」的第 1 首在作词阶段两次因 `LYRIC_REVIEW_INVALID` 阻塞。最近一次保存了 4 稿，前 3 稿已有评分，第 4 稿等待重新评分。这个错误码覆盖 JSON、字段和稿件匹配校验。历史作词任务只保存了错误码，无法还原模型当时返回的具体错误字段。

离线复现表明，旧评分要求模型原样返回内部稿件 ID，三项评分数据正确时也会因缺少该 ID 被拒绝。旧重试路径会为格式失败的阶段重新请求首稿。

## 调整

- `src/core/lyric-writing.ts` 在领取评分请求时保存请求和稿件的绑定。模型只需返回分数、语种核对结果和评审意见。结果入库前校验本地绑定及评分数据，兼容旧格式中匹配的稿件 ID。
- `src/core/plan-workflow.ts` 为确定已结算的评分格式失败找到当前计划项的原作词任务。重试从该任务保存的待评稿开始，保留已有分数、目标与剩余改写次数。原尝试和费用仍可查。账号、艺人、模型、预算和尝试次数沿用现有校验。
- `src/shared/lyric-writing.ts`、`src/renderer/components/PlanLyricReview.tsx` 和 `src/renderer/pages/PlanCenter.tsx` 增加评分错误细分与续跑确认。新记录在作词评分详情显示错误类型，保存的诊断只包含分类。列表和详情均可确认「重新评分（按服务计费）」。

## 验证

- `tests/lyric-writing.test.mjs` 与 `tests/plan-workflow-refactor.test.mjs` 共 57 项通过，覆盖漏写 ID 的有效评分、错误 JSON 和字段、稿件错绑、旧计划使用已保存稿续跑。
- 同级隔离目录的计划中心回归通过 28 项。`tests/plan-workflow-ui.test.mjs`、`tests/lyric-writing-ui.test.mjs`、`tests/browser-studio.test.mjs` 共 5 项通过，覆盖取消确认与定向重试。TypeScript 检查及同一 `Start-Rainfall-Browser.bat -BuildOnly` 构建通过。
- 浏览器与 Windows 共用 Core 和界面。以只读方式取得当前计划所需记录，在独立内存库分别用 Node 和 Electron 的 Node 模式验证。两端均从第 4 稿发起模拟评分，保留前 3 稿评分与历史，模拟评分通过后进入音乐生成阶段。
- 真实文本和音乐服务、Windows 原生窗口及正式包交付待验收。本轮对真实作品库仅做只读查询。

## 使用与回退

- 用同一浏览器入口打开新版，在「日藏歌曲」点「立刻执行」，核对续跑和服务费用提示后点「重新评分」。本次仍使用原计划已有的执行快照。
- 回退本轮所列源码与对应测试差异后重建。评分诊断为可选字段，既有记录可继续读取。
