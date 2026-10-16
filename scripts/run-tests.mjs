import { spawnSync } from "node:child_process";
import electron from "electron";
import fs from "node:fs";
const files = fs
  .readdirSync("tests/integration")
  .filter((x) => x.endsWith(".test.cjs"))
  .map((x) => "tests/integration/" + x);
const r = spawnSync(electron, ["--test", ...files], {
  stdio: "inherit",
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
});
process.exit(r.status ?? 1);
