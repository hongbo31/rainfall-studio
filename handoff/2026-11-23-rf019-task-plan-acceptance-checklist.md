# RF-019 D｜任务中心与计划中心验收清单

日期：2026-11-23（北京时间）　状态：设计完成；2026-11-24 已运行相关任务中心单测，见本节结果。本文其余为手工验收设计。

## 测试准备

- 用隔离数据库与模拟提供商构造：新记录、旧 schema 记录、缺 `reason`/外部 ID/运行来源、402、usage 缺失、发送前拒绝、POST 后断连、平台回执未知、8 项混合结果。保存预期 run/item/stage 数量及发送计数；模拟调用应可证明有无提交，不使用正式库、真实 API、真实平台或收费操作。
- 每个场景在任务中心和计划中心核对同一 `runId`；记录预期状态、文案、动作、受影响项、刷新前后数据及是否再次发出副作用。

## 验收清单

| □ | 场景与方式 | 通过条件 |
|---|---|---|
| □ | 新记录与旧记录、缺 reason/ID（隔离数据/无头） | 新旧记录均可打开；缺字段显示“未记录/待核对”，不伪造错误原因、派发状态或外部 ID；计数只基于已存 item/stage；不改写历史记录。 |
| □ | 任务中心阶段诊断 ID/时间（隔离数据/无头） | 展开阶段明细后，长 ID 只显示脱敏首尾、短 ID 不泄露完整标识、缺 ID 显示“未记录”；无效/缺失时间戳显示“未记录”。按同一 child `runId` 和 stage attempt ID，对照计划中心对应 attempt 的 `updatedAt` 与 external ID 原值，确认任务中心显示同一持久化更新时间、脱敏外部 ID；该时间只称“本地记录更新”，不解释为最后核对/平台更新时间。约 4 秒轮询前后展开状态保持；焦点稳定另按可访问性项实测。 |
| □ | 明确 402（模拟 provider/无头） | 任务卡与计划阶段均显示余额/额度不足和配置入口；不显示成 usage unknown；检查 API 调用只发生一次，不循环重试。 |
| □ | usage unknown、有歌词内容（模拟 provider/无头） | 内容可读与 usage/预留状态分开显示；usage 不被记零或释放；评分、改写、音乐生成等耗费型下游保持阻断；刷新不重新请求。 |
| □ | 确定未发送 vs POST 后断连（模拟 provider/网络） | 发送前可证实未发出时显示可修复的前置失败；POST 后断连显示 unknown/待核对；不得把两者混为一类，unknown 不自动重发。 |
| □ | 平台投稿回执未知、普通阶段 `not_found`（模拟平台） | 投稿 `unknown` 与 API 余额不足区分，显示“可能已受理/待核对”；普通阶段 `not_found` 不解释成未发送或无副作用，UI 不显示重试，Core retry 拒绝。当前 publish attempt schema 不含 `not_found`，不可把普通阶段的该状态当成投稿回执场景。供应商只读查询仅在该适配器已确认支持时出现。 |
| □ | 部分成功、精确重试（模拟 8 项混合结果） | 总数与成功/等待/异常明细相符；单项重试指明 item+stage，已成功项不重放；unknown 禁用自动重试，人工动作受副作用/幂等校验约束。 |
| □ | 双中心一致、重复触发与停止（无头/模拟） | 同一 run 在两中心 reason/state/source 一致并可互相定位；同一 plan 跨入口只能有一个 active run，后到请求定位已存在的 run 或按定时规则跳过；重复点击不会静默双发；停止只阻止后续动作，已派发状态仍可核对。 |
| □ | 键盘、窄屏、轮询焦点（浏览器无头 + Windows 原生） | Tab/Shift+Tab 可达错误动作和详情，Esc 关闭弹层后焦点回到触发控件；窄屏主要信息/主动作可见可达；约 4 秒刷新不折叠当前详情、不抢焦、不丢焦点；状态不用颜色单独表达。 |
| □ | Windows 原生与浏览器回归 | Windows 在隔离数据下逐项复核双中心、键盘、窄屏与轮询；浏览器跑同一状态/异常用例。两端状态、reason、动作、安全边界一致；无头结果不能替代原生验收。 |

## 静态核对 A-C 当前实现与差距

- **初始基线现状（2026-11-23）**：当时运行模型已有 `runId/source/planRevision/snapshot`，任务卡可投影阶段更新时间和脱敏 ID，余额分类已先于 usage 校验，文本 usage unknown 保留 reservation 且工作流不会将其当成功推进。此后的 E/G 源码变化记录在 [2026-11-24 实施交接](2026-11-24-rf019-safe-concurrency-reconciliation.md)；未以隔离测试验证。
- **仍未实测/未实现**：计划中心已有人工核对说明入口，仅追加用户说明，不验证外部证据真实性/归属，也不更新 attempt；自动供应商核对只覆盖已有适配器。耗时显示的是阶段启动和本地记录更新时间，不等于供应商最近检查。统一重试次数/冷却策略无验收证据；Windows 原生、轮询焦点、键盘与窄屏均未实际验收。
- **隔离模拟/无头可验证**：用夹具校验 402 映射、reason 展示、刷新后同一 run、发送计数与重试门禁、跨 source active-run 冲突、旧数据读取容忍度、内容/usage/reservation 区分及 DOM 键盘/窄屏布局。不得连真实 provider、平台或生产数据库。模拟用例不能证明外部供应商真的支持查询/幂等。
- **Windows 原生专属复核**：实际窗口缩放/窄屏布局、Tab/Shift+Tab/Esc 焦点行为、后台轮询时展开项与焦点保持，以及任务中心到计划中心的原生下钻；只用隔离运行数据，不启动收费生成或正式投稿。
- 以上是静态代码审阅结果，不等于通过验收；每项需求仍需按上方清单实际验证。不得把目标要求写成已实现。
- **已确认的验收口径**：usage unknown 保留 reservation 并阻断付费下游；同计划跨入口只允许一个 active run；`not_found` 不开放重试。等待升级阈值没有证据，不自动取消、转失败或重发。其余未实现/未实测项按上述状态记录。

## RF-019 E/G 补充验收｜单活跃运行与核对证据

本节是 E/G 的隔离验收条件。源码改动已落地但未执行本节测试；使用隔离库和可控模拟执行器验证服务端事务/约束，不以按钮禁用或单窗口手工操作代替并发验收。

| □ | 场景 | 通过条件 |
|---|---|---|
| □ | 同一计划由任务中心与计划中心几乎同时启动（不同 requestId） | 跨入口原子仲裁，同一计划只创建/接受一个活跃 run；另一请求得到稳定冲突结果，并可定位获准 run；仅产生一次外部派发/授权预留。两请求反向排序、并发到达及同时重复点击结果一致。 |
| □ | 同来源重复 requestId 与冲突复用 | 相同 requestId、相同参数返回原 run，不新建 item/stage 或再次派发；相同 requestId 携带不同计划、来源、revision 或摘要必须冲突，且不得改变原 run。 |
| □ | 活跃 run 跨刷新/重启/排队/停止边界 | run 持久化为活跃时，另一个入口仍不能绕过单活跃约束；终态后允许按产品规则新建；停止中的外部 unknown 仍视为占用，直到核对或明确收敛。删除、禁用、定时入口不能绕过同一服务端规则。 |
| □ | unknown 原 attempt 上追加核对 observation | 原 attempt ID、request hash、幂等键和创建时间保持；每次核对产生独立 observation，关联 attemptId、结论、证据引用、来源、操作者、时间与原因；重复读回顺序稳定，进程重启后历史仍完整。当前 state/evidence/reason 可作为最新状态投影更新，须确认旧 observation 不被覆盖。 |
| □ | 核对 pending、succeeded、failed | pending observation 不触发生成/投稿；成功/失败 observation 可更新当前 attempt 状态，但历史 attempt ID 与先前 observation 均保留；矛盾证据需追加新 observation，不可静默覆盖既有 observation。 |
| □ | 核对返回 `not_found` 后尝试重试 | 单独的 `not_found` 仅代表查询时未查到，不证明请求未受理、没有扣费或没有副作用；计划中心 UI 不显示重试按钮，直接调用 Core retry 也必须拒绝。只有 attempt 被系统/供应商明确记录为 failed 时才符合当前重试门禁。 |
| □ | 证据留痕边界 | 当前手工核对入口仅追加用户说明和 Core 生成的记录 ID，不校验外部证据 ID 的真实性/归属，也不将人工结论作为阶段结果；确认记录不会改变状态或重试资格。来源与操作者是记录字段，不代表已完成身份认证。 |
| □ | 核对 attempt 已变化或并发写入 | 追加记录时若 attempt 已不再处于 unresolved，应拒绝写入；并发变化不得覆盖既有 attempt 状态或 observation 历史。 |

**E/G 当前实现状态（静态核对，未实测）**：Core 现按 planId 全来源检查活跃 run；`createRun` 在 repo transaction 内拦截并带出 activeRunId。Dashboard 与计划历史现在包含 `publication_task`。系统 reconciliation 会追加 observations；pending/succeeded/failed 可以更新 attempt 的当前状态投影，历史 observation 保留。`not_found` 只追加 observation 并保留当前 unknown/waiting，UI 不显示重试按钮，Core retry 只接受 failed。计划中心可追加人工核对说明，但不验证证据真实性或归属，也不更新 attempt 状态。尚需隔离并发、旧记录兼容、重启持久化和停止边界验证；没有测试或 UI 结果。

| □ | `not_found` 重试资格前后端一致 | UI 不显示重试按钮；绕过 UI 直接请求 Core retry 仍拒绝；既有 observation 与 unknown/waiting 状态保持完整。 |
| □ | 定时任务与其他入口在事务仲裁时撞车 | 无论预检查是否观察到冲突，定时任务都将计划记入跳过清单，不把它链接为 owned=false；普通任务中心可关联 exact activeRunId 且 owned=false。确认定时轮次最终提示包含跳过数量。 |

## 本轮结果

`node --test tests/publication-tasks.test.mjs`：38 项通过、0 失败；覆盖跨中心单活跃、任务所有权和定时冲突跳过。`git -c core.whitespace=cr-at-eol diff --check` 通过。TypeScript 全量检查被当前检出缺少的 `reflect-metadata`、`@peculiar/x509`、`qrcode-generator` 阻塞。未运行完整集成套件、构建、无头 UI 或 Windows 原生验收；未调用真实 API/平台。其余清单场景仍需隔离/双端验收，按项记录环境、运行 ID（脱敏）、结果和证据位置。
