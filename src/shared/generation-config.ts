import { z } from "zod";
export const GenerationRoleSchema = z.enum(["text", "image", "music"]);
export type GenerationRole = z.infer<typeof GenerationRoleSchema>;
export const RouteSelectionSchema = z
  .strictObject({
    source: z.enum(["default", "override"]),
    profileId: z.uuid().optional(),
  })
  .refine((v) => v.source !== "override" || !!v.profileId, "PROFILE_REQUIRED");
export const GenerationRoutingSchema = z.strictObject({
  text: RouteSelectionSchema,
  image: RouteSelectionSchema,
  music: RouteSelectionSchema,
});
export type GenerationRouting = z.infer<typeof GenerationRoutingSchema>;
export const FrozenRouteSchema = z.strictObject({
  role: GenerationRoleSchema,
  source: z.enum(["default", "override"]),
  profileId: z.string().nullable(),
  profileRevision: z.number().int().positive().nullable(),
  providerId: z.string().nullable(),
  channel: z.string(),
  modelId: z.string().nullable(),
  credentialRef: z.string().nullable(),
  capability: z.enum([
    "text_api",
    "music_api",
    "external_import",
    "unavailable",
  ]),
  reason: z.string().nullable(),
});
export const RouteSnapshotSchema = z.strictObject({
  defaultsRevision: z.number().int().nonnegative(),
  text: FrozenRouteSchema,
  image: FrozenRouteSchema,
  music: FrozenRouteSchema,
});
export type FrozenRoute = z.infer<typeof FrozenRouteSchema>;
export type RouteSnapshot = z.infer<typeof RouteSnapshotSchema>;
export const GenerationConfigSaveSchema = z.strictObject({
  role: GenerationRoleSchema,
  profileId: z.uuid().nullable(),
  expectedRevision: z.number().int().nonnegative(),
});
export const GenerationConfigSchemas: Record<string, z.ZodType> = {
  "generationConfig.read": z.strictObject({}),
  "generationConfig.save": GenerationConfigSaveSchema,
  "manualCreation.list": z.strictObject({}),
  "manualCreation.prepare": z.strictObject({
    requestId: z.uuid(),
    artistId: z.uuid(),
    storyBeat: z.string().trim().min(1).max(10000),
    storyStage: z.string().max(1000).default(""),
    styleTemplate: z.string().trim().max(4000).optional(),
    outputs: z.strictObject({
      lyrics: z.literal(true),
      cover: z.boolean(),
      music: z.boolean(),
    }),
    routing: GenerationRoutingSchema.optional(),
    text: z.strictObject({
      consent: z.boolean(),
      budgetMicros: z.number().int().positive().max(100000000).optional(),
      maxOutputTokens: z.number().int().min(256).max(16384).optional(),
    }),
    music: z.strictObject({
      consent: z.boolean(),
      budgetCredits: z.number().int().positive().optional(),
      maxCostPerRequestCredits: z.number().int().positive().optional(),
      pricingEvidence: z.string().max(1000).optional(),
    }),
  }),
};
