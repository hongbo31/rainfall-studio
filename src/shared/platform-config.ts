import {TmeAiPrepareMetadataSchema} from "./tme-ai-metadata";
import { z } from "zod";

export const platformTargets = [
  "netease",
  "qishui",
  "qqmusic",
  "kugou",
  "douyin",
  "fanqie",
] as const;
export type PlatformTarget = (typeof platformTargets)[number];
export const PlatformTargetSchema = z.enum(platformTargets);
export const PlatformConfigurationInputSchema = z.strictObject({
  target: PlatformTargetSchema,
  accountId: z.uuid().nullable(),
  artistId: z.uuid().nullable(),
  lyricist: z.string().trim().max(500),
  composer: z.string().trim().max(500),
  album: z.string().trim().max(500),
  language: z.string().trim().max(100),
  genre: z.string().trim().max(200),
  aiDisclosure: z.enum(["unknown", "none", "assisted", "generated"]),
  isCover: z.boolean().nullable(),
});
export type PlatformConfigurationInput = z.infer<
  typeof PlatformConfigurationInputSchema
>;
export type PlatformConfiguration = PlatformConfigurationInput & {
  version: 1;
  revision: number;
};
export const maxPublicationWorks = 100;
export const PublishSelectionSchema = z.strictObject({
  workIds: z.array(z.uuid()).max(maxPublicationWorks),
  targets: z.array(PlatformTargetSchema).max(100),
  accountOverrides: z.partialRecord(PlatformTargetSchema, z.uuid()).default({}),
});
export type PublishSelection = {
  workIds: string[];
  targets: PlatformTarget[];
  accountOverrides: Partial<Record<PlatformTarget, string>>;
};
export type SimplePublicationState =
  | "needs_configuration"
  | "needs_materials"
  | "awaiting_terms_review"
  | "unavailable"
  | "ready";
export interface SimpleMaterialSnapshot {
  schemaVersion: 1;
  workId: string;
  workRevision: number;
  title: string;
  recordingSlot: "audio_A" | "audio_B";
  audio: {
    assetId: string;
    sha256: string;
    mime: string;
    bytes: number;
    boundAssetId?: string;
    label?: string;
    format?: string;
    durationSeconds?: number;
    codec?: string;
    sampleRate?: number;
  } | null;
  cover: {
    assetId: string;
    sha256: string;
    mime: string;
    bytes: number;
    width?: number;
    height?: number;
  } | null;
  video: {
    assetId: string;
    sha256: string;
    mime: string;
    bytes: number;
  } | null;
  lyrics: {
    versionId: string | null;
    source: unknown;
    raw: string;
    plainText: string;
    plainHash: string;
    alignmentConfirmed: boolean;
    audioHash: string | null;
    synchronization: string;
  };
  metadata: {
    artistId: string | null;
    artistName?: string;
    lyricist: string;
    composer: string;
    album: string;
    language: string;
    genre: string;
    aiDisclosure: string;
    isCover: boolean | null;
  };
  defaults: PlatformConfigurationInput;
  rights: string;
  ai: string;
  isCover: boolean | null;
  coverAuthorization: string | null;
  account?: {
    accountId: string;
    name: string;
    authStatus: string;
    identityHash?: string | null;
  } | null;
  provenance?: {
    audioSource: string;
    audioLabel: string;
    provider: string | null;
    model: string | null;
    providerTaskId: string | null;
    providerSongIds: string[];
    statement: string;
  };
  terms?: {
    jobId: string;
    termsText: string;
    termsHash: string;
    accepted: false;
  };
}
export interface SimplePublicationRequest {
  id: string;
  workId: string;
  title: string;
  target: PlatformTarget;
  accountId: string | null;
  state: SimplePublicationState;
  summary: string;
  issues: string[];
  createdAt: string;
  updatedAt: string;
  source: "local" | "simulation";
  formalSubmission: false;
  configurationTarget: PlatformTarget;
  materialSnapshot: SimpleMaterialSnapshot;
  submission?: { available: false; reason: string };
  stale?: boolean;
}
export interface PublicationPendingTerms {
  id: string;
  workId: string;
  title: string;
  summary: "待条款确认";
  termsText: string;
  termsHash: string;
  createdAt: string;
  platformLabel: "腾讯音乐";
}
export const SimplePublishingSchemas = {
  "platformConfig.list": z.strictObject({}),
  "platformConfig.save": z.strictObject({
    config: PlatformConfigurationInputSchema,
    expectedRevision: z.number().int().nonnegative(),
  }),
  "platformConfig.setAccount": z.strictObject({
    target: PlatformTargetSchema,
    accountId: z.uuid().nullable(),
    expectedRevision: z.number().int().nonnegative(),
  }),
  "publish.selection.save": PublishSelectionSchema,
  "publish.metadata.save": z.strictObject({workId:z.uuid(),expectedRevision:z.number().int().positive(),metadata:TmeAiPrepareMetadataSchema.omit({title:true})}),
  "publish.reconcile": z.strictObject({id:z.uuid()}),
  "publish.simple": PublishSelectionSchema.refine(
    (v) => v.workIds.length > 0,
    "请选择歌曲",
  ).refine((v) => v.targets.length > 0, "请选择平台"),
};
