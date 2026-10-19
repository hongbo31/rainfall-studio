import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
await build({
  entryPoints: ["src/core/index.ts"],
  outfile: "build/core.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
});
if (fs.existsSync("src/main/tme/live.ts"))
  await build({
    entryPoints: ["src/main/tme/live.ts"],
    outfile: "build/tme-live.cjs",
    bundle: true,
    platform: "node",
    format: "cjs",
    packages: "external",
  });
await build({
  entryPoints: ["src/main/tme/live-ipc.ts"],
  outfile: "build/tme-live-ipc.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
});
await build({
  entryPoints: ["tests/fixtures/tme-publish-render.tsx"],
  outfile: "build/tme-publish-render.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
});
await build({
  entryPoints: ["src/main/tme/uia-transport.ts"],
  outfile: "build/tme-uia.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
});
const r = spawnSync(process.execPath, ["--test", "tests/tme-live.test.mjs"], {
  stdio: "inherit",
});
process.exit(r.status ?? 1);
