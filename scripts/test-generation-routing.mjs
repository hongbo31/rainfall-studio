import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
const dir = path.resolve("output/generation-routing-tests");
fs.mkdirSync(dir, { recursive: true });
const bundle = path.join(dir, "bundle.cjs");
await build({
  stdin: {
    contents:
      "export {Studio} from './src/core/studio';export{tickPlanCenter}from './src/core/plan-center-integration';export{ProviderTextService}from './src/core/provider-text';export{createProviderTextBroker}from './src/main/provider-text';export{assertWorkIdentityWrite,assertTaskIdentity}from './src/core/plan-identity';",
    resolveDir: process.cwd(),
    loader: "ts",
  },
  outfile: bundle,
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
});
const r = spawnSync(
  (await import("electron")).default,
  ["--test", "tests/generation-routing.test.cjs"],
  {
    encoding: "utf8",
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      RAINFALL_ROUTING_BUNDLE: bundle,
    },
  },
);
fs.writeFileSync(path.join(dir, "latest.log"), r.stdout + r.stderr);
console.log(r.stdout + r.stderr);
process.exitCode = r.status ?? 1;
