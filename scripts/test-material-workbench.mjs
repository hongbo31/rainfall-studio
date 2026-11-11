import { build } from "esbuild";
import { spawnSync } from "node:child_process";
await build({
  entryPoints: ["src/core/material-workbench.ts"],
  outfile: "build/material-workbench.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
});
const r = spawnSync(
  process.execPath,
  ["--test", "tests/material-workbench.test.cjs"],
  { stdio: "inherit" },
);
process.exit(r.status ?? 1);
