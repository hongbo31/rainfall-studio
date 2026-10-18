import { z } from "zod";
export const TmeMetadataSchema = z.strictObject({
  lyricist: z.string().max(200),
  composer: z.string().max(200),
  ownLyricist: z.boolean().nullable(),
  ownComposer: z.boolean().nullable(),
  aiMusic: z.enum(["yes", "no", "unknown"]),
  aiTool: z.string().max(100),
  generatedOn: z.string().max(10),
  statement: z.string().max(1000),
  proofAssetId: z.string().max(100),
  existingRemoteId: z.string().max(100),
  authorizationMode: z.string().max(200),
  lyrics: z.string().max(100000),
  albumId: z.string().regex(/^\d*$/).max(20).optional(),
  coverPolicy: z.enum(["local_cover", "preserve_album"]).optional(),
  version: z
    .enum(["完整版", "Live", "Remix", "伴奏", "Demo", "其他"])
    .optional(),
  genre: z.string().max(50).optional(),
  language: z.string().max(50).optional(),
  allowCover: z.boolean().optional(),
});
export const TmeInputSchema = z.strictObject({
  workId: z.uuid(),
  accountId: z.uuid(),
  metadata: TmeMetadataSchema,
  confirmations: z.strictObject({
    rights: z.boolean().optional(),
    authors: z.boolean().optional(),
    ai: z.boolean().optional(),
    lyricsHash: z.string().max(64).optional(),
    recordingHash: z.string().max(64).optional(),
    reviewHash: z.string().max(64).optional(),
  }),
});
export type TmeInput = z.infer<typeof TmeInputSchema>;
export type TmeMetadata = z.infer<typeof TmeMetadataSchema>;
export type TmeAsset = {
  id: string;
  sha256: string;
  mime: string;
  bytes: number;
  file?: string;
};
export type TmeIdentity = {
  subject: string;
  displayName: string;
  device: string;
  session: string;
  source: "browser" | "fixture";
};
export type TmeRemote = {
  id: string;
  status: "draft" | "submitted" | "rejected" | "published";
  reason: string;
  source: "browser" | "fixture";
};
export type TmePhase =
  | "BLOCKED"
  | "AWAITING_ACCOUNT"
  | "CHECKING"
  | "FILLING"
  | "UPLOADING"
  | "SAVING"
  | "RECONCILE_REQUIRED"
  | "DRAFT_SAVED"
  | "REMOTE_SUBMITTED"
  | "REMOTE_REJECTED"
  | "REMOTE_PUBLISHED";
export type TmeDraft = {
  live?: TmeLiveReceipt;
  publicationPayload?: Record<string, any>;
  id: string;
  revision: number;
  workId: string;
  workRevision: number;
  accountId: string;
  title: string;
  source: "local" | "fixture";
  state: TmePhase;
  issues: string[];
  originalLyrics: string;
  originalPrompt: string;
  metadata: TmeMetadata;
  reviewHash: string;
  recordingKey: string;
  fingerprint: string;
  assets: {
    audio: TmeAsset | null;
    cover: TmeAsset | null;
    proof: TmeAsset | null;
  };
  identity: TmeIdentity | null;
  remote: TmeRemote | null;
  uploads: Partial<
    Record<"audio" | "cover" | "proof", { remoteId: string; sha256: string }>
  >;
  pendingAction: string | null;
  reason: string;
  createdAt: string;
  updatedAt: string;
};
export type TmeLiveReceipt = {
  albumId: string | null;
  songId: string | null;
  title: string;
  status: "reviewing" | "rejected" | "published" | "unknown";
  reason: string;
  observedAt: string;
  route: string;
  source: "windows_uia";
  match: "visible_title_album" | "owned_submission_success";
  submissionByClient: boolean;
};
export type TmeLiveUnit = {
  id: string;
  batchId: string;
  workId: string;
  accountId: string;
  draftId: string | null;
  reviewHash: string;
  state: string;
  issues: string[];
  pendingAction: string | null;
  reason: string;
  attempts: number;
  identity?: TmeIdentity;
  receipt?: TmeLiveReceipt;
  contractHash?: string;
  acceptedContractHash?: string;
  updatedAt: string;
  kind: "tme_uia";
};
export const TME_ISSUES: Record<string, string> = {
  AUDIO_MISSING: "缺少已选择的托管音频",
  COVER_MISSING: "缺少已选择的托管封面",
  PROOF_MISSING: "请选择已有创作证明，不会自动生成",
  ASSET_INVALID: "素材缺失、哈希或类型不符",
  AUTHOR_NAMES: "请填写真实作词、作曲署名",
  AUTHOR_IDENTITY: "请明确本人是否为作词人、作曲人",
  RIGHTS_CONFIRMATION: "作品权利及证明尚未确认",
  AUTHOR_CONFIRMATION: "作者署名和身份尚未确认",
  AI_CONFIRMATION: "AI 声明尚未确认",
  AI_UNKNOWN: "请选择是否 AI 音乐",
  AI_TOOL: "请填写实际 AI 工具",
  AI_DATE: "生成日期无效或晚于今天",
  LYRICS_LENGTH: "正式歌词需10–20000字",
  STATEMENT_LENGTH: "音乐人说应留空或为5–300字",
  LYRICS_CONFIRMATION: "请确认当前正式歌词预览",
  AUDIO_MATCH_CONFIRMATION: "请试听并确认歌词与选定音频一致",
  REVIEW_STALE: "资料已变化，请重新预检和确认",
  ACCOUNT_REQUIRED: "请选择腾讯音乐人对应的本地账号备注",
};
