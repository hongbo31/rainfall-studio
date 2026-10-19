import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
if (process.versions.electron) throw Error("USE_NORMAL_NODE");
const root = path.resolve("output/inbox-unit-build");
fs.mkdirSync(root, { recursive: true });
const entries = [
  'export { Repository } from "./src/core/database";',
  'export * from "./src/shared/api-profiles";',
  'export { ApiCredentials, registerApiCredentialHandlers } from "./src/main/api-credentials";',
  'export { CredentialVault } from "./src/main/credentials";',
];
entries.push('export { Studio } from "./src/core/studio";');
for (const file of ["src/shared/text-providers.ts", "src/core/inbox/index.ts", "src/main/data-root.ts"])
  if (fs.existsSync(file)) entries.push(`export * from "./${file}";`);
const bundle = path.join(root, "unit.cjs");
await build({
  stdin: { contents: entries.join("\n"), resolveDir: process.cwd() },
  outfile: bundle,
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  packages: "external",
});
const ui = path.join(root, "ui.cjs");
await build({
  entryPoints: ["tests/fixtures/inbox-ui.tsx"],
  outfile: ui,
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  packages: "external",
});
const tests = fs
  .readdirSync("tests/pending/deepseek-dot")
  .filter((n) => n.endsWith(".test.cjs"))
  .map((n) => "tests/pending/deepseek-dot/" + n);
if (process.argv.includes("--regression"))
  tests.push(
    "tests/integration/api-profiles.test.cjs",
    "tests/integration/api-credentials.test.cjs",
  );
const hook = path.join(root, "resolve-unit-bundle.cjs");
fs.writeFileSync(
  hook,
  `const Module=require('node:module'),path=require('node:path');const old=Module._resolveFilename;Module._resolveFilename=function(request,parent,...rest){if(parent&&/^\.\.\\/\.\.\\/build\\/(core|vault|api-credentials)\\.cjs$/.test(request))return path.join(__dirname,'unit.cjs');return old.call(this,request,parent,...rest);};`,
);
const result = spawnSync(
  process.execPath,
  [
    "--require",
    path.resolve("tests/fixtures/offline-only.cjs"),
    "--require",
    hook,
    "--test",
    ...tests,
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      RAINFALL_INBOX_BUNDLE: bundle,
      RAINFALL_TEXT_CONFIG_BUNDLE: bundle,
      RAINFALL_INBOX_UI_BUNDLE: ui,
    },
  },
);
process.exit(result.status ?? 1);
