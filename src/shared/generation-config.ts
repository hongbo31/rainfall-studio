import { z } from "zod";
import { supportsImageApiModel } from "./api-profiles";
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
export const CreationTaskDraftSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  alternateTitle: z.string().trim().min(1).max(200).optional(),
  separateVersionCovers: z.literal(true).optional(),
  style: z.string().trim().min(1).max(4000),
  lyrics: z.string().max(20000),
  vocalGender: z.enum(["male", "female"]).optional(),
});
export const CreationTaskSchema = z.strictObject({
  requestId: z.uuid(),
  artistId: z.uuid(),
  draft: CreationTaskDraftSchema,
  songType: z.enum(["vocal", "instrumental"]),
  outputs: z.strictObject({ cover: z.boolean(), music: z.boolean() }),
  routing: GenerationRoutingSchema.optional(),
  music: z.discriminatedUnion("consent", [
    z.strictObject({ consent: z.literal(false) }),
    z.strictObject({ consent: z.literal(true), profileId: z.uuid(), profileRevision: z.number().int().positive(), modelId: z.string().min(1).max(200) }),
  ]),
});
export const FrozenRouteSchema = z.strictObject({
  role: GenerationRoleSchema,
  source: z.enum(["default", "override"]),
  profileId: z.string().nullable(),
  profileRevision: z.number().int().positive().nullable(),
  providerId: z.string().nullable(),
  channel: z.string(),
  modelId: z.string().nullable(),
  modelOverride: z.literal(true).optional(),
  credentialRef: z.string().nullable(),
  capability: z.enum([
    "text_api",
    "music_api",
    "music_browser",
    "image_api",
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
export function frozenRouteModelMatches(route: FrozenRoute, providerId: string, modelId: string | null) {
  return route.role === "image" && route.modelOverride && route.source === "override" && route.capability === "image_api"
    ? supportsImageApiModel(providerId, route.modelId) : modelId === route.modelId;
}
export type RouteSnapshot = z.infer<typeof RouteSnapshotSchema>;
export const GenerationConfigSaveSchema = z.strictObject({
  role: GenerationRoleSchema,
  profileId: z.uuid().nullable(),
  expectedRevision: z.number().int().nonnegative(),
});
export const GenerationConfigSchemas: Record<string, z.ZodType> = {
  "generationConfig.read": z.strictObject({}),
  "generationConfig.save": GenerationConfigSaveSchema,
  "creationTasks.taskStatus": z.strictObject({}),
  "creationTasks.checkReceipt": z.strictObject({id:z.uuid()}),
  "creationTasks.stage": CreationTaskSchema,
  "creationTasks.start": CreationTaskSchema,
};
