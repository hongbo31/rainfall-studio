import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
if (process.versions.electron) throw Error("USE_NORMAL_NODE");
const dir = path.resolve("output/headless-build");
fs.mkdirSync(dir, { recursive: true });
const ui = path.join(dir, "workflow-ui.cjs");
await build({
  entryPoints: ["tests/fixtures/workflow-render.tsx"],
  outfile: ui,
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  packages: "external",
});
for (const [name, entry] of Object.entries({
  core: "src/core/index.ts",
  quality: "src/core/quality/index.ts",
  workflow: "src/core/workflow/index.ts",
  vault: "src/main/credentials.ts",
  "api-credentials": "src/main/api-credentials.ts",
}))
  await build({
    entryPoints: [entry],
    outfile: path.join(dir, name + ".cjs"),
    bundle: true,
    platform: "node",
    target: "node24",
    format: "cjs",
    packages: "external",
  });
// Existing tests address build/*.cjs. Redirect those fixture imports to this isolated build.
const hook = path.join(dir, "resolve-test-build.cjs");
fs.writeFileSync(
  hook,
  `const Module=require('node:module'),path=require('node:path');const old=Module._resolveFilename;Module._resolveFilename=function(request,parent,...rest){if(parent&&request.startsWith('../../build/')&&request.endsWith('.cjs'))return path.join(__dirname,path.basename(request));return old.call(this,request,parent,...rest);};`,
);
const tests = fs
  .readdirSync("tests/integration")
  .filter((p) => p.endsWith(".test.cjs"))
  .map((p) => "tests/integration/" + p);
const r = spawnSync(process.execPath, ["--require", hook, "--test", ...tests], {
  stdio: "inherit",
  env: {
    ...process.env,
    RAINFALL_QUALITY_BUNDLE: path.join(dir, "quality.cjs"),
    RAINFALL_WORKFLOW_BUNDLE: path.join(dir, "workflow.cjs"),
    RAINFALL_CORE_BUNDLE: path.join(dir, "core.cjs"),
    RAINFALL_WORKFLOW_UI_BUNDLE: ui,
  },
});
process.exit(r.status ?? 1);
