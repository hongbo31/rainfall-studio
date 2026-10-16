import { z } from "zod";
const short = z.string().trim().min(1).max(500);
const voice = z.enum(["male", "female", "duet", "ensemble", "instrumental"]);
const prompt = z.strictObject({
  positiveStyle: z.string().min(1).max(10000),
  negativeStyle: z.string().max(10000),
  durationTarget: z.number().int().min(10).max(1800),
  voiceArrangement: voice,
});
export const CreativeDraftSchema = z
  .strictObject({
    title: short,
    topic: short,
    storyBeat: z.string().min(1).max(10000),
    language: short,
    style: short,
    instrumental: z.boolean(),
    sections: z
      .array(
        z.strictObject({
          id: short,
          kind: short,
          lines: z.array(z.string().max(1000)).min(1).max(100),
        }),
      )
      .max(100),
    hook: z
      .strictObject({
        sectionId: short,
        startLine: z.number().int().nonnegative(),
        endLine: z.number().int().positive(),
      })
      .nullable(),
    vocalPlan: z.array(z.strictObject({ sectionId: short, voice })).max(100),
    musicPrompts: z.strictObject({ suno: prompt, yourmusic: prompt }),
    continuityNotes: z.string().max(10000),
  })
  .superRefine((d, ctx) => {
    const ids = d.sections.map((s) => s.id);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: "custom", message: "DUPLICATE_SECTION" });
    if (
      d.instrumental
        ? d.sections.length !== 0 || d.hook !== null || d.vocalPlan.length !== 0
        : !d.sections.length || !d.hook
    )
      ctx.addIssue({ code: "custom", message: "LYRICS_INSTRUMENTAL_MISMATCH" });
    if (d.hook) {
      const s = d.sections.find((s) => s.id === d.hook!.sectionId);
      if (
        !s ||
        d.hook.startLine >= d.hook.endLine ||
        d.hook.endLine > s.lines.length
      )
        ctx.addIssue({ code: "custom", message: "HOOK_RANGE" });
    }
    if (d.vocalPlan.some((v) => !ids.includes(v.sectionId)))
      ctx.addIssue({ code: "custom", message: "VOCAL_SECTION" });
  });
export type CreativeDraft = z.infer<typeof CreativeDraftSchema>;
export const parseDraft = (value: unknown) => CreativeDraftSchema.parse(value);
export const TextConfigurationSchema = z.strictObject({
  profileId: z.uuid(),
  revision: z.number().int().positive(),
  adapterId: short.nullable(),
  endpoint: z
    .string()
    .url()
    .max(2000)
    .refine((v) => {
      const u = new URL(v);
      return (
        !u.username &&
        !u.password &&
        !u.search &&
        !u.hash &&
        (u.protocol === "https:" ||
          (u.protocol === "http:" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)))
      );
    })
    .nullable(),
  modelId: short.nullable(),
  maxInputCharacters: z.number().int().positive().max(200000).nullable(),
  maxOutputTokens: z.number().int().positive().max(100000).nullable(),
  evidence: z
    .strictObject({
      version: short,
      pricingRef: short,
      privacyRef: short,
      authorityRef: short,
      schemaRef: short,
    })
    .nullable(),
  executionEnabled: z.literal(false),
});
export type TextConfiguration = z.infer<typeof TextConfigurationSchema>;
export function textReadiness(value: TextConfiguration) {
  const c = TextConfigurationSchema.parse(value);
  return [
    ...(!c.adapterId ? ["TEXT_ADAPTER_MISSING"] : []),
    ...(!c.modelId ? ["TEXT_MODEL_MISSING"] : []),
    ...(!c.maxInputCharacters || !c.maxOutputTokens
      ? ["TEXT_LIMITS_MISSING"]
      : []),
    ...(!c.evidence ? ["TEXT_EVIDENCE_MISSING"] : []),
    "LIVE_EXECUTION_DISABLED",
  ];
}
export const GenerateTurnSchema = z.strictObject({
  excludeWorkIds: z.array(z.uuid()).max(100).default([]),
  requestId: z.uuid(),
  sessionId: z.uuid(),
  artistId: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
  instruction: z.string().trim().min(1).max(10000),
  parentDraftId: z.uuid().nullable(),
  lockedQuotes: z.array(z.string().min(1).max(3000)).max(30),
  profileId: z.uuid().nullable(),
  seriesId: z.uuid().nullable(),
  budgetLimit: z.number().int().min(0).max(1000000),
});
export type GenerateTurn = z.infer<typeof GenerateTurnSchema>;
