import {AccountIdentityPublishScopeSchema} from './account-identity';
import { z } from 'zod';
import {GenerationRoutingSchema,RouteSnapshotSchema} from './generation-config';
import { InboxId } from './inbox';
import { FlowMusicCreditPolicySchema } from './production-flow';

const id = z.string().trim().min(1).max(500);
const revision = z.number().int().positive();
const stamp = z.iso.datetime({ offset: true });
const record = z.record(z.string(), z.unknown());
export const PlanCenterScheduleSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('daily'), localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }),
  z.strictObject({ kind: z.literal('weekly'), localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).refine(v => new Set(v).size === v.length) }),
  z.strictObject({ kind: z.literal('once'), localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v) }),
]);
export const PlanCenterAlbumSelectionSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('existing'), albumId: id }),
  z.strictObject({ mode: z.literal('new'), title: z.string().trim().min(1).max(200), description: z.string().max(2000).optional() }),
]);
export const PlanCenterPublishTargetSchema = z.strictObject({ identityBindingId:z.uuid().optional(),identitySnapshot:AccountIdentityPublishScopeSchema.omit({externalState:true}).optional(),platform: id, accountId: id, enabled: z.boolean().default(true), album: PlanCenterAlbumSelectionSchema });
export const PlanCenterPlanSchema = z.strictObject({
  artistSnapshot:z.strictObject({id:z.string(),revision:z.number().int().positive(),name:z.string(),defaults:z.record(z.string(),z.unknown())}).optional(),
  origin:z.enum(['plan','manual']).optional(),routing:GenerationRoutingSchema.optional(),routeSnapshot:RouteSnapshotSchema.optional(),storyContext:z.strictObject({storyBeat:z.string().max(10000),storyStage:z.string().max(1000).default('')}).optional(),
  id, revision: revision.default(1), title: z.string().trim().min(1).max(200), artistId: id,
  enabled: z.boolean().default(false), timezone: z.literal('Asia/Shanghai').default('Asia/Shanghai'),
  schedule: PlanCenterScheduleSchema, count: z.number().int().min(1).max(20).default(1),
  theme: z.string().max(2000).default(''), styleTemplate: z.string().max(4000).default(''),
  outputs: z.strictObject({ lyrics: z.boolean(), cover: z.boolean(), music: z.boolean() }).refine(v=>v.lyrics||v.cover||v.music, 'OUTPUT_REQUIRED').default({ lyrics: true, cover: false, music: false }),
  material: z.strictObject({ source: z.enum(['dot','manual','provider']).default('dot'), channel: z.string().max(500).default(''), identity: z.string().max(500).default(''), expectedExternalItemIds: z.array(InboxId).max(20).optional() }),
  text: z.strictObject({ profileId: id.optional(), profileRevision: revision.optional(), modelId: id.optional(), maxOutputTokens: z.number().int().min(256).max(16384).optional(), budgetMicros: z.number().int().positive().max(100_000_000).optional(), consent: z.boolean().default(false), threshold: z.number().min(0).max(100).default(75), maxRewrites: z.number().int().min(0).max(2).default(2), maxScoreRetries: z.number().int().min(0).max(2).default(2) }),
  music: z.strictObject({ route: z.enum(['suno_official','pule','yourmusic','manual']), profileId: id.optional(), profileRevision: revision.optional(), modelId: id.optional(), budgetCredits: z.number().int().positive().optional(), maxCostPerRequestCredits: z.number().int().positive().optional(), pricingEvidence: z.string().max(1000).optional(), creditPolicy: FlowMusicCreditPolicySchema.optional(), consent: z.boolean().default(false), versionPolicy: z.enum(['first','manual']).default('first') }),
  publishTargets: z.array(PlanCenterPublishTargetSchema).max(20).refine(v => new Set(v.map(t=>`${t.platform}\0${t.accountId}`)).size===v.length,'DUPLICATE_TARGET').default([]),
  catchUp: z.strictObject({ mode: z.enum(['latest','skip','bounded']).default('latest'), limit: z.number().int().min(1).max(5).default(1) }).default({ mode:'latest',limit:1 }),
  authorization: z.strictObject({ text: z.boolean().default(false), music: z.boolean().default(false), publish: z.boolean().default(false) }).default({ text:false,music:false,publish:false }),
  legacy: z.strictObject({ kind:z.enum(['plans','dailyPlans','production-flow']),id,originalEnabled:z.boolean() }).optional(),
  needsConfiguration: z.array(z.string()).default([]), createdAt: stamp.optional(), updatedAt: stamp.optional(),
}).superRefine((p,ctx)=>{
  const ids=p.material.expectedExternalItemIds;
  if(ids&&ids.length!==p.count)ctx.addIssue({code:'custom',message:'EXTERNAL_ITEM_COUNT',path:['material','expectedExternalItemIds']});
  if(ids&&new Set(ids).size!==ids.length)ctx.addIssue({code:'custom',message:'DUPLICATE_EXTERNAL_ITEM',path:['material','expectedExternalItemIds']});
});
export type PlanCenterPlan = z.infer<typeof PlanCenterPlanSchema>;
export type PlanCenterPlanInput = z.input<typeof PlanCenterPlanSchema>;
export type PlanCenterPublishTarget = z.infer<typeof PlanCenterPublishTargetSchema>;
export const PlanCenterSaveSchema = z.strictObject({plan:PlanCenterPlanSchema,expectedRevision:revision.nullable()});
export const PlanCenterToggleSchema = z.strictObject({id,expectedRevision:revision,enabled:z.boolean()});
export const PlanCenterIdSchema = z.strictObject({id});
export const PlanCenterRunSchema = z.strictObject({id,expectedRevision:revision,summaryHash:z.string().regex(/^[a-f0-9]{64}$/),requestId:id,source:z.enum(['manual','debug'])});
export const PlanCenterStopSchema = z.strictObject({runId:id});
export const PlanCenterStageSchema = z.enum(['dot','text_generate','text_score','cover','music_submit','music_assets','materials']);
export type PlanCenterStage = z.infer<typeof PlanCenterStageSchema>;
export const PlanCenterClaimSchema = z.strictObject({runId:id,itemId:id,stage:PlanCenterStageSchema,requestHash:z.string().regex(/^[a-f0-9]{64}$/).optional()});
export const PlanCenterRecordSchema = z.strictObject({attemptId:id,status:z.enum(['succeeded','failed','unknown','waiting']),externalTaskId:id.optional(),evidenceId:id.optional(),result:record.optional(),reason:z.string().max(2000).optional()});
export const PlanCenterReconcileSchema = z.strictObject({attemptId:id,status:z.enum(['succeeded','failed','not_found','pending']),evidenceId:id,result:record.optional(),externalTaskId:id.optional(),reason:z.string().max(2000).optional()});
export const PlanCenterRetrySchema = z.strictObject({attemptId:id});
export const PlanCenterMaterialsSchema = z.strictObject({itemId:id,title:z.string().trim().min(1).max(500),lyrics:z.string().trim().min(1).max(100000),coverAssetId:id,audioAssetId:id,rightsEvidenceId:id,consistencyEvidenceId:id,selectedVersion:z.enum(['A','B'])});
export const PlanCenterCapabilitySchema = z.strictObject({available:z.boolean(),reason:z.string().max(2000).optional()});
export const PlanCenterCapabilityNames = ['dot','text','cover','music','publication','albumCatalog','albumCreate','albumAppend'] as const;
export type PlanCenterCapabilityName = typeof PlanCenterCapabilityNames[number];
export type PlanCenterCapabilities = Record<PlanCenterCapabilityName,z.infer<typeof PlanCenterCapabilitySchema>>;
export const PlanCenterRunRecordSchema = z.strictObject({id,planId:id,planRevision:revision,snapshot:PlanCenterPlanSchema,summaryHash:id,requestId:id,source:z.enum(['manual','debug','scheduled','directory']),occurrenceKey:id.optional(),state:z.enum(['running','waiting','blocked','stopping','stopped','completed','failed']),stopRequested:z.boolean(),createdAt:stamp,updatedAt:stamp,reason:z.string().optional()});
export type PlanCenterRun = z.infer<typeof PlanCenterRunRecordSchema>;
export const PlanCenterItemSchema = z.strictObject({id,runId:id,planId:id,ordinal:z.number().int().positive(),expectedExternalItemId:id,state:z.string(),reason:z.string().optional(),workId:id.optional(),selectedVersion:z.enum(['A','B']).optional(),materialFingerprint:id.optional(),versions:z.array(z.strictObject({version:z.enum(['A','B']),assetId:id.optional(),externalId:id.optional(),sha256:z.string().optional()})).max(2),material:record.optional(),materials:PlanCenterMaterialsSchema.omit({itemId:true}).optional(),createdAt:stamp,updatedAt:stamp});
export type PlanCenterItem = z.infer<typeof PlanCenterItemSchema>;
export const PlanCenterStageAttemptSchema = z.strictObject({id,runId:id,itemId:id,stage:PlanCenterStageSchema,ordinal:z.number().int().positive(),idempotencyKey:id,requestHash:id,state:z.enum(['dispatching','waiting','unknown','succeeded','failed','not_found']),externalTaskId:id.optional(),evidenceId:id.optional(),result:record.optional(),reason:z.string().optional(),createdAt:stamp,updatedAt:stamp});
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
// Aliases keep RPC callers explicit without coupling them to core storage.
export { PlanCenterSaveSchema as PlanCenterSavePlanSchema, PlanCenterRunSchema as PlanCenterTriggerSchema };

export const PlanCenterBindWorkSchema=z.strictObject({itemId:id,workId:z.uuid(),expectedWorkRevision:revision});
export const PlanCenterPrepareCoverWorkSchema=z.strictObject({itemId:id,expectedFinalDraftId:id,expectedFinalPairHash:z.string().regex(/^[a-f0-9]{64}$/)});
export const PlanCenterSelectVersionSchema=z.strictObject({itemId:id,version:z.enum(['A','B'])});

export const PlanCenterConfirmMaterialsSchema=z.strictObject({itemId:id,expectedWorkRevision:revision,audioHash:z.string().regex(/^[a-f0-9]{64}$/),coverHash:z.string().regex(/^[a-f0-9]{64}$/),lyricsHash:z.string().regex(/^[a-f0-9]{64}$/),rightsStatement:z.string().trim().min(10).max(4000),confirmed:z.literal(true)});
