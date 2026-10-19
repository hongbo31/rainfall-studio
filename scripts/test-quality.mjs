import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { qualityBundle } from "./build-quality.mjs";
if (process.versions.electron) throw Error("USE_NORMAL_NODE_FOR_QUALITY_TESTS");
const root = fileURLToPath(new URL("../", import.meta.url));
const tests = fs
  .readdirSync(new URL("../tests/integration/", import.meta.url))
  .filter((file) => /^quality-.*\.test\.cjs$/.test(file))
  .map((file) => "tests/integration/" + file);
const result = spawnSync(process.execPath, ["--test", ...tests], {
  cwd: root,
  env: { ...process.env, RAINFALL_QUALITY_BUNDLE: qualityBundle },
  stdio: "inherit",
});
process.exit(result.status ?? 1);
