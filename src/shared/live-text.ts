import { z } from "zod";
import { CreativeDraftSchema } from "./creation";

export const DeepSeekModelSchema = z.enum([
  "deepseek-flash",
  "deepseek-v4-pro",
]);
export type DeepSeekModel = z.infer<typeof DeepSeekModelSchema>;
export function deepSeekResponseModelMatches(
  requested: DeepSeekModel,
  returned: string | null,
) {
  if (returned === null) return false;
  const aliases =
    requested === "deepseek-flash"
      ? ["deepseek-flash", "deepseek-v4.1-flash"]
      : ["deepseek-v4-pro", "deepseek-v4-pro-0813"];
  return aliases.includes(returned.toLowerCase());
}
export const deepSeekPriceVersion = "deepseek-peak-usd-2026-10-16";
export const DeepSeekUsageSchema = z
  .strictObject({
    prompt_tokens: z.number().int().nonnegative().max(1_000_000_000),
    completion_tokens: z.number().int().nonnegative().max(1_000_000_000),
    prompt_cache_hit_tokens: z.number().int().nonnegative().max(1_000_000_000),
    prompt_cache_miss_tokens: z.number().int().nonnegative().max(1_000_000_000),
  })
  .refine(
    (u) =>
      u.prompt_cache_hit_tokens + u.prompt_cache_miss_tokens <= u.prompt_tokens,
    "USAGE_INCONSISTENT",
  );
export type DeepSeekUsage = z.infer<typeof DeepSeekUsageSchema>;
// USD micro-units estimated from the stated peak cache-miss price. This is not an invoice.
export function estimateDeepSeekCostMicros(
  model: DeepSeekModel,
  inputTokens: number,
  outputTokens: number,
) {
  const rates = model === "deepseek-flash" ? [30, 120] : [132, 396];
  return Math.ceil((inputTokens * rates[0] + outputTokens * rates[1]) / 100);
}
export const DeepSeekRequestSchema = z.strictObject({
  operationId: z.uuid(),
  modelId: DeepSeekModelSchema,
  maxOutputTokens: z.number().int().min(256).max(16384),
  messages: z.tuple([
    z.strictObject({
      role: z.literal("system"),
      content: z.string().min(1).max(20000),
    }),
    z.strictObject({
      role: z.literal("user"),
      content: z.string().min(1).max(200000),
    }),
  ]),
});
export type DeepSeekRequest = z.infer<typeof DeepSeekRequestSchema>;
export const LiveTextPrepareSchema = z.strictObject({
  requestId: z.uuid(),
  profileId: z.uuid(),
  expectedProfileRevision: z.number().int().positive(),
  artistId: z.uuid(),
  instruction: z.string().trim().min(1).max(10000),
  parentDraftId: z.uuid().nullable(),
  seriesId: z.uuid().nullable().default(null),
  lockedQuotes: z.array(z.string().min(1).max(3000)).max(30).default([]),
  modelId: DeepSeekModelSchema,
  maxOutputTokens: z.number().int().min(256).max(16384),
  budgetMicros: z.number().int().positive().max(100_000_000),
  maxRevisions: z.number().int().min(0).max(2),
  consent: z.literal(true),
});
export type LiveTextPrepare = z.infer<typeof LiveTextPrepareSchema>;
export const LiveTextClaimSchema = z.strictObject({
  id: z.uuid(),
  expectedRevision: z.number().int().positive(),
  feedback: z.string().trim().min(1).max(4000).optional(),
});
export const LiveTextResultSchema = z
  .strictObject({
    operationId: z.uuid(),
    requestedModelId: DeepSeekModelSchema,
    status: z.enum(["complete", "invalid", "unknown"]),
    providerRequestId: z.string().min(1).max(500).nullable(),
    providerModel: z.string().min(1).max(200).nullable(),
    finishReason: z.string().max(100).nullable(),
    usage: DeepSeekUsageSchema.nullable(),
    estimatedCostMicros: z
      .number()
      .int()
      .nonnegative()
      .max(1_000_000_000_000)
      .nullable(),
    priceVersion: z.literal(deepSeekPriceVersion),
    draft: CreativeDraftSchema.nullable(),
    reasons: z
      .array(
        z
          .string()
          .regex(/^[A-Z0-9_]+$/)
          .max(100),
      )
      .max(10),
    httpStatus: z.number().int().min(100).max(599).nullable(),
  })
  .superRefine((r, ctx) => {
    if (r.usage === null && r.estimatedCostMicros !== null)
      ctx.addIssue({ code: "custom", message: "USAGE_COST_PAIR_REQUIRED" });
    if (
      r.status === "complete" &&
      (!r.draft ||
        !r.usage ||
        r.estimatedCostMicros === null ||
        !r.providerModel ||
        !r.providerRequestId ||
        r.finishReason !== "stop")
    )
      ctx.addIssue({ code: "custom", message: "COMPLETE_EVIDENCE_REQUIRED" });
    if (r.status !== "complete" && r.draft !== null)
      ctx.addIssue({ code: "custom", message: "INVALID_DRAFT_MUST_BE_NULL" });
    if (r.status === "unknown" && r.usage !== null)
      ctx.addIssue({ code: "custom", message: "KNOWN_USAGE_MUST_BE_RECORDED" });
  });
export type LiveTextResult = z.infer<typeof LiveTextResultSchema>;
export const LiveTextRecordSchema = z.strictObject({
  id: z.uuid(),
  operationId: z.uuid(),
  result: LiveTextResultSchema,
});
export const LiveTextSchemas = {
  "liveText.prepare": LiveTextPrepareSchema,
  "liveText.claim": LiveTextClaimSchema,
  "liveText.record": LiveTextRecordSchema,
  "liveText.context": z.strictObject({ id: z.uuid() }),
  "liveText.list": z.strictObject({}),
};
