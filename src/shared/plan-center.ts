import {AccountIdentityPublishScopeSchema} from './account-identity';
import { z } from 'zod';
import {CreationTaskDraftSchema,GenerationRoutingSchema,RouteSnapshotSchema} from './generation-config';
import { InboxId } from './inbox';
import { FlowMusicCreditPolicySchema } from './production-flow';
import { DownloadArchiveFolderSchema } from './download-archive';
import { fanqieDirectoryPreferencesSchema } from './fanqie-downloads';
import { artistProfileSchema, storedSecondSingerSchema } from './local-artist';
import { lyricRewriteLimit, LyricScoreSchema } from './lyric-writing';
import { platformTargets } from './platform-config';
import { isLocalPublicationWorkflow, PlanWorkflowGraphSchema, workflowPublicationPlatforms } from './plan-workflow-graph';
import { WorkflowBrowserMusicSchema, WorkflowPuleSchema } from './plan-workflow-fields';
export { PlanWorkflowGraphSchema, connectedPlanWorkflowGraph, type PlanWorkflowGraph } from './plan-workflow-graph';

const id = z.string().trim().min(1).max(500);
const revision = z.number().int().positive();
const stamp = z.iso.datetime({ offset: true });
const record = z.record(z.string(), z.unknown());
const onceSchedule = z.strictObject({ kind: z.literal('once'), localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v) });
export const PlanCenterScheduleSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('daily'), localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }),
  z.strictObject({ kind: z.literal('weekly'), localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).refine(v => new Set(v).size === v.length) }),
  onceSchedule,
]);
export const PlanCenterAlbumSelectionSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('existing'), albumId: id }),
  z.strictObject({ mode: z.literal('new'), title: z.string().trim().min(1).max(200), description: z.string().max(2000).optional() }),
]);
export const PlanCenterPublishTargetSchema = z.strictObject({ identityBindingId:z.uuid().optional(),identitySnapshot:AccountIdentityPublishScopeSchema.omit({externalState:true}).optional(),platform: id, accountId: id, enabled: z.boolean().default(true), album: PlanCenterAlbumSelectionSchema });
const workflowPublicationSchema = z.strictObject({
  platform: z.enum(platformTargets), accountId: z.uuid(),
  accountKey: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  configurationHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  fanqieBatch: fanqieDirectoryPreferencesSchema.optional(),
}).refine(target => target.platform === 'fanqie' ? !!target.accountKey === !!target.configurationHash :
  !target.accountKey && !target.configurationHash && !target.fanqieBatch);
export type PlanWorkflowPublicationTarget = z.infer<typeof workflowPublicationSchema>;
const PlanWorkflowSchema = z.strictObject({
  accountId: id,
  platform: z.enum(platformTargets).optional(),
  graph: PlanWorkflowGraphSchema.optional(),
  pule: WorkflowPuleSchema.optional(),
  browserMusic: WorkflowBrowserMusicSchema.optional(),
  publications: z.array(workflowPublicationSchema).max(20).optional(),
  mode: z.enum(['inspiration', 'musician']),
  inspiration: z.string().trim().max(16_000),
  maxRewrites: z.number().int().min(0).max(lyricRewriteLimit),
  targetScore: LyricScoreSchema.optional(),
}).refine(v => v.mode === 'inspiration' ? !!v.inspiration : !v.inspiration, 'WORKFLOW_INSPIRATION_REQUIRED')
  .refine(v => !!v.graph || !!v.platform, 'WORKFLOW_PLATFORM_REQUIRED')
  .refine(v => !v.pule || v.graph?.nodes.includes('music:yourmusic'), 'WORKFLOW_PULE_NODE_REQUIRED')
  .refine(v => !v.browserMusic || !v.pule && v.graph?.nodes.includes('music:' + v.browserMusic.provider), 'WORKFLOW_MUSIC_NODE_REQUIRED')
  .refine(v => {
    const platforms = workflowPublicationPlatforms(v.graph), targets = v.publications ?? [];
    return new Set(targets.map(target => target.platform)).size === targets.length && targets.every(target => platforms.includes(target.platform));
  }, 'WORKFLOW_PUBLICATION_SCOPE');
const PlanWorkflowSnapshotSchema = z.strictObject({
  accountName: z.string().min(1),
  artist: artistProfileSchema,
  secondSinger: storedSecondSingerSchema.optional(),
  template: z.strictObject({ id: z.uuid(), name: z.string(), revision }).nullable(),
});
export const PlanCenterPlanSchema = z.strictObject({
  artistSnapshot:z.strictObject({id:z.string(),revision:z.number().int().positive(),name:z.string(),defaults:z.record(z.string(),z.unknown())}).optional(),
  origin:z.enum(['plan','manual']).optional(),routing:GenerationRoutingSchema.optional(),routeSnapshot:RouteSnapshotSchema.optional(),storyContext:z.strictObject({storyBeat:z.string().max(10000),storyStage:z.string().max(1000).default('')}).optional(),
  id, revision: revision.default(1), title: z.string().trim().min(1).max(200), artistId: id.or(z.literal('')),
  enabled: z.boolean().default(false), timezone: z.literal('Asia/Shanghai').default('Asia/Shanghai'),
  schedule: PlanCenterScheduleSchema, count: z.number().int().min(1).max(20).default(1),
  theme: z.string().max(2000).default(''), styleTemplate: z.string().max(4000).default(''),
  songType: z.enum(['vocal','instrumental']).optional(),
  creationDraft: CreationTaskDraftSchema.optional(),
  workflow: PlanWorkflowSchema.optional(),
  workflowSnapshot: PlanWorkflowSnapshotSchema.optional(),
  distinctLyrics: z.literal(true).optional(),
  outputs: z.strictObject({ lyrics: z.boolean(), cover: z.boolean(), music: z.boolean() }).default({ lyrics: true, cover: false, music: false }),
  material: z.strictObject({ source: z.enum(['dot','manual','provider','pule_prompt','creation','workflow']).default('dot'), channel: z.string().max(500).default(''), identity: z.string().max(500).default(''), expectedExternalItemIds: z.array(InboxId).max(20).optional() }),
  text: z.strictObject({ profileId: id.optional(), profileRevision: revision.optional(), modelId: id.optional(), maxOutputTokens: z.number().int().min(256).max(16384).optional(), budgetMicros: z.number().int().positive().max(100_000_000).optional(), consent: z.boolean().default(false), threshold: z.number().min(0).max(100).default(75), maxRewrites: z.number().int().min(0).max(2).default(2), maxScoreRetries: z.number().int().min(0).max(2).default(2) }),
  music: z.strictObject({ route: z.enum(['suno_official','pule','yourmusic','pule_browser','suno_cn_browser','manual']), profileId: id.optional(), profileRevision: revision.optional(), modelId: id.optional(), budgetCredits: z.number().int().positive().optional(), maxCostPerRequestCredits: z.number().int().positive().optional(), pricingEvidence: z.string().max(1000).optional(), creditPolicy: FlowMusicCreditPolicySchema.optional(), consent: z.boolean().default(false), versionPolicy: z.enum(['first','manual']).default('first') }),
  publishTargets: z.array(PlanCenterPublishTargetSchema).max(20).refine(v => new Set(v.map(t=>`${t.platform}\0${t.accountId}`)).size===v.length,'DUPLICATE_TARGET').default([]),
  fanqie:z.strictObject({accountId:z.uuid().optional(),accountKey:z.string().regex(/^[a-f0-9]{64}$/),configurationHash:z.string().regex(/^[a-f0-9]{64}$/),materialsConsent:z.literal(true)}).optional(),
  catchUp: z.strictObject({ mode: z.enum(['latest','skip','bounded']).default('latest'), limit: z.number().int().min(1).max(5).default(1) }).default({ mode:'latest',limit:1 }),
  authorization: z.strictObject({ text: z.boolean().default(false), music: z.boolean().default(false), publish: z.boolean().default(false) }).default({ text:false,music:false,publish:false }),
  legacy: z.strictObject({ kind:z.enum(['plans','dailyPlans','production-flow']),id,originalEnabled:z.boolean() }).optional(),
  needsConfiguration: z.array(z.string()).default([]), createdAt: stamp.optional(), updatedAt: stamp.optional(),
}).superRefine((p,ctx)=>{
  const localPublication=isLocalPublicationWorkflow(p.workflow?.graph);
  const generates=p.outputs.lyrics||p.outputs.cover||p.outputs.music;
  if(localPublication){
    if(p.material.source!=='workflow'||generates||p.artistId||p.routing||p.routeSnapshot||p.workflowSnapshot||
      p.workflow?.platform!=='fanqie'||p.workflow.publications?.[0]?.accountId!==p.workflow.accountId||
      p.authorization.text||p.authorization.music||p.text.consent||p.music.consent)
      ctx.addIssue({code:'custom',message:'PLAN_WORKFLOW_INVALID',path:['workflow']});
  } else {
    if(!p.artistId)ctx.addIssue({code:'custom',message:'ARTIST_REQUIRED',path:['artistId']});
    if(!generates)ctx.addIssue({code:'custom',message:'OUTPUT_REQUIRED',path:['outputs']});
  }
  const ids=p.material.expectedExternalItemIds;
  if(ids&&ids.length!==p.count)ctx.addIssue({code:'custom',message:'EXTERNAL_ITEM_COUNT',path:['material','expectedExternalItemIds']});
  if(ids&&new Set(ids).size!==ids.length)ctx.addIssue({code:'custom',message:'DUPLICATE_EXTERNAL_ITEM',path:['material','expectedExternalItemIds']});
  if(p.material.source==='pule_prompt'&&(!p.outputs.lyrics||!p.outputs.music||p.music.route!=='pule'||p.music.versionPolicy!=='first'))
    ctx.addIssue({code:'custom',message:'PULE_PROMPT_REQUIRES_LYRICS_MUSIC_AND_FIRST_VERSION',path:['material','source']});
  const draft=p.creationDraft;
  if (p.workflow?.browserMusic && !p.outputs.cover)
    ctx.addIssue({code:'custom',message:'WORKFLOW_IMAGE_SELECTION_REQUIRED',path:['outputs','cover']});
  if(p.material.source==='creation' ? !draft||p.count!==1||p.schedule.kind!=='once'||p.authorization.publish||p.publishTargets.length>0||
    !!p.fanqie||!p.songType||p.outputs.lyrics!==(p.songType==='vocal')||!!draft.lyrics.trim()!==p.outputs.lyrics||
    (p.songType==='instrumental'&&!p.outputs.music) : !!draft)
    ctx.addIssue({code:'custom',message:'CREATION_DRAFT_INVALID',path:['creationDraft']});
  if(p.material.source==='workflow'
    ? !p.workflow||!localPublication&&(!p.routing||(!p.workflow.graph&&p.count!==1)||!p.outputs.music)||
      (p.authorization.publish&&!workflowPublicationPlatforms(p.workflow.graph).length)||p.publishTargets.length>0||!!p.fanqie
    : !!p.workflow||!!p.workflowSnapshot)
    ctx.addIssue({code:'custom',message:'PLAN_WORKFLOW_INVALID',path:['workflow']});
});
export type PlanCenterPlan = z.infer<typeof PlanCenterPlanSchema>;
export function isPlanCenterDefinition(plan: Pick<PlanCenterPlan, "origin" | "material">) {
  return plan.origin !== "manual" && plan.material.source !== "creation";
}
export function isPublicationPlan(plan: PlanCenterPlan) {
  return isPlanCenterDefinition(plan) && (plan.outputs.music || isLocalPublicationWorkflow(plan.workflow?.graph));
}
export type PlanCenterPlanInput = z.input<typeof PlanCenterPlanSchema>;
export type PlanCenterPublishTarget = z.infer<typeof PlanCenterPublishTargetSchema>;
export const PlanCenterSaveSchema = z.strictObject({plan:PlanCenterPlanSchema,expectedRevision:revision.nullable()});
export const PlanCenterToggleSchema = z.strictObject({id,expectedRevision:revision,enabled:z.boolean()});
export const PlanCenterDeleteSchema = PlanCenterToggleSchema.omit({enabled:true});
export const PlanCenterScheduleCreationSchema = z.strictObject({id,expectedRevision:revision,schedule:onceSchedule});
export const PlanCenterIdSchema = z.strictObject({id});
export const PlanCenterCatalogSchema = z.strictObject({includeWorks:z.boolean().default(true)});
export const PlanCenterRunSchema = z.strictObject({id,expectedRevision:revision,summaryHash:z.string().regex(/^[a-f0-9]{64}$/),requestId:id,source:z.enum(['manual','debug']),confirmGeneration:z.literal(true).optional(),confirmPublication:z.literal(true).optional(),retrySunoRunId:id.optional(),confirmSunoRegeneration:z.literal(true).optional()});
export const PlanCenterStopSchema = z.strictObject({runId:id});
export const PlanCenterStageSchema = z.enum(['dot','text_generate','text_score','lyric_write','cover','music_submit','music_assets','materials']);
export type PlanCenterStage = z.infer<typeof PlanCenterStageSchema>;
export const PlanCenterClaimSchema = z.strictObject({runId:id,itemId:id,stage:PlanCenterStageSchema,requestHash:z.string().regex(/^[a-f0-9]{64}$/).optional()});
export const PlanCenterRecordSchema = z.strictObject({attemptId:id,status:z.enum(['succeeded','failed','unknown','waiting']),externalTaskId:id.optional(),evidenceId:id.optional(),result:record.optional(),reason:z.string().max(2000).optional()});
export const PlanCenterReconcileSchema = z.strictObject({attemptId:id,status:z.enum(['succeeded','failed','not_found','pending']),evidenceId:id,result:record.optional(),externalTaskId:id.optional(),reason:z.string().max(2000).optional(),source:z.enum(['user','system','provider']).default('system'),actor:id.optional()});
export const PlanCenterManualObservationSchema = z.strictObject({attemptId:id,status:z.enum(['succeeded','failed','not_found','pending']),reason:z.string().trim().min(1).max(2000)});
export const PlanCenterRetrySchema = z.strictObject({attemptId:id});
export const PlanCenterMaterialsSchema = z.strictObject({itemId:id,title:z.string().trim().min(1).max(500),lyrics:z.string().trim().max(100000),coverAssetId:id,audioAssetId:id,rightsEvidenceId:id,consistencyEvidenceId:id,selectedVersion:z.enum(['A','B'])});
export const PlanCenterCapabilitySchema = z.strictObject({available:z.boolean(),reason:z.string().max(2000).optional()});
export const PlanCenterCapabilityNames = ['dot','text','cover','music','publication','albumCatalog','albumCreate','albumAppend'] as const;
export type PlanCenterCapabilityName = typeof PlanCenterCapabilityNames[number];
export type PlanCenterCapabilities = Record<PlanCenterCapabilityName,z.infer<typeof PlanCenterCapabilitySchema>>;
export const PlanCenterRunRecordSchema = z.strictObject({id,planId:id,planRevision:revision,snapshot:PlanCenterPlanSchema,summaryHash:id,requestId:id,source:z.enum(['manual','debug','scheduled','directory','publication_task']),occurrenceKey:id.optional(),prepareContract:z.boolean().optional(),state:z.enum(['running','waiting','blocked','stopping','stopped','completed','failed']),stopRequested:z.boolean(),createdAt:stamp,updatedAt:stamp,reason:z.string().optional(),lastFailureReason:z.string().optional(),lastFailureAt:stamp.optional(),downloadFolders:z.array(DownloadArchiveFolderSchema).optional()});
export type PlanCenterRun = z.infer<typeof PlanCenterRunRecordSchema>;
export const PlanCenterItemSchema = z.strictObject({id,runId:id,planId:id,ordinal:z.number().int().positive(),expectedExternalItemId:id,state:z.string(),reason:z.string().optional(),workId:id.optional(),selectedVersion:z.enum(['A','B']).optional(),materialFingerprint:id.optional(),versions:z.array(z.strictObject({version:z.enum(['A','B']),assetId:id.optional(),externalId:id.optional(),sha256:z.string().optional()})).max(2),material:record.optional(),materials:PlanCenterMaterialsSchema.omit({itemId:true}).optional(),createdAt:stamp,updatedAt:stamp});
export type PlanCenterItem = z.infer<typeof PlanCenterItemSchema>;
export const PlanCenterReconcileObservationSchema = z.strictObject({status:z.enum(['succeeded','failed','not_found','pending']),evidenceId:id,source:z.enum(['user','system','provider']),actor:id.optional(),observedAt:stamp,reason:z.string().max(2000).optional()});
export type PlanCenterReconcileObservation = z.infer<typeof PlanCenterReconcileObservationSchema>;
export const PlanCenterStageAttemptSchema = z.strictObject({id,runId:id,itemId:id,stage:PlanCenterStageSchema,ordinal:z.number().int().positive(),idempotencyKey:id,requestHash:id,state:z.enum(['dispatching','waiting','unknown','succeeded','failed','not_found']),externalTaskId:id.optional(),evidenceId:id.optional(),result:record.optional(),reason:z.string().optional(),observations:z.array(PlanCenterReconcileObservationSchema).optional(),supersededByRunId:id.optional(),createdAt:stamp,updatedAt:stamp});
export type PlanCenterStageAttempt = z.infer<typeof PlanCenterStageAttemptSchema>;
export const PlanCenterPublishAttemptSchema = z.strictObject({id,runId:id,itemId:id,platform:id,accountId:id,bindingId:id,ordinal:z.number().int().positive(),idempotencyKey:id,requestHash:id,state:z.enum(['dispatching','submitted','reviewing','published','rejected','unknown','failed']),externalId:id.optional(),evidenceId:id.optional(),reason:z.string().optional(),createdAt:stamp,updatedAt:stamp});
export type PlanCenterPublishAttempt = z.infer<typeof PlanCenterPublishAttemptSchema>;
export const PlanCenterOccurrenceSchema = z.strictObject({id,planId:id,occurrenceKey:id,intendedAt:stamp,localDate:z.string(),status:z.enum(['claimed','skipped']),runId:id.optional(),reason:z.string().optional(),createdAt:stamp});
export type PlanCenterOccurrence = z.infer<typeof PlanCenterOccurrenceSchema>;
export const PlanCenterAlbumBindingSchema = z.strictObject({id,planId:id,createdByRunId:id.optional(),platform:id,accountId:id,selectionHash:id,selection:PlanCenterAlbumSelectionSchema,state:z.enum(['dispatching','unknown','bound','failed']),albumId:id.optional(),evidenceId:id.optional(),reason:z.string().optional(),createdAt:stamp,updatedAt:stamp});
export type PlanCenterAlbumBinding = z.infer<typeof PlanCenterAlbumBindingSchema>;
export type PlanCenterMigration = {id:string;state:'applied'|'rolled_back';createdAt:string;entries:Array<{kind:'plans'|'dailyPlans'|'production-flow';sourceId:string;planId:string;original:Record<string,any>;ownedHash:string;planHash:string;ownerHash:string;history:Record<string,any>}>};
export const PlanCenterMigrationSchema = z.strictObject({id,state:z.enum(['applied','rolled_back']),createdAt:stamp,entries:z.array(z.strictObject({kind:z.enum(['plans','dailyPlans','production-flow']),sourceId:id,planId:id,original:record,ownedHash:z.string().regex(/^[a-f0-9]{64}$/),planHash:z.string().regex(/^[a-f0-9]{64}$/),ownerHash:z.string().regex(/^[a-f0-9]{64}$/),history:record}))});
export type PlanCenterList = {plans:PlanCenterPlan[];runs:PlanCenterRun[];items:PlanCenterItem[];stageAttempts:PlanCenterStageAttempt[];publishAttempts:PlanCenterPublishAttempt[];occurrences:PlanCenterOccurrence[];albumBindings:PlanCenterAlbumBinding[];migration:PlanCenterMigration|null};

export type PlanRunSummary = Pick<PlanCenterRun, 'id' | 'state' | 'source' | 'createdAt' | 'stopRequested'>;
export type PlanDashboardRow = {
  plan: PlanCenterPlan;
  latest?: PlanRunSummary;
  active?: PlanRunSummary;
  deleteBlocked: boolean;
  stopsOnDelete: boolean;
};
export type PlanCenterHistory = {
  runs: (PlanRunSummary & { count: number; completed: number; local: boolean })[];
  legacyHistory: PlanCenterMigration['entries'][number]['history'];
};
export type PlanCenterRunDetail = Pick<PlanCenterList, 'items' | 'stageAttempts' | 'publishAttempts'> & {
  run: PlanCenterRun;
  execution: Record<string, any>;
  fanqieCleanup?: 'pending' | 'queued' | 'recycled';
  fanqieDiagnostics?: boolean;
  catalog?: Record<string, any>;
};

export function planRunActive(run: Pick<PlanCenterRun, 'state'>) {
  return run.state !== 'completed' && run.state !== 'stopped' && run.state !== 'failed';
}

const activePlanStages = new Set<PlanCenterStageAttempt['state']>(['dispatching', 'waiting', 'unknown']);
const activePlanPublications = new Set<PlanCenterPublishAttempt['state']>(['dispatching', 'submitted', 'reviewing', 'unknown']);

export function planStageCancelsOnStop(run: PlanCenterRun, attempt: PlanCenterStageAttempt) {
  return !!run.snapshot.workflow?.graph && activePlanStages.has(attempt.state) &&
    ['music_assets', 'cover', 'materials'].includes(attempt.stage);
}

export function planRunHasOutstandingWork(
  run: PlanCenterRun, { stageAttempts, publishAttempts, albumBindings }: Pick<PlanCenterList, 'stageAttempts' | 'publishAttempts' | 'albumBindings'>,
) {
  return stageAttempts.some(attempt => attempt.runId === run.id && activePlanStages.has(attempt.state) && !planStageCancelsOnStop(run, attempt)) ||
    publishAttempts.some(attempt => attempt.runId === run.id && activePlanPublications.has(attempt.state)) ||
    albumBindings.some(binding => binding.createdByRunId === run.id && ['dispatching', 'unknown'].includes(binding.state));
}
export function planRunBlocksDeletion(run: PlanCenterRun, activity: Parameters<typeof planRunHasOutstandingWork>[1]) {
  return planRunActive(run) && (run.state !== 'blocked' || planRunHasOutstandingWork(run, activity));
}
export type CreationTaskSummary = {
  planId: string;
  runId?: string;
  workId?: string;
  title: string;
  style: string;
  state: 'pending'|'scheduled'|'running'|'awaiting_cover'|'completed'|'failed'|'blocked'|'unknown'|'stopping'|'stopped';
  reason?: string;
  schedule?: Extract<PlanCenterPlan['schedule'], {kind:'once'}>;
};
// Aliases keep RPC callers explicit without coupling them to core storage.
export { PlanCenterSaveSchema as PlanCenterSavePlanSchema, PlanCenterRunSchema as PlanCenterTriggerSchema };

export const PlanCenterBindWorkSchema=z.strictObject({itemId:id,workId:z.uuid(),expectedWorkRevision:revision});
export const PlanCenterPrepareCoverWorkSchema=z.strictObject({itemId:id,expectedFinalDraftId:id,expectedFinalPairHash:z.string().regex(/^[a-f0-9]{64}$/)});
export const PlanCenterSelectVersionSchema=z.strictObject({itemId:id,version:z.enum(['A','B'])});

export const PlanCenterConfirmMaterialsSchema=z.strictObject({itemId:id,expectedWorkRevision:revision,audioHash:z.string().regex(/^[a-f0-9]{64}$/),coverHash:z.string().regex(/^[a-f0-9]{64}$/),lyricsHash:z.string().regex(/^[a-f0-9]{64}$/),rightsStatement:z.string().trim().min(10).max(4000),confirmed:z.literal(true)});
