import { build } from "esbuild";
import { build as viteBuild } from "vite";
import fs from "node:fs/promises";
await fs.mkdir("build", { recursive: true });
for (const [name, entry] of Object.entries({
  main: "src/main/bootstrap.ts",
  preload: "src/preload/index.ts",
  core: "src/core/index.ts",
  vault: "src/main/credentials.ts",
  "api-credentials": "src/main/api-credentials.ts",
  quality: "src/core/quality/index.ts",
})) {
  await build({
    entryPoints: [entry],
    outfile: `build/${name}.cjs`,
    bundle: true,
    platform: "node",
    target: "node24",
    format: "cjs",
    packages: "external",
    sourcemap: true,
  });
}
await viteBuild({
  root: "src/renderer",
  base: "./",
  build: { outDir: "../../build/ui", emptyOutDir: true },
  logLevel: "warn",
});
console.log("Desktop Main / preload / Core / renderer built");
