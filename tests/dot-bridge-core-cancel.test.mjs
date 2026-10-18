import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { build } from "esbuild";

// Build before the offline guard: esbuild needs its installed local subprocess.
// All application imports below run with networking and child processes denied.
const buildRoot = path.resolve(
  "output/dot-delivery-tests/core-cancel-" + randomUUID(),
);
await build({
  entryPoints: {
    core: "src/core/index.ts",
    database: "src/core/database.ts",
  },
  outdir: buildRoot,
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
});
const require = createRequire(import.meta.url);
require(path.resolve("tests/fixtures/offline-only.cjs"));
const { Repository } = require(path.join(buildRoot, "database.cjs"));
const sharp = require("sharp");
const coreFile = path.join(buildRoot, "core.cjs");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

function deferred() {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
}

async function bounded(promise, description) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Error("Timed out waiting for " + description)),
          5000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function fixture() {
  const root = path.resolve("output/test-runs/dot-core-cancel-" + randomUUID());
  const dataRoot = path.join(root, "private");
  const projectRoot = path.join(root, "project");
  const replacementProject = path.join(root, "replacement-project");
  const inboxRoot = path.join(dataRoot, "production", "inbox-v1");
  for (const folder of [
    inboxRoot,
    ...[projectRoot, replacementProject].flatMap((project) => [
      path.join(project, "incoming"),
      path.join(project, "receipts"),
    ]),
  ])
    fs.mkdirSync(folder, { recursive: true });
  // This is the same production-mode path used by the actual Core entrypoint.
  // It is entirely beneath this test's unique output directory.
  const repo = new Repository(path.join(dataRoot, "production", "library.sqlite"));
  const artistId = randomUUID();
  repo.save("artists", { id: artistId, name: "Offline fixture", revision: 1 });
  repo.save("settings", {
    id: "inbox-channel",
    enabled: true,
    revision: 1,
    channel: {
      id: "fixture-channel",
      workspaceId: "fixture-workspace",
      workspaceRef: "rainfall-personal",
      artistRefs: { creator: artistId },
      seriesRefs: {},
    },
  });
  repo.save("settings", {
    id: "inbox-bridge",
    projectRoot,
    enabled: true,
    revision: 1,
    source: "native-directory-picker",
  });
  const id = "dot-core-cancel-fixture";
  const source = path.join(projectRoot, "incoming", id);
  fs.mkdirSync(source);
  const template = "docs/integrations/dot-delivery-example";
  const text = JSON.parse(fs.readFileSync(path.join(template, "text.json"), "utf8"));
  const manifest = JSON.parse(
    fs.readFileSync(path.join(template, "manifest.json"), "utf8"),
  );
  text.batchId = id;
  text.items[0].externalItemId = id;
  manifest.deliveryId = id;
  manifest.images[0].externalItemId = id;
  const textBytes = Buffer.from(JSON.stringify(text));
  manifest.text.sha256 = sha(textBytes);
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  fs.writeFileSync(path.join(source, "text.json"), textBytes);
  fs.writeFileSync(path.join(source, "manifest.json"), manifestBytes);
  fs.copyFileSync(
    path.join(template, manifest.images[0].file),
    path.join(source, manifest.images[0].file),
  );
  fs.writeFileSync(
    path.join(source, "READY.json"),
    JSON.stringify({ deliveryId: id, manifestSha256: sha(manifestBytes) }),
  );
  return {
    repo,
    dataRoot,
    inboxRoot,
    projectRoot,
    replacementProject,
    promoted: path.join(inboxRoot, "deliveries", id, "READY.json"),
  };
}

test("actual Core cancels an active bridge decode before processing queued control requests", async (t) => {
  for (const method of [
    "inbox.bridge.pause",
    "inbox.pause",
    "internal.inboxBridge.configure",
  ]) {
    await t.test(method, async () => {
      const x = fixture();
      const decoderEntered = deferred();
      const releaseDecoder = deferred();
      const originalMetadata = sharp.prototype.metadata;
      const originalArgv = process.argv;
      const originalPort = Object.getOwnPropertyDescriptor(process, "parentPort");
      const originalSetInterval = globalThis.setInterval;
      const intervals = [];
      const waiters = new Map();
      let receive;
      let firstDecode = true;
      let coreLoaded = false;
      const request = (id, requestMethod, input) => {
        const response = deferred();
        waiters.set(id, response);
        receive({ data: { id, method: requestMethod, input } });
        return response.promise;
      };
      sharp.prototype.metadata = function (...args) {
        if (firstDecode) {
          firstDecode = false;
          decoderEntered.resolve();
          return releaseDecoder.promise.then(() => originalMetadata.apply(this, args));
        }
        return originalMetadata.apply(this, args);
      };
      process.argv = [process.argv[0], coreFile, x.dataRoot, "production"];
      Object.defineProperty(process, "parentPort", {
        configurable: true,
        value: {
          on: (name, handler) => {
            assert.equal(name, "message");
            receive = handler;
          },
          postMessage: (message) => {
            if (message.id) waiters.get(message.id)?.resolve(message.result);
          },
        },
      });
      globalThis.setInterval = (...args) => {
        const interval = originalSetInterval(...args);
        intervals.push(interval);
        return interval;
      };
      try {
        delete require.cache[require.resolve(coreFile)];
        require(coreFile);
        coreLoaded = true;
        globalThis.setInterval = originalSetInterval;
        // Exercise Core's real startup scan and its real parentPort RPC queue.
        await bounded(decoderEntered.promise, "the held image decoder");
        const input =
          method === "inbox.pause"
            ? {}
            : method === "internal.inboxBridge.configure"
              ? { projectRoot: x.replacementProject, expectedRevision: 1 }
              : { expectedRevision: 1 };
        const response = request("cancel", method, input);
        // Deliver the control message while decoding is still blocked. The
        // cancellation signal must escape the queue that is awaiting this scan.
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(fs.existsSync(x.promoted), false);
        assert.equal(x.repo.all("textCandidates").length, 0);
        releaseDecoder.resolve();
        const result = await bounded(response, method + " response");
        assert.equal(result.ok, true, JSON.stringify(result));
        assert.equal(
          fs.existsSync(x.promoted),
          false,
          "a control request delivered during decode must prevent private promotion",
        );
        assert.equal(
          x.repo.all("textCandidates").length,
          0,
          "the interrupted delivery must not be imported before the control request runs",
        );
        assert.equal(x.repo.all("drafts").length, 0);
        assert.equal(x.repo.all("operations").length, 0);
        assert.equal(x.repo.all("works").length, 0);
      } finally {
        releaseDecoder.resolve();
        for (const interval of intervals) clearInterval(interval);
        globalThis.setInterval = originalSetInterval;
        try {
          if (coreLoaded)
            await bounded(request("close", "internal.close", {}), "Core fixture close");
        } finally {
          sharp.prototype.metadata = originalMetadata;
          process.argv = originalArgv;
          if (originalPort) Object.defineProperty(process, "parentPort", originalPort);
          else delete process.parentPort;
          x.repo.close();
        }
      }
    });
  }
});
