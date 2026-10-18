import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import path from "node:path";
const dir = "output/publish-material-feedback";
await build({
  entryPoints: ["src/core/index.ts"],
  outfile: dir + "/core.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
});
const r = spawnSync(
  process.execPath,
  [
    "--test",
    "tests/integration/publish-material-feedback.test.cjs",
    "tests/integration/simple-publishing.test.cjs",
  ],
  {
    stdio: "inherit",
    windowsHide: true,
    env: {
      ...process.env,
      RAINFALL_CORE_BUNDLE: path.resolve(dir, "core.cjs"),
    },
  },
);
process.exit(r.status ?? 1);
