import { build } from "esbuild";
import { spawnSync } from "node:child_process";
await build({
  entryPoints: ["src/core/index.ts"],
  outfile: "build/core.cjs",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  packages: "external",
});
await build({
  entryPoints: ["tests/fixtures/cover-lyrics-ui.tsx"],
  outfile: "build/cover-lyrics-ui.cjs",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  packages: "external",
});
const r = spawnSync(
  process.execPath,
  [
    "--test",
    "tests/integration/cover-lyrics.test.cjs",
    "tests/cover-lyrics-ui.test.mjs",
  ],
  { stdio: "inherit" },
);
process.exit(r.status ?? 1);
