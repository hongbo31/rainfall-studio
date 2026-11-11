# 统一计划中心：技术设计与验收边界

## 目标与执行授权

按用户2026-10-19确认范围，先设计，再在原隔离仓库实现与离线验收，不再次等待普通实现选择。本轮只生成独立候选包；不更新正式安装、读写真实密钥、调用付费音乐生成、接受协议或发布，不启动可见窗口。

## 源码事实

- 主导航在 `src/renderer/main.tsx`。创作模板页 `pages/Create.tsx` 有 plans 表的旧定时表单；聊天创作页 `pages/ChatCreation.tsx` 嵌入 ProductionFlowWorkspace 与 simulation DailyCandidates。发布页按作品和平台手动准备，不应增加调度。
- 旧调度有三套：`plans/runs/steps`（Studio.tick）、`dailyPlans/occurrences`（DailyScheduler，production默认不可执行）、`settings production-flow:plan/run/occurrence`（ProductionFlowService + Main broker）。这些历史不可删除，迁移需原子关闭旧调度所有权。
- dot 有真实 incoming→私有收件库→receipts 的文件桥接，但没有客户端触发 dot 内容任务的受支持接口。收到成功和评分成功是不同事实；不得用 Work 或 CLI 偷换 dot 渠道。
- 当前收件候选硬编码 model_pending；已有 DeepSeek JSON评分适配器，歌词/提示词/一致性权重40/30/30，默认75；本地结构规则不能充当模型质量分。此前未提交评分改动已保留在 `output/unified-plan-checkpoint-20261019`，先验证再复用。

## 模型与存储

新增 `plan-center:` settings 命名空间，复用SQLite FULL同步和 immediate transaction，避免与旧 plans/runs 表混用或修改正式 schema。实体分别为 Plan、Run、Item、StageAttempt、PublishAttempt、Occurrence、AlbumBinding、Migration。所有身份和枚举由共享Zod契约限制，外部adapter结果再次校验。

Plan 包含名称/艺人/启停/北京时间日、周、指定日期调度/数量/歌词封面音乐勾选/dot文本来源/曲风模板/模型评分阈值与上限/音乐渠道账号及模型/版本策略/发布开关/各平台账号与专辑选择/补跑策略。两个Item是两个独立主题；供应商A/B保存在同一个Item的versions内。版本策略支持第一可用和人工指定，不提供未经证实的音频审美分。

Run 固化计划revision及完整配置快照，记录manual/debug/scheduled来源；手动和调试不占scheduled occurrence、不移动下次定时时刻。Item按独立序号保存稳定主题请求与成果。StageAttempt幂等键由run/item/stage/ordinal组成，供应商任务ID、request hash和原始结果保留；超时进入unknown/reconcile，禁止盲目再次提交。成功阶段不重建。PublishAttempt按Item/平台/账号隔离，submitted/reviewing/published/rejected/unknown分别存储。

## 调度与停止

日/周/指定日期均用Asia/Shanghai。Occurrence键为plan ID+计划本地到期时刻，数据库事务同时创建occurrence与Run。每计划最多一个未完成Run；运行中▶不可用，服务端锁同样拒绝第二个请求。用户点击▶先弹应用内确认对话框，显示数量、渠道、自动发布与所有账号/专辑；确认摘要hash及plan revision在服务端重新核对。

关闭后保留clock，重启只按补跑配置处理：默认仅最近一次，也可跳过或有限次数（最大5）；不无限追补付费任务。停止本次设置stopRequested，不再claim后续阶段；dispatching/已提交的结果仍允许回收，unknown保留对账入口，不声称撤销外部任务。停止不关闭Plan未来调度。

## 执行与真实能力

本地流程为dot素材等待→模型评分/有上限反馈改写→音乐→完整材料检查→各平台专辑绑定→独立发布回执。实际端口未实现、模型未实时核实、授权/额度不足时进入带原因的waiting/blocked，不产生成功凭证。

dot请求保存稳定externalItemId和内容brief；只有匹配艺人/通道/身份的真实收件候选能接入。客户端没有真实dot触发端口时展示等待与请求包，不声称已触发。保持现有父会话dot日程不变。后续桥接由dot读取请求、按指定externalItemId写入现有schema并通过receipts确认；本轮不新增无人值守外部通信。

评分复用DeepSeek适配器与现有文本授权预算机制。默认最多改写2次、评分错误重试2次，原稿和封面不覆盖，改写另存且封面标记需更新。规则检查、模型分、平台规格门禁分开显示。评分仅是模型意见，不能声称客观保证或审核通过；不会自动越过音频付费/平台发布授权。

渠道目录明确区分Suno官方待核实、谱乐网址待提供、已有yourmusic第三方路由；第三方不可称官方直连。模型只有供应商真实读取结果才标为verified；已有profile声明显示未核实，不能当实时可用目录。端口无真实目录时选项禁用并给出原因。

## 专辑与发布

每个平台账号单独保存AlbumSelection，existing要求真实catalog条目及平台album ID；new只呈现平台已知字段，未知字段/不支持创建直接阻塞。Native端未提供真实catalog读取时显示不可用，绝不注入示例专辑冒充真实列表。

AlbumBinding键来自plan+平台+账号+专辑选择内容hash，跨Run复用。新建成功必须返回平台album ID和可信证据，再持久化；unknown先对账，禁止再次新建。平台不支持追加时明确阻塞，不创建替代专辑。每个平台独立失败，不拖死其他目标。发布必须在歌词、封面、所选音频与权利/一致性材料齐备之后进入提交；没有实际提交端口保持准备或阻塞，不能伪造submitted。

## 可回滚迁移

迁移在单一事务保存每条旧计划原值与history引用，生成统一Plan后标记旧调度所有权为plan-center。保留原enabled；因缺少真实执行授权而阻塞与disabled分开表示。旧行和历史不删，旧调度tick/旧写入口检查所有权并拒绝再调度。未知旧配置保留原配置并标记需补全，不猜测账号、模型或专辑。回滚只还原本次记录且revision/指纹一致的行；一旦统一中心已有新的执行不允许无审核恢复双调度。

## UI

蓝白界面，沿用ui-system字体/40px按钮，新增主导航“计划中心”。列表提供启停、▶立即执行、运行阶段与完成数量、停止后续步骤、历史与错误。编辑页按任务/调度/素材/渠道/发布账号专辑组织；解释进入HelpNote/tooltip。创作中心仅手动创作，发布中心仅手动准备发布，账号/API/平台默认仍在配置中心。模型分不要求用户逐条人工审核；预算授权是一次性配置，不冒充评分审批。

## 验收矩阵

|场景|必须结果|
|---|---|
|日/周/指定时间|北京时间正确，occurrence不重复|
|手动/调试后定时|不占正式每日次数，不修改调度|
|两首与A/B|2个Item，A/B只增加版本数|
|双击/双连接并发|只创建一个活动Run，冲突明确|
|确认后配置被修改|revision/hash冲突，不能按旧摘要执行|
|运行中停止|不claim新阶段，已有结果可回收，未来计划仍启用|
|重启dispatching|unknown待对账，不自动重复扣费|
|阶段成功后重试|复用成功产物，不重建素材|
|dot不可触发|waiting_external_dot+实际请求键，无假完成|
|匹配dot入库|精确身份绑定，重复收件不重复Item|
|模型未配置|明确blocked，不永久无解释model_pending|
|规则分高但模型低|不借规则分放行，最多2次改写|
|无效评分/预算不足|有界错误/blocked，未发请求不得记录费用|
|新建专辑成功后下一次运行|复用持久化平台album ID，不重建|
|专辑unknown/不支持追加|对账/阻塞，不换专辑|
|一个平台失败|其他平台仍可完成，状态分离|
|材料不全|不得进入提交|
|迁移启用/停用计划|状态与历史保留，新旧不双调度|
|迁移回滚/冲突|原子回滚；执行后阻止危险回滚|
|正式安装/账号/外部调用|本轮均不触碰；离线fixture明确标识|

## 风险与本轮交付界限

真实dot触发、多平台专辑读写/追加、模型实时目录和无人值守发布目前有接入缺口，不能用离线fixture填补真实性。交付完整可交互计划配置与持久化运行内核、可注入且严格门禁的端口、现有评分和收件接点、离线演示/状态测试及独立Windows候选。未验证真实端口明确列入未完成项；不承诺已上线全平台自动发布。
