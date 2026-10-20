import { build } from "esbuild";
import { spawnSync } from "node:child_process";
await build({
  entryPoints: ["src/core/material-workbench.ts"],
  outfile: "build/material-import.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
});
const result = spawnSync(
  process.execPath,
  ["--test", "tests/material-import.test.cjs"],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
