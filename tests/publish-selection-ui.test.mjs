import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { build } from "esbuild";
import { createRequire } from "node:module";
test("selection saves stay in user event order and a failed save does not block subsequent edits", async () => {
  assert.ok(
    fs.existsSync("src/renderer/publish-selection.ts"),
    "ordered selection persistence is missing",
  );
  await build({
    entryPoints: ["src/renderer/publish-selection.ts"],
    outfile: "build/publish-selection-ui.cjs",
    bundle: true,
    platform: "node",
    format: "cjs",
    packages: "external",
  });
  const { createSelectionWriter } = createRequire(import.meta.url)(
    "../build/publish-selection-ui.cjs",
  );
  const writes = [];
  let release;
  const writer = createSelectionWriter(async (selection) => {
    writes.push(selection.workIds.join(","));
    if (writes.length === 1)
      await new Promise((resolve) => (release = resolve));
    if (selection.workIds[0] === "fail") throw Error("save failed");
  });
  const first = writer.enqueue({
    workIds: ["a"],
    targets: ["netease"],
    accountOverrides: {},
  });
  const second = writer.enqueue({
    workIds: ["b"],
    targets: ["qishui"],
    accountOverrides: {},
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(writes, ["a"]);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(writes, ["a", "b"]);
  await assert.rejects(
    writer.enqueue({ workIds: ["fail"], targets: [], accountOverrides: {} }),
    /save failed/,
  );
  await writer.enqueue({ workIds: [], targets: [], accountOverrides: {} });
  await writer.flush();
  assert.deepEqual(writes, ["a", "b", "fail", ""]);
});
