import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
const bundle = path.resolve("output/live-text-build/live-text.cjs");
const exports = ['export { Repository } from "./src/core/database";'];
for (const file of [
  "src/shared/live-text.ts",
  "src/core/workflow/deepseek.ts",
  "src/core/live-text.ts",
])
  if (fs.existsSync(file)) exports.push(`export * from "./${file}";`);
await build({
  stdin: { contents: exports.join("\n"), resolveDir: process.cwd() },
  outfile: bundle,
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  packages: "external",
});
const result = spawnSync(
  process.execPath,
  [
    "--require",
    path.resolve("tests/fixtures/offline-only.cjs"),
    "--test",
    "tests/live-text.test.mjs",
  ],
  {
    stdio: "inherit",
    env: { ...process.env, RAINFALL_LIVE_TEXT_BUNDLE: bundle },
  },
);
process.exit(result.status ?? 1);
