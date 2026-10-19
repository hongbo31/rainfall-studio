// Offline metadata tests only: synthetic descriptors, isolated SQLite, no generation.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const project = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
if (!process.versions.electron) {
  test("dot delivery metadata suite uses the Electron SQLite ABI", () => {
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
    delete env.NODE_TEST_CONTEXT;
    const child = spawnSync(
      require("electron"),
      ["--test", fileURLToPath(import.meta.url)],
      {
        cwd: project,
        env,
        encoding: "utf8",
        windowsHide: true,
      },
    );
    assert.equal(child.status, 0, child.stdout + child.stderr);
    assert.match(child.stdout, /tests 9/);
    process.stdout.write(child.stdout);
  });
} else {
  const buildRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "rainfall-dot-store-build-"),
  );
  const bundle = path.join(buildRoot, "store.cjs");
  await build({
    stdin: {
      contents: `export { DotDeliveryStore } from './src/core/inbox/dot-delivery-store'; export { Repository } from './src/core/database'; export { InboxService } from './src/core/inbox/service';`,
      resolveDir: project,
      loader: "ts",
    },
    outfile: bundle,
    bundle: true,
    platform: "node",
    format: "cjs",
    packages: "external",
    nodePaths: [path.join(project, "node_modules")],
  });
  // Resolve native packages from the candidate checkout, while keeping generated code isolated.
  const Module = require("node:module");
  const originalNodePath = process.env.NODE_PATH;
  process.env.NODE_PATH = [path.join(project, "node_modules"), originalNodePath]
    .filter(Boolean)
    .join(path.delimiter);
  Module._initPaths();
  const { Repository, DotDeliveryStore, InboxService } = require(bundle);
  test.after(() => {
    if (originalNodePath === undefined) delete process.env.NODE_PATH;
    else process.env.NODE_PATH = originalNodePath;
    Module._initPaths();
    fs.rmSync(buildRoot, { recursive: true, force: true });
  });
  const { draft } = require("./fixtures/workflow.cjs");
  const hash = (value) =>
    createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const at = "2026-10-18T12:00:00Z";
  function setup(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rainfall-dot-store-"));
    const repo = new Repository(path.join(root, "isolated.sqlite"));
    t.after(() => {
      repo.close();
      fs.rmSync(root, { recursive: true, force: true });
    });
    const artistId = randomUUID();
    repo.save("artists", { id: artistId, name: "synthetic-test-artist" });
    const channel = {
      id: "dot-test-channel",
      workspaceId: "isolated-workspace",
      workspaceRef: "isolated-test",
      artistRefs: { creator: artistId },
      seriesRefs: {},
    };
    const store = new DotDeliveryStore(repo, channel, () => new Date(at));
    return { repo, channel, store };
  }
  function input({
    deliveryId = "delivery-one",
    batchId = deliveryId,
    count = 1,
    revision = 1,
    parentRevision = null,
    imageSeed = "cover",
  } = {}) {
    const items = Array.from({ length: count }, (_, i) => ({
      externalItemId: "item-" + i,
      revision,
      parentRevision,
      artistRef: "creator",
      seriesRef: null,
      draft: draft(),
      provenance: {
        producer: "dot",
        model: null,
        promptVersion: null,
        generatedAt: at,
      },
    }));
    const textPackage = {
      schemaVersion: 1,
      batchId,
      createdAt: at,
      targetWorkspaceRef: "isolated-test",
      items,
    };
    const images = items.map((item, i) => {
      const sha256 = hash([imageSeed, i]);
      return {
        externalItemId: item.externalItemId,
        revision,
        role: "cover",
        file: `cover-${sha256}.png`,
        sha256,
        bytes: 100 + i,
        mimeType: "image/png",
        width: 32,
        height: 32,
        provenance: { producer: "dot", model: null, generatedAt: at },
      };
    });
    const manifest = {
      deliveryVersion: 1,
      deliveryId,
      createdAt: at,
      targetWorkspaceRef: "isolated-test",
      text: { file: "text.json", sha256: hash(textPackage) },
      images,
    };
    return {
      manifest,
      manifestSha256: hash(manifest),
      textPackage,
      images: images.map((image) => ({
        externalItemId: image.externalItemId,
        revision,
        asset: {
          id: randomUUID(),
          sha256: image.sha256,
          kind: "image",
          ext: "png",
          mime: image.mimeType,
          bytes: image.bytes,
          metadata: { width: image.width, height: image.height },
          createdAt: at,
          source: "dot-delivery",
          label: image.file,
        },
      })),
    };
  }
  const snapshot = (repo) =>
    Object.fromEntries(
      [
        "assets",
        "drafts",
        "textCandidates",
        "settings",
        "inboxBatches",
        "inboxReceipts",
      ].map((table) => [table, repo.all(table)]),
    );

  test("atomic import binds independent IDs and keeps model evaluation pending without generation", (t) => {
    const x = setup(t),
      delivery = input(),
      receipt = x.store.commit(delivery);
    assert.equal(receipt.importedAt, new Date(at).toISOString());
    assert.equal(receipt.workspaceId, x.channel.workspaceId);
    assert.equal(receipt.status, "imported");
    const item = receipt.items[0],
      candidate = x.repo.get("textCandidates", item.candidateId);
    assert.notEqual(item.candidateId, item.draftId);
    assert.deepEqual(candidate.cover, {
      assetId: item.coverAssetId,
      sha256: item.coverSha256,
      revision: 1,
      source: "dot-delivery",
    });
    assert.deepEqual(x.repo.get("drafts", item.draftId).cover, candidate.cover);
    assert.equal(candidate.evaluationState, "model_pending");
    assert.ok(candidate.localCheck);
    assert.deepEqual(x.store.lookup("DELIVERY-ONE"), receipt);
    assert.deepEqual(x.store.receipts(), [receipt]);
    for (const table of [
      "operations",
      "works",
      "revisions",
      "evaluations",
      "creativeTurns",
      "candidates",
      "dailyPlans",
      "occurrences",
      "workflowLedger",
      "selectionEvents",
    ])
      assert.equal(x.repo.all(table).length, 0, table);
  });
  test("case-folded delivery retry returns persisted receipt and hash conflict cannot mutate metadata", (t) => {
    const x = setup(t),
      delivery = input(),
      first = x.store.commit(delivery),
      before = snapshot(x.repo);
    const retry = structuredClone(delivery);
    retry.manifest.deliveryId = "DELIVERY-ONE";
    assert.deepEqual(x.store.commit(retry), first);
    assert.deepEqual(snapshot(x.repo), before);
    const conflict = input({
      deliveryId: "DELIVERY-ONE",
      imageSeed: "changed",
    });
    assert.throws(
      () => x.store.commit(conflict),
      /DOT_DELIVERY_IDEMPOTENCY_CONFLICT/,
    );
    assert.deepEqual(snapshot(x.repo), before);
  });
  test("bad final image rolls back earlier image, text, batches and all receipts", (t) => {
    const x = setup(t),
      delivery = input({ count: 2 }),
      before = snapshot(x.repo);
    delivery.images[1].asset.metadata.width = 99;
    assert.throws(
      () => x.store.commit(delivery),
      /DOT_DELIVERY_ASSET_MISMATCH/,
    );
    assert.deepEqual(snapshot(x.repo), before);
    delivery.images[1].asset.metadata.width = 32;
    assert.equal(x.store.commit(delivery).items.length, 2);
  });
  test("injected receipt persistence failure rolls back every nested metadata change", (t) => {
    const x = setup(t),
      before = snapshot(x.repo),
      save = x.repo.save.bind(x.repo);
    x.repo.save = (table, row) => {
      if (table === "settings") throw Error("INJECTED_RECEIPT_FAILURE");
      return save(table, row);
    };
    assert.throws(() => x.store.commit(input()), /INJECTED_RECEIPT_FAILURE/);
    assert.deepEqual(snapshot(x.repo), before);
    x.repo.save = save;
    assert.equal(x.store.commit(input()).items.length, 1);
  });
  test("existing v1 item binds its first cover once and reuses known asset across deliveries", (t) => {
    const x = setup(t),
      firstInput = input(),
      v1 = new InboxService(x.repo, x.channel).importPackage(
        firstInput.textPackage,
      );
    const first = x.store.commit(firstInput);
    assert.equal(first.items[0].candidateId, v1.items[0].candidateId);
    const second = x.store.commit(input({ deliveryId: "delivery-two" }));
    assert.equal(second.items[0].coverAssetId, first.items[0].coverAssetId);
    assert.equal(second.items[0].candidateId, first.items[0].candidateId);
    assert.equal(x.repo.all("assets").length, 1);
    assert.equal(x.repo.all("drafts").length, 1);
    const before = snapshot(x.repo);
    assert.throws(
      () =>
        x.store.commit(
          input({ deliveryId: "cover-conflict", imageSeed: "different" }),
        ),
      /DOT_DELIVERY_COVER_REVISION_CONFLICT/,
    );
    assert.deepEqual(snapshot(x.repo), before);
  });
  test("new revision preserves old cover and late old revisions never replace current text", (t) => {
    const x = setup(t);
    const newer = x.store.commit(
      input({
        deliveryId: "revision-two",
        revision: 2,
        parentRevision: 1,
        imageSeed: "new",
      }),
    );
    const older = x.store.commit(input({ deliveryId: "revision-one" }));
    const rows = x.repo.all("textCandidates");
    assert.equal(rows.find((row) => row.isCurrent).externalRevision, 2);
    assert.equal(
      x.repo.get("textCandidates", newer.items[0].candidateId).cover.sha256,
      newer.items[0].coverSha256,
    );
    assert.equal(
      x.repo.get("textCandidates", older.items[0].candidateId).cover.sha256,
      older.items[0].coverSha256,
    );
    assert.equal(
      x.repo.get("drafts", newer.items[0].draftId).parentDraftId,
      older.items[0].draftId,
    );
    assert.notEqual(newer.items[0].coverSha256, older.items[0].coverSha256);
  });
  test("scope, schema, missing, duplicate and unmatched descriptors reject with no mutation", (t) => {
    const x = setup(t),
      before = snapshot(x.repo);
    const variants = [];
    let v = input();
    v.manifest.targetWorkspaceRef = "other";
    variants.push(v);
    v = input();
    v.textPackage.targetWorkspaceRef = "other";
    variants.push(v);
    v = input();
    v.textPackage.items[0].artistRef = "unknown";
    variants.push(v);
    v = input();
    v.textPackage.items[0].draft.cover = "forbidden";
    variants.push(v);
    v = input();
    v.manifest.images = [];
    variants.push(v);
    v = input({ count: 2 });
    v.images[1] = structuredClone(v.images[0]);
    variants.push(v);
    v = input();
    v.images[0].externalItemId = "unmatched";
    variants.push(v);
    v = input();
    v.images[0].asset.kind = "audio";
    variants.push(v);
    v = input();
    v.images[0].asset.mime = "image/webp";
    variants.push(v);
    v = input();
    v.images[0].asset.ext = "../png";
    variants.push(v);
    for (const variant of variants) {
      assert.throws(() => x.store.commit(variant));
      assert.deepEqual(snapshot(x.repo), before);
    }
  });
  test("inconsistent known hash metadata and asset ID collision reject without changes", (t) => {
    const x = setup(t),
      delivery = input();
    x.repo.save("assets", {
      ...delivery.images[0].asset,
      id: randomUUID(),
      bytes: 999,
    });
    let before = snapshot(x.repo);
    assert.throws(
      () => x.store.commit(delivery),
      /DOT_DELIVERY_ASSET_CONFLICT/,
    );
    assert.deepEqual(snapshot(x.repo), before);
    const other = input({ deliveryId: "collision" });
    other.images[0].asset.id = x.repo.all("assets")[0].id;
    other.images[0].asset.sha256 = hash("different");
    other.manifest.images[0].sha256 = other.images[0].asset.sha256;
    other.manifest.images[0].file = `cover-${other.images[0].asset.sha256}.png`;
    before = snapshot(x.repo);
    assert.throws(() => x.store.commit(other), /DOT_DELIVERY_ASSET_CONFLICT/);
    assert.deepEqual(snapshot(x.repo), before);
  });
  test("persisted receipts recover after reopening SQLite and remain channel scoped", (t) => {
    const x = setup(t),
      first = x.store.commit(input()),
      filename = x.repo.filename;
    x.repo.close();
    const reopened = new Repository(filename);
    t.after(() => reopened.close());
    const store = new DotDeliveryStore(reopened, x.channel);
    assert.deepEqual(store.lookup("delivery-one"), first);
    assert.deepEqual(store.receipts(), [first]);
    const unrelated = new DotDeliveryStore(reopened, {
      ...x.channel,
      id: "other-channel",
    });
    assert.equal(unrelated.lookup("delivery-one"), null);
    assert.deepEqual(unrelated.receipts(), []);
    reopened.close();
  });
}
