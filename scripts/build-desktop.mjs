import { build } from "esbuild";
import { build as viteBuild } from "vite";
import fs from "node:fs/promises";
import path from "node:path";
import { stageRemoteAssistApk } from "../src/main/remote-assist-apk.ts";

const projectRoot = path.resolve(import.meta.dirname, "..");
const output = path.join(projectRoot, "build");
await fs.mkdir(output, { recursive: true });
await stageRemoteAssistApk(path.resolve(projectRoot, process.env.RAINFALL_SMS_APK_DIR ||
  path.join("..", `${path.basename(projectRoot)}-build`, "android-sms")), output);
for (const [name, source] of Object.entries({
  "dot-rename-exclusive.ps1": "src/core/inbox/dot-rename-exclusive.ps1",
  "dot-volume-facts.ps1": "src/core/inbox/dot-volume-facts.ps1",
  "tme-uia-host.ps1": "src/main/tme/uia-host.ps1",
  "tme-ai-uia-host.ps1": "src/main/tme/ai-uia-host.ps1",
  "uia-grid.ps1": "src/main/tme/uia-grid.ps1",
})) {
  await fs.copyFile(path.join(projectRoot, source), path.join(output, name));
}
for (const [name, entry] of Object.entries({
  main: "src/main/bootstrap.ts",
  preload: "src/preload/index.ts",
  core: "src/core/index.ts",
  'dot-inbox-host': "src/core/inbox/headless-host.ts",
  vault: "src/main/credentials.ts",
  "api-credentials": "src/main/api-credentials.ts",
  "live-music": "src/main/live-music.ts",
  quality: "src/core/quality/index.ts",
  'tme-browser': 'src/main/tme/index.ts',
})) {
  await build({
    absWorkingDir: projectRoot,
    entryPoints: [entry],
    outfile: path.join(output, `${name}.cjs`),
    bundle: true,
    platform: "node",
    target: "node24",
    format: "cjs",
    packages: "external",
    sourcemap: true,
  });
}
await viteBuild({
  root: path.join(projectRoot, "src", "renderer"),
  base: "./",
  build: { outDir: path.join(output, "ui"), emptyOutDir: true },
  logLevel: "warn",
});
console.log("Desktop Main / preload / Core / renderer built");
