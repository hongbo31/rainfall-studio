import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from 'node:path';
import {build} from 'esbuild';
const workflowBundles={RAINFALL_WORKFLOW_BUNDLE:['src/core/workflow/index.ts','output/workflow-build/workflow.cjs'],RAINFALL_CORE_BUNDLE:['src/core/index.ts','output/workflow-build/core.cjs'],RAINFALL_QUALITY_BUNDLE:['src/core/quality/index.ts','output/quality-build/quality.cjs'],RAINFALL_WORKFLOW_UI_BUNDLE:['tests/fixtures/workflow-render.tsx','output/workflow-build/ui.cjs']};
const bundleEnvironment={};
for(const [key,[entry,outfile]] of Object.entries(workflowBundles)){
 await build({entryPoints:[entry],outfile,bundle:true,platform:'node',target:'node24',format:'cjs',packages:'external'});
 bundleEnvironment[key]=path.resolve(outfile);
}
const files = fs
  .readdirSync("tests/integration")
  .filter((x) => x.endsWith(".test.cjs"))
  .map((x) => "tests/integration/" + x);
const executable = process.env.RAINFALL_TEST_RUNTIME === "node" ? process.execPath : (await import("electron")).default;
const r = spawnSync(executable, ["--test", ...files], {
  stdio: "inherit",
  env: { ...process.env, ...bundleEnvironment, ELECTRON_RUN_AS_NODE: "1" },
});
process.exit(r.status ?? 1);
