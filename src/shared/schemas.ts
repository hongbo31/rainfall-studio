import {AccountIdentityPublicActions} from './account-identity';
import {MaterialMethods} from './material-methods';
import {GenerationConfigSchemas} from './generation-config';
import { z } from "zod";
import { artistMusicTypeSchema, artistNameLimit, artistProfileSchema, artistSongAttributeSchema, secondSingerSchema } from "./local-artist";
import { fanqieOriginalSingerSchema, fanqieOriginalWorkIdSchema } from "./fanqie-downloads";
import { FanqieArtistCreationSchema } from "./fanqie-artist";
import { AccountProviderSchema, AccountWorkWindowSchema, PlatformAccountIdSchema } from "./platform-accounts";
import { QishuiReleaseSchema,QishuiFillSchema,QishuiJobSchema,QishuiAuthorizationSchema,QishuiAcceptSchema } from "./qishui";
import {DirectoryTaskSchemas} from './directory-tasks';
import { DownloadArchiveSchemas } from './download-archive';
import { platformImageSchemas } from './platform-image';
import {PlanCenterPrepareCoverWorkSchema} from './plan-center';
import {PlanWorkflowQishuiSubmittedSchema} from './plan-workflow-publication';
import { saveApiProfileSchema } from "./api-profiles";
import { promptLibrarySchemas } from "./prompt-library";
import { lyricWritingSchemas } from "./lyric-writing";
import { puleBrowserSchemas, sunoCnBrowserSchemas } from "./pule-browser";
import { GenerateTurnSchema, TextConfigurationSchema } from "./creation";
import { MusicRequestSchema } from "./music";
import { DailyPlanInputSchema, SelectionSchema } from "./daily";
import { InboxSetupSchema } from "./inbox";
import {PlanCenterCatalogSchema,PlanCenterSaveSchema,PlanCenterDeleteSchema,PlanCenterIdSchema,PlanCenterRunSchema,PlanCenterStopSchema,PlanCenterRetrySchema,PlanCenterBindWorkSchema,PlanCenterSelectVersionSchema,PlanCenterConfirmMaterialsSchema} from './plan-center';
import { publicationTaskSchemas } from "./publication-tasks";
import { PublicationHistoryQuerySchema } from "./publication-history";
import { TmeInputSchema } from './tme';
import { CoverRequestSchema, GenerateCoverSchema, RetryCoverSchema, coverResolutionSchema } from './cover-handoff';
import { TmeObservationSchemas } from './tme-observations';
import { SimplePublishingSchemas } from './platform-config';
import {PlanAlbumTargetSchema,PlanAlbumSelectSchema,PlanAlbumCreateSchema,PlanAlbumRunTargetSchema,PlanAlbumOperationIdSchema,PlanAlbumAuthorizeSchema} from './plan-albums';
export const id = z.string().uuid();
export const defaultsSchema = z
  .object({
    genre: z.string().max(200),
    voice: z.enum(["male", "female", "duet", "instrumental"]),
    lyricTone: z.string().max(500),
    bpmMin: z.number().int().min(20).max(300),
    bpmMax: z.number().int().min(20).max(300),
    coverStyle: z.string().max(2000),
    coverResolution: coverResolutionSchema.optional(),
    instruments: z.string().max(1000).optional(),
    seriesStory: z.string().max(4000).optional(),
    language: z.string().max(100),
    mood: z.string().max(200),
    duration: z.number().int().min(10).max(1800),
  })
  .refine((x) => x.bpmMin <= x.bpmMax, "BPM区间无效");
export type ArtistDefaults = z.infer<typeof defaultsSchema>;
const obj = z.record(z.string(), z.unknown());
const recordingSelections = z.array(z.strictObject({workId:id,slot:z.enum(['audio_A','audio_B'])})).max(200);
export const methodSchemas: Record<string, z.ZodType> = {
  ...MaterialMethods,
  'work.selectAudioVersion':z.strictObject({workId:z.uuid(),expectedRevision:z.number().int().positive(),version:z.enum(['A','B'])}),
  ...GenerationConfigSchemas,
  ...promptLibrarySchemas,
  ...lyricWritingSchemas,
  ...puleBrowserSchemas,
  ...sunoCnBrowserSchemas,
  ...Object.fromEntries(Object.entries(AccountIdentityPublicActions).map(([action,schema])=>['accountIdentity.'+action,schema])),
  ...DirectoryTaskSchemas,
  ...DownloadArchiveSchemas,
  ...platformImageSchemas,
  ...SimplePublishingSchemas,
  ...TmeObservationSchemas,
  'publish.quick': z.strictObject({workIds:z.array(id).min(1).max(100),targets:z.array(z.enum(['netease','qishui','qqmusic','kugou','douyin'])).min(1).max(5),recordings:recordingSelections,accountOverrides:z.partialRecord(z.enum(['netease','qishui','qqmusic','kugou','douyin']),id).default({})}),
  'lyrics.preview': z.strictObject({workId:z.uuid()}),
  'lyrics.confirm': z.strictObject({workId:z.uuid(),versionId:z.uuid(),plainHash:z.string().regex(/^[a-f0-9]{64}$/),audioHash:z.string().regex(/^[a-f0-9]{64}$/),confirmed:z.literal(true)}),
  'publication.payload': z.strictObject({workId:z.uuid()}),
  'cover.request': CoverRequestSchema,
  'cover.generate': GenerateCoverSchema,
  'cover.retryImage': RetryCoverSchema,
  'cover.retryZhipu': RetryCoverSchema,
  'cover.list': z.strictObject({workId:z.uuid().optional()}),
  'cover.watch': z.strictObject({requestId:z.uuid()}),
  'cover.inboxStatus': z.strictObject({workId:z.uuid().optional()}),
  'tme.preview': TmeInputSchema,
  'tme.prepare': TmeInputSchema,
  'tme.list': z.strictObject({}),
  'tme.batchPlan': z.strictObject({workIds:z.array(z.uuid()).min(1).max(100),accountId:z.uuid()}),
  'tme.batches': z.strictObject({}),
  'tme.batchCancel': z.strictObject({id:z.uuid()}),
  "dailyPlan.save": z.strictObject({
    plan: DailyPlanInputSchema,
    expectedRevision: z.number().int().positive().nullable(),
  }),
  "dailyPlan.list": z.strictObject({}),
  "dailyPlan.enable": z.strictObject({
    id: z.uuid(),
    expectedRevision: z.number().int().positive(),
  }),
  "candidate.select": SelectionSchema,
  "conversation.generate": GenerateTurnSchema,
  "music.prepare": MusicRequestSchema,
  "music.list": z.strictObject({}),
  "music.reconcile": z.strictObject({ id: z.uuid() }),
  "music.retryDownloads": z.strictObject({ id: z.uuid() }),
  "conversation.list": z.strictObject({}),
  "textConfig.list": z.strictObject({}),
  "inbox.status": z.strictObject({}),
  "inbox.bridge.chooseDirectory": z.strictObject({}),
  "inbox.bridge.pause": z.strictObject({expectedRevision:z.number().int().nonnegative()}),
  "inbox.bridge.resume": z.strictObject({expectedRevision:z.number().int().nonnegative()}),
  "inbox.configure": InboxSetupSchema,
  "inbox.pause": z.strictObject({}),
  "inbox.listCandidates": z.strictObject({}),
  "inbox.selectMusicInput": z.strictObject({ candidateId: z.uuid(), confirmed: z.literal(true) }),
  "inbox.getReceipt": z.strictObject({
    batchId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/),
  }),
  "textConfig.save": z.strictObject({
    config: TextConfigurationSchema,
    expectedRevision: z.number().int().nonnegative(),
  }),
  "apiProfile.list": z.strictObject({}),
  "apiProfile.save": saveApiProfileSchema,
  runtime: z.object({}),
  snapshot: z.object({}),
  'runtime.settings':z.strictObject({}),
  'runtime.configure':z.strictObject({backgroundEnabled:z.boolean(),loginAtStartup:z.boolean()}),
  "artist.save": z.object({
    id: id.optional(),
    name: z.string().trim().min(1).max(artistNameLimit).optional(),
    expected: z.number().int().optional(),
    defaults: defaultsSchema,
    profile: artistProfileSchema.optional(),
    promptTemplateId: id.nullable().optional(),
  }),
  "artist.delete": z.strictObject({ id, expected: z.number().int().positive(), confirmed: z.literal(true) }),
  "accountLocalArtist.list": z.strictObject({ accountId: id.optional() }),
  "accountLocalArtist.save": z.strictObject({
    id: id.optional(),
    expected: z.number().int().positive().optional(),
    accountId: id.optional(),
    defaults: defaultsSchema,
    musicType: artistMusicTypeSchema.optional(),
    songAttribute: artistSongAttributeSchema.optional(),
    originalSinger: fanqieOriginalSingerSchema.nullish(),
    originalWorkId: fanqieOriginalWorkIdSchema.nullish(),
    isAiWork: z.boolean().optional(),
    hasCopyrightProof: z.boolean().optional(),
    profile: artistProfileSchema,
    secondSinger: secondSingerSchema.nullable().optional(),
    promptTemplateId: id.nullable(),
  }),
  "accountLocalArtist.assign": z.strictObject({ id, expected: z.number().int().positive(), accountId: id }),
  "accountLocalArtist.copy": z.strictObject({ id, expected: z.number().int().positive(), accountId: id, requestId: id }),
  "accountLocalArtist.delete": z.strictObject({ id, expected: z.number().int().positive(), confirmed: z.literal(true) }),
  "account.save": z.object({
    id: id.optional(),
    provider: AccountProviderSchema,
    name: z.string().trim().min(1).max(100),
    dailyLimit: z.number().int().min(0).max(10000),
  }),
  "account.delete": PlatformAccountIdSchema.extend({ confirmed: z.literal(true) }),
  "accountSession.status": AccountWorkWindowSchema,
  "accountSession.open": AccountWorkWindowSchema,
  "fanqie.artistCreate": FanqieArtistCreationSchema,
  "publish.qishui.prepare": QishuiReleaseSchema,
  "publish.qishui.fill": QishuiFillSchema,
  "publish.qishui.status": QishuiJobSchema,
  "publish.qishui.authorization": QishuiAuthorizationSchema,
  "publish.qishui.contract": QishuiJobSchema,
  "publish.qishui.accept": QishuiAcceptSchema,
  "binding.save": z.object({
    artistId: id,
    accountId: id,
    targets: z.array(z.string().max(30)).max(5),
  }),
  "binding.revoke": z.object({ id }),
  "work.save": z.object({
    id: id.optional(),
    expected: z.number().int().optional(),
    title: z.string().trim().min(1).max(200),
    alternateTitle: z.string().trim().min(1).max(200).nullable().optional(),
    artistId: id,
    story: z.string().max(20000),
    lyrics: z.string().max(100000),
    prompt: z.string().max(100000),
    parameters: obj,
    seriesId: z.string().max(100).optional(),
    rights: z.string().max(4000),
    ai: z.enum(["unknown", "generated", "assisted", "none"]),
  }),
  "work.version": z.object({ id }),
  "work.selectAsset": z.object({
    workId: id,
    assetId: id,
    role: z.enum(["audio_A", "audio_B", "cover", "cover_B", "video"]),
  }),
  "series.save": z.object({
    id: id.optional(),
    title: z.string().trim().min(1).max(200),
    story: z.string().max(20000),
    workIds: z.array(id).max(100),
  }),
  "plan.save": z.object({
    id: id.optional(),
    artistId: id,
    title: z.string().min(1).max(200),
    story: z.string().max(20000),
    timezone: z.string().max(100),
    time: z.string().regex(/^\d\d:\d\d$/),
    enabled: z.boolean(),
    candidateLimit: z.number().int().min(0).max(100),
    finishedGoal: z.number().int().min(0).max(100),
    costLimit: z.number().int().min(0).max(10000000),
    overrides: obj,
    checkpoints: z.object({
      lyrics: z.enum(["manual", "automatic"]),
      candidate: z.enum(["manual", "automatic"]),
      cover: z.enum(["manual", "automatic"]),
      finished: z.enum(["manual", "automatic"]),
      publish: z.literal("manual"),
    }),
  }),
  "plan.toggle": z.object({ id, enabled: z.boolean() }),
  "plan.preview": z.object({ id }),
  "plan.run": z.object({ id }),
  "run.confirm": z.object({
    id,
    step: z.enum(["lyrics", "candidate", "cover", "finished"]),
  }),
  "budget.save": z.object({
    costLimit: z.number().int().min(0).max(10000000),
    candidateLimit: z.number().int().min(0).max(10000),
  }),
  "publish.plan": z.object({
    workIds: z.array(id).min(1).max(100),
    recordings: recordingSelections.optional(),
    destinations: z
      .array(
        z.object({
          target: z.enum(["netease", "qishui", "qqmusic", "kugou", "douyin"]),
          accountId: id,
          bindingId: id,
          kind: z.enum(["audio_distribution", "video_post"]),
        }),
      )
      .min(1)
      .max(5),
  }),
  "publish.approve": z.object({
    id,
    snapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  "publish.start": z.object({ id }),
  "publish.retry": z.object({ id }),
  "publish.pause": z.object({ id }),
  "publish.cancel": z.object({ id }),
  "publish.reconcile": z.object({ id }),
  "publish.revalidate": z.object({ id }),
  "publish.recordManual": z.object({
    id,
    remoteId: z.string().trim().min(1).max(300),
    remoteUrl: z
      .string()
      .url()
      .refine((v) => v.startsWith("https://")),
    review: z.enum(["unknown", "pending", "approved", "rejected", "removed"]),
    publication: z.enum([
      "unknown",
      "scheduled",
      "live",
      "unavailable",
      "taken_down",
    ]),
    reason: z.string().max(2000),
    evidence: z.string().trim().min(10).max(2000),
    observedAt: z.iso.datetime(),
  }),
  "publish.simulateFault": z.object({
    id,
    kind: z.enum(["network", "unknown", "rejected"]),
  }),
  "exception.retry": z.object({ id }),
  "metrics.read": z.object({}),
  "publish.history": PublicationHistoryQuerySchema,
  "cover.task": z.object({ workId: id, brief: z.string().max(10000) }),
  "video.prepare": z.object({ workId: id, recordingSlot:z.enum(['audio_A','audio_B']).optional() }),
  "goal.complete": z.object({ workId: id, planId: id.optional() }),
};
export function validate(method: string, input: unknown) {
  if(method.startsWith("publicationTasks.")){
    const schema=publicationTaskSchemas[method];
    if(!schema)throw Error("METHOD_NOT_ALLOWED");
    return schema.parse(input??{});
  }
  if(method.startsWith('planAlbums.')){
    const albumSchemas:Record<string,z.ZodType>={
      'planAlbums.status':z.strictObject({}),'planAlbums.catalog':PlanAlbumTargetSchema,
      'planAlbums.select':PlanAlbumSelectSchema,'planAlbums.prepareCreate':PlanAlbumCreateSchema,
      'planAlbums.prepareAppend':PlanAlbumRunTargetSchema.extend({itemId:z.string().min(1).max(500)}),
      'planAlbums.preview':PlanAlbumOperationIdSchema,
      'planAlbums.refresh':PlanAlbumTargetSchema,'planAlbums.capabilities':PlanAlbumTargetSchema,
      'planAlbums.confirm':PlanAlbumAuthorizeSchema,'planAlbums.reconcile':PlanAlbumOperationIdSchema,
    };
    if(!albumSchemas[method])throw Error('METHOD_NOT_ALLOWED');return albumSchemas[method].parse(input??{});
  }
  const planSchemas:Record<string,z.ZodType>={
    'planCenter.list':z.strictObject({}),'planCenter.read':PlanCenterIdSchema,'planCenter.catalog':PlanCenterCatalogSchema,
    'planCenter.dashboard':z.strictObject({}),'planCenter.history':PlanCenterIdSchema,'planCenter.runDetail':PlanCenterStopSchema,
    'planCenter.status':z.strictObject({}),'planCenter.dotStatus':z.strictObject({}),'planCenter.exportDotRequests':z.strictObject({}),
    'planCenter.fanqieStatus':z.strictObject({}),'planCenter.retryFanqie':z.strictObject({runId:z.uuid()}),
    'planCenter.retryFanqieDirectory':z.strictObject({runId:z.uuid()}),
    'planCenter.retryFanqieCleanup':z.strictObject({runId:z.uuid()}),
    'planCenter.openFanqieDiagnostics':z.strictObject({runId:z.uuid()}),
    'planCenter.musicStatus':z.strictObject({}),'planCenter.publicationStatus':z.strictObject({}),
    'planCenter.bindWork':PlanCenterBindWorkSchema,'planCenter.prepareCoverWork':PlanCenterPrepareCoverWorkSchema,'planCenter.selectVersion':PlanCenterSelectVersionSchema,
    'planCenter.confirmMaterials':PlanCenterConfirmMaterialsSchema,'planCenter.materialPreview':PlanCenterIdSchema,
    'planCenter.refreshModels':z.strictObject({profileId:z.uuid(),expectedRevision:z.number().int().positive()}),
    'planCenter.save':PlanCenterSaveSchema,'planCenter.delete':PlanCenterDeleteSchema,
    'planCenter.preview':PlanCenterIdSchema,'planCenter.run':PlanCenterRunSchema,
    'planCenter.qishuiSubmitted':PlanWorkflowQishuiSubmittedSchema,
    'planCenter.stop':PlanCenterStopSchema,'planCenter.retry':PlanCenterRetrySchema,
    'planCenter.checkMusicReceipt':PlanCenterRetrySchema,
    'planCenter.rollbackMigration':z.strictObject({}),'planCenter.legacyHistory':PlanCenterIdSchema,
  };
  if(method.startsWith('planCenter.')){
    if(!planSchemas[method])throw Error('METHOD_NOT_ALLOWED');
    return planSchemas[method].parse(input??{});
  }
  const schema = methodSchemas[method];
  if (!schema) throw new Error("METHOD_NOT_ALLOWED");
  return schema.parse(input ?? {});
}
