import { z } from "zod";
import { CreativeDraftSchema } from "./creation";
import { DeepSeekModelSchema, LiveTextResultSchema } from "./live-text";
import { TextEvaluationResultSchema } from "./text-evaluation";
const uuid = z.uuid(),
  revision = z.number().int().positive(),
  code = z
    .string()
    .regex(/^[A-Z0-9_]+$/)
    .max(120);
export const FlowTaskTypeSchema = z.enum([
  "text_generate",
  "text_score",
  "music_submit",
  "music_assets",
  "publication_submit",
  "publication_poll",
]);
export type FlowTaskType = z.infer<typeof FlowTaskTypeSchema>;
export const FlowTextGrantSchema = z.strictObject({
  profileId: uuid,
  profileRevision: revision,
  modelId: DeepSeekModelSchema,
  maxOutputTokens: z.number().int().min(256).max(16384),
  budgetMicros: z.number().int().positive().max(100_000_000),
  consent: z.literal(true),
});
export const FlowMusicGrantSchema = z.strictObject({
  profileId: uuid,
  profileRevision: revision,
  modelId: z.string().trim().min(1).max(200),
  maxCostPerRequestCredits: z.number().int().positive().max(1_000_000),
  budgetCredits: z.number().int().positive().max(1_000_000),
  pricingEvidence: z.string().trim().min(1).max(1000),
  consent: z.literal(true),
});
// A new plan grant cannot inherit the old one-song authorization or user-entered
// pricingEvidence. A quote is usable only when Core's trusted verifier resolves it.
export const FlowMusicCreditPolicySchema = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("existing_credits"),
    noRecharge: z.literal(true),
    actualCostUnknown: z.literal(true),
    consent: z.literal(true),
  }),
  z.strictObject({ mode: z.literal("trusted_quote"), quoteId: uuid }),
]);
export const FlowManagedMusicGrantSchema = z.strictObject({
  profileId: uuid,
  profileRevision: revision,
  modelId: z.enum(["chirp-v6", "chirp-v6-wild", "chirp-v6-mini"]),
  maxCostPerRequestCredits: z.number().int().positive().max(1_000_000),
  budgetCredits: z.number().int().positive().max(1_000_000),
  creditPolicy: FlowMusicCreditPolicySchema,
  consent: z.literal(true),
});
export const FlowPublicationSchema = z.strictObject({
  target: z.literal("tme"),
  accountId: uuid,
  termsHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export const ProductionFlowPlanSchema = z
  .strictObject({
    id: uuid,
    artistId: uuid,
    title: z.string().trim().min(1).max(200),
    theme: z.string().trim().min(1).max(500),
    timezone: z
      .string()
      .min(1)
      .max(100)
      .refine((v) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: v });
          return true;
        } catch {
          return false;
        }
      }),
    localTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .nullable()
      .default(null),
    enabled: z.literal(false).default(false),
    candidateMode: z
      .enum(["local_template", "deepseek"])
      .default("local_template"),
    scoreMode: z.enum(["rule_based", "deepseek"]).default("rule_based"),
    text: FlowTextGrantSchema.nullable().default(null),
    music: z
      .union([FlowMusicGrantSchema, FlowManagedMusicGrantSchema])
      .nullable()
      .default(null),
    publication: FlowPublicationSchema.nullable().default(null),
    autoContinue: z.boolean().default(false),
    inboxEvaluation: z.boolean().default(false),
    threshold: z.number().min(0).max(100).default(75),
    maxRevisions: z.number().int().min(0).max(2).default(2),
    maxScoreRetries: z.number().int().min(0).max(2).default(2),
    maxRunsPerDay: z.number().int().min(1).max(20).default(1),
    template: CreativeDraftSchema.nullable().default(null),
  })
  .refine(
    (p) =>
      !p.inboxEvaluation ||
      (p.candidateMode === "deepseek" &&
        p.scoreMode === "deepseek" &&
        p.text !== null &&
        p.autoContinue &&
        p.music === null &&
        p.publication === null),
    "INBOX_EVALUATION_TEXT_ONLY_GRANT_REQUIRED",
  );
export type ProductionFlowPlan = z.infer<typeof ProductionFlowPlanSchema>;
export const FlowSavePlanSchema = z.strictObject({
  plan: ProductionFlowPlanSchema,
  expectedRevision: revision.nullable(),
});
export const FlowEnableSchema = z.strictObject({
  id: uuid,
  expectedRevision: revision,
});
export const FlowTriggerSchema = z.strictObject({
  planId: uuid,
  requestId: uuid,
  inboxCandidateId: uuid.optional(),
});
export const FlowIdSchema = z.strictObject({ id: uuid });
export const FlowClaimSchema = FlowEnableSchema;
export const FlowRetrySchema = FlowEnableSchema;
export const FlowUseManualAssetsSchema = z.strictObject({
  id: uuid,
  expectedRevision: revision,
  consent: z.literal(true),
});
export const FlowApproveSchema = z.discriminatedUnion("stage", [
  z.strictObject({
    id: uuid,
    expectedRevision: revision,
    stage: z.literal("candidate"),
    consent: z.literal(true),
  }),
  z.strictObject({
    id: uuid,
    expectedRevision: revision,
    stage: z.literal("publication"),
    consent: z.literal(true),
    accountId: uuid,
    termsHash: z.string().regex(/^[a-f0-9]{64}$/),
  }),
]);
export const FlowBlockSchema = z.strictObject({
  id: uuid,
  expectedRevision: revision,
  reason: code,
});
export const FlowAssetSchema = z.strictObject({
  providerSongId: z.string().min(1).max(500),
  assetId: uuid,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  ordinal: z.number().int().min(0).max(1),
});
export type FlowAsset = z.infer<typeof FlowAssetSchema>;
export const FlowReceiptSchema = z.strictObject({
  externalId: z.string().min(1).max(500),
  evidenceId: z.string().min(1).max(1000),
  observedAt: z.iso.datetime({ offset: true }),
  source: z.literal("official"),
});
const musicSubmit = z
  .strictObject({
    type: z.literal("music_submit"),
    status: z.literal("accepted"),
    trackingId: z.string().max(500).nullable().default(null),
    songIds: z
      .array(z.string().min(1).max(500))
      .length(2)
      .refine((ids) => new Set(ids).size === 2),
    actualCostCredits: z.number().int().nonnegative().max(1_000_000).nullable(),
    evidenceId: z.string().min(1).max(1000).nullable(),
  })
  .refine(
    (r) => r.actualCostCredits === null || r.evidenceId !== null,
    "COST_EVIDENCE_REQUIRED",
  );
const assets = z
  .strictObject({
    type: z.literal("music_assets"),
    status: z.enum(["pending", "complete", "failed"]),
    assets: z.array(FlowAssetSchema).max(2).default([]),
    reason: code.optional(),
  })
  .refine(
    (r) =>
      r.status !== "complete" ||
      (r.assets.length === 2 &&
        new Set(r.assets.map((a) => a.providerSongId)).size === 2 &&
        new Set(r.assets.map((a) => a.ordinal)).size === 2),
    "TWO_ORIGINAL_ASSETS_REQUIRED",
  );
const publication = z
  .strictObject({
    type: z.enum(["publication_submit", "publication_poll"]),
    status: z.enum(["accepted", "pending", "complete", "failed"]),
    externalId: z.string().min(1).max(500).optional(),
    receipt: FlowReceiptSchema.optional(),
    reason: code.optional(),
  })
  .refine(
    (r) => r.status !== "complete" || !!r.receipt,
    "OFFICIAL_RECEIPT_REQUIRED",
  )
  .refine(
    (r) => r.status !== "accepted" || !!r.externalId,
    "EXTERNAL_ID_REQUIRED",
  );
const control = z.strictObject({
  type: FlowTaskTypeSchema,
  status: z.enum(["blocked", "confirmed_unsent", "unknown"]),
  reason: code,
  confirmedUnsent: z.boolean().default(false),
});
export const FlowExternalResultSchema = z.union([
  z.strictObject({
    type: z.literal("text_generate"),
    result: LiveTextResultSchema,
  }),
  z.strictObject({
    type: z.literal("text_score"),
    result: TextEvaluationResultSchema,
  }),
  musicSubmit,
  assets,
  publication,
  control,
]);
export type FlowExternalResult = z.infer<typeof FlowExternalResultSchema>;
export const FlowRecordSchema = z.strictObject({
  id: uuid,
  operationId: uuid,
  result: FlowExternalResultSchema,
});
export const ProductionFlowSchemas = {
  "productionFlow.savePlan": FlowSavePlanSchema,
  "productionFlow.enable": FlowEnableSchema,
  "productionFlow.disable": FlowEnableSchema,
  "productionFlow.trigger": FlowTriggerSchema,
  "productionFlow.next": FlowIdSchema,
  "productionFlow.claim": FlowClaimSchema,
  "productionFlow.record": FlowRecordSchema,
  "productionFlow.context": FlowIdSchema,
  "productionFlow.approve": FlowApproveSchema,
  "productionFlow.retry": FlowRetrySchema,
  "productionFlow.block": FlowBlockSchema,
  "productionFlow.useManualAssets": FlowUseManualAssetsSchema,
  "productionFlow.list": z.strictObject({}),
};
