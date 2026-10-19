import { z } from "zod";
import { saveApiProfileSchema } from "./api-profiles";
import { GenerateTurnSchema, TextConfigurationSchema } from "./creation";
import { MusicRequestSchema } from "./music";
import { DailyPlanInputSchema, SelectionSchema } from "./daily";
import { InboxSetupSchema } from "./inbox";
import {PlanCenterSaveSchema,PlanCenterToggleSchema,PlanCenterIdSchema,PlanCenterRunSchema,PlanCenterStopSchema,PlanCenterRetrySchema} from './plan-center';
import { TmeInputSchema } from './tme';
import { CoverRequestSchema } from './cover-handoff';
import { TmeObservationSchemas } from './tme-observations';
import { SimplePublishingSchemas } from './platform-config';
export const id = z.string().uuid();
export const defaultsSchema = z
  .object({
    genre: z.string().max(200),
    voice: z.enum(["male", "female", "duet", "instrumental"]),
    lyricTone: z.string().max(500),
    bpmMin: z.number().int().min(20).max(300),
    bpmMax: z.number().int().min(20).max(300),
    coverStyle: z.string().max(2000),
    language: z.string().max(100),
    mood: z.string().max(200),
    duration: z.number().int().min(10).max(1800),
  })
  .refine((x) => x.bpmMin <= x.bpmMax, "BPM区间无效");
const obj = z.record(z.string(), z.unknown());
const recordingSelections = z.array(z.strictObject({workId:id,slot:z.enum(['audio_A','audio_B'])})).max(200);
export const methodSchemas: Record<string, z.ZodType> = {
  ...SimplePublishingSchemas,
  ...TmeObservationSchemas,
  'publish.quick': z.strictObject({workIds:z.array(id).min(1).max(100),targets:z.array(z.enum(['netease','qishui','qqmusic','kugou','douyin'])).min(1).max(5),recordings:recordingSelections,accountOverrides:z.partialRecord(z.enum(['netease','qishui','qqmusic','kugou','douyin']),id).default({})}),
  'lyrics.preview': z.strictObject({workId:z.uuid()}),
  'lyrics.confirm': z.strictObject({workId:z.uuid(),versionId:z.uuid(),plainHash:z.string().regex(/^[a-f0-9]{64}$/),audioHash:z.string().regex(/^[a-f0-9]{64}$/),confirmed:z.literal(true)}),
  'publication.payload': z.strictObject({workId:z.uuid()}),
  'cover.request': CoverRequestSchema,
  'cover.list': z.strictObject({workId:z.uuid().optional()}),
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
  "artist.save": z.object({
    id: id.optional(),
    name: z.string().trim().min(1).max(100),
    expected: z.number().int().optional(),
    defaults: defaultsSchema,
  }),
  "account.save": z.object({
    id: id.optional(),
    provider: z.enum([
      "suno",
      "yourmusic",
      "netease",
      "qishui",
      "qqmusic",
      "kugou",
      "douyin",
      "tme",
    ]),
    name: z.string().trim().min(1).max(100),
    dailyLimit: z.number().int().min(0).max(10000),
  }),
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
    role: z.enum(["audio_A", "audio_B", "cover", "video"]),
  }),
  "series.save": z.object({
    id: id.optional(),
    title: z.string().trim().min(1).max(200),
    story: z.string().max(20000),
    workIds: z.array(id).max(100),
  }),
  "creation.start": z.object({
    artistId: id,
    title: z.string().trim().min(1).max(200),
    story: z.string().max(20000),
    overrides: obj,
    planId: id.optional(),
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
  "cover.task": z.object({ workId: id, brief: z.string().max(10000) }),
  "video.prepare": z.object({ workId: id, recordingSlot:z.enum(['audio_A','audio_B']).optional() }),
  "goal.complete": z.object({ workId: id, planId: id.optional() }),
};
export function validate(method: string, input: unknown) {
  const planSchemas:Record<string,z.ZodType>={
    'planCenter.list':z.strictObject({}),'planCenter.catalog':z.strictObject({}),
    'planCenter.save':PlanCenterSaveSchema,'planCenter.toggle':PlanCenterToggleSchema,
    'planCenter.preview':PlanCenterIdSchema,'planCenter.run':PlanCenterRunSchema,
    'planCenter.stop':PlanCenterStopSchema,'planCenter.retry':PlanCenterRetrySchema,
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
