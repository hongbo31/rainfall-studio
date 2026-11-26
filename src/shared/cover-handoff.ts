import { z } from "zod";
import { manualCoverPrices, type PaidCoverModelId } from "./api-profiles";
const coverVariant = z.literal("B");
export type CoverVariant = z.infer<typeof coverVariant>;
export function songCoverPrompt(context: {
  title: string;
  artist: string;
  lyrics: string;
  story?: string;
  genre?: string;
  mood?: string;
  coverStyle?: string;
}, brief: string, variant?: CoverVariant) {
  const direction = variant === "B"
    ? "这是版本 B。以歌名二的意象为主题，从歌词选择另一个具体场景或道具作为主体，采用独立的构图和色彩。"
    : "";
  return `为歌曲《${context.title}》独立创作一张无字方形封面。${direction}取材于歌词里的具体场景、动作或道具，按本首情绪决定构图、色彩和媒介，避免通用渐变和套版。无文字、标志或水印。\n艺名：${context.artist}\n故事：${context.story}\n曲风：${context.genre}\n情绪：${context.mood}\n封面风格：${context.coverStyle}\n补充：${brief}\n歌词原文：\n${context.lyrics}`;
}

export function recordingCoverPrompt(input: {
  title: string; artist?: string; genre?: string; mood?: string; coverStyle?: string; lyrics?: string;
}, version: "A" | "B") {
  const short = (value: string | undefined, limit: number) =>
    Array.from((value ?? "").replace(/[\p{P}\p{S}\p{Cf}\p{Cc}]/gu, " ").replace(/\s+/gu, " ").trim()).slice(0, limit).join("").trimEnd();
  const lyrics = (input.lyrics ?? "").split(/\r?\n/u).map(line =>
    line.replace(/[\p{P}\p{S}\p{Cf}\p{Cc}]/gu, " ").replace(/\s+/gu, " ").trim()).filter(Boolean);
  const cues = [
    ["艺人", short(input.artist, 16)], ["曲风", short(input.genre, 38)], ["色调与风格", short(input.coverStyle, 24)],
    ["情绪", short(input.mood, 12)], ["歌词意象", short([...new Set(lyrics)].slice(0, 3).join("，"), 48)],
  ];
  const direction = version === "B" ? "以另一处场景构图" : "选取一个具体场景";
  return [`为歌曲${short(input.title, 32)}绘制方形封面`, `${direction}，画面中不得出现任何文字、字母、数字、标点、符号、Logo或水印`,
    ...cues.filter(([, value]) => value).map(([label, value]) => `${label} ${value}`)].join("。") + "。";
}
export function coverAssetRole(variant?: CoverVariant) {
  return variant === "B" ? "cover_B" : "cover";
}
export function isCoverAssetRole(role: string): role is ReturnType<typeof coverAssetRole> {
  return role === "cover" || role === "cover_B";
}
export const CoverRequestSchema = z.strictObject({
  workId: z.uuid(),
  requestId: z.uuid(),
  brief: z.string().max(10000),
  prompt: z.string().max(200000).optional(),
  variant: coverVariant.optional(),
});
export const GenerateCoverSchema = CoverRequestSchema.extend({
  confirmedModelId: z.enum(Object.keys(manualCoverPrices) as PaidCoverModelId[]).optional(),
});
export const RetryCoverSchema = GenerateCoverSchema.pick({ workId: true, requestId: true, confirmedModelId: true });
export const CoverReceiptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("cover-result"),
  workspaceRef: z.uuid(),
  workId: z.uuid(),
  requestId: z.uuid(),
  variant: coverVariant.optional(),
  contextHash: z.string().regex(/^[a-f0-9]{64}$/),
  resultId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/),
  image: z.strictObject({
    fileName: z
      .string()
      .min(1)
      .max(200)
      .refine(
        (v) =>
          !/[\\/:\x00-\x1f]/.test(v) &&
          v !== "." &&
          v !== ".." &&
          !/[. ]$/.test(v),
        "BASENAME_REQUIRED",
      ),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    mime: z.enum(["image/png", "image/jpeg", "image/webp"]),
    width: z.number().int().min(512).max(10000),
    height: z.number().int().min(512).max(10000),
  }),
  provenance: z.strictObject({
    producer: z.string().min(1).max(100),
    model: z.string().max(200).nullable(),
    generatedAt: z.iso.datetime({ offset: true }).nullable(),
  }),
});
export const COVER_IMAGE_POLICY = {
  formats: ["png", "jpeg", "webp"],
  minEdge: 512,
  maxEdge: 10000,
  maxBytes: 50 * 1024 ** 2,
  maxPixels: 100000000,
  targetEdge: 3000,
  square: true,
};

export const COVER_RESOLUTION_MIN = COVER_IMAGE_POLICY.minEdge;
export const COVER_RESOLUTION_MAX = 4096;
export const coverResolutionSchema = z.number().int().min(COVER_RESOLUTION_MIN).max(COVER_RESOLUTION_MAX);
export const coverResolutionInputSchema = z.string().trim().transform((value, context) => {
  if (!value) return undefined;
  const match = /^(\d{1,4})(?:\s*[x×*＊]\s*(\d{1,4}))?$/i.exec(value);
  if (!match || (match[2] && Number(match[1]) !== Number(match[2]))) {
    context.addIssue({ code: "custom", message: "SQUARE_COVER_RESOLUTION_REQUIRED" });
    return z.NEVER;
  }
  return Number(match[1]);
}).pipe(coverResolutionSchema.optional());
export const COVER_API_IMAGE_MAX_BYTES = 8 * 1024 ** 2;
