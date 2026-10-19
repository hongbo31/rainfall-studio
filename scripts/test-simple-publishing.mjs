import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import path from "node:path";
import electron from "electron";
const outfile = "output/simple-publishing/core.cjs";
await build({
  entryPoints: ["src/core/index.ts"],
  outfile,
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  packages: "external",
});
const result = spawnSync(
  electron,
  ["--test", "tests/integration/simple-publishing.test.cjs"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      RAINFALL_SIMPLE_CORE_BUNDLE: path.resolve(outfile),
    },
  },
);
process.exit(result.status ?? 1);
