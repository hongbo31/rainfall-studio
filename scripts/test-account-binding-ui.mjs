import { build } from "esbuild";
import path from "node:path";
import { spawnSync } from "node:child_process";
const outfile = path.resolve("output/account-binding-ui/render.cjs");
await build({
  entryPoints: ["tests/fixtures/account-binding-render.tsx"],
  outfile,
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
});
const r = spawnSync(
  process.execPath,
  ["--test", "tests/account-binding-ui.test.mjs"],
  {
    env: { ...process.env, RAINFALL_ACCOUNT_BINDING_UI_BUNDLE: outfile },
    stdio: "inherit",
    windowsHide: true,
  },
);
process.exitCode = r.status ?? 1;
