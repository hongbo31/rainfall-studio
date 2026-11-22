import { z } from "zod";
import type { TextPricing } from "./api-profiles";
import { songTypeSchema, type SongType } from "./local-artist";
import { PlatformTargetSchema } from "./platform-config";
import { promptContentLength, promptContentLimit } from "./prompt-library";

export const defaultLyricTargetScore = 90;
export const legacyLyricTargetScore = 95;
export const lyricRewriteLimit = 10;
export const lyricTitleLimit = 40;
export const lyricStyleLimit = 1_000;
export const lyricInspirationLimit = 4_000;
export const limitLyricStyle = (style: string) => Array.from(style).slice(0, lyricStyleLimit).join("").trimEnd();
const id = z.strictObject({ id: z.uuid() });
export const LyricScoreSchema = z.number().int().min(0).max(100);
export const LyricStartFieldsSchema = id.extend({
  mode: z.enum(["inspiration", "musician"]),
  inspiration: z.string().trim().max(16_000),
  artistId: z.uuid().nullable(),
  expectedSongType: songTypeSchema.optional(),
  templateId: z.uuid().nullable().optional(),
  profileId: z.uuid(),
  profileRevision: z.number().int().positive(),
  followDefault: z.boolean().optional(),
  budgetMicros: z.number().int().positive().max(1_000_000_000_000).optional(),
  targetScore: LyricScoreSchema.optional(),
  maxRewrites: z.number().int().min(0).max(lyricRewriteLimit),
  consent: z.literal(true),
});
export const LyricStartSchema = LyricStartFieldsSchema.refine(input => input.mode === "inspiration" ? !!input.inspiration && !input.artistId : !!input.artistId);
export const LyricInspirationStartSchema = LyricStartFieldsSchema.pick({
  id: true, profileId: true, profileRevision: true, followDefault: true, budgetMicros: true, consent: true,
}).extend({
  platform: PlatformTargetSchema,
  accountId: z.uuid(),
  artistId: z.uuid(),
  artistRevision: z.number().int().positive(),
});
export const LyricSuggestSchema = id.extend({ requestId: z.uuid(), consent: z.literal(true) });
export const lyricWritingSchemas = {
  "lyricWriting.start": LyricStartSchema,
  "lyricWriting.startInspiration": LyricInspirationStartSchema,
  "lyricWriting.list": z.strictObject({}),
  "lyricWriting.read": id,
  "lyricWriting.stop": id,
  "lyricWriting.suggest": LyricSuggestSchema,
};

const title = z.string().transform(value => {
  // Remove emoji that contain a letter or digit before selecting the title characters.
  const text = value.replace(/[0-9#*]\uFE0F?\u20E3|[\p{Extended_Pictographic}\p{Default_Ignorable_Code_Point}]/gu, "").normalize("NFC");
  // Keep vowel and accent marks attached to letters, including in languages such as Thai.
  const parts = text.match(/\p{L}[\p{Mn}\p{Mc}]*|\p{Nd}|\s+/gu) ?? [];
  return parts.join("").replace(/\s+/gu, " ").trim();
}).pipe(z.string().min(1).max(lyricTitleLimit));
const lyrics = z.string().trim().min(1).max(20_000);
const comparableTitle = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{M}\p{Nd}]/gu, "");
const songDescription = {
  title, alternateTitle: title, style: z.string().trim().min(1).transform(limitLyricStyle),
};
function distinctTitles(draft: { title: string; alternateTitle: string }) {
  const main = comparableTitle(draft.title), alternate = comparableTitle(draft.alternateTitle);
  return !!main && !!alternate && main !== alternate;
}
export const InstrumentalLyricDraftSchema = z.object(songDescription).refine(distinctTitles);
export const LyricInspirationDraftSchema = z.strictObject({
  title, alternateTitle: title, inspiration: z.string().trim().min(1).max(lyricInspirationLimit),
}).refine(distinctTitles);
export const LyricDraftSchema = z.strictObject({
  ...songDescription, language: z.string().trim().min(1).max(200), lyrics,
  creativeSummary: z.string().trim().min(1).max(1500).optional(),
}).refine(distinctTitles);
export const LyricRewriteSchema = z.strictObject({ lyrics, creativeSummary: z.string().trim().min(1).max(1500).optional() });
export const lyricCriterionMaxScore = 20;
const criterionScore = z.number().int().min(0).max(lyricCriterionMaxScore);
const lyricRubric = z.strictObject({
  styleFit: criterionScore,
  narrative: criterionScore,
  naturalness: criterionScore,
  singability: criterionScore,
  hook: criterionScore,
});
export const lyricReviewCriteria = {
  styleFit: "风格贴合",
  narrative: "叙事与情绪",
  naturalness: "语言自然度",
  singability: "文本可唱性",
  hook: "副歌记忆点",
} satisfies Record<keyof z.infer<typeof lyricRubric>, string>;
export const LyricReviewSchema = z.strictObject({
  revisionId: z.uuid(), score: LyricScoreSchema, languageMatches: z.boolean(),
  findings: z.array(z.string().trim().min(1).max(1_000)).min(1).max(12),
  rubric: lyricRubric.optional(),
});
export const LyricPromptSchema = z.strictObject({
  prompt: z.string().trim().min(1).refine(text => promptContentLength(text) <= promptContentLimit),
});

export type LyricVersion = z.infer<typeof InstrumentalLyricDraftSchema> & Partial<Pick<z.infer<typeof LyricDraftSchema>, "lyrics" | "language" | "creativeSummary">> & {
  id: string;
  rewriteNumber?: number;
  review: z.infer<typeof LyricReviewSchema> | null;
  reviewIssue?: LyricReviewIssue;
};
export type LyricReviewIssue = "json" | "fields" | "score" | "rubric" | "languageMatches" | "findings" | "revision";
export type LyricTextIssue = {
  phase: LyricJob["phase"];
  reason: string;
  httpStatus: number | null;
  finishReason: string | null;
  hasReceipt: boolean;
  completionTokens: number | null;
  maxOutputTokens?: number;
};

export function canResumeLyricResponse(reason: string | null | undefined) {
  return reason === "TEXT_RESPONSE_METADATA_INVALID" || reason === "TEXT_OUTPUT_TRUNCATED" ||
    reason === "TEXT_OUTPUT_INTERRUPTED" || reason === "TEXT_RESPONSE_RECEIPT_MISSING" ||
    reason === "TEXT_CONTENT_INVALID" || reason === "LYRIC_RESULT_INVALID";
}

export type LyricJob = {
  id: string;
  kind?: "inspiration";
  inspirationResult?: z.infer<typeof LyricInspirationDraftSchema> & {
    id: string;
    review: z.infer<typeof LyricReviewSchema> | null;
  };
  profileId: string;
  profileRevision: number;
  profileLabel: string;
  modelId: string;
  currency: TextPricing["currency"];
  musicianName: string | null;
  templateName: string | null;
  inspiration: string;
  songType?: SongType;
  versions: LyricVersion[];
  currentVersionId?: string;
  targetScore?: number;
  resultVersionId?: string;
  phase: "generate" | "score" | "rewrite" | "prompt";
  state: "ready" | "dispatching" | "complete" | "rejected" | "unknown" | "stopped" | "blocked";
  reason: string | null;
  reviewIssue?: LyricReviewIssue;
  textIssue?: LyricTextIssue;
  operationId: string | null;
  stopRequested: boolean;
  maxRewrites: number;
  rewrites: number;
  budgetMicros: number;
  spentMicros: number;
  reservedMicros: number;
  suggestedPrompt: string | null;
  createdAt: string;
};
export type LyricJobSummary = Pick<LyricJob, "id" | "kind" | "state" | "phase" | "inspiration" | "musicianName" | "createdAt" | "songType"> & { title: string | null };

export function lyricResultText(result: Pick<LyricVersion, "title" | "alternateTitle" | "style" | "lyrics">) {
  const oneLine = (value: string) => value.replace(/[\r\n]+/gu, " ");
  const lines = [`${oneLine(result.title)}、${oneLine(result.alternateTitle)}`, oneLine(result.style)];
  if (result.lyrics !== undefined) lines.push(result.lyrics);
  return lines.join("\n").replace(/\r\n?|\n/gu, "\r\n");
}

export function bestLyricVersion(versions: LyricVersion[]) {
  let best: LyricVersion | undefined;
  for (const version of versions) {
    if (!version.review) continue;
    if (!best?.review || (version.review.languageMatches && !best.review.languageMatches) ||
      (version.review.languageMatches === best.review.languageMatches && version.review.score >= best.review.score)) best = version;
  }
  return best ?? versions.at(-1);
}

export function highestScoredLyricVersion(versions: LyricVersion[]) {
  let best: LyricVersion | undefined;
  for (const version of versions) {
    const review = version.review;
    if (!review) continue;
    if (!best?.review || review.score > best.review.score ||
      (review.score === best.review.score && (review.languageMatches || !best.review.languageMatches))) best = version;
  }
  return best;
}

export function lyricCurrentVersion({ currentVersionId, versions }: Pick<LyricJob, "currentVersionId" | "versions">) {
  return currentVersionId ? versions.find(version => version.id === currentVersionId) : versions.at(-1);
}

export function lyricResultVersion(job: Pick<LyricJob, "currentVersionId" | "resultVersionId" | "versions">) {
  return job.resultVersionId ? job.versions.find(version => version.id === job.resultVersionId) : lyricCurrentVersion(job);
}

export function meetsLyricTarget(review: LyricVersion["review"] | undefined, targetScore: number) {
  return !!review?.languageMatches && review.score >= targetScore;
}
