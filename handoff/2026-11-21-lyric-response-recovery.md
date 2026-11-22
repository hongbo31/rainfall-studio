# 任务中心作词回复异常恢复

2026-11-21

## 原因

北京时间 22:42:54 启动的「素素每日任务」为「日常」创建了新的执行。第 1 首完成了首稿和评分，保存了通过语种核对的 76 分稿。首次改写在 22:43:33 以 `TEXT_RESPONSE_METADATA_INVALID` 失败，后两首仍等待前一首完成。「番茄音乐平台上传」随后执行，记录为下载目录无可上传歌曲。

这个错误来自文本服务完整回复校验。旧代码把 HTTP 状态异常、回复编号缺失和结束原因为非正常结束等情况归到同一个错误码。程序已按回传用量记账，历史只有错误码和累计用量，无法进一步还原原始结束原因。DeepSeek 文档说明了长度截断、服务中断和仅包含空白的 JSON 模式回复等情况。 [DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/) [DeepSeek JSON 输出](https://api-docs.deepseek.com/zh-cn/guides/json_mode/)

## 改动与影响

- `src/core/lyric-writing.ts` 在模型和用量已核对、HTTP 200 的前提下处理可恢复的回复异常。改写阶段会计入本次费用和改写次数，从已有的已评底稿继续。达到改写上限时可采用通过语种核对、评分绑定一致的最高分稿。首稿或评分阶段缺少可用结果时，同一作词任务在原预算内最多补调用一次。内容拦截、HTTP 异常及调用结果待核对沿用相应失败或待核对状态。
- 同一核心补充改写 JSON 示例。DeepSeek 确认输出截断时，下一次同阶段请求可在原预算内使用正常值两倍的输出上限。费用预留和实际用量校验仍以本次请求为准。新记录保存异常阶段、HTTP 状态、结束原因、是否有回执编号和输出用量，不保存异常回复正文。
- `src/shared/lyric-writing.ts` 增加可选诊断数据及可续跑的错误分类。`src/core/plan-workflow.ts` 对原有记录中的这类已结算失败保留稿件、评分、已用改写次数和目标，在原计划执行项创建新尝试。艺人、模板、模型配置、稿件绑定和原有重试次数校验继续生效。
- `src/renderer/pages/PlanCenter.tsx` 和 `src/renderer/components/PlanLyricReview.tsx` 在展开评分时显示模型回复诊断，按「继续作词（按服务计费）」确认后恢复原步骤。`src/renderer/plan-execution-labels.ts` 和 `src/renderer/pages/LyricWriting.tsx` 补充错误说明，任务中心和独立 AI 作词页都能显示具体原因。
- `tests/lyric-writing.test.mjs`、`tests/plan-workflow-refactor.test.mjs` 和 `tests/plan-workflow-ui.test.mjs` 覆盖截断、空回复、预算不足、保留拦截与未知状态、原稿续跑以及界面确认。

## 验证

所有构建和测试使用源码同级 `rainfall-studio-build/lyric-response-recovery-7a9c4819`。修复前离线复现了改写异常立即停止、首次评分空白后无法恢复、错误分类过宽，以及手动重试重新生成首稿。修复后 AI 作词、计划工作流和任务执行共 90 项通过，计划中心通用回归 28 项通过。

使用只读获取的 22:42 失败记录，分别在 Node 和 Electron 的内存库验证。两端均从原 76 分稿发起改写。模拟一次截断、随后改写成功时进入音乐提交准备。模拟缺回执和持续中断用完 5 次时采用原 76 分稿，也进入同一阶段。原作词费记录、任务历史和番茄计划记录保留。

浏览器使用原启动脚本的隔离 `-BuildOnly` 构建。浏览器 HTTP 和共用渲染无头测试共 8 项通过，含评分诊断、费用确认及任务中心操作。Windows 的 Main、preload、Core、渲染构建及语法检查通过，两端共用 TypeScript 检查通过。真实模型、音乐生成、正式上传和 Windows 原生窗口待验收。生产库仅查询，当前客户端和桌面入口保持现状。

## 恢复与回退

- 浏览器从原 `Start-Rainfall-Browser.bat` 下次启动时会从当前源码构建。在「计划中心 → 日常 → 详情」打开 11 月 21 日 22:42 的执行，对第 1 轮点击「继续作词（按服务计费）」。确认后沿用原首稿从改写开始。任务中心的已结束父任务保留当时的结果。
- 回退时撤回本轮所列源码和测试后重新构建。作词诊断为可选字段，无需迁移作品库或执行记录。客户端入口依既有验收流程切换。
