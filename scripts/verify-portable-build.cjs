// Run the shipped Core with the shipped Electron runtime and an empty test library.
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const [packageRoot, dataRoot, mode] = process.argv.slice(2);
assert(path.isAbsolute(packageRoot) && path.isAbsolute(dataRoot));
assert(!fs.existsSync(dataRoot), "The verification library must be new");
const code = String.raw`
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const [root, data] = process.argv.slice(1);
(async () => {
const app = path.join(root, "resources/app");
const { Studio } = require(path.join(app, "build/core.cjs"));
for (let attempt = 0; attempt < 2; attempt++) {
  const studio = new Studio(data, "production");
  try {
    assert.equal(studio.snapshot().works.length, 0);
    assert(fs.statSync(path.join(data, "production/library.sqlite")).size > 0);
  } finally {
    studio.close();
  }
}
if (process.argv[3] !== "--installer") return;
const { execFileSync } = require("node:child_process");
const appRequire = require("node:module").createRequire(path.join(app, "package.json"));
const run = (tool, args) => execFileSync(path.join(app, "tools", tool), args,
  { windowsHide: true, timeout: 20000, encoding: "utf8" });
const file = path.join(data, "original.txt");
const renamed = path.join(data, "renamed.txt");
fs.writeFileSync(file, "offline verification");
run("powershell/pwsh.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-File",
  path.join(app, "build/dot-rename-exclusive.ps1"), "-Source", file, "-Destination", renamed]);
assert.equal(fs.readFileSync(renamed, "utf8"), "offline verification");
const audio = path.join(data, "verification.wav");
run("media/ffmpeg.exe", ["-loglevel", "error", "-f", "lavfi", "-i", "sine=duration=0.1", audio]);
assert.match(run("media/ffprobe.exe", ["-v", "error", "-show_entries", "format=format_name", audio]), /format_name=wav/);
const png = await appRequire("sharp")({ create: { width: 8, height: 8, channels: 3, background: "#ff6600" } }).png().toBuffer();
assert.equal(png.toString("ascii", 1, 4), "PNG");
fs.accessSync(path.join(app, "build/Rainfall-Remote-Assist.apk"));
const browser = await appRequire("playwright-core").chromium.launch({
  executablePath: path.join(app, "tools/chromium/chrome.exe"), headless: true, chromiumSandbox: true, timeout: 25000,
});
try {
  const page = await browser.newPage();
  await page.goto("data:text/html,<h1>Rainfall Studio</h1>");
  assert.equal(await page.locator("h1").textContent(), "Rainfall Studio");
} finally { await browser.close(); }
console.log("Verified bundled SQLite, PowerShell 7 helper, FFmpeg/FFprobe, Sharp, Chromium and Android APK layout");
})().catch(error => { console.error(error); process.exitCode = 1; });
`;
const env = { ...process.env, ELECTRON_RUN_AS_NODE: "1", RAINFALL_DATA_ROOT: dataRoot };
if (mode === "--installer") {
  for (const key of Object.keys(env)) if (key.toUpperCase() === "PATH") delete env[key];
  env.Path = [path.join(env.SystemRoot, "System32"), env.SystemRoot].join(path.delimiter);
}
execFileSync(path.join(packageRoot, "RainfallStudio.exe"), ["-e", code, packageRoot, dataRoot, mode ?? ""], {
  cwd: packageRoot,
  env,
  windowsHide: true,
  timeout: mode === "--installer" ? 90000 : 30000,
  stdio: "inherit",
});
