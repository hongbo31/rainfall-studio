# 可插拔适配器与真实能力矩阵

核查日期 2026-10-15。本轮只读取公开网页；没有账号登录、付费生成、平台写操作、接口探测或用户凭据访问。页面有某项功能不代表第三方 API 获批，搜索未找到也不证明 API 永远不存在。

## 能力维度

Operation = generation.submit | generation.query | cover.generate | release.upload | release.commit | release.query | release.cancel | analytics.read。

CapabilityStatus = available | requires_authorization | requires_approval | manual_only | unsupported | unverified | temporarily_unavailable。

每一维分别记录 operation、status、reason、evidenceUrl、checkedAt、adapterVersion、rulesVersion、accountId/scopes；只有 available 才可执行该操作。authStatus 与 adapterStatus 分开：账号显示“已授权”并不意味着有发布权限。manual_only 可以准备本地包和打开官网，但不得提供 upload/commit 成功回执。

Mode = production | simulation 是进程级上下文，不接受任务 JSON 任意切换。模拟工厂没有 HTTP/credential 依赖；production 工厂不能注册 SimulationAdapter。未配置真实接入时默认 local-only，真实按钮不可执行；真实服务端返回不认识的状态按 unknown 处理，不映射为成功。

## 证据与决策

| 平台/域 | 公开证据 | 本轮可确认 | 当前实施路线/阻塞 |
|---|---|---|---|
| Suno 生成 | [官方条款](https://suno.com/terms/) 页面本次显示 2026-08-10 修订、2026-09-03 生效；包含 robots/scraping 限制 | 官方产品与条款可读；未核实面向本客户端的公开生成 API 或账号聚合许可 | manual_only：用户官方生成后导入，保存来源/生成时间/授权证据。不能以第三方“Suno API”替代。真接入需官方许可、合同/文档、计费与幂等说明；不设置免费号池 |
| 谱乐 AI 生成/图片/发行 | [用户指定入口](https://app.yourmusic.fun/create) 可读，页面列创作音乐、AIGC、MV、发行申请等导航；标题自述 Suno 相关能力 | 确认地址和可见导航，不能据标题推断其是 Suno 官方、API 合法授权或发行获批 | manual_only；不读取私有接口、cookies 或凭据。需平台提供可用官方开发文档/授权/条款与资费再实现。地址已确认，不再标待提供 |
| Codex 辅助封面 | 当前会话可用出图流程与文件导入 | 手动任务交接、图像导入与本地排版可实施 | 不存在已确认的内置免费 Codex 图像 API；CoverAdapter.prepareTask + importResult 本地可用。未来用户选择官方收费图像 API 时独立申请/计费/授权，不共享 ChatGPT 登录凭据 |
| 网易云音频发行 | [网易音乐人入口](https://music.163.com/st/musician) 本次读取失败 | 无法据本次公开读取确认第三方投稿接口/Windows 资格 | unverified + manual_only，保留官方入口作为人工交接目标，页面可用性需用户浏览器确认；不把非官方 NetEaseCloudMusicApi 当投稿许可 |
| 汽水音频发行 | [汽水音乐合作平台](https://music.douyin.com/home) 明确音乐人/机构发行入口，并标示原抖音音乐开放平台 | 官方发行门户存在 | manual_only；门户发行不等于公开音频投稿 API。申请合作能力后评估；经该门户向抖音音乐库分发不等于在用户抖音账号发视频 |
| QQ/酷狗音频发行 | [腾讯音乐人](https://y.tencentmusic.com/?from=kugouweb)、[腾讯业务说明](https://www.tencentmusic.com/zh-cn/business.html)、[音乐云](https://opencloud.tencentmusic.com/index) | 官方有发行、数据等服务；音乐云页面的 API 描述不能直接推定为个人音频上传 API | manual_only；面向本产品的投稿/状态/多账号接口及资格未核实。QQ 与酷狗可能共享获批发行路线，必须先确定 route coverage，再决定一个提交还是多个，禁止重复投同一渠道 |
| 抖音视频发布 | [新版创建视频](https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/openapi/video-management/douyin/create-video/video-create)、[上传视频](https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/openapi/video-management/douyin/create-video/upload-video) | 文档存在上传与创建步骤；create scope=video.create.bind；需要申请和用户授权，创建后进入审核 | requires_approval；当前无获批应用/账号。先完成真实 MP4、本地包、禁用态和契约测试。Windows 客户端不在文档列出的原生 SDK 平台中，不假设注册普通桌面应用即可获批；可通过获批网站应用+系统浏览器+服务端接入，但要先核实资格 |
| 抖音 OAuth | [登录授权](https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/sdk/mobile-app/permission/overall-permission)、[令牌交换](https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/openapi/account-permission/get-access-token) | 支持 Web/JS/Android/iOS 授权；token 交换需要 client_secret，文档建议服务端保存 token | 设计可选授权 broker，app secret 永不进 EXE。平台审批、redirect_uri、HTTPS 服务部署与费用是后续门槛；本轮不建账号、不部署、不创建密钥 |
| 数据统计（各平台） | 抖音有分开的 [权限目录](https://open.douyin.com/platform/resource/docs/accession-guide/type-and-permission)；其余发行门户提及数据服务 | 发布权限不能推定统计权限；未获得本产品授权 | CSV 导入为 available；在线 read 需独立 scope/合作能力。缺指标值为 null，不填 0；带 observedAt/来源/账号/统计周期 |

抖音旧文档仍有 video.create 与 /video/create/，新文档出现 video.create.bind 与 /api/douyin/v1/...。不得拼接两代接口。获批后选择一个有证据的 API profile，固定端点、scope、错误码与 schema，并保存版本。公开文档未证实客户端幂等键、可靠查询最近提交、AI 标识字段、分片/取消当前 profile 支持范围，必须逐项核实；未确认的能力默认关闭。

## 适配器结构

src/adapters/local-import、manual-release、simulation、suno、yourmusic、douyin、netease、tme、qishui；每目录可只提供 capability + 手动导出，禁止用假的生产 adapter 返回 success。共享 HTTP transport 只有 Core 持有，强制 allowlist、timeout、redaction、账户上下文与 AbortSignal。接口详见 contracts.md。

生成：preparePrompt 本地、estimate（带币种/credits 单位与观察时间）、submit/query/importResult；只有官方生成 permission 和用户明确预算批准后才 submit。提交不确定要核对而不是重新付费；账本先 reserve、回执 settle，失败有证据才 release。

封面：从冻结歌词/故事生成任务文本、导入母版/衍生图、记录来源/参数/权益，保存无字母版与排版版本；图像生成与音乐生成有独立 provider 和预算。

发布：getCapabilities → preflight → prepareLocal → upload → commit → reconcile/query；upload 返回上传凭据不是已投稿；commit acknowledgement 不是审核通过。supportsResume/idempotency/lookup/cancel 都是明确布尔能力，默认 false。人工 adapter 只 exportPackage，远端回执由用户手动填入，标 source=user_report。

数据：importReport 或获批 readMetrics；返回 null 缺失、周期口径与来源，不能从平台页面抓取隐藏接口。CSV 导入与在线数据不重复加总同一指标快照。

## 真实集成的最小证据包

每 adapter 的 integration-profile.json 必须包含官方文档地址与核验时间、应用类型/审批说明、授权 scopes、提交/查询 schema、是否支持远端幂等、支持的 targets/账号关系、AI 标识方式、格式限制及限流/计费说明。人工录入“已获批”只能用于显示，不绕过实际 token scope 和 adapter checks。P1 对真实网络的验证须使用用户批准的特定测试素材与目标；未批准时仅 mock 官方响应 fixture，结果标为 contract-tested，不能标 live-verified。

若平台需要 client_secret：授权 broker 持有 app secret 与平台 token，桌面只持有短期、窄范围 broker session；broker 校验 batch manifest hash、账号归属、幂等键和服务器审计。首版不部署 broker；其缺失只阻塞真实抖音 API，不阻塞 P0。若以后平台正式支持 public client+PKCE，须有明确文档才改为桌面直接 OAuth，不能猜测。
