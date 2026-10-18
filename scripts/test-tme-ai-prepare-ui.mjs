import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import path from "node:path";
const bundle = path.resolve("output/tme-ai-prepare-ui/ui.cjs");
await build({
  entryPoints: ["tests/fixtures/tme-ai-prepare-ui.tsx"],
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
    "tests/tme-ai-prepare-ui.test.mjs",
  ],
  {
    stdio: "inherit",
    windowsHide: true,
    env: { ...process.env, RAINFALL_TME_AI_PREPARE_UI_BUNDLE: bundle },
  },
);
process.exit(result.status ?? 1);
