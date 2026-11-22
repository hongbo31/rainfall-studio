// Authorized native acceptance of the real packaged Electron with its existing library.
// No fixture bridge, service calls, edits, generation, consent, or submission.
import { _electron as electron, expect } from "@playwright/test";
import { openCreationWork } from "./lib/open-creation-work.mjs";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  beginDesktopRun,
  closeDesktopRun,
  withTimeout,
} from "./lib/windows-desktop-qa.mjs";
const read = (f) =>
  JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const pkg = read("output/ui-consistency-package.json"),
  backup = read("output/ui-consistency-native-delivery-backup.json"),
  out = path.resolve("output/ui-consistency-native");
const metadata = read(
  path.join(path.dirname(pkg.executable), "resources/app/package.json"),
);
assert.equal(metadata.version, pkg.version);
assert.equal(pkg.sourceCommit, "51ee699231dc5a5e36472e89f561ca0a15e73fab");
const checks = [],
  screens = [],
  errors = [],
  requests = [];
let app,
  page,
  run,
  runtime,
  media = [],
  beforeHash,
  afterHash;
const digest = (value) =>
  crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const stable = (s) => ({
  works: s.works,
  assets: s.assets,
  accounts: s.accounts,
  artists: s.artists,
  platformConfigurations: s.platformConfigurations,
  publishSelection: s.publishSelection,
});
const call = async (method, input = {}) =>
  page.evaluate(
    async ({ method, input }) => {
      const r = await window.rainfall.call(method, input);
      if (!r.ok) throw Error(r.error.code + ": " + r.error.message);
      return r.value;
    },
    { method, input },
  );
async function shot(name) {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    return new Promise((r) =>
      requestAnimationFrame(() => requestAnimationFrame(r)),
    );
  });
  const file = path.join(out, name + ".png");
  await page.screenshot({ path: file });
  screens.push(file);
}
const version = () => page.getByLabel("客户端版本", { exact: true });
async function layout(name) {
  await expect(version()).toHaveText("v" + pkg.version);
  await expect(version()).toBeVisible();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    name + " horizontal overflow",
  );
  checks.push({
    name:
      name +
      " native navigation, visible current version and no horizontal overflow",
  });
}
try {
  run = await beginDesktopRun(pkg.executable, backup.dataRoot);
  app = await electron.launch({
    executablePath: pkg.executable,
    args: [],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined,
      RAINFALL_DATA_ROOT: backup.dataRoot,
      RAINFALL_MODE: "production",
    },
    timeout: 30000,
  });
  run.launcherPid = app.process().pid;
  run.pid = await withTimeout(
    () => app.evaluate(() => process.pid),
    5000,
    "NATIVE_PID_TIMEOUT",
  );
  page = await withTimeout(
    () => app.firstWindow(),
    15000,
    "NATIVE_WINDOW_TIMEOUT",
  );
  page.setDefaultTimeout(12000);
  page.on("pageerror", (e) => errors.push(e.message));
  const windowInfo = await app.evaluate(
    ({ BrowserWindow, session, screen }) => {
      const win = BrowserWindow.getAllWindows()[0],
        area = screen.getPrimaryDisplay().workAreaSize;
      win.setContentSize(
        Math.min(1440, area.width - 40),
        Math.min(920, area.height - 90),
      );
      globalThis.__qaBlockedHttp = 0;
      globalThis.__qaBlockedNative = 0;
      const deny = () => {
        globalThis.__qaBlockedHttp++;
        throw Error("ACCEPTANCE_EXTERNAL_HTTP_BLOCKED");
      };
      process.getBuiltinModule("node:https").request = deny;
      process.getBuiltinModule("node:http").request = deny;
      process.getBuiltinModule("node:dns").promises.lookup = deny;
      session.defaultSession.webRequest.onBeforeRequest(
        { urls: ["http://*/*", "https://*/*"] },
        (_d, cb) => {
          globalThis.__qaBlockedHttp++;
          cb({ cancel: true });
        },
      );
      process.getBuiltinModule("node:child_process").spawn = () => {
        globalThis.__qaBlockedNative++;
        throw Error("ACCEPTANCE_NATIVE_PLATFORM_TOOL_BLOCKED");
      };
      return {
        bounds: win.getBounds(),
        visible: win.isVisible(),
        destroyed: win.isDestroyed(),
        workArea: area,
        version: process.versions.electron,
      };
    },
  );
  await page.getByRole("button", { name: "创作中心", exact: true }).waitFor();
  runtime = await call("runtime");
  assert.equal(runtime.root, backup.dataRoot);
  assert.equal(runtime.mode, "production");
  assert.equal(runtime.packaged, true);
  assert.equal(runtime.appVersion, pkg.version);
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isVisible(),
      ),
    )
    .toBe(true);
  windowInfo.visibleAtReady = true;
  checks.push({
    name: "Actual native Electron runtime app.getVersion and original production root verified",
    runtime: {
      appVersion: runtime.appVersion,
      packaged: runtime.packaged,
      mode: runtime.mode,
      root: runtime.root,
    },
    windowInfo,
  });
  const before = await call("snapshot");
  assert.equal(before.works.length, 1);
  assert.equal(before.assets.length, 4);
  beforeHash = digest(stable(before));
  checks.push({
    name: "Original work, assets and five saved platform defaults loaded",
    workIds: before.works.map((w) => w.id),
    assetIds: before.assets.map((a) => a.id),
    platformCount: before.platformConfigurations.length,
  });
  const names = [
    "总览",
    "封面工作室",
    "发布中心",
    "数据看板",
    "配置中心",
    "创作中心",
  ];
  for (const name of names) {
    await page.getByRole("button", { name, exact: true }).click();
    await layout(name);
    if (name === "创作中心") {
      await page
        .getByRole("searchbox", { name: "搜索作品", exact: true })
        .waitFor();
      await expect(page.locator(".page-head h1")).toHaveText("创作中心");
      await expect(page.locator(".page-head .eyebrow")).toHaveCount(0);
    }
    await shot(name + "-native");
  }
  const header = await page.locator(".header-right > :not(.theme-toggle)").evaluateAll((ns) =>
    ns.map((n) => {
      const r = n.getBoundingClientRect(),
        s = getComputedStyle(n);
      return {
        tag: n.tagName,
        height: r.height,
        y: r.y,
        font: s.fontSize,
        padding: s.padding,
      };
    }),
  );
  assert.equal(header.length, 4);
  assert(header.every((x) => x.height === 36 && x.font === "13px"));
  assert.equal(new Set(header.map((x) => x.y)).size, 1);
  checks.push({
    name: "Header controls align at 36px / 13px",
    measurements: header,
  });
  await page.getByRole("button", { name: "配置中心", exact: true }).click();
  const configurationTabs = ["模型 API", "提示词管理", "下载目录", "诊断与历史", "外观"];
  await expect(page.getByRole("tablist", { name: "配置分类" }).getByRole("tab")).toHaveText(configurationTabs);
  for (const tab of configurationTabs) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    await layout("配置中心/" + tab);
  }
  checks.push({
    name: "The five remaining configuration categories open without changing saved settings",
  });
  await page.getByRole("button", { name: "创作中心", exact: true }).click();
  const search = page.getByRole("searchbox", { name: "搜索作品", exact: true });
  await search.fill("不存在的验收关键词");
  await expect(page.locator(".creation-work-items [data-work-id]")).toHaveCount(0);
  await search.fill("");
  const sampleWork = (await call("snapshot")).works.find(work => work.title === "示例作品A");
  assert.ok(sampleWork);
  await openCreationWork(page, sampleWork.id);
  await layout("作品详情");
  await expect
    .poll(() =>
      page
        .locator('img[src^="media:"]')
        .evaluateAll((ns) => ns.some((n) => n.complete && n.naturalWidth > 0)),
    )
    .toBe(true);
  const loadedImages = await page
    .locator('img[src^="media:"]')
    .evaluateAll((ns) =>
      ns.map((n) => ({
        src: n.getAttribute("src"),
        complete: n.complete,
        width: n.naturalWidth,
        height: n.naturalHeight,
      })),
    );
  checks.push({
    name: "Original selected cover renders from managed local media",
    images: loadedImages,
  });
  await shot("original-work-native");
  for (const variant of ["A", "B"]) {
    await page
      .getByRole("button", { name: "▷ 试听 " + variant, exact: true })
      .click();
    await expect
      .poll(() => page.locator("audio").evaluate((a) => a.currentTime))
      .toBeGreaterThan(1.2);
    const result = await page
      .locator("audio")
      .evaluate((a) => ({
        src: a.currentSrc,
        duration: a.duration,
        currentTime: a.currentTime,
        paused: a.paused,
        readyState: a.readyState,
        error: a.error?.code ?? null,
        muted: a.muted,
        volume: a.volume,
      }));
    assert(result.src.startsWith("media://asset/"));
    assert(Number.isFinite(result.duration) && result.duration > 10);
    assert.equal(result.error, null);
    assert.equal(result.paused, false);
    media.push({ variant, ...result });
    await shot("original-" + variant + "-playing-native");
    await page.locator("audio").focus();
    await page.locator("audio").press("Space");
    await expect
      .poll(() => page.locator("audio").evaluate((a) => a.paused))
      .toBe(true);
  }
  checks.push({
    name: "Both actual managed A/B audio decode, advance playback and pause",
    media,
    humanAudioJudgment: false,
  });
  await page.getByRole("button", { name: "发布中心", exact: true }).click();
  const content = await page.locator("#content").innerText();
  for (const text of ["指纹", "执行器", "不代表官网保存"])
    assert.equal(content.includes(text), false);
  assert(content.includes("待条款确认"));
  checks.push({
    name: "Concise publishing page keeps pending terms visible, without accepting or submitting",
  });
  await shot("publish-real-terms-native");
  const after = await call("snapshot");
  afterHash = digest(stable(after));
  assert.equal(afterHash, beforeHash);
  checks.push({
    name: "Original works/assets/accounts/artists/platform defaults/publish selection unchanged",
    beforeHash,
    afterHash,
  });
  for (const [w, h] of [
    [1280, 800],
    [1000, 700],
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, size) =>
        BrowserWindow.getAllWindows()[0].setContentSize(size.w, size.h),
      { w, h },
    );
    await page.getByRole("button", { name: "创作中心", exact: true }).click();
    await layout(w + "x" + h);
    const bounds = await version().boundingBox(),
      player = await page.locator("footer").boundingBox();
    assert(bounds.y + bounds.height < player.y);
    await shot("creation-" + w + "x" + h + "-native");
  }
  assert.equal(errors.length, 0);
  assert.equal(await app.evaluate(() => globalThis.__qaBlockedHttp), 0);
  assert.equal(await app.evaluate(() => globalThis.__qaBlockedNative), 0);
  const child = app.process();
  const closed = new Promise((resolve) =>
    child.once("exit", (code) => resolve(code)),
  );
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].close(),
  );
  assert.equal(
    await withTimeout(() => closed, 15000, "NORMAL_WINDOW_CLOSE_TIMEOUT"),
    0,
  );
  app = null;
  run.exitCode = 0;
  await closeDesktopRun(null, run);
  checks.push({
    name: "Normal native window close exits 0; local lifecycle and Windows events clear",
  });
  const report = {
    passed: true,
    at: new Date().toISOString(),
    executable: pkg.executable,
    sourceCommit: pkg.sourceCommit,
    version: pkg.version,
    dataRoot: backup.dataRoot,
    fixtureBridge: false,
    runtime: { appVersion: runtime.appVersion, packaged: runtime.packaged },
    checks,
    screens,
    rendererErrors: errors,
    run,
    realGeneration: 0,
    formalPublication: 0,
    acceptedTerms: false,
    externalHttpAttempts: 0,
    originalDataPreserved: true,
  };
  fs.writeFileSync(
    path.join(out, "native-verification.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        passed: true,
        checks: checks.length,
        screens,
        version: pkg.version,
        pid: run.pid,
      },
      null,
      2,
    ),
  );
} catch (error) {
  let cleanupError;
  try {
    if (app) {
      await closeDesktopRun(app, run);
      app = null;
    }
  } catch (e) {
    cleanupError = String(e);
  }
  fs.writeFileSync(
    path.join(out, "native-verification.json"),
    JSON.stringify(
      {
        passed: false,
        error: String(error),
        cleanupError,
        checks,
        screens,
        errors,
        run,
      },
      null,
      2,
    ),
  );
  throw error;
}
