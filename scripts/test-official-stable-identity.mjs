import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
const dir = path.resolve("output/official-stable-identity-tests");
fs.mkdirSync(dir, { recursive: true });
const bundle = path.join(dir, "reader.cjs");
await build({
  entryPoints: ["src/main/tme/official-stable-identity.ts"],
  outfile: bundle,
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
});
const fakeBundle = path.join(dir, "fake-page-reader.cjs");
await build({
  entryPoints: ["src/main/tme/official-stable-identity.ts"],
  outfile: fakeBundle,
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  plugins: [
    {
      name: "offline-page-only",
      setup(b) {
        b.onResolve({ filter: /^\.\/official-catalog-pagination$/ }, () => ({
          path: "background",
          namespace: "offline-page",
        }));
        b.onLoad({ filter: /.*/, namespace: "offline-page" }, () => ({
          contents:
            "export const openBackgroundOfficialPage=async primary=>primary.__offline.open();",
          loader: "js",
        }));
      },
    },
  ],
});
const r = spawnSync(
  process.execPath,
  [
    "--require",
    path.resolve("tests/fixtures/offline-only.cjs"),
    "--test",
    "tests/official-stable-identity.test.mjs",
  ],
  {
    encoding: "utf8",
    windowsHide: true,
    env: {
      ...process.env,
      RAINFALL_STABLE_IDENTITY_BUNDLE: bundle,
      RAINFALL_STABLE_FAKE_PAGE_BUNDLE: fakeBundle,
    },
  },
);
fs.writeFileSync(path.join(dir, "latest.log"), r.stdout + r.stderr);
console.log(r.stdout + r.stderr);
process.exitCode = r.status ?? 1;
