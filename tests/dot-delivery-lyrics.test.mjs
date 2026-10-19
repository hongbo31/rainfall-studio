import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { build } from "esbuild";
const out = path.resolve("output/dot-delivery-tests/lyrics-" + randomUUID());
await build({
  stdin: {
    contents: `export {Repository} from './src/core/database';export {PlanCenterService} from './src/core/plan-center';export {InboxController} from './src/core/inbox/controller';export {DotDeliveryStore} from './src/core/inbox/dot-delivery-store';export {inboxHash} from './src/core/inbox/service';export * from './src/core/plan-center-dot';export * from './src/shared/dot-delivery';`,
    resolveDir: process.cwd(),
  },
  outfile: path.join(out, "fixture.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
});
await build({
  entryPoints: ["src/core/index.ts"],
  outfile: path.join(out, "core.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
});
const require = createRequire(import.meta.url),
  cp = require("node:child_process"),
  native = cp.execFileSync;
fs.copyFileSync(
  "src/core/inbox/dot-rename-exclusive.ps1",
  path.join(out, "dot-rename-exclusive.ps1"),
);
require(path.resolve("tests/fixtures/offline-only.cjs"));
cp.execFileSync = (command, args, options) => {
  assert.equal(command, "pwsh.exe");
  assert.equal(options.windowsHide, true);
  assert.equal(args[4], path.join(out, "dot-rename-exclusive.ps1"));
  for (const flag of ["-Source", "-Destination"])
    assert.ok(
      args[args.indexOf(flag) + 1].startsWith(
        path.resolve("output/test-runs/dot-lyrics-"),
      ),
    );
  return native(command, args, options);
};
const w = require(path.join(out, "fixture.cjs")),
  { draft } = require("./fixtures/workflow.cjs");
const stamp = "2026-10-19T00:00:00Z",
  sha = (b) => createHash("sha256").update(b).digest("hex");
function setup(t, outputs = { lyrics: true, cover: false, music: false }) {
  const root = path.resolve("output/test-runs/dot-lyrics-" + randomUUID()),
    dataRoot = path.join(root, "private"),
    inbox = path.join(dataRoot, "production", "inbox-v1"),
    project = path.join(root, "project");
  for (const folder of [
    inbox,
    path.join(project, "incoming"),
    path.join(project, "receipts"),
  ])
    fs.mkdirSync(folder, { recursive: true });
  const repo = new w.Repository(
    path.join(dataRoot, "production", "library.sqlite"),
  );
  t.after(() => {
    if (repo.db.open) repo.close();
  });
  const artistId = randomUUID(),
    channel = {
      id: "lyrics-channel",
      workspaceId: "lyrics-workspace",
      workspaceRef: "lyrics-personal",
      artistRefs: { creator: artistId },
      seriesRefs: {},
    };
  repo.save("artists", { id: artistId, name: "Offline fixture" });
  repo.save("settings", {
    id: "inbox-channel",
    enabled: true,
    revision: 1,
    channel,
  });
  const controller = new w.InboxController(repo, inbox);
  t.after(() => controller.stop());
  controller.configureBridge(
    { projectRoot: project, expectedRevision: 0 },
    "authorized-local-setup",
  );
  const service = new w.PlanCenterService(repo, {
    now: () => stamp,
    recoverDispatching: false,
  });
  const plan = service.save({
    plan: {
      id: randomUUID(),
      title: "Only requested material",
      artistId,
      enabled: false,
      schedule: { kind: "daily", localTime: "09:00" },
      outputs,
      count: 1,
      material: { source: "dot", channel: channel.id, identity: "creator" },
      text: {},
      music: { route: "manual" },
    },
    expectedRevision: null,
  });
  const preview = service.preview({ id: plan.id }),
    run = service.run({
      id: plan.id,
      expectedRevision: plan.revision,
      summaryHash: preview.summaryHash,
      requestId: randomUUID(),
      source: "manual",
    });
  const s = {
    repo,
    root: dataRoot,
    mode: "production",
    now: () => new Date(stamp),
    planCenterService: () => service,
  };
  w.syncPlanDot(s);
  const request = w.planDotStatus(s).requests[0],
    store = new w.DotDeliveryStore(repo, channel);
  return {
    root,
    dataRoot,
    inbox,
    project,
    repo,
    channel,
    controller,
    service,
    run,
    s,
    request,
    store,
  };
}
function delivery(
  x,
  {
    id = "lyrics-delivery",
    version = 2,
    textVersion = 2,
    echo = {},
    changeText = () => {},
    changeManifest = () => {},
  } = {},
) {
  const r = x.request,
    text = {
      schemaVersion: textVersion,
      batchId: id,
      createdAt: stamp,
      targetWorkspaceRef: x.channel.workspaceRef,
      items: [
        {
          externalItemId: r.expectedExternalItemId,
          revision: r.revision,
          parentRevision: null,
          artistRef: r.artistRef,
          seriesRef: null,
          draft: draft(),
          provenance: {
            producer: "offline-dot",
            model: null,
            promptVersion: null,
            generatedAt: stamp,
          },
          ...(textVersion === 2 ? { requestEcho: { ...r, ...echo } } : {}),
        },
      ],
    };
  changeText(text);
  const bytes = Buffer.from(JSON.stringify(text)),
    manifest = {
      deliveryVersion: version,
      deliveryId: id,
      createdAt: stamp,
      targetWorkspaceRef: x.channel.workspaceRef,
      text: { file: "text.json", sha256: sha(bytes) },
      images: [],
    };
  changeManifest(manifest);
  const folder = path.join(x.project, "incoming", id);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "text.json"), bytes);
  const mb = Buffer.from(JSON.stringify(manifest));
  fs.writeFileSync(path.join(folder, "manifest.json"), mb);
  fs.writeFileSync(
    path.join(folder, "READY.json"),
    JSON.stringify({ deliveryId: id, manifestSha256: sha(mb) }),
  );
  return { folder, manifest, text };
}
function empty(x) {
  for (const table of [
    "textCandidates",
    "drafts",
    "assets",
    "inboxReceipts",
    "works",
    "operations",
  ])
    assert.equal(x.repo.all(table).length, 0, table);
  assert.equal(x.store.receipts().length, 0);
}
test("v2 lyrics-only passes production bridge and receiver, exact echo associates once, receipts omit covers", async (t) => {
  const x = setup(t),
    p = delivery(x);
  await x.controller.scanOnce();
  const receipt = x.store.lookup(p.manifest.deliveryId);
  assert.ok(receipt, "lyrics-only delivery should import");
  assert.equal(receipt.receiptVersion, 2);
  assert.equal(Object.hasOwn(receipt.items[0], "coverAssetId"), false);
  assert.equal(Object.hasOwn(receipt.items[0], "coverSha256"), false);
  assert.deepEqual(
    JSON.parse(
      fs.readFileSync(path.join(x.project, "receipts", "lyrics-delivery.json")),
    ),
    receipt,
  );
  assert.deepEqual(
    fs.readdirSync(path.join(x.inbox, "deliveries", "lyrics-delivery")).sort(),
    ["READY.json", "manifest.json", "text.json"],
  );
  assert.equal(fs.existsSync(path.join(x.dataRoot, "media")), false);
  assert.equal(x.repo.all("assets").length, 0);
  w.syncPlanDot(x.s);
  const a = w.planDotStatus(x.s).associations[0];
  assert.equal(a.requestId, x.request.requestId);
  assert.equal(a.candidateId, receipt.items[0].candidateId);
  assert.equal(a.status, "attached");
  assert.equal(Object.hasOwn(a, "coverAssetId"), false);
  await x.controller.scanOnce();
  w.syncPlanDot(x.s);
  assert.deepEqual(x.store.lookup("lyrics-delivery"), receipt);
  assert.equal(w.planDotStatus(x.s).associations.length, 1);
  assert.equal(x.repo.all("textCandidates").length, 1);
  assert.equal(x.service.list().stageAttempts.length, 1);
});
test("v1 still rejects missing covers, including when lyrics-only was requested", async (t) => {
  const x = setup(t);
  delivery(x, { version: 1 });
  await x.controller.scanOnce();
  empty(x);
  assert.equal(
    w.DeliveryManifestSchema.safeParse({ deliveryVersion: 1 }).success,
    false,
  );
});
test("v2 refuses omitted required cover, music requests, nonlyrics requests and text v1", async (t) => {
  for (const options of [
    { outputs: { lyrics: true, cover: true, music: false } },
    { outputs: { lyrics: true, cover: false, music: true } },
    { outputs: { lyrics: false, cover: true, music: false } },
    { textVersion: 1 },
  ]) {
    const x = setup(t, options.outputs);
    delivery(x, options);
    await x.controller.scanOnce();
    empty(x);
    assert.equal(x.controller.status().bridge.states[0].state, "rejected");
  }
});
test("v2 refuses forged echo, outputs drift, cross workspace, artist, channel and unknown requests", async (t) => {
  for (const mutate of [
    (p) => (p.echo = { requestHash: "f".repeat(64) }),
    (p) => (p.echo = { outputs: { lyrics: true, cover: true, music: false } }),
    (p) => (p.echo = { channelId: "foreign" }),
    (p) => (p.echo = { requestId: randomUUID() }),
    (p) => (p.changeText = (t) => (t.targetWorkspaceRef = "foreign")),
    (p) => (p.changeText = (t) => (t.items[0].artistRef = "foreign")),
  ]) {
    const x = setup(t),
      opts = {};
    mutate(opts);
    delivery(x, opts);
    await x.controller.scanOnce();
    empty(x);
  }
});
test("stopped R is acknowledged and associated without attaching or scoring", async (t) => {
  const x = setup(t);
  x.service.stop({ runId: x.run.id });
  delivery(x);
  await x.controller.scanOnce();
  assert.ok(x.store.lookup("lyrics-delivery"));
  w.syncPlanDot(x.s);
  assert.equal(w.planDotStatus(x.s).associations[0].status, "stopped");
  assert.equal(x.service.list().stageAttempts.length, 0);
  assert.equal(x.repo.all("assets").length, 0);
});
test("paused bridge does not stage lyrics-only; resume imports original R", async (t) => {
  const x = setup(t);
  delivery(x);
  x.controller.setBridgeEnabled(false, 1);
  await x.controller.scanOnce();
  empty(x);
  x.controller.setBridgeEnabled(true, 2);
  await x.controller.scanOnce();
  assert.ok(x.store.lookup("lyrics-delivery"));
});
test("changed delivery head and conflicting same revision never overwrite accepted lyrics", async (t) => {
  const x = setup(t);
  delivery(x);
  await x.controller.scanOnce();
  const receipt = x.store.lookup("lyrics-delivery");
  assert.ok(receipt);
  delivery(x, { changeText: (p) => (p.items[0].draft.title = "conflict") });
  await x.controller.scanOnce();
  assert.deepEqual(x.store.lookup("lyrics-delivery"), receipt);
  delivery(x, {
    id: "second-delivery",
    changeText: (p) => (p.items[0].draft.title = "conflict"),
  });
  await x.controller.scanOnce();
  assert.equal(x.store.lookup("second-delivery"), null);
  assert.equal(x.repo.all("textCandidates").length, 1);
  assert.equal(x.repo.all("assets").length, 0);
});
test("v2 rejects unsolicited cover before staging or installing an asset", async (t) => {
  const x = setup(t);
  delivery(x, {
    changeManifest: (m) =>
      (m.images = [
        {
          externalItemId: x.request.expectedExternalItemId,
          revision: x.request.revision,
          role: "cover",
          file: "cover-" + "a".repeat(64) + ".png",
          sha256: "a".repeat(64),
          bytes: 30,
          mimeType: "image/png",
          width: 2,
          height: 2,
          provenance: {
            producer: "unrequested",
            model: null,
            generatedAt: stamp,
          },
        },
      ]),
  });
  await x.controller.scanOnce();
  empty(x);
  assert.equal(
    x.controller.status().bridge.states[0].reason,
    "DELIVERY_COVER_SCOPE",
  );
  assert.equal(
    fs.existsSync(path.join(x.inbox, "deliveries", "lyrics-delivery")),
    false,
  );
});
test("v2 requested cover installs verified bytes and returns cover fields in its v2 receipt", async (t) => {
  const x = setup(t, { lyrics: true, cover: true, music: false }),
    fixture = JSON.parse(
      fs.readFileSync("docs/integrations/dot-delivery-example/manifest.json"),
    );
  const image = {
    ...fixture.images[0],
    externalItemId: x.request.expectedExternalItemId,
    revision: x.request.revision,
  };
  const p = delivery(x, { changeManifest: (m) => (m.images = [image]) });
  fs.copyFileSync(
    path.join("docs/integrations/dot-delivery-example", image.file),
    path.join(p.folder, image.file),
  );
  await x.controller.scanOnce();
  const receipt = x.store.lookup("lyrics-delivery");
  assert.ok(receipt);
  assert.equal(receipt.receiptVersion, 2);
  assert.equal(receipt.items[0].coverSha256, image.sha256);
  assert.ok(receipt.items[0].coverAssetId);
  assert.equal(x.repo.all("assets").length, 1);
  w.syncPlanDot(x.s);
  assert.equal(
    w.planDotStatus(x.s).associations[0].coverAssetId,
    receipt.items[0].coverAssetId,
  );
});
test("v1 envelope cannot downgrade v2 R output scope to smuggle an unrequested cover", async (t) => {
  for (const textVersion of [1, 2]) {
    const x = setup(t),
      fixture = JSON.parse(
        fs.readFileSync("docs/integrations/dot-delivery-example/manifest.json"),
      );
    const image = {
      ...fixture.images[0],
      externalItemId: x.request.expectedExternalItemId,
      revision: x.request.revision,
    };
    const p = delivery(x, {
      version: 1,
      textVersion,
      changeManifest: (m) => (m.images = [image]),
    });
    fs.copyFileSync(
      path.join("docs/integrations/dot-delivery-example", image.file),
      path.join(p.folder, image.file),
    );
    await x.controller.scanOnce();
    empty(x);
    assert.equal(
      fs.existsSync(path.join(x.inbox, "deliveries", "lyrics-delivery")),
      false,
    );
  }
});
test("v2 pins saved R and scope even after a private text receipt already exists", async (t) => {
  const x = setup(t),
    p = delivery(x);
  await x.controller.scanOnce();
  const receipt = x.store.lookup("lyrics-delivery");
  assert.ok(receipt);
  const row = x.repo.get("settings", "plan-dot:request:" + x.request.requestId);
  x.repo.save("settings", {
    ...row,
    request: {
      ...row.request,
      outputs: { lyrics: true, cover: true, music: false },
    },
  });
  assert.throws(
    () =>
      x.store.commit({
        manifest: p.manifest,
        manifestSha256: receipt.manifestSha256,
        textPackage: p.text,
        images: [],
      }),
    /DOT_REQUEST_ECHO_MISMATCH/,
  );
  assert.equal(x.repo.all("textCandidates").length, 1);
});
test("legacy request-aware covers require a unique historical owner and exact outputs", async (t) => {
  for (const ambiguous of [false, true]) {
    const x = setup(t, { lyrics: true, cover: true, music: false });
    if (ambiguous) {
      const { requestHash, ...body } = x.request;
      const other = {
        ...body,
        requestId: randomUUID(),
        revision: body.revision + 1,
      };
      x.repo.save("settings", {
        id: "plan-dot:request:" + other.requestId,
        request: { ...other, requestHash: w.inboxHash(other) },
      });
    }
    const fixture = JSON.parse(
      fs.readFileSync("docs/integrations/dot-delivery-example/manifest.json"),
    );
    const image = {
      ...fixture.images[0],
      externalItemId: x.request.expectedExternalItemId,
      revision: x.request.revision,
    };
    const p = delivery(x, {
      version: 1,
      textVersion: 1,
      changeManifest: (m) => (m.images = [image]),
    });
    fs.copyFileSync(
      path.join("docs/integrations/dot-delivery-example", image.file),
      path.join(p.folder, image.file),
    );
    await x.controller.scanOnce();
    if (ambiguous) {
      empty(x);
      assert.equal(
        x.controller.status().bridge.states[0].reason,
        "DOT_DELIVERY_LEGACY_REQUEST_AMBIGUOUS",
      );
    } else {
      assert.equal(x.store.lookup("lyrics-delivery").receiptVersion, 1);
      assert.equal(x.repo.all("assets").length, 1);
    }
  }
});
test("v1 requested covers retain whole-plan music and cover-only output compatibility", async (t) => {
  for (const textVersion of [1, 2])
    for (const outputs of [
      { lyrics: true, cover: true, music: true },
      { lyrics: false, cover: true, music: false },
    ]) {
      const x = setup(t, outputs),
        fixture = JSON.parse(
          fs.readFileSync(
            "docs/integrations/dot-delivery-example/manifest.json",
          ),
        );
      const image = {
        ...fixture.images[0],
        externalItemId: x.request.expectedExternalItemId,
        revision: x.request.revision,
      };
      const p = delivery(x, {
        version: 1,
        textVersion,
        changeManifest: (m) => (m.images = [image]),
      });
      fs.copyFileSync(
        path.join("docs/integrations/dot-delivery-example", image.file),
        path.join(p.folder, image.file),
      );
      await x.controller.scanOnce();
      const receipt = x.store.lookup("lyrics-delivery");
      assert.ok(
        receipt,
        "v1 text+cover does not deliver audio and must retain existing plan output compatibility",
      );
      assert.equal(receipt.receiptVersion, 1);
      assert.equal(x.repo.all("assets").length, 1);
      assert.equal(x.repo.all("operations").length, 0);
    }
});
test("private receiver refuses forged cover scope before materializing valid image bytes", async (t) => {
  const x = setup(t),
    fixture = JSON.parse(
      fs.readFileSync("docs/integrations/dot-delivery-example/manifest.json"),
    );
  const image = {
    ...fixture.images[0],
    externalItemId: x.request.expectedExternalItemId,
    revision: x.request.revision,
  };
  const p = delivery(x, {
    echo: { outputs: { lyrics: true, cover: true, music: false } },
    changeManifest: (m) => (m.images = [image]),
  });
  fs.copyFileSync(
    path.join("docs/integrations/dot-delivery-example", image.file),
    path.join(p.folder, image.file),
  );
  // Bypass public bridge staging to exercise the independently defensive private receiver.
  const dest = path.join(x.inbox, "deliveries", "lyrics-delivery");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(p.folder, dest);
  await x.controller.scanOnce();
  empty(x);
  assert.equal(fs.existsSync(path.join(x.dataRoot, "media")), false);
  assert.equal(
    x.controller.status().packageDelivery.states[0].reason,
    "DOT_REQUEST_ECHO_MISMATCH",
  );
});
test("lyrics receipt and association replay after SQLite reopen preserve original IDs", async (t) => {
  const x = setup(t);
  delivery(x);
  await x.controller.scanOnce();
  w.syncPlanDot(x.s);
  const receipt = x.store.lookup("lyrics-delivery"),
    association = w.planDotStatus(x.s).associations[0];
  assert.ok(receipt);
  x.controller.stop();
  const filename = x.repo.filename;
  x.repo.close();
  const repo = new w.Repository(filename);
  t.after(() => repo.close());
  const controller = new w.InboxController(repo, x.inbox);
  t.after(() => controller.stop());
  await controller.scanOnce();
  const service = new w.PlanCenterService(repo, { recoverDispatching: false });
  const s = { ...x.s, repo, planCenterService: () => service };
  w.syncPlanDot(s);
  assert.deepEqual(
    new w.DotDeliveryStore(repo, x.channel).lookup("lyrics-delivery"),
    receipt,
  );
  assert.deepEqual(w.planDotStatus(s).associations, [association]);
  assert.equal(repo.all("textCandidates").length, 1);
  assert.equal(repo.all("assets").length, 0);
});
test("synchronous channel cancellation interrupts lyrics staging before import", async (t) => {
  const x = setup(t);
  delivery(x);
  const pending = x.controller.scanOnce();
  x.controller.disable();
  await pending;
  empty(x);
  assert.equal(
    fs.existsSync(path.join(x.inbox, "deliveries", "lyrics-delivery")),
    false,
  );
});
test("actual production Core startup scan and RPC complete bridge to receipt to association with zero assets", async (t) => {
  const x = setup(t);
  delivery(x);
  const argv = process.argv,
    port = Object.getOwnPropertyDescriptor(process, "parentPort"),
    originalInterval = globalThis.setInterval,
    intervals = [],
    waiters = new Map();
  let handler,
    sequence = 0;
  const core = path.join(out, "core.cjs");
  const rpc = (method, input = {}) =>
    new Promise((resolve, reject) => {
      const id = String(++sequence),
        timer = setTimeout(
          () => reject(Error("Core RPC timeout " + method)),
          5000,
        );
      waiters.set(id, (result) => {
        clearTimeout(timer);
        result.ok
          ? resolve(result.value)
          : reject(Error(JSON.stringify(result.error)));
      });
      handler({ data: { id, method, input } });
    });
  process.argv = [argv[0], core, x.dataRoot, "production"];
  Object.defineProperty(process, "parentPort", {
    configurable: true,
    value: {
      on: (name, fn) => (handler = fn),
      postMessage: (message) => {
        if (message.id) waiters.get(message.id)?.(message.result);
        else
          assert.equal(
            message.kind,
            undefined,
            "no external provider operation",
          );
      },
    },
  });
  globalThis.setInterval = (...args) => {
    const interval = originalInterval(...args);
    intervals.push(interval);
    return interval;
  };
  try {
    require(core);
    globalThis.setInterval = originalInterval;
    const status = await rpc("inbox.status");
    assert.equal(status.packageDelivery.states[0].state, "imported");
    assert.equal(status.bridge.states[0].state, "acknowledged");
    await rpc("planCenter.exportDotRequests");
    const dot = await rpc("planCenter.dotStatus");
    assert.equal(dot.associations.length, 1);
    assert.equal(dot.associations[0].status, "attached");
    const receipt = JSON.parse(
      fs.readFileSync(path.join(x.project, "receipts", "lyrics-delivery.json")),
    );
    assert.equal(receipt.receiptVersion, 2);
    assert.equal(dot.associations[0].candidateId, receipt.items[0].candidateId);
    for (const table of ["assets", "works", "operations"])
      assert.equal(x.repo.all(table).length, 0, table);
    assert.equal(fs.existsSync(path.join(x.dataRoot, "media")), false);
  } finally {
    for (const interval of intervals) clearInterval(interval);
    globalThis.setInterval = originalInterval;
    try {
      if (handler) await rpc("internal.close");
    } finally {
      process.argv = argv;
      if (port) Object.defineProperty(process, "parentPort", port);
      else delete process.parentPort;
    }
  }
});
