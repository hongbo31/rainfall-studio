# 共享类型、接口与模块责任

本文件为设计契约，不是已实现 API。实现放 src/shared/contracts.ts 与对应 zod schemas；所有跨进程输入在接收端验证，不信任 TypeScript 编译结果。

## 核心值类型

```ts
type UUID = string; // runtime UUID validation
type IsoUtc = string;
type Hash = string; // lowercase SHA256 hex
type Mode = 'production' | 'simulation';
type ContentKind = 'audio_distribution' | 'video_post';
type Target = 'netease' | 'qishui' | 'qqmusic' | 'kugou' | 'douyin';
type EvidenceSource = 'api' | 'user_report' | 'simulation' | 'import';
type MoneyOrCredits = {unit: string; scale: number; amount: number}; // safe integers
interface Destination {target: Target; routeId: string; accountId: UUID; artistId: UUID; bindingId:UUID; bindingRevision:number; kind: ContentKind}
interface PublishSelection {revisionIds: UUID[]; destinations: Destination[]}
interface Issue {code: string; severity:'error'|'warning'; targetId?: UUID; field?: string; message: string; fixAction?: string}
interface PreflightReport {planId:UUID; snapshotSetHash:Hash; issues:Issue[]; eligibleUnitIds:UUID[]; checkedAt:IsoUtc; rulesVersions:Record<string,string>}
interface ApprovalScope {planId:UUID; snapshotSetHash:Hash; unitIds:UUID[]; maximumCost:MoneyOrCredits[]; visibility:Record<UUID,string>}
interface Progress {stage:string; bytesDone?:number; bytesTotal?:number; fraction?:number; observedAt:IsoUtc}
interface Receipt {providerRequestId?:string; remoteId:string; remoteUrl?:string; acceptedAt:IsoUtc; source:EvidenceSource}
type ReviewStatus = 'unknown'|'pending'|'approved'|'rejected'|'removed';
type PublicationStatus = 'unknown'|'scheduled'|'live'|'unavailable'|'taken_down';
type Observation = {remoteId:string;reasonCode?:string;message?:string;observedAt:IsoUtc;effectiveAt?:IsoUtc;providerEventId?:string;source:EvidenceSource} & ({dimension:'review';status:ReviewStatus}|{dimension:'publication';status:PublicationStatus});
interface Capability {operation:string; status:'available'|'requires_authorization'|'requires_approval'|'manual_only'|'unsupported'|'unverified'|'temporarily_unavailable'; reason:string; evidenceUrl?:string; checkedAt:IsoUtc; supportsResume:boolean; supportsIdempotency:boolean; supportsLookup:boolean; supportsCancel:boolean; rulesVersion:string}
interface DomainError {code:string; message:string; retry:'safe'|'never'|'reconcile_first'|'reauthorize'; phase:string; providerCode?:string; retryAfterMs?:number}
type Result<T> = {ok:true;value:T}|{ok:false;error:DomainError};
```

PublishPlan 和 ReleaseSnapshot 必须严格定义为 storage-migration.md 所列冻结字段（DTO不含路径、token或任意API URL）；state 用 batch-publishing.md 的精确枚举。AssetRef = {id:UUID,sha256:Hash,kind:string,mime:string,bytes:number}；WorkRevision = {id:UUID,workId:UUID,revisionNo:number,title:string,artistId:UUID,story:string,lyrics:string,prompt:string,parameters:Record<string,string>,assetIds:UUID[],rightsRecordIds:UUID[],aiDisclosure:AiDisclosure}。ContentOrigin = 'none'|'assisted'|'generated'|'unknown'；AiDisclosure = {audio:ContentOrigin,lyrics:ContentOrigin,cover:ContentOrigin,video:ContentOrigin,providers:string[],userAttestedAt?:IsoUtc}。

## 应用服务（全部异步，数据库只在 Core）

- WorkspaceService.open(root:string,mode:Mode): Promise<WorkspaceHandle>；main决定root，renderer不能传root。
- AssetService.importSelected(token:UUID,role:string): Promise<Result<AssetRef>>；导入token绑定主进程选择结果、workspace、一次性使用和5分钟过期。
- AssetService.describe(id:UUID): Promise<Result<AssetMetadata>>；probe metadata 无任意源路径。
- WorkService.list(query:WorkQuery): Promise<WorkPage>；saveDraft(workId:UUID,expectedRevision:number,patch:DraftPatch): Promise<Result<WorkRevision>>；createVersion(workId:UUID): Promise<Result<WorkRevision>>；并发修订冲突不能覆盖。
- LegacyMigration.preview(importToken:UUID): Promise<MigrationPreview>；apply(previewId:UUID): Promise<Result<MigrationReceipt>>。
- BackupService.create(destinationToken:UUID): Promise<Result<BackupReceipt>>；inspect(importToken:UUID): Promise<RestorePreview>；restore(previewId:UUID): Promise<Result<RestoreReceipt>>。
- PublishService.createPlan(input:PublishSelection): Promise<Result<PublishPlan>>；preflight(planId:UUID): Promise<PreflightReport>；approve(scope:ApprovalScope): Promise<Result<{approvalId:UUID}>>；start(planId:UUID,approvalId?:UUID): Promise<Result<BatchView>>。
- PublishService.retryFailed(batchId:UUID): Promise<Result<RetrySummary>>；cancelPending(batchId:UUID,unitIds:UUID[]): Promise<Result<CancelSummary>>；reconcile(unitId:UUID): Promise<Result<ReconcileResult>>；pause(batchId:UUID): Promise<void>；resume(batchId:UUID,approvalId?:UUID): Promise<Result<BatchView>>。
- QueueRunner.tick(now:IsoUtc): Promise<TickResult>；recover(): Promise<RecoveryReport>；shutdown(): Promise<void>。通过注入 Clock、Repository、AdapterRegistry 测故障，不用 setTimeout 等真时间测退避。
- MediaService.prepareVideo(revisionId:UUID,presetId:string): Promise<Result<AssetRef>>；按冻结资产与 preset hash 幂等，本地音频+封面合成，不调用第三方。
- MetricsService.importCsv(importToken:UUID,mapping:CsvMapping): Promise<Result<MetricImportReceipt>>；read(query:MetricQuery): Promise<MetricSeries[]>。
- AccountService.list(): Promise<AccountView[]>；refreshCapabilities(accountId:UUID): Promise<Capability[]>；connect(providerId:string): Promise<Result<AuthStart>> 仅在 capability 允许时开始正规 OAuth，纯手动账号不伪造授权。

## 艺人、日计划和控制契约

业务规则及枚举语义以 [艺人与计划控制](artist-planning-controls.md) 为准。所有DTO不带秘密，expectedRevision用于乐观并发；创建绑定不是授予官方权限。

```ts
interface CreationDefaults {
 genreIds:string[]; voice:'male'|'female'|'duet'|'instrumental';
 lyricTone:string; bpmRange:{min:number;max:number}; coverStyleBrief:string;
 language?:string; mood?:string; durationSeconds?:number;
}
type CreationOverrides = Partial<CreationDefaults>; // absent=inherit；null不合法
interface ResolvedCreationConfig {
 values:CreationDefaults; hash:Hash;
 origins:Record<string,{level:'app'|'artist'|'plan'|'track';revision:number}>;
}
type ArtistOperation = 'prepare'|'generate'|'submit'|'read_metrics';
interface ArtistAccountBinding {
 id:UUID;workspaceId:UUID;artistId:UUID;accountId:UUID;target:Target| 'suno'|'yourmusic';
 kind:'generation'|ContentKind;allowedOperations:ArtistOperation[];
 remoteArtistId?:string;revision:number;
 verification:'local_only'|'verified'|'revoked';source:EvidenceSource;
}
type Checkpoint = 'lyrics'|'candidate'|'cover'|'finished'|'publish';
interface CheckpointPolicy {
 revision:number;steps:Record<Checkpoint,'manual'|'automatic'>;
 // 首版schema强制steps.publish==='manual'
}
interface DailyPlanInput {
 artistId:UUID;timezone:string;localTime:string;enabled:boolean;
 overrides:CreationOverrides;story:string;seriesId?:UUID;
 candidateLimit:number;finishedGoal:number;costLimits:MoneyOrCredits[];
 bindingIds:UUID[];destinations:Destination[];policy:CheckpointPolicy;
}
interface CreationRunRequest {
 artistId:UUID;planId?:UUID;planRevision?:number;overrides:CreationOverrides;
 story:string;seriesId?:UUID;source:'manual'|'scheduled'|'missed_run_confirmed';
 // Core派生run唯一键/计划日，renderer不能伪造scheduler来源
}
type StepState = 'pending'|'running'|'waiting_confirmation'|'waiting_external'|
 'succeeded'|'failed'|'unknown'|'skipped'|'cancelled';
type RemoteOutcome = 'not_submitted'|'submitted'|'unknown'|'not_applicable';
type ResourceKind = 'cost'|'candidate'|'submission_target'|'submission_route';
interface ReservationRequest {bucketId:UUID;amount:number;unit:string;scale:number}
interface ResourceEvidence {source:EvidenceSource;sourceEventId:string;occurredAt?:IsoUtc;reference?:string}
interface CostAuthorizationScope {
 artistId:UUID;planId?:UUID;providerId:string;accountId:UUID;bindingId:UUID;
 startsAt:IsoUtc;expiresAt:IsoUtc;maximumCost:MoneyOrCredits[];candidateLimit:number;
}
interface PublishGrantScope { // 预留，首版所有执行路径返回OPERATION_UNSUPPORTED
 artistId:UUID;planId:UUID;destinations:Destination[];visibility:Record<string,string>;
 startsAt:IsoUtc;expiresAt:IsoUtc;timezone:string;dailyLimit:number;totalLimit:number;
 maximumCost:MoneyOrCredits[];contentRuleId:string;contentRuleRevision:number;
}
interface ExceptionCase {
 id:UUID;runId?:UUID;stepId?:UUID;unitId?:UUID;artistId:UUID;accountId?:UUID;
 reasonCode:string;remoteOutcome:RemoteOutcome;observedAt:IsoUtc;
 safeActions:('retry_step'|'reconcile'|'reauthorize'|'edit'|'import'|'cancel_pending')[];
 assetIds:UUID[];ledgerOperationIds:UUID[];evidenceSource:EvidenceSource;
}
```

- ArtistProfileService.create/updateDefaults(artistId,expectedRevision,defaults)/resolveConfig(artistId,planRevision,overrides)；返回版本化资料与ResolvedCreationConfig。BindingService.create/revoke/check(bindingId,operation,scope)；check每次执行重新计算交集，不接受Renderer给定有效权限。
- CreationService.start(request)/getRun(runId)/confirmStep(runId,stepId,inputHash)/retryStep(runId,stepId,expectedVersion)；成功步骤输入hash未变化时复用输出；失败安全性由Core判断。
- DailyPlanService.save(planId?,expectedRevision,input)/previewNext(planId,count)/setEnabled(planId,enabled)/runMissed(planId,localDate)；Scheduler.tick(now)/recover()使用注入Clock/TimezoneResolver，调用受信内部CreationService；closed应用无调度。
- ResourceLedger.reserveAll(operationId,requests,tx)/settle(operationId,evidence,actuals)/release(operationId,evidence)/rolloverUnsent(operationId,now)；与intent共享Core事务；settle可记部分明确结果，未核定部分保留。复合唯一键防重复结算。
- FinishedGoalService.accept(workId,revisionId,planId,goalDate)/revoke(completionId,reason)；校验必需素材与检查点，一首独立作品不能被同计划跨日反复记为新成品。
- WorkflowService.evaluateCheckpoint(runId,stepId)/authorizeCost(scope)/revokeAuthorization(id)；用户确认来自受信IPC；worker仅消费授权。createPublishGrant首版禁用，不能用DTO保存绕过。
- ExceptionService.list(query)/get(id)/retryStep(id,expectedVersion)/reconcile(id)；查询关联资产、账本和三维远端状态，动作复用Creation/Publish服务，不直接改DB状态。

以上服务统一返回Promise<Result<对应DTO>>，分页list返回items/cursor；需要实现的每个DTO、错误码与zod schema先在Task2建立，不以any替代。参数验证：timezone须受支持IANA、localTime=HH:mm、counts为非负安全整数、BPM区间20..300；空成本上限不是无限，代表没有付费权限。计划调度revision/slot和费用证据仅可由Core/adapter产生；手工记账明确source=user_report且不能单独把UNKNOWN变为安全重发。

## 适配器（内部，不能由 Renderer 任意调用）

```ts
interface AdapterContext {
 workspaceId:UUID; mode:Mode; account:VerifiedAccount;
 signal:AbortSignal; idempotencyKey:string;
 // secrets/transport 由受控 registry 注入，不是 renderer DTO
 emit(progress:Progress):void;
}
interface ReleaseAdapter {
 id:string;
 getCapabilities(account:AccountView):Promise<Capability[]>;
 coverage(snapshot:ReleaseSnapshot,destinations:Destination[]):Promise<CoverageResult>;
 validate(snapshot:ReleaseSnapshot,rules:RuleSet):Promise<Issue[]>;
 prepareLocal(snapshot:ReleaseSnapshot):Promise<Result<PreparedPackage>>;
 upload(pkg:PreparedPackage,checkpoint:UploadCheckpoint|null,ctx:AdapterContext):Promise<Result<UploadHandle>>;
 commit(upload:UploadHandle,snapshot:ReleaseSnapshot,ctx:AdapterContext):Promise<Result<Receipt>>;
 reconcile(attempt:AttemptView,ctx:AdapterContext):Promise<Result<ReconcileResult>>;
 query(receipt:Receipt,ctx:AdapterContext):Promise<Result<Observation>>;
 cancelUpload(upload:UploadHandle,ctx:AdapterContext):Promise<Result<{cancelled:boolean}>>;
}
type ReconcileResult = {kind:'confirmed_submitted';receipt:Receipt}|{kind:'confirmed_not_submitted';evidence:string}|{kind:'inconclusive';reason:string};
interface GenerationAdapter {
 id:string;
 getCapabilities(account:AccountView):Promise<Capability[]>;
 preparePrompt(revision:WorkRevision):PromptBundle;
 estimate(request:GenerationRequest):Promise<Estimate>; // unknown可用，不猜价
 submit(request:GenerationRequest,ctx:AdapterContext):Promise<Result<GenerationReceipt>>;
 query(receipt:GenerationReceipt,ctx:AdapterContext):Promise<Result<GenerationObservation>>;
 reconcile(operationId:UUID,ctx:AdapterContext):Promise<Result<GenerationReconcileResult>>;
 importResult(input:ImportedGenerationResult):Promise<Result<WorkRevision>>;
}
interface CoverAdapter {
 id:string;
 prepareTask(revision:WorkRevision,brief:CoverBrief):CoverTask;
 importResult(taskId:UUID,assetId:UUID,provenance:Provenance):Promise<Result<CoverVersion>>;
 generate?(task:CoverTask,ctx:AdapterContext):Promise<Result<GenerationReceipt>>;
}
interface AnalyticsAdapter {
 id:string;
 capabilities(account:AccountView):Promise<Capability[]>;
 readMetrics(query:MetricQuery,ctx:AdapterContext):Promise<Result<MetricPoint[]>>;
}
```

GenerationReconcileResult = {kind:'confirmed_completed';receipt:GenerationReceipt;outputIds:string[]}|{kind:'confirmed_not_accepted';evidence:string}|{kind:'inconclusive';reason:string}；收费结算与候选结果分开核对，明确无作品不等于未收费。

ManualReleaseAdapter 只暴露 prepareLocal/export 和 capability，其 upload/commit 必须返回 OPERATION_UNSUPPORTED，不能返回 Receipt。SimulationAdapter 返回模拟回执前缀 sim:、source=simulation，registry 拒绝其进入 production。Official adapter 未获批时返回 CAPABILITY_REQUIRES_APPROVAL；未获授权时 AUTH_REQUIRED，测试 fixtures 不能更改 capability。

PreparedPackage = {id:UUID,snapshotHash:Hash,manifestAssetId:UUID,assetIds:UUID[],kind:ContentKind}；UploadHandle = {id:UUID,providerUploadId:string,expiresAt?:IsoUtc}；UploadCheckpoint 的 opaque secret 只用 credentialRef，明文签名地址不进 DTO/日志/备份。

## IPC 白名单

window.rainfall 仅暴露 pickFiles、importSelected、listWorks、saveDraft、preparePlan、preflight、approveBatch、startBatch、retryFailed、cancelPending、getBatch、prepareVideo、exportBackup、restoreBackup、importLegacy、importReport、listAccounts、openOfficialPage、subscribeEvents，以及本补充的listArtists/updateArtistDefaults、createBinding/revokeBinding、resolveCreationConfig/startCreation/confirmStep、saveDailyPlan/previewDailyPlan/enableDailyPlan/runMissedPlan、getResourceSummary/authorizeCost/revokeAuthorization、listExceptions/getException/retryExceptionStep/reconcileException；不暴露Scheduler.tick、任意ledger写入或PublishGrant开关。对应 Main handler 逐个定义 schema、长度/数量上限和授权上下文。单批最多100首×5目标（账号多个则实际目标条数≤500），大批分批；字符串最大歌词100000字符，故事20000，普通元数据500，拒绝超限。

openOfficialPage 只收 providerId，不收任意 URL；输出配置内 HTTPS 白名单。subscribeEvents 只发 {seq,type,entityId,redactedPayload}，Renderer 对 lastSeq 去重并可重新读取快照。禁止 raw path/SQL/command/secret/network proxy IPC。测试通过正常业务接口运行，不依赖危险调试桥。

## 目录映射

src/main/{bootstrap,windows,ipc,protocol,credentials,lifecycle}.ts
src/preload/index.ts
src/shared/{contracts,schemas,errors}.ts
src/core/db/{connection,migrations,repositories}.ts
src/core/assets/{import,probe,store}.ts
src/core/works/{service,revisions,legacy-migration}.ts
src/core/publish/{planner,preflight,snapshot,approval,runner,reconcile,repository}.ts
src/core/media/{ffmpeg,video-presets,cover-render}.ts
src/core/backup/{export,restore,manifest}.ts
src/core/accounts/{service,capabilities}.ts
src/core/artists/{service,bindings,defaults}.ts
src/core/creation/{service,steps,checkpoints}.ts
src/core/plans/{service,scheduler,timezone}.ts
src/core/budget/{service,resources,goals}.ts
src/core/exceptions/service.ts
src/core/metrics/{csv,service}.ts
src/adapters/{registry,manual-release,simulation,suno,yourmusic,douyin,netease,tme,qishui}/
src/renderer/{app,pages,components,styles}/
tests/{unit,integration,contract,e2e,security,fixtures}/

不要生成一个新的超长 app.ts 把文件/队列/网络/页面重新耦合。原 web/ 留作可运行样式/迁移基线，正式代码不把其全局 state 当数据库。
