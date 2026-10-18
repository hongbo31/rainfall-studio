import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import path from "node:path";
const bundle = path.resolve("output/production-schedule-ui/ui.cjs");
const entries = [
  'export * from "./tests/fixtures/production-schedule-ui.tsx";',
  'export * from "./src/shared/production-schedule";',
];
await build({
  stdin: { contents: entries.join("\n"), resolveDir: process.cwd() },
  outfile: bundle,
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  packages: "external",
});
const r = spawnSync(
  process.execPath,
  [
    "--require",
    path.resolve("tests/fixtures/offline-only.cjs"),
    "--test",
    "tests/production-schedule-ui.test.mjs",
  ],
  {
    stdio: "inherit",
    env: { ...process.env, RAINFALL_PRODUCTION_SCHEDULE_UI_BUNDLE: bundle },
  },
);
process.exit(r.status ?? 1);
