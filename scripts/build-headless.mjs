import { build } from "esbuild";
import { build as viteBuild } from "vite";
import path from "node:path";
// Compilation only; no Electron binary, server, browser or watcher.
const output = path.resolve("output/creation-daily-build");
for (const [name, entry] of Object.entries({
  main: "src/main/bootstrap.ts",
  preload: "src/preload/index.ts",
  core: "src/core/index.ts",
  quality: "src/core/quality/index.ts",
  workflow: "src/core/workflow/index.ts",
}))
  await build({
    entryPoints: [entry],
    outfile: path.join(output, name + ".cjs"),
    bundle: true,
    platform: "node",
    target: "node24",
    format: "cjs",
    packages: "external",
  });
await viteBuild({
  root: "src/renderer",
  base: "./",
  build: { outDir: path.join(output, "ui"), emptyOutDir: true },
  logLevel: "warn",
});
console.log("Headless compile complete: " + output);
