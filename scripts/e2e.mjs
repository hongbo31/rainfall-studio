import { _electron as electron } from "@playwright/test";
import electronPath from "electron";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const packaged = process.argv.includes("--packaged");
const executable = packaged
  ? path.resolve("out/RainfallStudio-win32-x64/RainfallStudio.exe")
  : electronPath;
const root = path.resolve("output/desktop-qa");
fs.mkdirSync(root, { recursive: true });
const screenshots = path.resolve("output/desktop-screenshots");
fs.mkdirSync(screenshots, { recursive: true });
let app;
const errors = [],
  requests = [];
const results = [];
try {
  app = await electron.launch({
    executablePath: executable,
    args: packaged ? [] : ["."],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined,
      RAINFALL_DATA_ROOT: root,
      RAINFALL_MODE: "simulation",
    },
    timeout: 30000,
  });
  app.process().stdout?.on("data", (b) => process.stdout.write(b));
  app.process().stderr?.on("data", (b) => process.stderr.write(b));
  const page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (/^https?:/.test(r.url())) requests.push(r.url());
  });
  await page.getByRole("heading", { name: "总览", exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() => typeof globalThis.require),
    "undefined",
  );
  assert.equal(await page.getByRole("button", { name: "手动模板", exact: true }).count(), 0);
  results.push("restricted Electron window / retired template absent");
  await page.screenshot({
    path: path.join(
      screenshots,
      packaged ? "packaged-overview.png" : "overview.png",
    ),
  });
  for (const [nav, heading] of [
    ["创作中心", "创作中心"],
    ["封面工作室", "封面工作室"],
    ["任务中心", "任务中心"],
    ["数据看板", "数据看板"],
    ["配置中心", "配置中心"],
  ]) {
    await page.getByRole("button", { name: nav, exact: true }).click();
    await page.getByRole("heading", { name: heading, exact: true }).waitFor();
    results.push("navigation " + nav);
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  fs.writeFileSync(
    path.join(screenshots, packaged ? "packaged-results.json" : "results.json"),
    JSON.stringify(
      { packaged, results, errors, externalRequests: requests },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      {
        packaged,
        passed: results.length,
        errors,
        externalRequests: requests.length,
      },
      null,
      2,
    ),
  );
} finally {
  await app?.close();
}
