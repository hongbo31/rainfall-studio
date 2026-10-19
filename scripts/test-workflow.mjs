import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
if (process.versions.electron) throw Error("USE_NORMAL_NODE");
const bundle = path.resolve("output/workflow-build/workflow.cjs");
await build({
  entryPoints: ["src/core/workflow/index.ts"],
  outfile: bundle,
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  packages: "external",
});
const core = path.resolve("output/workflow-build/core.cjs");
const ui = path.resolve("output/workflow-build/ui.cjs");
await build({
  entryPoints: ["tests/fixtures/workflow-render.tsx"],
  outfile: ui,
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  packages: "external",
});
await build({
  entryPoints: ["src/core/index.ts"],
  outfile: core,
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  packages: "external",
});
const tests = fs
  .readdirSync("tests/integration")
  .filter((p) => /^workflow-.*\.test\.cjs$/.test(p))
  .map((p) => "tests/integration/" + p);
const r = spawnSync(process.execPath, ["--test", ...tests], {
  stdio: "inherit",
  env: {
    ...process.env,
    RAINFALL_WORKFLOW_BUNDLE: bundle,
    RAINFALL_CORE_BUNDLE: core,
    RAINFALL_QUALITY_BUNDLE: path.resolve("output/quality-build/quality.cjs"),
    RAINFALL_WORKFLOW_UI_BUNDLE: ui,
  },
});
process.exit(r.status ?? 1);
