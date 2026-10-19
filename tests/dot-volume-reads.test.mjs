import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { build } from "esbuild";
const out = path.resolve("output/dot-delivery-tests/volume-read.cjs");
await build({
  stdin: {
    contents:
      "export {read} from './src/core/inbox/dot-delivery-files';export {deliveryFailure} from './src/core/inbox/dot-delivery-package';",
    resolveDir: process.cwd(),
  },
  outfile: out,
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
});
const require = createRequire(import.meta.url);
require(path.resolve("tests/fixtures/offline-only.cjs"));
const { read } = require(out),
  cp = require("node:child_process");
test("nlink zero is accepted only for a verified matching Windows volume without hardlink support", () => {
  const folder = path.resolve("output/test-runs/volume-" + randomUUID());
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, "payload.json");
  fs.writeFileSync(file, '{"fixture":true}');
  const normal = fs.lstatSync(file);
  const originalStat = fs.lstatSync,
    originalFd = fs.fstatSync,
    originalExec = cp.execFileSync;
  let count = 0,
    links = 0,
    flags = 0x00400000,
    serial = normal.dev;
  fs.lstatSync = function (target, ...args) {
    const stat = originalStat.call(this, target, ...args);
    if (path.resolve(String(target)) === file) stat.nlink = links;
    return stat;
  };
  fs.fstatSync = function (fd, ...args) {
    const stat = originalFd.call(this, fd, ...args);
    stat.nlink = links;
    return stat;
  };
  cp.execFileSync = (command, args) => {
    count++;
    assert.equal(command, "pwsh.exe");
    assert.ok(args.includes("-Root"));
    return JSON.stringify({ serial, flags, fileSystem: "fixture" });
  };
  try {
    assert.throws(() => read(file, 1024), /FILE_REJECTED/);
    flags = 262;
    serial = normal.dev + 1;
    assert.throws(() => read(file, 1024), /FILE_REJECTED/);
    serial = normal.dev;
    assert.equal(read(file, 1024).toString(), '{"fixture":true}');
    assert.ok(count >= 3);
    links = 2;
    assert.throws(() => read(file, 1024), /FILE_REJECTED/);
    links = 1;
    assert.equal(read(file, 1024).toString(), '{"fixture":true}');
  } finally {
    fs.lstatSync = originalStat;
    fs.fstatSync = originalFd;
    cp.execFileSync = originalExec;
  }
});

test("native volume-query failure remains retryable", () => {
  const { deliveryFailure } = require(out);
  assert.equal(
    deliveryFailure(Error("DELIVERY_VOLUME_FACTS_UNAVAILABLE")).retryable,
    true,
  );
});
