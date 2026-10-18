import { z } from "zod";
export const CoverRequestSchema = z.strictObject({
  workId: z.uuid(),
  requestId: z.uuid(),
  brief: z.string().max(10000),
  prompt: z.string().max(200000).optional(),
});
export const CoverReceiptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("cover-result"),
  workspaceRef: z.uuid(),
  workId: z.uuid(),
  requestId: z.uuid(),
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
