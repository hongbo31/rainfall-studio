import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import path from "node:path";
for (const name of [
  "quick-publish-ui",
  "clarity-ui",
  "tme-ui",
  "tme-publish-render",
  "cover-lyrics-ui",
  "tme-ai-prepare-ui",
]) {
  await build({
    entryPoints: [`tests/fixtures/${name}.tsx`],
    outfile: `build/${name}.cjs`,
    bundle: true,
    platform: "node",
    target: "node24",
    format: "cjs",
    packages: "external",
  });
}
const result = spawnSync(
  process.execPath,
  [
    "--test",
    "tests/simple-publishing-ui.test.mjs",
    "tests/configuration-ui.test.mjs",
    "tests/publish-selection-ui.test.mjs",
    "tests/quick-publish-ui.test.mjs",
    "tests/clarity.test.mjs",
    "tests/tme-ui.test.mjs",
    "tests/tme-ai-prepare-ui.test.mjs",
    "tests/tme-observations-ui.test.mjs",
    "tests/cover-lyrics-ui.test.mjs",
    "tests/ui-copy.test.mjs",
    "tests/client-version.test.mjs",
  ],
  {
    stdio: "inherit",
    windowsHide: true,
    env: {
      ...process.env,
      RAINFALL_TME_AI_PREPARE_UI_BUNDLE: path.resolve(
        "build/tme-ai-prepare-ui.cjs",
      ),
    },
  },
);
process.exit(result.status ?? 1);
