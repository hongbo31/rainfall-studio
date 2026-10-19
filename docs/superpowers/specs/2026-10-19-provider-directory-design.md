# 文本供应商与通用目录任务

本轮在 `feature/provider-directory-20261019` 实施。已验收的 0.11.2-preview.2 完整程序目录、桌面指针和正式数据保持冻结；新候选使用独立 output 数据根。用户已要求简短设计后直接实施，普通交互决定不再逐项确认。

## 目的与边界

个人创作者在配置中心保存模型和任务目录，在计划里只选择配置。DeepSeek 与豆包各有独立本机配置、模型 ID、固定官方 baseURL、加密凭据状态。方舟使用 `https://ark.cn-beijing.volces.com/api/v3/chat/completions` 和 Bearer API Key，模型字段由用户提供已开通的 Model ID 或 Endpoint ID。只允许已实现的官方 HTTPS 路由，禁止任意 URL、重定向或图片调用。豆包未核实免费认证探测，提供本地配置检查并明确真实认证尚未验证；不自动发送可能收费的推理探针。

DeepSeek 旧流程继续工作；新增独立 ProviderTextService 管理 provider 初稿、评分、有限改写、预算和来源证明。不会把生成草稿伪装成 dot/Inbox 导入。计划新增 provider 来源，按来源选择阶段和可信证明。音乐只通过现有独立音乐授权/额度/原始任务对账路径，不能由请求文件或文本凭据授权。图片等待真实图片提供商或外部封面结果，不能把豆包文本或 Codex 会话当免费图片 API。

## 配置与默认行为

供应商配置默认不启用执行，模型留空，凭据不回显。预算、币种、价格依据和每次最大输出均是客户端本地配置；未知价格/缺少明确调用授权时阻塞，不猜价格、不套用另一个供应商的价格。保存配置或检查字段不联网。所有本轮验收用拦截传输和无凭据隔离数据，禁止真实收费调用。

任务目录默认关闭，默认扫描间隔 10 秒（可配 5–86400 秒），稳定窗口 2 秒，非递归。目录由本机原生选择器明确授权；拒绝盘根、应用数据根和其交叠、凭据/系统目录、符号链接/目录联接以及不明云占位文件。保存后的规范路径、文件系统身份及配置 revision 固定在本地。输入只读，不移动或删除用户文件。

两种入口分别标为“任务请求”和“素材 / 生成结果”。后者沿用既有导入，不触发目录任务。任务入口只识别直接子项 `*.rainfall-request.json`，或直接子目录中固定 `request.json` + 最后原子就绪的 `READY.json`。音频、图片、普通 JSON、回执和临时文件全部忽略。

## 请求协议与幂等

请求严格字段：`schemaVersion:1, requestId, revision, planId, planRevision`；业务内容来自对应已保存计划，不允许请求改供应商、模型、预算、凭据、发布授权、账户、命令或目录。需要变更内容时先在客户端修改计划，再递交递增 revision 的请求；同一 requestId/revision 与相同语义内容幂等，改动内容但不递增 revision 为冲突。更高 revision 是独立任务，低版本迟到拒绝，不自动停止已发任务。每个目录配置可显式选择允许触发的计划与 revision；旧配置不会自动继承变更后的计划权限。

稳定文件跨两次观测，size/mtime/身份/内容摘要一致且超过稳定窗口后固定 fd 读取、读后复核。READY 模式要求 `schemaVersion:1,requestId,revision,requestSha256` 与固定 request 文件完全匹配。限制每请求 256 KiB、每轮 100 个输入、非递归；拒绝链接、多硬链接、路径穿越、未知字段及 Windows 保留标识。文件始终作为业务数据，任何字符串都不执行。

SQLite settings 独立命名空间持久化来源、观测、请求私有快照和状态。事务内同时保存去重键与 PlanCenter run 绑定；忙碌计划保持 queued，后续按序运行。源目录离线、非法内容、revision 冲突、计划变更和生成阻塞均可见。暂停只停止扫描和新派发；“停止目录任务”还停止已绑定 run 的后续阶段；已经发出的外部请求保留原操作和 unknown 结果，不自动重放。重启恢复 queued，不重发 dispatching/unknown。关闭客户端时没有后台服务。

## 可信文本与计划桥

ProviderTextService 采用 settings 内持久 job/operation；ownerKey 固定为 plan stage，run/item/artist/profile revision/输入哈希匹配。Main 独占凭据与 HTTPS 调用，Core 在 claim 前校验计划和配置授权、持久预算预占，返回后按请求模型、usage 和限定 JSON schema 验证。超时、停止或进程中断不确定结果保留 unknown，不自动收费重试。生成、评分、改写分开留存版本和操作，最多按计划授权次数改写/评分。

计划 provider 路径：`text_generate → text_score → [music_submit/music_assets] → [cover] → materials`。Dot/manual 历史快照和证明校验不改变。新音乐桥只接受同一 provider job 的完成评分、最终 draft/pairHash 和原操作证明，不接受 renderer 传入的“评分通过”。封面未收到时显示等待，并提供既有封面工作流入口。

## 验收与体验交付

离线测试覆盖两个供应商的路由/usage/模型/凭据隔离、预算预占、停止/未知结果、旧 DeepSeek/Dot 回归；目录涵盖部分写入、READY、重复、递增版本、冲突、重启、忙碌、链接/越界/恶意字段、暂停停止及音频/图片忽略。实际 Core + renderer 的隔离候选完成首次配置、设置、计划、目录请求、错误与重试、封面等待、作品详情和发布入口的交互截图。无头结果注明无头；原生截图注明实际窗口。独立评审需完整可交付候选、固定数据根、操作步骤与证据，不开放公网，不复制正式凭据或数据。
