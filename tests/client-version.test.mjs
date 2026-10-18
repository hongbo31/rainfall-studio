import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { build } from "esbuild";
import { createRequire } from "node:module";
let display;
if (fs.existsSync("src/renderer/client-version.ts")) {
  await build({
    entryPoints: ["src/renderer/client-version.ts"],
    outfile: "output/client-version/label.cjs",
    bundle: true,
    platform: "node",
    format: "cjs",
  });
  ({ clientVersionLabel: display } = createRequire(import.meta.url)(
    "../output/client-version/label.cjs",
  ));
}
test("current runtime version wins over advertised or server versions", () => {
  assert.equal(typeof display, "function");
  for (const version of ["0.8.1-preview.1", "2.4.6-local+build7"])
    assert.equal(
      display(
        {
          appVersion: version,
          packaged: true,
          latestVersion: "99.0.0",
          serverVersion: "88.0.0",
        },
        true,
      ),
      "v" + version,
    );
});
test("development runtime is labelled and retains its own metadata version", () => {
  assert.equal(typeof display, "function");
  assert.equal(
    display({ appVersion: " 1.2.3-dev.4 ", packaged: false }, true),
    "v1.2.3-dev.4 · 开发运行",
  );
});
test("web preview never presents supplied metadata as a running desktop version", () => {
  assert.equal(typeof display, "function");
  assert.equal(
    display({ appVersion: "9.9.9", packaged: true }, false),
    "Web 预览 · 无客户端版本",
  );
});
test("missing or invalid runtime metadata remains explicitly unknown", () => {
  assert.equal(typeof display, "function");
  for (const appVersion of [undefined, null, 17, "", "  "])
    assert.equal(display({ appVersion, packaged: true }, true), "版本未知");
  assert.equal(display({ packaged: false }, true), "开发运行 · 版本未知");
});
