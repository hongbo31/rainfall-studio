# 任务中心关联计划：作词到歌曲生成耗时排查

日期：2026-11-24（北京时间）  
范围：只读日志与代码审计；未启动客户端、未重跑任务、未调用真实 API。

## 当前结论

尚不能从本机日志确认截图所示运行具体慢在哪个阶段。当前 `%LOCALAPPDATA%\RainfallStudioLauncher\verified-desktop.json` 不存在，无法按交付约定定位权威桌面数据根；源码和构建目录也没有这次运行的 `.log`、SQLite 数据库或执行记录副本。没有按猜测路径搜索或读取其他生产库。

代码审计确认以下可能性，但它们都不是本次运行的定论：

1. **AI 作词有多次串行模型调用。** 计划文本作业先生成、再评分；未达到标准时最多改写两轮并逐轮评分，因此基础路径最多约 6 次 API operation，评分/恢复重试还可能增加调用。主进程每 2 秒扫描一次队列，但一次 `adapter.invoke()` 会被 `await` 到完成，同一 broker 的 `busy` 锁也会让后续项等待。这是排队节拍，不代表每次请求固定多等 2 秒。
2. **“结果未知，待对账”会长期保留。** 请求发送后断线/超时等会被折叠为 `TEXT_OUTCOME_UNKNOWN`；本地没有通用供应商回执自动查询。状态刷新只读库，不会让请求继续或自行解除未知。因此很长的可见等待可能是状态未解决，不一定是模型仍在运行。
3. **歌曲生成与原 WAV 准备是后续阶段。** 谱乐 API 的生成 POST 请求超时为 120 秒。苏诺之音浏览器路线将生成等待设为 20 分钟，原 WAV 准备每轮 15 分钟且允许最多续等 3 次；A/B 版本按序处理。这类等待发生在作词之后，用户可能感知为“作词到歌曲生成”整个流程慢。实际关联计划使用哪条路线需由该次执行快照确认。

## 日志/持久化证据能力

- 计划阶段 attempt 和文本 job/operation 持久化有 `createdAt`、`updatedAt`、阶段/状态/原因等信息，可按时间排序估算阶段区间。
- operation 记录可能含 provider request ID、HTTP 状态和 usage；排障只应导出脱敏摘要，不能复制歌词、提示词或凭据。
- `updatedAt` 在状态变化时覆盖，当前没有充分的每请求入队、开始派发、收到响应、解析完成耗时事件；文本异常 catch 还会把具体异常归并为 `TEXT_OUTCOME_UNKNOWN`。所以现有记录能估总时长，但不能稳定拆开队列、HTTP 往返、评分/改写及页面等待各自用了多久。
- 仓库自带 `diagnostics/native-lifecycle.jsonl` 只记进程生命周期/崩溃，不记作词及歌曲步骤的业务耗时。

## 定位该次运行所需数据

恢复有效桌面指针后，只读读取截图对应 `runId/itemId` 的计划快照、阶段 attempt 时间线，以及绑定的 provider job/operation：只需 ID、stage/phase、state、createdAt/updatedAt、错误码、HTTP 状态、模型名、usage 是否可核验和脱敏 request ID。不要重试或补发未知作词/收费生成。由这些时间线即可先判定慢在作词请求、评分/改写、音乐提交还是原 WAV 等待。

## 建议方案

先补结构化、脱敏的阶段计时：分别记录 queued、dispatching、response received、validation complete，并在任务中心关联计划展开“当前子阶段/已耗时”；音乐浏览器路线额外记录 A/B 生成等待、WAV 准备和下载开始/完成。保持未知结果不自动重发。取到目标 run 时间线后，再按证据优化对应阈值或提供商路线，避免只盲目加长全局超时。

## 验证、限制与后续

- 两位同学分别完成运行日志可用性核查和代码调用链审计，未改源码，未运行测试或真实任务。
- 正式运行记录未读取，无法判定本次具体原因和实际耗时。
- 后续需取得当前有效 `verified-desktop.json` 指针或由用户导出的脱敏时间线后再完成本次根因归属。无需重放任务。
- 未修改执行代码，无代码回退项。

## 代码位置

- `src/core/provider-plan-text.ts`：计划作词 job 与阶段 attempt 关联、生成/评分推进。
- `src/main/provider-text.ts`：provider 调用、队列执行和 unknown 异常归类。
- `src/core/provider-text.ts`：作词 operation 持久化与生成/评分/改写状态转换。
- `src/core/workflow/yourmusic.ts`：音乐生成 API 超时。
- `src/main/suno-cn-browser-page.ts`：苏诺之音网页生成、原 WAV 准备与重试预算。
- `src/main/native-diagnostics.ts`：仅进程生命周期诊断。
