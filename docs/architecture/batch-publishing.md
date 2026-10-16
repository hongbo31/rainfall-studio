# 批量发布队列与外部副作用协议

目标：从作品库选择 N 首与 M 个目标，建立最多 N×M 个可见目标项，独立显示准备、上传、投稿、审核和失败。每个单元可追溯、可恢复；不能承诺在没有服务端幂等的第三方系统实现数学意义上的 exactly-once。优先避免重复投稿，宁可停在待核对。

## 1. 计划与执行单元

createPlan(workRevisionIds, destinations, mode) 冻结作品、音频/封面/歌词/视频 hash、艺名/credits、权益/AI声明、目标账号、可见性、发布日期和平台规则版本。歌名不作身份。每个 destination 包含 targetPlatform、routeId、routeAccountId、artistId、contentKind。

用户在 UI 看 publish_targets；worker 执行 submission_units。一个单元只包含一个作品发布快照、一个发行路线账号、一个有证据的目标集合。仅在该 adapter 明确支持一次提交覆盖多个目标时，将同曲 QQ+酷狗合并；默认不合并。抖音 video_post 与音乐库 audio_distribution 永不合并。覆盖关系不明确时阻塞 route_selection_required，而不是同时试两条路线。

准备时检查 delivery_claims，保证同一 recording_identity+artist+target+mode 不同时存在相互冲突的活跃投稿（即使通过不同账号/代理路线）。已通过外部渠道发行的作品可人工登记 remote id 与证据，参与防重。audio sha256 相同为确定重复；canonical recording id/ISRC 等作为辅助；重新编码导致 bytes 不同不能保证识别，提示用户确认已有发行，不能靠改标题绕过。

可见目标数与执行单元数都展示，例如“3 首 / 5 平台 / 12 次提交”；没有获批 route 的目标仍列出原因。阻塞项默认不进入最终执行批准范围；不静默丢弃勾选项。

## 2. 状态模型（执行、审核与上线正交）

SubmissionState = DRAFT | PRECHECK | BLOCKED | READY | PREPARING | UPLOADING | UPLOADED | COMMITTING | SUBMISSION_UNKNOWN | SUBMITTED | RETRY_WAIT | FAILED_PERMANENT | PAUSED | CANCELLED | MANUAL_ACTION | DUPLICATE。

ReviewStatus = unknown | pending | approved | rejected | removed。每次审核观察独立存 source(api/user_report/simulation)、observedAt、providerRawStatus（白名单）、reason；API 未提供时保持 unknown，不由时间推算 approved。

PublicationStatus = unknown | scheduled | live | unavailable | taken_down。只由独立上线证据更新，含 source、observedAt/effectiveAt、remote id/link 与原因。平台没有此能力则保持 unknown；review=approved 不赋值 live。历史观察保留，重复/乱序事件按 provider_event_id 与有效时间去重、拒绝无证据倒退；无法比较的新观察保留待核对。

| 当前/事件 | 下一状态 | 条件与显示 |
|---|---|---|
| DRAFT→预检 | PRECHECK | 冻结快照与本地检查 |
| 预检失败/缺权限/不支持 | BLOCKED | 多个 reason；修复后新检查，不制造上传进度 |
| 本地预检通过且可执行 | READY | 生产任务仍需匹配批准；能力待申请留 BLOCKED |
| 只有官方人工路径 | MANUAL_ACTION | 可导出材料包/打开官网，不调用 upload/commit |
| 重复命中活跃/已投稿 | DUPLICATE | 链接已有任务与外部回执，默认跳过 |
| 获准 READY | PREPARING→UPLOADING→UPLOADED | 本地转码/打包，传输字节和总量显示真实数值；未知总量显示不定进度 |
| UPLOADED→持久化提交意图 | COMMITTING | 同事务写 attempt、payload hash、approval、fencing token，再发请求 |
| 明确成功回执 | SUBMITTED | 保存远端 id/request id；review 通常 pending 或 unknown，不能直接 approved |
| 已越过提交边界但响应丢失/超时/崩溃 | SUBMISSION_UNKNOWN | 禁止普通重试；显示“提交结果待核对” |
| 有证据的安全可重试错误 | RETRY_WAIT | 等退避；尝试次数和 nextAttemptAt 可见 |
| 无法自动恢复的参数/权益/审核错误 | FAILED_PERMANENT 或 BLOCKED | 明确原因；审核 rejected 留在 SUBMITTED + review=rejected，不能当网络失败重发 |
| 用户暂停/退出恢复 | PAUSED | 记录 previous safe phase；恢复重新校验权限/批准/文件 |
| 未提交且成功取消 | CANCELLED | 停止后续提交；传输中协作取消保留已上传对象的清理记录 |

SUBMITTED 显示“已提交”，review=approved 显示“审核通过”，publication=live 才显示“已上线”，三列分别附来源/时间。素材上传100%≠投稿完成≠审核通过≠已上线。总体完成百分比基于本地执行阶段，标签必须写“处理进度”；审核与上线另列计数。一个失败不回滚已经提交的其他作品。

## 3. 幂等与快照

request fingerprint = SHA256(canonical JSON{schemaVersion:1, mode, workspaceId, routeId, routeAccountRemoteSubject, artistId, bindingId, bindingRevision, sortedTargetSet, recordingIdentity, releaseRevisionId, audioHash, coverHash, videoHash?, metadataHash, rightsHash, aiDisclosureHash, visibility, scheduleUtc?})。

idempotency_key = SHA256('rainfall-publish-v1:' + request fingerprint)。数据库 UNIQUE；同请求双击返回已有 unit，不再创建任务。所有 retries 保持同 key；attempt id 每次新建。适配器升级版本不自动换 key，以免把相同内容当新投稿；平台映射发生实质变化时创建新 plan 并通过既有 delivery_claims 检查。

snapshot_set_hash 绑定最终批准范围。批准后修改作品、平台、账号、AI声明、费用/可见性/封面等产生新的快照，旧 approval 不再有效。用户可保存草稿编辑，但运行中的快照不可变；不允许 Renderer 在开始后替换路径或歌词。切换登录账号必须对比 remote subject，不匹配则 BLOCKED。

二次发行/修订不是“重试”：需要明确的 platform-supported amendment 或新的 release edition、原投稿关系、原因和重新批准；现有投稿未知时不能靠“新版本”绕开核对。跨发行渠道的同一歌曲冲突由目标 claim 防住，不能只看 account 内的幂等键。

## 4. 提交意图与不确定核对

1. 在单写事务中领取 unit 租约（owner+随机 token+expiry），核对 cancel、manifest、批准、capabilities、预算，写 attempt intent；事务提交后才调用远端。
2. lease 默认60秒，每15秒续约，发请求前检查 fencing token。旧 worker 即使醒来，也不能在本地写入新状态；远端防重仍靠原 key/官方协议。Core 重启先确认旧子进程退出，再恢复租约。
3. 如果崩溃发生在 intent 落盘后，无法证明“请求未发出”，恢复到 SUBMISSION_UNKNOWN，而不是 READY。对 upload-only 的阶段，必须 adapter 明确确认尚未创建投稿且可重复/可恢复，才可安全重传；上传可能收费时还需额度核对。
4. reconcile 顺序：有官方 request id/receipt 则直接查询；有文档支持的 idempotency lookup 则按 key 查；有可靠账号投稿查询则结合内容、时间、目标和 provider id 找候选；无这些能力则要求用户在官方后台核对并录入 id/证据。
5. 结果三值：confirmed_submitted（保存回执）、confirmed_not_submitted（需要可靠官方结论，重新批准后可重试）、inconclusive（继续 UNKNOWN）。查询列表暂时没有结果不是未提交证明，考虑最终一致性。
6. 不确定状态默认30秒、2分钟、10分钟、30分钟进行只读核对，之后转人工；仅在明确能力允许且有授权时查询，不自动访问未授权接口。用户可以标注核对信息，但不能把“我不确定”变成自动重发许可。

可选 broker 与桌面应共享同 request fingerprint；broker 在服务器端进行相同幂等和账户核验，避免桌面崩溃重放。没有 broker/官方幂等时保守停住，不标称 exactly-once。

## 5. 重试、恢复与取消

“只重试失败项”只选 RETRY_WAIT 到期或有安全重试证据的失败项；排除 SUBMITTED、SUBMISSION_UNKNOWN、审核驳回、DUPLICATE、CANCELLED。可恢复网络/429/5xx 的退避基线为 5s、30s、120s、600s、1800s，full jitter，尊重更长 Retry-After；最多5次自动尝试。401/403→BLOCKED_AUTH，不循环刷新；明确参数/权益拒绝不自动重试。UNKNOWN 永不归入失败批重试。

全局并发2，单 route_account 1；媒体转码并发1；平台文档的更严限额优先。没有文档的限额不凭经验声称获准。每个账号单独暂停/取消/重试/预算与节流，平台范围403可暂停该账号其他任务。

断点恢复分层：SQLite 保存任务步骤必做；本地文件 hash 可复用；远端分片续传只有 capability.supportsResume=true 且 session 未过期时做，已确认片保存 offset+hash/ETag，过期会话重新上传前确认是否可重复且不创建投稿。没有分片能力时 UI 写“任务可恢复，当前文件需重新上传”，不能冒充字节级续传。转码中断从该派生任务重做，原件不变。

取消：READY/PREPARING 等未提交任务 CAS 写 cancel_requested，worker 在每边界检查；UPLOADING 中 abort 并停止 commit，能否清理远端临时素材依官方能力，清理失败记录 orphan，不谎称已删除。COMMITTING/UNKNOWN 无法安全撤回，取消返回 too_late_or_unknown 并核对；SUBMITTED 不适用取消未提交，删除/撤稿是独立高影响动作且不在首版。合并路由 unit 取消其覆盖目标时，提交前可取消整个 unit 并重建剩余目标计划/重新批准；提交中不得只取消其中一个目标然后宣称成功。

启动恢复：纯本地 preparation 可恢复；真实网络任务先 PAUSED 并提示用户“继续已确认范围”，检查权限与批准有效期，超过24小时的批准需重新确认；UNKNOWN 先核对。Windows 睡眠/系统时钟变化按 UTC nextAttemptAt 重算，单调计时用于进程内计时；唤醒不突发发送全部超时任务。

## 6. 审批、预算与审计

approval 只能来自用户清晰确认的 batch review 页面，由 Main 验证 UI 来源后写入；记录精确 unit/targets/accounts/snapshot hashes、可见性、允许费用上限与批准时间。默认24小时内有效，只允许当前范围内安全 retries；新增/改内容/恢复备份/账户重新绑定都会作废。关闭真实执行开关可随时撤销后续请求；已提交内容无法靠本地撤销改变。

当前阶段没有任何具体真实作品发布批准，因此生产 commit 永不执行。无资费资料时 cost=unknown，不能显示免费；无法可靠限制最大收费时采用人工路径。采用 [三类账目](artist-planning-controls.md)：生成成本/候选、成品目标、平台账号提交配额分别计数；成本账本按purpose保留生成/封面/上传收费。执行前原子占用所有适用桶并写intent；unknown保留风险占额，审核驳回不退投稿次数；跨日与合并路线严格依该文档处理。

默认发布检查点为manual且首版不可关闭。未来PublishGrant仅为禁用的契约预留；不能替代首版用户批准。艺术家/账号binding及revision纳入批准快照，撤销绑定立即阻止后续执行；默认参数调整不改变已批准快照。异常中心重试只恢复失败步骤，保留已成功音频/封面/转码和已消耗费用，不能通过重跑整个创作流程绕过防重。

audit_events 只追加：用户选择、预检、批准、队列领取、阶段、请求指纹、回执/错误码、核对、重试、取消、导入/导出。日志不包含 token、cookie、密钥、授权码、签名URL query、完整歌词/音频；错误消息先白名单清洗。事件 hash 链用于发现意外修改，不能声称能防本机管理员篡改。用户可导出脱敏审计包。

## 必测故障点

在 intent前/intent后但发包前/发包后未回执/回执到达未落盘分别 kill worker；只能安全未发的回到 READY，其余未知先核对。再测双击、两个进程、跨批同曲不同路由、token过期、相同艺名不同账号、部分成功、429、断网、睡眠、磁盘满、恢复备份、取消与提交竞态、平台状态乱序/重复事件。契约测试可注入 fake transport，但必须记录 simulation/contract-test，不访问生产平台。
