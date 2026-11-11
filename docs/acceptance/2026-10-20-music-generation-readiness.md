# 指定新歌生成准备与费用核对

核对电脑：90VC。指定歌曲：《给明天多摆一双筷子》。仅只读生产库中的非秘密配置、计划和相关任务，浏览器仅查看公开文档及开发者门户。未读取密钥、发起验证码、生成、充值或修改计划。

## 本机实际配置

- 存在“谱乐 AI · 个人音乐创作”音乐 profile，provider 为 yourmusic，revision 1，modelId 为 null。
- generation-config 默认音乐 profile 为 null，未配置默认音乐执行路线。
- 已有“每日关系故事候选”计划处于停用状态，music 路由为 manual，music.consent=false，outputs.music=false，发布目标为空。
- 指定歌曲只有已导入文本候选，evaluationState=model_pending；没有对应成品作品、音频候选或关联生成操作。未发现需先恢复的同歌音频请求。
- 封面原图为 1254×1254，保持未修改；番茄要求至少 1440×1440。

## 费用证据及限制

2026-10-20 在当前 Edge 打开 https://api.yourmusic.fun/dashboard，页面为“登录开发者门户”，手机号/验证码登录表单。当前浏览器会话没有可读取的账户余额或模型报价。未登录、未发送验证码。

当前公开 OpenAPI 地址 https://api.yourmusic.fun/v1/openapi.json?lang=zh 可在浏览器打开；可见示例使用 chirp-v6，并说明 402 为积分不足，但没有读到可作为本次报价的 v6 单价或一次请求总价。

https://yourmusic.fun/pricing-standard 当前内容是网站广告位置及广告服务收费标准，不是音乐生成/API 积分报价，不能用于估计这首歌的生成费用。

仓库保留的 `docs/integrations/yourmusic-contract-2026-10-16.json` 和 `yourmusic-v6-readiness-2026-10-16.json` 是历史证据：

- 一次普通生成请求预计返回两个同词不同版本，客户端按一次提交处理，不等于连续付费生成两次。
- 历史公开价格只覆盖旧模型 v3.5 至 v5.5，不能用于 v6；v6 单价、两首总价、总费用上限均为 null。
- 历史说明查询不扣积分、Max 模式每首倍率为 2；不能把这些旧说明当作当前账户合同或本次最终报价。
- 2026-10-16 曾见账户可用 385 积分。该观察不代表当前余额，且当时未核对保存密钥与网页账户是否相同。

因此本次可核实的**当前实际费用/积分、剩余额度及扣费结算方式仍未知**。用户随后明确“不用查报价，直接生成”，并授权本歌及后续每首累计最多 20 积分，含重试、不充值；不再把逐次报价或控制台登录作为 API 生成前置。没有将旧模型的 3/5 积分套用到 v6，也没有通过付费试生成探测价格。

## API 通道与 20 积分保障核对

只读生产库及已有提交回执确认：2026-10-16 《留一盏灯》通过现有谱乐 API 使用 chirp-v6 完成生成，operation 状态 assets_verified，两个音频版本均 ready 并已入库。该请求 is_max_mode=false，返回两个 songIds；submit-result 的 actualCost=null，operation 的 costState=unknown。因此这是 API 实际可用的历史证据，但没有确切历史扣费证据。

没有默认音乐模型不妨碍在逐次请求中显式选择已使用的 chirp-v6；无需把选择模型升级为修改全局默认配置。尚未选择或调用其他更高价模型。

历史一次性 grant 的 creditCap=385 仅绑定《留一盏灯》的旧 requestId 和 operation。它不能移作本歌授权，也不能把代码常量、旧 grant 或内部 reservationCeiling 当作当前用户批准的上限。当前有效的人类授权是本歌累计 20 积分。

现有 `YourMusicAdapter.submit` 发送 title/lyrics/tags/model/duration/is_max_mode 等生成参数，**没有发送已验证的服务端最大扣费参数**；保留 OpenAPI 的 GenerateCustomDto 中也没有 budget/credit-limit 字段。本地 budgetCredits/maxCostPerRequestCredits 控制本地调度或内部保留，不是供应商单次账单限额。现有适配器又不能确认单次实际费用，故仅把本地数字填 20 不能保障供应商不会扣超过 20。

本轮还通过现有 Main ApiCredentials 服务尝试仅 GET 认证/历史检查，未调用生成、充值或凭据写接口；未导出密钥。诊断在 `main_authentication_check` 阶段返回 `SECURE_STORAGE_DECRYPT_FAILED`，没有得到 HTTP 认证结果。默认执行账户为 CodexSandboxOffline，且受支持的主机执行尝试仍出现同样解密失败；没有复制 Local State/凭据、重建密钥或绕过 Windows 绑定。此结果不能推断谱乐 API 不可用，只表示本会话未完成当前凭据可用性核验。

**本次没有提交计费请求。当前保障缺口是供应商侧 20 积分限额未被现有通道证实可执行，且单次成本不可确知；不是缺少用户的花费授权，也不是必须网页登录。**

## 真正生成前仍需具备

1. 用户明确选定可用音乐模型及这首歌的最终歌词、曲风/声音、期望版本数；无需重建已导入的文本候选。
2. 在用户累计 20 积分授权内，现有通道必须能保证单次及重试累计不会超过 20；不能将本地预算、内部保留上限或旧作品 grant 冒充服务端扣费保障。不再反复要求用户登录控制台或逐次查报价。
3. 再次核对没有同范围 dispatching/unknown/succeeded 的既有操作；未知请求先只读核对，不能再次生成。
4. 通过客户端已有主进程凭据通道执行，不读取或导出密钥；固定作品、模型、参数、预算和幂等操作。
5. 获取并核验实际音频、版本和歌词对齐，再准备合格的派生封面。当前不修改原图。

用户已回复“都填这个名字”，明确本歌的作词、作曲和歌手均为“栩你听海”，不再等待署名确认。角色身份 ID 仍需在番茄分别核对，不能因同名而假定相同。本文件不代表付费生成授权、费用确认或生成成功。
