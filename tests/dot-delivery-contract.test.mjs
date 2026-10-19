import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { build } from "esbuild";
import sharp from "sharp";

const require = createRequire(import.meta.url);
let contract = {},
  verifier = {};
for (const [entry, name] of [
  ["src/shared/dot-delivery.ts", "contract"],
  ["src/core/inbox/dot-delivery-image.ts", "image"],
]) {
  if (!fs.existsSync(entry)) continue;
  const outfile = path.resolve(`output/dot-delivery-${name}-test.cjs`);
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    packages: "external",
  });
  if (name === "contract") contract = require(outfile);
  else verifier = require(outfile);
}
const at = "2026-10-18T09:00:00+08:00";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const mimeFor = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };
function image(
  bytes = Buffer.from("test"),
  ext = "png",
  width = 12,
  height = 9,
) {
  const sha256 = hash(bytes);
  return {
    externalItemId: "dot-item-1",
    revision: 1,
    role: "cover",
    file: `cover-${sha256}.${ext}`,
    sha256,
    bytes: bytes.length,
    mimeType: mimeFor[ext],
    width,
    height,
    provenance: { producer: "dot", model: null, generatedAt: at },
  };
}
function manifest(images = [image()]) {
  return {
    deliveryVersion: 1,
    deliveryId: "dot-20261018-r1",
    createdAt: at,
    targetWorkspaceRef: "rainfall-personal",
    text: { file: "text.json", sha256: hash(Buffer.from("text")) },
    images,
  };
}
function rejectSchema(value, schema = contract.DeliveryManifestSchema) {
  assert(schema, "DELIVERY_CONTRACT_MISSING");
  assert.equal(schema.safeParse(value).success, false);
}
async function verify(bytes, expected) {
  assert.equal(
    typeof verifier.verifyDeliveryImage,
    "function",
    "DELIVERY_IMAGE_VERIFIER_MISSING",
  );
  return verifier.verifyDeliveryImage(bytes, expected);
}
async function fixture(ext = "png", width = 12, height = 9) {
  return sharp({
    create: { width, height, channels: 3, background: "#345678" },
  })
    .toFormat(ext === "jpg" ? "jpeg" : ext)
    .toBuffer();
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(name, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length);
  out.write(name, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, -4)), out.length - 4);
  return out;
}

test("dot delivery contract and verifier exist", () => {
  assert(
    fs.existsSync("src/shared/dot-delivery.ts"),
    "DELIVERY_CONTRACT_MISSING",
  );
  assert(
    fs.existsSync("src/core/inbox/dot-delivery-image.ts"),
    "DELIVERY_IMAGE_VERIFIER_MISSING",
  );
});

test("strict manifest and READY dispatch v1/v2 and reject unknown envelopes", () => {
  assert(contract.DeliveryManifestSchema, "DELIVERY_CONTRACT_MISSING");
  assert.deepEqual(
    contract.DeliveryManifestSchema.parse(manifest()),
    manifest(),
  );
  const ready = {
    deliveryId: "dot-20261018-r1",
    manifestSha256: hash(Buffer.from("manifest")),
  };
  assert.deepEqual(contract.DeliveryReadySchema.parse(ready), ready);
  rejectSchema(
    { ...ready, url: "https://invalid.example" },
    contract.DeliveryReadySchema,
  );
  rejectSchema({ ...ready, deliveryId: "CON" }, contract.DeliveryReadySchema);
  rejectSchema(
    { ...ready, manifestSha256: "placeholder" },
    contract.DeliveryReadySchema,
  );
  for (const value of [
    { ...manifest(), extra: true },
    { ...manifest(), deliveryVersion: 3 },
    { ...manifest(), createdAt: "2026-10-18" },
    { ...manifest(), deliveryId: "../x" },
    { ...manifest(), targetWorkspaceRef: "" },
    { ...manifest(), images: [] },
    { ...manifest(), text: { ...manifest().text, file: "other.json" } },
    { ...manifest(), text: { ...manifest().text, extra: true } },
    { ...manifest(), images: [{ ...image(), extra: true }] },
    {
      ...manifest(),
      images: [
        { ...image(), provenance: { ...image().provenance, verified: true } },
      ],
    },
    {
      ...manifest(),
      images: [
        {
          ...image(),
          provenance: { ...image().provenance, generatedAt: "today" },
        },
      ],
    },
  ])
    rejectSchema(value);
  const lyricsOnly = { ...manifest(), deliveryVersion: 2, images: [] };
  assert.deepEqual(
    contract.DeliveryManifestSchema.parse(lyricsOnly),
    lyricsOnly,
  );
  rejectSchema({ ...lyricsOnly, extra: true });
});

test("manifest rejects unsafe paths and mismatched content addressed filenames", () => {
  for (const file of [
    "../cover.png",
    "..\\cover.png",
    "/cover.png",
    "C:\\cover.png",
    "\\\\server\\cover.png",
    "https://invalid.example/x.png",
    "CON",
    "NUL.png",
    "aux.jpg",
    "com1.webp",
    "cover.png:stream",
    "cover.png.",
    "cover.png ",
    `cover-${image().sha256.toUpperCase()}.png`,
    `cover-${"0".repeat(64)}.png`,
    `cover-${image().sha256}.jpeg`,
    `cover-${image().sha256}.jpg`,
  ]) {
    rejectSchema(manifest([{ ...image(), file }]));
  }
  rejectSchema(manifest([{ ...image(), sha256: "<64 hex>" }]));
});

test("manifest rejects duplicate covers, case folded filename collisions and excess images", () => {
  rejectSchema(
    manifest([
      image(),
      { ...image(Buffer.from("different")), externalItemId: "dot-item-1" },
    ]),
  );
  rejectSchema(
    manifest([image(), { ...image(), externalItemId: "dot-item-2" }]),
  );
  rejectSchema(
    manifest([
      image(),
      {
        ...image(),
        externalItemId: "dot-item-2",
        file: image().file.toUpperCase(),
      },
    ]),
  );
  const images = Array.from({ length: 20 }, (_, i) => ({
    ...image(Buffer.from(String(i))),
    externalItemId: `item-${i}`,
  }));
  assert(contract.DeliveryManifestSchema.safeParse(manifest(images)).success);
  rejectSchema(
    manifest([
      ...images,
      { ...image(Buffer.from("21")), externalItemId: "item-21" },
    ]),
  );
});

test("manifest rejects unsupported MIME, invalid revisions and unsafe image resource claims", () => {
  for (const changes of [
    { mimeType: "image/gif" },
    { revision: 0 },
    { revision: 1.5 },
    { bytes: 0 },
    { bytes: 20 * 1024 * 1024 + 1 },
    { width: 10001 },
    { height: 10001 },
    { width: 0 },
    { width: 5001, height: 5000 },
    { role: "thumbnail" },
    { externalItemId: "NUL" },
  ]) {
    rejectSchema(manifest([{ ...image(), ...changes }]));
  }
});

for (const ext of ["png", "jpg", "webp"]) {
  test(`verifier fully decodes a still ${ext} and returns actual identity`, async () => {
    const bytes = await fixture(ext);
    assert.deepEqual(await verify(bytes, image(bytes, ext)), {
      sha256: hash(bytes),
      bytes: bytes.length,
      mime: mimeFor[ext],
      ext,
      width: 12,
      height: 9,
    });
  });
  test(`verifier rejects truncated ${ext} even with matching SHA and byte count`, async () => {
    const bytes = await fixture(ext),
      truncated = bytes.subarray(0, Math.floor(bytes.length / 2));
    await assert.rejects(
      verify(truncated, image(truncated, ext)),
      /DELIVERY_IMAGE_DECODE_FAILED/,
    );
  });
}

test("verifier checks hash, size, MIME and dimensions against actual bytes", async () => {
  const bytes = await fixture();
  await assert.rejects(
    verify(bytes, { ...image(bytes), sha256: "0".repeat(64) }),
    /DELIVERY_IMAGE_SHA256_MISMATCH/,
  );
  await assert.rejects(
    verify(bytes, { ...image(bytes), bytes: bytes.length + 1 }),
    /DELIVERY_IMAGE_SIZE_MISMATCH/,
  );
  await assert.rejects(
    verify(bytes, { ...image(bytes), mimeType: "image/jpeg" }),
    /DELIVERY_IMAGE_MIME_MISMATCH/,
  );
  await assert.rejects(
    verify(bytes, { ...image(bytes), width: 13 }),
    /DELIVERY_IMAGE_DIMENSIONS_MISMATCH/,
  );
  await assert.rejects(
    verify(Buffer.alloc(0), image(Buffer.alloc(0))),
    /DELIVERY_IMAGE_SIZE_LIMIT/,
  );
  const tooLarge = Buffer.alloc(20 * 1024 * 1024 + 1);
  await assert.rejects(
    verify(tooLarge, image(tooLarge)),
    /DELIVERY_IMAGE_SIZE_LIMIT/,
  );
  const invalid = Buffer.from("not an image");
  await assert.rejects(
    verify(invalid, image(invalid)),
    /DELIVERY_IMAGE_DECODE_FAILED/,
  );
  const gif = await sharp({
    create: { width: 12, height: 9, channels: 3, background: "red" },
  })
    .gif()
    .toBuffer();
  await assert.rejects(
    verify(gif, image(gif)),
    /DELIVERY_IMAGE_FORMAT_UNSUPPORTED/,
  );
});

test("verifier enforces actual axis and pixel limits independently of expected metadata", async () => {
  const wide = await fixture("png", 10001, 1);
  await assert.rejects(
    verify(wide, image(wide, "png", 1, 1)),
    /DELIVERY_IMAGE_DIMENSIONS_LIMIT/,
  );
  const bomb = Buffer.from(await fixture());
  bomb.writeUInt32BE(100000, 16);
  bomb.writeUInt32BE(100000, 20);
  bomb.writeUInt32BE(crc32(bomb.subarray(12, 29)), 29);
  await assert.rejects(
    verify(bomb, image(bomb, "png", 1, 1)),
    /DELIVERY_IMAGE_(DECODE_FAILED|DIMENSIONS_LIMIT)/,
  );
});

test("verifier decodes the image body even when valid metadata is readable", async () => {
  const bytes = Buffer.from(await fixture());
  let offset = 8;
  while (bytes.toString("ascii", offset + 4, offset + 8) !== "IDAT") {
    offset += bytes.readUInt32BE(offset) + 12;
  }
  const length = bytes.readUInt32BE(offset);
  bytes[offset + 8] = 0; // Break the zlib stream while retaining valid PNG chunks.
  bytes.writeUInt32BE(
    crc32(bytes.subarray(offset + 4, offset + 8 + length)),
    offset + 8 + length,
  );
  assert.equal((await sharp(bytes).metadata()).width, 12);
  await assert.rejects(
    verify(bytes, image(bytes)),
    /DELIVERY_IMAGE_DECODE_FAILED/,
  );
});

test("verifier rejects animated WebP instead of validating only its first frame", async () => {
  const frames = Buffer.alloc(12 * 18 * 3);
  frames.fill(255, 12 * 9 * 3);
  const bytes = await sharp(frames, {
    raw: { width: 12, height: 18, pageHeight: 9, channels: 3 },
  })
    .webp({ loop: 0, delay: [100, 100] })
    .toBuffer();
  assert.equal((await sharp(bytes).metadata()).pages, 2);
  await assert.rejects(
    verify(bytes, image(bytes, "webp")),
    /DELIVERY_IMAGE_ANIMATED/,
  );
});

test("verifier rejects PNG animation controls even when the decoder exposes one page", async () => {
  const png = await fixture(),
    control = Buffer.alloc(8);
  control.writeUInt32BE(2, 0);
  const bytes = Buffer.concat([
    png.subarray(0, 33),
    chunk("acTL", control),
    png.subarray(33),
  ]);
  await assert.rejects(verify(bytes, image(bytes)), /DELIVERY_IMAGE_ANIMATED/);
});
