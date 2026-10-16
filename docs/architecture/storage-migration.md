# 本地数据库、素材库、备份与原型迁移

## 目录和所有权

正式应用固定 appId com.rainfall.studio，userData 使用独立 RainfallStudio 目录；开发/测试通过显式配置使用工作区临时目录，不读写生产库。设置页显示实际绝对位置，安装器目录只读。

```
RainfallStudio/
  production/library.sqlite         # 正式数据与队列
  simulation/library.sqlite         # 演练数据，绝不复用真实提交记录
  media/sha256/ab/<hash>.<ext>       # 不可变受管原件、派生音频/封面/视频
  staging/<operation-id>/           # 写入未完成的临时对象
  secrets/<account-id>.bin          # DPAPI 密文，仅主进程可解密
  logs/YYYY-MM-DD.jsonl             # 脱敏；默认滚动 30 天/总 100 MB
  backups/                         # 用户选择的备份目录可在外部磁盘
  migration-receipts/
```

生产库与模拟库物理分离；模拟默认使用复制出的样本或只读资产引用，无法取得凭据服务。media 可以共享不可变 bytes，但必须由当前库的 asset 引用授权，模拟删除不能删除生产引用的文件。GC 统一扫描两库引用，人工触发且保留 30 天回收区；首版默认不自动 GC。

事件时间存 UTC ISO8601，UI 本地化；每日计划与配额桶另存 IANA timezone、local_date、UTC起止及规则版本。UUID 作实体 ID；数量用整数，钱用 currency+minorUnits，平台 credits 用 quantity+unitScale（禁止与人民币混算）；所有表有 workspace_id，账号另有 provider_id 和可选 remote_subject，通过独立绑定表连接艺人。数据库 schema_version 与 app_version 独立。

## SQLite 表族（首版数据库 schemaVersion=1，与原型 JSON schema=1 独立）

| 表 | 最小字段/约束 |
|---|---|
| workspaces / artists | id、display_name、created_at；默认一个个人 workspace，可多个艺名 |
| series / albums / album_tracks | story_arc、chapter_order；album_tracks(work_id,track_no)；版本关系不靠歌名关联 |
| works | id、workspace_id、title、artist_id、story、series_id、album_id、current_revision_id、origin(imported/generated/demo)、created/updated_at |
| work_revisions | id、work_id、parent_id、revision_no、title、lyrics、prompt、voice/style/language/mood/tempo/duration、credits_json、ai_disclosure_json；append-only |
| assets | id、workspace_id、sha256、relative_path、kind、mime、bytes、duration_ms、audio/video/image probe_json、origin、created_at；unique(workspace_id,sha256) |
| revision_assets | revision_id、asset_id、role(audio_master/audio_A/audio_B/cover/video/rights_evidence)、version_label；FK 防悬空 |
| provenance / rights_records | revision_id、generation_provider、external_job_id（可空）、generated_at、source_url（无 token）、terms_url/version/date、commercial_use(yes/no/unknown)、territories、expires_at、evidence_asset_id、user_attested_at |
| platform_accounts | id、workspace_id、provider_id、display_identity、remote_subject、scopes_json、auth_status、expires_at、credential_ref（不是明文）、last_verified_at；不直接归属艺人；身份变更不能悄悄复用旧任务 |
| artist_account_bindings | id、workspace_id、artist_id、account_id、target_platform、content_kind、allowed_operations、remote_artist_id、verification_status/source、revision、revoked_at；有效绑定唯一，账号与艺人均同workspace；权限取平台与本地范围交集 |
| artist_profile_versions | artist_id、revision、defaults_json、created_at；不可变；配置含曲风/人声/歌词语气/BPM范围/封面风格 |
| creation_plans / plan_revisions | id、artist_id、active_revision、enabled；revision保存timezone/local_time、overrides、目标/限额、checkpoint_policy、账号绑定；只影响未来运行 |
| creation_runs / run_steps | plan_id可空、schedule_revision、scheduled_local_date、slot、resolved_utc/offset、resolved_config/hash、source_versions、state；unique(plan_id,scheduled_local_date,slot)，不因revision改变再建当日实例；step含input_hash、operation_id、output_refs、attempt、safe_retry、remote_outcome、checkpoint、error_code；成功输出可复用 |
| capability_snapshots | adapter_id/version、account_id、operation、status、reason_code、evidence_url、checked_at、rules_version；观察时效不能作为授权本身 |
| release_snapshots / snapshot_assets | revision_id、canonical_json、sha256、rules_version、rights_hash、AI声明、冻结的账号/可见性/平台配置；不可变，全部资产 hash 引用 |
| publish_batches | id、mode、workspace_id、snapshot_set_hash、created_by、created_at、pause_requested、approval_id；batch 状态由子项计算 |
| publish_targets / status_observations | id、batch_id、work_id、snapshot_id、target_platform、account_id、binding_id/version、submission_unit_id、delivery_status、review_status、publication_status、remote_id/url；观察历史含dimension、source、observed_at/effective_at、reason_code、provider_event_id；审核通过不推定上线 |
| submission_units | id、batch_id、route_id、route_account_id、target_set_json、snapshot_hash、idempotency_key UNIQUE、state、attempt_count、next_attempt_at、lease_owner/token/until、cancel_requested、remote_receipt、upload_checkpoint_ref |
| delivery_claims | recording_identity+artist_id+target_platform+mode 的占位；可关联 route/account，跨发行路由防重复；活跃占位唯一，状态历史不删除 |
| attempts / upload_checkpoints | unit_id、attempt_no、request_hash、intent_committed_at、dispatch_at、ack_at、provider_request_id、outcome、sanitized_error；分片 hash/ETag/偏移/到期时间，上传签名地址不明文落表 |
| approvals | id、mode、batch/snapshot_set_hash、批准的 unit_ids+targets+accounts+visibility、cost_limits、approved_at、expires_at、revoked_at；执行工人不可自行生成 |
| audit_events / outbox | 本地 seq、entity_id、type、actor、prev_hash、event_hash、payload_redacted、created_at；outbox 同事务发布 UI 事件，重放按 seq 去重 |
| resource_buckets / resource_ledger | kind(cost/candidate/submission_target/submission_route)、scope_hash、account/provider/artist/plan、unit、timezone/local_date/UTC范围、rule_version、limit；append-only reserve/settle/release/adjustment；operation+bucket+event+source_event唯一；多桶与intent同事务，unknown保留风险占额 |
| finished_goals / completion_events | plan/artist/goal_date、target_count；work_id、accepted_revision_id、event(complete/revoke)、reason、source_event_id；unique(plan_id,work_id)的有效完成关联唯一目标日，跨日移动需撤销/重记并审计，不以版本/平台数计数 |
| workflow_policies / cost_authorizations | 不可变策略版本；付费授权scope含plan/artist/provider/account、时间窗、成本/候选上限、revoked_at；本地自动不等于付费批准；未来publish_grants只预留契约，首版禁用 |
| exception_cases | run_id/step_id/unit_id、reason_code、state、remote_outcome、safe_actions、evidence_refs、opened/resolved_at；费用从账本关联读取，不复制可漂移余额 |
| metric_imports / metric_points | 文件 hash、source、report_date/timezone、account/target/remote_id、metric_name、value、observed_at、imported_at；同一维度+周期 UPSERT 明确替换规则，不把累计快照相加 |
| migration_history / backup_history | migration_id、source_hash、schema_version、result_counts、created_at、manifest_hash；相同原型备份只导入一次 |

数据库初始化 foreign_keys=ON、journal_mode=WAL、synchronous=FULL、busy_timeout=5000。事务短小；任何网络、媒体转码、大文件复制必须在事务外。用 BEGIN IMMEDIATE + 条件更新领取租约；单写进程崩溃由 main 重启，但队列恢复遵循发布协议，不从进程重启直接推出重试安全。

## 素材导入与播放

1. Main 原生选择文件，产生一次性 import token，不给 Renderer 任意路径读写权。Core 在允许的来源文件上流式读取；检测文件头而非只看扩展名。
2. 写到 staging，同时 SHA256；使用受信 ffprobe 解码探测，报告实际时长/采样率/声道/编码。图片只接 PNG/JPEG/WebP，首版不接 SVG/HTML。本地上限音频 2 GiB、图像 50 MiB、视频 4 GiB，像素总数≤100MP；这些是本地资源保护值，不是平台规格。
3. fsync 临时文件，同卷原子重命名到 hash 路径，再事务插入 asset+关联。崩溃后残留孤立文件可查、可清理；数据库不能引用未完成文件。目标已存在时验证 hash 并复用。
4. 保存原文件，派生缩略图、封面排版和视频另建资产，记录 parent asset 与参数 hash。导入后删除/移动外部原文件仍可播放受管副本。
5. 播放通过 media://asset/id，支持 Range seek；返回路径前检查库归属、类型和实际 hash/存在性。音频丢失显示修复/重新定位，不用模拟波形或假播放进度。
6. A/B 是 revision_assets 的两个明确音频引用；切换停止当前 audio 并 load，时间轴按实际音频长度。元数据存数据库，退出后可恢复选中的作品但不自动播放。

磁盘空间预估不足时在复制/转码之前阻塞；ENOSPC 中途失败保留原件、回滚引用、显示原因。长路径、中文、emoji、重名文件和只读源均需测试。导出文件名清洗 Windows 保留名/尾空格/路径分隔符，UUID 保证独立，不以用户歌名拼任意目录。

## 备份/恢复

格式 .rainfall-backup.zip：manifest.json（formatVersion、schemaVersion、appVersion、created_at、每对象 bytes/SHA256）、在线一致性数据库快照、全部被引用受管资产、授权附件、非秘密设置。使用 SQLite backup API 取得一致快照；按快照引用的不可变 assets 复制。短暂暂停 GC/迁移，允许日常只读和已安全持久化的本地操作。禁止直接复制正在变化的 WAL 数据库三件套后宣称一致。

不包含平台令牌、client_secret、签名上传 URL、真实发布审批能力、浏览器配置。默认普通本地备份，界面说明含私人作品/权益附件且未加密；加密备份不在首版。恢复前验证 ZIP 路径、拒绝 ../、绝对路径、symlink/reparse、重复条目；流式解压设文件数100000/总展开量500GiB及剩余空间上限，可人工调低，超限明确退出。先校验所有 hash 与 SQLite integrity_check/foreign_key_check，在新目录 staging 导入，成功后保留旧库并原子切换。

恢复后的外部副作用必须冻结：account auth_status=reauth_required；approval、cost_authorizations 全部作废；计划enabled=false，恢复向导逐项重新启用且不追补历史。已确认 remote id/审核/上线观察、资源账目与未知占额保留；所有 in-flight/READY/RETRY_WAIT/UNKNOWN 的真实单元进入 PAUSED 或 SUBMISSION_UNKNOWN，不自动发起任何请求。恢复向导要求重新授权、核对可能已提交内容、对尚未提交项重新批准。原设备与恢复副本并存会造成跨设备重复风险，首版不支持多设备同时调度；显示恢复来源并提示只选一个活动发布设备，真实适配器仍需远端幂等/核对。

艺人默认、日计划唯一键、三类账目、跨日处理及异常恢复的规则见 [艺人与计划控制](artist-planning-controls.md)。资源操作唯一键与外部回执号使用复合scope（provider/account/mode），不能将不同平台相同字符串ID误判为同一扣费。备份保留授权的脱敏审计历史，但不导出可继续执行的付费/发布授权能力。

## 原型迁移（保留原有数据）

不读取/扫描 Chrome/Edge 个人 profile，不复制它们的 cookies。提示用户在原型导出 rainfall-backup.json，然后在桌面应用选择文件。导入 source hash 去重；保存原 JSON 只读副本到 migration-receipts，完整 schema/长度/字段白名单校验。原型 assets 只有 cover data URL；严格允许 image/png/jpeg/webp base64，解码复制到素材库后再引用。不得把原 data URL 当 HTML/CSS 注入。

迁移 works、歌词快照、艺名、故事、预算设置、授权文字；旧模拟任务只迁入 simulation 的历史，绝不能变成真实待提交任务。旧 review='模拟…' 保留演练标识。旧报表按其来源迁入并标记 legacy-import，检查累计指标重复。旧音频 blob URL 无法迁移，作品标 missing_audio，要求用户导入原音频文件。旧 localStorage 和 web/ 文件完全保留，导入失败不影响旧原型。

数据库后续升级用编号 SQL migrations + checksum，每次升级前 backup，单事务提交迁移；旧版本遇未来 schema 拒绝写入，允许导出诊断。降级不自动逆改库，用户可恢复升级前备份。用户正式数据绝不进 Git。
