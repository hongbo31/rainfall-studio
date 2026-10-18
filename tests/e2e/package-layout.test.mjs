import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
test("packaged Sharp dependencies are real unpacked DLLs beside the native binding", () => {
  const base =
    "out/RainfallStudio-win32-x64/resources/app.asar.unpacked/node_modules/@img/sharp-win32-x64/lib/";
  for (const file of [
    "sharp-win32-x64-0.35.5.node",
    "libvips-42.dll",
    "libvips-cpp-8.18.7.dll",
  ])
    assert.ok(
      fs.existsSync(base + file),
      "Missing packaged native dependency: " + file,
    );
});
