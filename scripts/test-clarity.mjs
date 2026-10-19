import { build } from "esbuild";
import { spawnSync } from "node:child_process";
await build({
  entryPoints: ["tests/fixtures/clarity-ui.tsx"],
  outfile: "build/clarity-ui.cjs",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  packages: "external",
});
const result = spawnSync(
  process.execPath,
  ["--test", "tests/clarity.test.mjs"],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
