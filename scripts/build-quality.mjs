// This entry only builds the standalone logic module. It never loads Electron.
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
export const qualityBundle = path.join(
  root,
  "output/quality-build/quality.cjs",
);
await fs.mkdir(path.dirname(qualityBundle), { recursive: true });
await build({
  entryPoints: [path.join(root, "src/core/quality/index.ts")],
  outfile: qualityBundle,
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  packages: "external",
  sourcemap: true,
});
console.log("Standalone quality logic built: " + qualityBundle);
