// Isolated development Electron acceptance. No real model, music or publishing calls.
import { _electron as electron, expect } from "@playwright/test";
import electronPath from "electron";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { beginDesktopRun, closeDesktopRun } from "./lib/windows-desktop-qa.mjs";
const out = path.resolve("output/dot-delivery-native-" + Date.now()),
  root = path.join(out, "candidate-data");
fs.mkdirSync(out, { recursive: true });
const report = {
  developmentElectron: true,
  packaged: false,
  dataRoot: root,
  errors: [],
  rendererHttp: [],
  screens: [],
  checks: [],
};
let app, page, run;
const call = (method, input = {}) =>
  page.evaluate(
    async ({ method, input }) => {
      const r = await window.rainfall.call(method, input);
      if (!r.ok) throw Error(r.error.code);
      return r.value;
    },
    { method, input },
  );
async function shot(name) {
  const file = path.join(out, name + ".png");
  await app.evaluate(async ({ BrowserWindow }, file) => {
    const image =
      await BrowserWindow.getAllWindows()[0].webContents.capturePage();
    process.getBuiltinModule("node:fs").writeFileSync(file, image.toPNG());
  }, file);
  report.screens.push(file);
}
try {
  run = await beginDesktopRun(electronPath, root);
  app = await electron.launch({
    executablePath: electronPath,
    args: ["."],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined,
      RAINFALL_DATA_ROOT: root,
      RAINFALL_MODE: "simulation",
    },
    timeout: 30000,
  });
  run.launcherPid = app.process().pid;
  run.pid = await app.evaluate(() => process.pid);
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  page.on("request", (r) => {
    if (/^https?:/.test(r.url())) report.rendererHttp.push(r.url());
  });
  await app.evaluate(({ BrowserWindow, session }) => {
    BrowserWindow.getAllWindows()[0].setContentSize(1440, 1000);
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ["http://*/*", "https://*/*"] },
      (_, cb) => cb({ cancel: true }),
    );
  });
  await page.getByRole("button", { name: "AI 聊天创作", exact: true }).click();
  const section = page.getByRole("region", { name: "自动收件箱" });
  await section
    .getByRole("button", { name: "配置本地收件通道", exact: true })
    .click();
  await expect.poll(async () => (await call("inbox.status")).active).toBe(true);
  const status = await call("inbox.status"),
    source = path.resolve("docs/integrations/dot-delivery-example");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(source, "manifest.json"), "utf8"),
  );
  fs.cpSync(
    source,
    path.join(status.packageDelivery.root, manifest.deliveryId),
    { recursive: true },
  );
  await expect
    .poll(async () => (await call("inbox.listCandidates")).candidates.length, {
      timeout: 20000,
    })
    .toBe(1);
  await section
    .getByText("歌词与封面包收件 · 本地通道", { exact: true })
    .click();
  await expect(section).toContainText("已入库 · 待模型评估", {
    timeout: 15000,
  });
  await section.locator("details.panel > summary").first().click();
  await expect(section).toContainText("封面已接收");
  await section.scrollIntoViewIfNeeded();
  await shot("01-text-cover-received");
  const rows = await call("inbox.listCandidates"),
    state = await call("snapshot");
  assert.equal(rows.candidates.length, 1);
  assert.ok(rows.candidates[0].cover);
  assert.equal(rows.candidates[0].evaluationState, "model_pending");
  const baseline = {
    works: state.works.length,
    externalRequests: state.externalRequests,
  };
  await section.getByRole("button", { name: "暂停收件", exact: true }).click();
  await expect
    .poll(async () => (await call("inbox.status")).active)
    .toBe(false);
  await section
    .getByRole("button", { name: "恢复本地收件", exact: true })
    .click();
  await expect.poll(async () => (await call("inbox.status")).active).toBe(true);
  await expect
    .poll(async () => (await call("inbox.status")).packageDelivery.lastScanAt, {
      timeout: 20000,
    })
    .toBeTruthy();
  assert.equal((await call("inbox.listCandidates")).candidates.length, 1);
  const after = await call("snapshot");
  assert.equal(after.works.length, baseline.works);
  assert.equal(after.externalRequests, baseline.externalRequests);
  await section.scrollIntoViewIfNeeded();
  await shot("02-pause-resume-no-duplicates");
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.rendererHttp, []);
  report.checks.push(
    "Native Electron renderer/Main/Core inbox configuration and text+cover import",
    "Cover binding and model_pending are visible",
    "Pause/resume preserves one candidate and creates no music/publication work",
    "No renderer HTTP, console page errors or horizontal overflow",
  );
  report.candidate = {
    id: rows.candidates[0].id,
    cover: rows.candidates[0].cover,
  };
  report.passed = true;
} catch (e) {
  report.passed = false;
  report.error = String(e);
  if (page) {
    report.navigation = await page
      .locator("nav button")
      .allTextContents()
      .catch(() => []);
    await shot("failure").catch(() => {});
  }
} finally {
  try {
    await closeDesktopRun(app, run);
  } catch (e) {
    report.passed = false;
    report.cleanupError = String(e);
  }
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2),
  );
  fs.writeFileSync(
    "output/latest-dot-delivery-native.json",
    JSON.stringify(
      {
        passed: report.passed,
        report: path.join(out, "report.json"),
        error: report.error,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      passed: report.passed,
      report: path.join(out, "report.json"),
      error: report.error,
      cleanupError: report.cleanupError,
    }),
  );
  if (!report.passed) process.exitCode = 1;
}
