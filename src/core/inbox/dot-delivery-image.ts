import { createHash } from "node:crypto";
import sharp, { type Metadata } from "sharp";
import {
  DELIVERY_IMAGE_LIMITS,
  type DeliveryImage,
} from "../../shared/dot-delivery";

const formats = {
  png: { mime: "image/png", ext: "png" },
  jpeg: { mime: "image/jpeg", ext: "jpg" },
  webp: { mime: "image/webp", ext: "webp" },
} as const;

// libvips can expose an APNG as a one-page PNG. Inspect its bounded chunk stream
// so an animation control chunk cannot silently become a still cover.
function assertStillPng(bytes: Buffer): void {
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) throw Error("DELIVERY_IMAGE_DECODE_FAILED");
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (type === "acTL") throw Error("DELIVERY_IMAGE_ANIMATED");
    if (type === "IEND") {
      if (length !== 0) throw Error("DELIVERY_IMAGE_DECODE_FAILED");
      return;
    }
    offset = end;
  }
  throw Error("DELIVERY_IMAGE_DECODE_FAILED");
}

export async function verifyDeliveryImage(
  bytes: Buffer,
  expected: DeliveryImage,
): Promise<{
  sha256: string;
  bytes: number;
  mime: "image/png" | "image/jpeg" | "image/webp";
  ext: "png" | "jpg" | "webp";
  width: number;
  height: number;
}> {
  if (!bytes.length || bytes.length > DELIVERY_IMAGE_LIMITS.maxBytes)
    throw Error("DELIVERY_IMAGE_SIZE_LIMIT");
  if (bytes.length !== expected.bytes)
    throw Error("DELIVERY_IMAGE_SIZE_MISMATCH");
  // Keep hash and asynchronous decoder bound to the same immutable snapshot.
  const input = Buffer.from(bytes);
  const sha256 = createHash("sha256").update(input).digest("hex");
  if (sha256 !== expected.sha256) throw Error("DELIVERY_IMAGE_SHA256_MISMATCH");

  const decoder = sharp(input, {
    limitInputPixels: DELIVERY_IMAGE_LIMITS.maxPixels,
    failOn: "warning",
  });
  let metadata: Metadata;
  try {
    metadata = await decoder.metadata();
  } catch {
    throw Error("DELIVERY_IMAGE_DECODE_FAILED");
  }
  const format = metadata.format;
  if (format !== "png" && format !== "jpeg" && format !== "webp")
    throw Error("DELIVERY_IMAGE_FORMAT_UNSUPPORTED");
  if ((metadata.pages ?? 1) !== 1 || (metadata.delay?.length ?? 0) > 1)
    throw Error("DELIVERY_IMAGE_ANIMATED");
  if (format === "png") assertStillPng(input);

  const { width, height } = metadata;
  if (
    !width ||
    !height ||
    width > DELIVERY_IMAGE_LIMITS.maxAxis ||
    height > DELIVERY_IMAGE_LIMITS.maxAxis ||
    width * height > DELIVERY_IMAGE_LIMITS.maxPixels
  )
    throw Error("DELIVERY_IMAGE_DIMENSIONS_LIMIT");
  const actual = formats[format];
  if (actual.mime !== expected.mimeType)
    throw Error("DELIVERY_IMAGE_MIME_MISMATCH");
  if (width !== expected.width || height !== expected.height)
    throw Error("DELIVERY_IMAGE_DIMENSIONS_MISMATCH");

  try {
    // stats forces full pixel decoding; metadata alone can accept damaged bodies.
    await decoder.stats();
  } catch {
    throw Error("DELIVERY_IMAGE_DECODE_FAILED");
  }
  return { sha256, bytes: input.length, ...actual, width, height };
}
