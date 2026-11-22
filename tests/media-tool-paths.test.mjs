import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { compileFunction } from "node:vm";
import path from "node:path";

const appRoot = path.resolve(import.meta.dirname, "..");
const bundleDirectory = path.join(appRoot, "build");
const { outputFiles } = await build({
  entryPoints: [path.join(appRoot, "src/core/assets.ts")],
  bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
});
const module = { exports: {} };
compileFunction(outputFiles[0].text, ["module", "exports", "require", "__dirname"])(
  module, module.exports, createRequire(import.meta.url), bundleDirectory,
);
const { mediaToolPath } = module.exports;

test("Windows resolves media tools beside the bundle without a system drive fallback", () => {
  const movedRoot = path.join(appRoot, "relocated app", "tools", "media");
  for (const tool of ["ffmpeg", "ffprobe"]) {
    assert.equal(mediaToolPath(tool, "win32"), path.join(appRoot, "tools", "media", tool + ".exe"));
    assert.equal(mediaToolPath(tool, "win32", movedRoot, () => false), path.join(movedRoot, tool + ".exe"));
  }
});

test("Linux uses the trusted system location when no packaged executable is present", () => {
  for (const tool of ["ffmpeg", "ffprobe"]) {
    assert.equal(mediaToolPath(tool, "linux", undefined, () => false, ""), "/usr/bin/" + tool);
    assert.equal(mediaToolPath(tool, "linux", undefined, () => false, "/mounted/media/bin"), "/mounted/media/bin/" + tool);
  }
  assert.throws(() => mediaToolPath("ffmpeg", "linux", undefined, () => false, "relative/tools"), /MEDIA_TOOL_ROOT_INVALID/);
  assert.throws(() => mediaToolPath("ffmpeg", "darwin", undefined, () => false), /MEDIA_TOOL_PLATFORM_UNSUPPORTED/);
  assert.throws(() => mediaToolPath("../sh", "linux"), /MEDIA_TOOL_UNSUPPORTED/);
});
