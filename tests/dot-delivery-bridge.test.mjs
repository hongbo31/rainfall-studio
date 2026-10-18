import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { build } from "esbuild";
const out = path.resolve("output/dot-delivery-tests/bridge.cjs");
await build({
  stdin: {
    contents:
      "export {Repository} from './src/core/database';export {InboxController} from './src/core/inbox/controller';export * from './src/core/inbox/dot-delivery-store';export * from './src/core/inbox/dot-delivery-bridge';export * from './src/main/inbox-bridge';export {exclusiveHelperPath} from './src/core/inbox/dot-rename-exclusive';",
    resolveDir: process.cwd(),
  },
  outfile: out,
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
});
const require = createRequire(import.meta.url);
fs.copyFileSync(
  "src/core/inbox/dot-rename-exclusive.ps1",
  path.join(path.dirname(out), "dot-rename-exclusive.ps1"),
);
const childProcess = require("node:child_process"),
  nativeExec = childProcess.execFileSync;
require(path.resolve("tests/fixtures/offline-only.cjs"));
// The only allowed child is the shipped hidden File.Move primitive, restricted to these fixtures.
childProcess.execFileSync = (command, args, options) => {
  assert.equal(command, "pwsh.exe");
  assert.equal(
    args[4],
    path.join(path.dirname(out), "dot-rename-exclusive.ps1"),
  );
  assert.equal(options.windowsHide, true);
  for (const key of ["-Source", "-Destination"])
    assert.ok(
      args[args.indexOf(key) + 1].startsWith(
        path.resolve("output/test-runs/dot-bridge-"),
      ),
    );
  return nativeExec(command, args, options);
};
const {
  Repository,
  InboxController,
  DotDeliveryStore,
  DotDeliveryBridge,
  validateBridgeProject,
  chooseInboxBridgeProject,
} = require(out);
const sha = (b) => createHash("sha256").update(b).digest("hex");
function setup(t) {
  const root = path.resolve("output/test-runs/dot-bridge-" + randomUUID()),
    dataRoot = path.join(root, "private"),
    inboxRoot = path.join(dataRoot, "production", "inbox-v1"),
    projectRoot = path.join(root, "project");
  for (const p of [
    inboxRoot,
    path.join(projectRoot, "incoming"),
    path.join(projectRoot, "receipts"),
  ])
    fs.mkdirSync(p, { recursive: true });
  const repo = new Repository(path.join(dataRoot, "library.sqlite"));
  t.after(() => repo.close());
  const artistId = randomUUID();
  repo.save("artists", { id: artistId, name: "Offline fixture", revision: 1 });
  const channel = {
    id: "fixture-channel",
    workspaceId: "fixture-workspace",
    workspaceRef: "rainfall-personal",
    artistRefs: { creator: artistId },
    seriesRefs: {},
  };
  repo.save("settings", {
    id: "inbox-channel",
    enabled: true,
    revision: 1,
    channel,
  });
  const store = new DotDeliveryStore(repo, channel);
  let now = new Date("2026-10-18T19:00:00Z");
  const options = { store, projectRoot, inboxRoot, now: () => now };
  const bridge = new DotDeliveryBridge(options);
  return {
    root,
    dataRoot,
    inboxRoot,
    projectRoot,
    repo,
    store,
    channel,
    options,
    bridge,
    advance() {
      now = new Date(now.getTime() + 901000);
    },
  };
}
function payload(x, id = "dot-bridge-fixture") {
  const source = path.join(x.projectRoot, "incoming", id);
  fs.mkdirSync(source, { recursive: true });
  const template = "docs/integrations/dot-delivery-example",
    text = JSON.parse(
      fs.readFileSync(path.join(template, "text.json"), "utf8"),
    ),
    manifest = JSON.parse(
      fs.readFileSync(path.join(template, "manifest.json"), "utf8"),
    );
  text.batchId = id;
  text.items[0].externalItemId = id;
  manifest.deliveryId = id;
  manifest.images[0].externalItemId = id;
  const textBytes = Buffer.from(JSON.stringify(text));
  manifest.text.sha256 = sha(textBytes);
  const mb = Buffer.from(JSON.stringify(manifest));
  fs.writeFileSync(path.join(source, "text.json"), textBytes);
  fs.copyFileSync(
    path.join(template, manifest.images[0].file),
    path.join(source, manifest.images[0].file),
  );
  fs.writeFileSync(path.join(source, "manifest.json"), mb);
  const ready = { deliveryId: id, manifestSha256: sha(mb) };
  fs.writeFileSync(path.join(source, "READY.json"), JSON.stringify(ready));
  return {
    source,
    text,
    manifest,
    ready,
    privateFolder: path.join(x.inboxRoot, "deliveries", id),
  };
}
test("trusted project validation refuses filesystem roots, overlap and linked child directories", (t) => {
  const x = setup(t);
  assert.equal(
    validateBridgeProject(x.projectRoot, x.inboxRoot).projectRoot,
    x.projectRoot,
  );
  assert.throws(() =>
    validateBridgeProject(path.parse(x.root).root, x.inboxRoot),
  );
  assert.throws(
    () => validateBridgeProject(x.root, x.inboxRoot),
    /BRIDGE_ROOT_OVERLAP/,
  );
  fs.rmdirSync(path.join(x.projectRoot, "incoming"));
  fs.symlinkSync(x.inboxRoot, path.join(x.projectRoot, "incoming"), "junction");
  assert.throws(
    () => validateBridgeProject(x.projectRoot, x.inboxRoot),
    /LINK_REJECTED/,
  );
});
test("controller bridges complete package once and writes only committed receipt back", async (t) => {
  const x = setup(t),
    p = payload(x),
    controller = new InboxController(x.repo, x.inboxRoot);
  controller.configureBridge({
    projectRoot: x.projectRoot,
    expectedRevision: 0,
  });
  await controller.scanOnce();
  assert.equal(x.repo.all("textCandidates").length, 1);
  assert.ok(fs.existsSync(path.join(p.privateFolder, "READY.json")));
  const receipt = x.store.lookup(p.manifest.deliveryId);
  assert.deepEqual(
    JSON.parse(
      fs.readFileSync(
        path.join(x.projectRoot, "receipts", p.manifest.deliveryId + ".json"),
        "utf8",
      ),
    ),
    receipt,
  );
  await controller.scanOnce();
  assert.equal(x.repo.all("textCandidates").length, 1);
  assert.equal(x.repo.all("works").length, 0);
  assert.equal(x.repo.all("operations").length, 0);
  assert.equal(controller.status().bridge.cloudTransportVerified, false);
  controller.stop();
});
test("partial READY or image waits without any private promotion then resumes after restart", async (t) => {
  for (const part of ["READY", "image"]) {
    const x = setup(t),
      p = payload(x);
    const file = path.join(
        p.source,
        part === "READY" ? "READY.json" : p.manifest.images[0].file,
      ),
      original = fs.readFileSync(file);
    fs.writeFileSync(file, part === "READY" ? "{" : original.subarray(0, 5));
    await x.bridge.scanOnce();
    assert.equal(
      fs.existsSync(path.join(p.privateFolder, "READY.json")),
      false,
    );
    assert.equal(x.bridge.status().states[0].state, "waiting");
    fs.writeFileSync(file, original);
    x.advance();
    await new DotDeliveryBridge(x.options).scanOnce();
    assert.equal(fs.existsSync(path.join(p.privateFolder, "READY.json")), true);
    assert.equal(x.repo.all("textCandidates").length, 0);
    assert.equal(
      fs.readdirSync(path.join(x.projectRoot, "receipts")).length,
      0,
    );
  }
});
test("accepted private package cannot be overwritten by changed source under same delivery ID", async (t) => {
  const x = setup(t),
    p = payload(x);
  await x.bridge.scanOnce();
  const before = fs.readFileSync(path.join(p.privateFolder, "text.json"));
  p.text.items[0].draft.title = "Changed under same ID";
  const tb = Buffer.from(JSON.stringify(p.text));
  fs.writeFileSync(path.join(p.source, "text.json"), tb);
  p.manifest.text.sha256 = sha(tb);
  const mb = Buffer.from(JSON.stringify(p.manifest));
  fs.writeFileSync(path.join(p.source, "manifest.json"), mb);
  fs.writeFileSync(
    path.join(p.source, "READY.json"),
    JSON.stringify({ ...p.ready, manifestSha256: sha(mb) }),
  );
  await x.bridge.scanOnce();
  assert.deepEqual(
    fs.readFileSync(path.join(p.privateFolder, "text.json")),
    before,
  );
  assert.equal(x.bridge.status().states[0].state, "rejected");
});
test("traversal descriptor and hard-linked source cannot reach private inbox", async (t) => {
  for (const mode of ["path", "hardlink"]) {
    const x = setup(t),
      p = payload(x);
    if (mode === "hardlink")
      fs.linkSync(
        path.join(p.source, "text.json"),
        path.join(x.root, "outside.json"),
      );
    else {
      p.manifest.text.file = "../outside.json";
      const mb = Buffer.from(JSON.stringify(p.manifest));
      fs.writeFileSync(path.join(p.source, "manifest.json"), mb);
      fs.writeFileSync(
        path.join(p.source, "READY.json"),
        JSON.stringify({ ...p.ready, manifestSha256: sha(mb) }),
      );
    }
    await x.bridge.scanOnce();
    assert.equal(
      fs.existsSync(path.join(p.privateFolder, "READY.json")),
      false,
    );
    assert.equal(x.bridge.status().states[0].state, "rejected");
  }
});
test("stop during decode prevents private promotion", async (t) => {
  const x = setup(t),
    p = payload(x);
  const scan = x.bridge.scanOnce();
  x.bridge.stop();
  await scan;
  assert.equal(fs.existsSync(path.join(p.privateFolder, "READY.json")), false);
  assert.equal(x.repo.all("textCandidates").length, 0);
});
test("receipt replay survives restart, never replaces conflicting cloud receipt or follows its hardlink", async (t) => {
  const x = setup(t),
    p = payload(x),
    controller = new InboxController(x.repo, x.inboxRoot);
  controller.configureBridge({
    projectRoot: x.projectRoot,
    expectedRevision: 0,
  });
  await controller.scanOnce();
  const dest = path.join(
      x.projectRoot,
      "receipts",
      p.manifest.deliveryId + ".json",
    ),
    expected = fs.readFileSync(dest);
  fs.unlinkSync(dest);
  await new DotDeliveryBridge(x.options).flushReceipts();
  assert.deepEqual(fs.readFileSync(dest), expected);
  fs.writeFileSync(dest, '{"foreign":true}');
  await x.bridge.flushReceipts();
  assert.equal(fs.readFileSync(dest, "utf8"), '{"foreign":true}');
  assert.equal(x.bridge.status().lastError, "DELIVERY_BRIDGE_RECEIPT_CONFLICT");
  fs.unlinkSync(dest);
  fs.writeFileSync(dest, expected);
  fs.linkSync(dest, path.join(x.root, "receipt-link.json"));
  await x.bridge.flushReceipts();
  assert.equal(x.bridge.status().lastError, "DELIVERY_FILE_REJECTED");
  controller.stop();
});
test("trusted native chooser ignores renderer paths and rejects scope changes without config writes", async () => {
  let generation = 1,
    writes = 0;
  const deps = {
    capture: () => ({ mode: "production", generation, available: true }),
    choose: async () => {
      generation++;
      return { canceled: false, filePaths: ["X:\\chosen-project"] };
    },
    rpc: async (method) => {
      if (method === "inbox.status")
        return { ok: true, value: { bridge: { revision: 0 } } };
      writes++;
      return { ok: true, value: {} };
    },
  };
  await assert.rejects(
    () => chooseInboxBridgeProject(deps),
    /WORKSPACE_CHANGED/,
  );
  assert.equal(writes, 0);
});

test("bridge source reconfiguration stops a pending decode and pause persists without import", async (t) => {
  const x = setup(t),
    p = payload(x),
    controller = new InboxController(x.repo, x.inboxRoot);
  controller.configureBridge({
    projectRoot: x.projectRoot,
    expectedRevision: 0,
  });
  const pending = controller.scanOnce();
  controller.setBridgeEnabled(false, 1);
  await pending;
  assert.equal(fs.existsSync(path.join(p.privateFolder, "READY.json")), false);
  assert.equal(x.repo.all("textCandidates").length, 0);
  assert.equal(controller.status().bridge.enabled, false);
  const reopened = new InboxController(x.repo, x.inboxRoot);
  await reopened.scanOnce();
  assert.equal(x.repo.all("textCandidates").length, 0);
  controller.stop();
  reopened.stop();
});

test("media staging disk full is retryable and receipt conflict remains visible after replay", async (t) => {
  const x = setup(t),
    p = payload(x),
    original = fs.openSync;
  let failed = false;
  fs.openSync = function (file, ...args) {
    if (
      !failed &&
      String(file).includes("bridge-staging") &&
      String(file).endsWith("text.json")
    ) {
      failed = true;
      throw Object.assign(Error("disk full"), { code: "ENOSPC" });
    }
    return original.call(this, file, ...args);
  };
  try {
    await x.bridge.scanOnce();
  } finally {
    fs.openSync = original;
  }
  assert.equal(x.bridge.status().states[0].state, "waiting");
  assert.equal(fs.existsSync(path.join(p.privateFolder, "READY.json")), false);
  x.advance();
  await new DotDeliveryBridge(x.options).scanOnce();
  assert.ok(fs.existsSync(path.join(p.privateFolder, "READY.json")));
  const controller = new InboxController(x.repo, x.inboxRoot);
  controller.configureBridge({
    projectRoot: x.projectRoot,
    expectedRevision: 0,
  });
  await controller.scanOnce();
  fs.writeFileSync(
    path.join(p.source, "READY.json"),
    JSON.stringify({ ...p.ready, manifestSha256: "f".repeat(64) }),
  );
  await controller.scanOnce();
  assert.equal(controller.status().bridge.states[0].state, "rejected");
  assert.equal(
    controller.status().bridge.states[0].reason,
    "DELIVERY_BRIDGE_PRIVATE_CONFLICT",
  );
  assert.equal(x.repo.all("textCandidates").length, 1);
  controller.stop();
});

test("native chooser cancellation is inert and success forwards only chosen path and saved revision", async () => {
  let captured;
  const base = {
    capture: () => ({ mode: "production", generation: 1, available: true }),
    rpc: async (method, input) => {
      if (method === "inbox.status")
        return { ok: true, value: { bridge: { revision: 3 } } };
      captured = { method, input };
      return { ok: true, value: { configured: true } };
    },
  };
  assert.deepEqual(
    await chooseInboxBridgeProject({
      ...base,
      choose: async () => ({ canceled: true, filePaths: [] }),
    }),
    { ok: true, value: null },
  );
  assert.equal(captured, undefined);
  await chooseInboxBridgeProject({
    ...base,
    choose: async () => ({
      canceled: false,
      filePaths: ["X:\\explicit-project"],
    }),
  });
  assert.deepEqual(captured, {
    method: "internal.inboxBridge.configure",
    input: { projectRoot: "X:\\explicit-project", expectedRevision: 3 },
  });
});

test("foreign receipt arriving at atomic publication is preserved and does not starve later receipts", async (t) => {
  const x = setup(t);
  payload(x, "dot-first");
  payload(x, "dot-second");
  const controller = new InboxController(x.repo, x.inboxRoot);
  controller.configureBridge({
    projectRoot: x.projectRoot,
    expectedRevision: 0,
  });
  await controller.scanOnce();
  const receipts = x.store.receipts();
  assert.equal(receipts.length, 2);
  const first = path.join(
      x.projectRoot,
      "receipts",
      receipts[0].deliveryId + ".json",
    ),
    second = path.join(
      x.projectRoot,
      "receipts",
      receipts[1].deliveryId + ".json",
    );
  fs.unlinkSync(first);
  fs.unlinkSync(second);
  const original = childProcess.execFileSync;
  let injected = false;
  childProcess.execFileSync = function (command, args, options) {
    const dest = args[args.indexOf("-Destination") + 1];
    if (dest === first && !injected) {
      injected = true;
      fs.writeFileSync(first, '{"foreign":true}');
    }
    return original(command, args, options);
  };
  try {
    await x.bridge.flushReceipts();
  } finally {
    childProcess.execFileSync = original;
  }
  assert.equal(injected, true);
  assert.equal(fs.readFileSync(first, "utf8"), '{"foreign":true}');
  assert.ok(fs.existsSync(second));
  assert.equal(x.bridge.status().lastError, "EEXIST");
  fs.unlinkSync(second);
  await x.bridge.flushReceipts();
  assert.ok(fs.existsSync(second));
  assert.equal(x.bridge.status().lastError, "DELIVERY_BRIDGE_RECEIPT_CONFLICT");
  controller.stop();
});

test("exclusive move helper resolves physical unpacked path and accepted receipts have one link", (t) => {
  const { exclusiveHelperPath } = require(out);
  assert.equal(
    exclusiveHelperPath(path.resolve("output/resources/app.asar/build")),
    path.resolve(
      "output/resources/app.asar.unpacked/build/dot-rename-exclusive.ps1",
    ),
  );
  assert.equal(
    exclusiveHelperPath(path.resolve("output/resources/app/build")),
    path.resolve("output/resources/app/build/dot-rename-exclusive.ps1"),
  );
});
