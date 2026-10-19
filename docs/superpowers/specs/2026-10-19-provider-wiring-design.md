# 计划执行器接线设计

基线提交：24934ed。目标是接通本项目已有执行能力，而不是另建演示流程。本轮后台实施，不打开原生窗口或浏览器，不读正式库/凭据，不发生真实扣费、上传、条款接受或发布，不覆盖正式安装，不推远端，不改父会话 dot 任务。用户已要求先回传设计、随后继续开发；本文件和实施计划用于审查，不增加普通确认等待。

## 一、源码证据和能力矩阵

| 能力 | 已有实现 | 未接线/真实缺口 | 本轮结果目标 |
|---|---|---|---|
| 音乐生成/轮询/下载 | YourMusicAdapter→Main ApiCredentials.withMusicAdapter→ProductionFlowBroker→importProductionAudio | PlanCenter music=false；通用生产流程 verifyMusicPricing 恒false | 计划启动受控音乐子执行，复用原 broker/provider、账本和下载；离线验证完整调用链 |
| 模型能力 | 留存 OpenAPI/contract 支持 chirp-v6/wild/mini；现有适配器 allowlist | 没有账号级模型权限/报价查询接口，保存 profile 不等于可用目录 | 保存合同来源/版本/时间、账号探测证据和有效期；明确 supported/account_verified/unknown，不发明 endpoint |
| 谱乐/有乐称谓 | 项目既有 automation-chain-status 记录用户所称服务对应 app.yourmusic.fun | 计划把谱乐拆成空网址槽位，未复用已配置 YourMusic provider | 使用明确配置的 provider/profile，不猜新站点，不称 Suno 官方 API |
| 预算和 unknown | ProductionFlow/MusicService 已有事务 reserve、settle/release、账户并发冻结和原 songIds 恢复 | 不能把任意 pricingEvidence 字符串当报价证明；旧单曲385积分授权不可复用 | 新计划明确区分可信报价与“现有积分、不充值、成本未知”授权，计划日总额共享；未知提交不重POST |
| A/B和已有音频 | work.assets.audio_A/B、audioVersions、候选 ordinal、selectedAudioVariant | PlanCenter item.versions 无真实资产绑定链；没有已有work绑定入口 | 同一 Item 保存两个版本，校验真实资产/sha/艺人/歌词；选择同步原作品，手动绑定不重新生成 |
| 材料和发布请求 | publishSimple→UnifiedPublicationService→Main unified broker→prepare/submission | PlanCenter materials仅打成功标记，没有work/materials/task关联 | 持久 item-work-材料指纹-发布任务绑定，复用同一队列和现有准备入口 |
| 发布状态回读 | 官方账号、待审/已发布单曲只读回执，Core强校验及unknown对账 | PlanCenter未读统一发布 journal；多账号work scope歧义 | 按平台账号同步准备/待确认/审核/驳回/unknown，仅真实验证回执可表明线上提交 |
| 目录/新建专辑 | 无可信完整目录、无已验证远程新建完成链 | pending songs.albumId不是目录；save_album仅local_material_snapshot | 接明确定义的账号作用域适配边界，现有不支持保持具体阻断，不伪造目录/ID |
| 追加专辑 | existing-album表单/上传/条款/单曲适配器已有 | production capability明确关闭，Windows旧入口也固定阻断 | 连接原能力报告与准备任务，不绕开生产验证门；用fixture验证调用，不宣称线上可写 |
| dot交付 | incoming/receipts、严格包/封面哈希、可信本地导入和去重 | 无触发API、无请求清单；随机旧包无法知道pc-ItemID | 持久请求清单和严格回显关联，入库自动续跑；停止/过期后仍接收归档但不执行 |

## 二、整体结构

PlanCenter 保留 Plan/Run/Item/StageAttempt/PublishAttempt 调度状态和不可变快照。音乐由受控 managed child 连接既有 ProductionFlowService；Main 原 broker 独占凭据和外部调用；下载走已有原文件导入和来源校验。发布由材料绑定器连接既有 UnifiedPublicationService，不另建上传器。dot 请求是本地持久协议，不包装成远程触发接口。

所有跨层请求携带原 planId/runId/itemId/attemptId，外部提交前先持久化唯一 operation/idempotency/额度预留；重启只恢复原任务查询/下载。停止后禁止新增写阶段，已发请求的结果和下载凭证可回收，不能因迟到结果清除 stop 或重新开启未来计划。

## 三、音乐执行和能力缓存

新增 managed music 启动入口，只接受已经模型评分通过、属于本 Item 的可信最终 draft/pair，不能重新生成文本或复用历史单曲授权。输入绑定原评分证据、profile revision、model、额度策略和 owner key；重复调用返回原 child。多个 Item/Run 使用同一个计划北京时间日额度作用域，并保留实际 operation 身份。

模型目录分开报告：接口合同支持、账号已观察成功、账号权限未知、缓存过期、通道不可达。合同来源固定为项目留存的 provider 文档；只读账号探测复用既有固定 history 接口及精确返回值，不发明模型/报价 endpoint，不把鉴权成功当成模型权限验证。没有可信价格时不能显示估价；可用明确“消费现有积分、不自动充值、实际成本未知”的范围授权，且默认不启用。

生成使用原 submit；202 和原 task/song IDs 才记接受，超时或不明确响应冻结。查询只用原 IDs；404/pending不证明未提交。历史恢复必须精确匹配标题、歌词、明确模型和时间窗口，恰好两个不同输出才能恢复；未找到仍unknown，不重发。下载校验原 operation、songId、ordinal、URL来源并保存原文件哈希。

## 四、作品、A/B、现有音频与材料

每 Item 有稳定本地 work 绑定。生成两版本写入同一作品 audio_A/B 和来源元数据；计划数量不因A/B翻倍。first策略明示取A；manual等待选择，不宣称审美择优。已有音频绑定要求同艺人、实际存在和哈希一致；不发生成请求。材料绑定核对最终评分歌词、封面版本、选中音频、授权依据和歌词一致性，保留原作品和资产历史，不能靠renderer传来的任意ID伪造完成。

改写后封面仍需刷新。仅文字计划可完成文字交付；需要音乐或发布时，材料未齐就保持明确等待，不写prepared成功冒充可发布。

## 五、发布与账号/专辑

每个Item/platform/account稳定关联现有统一发布 task，保存原材料指纹和专辑意图。多账号 scope 使用 publicationTaskId/accountId，禁止覆写全局平台默认账号来轮流执行。原生会话只有一个时其余账号等待对应会话，不借用当前账号。准备、待授权、待条款确认、回执未知与线上审核分别显示；用户未明确授权的条款接受和正式提交保持原门。

真实专辑目录必须包含账号指纹、albumId、来源证据和获取时间；现有目录缺失时禁用现有专辑选择。新建/追加使用适配器能力和真实外部ID回执；local_material_snapshot不是remote album。生产适配器未验证时，持久具体blocked原因并可在同一发布中心查看。已知外部结果对账不再创建专辑、不重复提交。模拟能力只在隔离测试注入。

## 六、dot协议和消费者

持久请求包含 requestId/requestHash、planId/planRevision/runId/itemId/ordinal、channel/workspace/artistRef、expectedExternalItemId/revision、需求与outputs快照、createdAt/expiresAt。请求清单可由已配置的文件桥导出，父会话协调实际dot；客户端没有“调用dot API成功”状态。

新版回包回显请求关联并经严格schema验证；校验通道、工作区、身份、全部ID、请求哈希和版本，再事务保存 request-item→candidate/draft/cover 唯一关联。旧v1继续导入；仅预先公布、跨所有请求唯一且未消费的精确 externalItemId 可兼容匹配，不能靠标题/日期/顺序猜。新格式错误不回退旧格式。

停止和过期不关闭收件：产物仍导入、保存原文件并生成回执，关联标记stopped/expired/late，禁止启动评分/音乐/发布。重启从请求和已导入状态恢复；同请求同包重送幂等，修改请求或产物必须新revision。已有父定时任务不改变。

## 七、验收与交付

用隔离SQLite根、既有provider类加录制/合成HTTP响应验证：两Item共享额度；接受→原ID轮询→A/B下载；unknown冻结/原receipt恢复；停止后回收但不新提交；既有音频零POST绑定；每账号材料/任务独立；发布真实service状态回读；专辑不可用原因；dot请求全字段关联、重复/篡改/旧包/迟到/重启。Main契约测试确认实际调用既有adapter路径，任何写入响应均为fixture，不声称线上验证。

运行类型检查、相关回归、无头界面和打包Core验证；独立复核后更新版本、源码提交、便携包、截图和证据。原生窗口、真实账号/音乐/专辑/发布验收不包含在本轮。


## 实施后的明确约束

音乐在封面阶段之前，确保已有实际作品供封面工作室使用；已有音频绑定只允许 manual 快照。dot 桥采用 immutable generation 文件而非覆盖固定文件，owner/reservation 单独提交后独占发布；producer 扫描最高完整世代并只处理 pending。详见 [0.10 实施说明](../../release/provider-wiring-0.10.md)。
