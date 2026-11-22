import { z } from "zod";
import { AccountWorkWindowSchema } from "./platform-accounts";
import { PlatformTargetSchema } from "./platform-config";
import type { CredentialIdentity } from "./api-profiles";
import { imageSelectionSchema, type ImageChoice } from "./platform-image";

export const puleOrigin = "https://app.yourmusic.fun";
export const puleCreateUrl = puleOrigin + "/create";
export const puleLoginUrl = puleOrigin + "/?inviteCode=FJVMEINAXD";
export const puleAudioExtensions = ["mp3", "wav", "aac", "ogg", "m4a"];
export const puleAudioMaxBytes = 80 * 1024 * 1024;
export const puleDownloadTimeoutMs = 10 * 60_000;
export const puleDownloadRetryLimit = 3;

const pulePublicationSchema = z.strictObject({
  platform: PlatformTargetSchema,
  accountId: z.uuid(),
});
export type PulePublication = z.infer<typeof pulePublicationSchema>;
export const puleScopeSchema = AccountWorkWindowSchema.required({ artistId: true })
  .extend({ publication: pulePublicationSchema.optional(), coverImage: imageSelectionSchema.optional() });
export const puleSongFields = {
  title: z.string().trim().min(1).max(80),
  alternateTitle: z.string().trim().min(1).max(80).optional(),
  lyrics: z.string().max(5000),
  style: z.string().trim().min(1).max(1000),
};
export const puleStartSchema = puleScopeSchema.extend({
  requestId: z.uuid(),
  mode: z.enum(["custom", "cover"]),
  ...puleSongFields,
  instrumental: z.boolean(),
  uploadToken: z.uuid().optional(),
  uploadAuthorized: z.literal(true).optional(),
}).superRefine((value, ctx) => {
  if (!value.instrumental && !value.lyrics.trim())
    ctx.addIssue({ code: "custom", path: ["lyrics"], message: "需要填写歌词" });
  if (value.mode === "cover" && (!value.uploadToken || !value.uploadAuthorized))
    ctx.addIssue({ code: "custom", path: ["uploadToken"], message: "需要选择有权上传的音频" });
});

const jobId = z.strictObject({ id: z.uuid() });
export const puleBrowserSchemas = {
  "puleBrowser.status": z.strictObject({}),
  "puleBrowser.history": z.strictObject({}),
  "puleBrowser.chooseAudio": z.strictObject({}),
  "puleBrowser.start": puleStartSchema,
  "puleBrowser.confirm": jobId.extend({ quoteId: z.uuid() }),
  "puleBrowser.stop": jobId,
};

export const sunoCnBrowserSchemas = {
  "sunoCnBrowser.status": puleBrowserSchemas["puleBrowser.status"],
  "sunoCnBrowser.history": puleBrowserSchemas["puleBrowser.history"],
  "sunoCnBrowser.start": puleStartSchema,
  "sunoCnBrowser.stop": puleBrowserSchemas["puleBrowser.stop"],
  "sunoCnBrowser.retryCovers": jobId,
};

export type PuleStart = z.infer<typeof puleStartSchema>;
export type PuleSessionState = "closed" | "unverified" | "login_required" | "signed_in";
export type PuleVersion = "A" | "B";
export type PuleScope = {
  accountName: string;
  gender?: "female" | "male" | "other";
  timbre?: string;
  timbreWeight?: number;
  styleWeight?: number;
  songType?: "instrumental" | "vocal";
  archiveRoot: string | null;
  archiveFolderNames: Record<PuleVersion, string>;
  singers: Record<PuleVersion, string>;
  coverProfile: (CredentialIdentity & { modelId?: string }) | null;
  coverResolution?: number;
  coverStyle?: string;
  mood?: string;
};
export type SunoCoverScope = Pick<PuleScope, "archiveRoot" | "coverProfile" | "coverResolution" | "coverStyle" | "mood"> & {
  singers?: PuleScope["singers"];
  genre?: string;
};
export type PuleCharge = "processing" | "generation";
export type PuleStep = "opening" | "login" | "form" | "upload" | PuleCharge | "rename" | "download" | "receive" | "cover";
export type PuleQuote = { id: string; kind: PuleCharge; credits: number };
export type PuleAudioChoice = { token: string; name: string };
type PuleSavedFile = { name: string; path: string };
export type PuleFile = PuleSavedFile & {
  version: PuleVersion;
  songId: string;
  lyrics?: PuleSavedFile;
  cover?: PuleSavedFile;
};
export type PuleJob = {
  id: string;
  accountId: string;
  accountName?: string;
  title: string;
  status: "running" | "awaiting_confirmation" | "completed" | "failed" | "needs_review" | "stopped";
  step: PuleStep;
  updatedAt: string;
  quote?: PuleQuote;
  possibleCharge?: PuleCharge;
  chargeAttempts?: { kind: PuleCharge; credits?: number }[];
  coverAttempts?: PuleVersion[];
  coverImage?: Pick<ImageChoice, "providerId" | "modelId">;
  outputDirectory?: string;
  outputDirectories?: Record<PuleVersion, string>;
  code?: string;
  coverErrorCode?: string;
  songIds?: string[];
  files: PuleFile[];
};

export function canRetrySunoCovers(job: PuleJob) {
  const ids = job.songIds;
  return job.status === "needs_review" && job.step === "cover" && ids?.length === 2 && ids[0] !== ids[1] &&
    job.files.length === 2 && job.files.some(file => !file.cover) &&
    (["A", "B"] as const).every((version, index) =>
      job.files.some(file => file.version === version && file.songId === ids[index]));
}
