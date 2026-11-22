import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { compileFunction } from "node:vm";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: [path.resolve(import.meta.dirname, "../src/main/fanqie/recycle-file.ts")],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  packages: "external",
});
const mod = { exports: {} };
compileFunction(outputFiles[0].text, ["module", "exports", "require", "__dirname"])(
  mod, mod.exports, createRequire(import.meta.url), path.join(import.meta.dirname, "../output"),
);
const { recycleFanqieFile } = mod.exports;
const allow = () => {};
const originalCover = "歌单封面";

function archiveFixture(t) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "rainfall-fanqie-recycle-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const archive = path.join(root, "archive");
  fs.mkdirSync(archive);
  const file = path.join(archive, "封面.jpg");
  fs.writeFileSync(file, originalCover);
  const { dev, ino, size, mtimeNs, ctimeNs } = fs.lstatSync(file, { bigint: true });
  const source = { file, bytes: Number(size), identity: [dev, ino, size, mtimeNs, ctimeNs].join(":") };
  return { source, archive, root, moved: path.join(root, "recycled.jpg") };
}

async function runRetryTimers(t, operation, beforeRetry = allow) {
  // Keep the operation observable while giving each retry time to schedule its timer.
  void operation.catch(() => {});
  await setImmediate();
  beforeRetry();
  t.mock.timers.runAll();
  await setImmediate();
  t.mock.timers.runAll();
}

test("retries temporary native failures and moves the original file", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { source, moved } = archiveFixture(t);
  let attempts = 0;
  const operation = recycleFanqieFile(source, async file => {
    if (++attempts <= 2) throw Error("file temporarily held");
    fs.renameSync(file, moved);
  }, allow);
  await runRetryTimers(t, operation);
  await operation;
  assert.equal(attempts, 3);
  assert.equal(fs.existsSync(source.file), false);
  assert.equal(fs.readFileSync(moved, "utf8"), originalCover);
});

test("stops trying a persistently held file and exposes only a sanitized failure", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { source } = archiveFixture(t);
  let attempts = 0;
  const operation = recycleFanqieFile(source, async file => {
    attempts++;
    throw Error("native trash failed for " + file);
  }, allow);
  await runRetryTimers(t, operation);
  await assert.rejects(operation, error => {
    assert.equal(error.message, "FANQIE_RECYCLE_OS_FAILED");
    assert.equal(error.cause, undefined);
    return true;
  });
  assert.equal(attempts, 3);
  assert.equal(fs.readFileSync(source.file, "utf8"), originalCover);
});

test("preserves a replacement created while waiting to retry a native failure", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { source, root, moved } = archiveFixture(t);
  const original = path.join(root, "original.jpg");
  let attempts = 0;
  const operation = recycleFanqieFile(source, async file => {
    if (++attempts === 1) throw Error("transient native failure");
    fs.renameSync(file, moved);
  }, allow);
  await runRetryTimers(t, operation, () => {
    fs.renameSync(source.file, original);
    fs.writeFileSync(source.file, "new cover");
  });
  await assert.rejects(operation, { message: "FANQIE_DOWNLOADS_CHANGED" });
  assert.equal(attempts, 1);
  assert.equal(fs.existsSync(moved), false);
  assert.equal(fs.readFileSync(source.file, "utf8"), "new cover");
});

test("stops before the next native attempt when the caller cancels the operation", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { source, moved } = archiveFixture(t);
  const cancellation = Error("FANQIE_INTERRUPTED");
  let canceled = false;
  let attempts = 0;
  const operation = recycleFanqieFile(source, async file => {
    if (++attempts === 1) throw Error("transient native failure");
    fs.renameSync(file, moved);
  }, () => {
    if (canceled) throw cancellation;
  });
  await runRetryTimers(t, operation, () => { canceled = true; });
  await assert.rejects(operation, error => error === cancellation);
  assert.equal(attempts, 1);
  assert.equal(fs.readFileSync(source.file, "utf8"), originalCover);
});

test("rejects redirecting an unchanged recording through a directory link", async t => {
  const { source, archive, root, moved } = archiveFixture(t);
  const original = path.join(root, "original-archive");
  fs.renameSync(archive, original);
  fs.symlinkSync(original, archive, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(recycleFanqieFile(source, async file => fs.renameSync(file, moved), allow), {
    message: "FANQIE_DOWNLOADS_CHANGED",
  });
  assert.equal(fs.existsSync(moved), false);
  assert.equal(fs.readFileSync(path.join(original, path.basename(source.file)), "utf8"), originalCover);
});

test("reports an inaccessible path instead of treating it as missing", async t => {
  const { source, moved } = archiveFixture(t);
  const lstatSync = fs.lstatSync;
  t.mock.method(fs, "lstatSync", (file, options) => {
    if (file === source.file) throw Object.assign(Error("access denied for " + file), { code: "EACCES" });
    return lstatSync(file, options);
  });
  await assert.rejects(recycleFanqieFile(source, async file => fs.renameSync(file, moved), allow), error => {
    assert.equal(error.message, "FANQIE_RECYCLE_FILE_CHECK_FAILED");
    assert.equal(error.cause, undefined);
    return true;
  });
  assert.equal(fs.existsSync(moved), false);
});

test("skips the native operation when the recorded file is already missing", async t => {
  const { source, moved } = archiveFixture(t);
  fs.renameSync(source.file, moved);
  await recycleFanqieFile(source, async () => assert.fail("native trash called for a missing file"), allow);
  assert.equal(fs.readFileSync(moved, "utf8"), originalCover);
});

test("accepts a native error if the original file was moved before the error", async t => {
  const { source, moved } = archiveFixture(t);
  let attempts = 0;
  await recycleFanqieFile(source, async file => {
    attempts++;
    fs.renameSync(file, moved);
    throw Error("native response failed after moving " + file);
  }, allow);
  assert.equal(attempts, 1);
  assert.equal(fs.existsSync(source.file), false);
  assert.equal(fs.readFileSync(moved, "utf8"), originalCover);
});

test("retries when the native call reports success and leaves the original in place", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { source, moved } = archiveFixture(t);
  let attempts = 0;
  const operation = recycleFanqieFile(source, async file => {
    if (++attempts === 2) fs.renameSync(file, moved);
  }, allow);
  await runRetryTimers(t, operation);
  await operation;
  assert.equal(attempts, 2);
  assert.equal(fs.existsSync(source.file), false);
  assert.equal(fs.readFileSync(moved, "utf8"), originalCover);
});
