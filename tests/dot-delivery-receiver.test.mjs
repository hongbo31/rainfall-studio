import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { build } from "esbuild";
import { createRequire } from "node:module";
import sharp from "sharp";
const outfile = path.resolve("output/dot-delivery-tests/receiver.cjs");
await build({
  stdin: {
    contents:
      "export {InboxController} from './src/core/inbox/controller';export {Repository} from './src/core/database';export {InboxService} from './src/core/inbox/service';export * from './src/core/inbox/dot-delivery-store';export * from './src/core/inbox/dot-delivery-receiver';",
    resolveDir: process.cwd(),
  },
  outfile,
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
});
const require = createRequire(import.meta.url);
require(path.resolve("tests/fixtures/offline-only.cjs"));
const {
  Repository,
  InboxService,
  InboxController,
  DotDeliveryStore,
  DotDeliveryReceiver,
} = require(outfile);
const hash = (b) => createHash("sha256").update(b).digest("hex");
const template = JSON.parse(
  fs.readFileSync("docs/integrations/dot-minimal-inbox-example.json", "utf8"),
);
function setup(t, options = {}) {
  const root = path.resolve("output/test-runs/dot-receiver-" + randomUUID());
  fs.mkdirSync(root, { recursive: true });
  const repo = new Repository(path.join(root, "library.sqlite"));
  t.after(() => repo.close());
  const artist = randomUUID();
  repo.save("artists", {
    id: artist,
    name: "Offline fixture artist",
    revision: 1,
  });
  const channel = {
    id: "fixture-channel",
    workspaceId: "fixture-workspace",
    workspaceRef: "rainfall-personal",
    artistRefs: { creator: artist },
    seriesRefs: {},
  };
  let now = new Date("2026-10-18T18:00:00Z");
  const store = new DotDeliveryStore(repo, channel, () => now),
    args = {
      store,
      deliveriesRoot: path.join(root, "deliveries"),
      receiptsRoot: path.join(root, "receipts"),
      mediaRoot: path.join(root, "media"),
      now: () => now,
      ...options,
    };
  const receiver = new DotDeliveryReceiver(args);
  return {
    root,
    repo,
    store,
    channel,
    args,
    receiver,
    advance: () => {
      now = new Date(now.getTime() + 901000);
    },
    restart: () => new DotDeliveryReceiver(args),
  };
}
async function delivery(x, id = "dot-fixture-001", options = {}) {
  const folder = path.join(x.args.deliveriesRoot, id);
  fs.mkdirSync(folder, { recursive: true });
  const text = structuredClone(template);
  text.batchId = id;
  text.items[0].externalItemId = options.itemId ?? id;
  text.items[0].revision = options.revision ?? 1;
  text.items[0].parentRevision = options.parentRevision ?? null;
  const textBytes = Buffer.from(JSON.stringify(text));
  const bytes = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#9060a0" },
    })
      .png()
      .toBuffer(),
    imageSha = hash(bytes);
  const image = {
    externalItemId: text.items[0].externalItemId,
    revision: text.items[0].revision,
    role: "cover",
    file: "cover-" + imageSha + ".png",
    sha256: imageSha,
    bytes: bytes.length,
    mimeType: "image/png",
    width: 8,
    height: 8,
    provenance: {
      producer: "dot-fixture",
      model: null,
      generatedAt: "2026-10-18T18:00:00Z",
    },
  };
  const manifest = {
    deliveryVersion: 1,
    deliveryId: id,
    createdAt: "2026-10-18T18:00:00Z",
    targetWorkspaceRef: "rainfall-personal",
    text: { file: "text.json", sha256: hash(textBytes) },
    images: [image],
  };
  if (options.change) options.change(manifest);
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  fs.writeFileSync(path.join(folder, "text.json"), textBytes);
  fs.writeFileSync(path.join(folder, image.file), bytes);
  fs.writeFileSync(path.join(folder, "manifest.json"), manifestBytes);
  const ready = { deliveryId: id, manifestSha256: hash(manifestBytes) };
  if (!options.noReady)
    fs.writeFileSync(path.join(folder, "READY.json"), JSON.stringify(ready));
  return { folder, text, bytes, image, manifest, ready };
}
test("complete text+cover commits once, preserves model_pending and exact immutable image bytes", async (t) => {
  const x = setup(t),
    p = await delivery(x);
  await x.receiver.scanOnce();
  const r = x.store.lookup(p.manifest.deliveryId);
  assert.equal(r.status, "imported");
  assert.equal(r.items[0].evaluationState, "model_pending");
  assert.equal(x.repo.all("textCandidates").length, 1);
  assert.equal(x.repo.all("assets").length, 1);
  assert.equal(x.repo.all("works").length, 0);
  assert.equal(x.repo.all("operations").length, 0);
  assert.equal(
    hash(
      fs.readFileSync(
        path.join(
          x.args.mediaRoot,
          "sha256",
          p.image.sha256.slice(0, 2),
          p.image.sha256 + ".png",
        ),
      ),
    ),
    p.image.sha256,
  );
  await x.receiver.scanOnce();
  assert.deepEqual(x.store.lookup(p.manifest.deliveryId), r);
  assert.equal(x.repo.all("textCandidates").length, 1);
  assert.equal(x.receiver.status().states[0].state, "imported");
});
test("READY before complete bytes waits, then resumes same package after restart without regeneration", async (t) => {
  const x = setup(t),
    p = await delivery(x);
  fs.unlinkSync(path.join(p.folder, p.image.file));
  await x.receiver.scanOnce();
  assert.equal(x.receiver.status().states[0].state, "waiting");
  assert.equal(x.repo.all("textCandidates").length, 0);
  fs.writeFileSync(path.join(p.folder, p.image.file), p.bytes.subarray(0, 5));
  x.advance();
  await x.restart().scanOnce();
  assert.equal(x.repo.all("textCandidates").length, 0);
  fs.writeFileSync(path.join(p.folder, p.image.file), p.bytes);
  x.advance();
  await x.restart().scanOnce();
  assert.equal(x.store.lookup(p.manifest.deliveryId).items.length, 1);
});
test("no READY means no import; old date is received when READY finally arrives", async (t) => {
  const x = setup(t),
    p = await delivery(x, "dot-20200101", { noReady: true });
  await x.receiver.scanOnce();
  assert.equal(x.repo.all("textCandidates").length, 0);
  fs.writeFileSync(path.join(p.folder, "READY.json"), JSON.stringify(p.ready));
  await x.receiver.scanOnce();
  assert.equal(x.repo.all("textCandidates").length, 1);
});
test("corrupt but hash-matching image cannot import any text or receipt", async (t) => {
  const x = setup(t),
    p = await delivery(x);
  const bad = Buffer.from("not an image");
  const imageSha = hash(bad);
  p.manifest.images[0] = {
    ...p.image,
    file: "cover-" + imageSha + ".png",
    sha256: imageSha,
    bytes: bad.length,
  };
  fs.writeFileSync(path.join(p.folder, p.manifest.images[0].file), bad);
  const manifestBytes = Buffer.from(JSON.stringify(p.manifest));
  fs.writeFileSync(path.join(p.folder, "manifest.json"), manifestBytes);
  fs.writeFileSync(
    path.join(p.folder, "READY.json"),
    JSON.stringify({ ...p.ready, manifestSha256: hash(manifestBytes) }),
  );
  await x.receiver.scanOnce();
  assert.equal(x.repo.all("textCandidates").length, 0);
  assert.equal(x.store.lookup(p.manifest.deliveryId), null);
  assert.equal(x.receiver.status().states[0].state, "rejected");
});
test("path traversal, mismapped workspace and mismatched text revision refuse all metadata", async (t) => {
  for (const change of [
    (m) => {
      m.text.file = "../outside.json";
    },
    (m) => {
      m.targetWorkspaceRef = "foreign";
    },
    (m) => {
      m.images[0].revision = 2;
    },
  ]) {
    const x = setup(t);
    await delivery(x, "dot-fixture-001", { change });
    await x.receiver.scanOnce();
    assert.equal(x.repo.all("textCandidates").length, 0);
    assert.equal(x.repo.all("assets").length, 0);
    assert.equal(x.receiver.status().states[0].state, "rejected");
  }
});
test("hard-linked input is rejected without importing or modifying its source", async (t) => {
  const x = setup(t),
    p = await delivery(x),
    original = path.join(p.folder, "text.json");
  fs.linkSync(original, path.join(x.root, "outside-copy.json"));
  const before = fs.readFileSync(original);
  await x.receiver.scanOnce();
  assert.equal(x.repo.all("textCandidates").length, 0);
  assert.deepEqual(fs.readFileSync(original), before);
  assert.equal(x.receiver.status().states[0].reason, "DELIVERY_FILE_REJECTED");
});
test("crash after DB commit rebuilds receipt and reuses all IDs on fresh receiver", async (t) => {
  let fail = true;
  const x = setup(t, {
      afterCommit: () => {
        if (fail) throw Error("injected crash");
      },
    }),
    p = await delivery(x);
  await x.receiver.scanOnce();
  const committed = x.store.lookup(p.manifest.deliveryId);
  assert.ok(committed);
  assert.equal(
    fs.existsSync(
      path.join(x.args.receiptsRoot, p.manifest.deliveryId + ".json"),
    ),
    false,
  );
  fail = false;
  x.advance();
  await x.restart().scanOnce();
  const ack = JSON.parse(
    fs.readFileSync(
      path.join(x.args.receiptsRoot, p.manifest.deliveryId + ".json"),
      "utf8",
    ),
  );
  assert.deepEqual(ack, committed);
  assert.equal(x.repo.all("assets").length, 1);
  assert.equal(x.repo.all("textCandidates").length, 1);
});
test("parallel scans and conflicting later delivery cannot overwrite the accepted revision", async (t) => {
  const x = setup(t),
    p = await delivery(x);
  await Promise.all([x.receiver.scanOnce(), x.receiver.scanOnce()]);
  const r = x.store.lookup(p.manifest.deliveryId);
  const second = await delivery(x, "dot-fixture-002", {
    itemId: p.text.items[0].externalItemId,
    change: (m) => {
      m.images[0].provenance.producer = "conflicting-declaration";
    },
  });
  const text = second.text;
  text.items[0].draft.title = "Changed under old revision";
  const bytes = Buffer.from(JSON.stringify(text));
  fs.writeFileSync(path.join(second.folder, "text.json"), bytes);
  second.manifest.text.sha256 = hash(bytes);
  const mb = Buffer.from(JSON.stringify(second.manifest));
  fs.writeFileSync(path.join(second.folder, "manifest.json"), mb);
  fs.writeFileSync(
    path.join(second.folder, "READY.json"),
    JSON.stringify({ ...second.ready, manifestSha256: hash(mb) }),
  );
  await x.receiver.scanOnce();
  assert.equal(x.store.lookup(second.manifest.deliveryId), null);
  assert.deepEqual(x.store.lookup(p.manifest.deliveryId), r);
  assert.equal(x.repo.all("textCandidates").length, 1);
});
test("v1 text import still works and delivery can bind its first cover without duplicating the candidate", async (t) => {
  const x = setup(t),
    p = await delivery(x);
  const v1 = new InboxService(x.repo, x.channel).importPackage(p.text);
  await x.receiver.scanOnce();
  assert.equal(
    x.store.lookup(p.manifest.deliveryId).items[0].candidateId,
    v1.items[0].candidateId,
  );
  assert.equal(x.repo.all("textCandidates").length, 1);
});

test("stop during image decoding leaves no imported metadata", async (t) => {
  const x = setup(t);
  await delivery(x);
  const pending = x.receiver.scanOnce();
  x.receiver.stop();
  await pending;
  assert.equal(x.repo.all("textCandidates").length, 0);
  assert.equal(x.repo.all("assets").length, 0);
  assert.equal(x.store.receipts().length, 0);
});

test("partial or stale READY remains retryable until synchronized marker is valid", async (t) => {
  for (const marker of [
    "{",
    JSON.stringify({
      deliveryId: "older-delivery",
      manifestSha256: "a".repeat(64),
    }),
    JSON.stringify({ deliveryId: "dot-fixture-001" }),
  ]) {
    const x = setup(t),
      p = await delivery(x);
    fs.writeFileSync(path.join(p.folder, "READY.json"), marker);
    await x.receiver.scanOnce();
    assert.equal(x.receiver.status().states[0].state, "waiting");
    assert.equal(x.repo.all("textCandidates").length, 0);
    fs.writeFileSync(
      path.join(p.folder, "READY.json"),
      JSON.stringify(p.ready),
    );
    x.advance();
    await x.restart().scanOnce();
    assert.ok(x.store.lookup(p.manifest.deliveryId));
  }
});

test("disk full during media or receipt write retries and reconciles committed state", async (t) => {
  for (const phase of ["media", "receipt"]) {
    const x = setup(t),
      p = await delivery(x),
      original = fs.openSync;
    let injected = false;
    fs.openSync = function (file, ...args) {
      if (
        !injected &&
        String(file).startsWith(
          phase === "media" ? x.args.mediaRoot : x.args.receiptsRoot,
        ) &&
        String(file).endsWith(".partial")
      ) {
        injected = true;
        throw Object.assign(Error("No space left"), { code: "ENOSPC" });
      }
      return original.call(this, file, ...args);
    };
    try {
      await x.receiver.scanOnce();
    } finally {
      fs.openSync = original;
    }
    assert.equal(injected, true);
    assert.equal(x.receiver.status().states[0].state, "waiting");
    assert.equal(x.receiver.status().states[0].reason, "ENOSPC");
    assert.equal(
      x.repo.all("textCandidates").length,
      phase === "media" ? 0 : 1,
    );
    x.advance();
    const receiver = x.restart();
    await receiver.scanOnce();
    assert.equal(receiver.status().states[0].state, "imported");
    assert.ok(x.store.lookup(p.manifest.deliveryId));
    assert.equal(x.repo.all("textCandidates").length, 1);
  }
});

test("controller shares v1 configuration and pause/resume with delivery receiver", async (t) => {
  const x = setup(t),
    root = path.join(x.root, "production", "inbox-v1"),
    controller = new InboxController(x.repo, root);
  assert.equal(
    controller.status().packageDelivery.cloudTransportVerified,
    false,
  );
  x.repo.save("settings", {
    id: "inbox-channel",
    channel: x.channel,
    enabled: true,
    revision: 1,
  });
  const source = {
    ...x,
    args: { ...x.args, deliveriesRoot: path.join(root, "deliveries") },
  };
  const first = await delivery(source, "dot-controller-001");
  await controller.scanOnce();
  assert.ok(x.store.lookup(first.manifest.deliveryId));
  assert.equal(controller.status().packageDelivery.states[0].state, "imported");
  assert.ok(
    fs.existsSync(
      path.join(root, "delivery-receipts", first.manifest.deliveryId + ".json"),
    ),
  );
  assert.ok(
    fs.existsSync(
      path.join(
        x.root,
        "media",
        "sha256",
        first.image.sha256.slice(0, 2),
        first.image.sha256 + ".png",
      ),
    ),
  );
  controller.disable();
  assert.equal(controller.status().packageDelivery.states[0].state, "imported");
  const second = await delivery(source, "dot-controller-002");
  await controller.scanOnce();
  assert.equal(x.store.lookup(second.manifest.deliveryId), null);
  controller.configure({
    workspaceRef: x.channel.workspaceRef,
    artistRef: "creator",
    artistId: x.channel.artistRefs.creator,
    seriesRef: null,
    seriesId: null,
    expectedRevision: 2,
  });
  await controller.scanOnce();
  assert.ok(x.store.lookup(second.manifest.deliveryId));
  assert.equal(x.repo.all("works").length, 0);
  assert.equal(x.repo.all("operations").length, 0);
  controller.stop();
});
