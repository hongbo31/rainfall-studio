import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
test("desktop entry and restricted preload are built", () => {
  assert.ok(fs.existsSync("build/main.cjs"), "real desktop entry missing");
  assert.ok(fs.existsSync("build/preload.cjs"), "preload missing");
});
