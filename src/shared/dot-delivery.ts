import { z } from "zod";
import { InboxId } from "./inbox";

export const DELIVERY_IMAGE_LIMITS = {
  maxBytes: 20 * 1024 * 1024,
  maxAxis: 10000,
  maxPixels: 25000000,
} as const;

const sha256 = z.string().regex(/^[a-f0-9]{64}$/, "SHA256_INVALID");
const at = z.iso.datetime({ offset: true });
const reference = z.string().trim().min(1).max(80);
const extensionForMime = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
} as const;

const DeliveryImageSchema = z
  .strictObject({
    externalItemId: InboxId,
    revision: z.number().int().positive().max(1000000),
    role: z.literal("cover"),
    // This allowlist also excludes traversal, ADS, URLs and Windows device names.
    file: z
      .string()
      .regex(/^cover-[a-f0-9]{64}\.(png|jpg|webp)$/, "IMAGE_FILENAME_INVALID"),
    sha256,
    bytes: z.number().int().positive().max(DELIVERY_IMAGE_LIMITS.maxBytes),
    mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
    width: z.number().int().positive().max(DELIVERY_IMAGE_LIMITS.maxAxis),
    height: z.number().int().positive().max(DELIVERY_IMAGE_LIMITS.maxAxis),
    provenance: z.strictObject({
      producer: z.string().min(1).max(100),
      model: z.string().max(200).nullable(),
      generatedAt: at,
    }),
  })
  .superRefine((image, ctx) => {
    if (
      image.file !== `cover-${image.sha256}.${extensionForMime[image.mimeType]}`
    )
      ctx.addIssue({
        code: "custom",
        message: "IMAGE_FILENAME_MISMATCH",
        path: ["file"],
      });
    if (image.width * image.height > DELIVERY_IMAGE_LIMITS.maxPixels)
      ctx.addIssue({ code: "custom", message: "IMAGE_PIXELS_LIMIT" });
  });

export const DeliveryManifestSchema = z
  .strictObject({
    deliveryVersion: z.literal(1),
    deliveryId: InboxId,
    createdAt: at,
    targetWorkspaceRef: reference,
    text: z.strictObject({ file: z.literal("text.json"), sha256 }),
    images: z.array(DeliveryImageSchema).min(1).max(20),
  })
  .superRefine((manifest, ctx) => {
    const files = new Set<string>(["text.json", "manifest.json", "ready.json"]);
    const covers = new Set<string>();
    for (const [index, image] of manifest.images.entries()) {
      const file = image.file.toLowerCase();
      if (files.has(file))
        ctx.addIssue({
          code: "custom",
          message: "DUPLICATE_FILE",
          path: ["images", index, "file"],
        });
      files.add(file);
      const identity = `${image.externalItemId}:${image.revision}`;
      if (covers.has(identity))
        ctx.addIssue({
          code: "custom",
          message: "DUPLICATE_COVER",
          path: ["images", index],
        });
      covers.add(identity);
    }
  });

export const DeliveryReadySchema = z.strictObject({
  deliveryId: InboxId,
  manifestSha256: sha256,
});

export type DeliveryManifest = z.infer<typeof DeliveryManifestSchema>;
export type DeliveryImage = z.infer<typeof DeliveryImageSchema>;
