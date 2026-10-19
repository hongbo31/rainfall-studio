import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const file = path.resolve("output/production-flow-build/flow.cjs"),
  entries = [
    'export {Repository,hash} from "./src/core/database"; export {cleanLyricText} from "./src/shared/tme-lyrics";',
  ];
for (const p of [
  "src/shared/production-flow.ts",
  "src/core/production-flow.ts",
  "src/core/production-flow-inbox.ts",
  "src/core/inbox/controller.ts",
])
  if (fs.existsSync(p)) entries.push(`export * from "./${p}";`);
await build({
  stdin: { contents: entries.join("\n"), resolveDir: process.cwd() },
  outfile: file,
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
});
const r = spawnSync(
  process.execPath,
  [
    "--require",
    path.resolve("tests/fixtures/offline-only.cjs"),
    "--test",
    "tests/production-flow.test.mjs",
  ],
  {
    stdio: "inherit",
    env: { ...process.env, RAINFALL_PRODUCTION_FLOW_BUNDLE: file },
  },
);
process.exit(r.status ?? 1);
