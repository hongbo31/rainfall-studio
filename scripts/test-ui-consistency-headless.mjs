// Actual built renderer in headless Chrome; synthetic bridge and isolated fixture, no Electron or desktop input.
import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import electronPath from "electron";
import { auditDeepCopy } from "./lib/deep-copy-audit.mjs";
const out = path.resolve(process.env.RAINFALL_UI_QA_OUTPUT ?? "output/ui-consistency");
const fixtureFile=path.resolve("output/ui-consistency/visual-fixture.json");
const uiRoot = path.resolve(process.argv[2] ?? "build/ui");
const appMetadata = JSON.parse(
  fs.readFileSync(path.resolve(uiRoot, "../../package.json"), "utf8"),
);
fs.mkdirSync(out, { recursive: true });
if (!fs.existsSync(fixtureFile)) {
  const seed = spawnSync(
    electronPath,
    ["scripts/seed-ui-consistency-fixture.cjs"],
    {
      stdio: "inherit",
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    },
  );
  assert.equal(seed.status, 0, "Isolated fixture seed failed");
}
const fixture = JSON.parse(
  fs.readFileSync(fixtureFile, "utf8"),
);
const server = http.createServer((req, res) => {
  const file = path.resolve(
    uiRoot,
    "." + decodeURIComponent(req.url.split("?")[0]),
  );
  if (!file.startsWith(uiRoot + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const stat = fs.statSync(file);
    const target = stat.isDirectory() ? path.join(file, "index.html") : file;
    res.setHeader(
      "content-type",
      target.endsWith(".js")
        ? "text/javascript"
        : target.endsWith(".css")
          ? "text/css"
          : "text/html",
    );
    res.end(fs.readFileSync(target));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = "http://127.0.0.1:" + server.address().port;
let browser;
const checks = [],
  screens = [],
  errors = [],
  external = [],
  calls = [];
try {
  browser = await chromium.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    args: [
      "--no-startup-window",
      "--disable-background-networking",
      "--disable-sync",
    ],
    timeout: 20000,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  });
  await context.route("**/*", (r) => {
    const u = r.request().url();
    if (u.startsWith(origin + "/")) return r.continue();
    external.push(u);
    return r.abort();
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(
    ({ fixture, appVersion }) => {
      const clone = () => structuredClone(fixture);
      const empty = {
        sessions: [],
        turns: [],
        drafts: [],
        evaluations: [],
        plans: [],
        runs: [],
        jobs: [],
        grants: [],
        batches: [],
        units: [],
        requests: [],
        receipts: [],
        profiles: [],
        occurrences: [],
        operations: [],
        candidates: [],
        artifacts: [],
        approvals: [],
        reasons: [],
        capabilities: [],
        configuration: null,
      };
      const ok = (value) => ({ ok: true, value });
      window.__fixtureCalls = [];
      window.rainfall = {
        call: async (method, input) => {
          window.__fixtureCalls.push(method);
          if (method === "snapshot") return ok(clone());
          if (method === "runtime")
            return ok({
              appVersion,
              versions: {},
              packaged: true,
            });
          if (["apiProfile.list", "textConfig.list"].includes(method))
            return ok([]);
          if (["tme.list","tme.observations"].includes(method)) return ok([]);
          if(method==='tme.batches') return ok({batches:[],units:[]});
          if (method === "lyrics.preview") {
            const w = fixture.works.find((w) => w.id === input.workId);
            return ok({
              raw: w.lyrics,
              cleaned: w.lyrics,
              source: { kind: "legacy_unknown" },
              removed: [],
              warnings: [],
              versions: [],
              audioHash: null,
              alignmentConfirmed: false,
            });
          }
          if (method === "publication.payload") {
            const w = fixture.works.find((w) => w.id === input.workId);
            return ok({
              workId: w.id,
              workRevision: w.revision,
              audio: null,
              cover: null,
              lyrics: { plainText: w.lyrics, alignmentConfirmed: false },
              warnings: [],
            });
          }
          if (method === "platformConfig.list")
            return ok(fixture.platformConfigurations);
          if (method === "publish.selection.save") return ok(input);
          if (method.endsWith(".list") || method === "conversation.list")
            return ok(structuredClone(empty));
          return ok(structuredClone(empty));
        },
        apiCredentialStatus: async () =>
          ok({ configured: false, status: "absent" }),
        productionFlow: async () => ok(structuredClone(empty)),
        liveText: async () => ok([]),
        liveMusic: async () => ok(structuredClone(empty)),
        tmeAiPrepare: async () => ok(structuredClone(empty)),
        tmeLive: async () => ok(structuredClone(empty)),
        setMode: async () => ({
          ok: false,
          error: { message: "视觉样本禁止切换真实库" },
        }),
        pickImport: async () => {
          throw Error("FIXTURE_NATIVE_DIALOG_BLOCKED");
        },
        exportFile: async () => {
          throw Error("FIXTURE_NATIVE_DIALOG_BLOCKED");
        },
        openOfficial: async () => {
          throw Error("FIXTURE_EXTERNAL_BLOCKED");
        },
      };
    },
    { fixture, appVersion: appMetadata.version },
  );
  await page.goto(origin + "/index.html");
  const userAgent = await page.evaluate(() => navigator.userAgent);
  assert(
    userAgent.includes("HeadlessChrome"),
    "A genuinely headless browser is required",
  );
  await page.getByRole("button", { name: "作品库", exact: true }).click();
  await page.getByRole("textbox", { name: "搜索作品", exact: true }).waitFor();
  const versionLabel = page.getByLabel("客户端版本", { exact: true });
  await expect(versionLabel).toHaveText("v" + appMetadata.version);
  await expect(versionLabel).toBeVisible();
  const versionStyle = await versionLabel.evaluate((n) => ({
    font: getComputedStyle(n).fontSize,
    color: getComputedStyle(n).color,
  }));
  assert.equal(versionStyle.font, "12px");
  checks.push({
    name: "Sidebar version reflects package-provided runtime fixture metadata with v prefix",
    packageVersion: appMetadata.version,
    versionStyle,
    fixtureBridge: true,
  });
  const header = await page.locator(".header-right > *").evaluateAll((nodes) =>
    nodes.map((n) => {
      const s = getComputedStyle(n),
        r = n.getBoundingClientRect();
      return {
        tag: n.tagName,
        height: r.height,
        y: r.y,
        font: s.fontSize,
        padding: s.padding,
        line: s.lineHeight,
      };
    }),
  );
  assert.equal(header.length, 3);
  assert(
    header.every((x) => x.height === 36),
    "header heights differ: " + JSON.stringify(header),
  );
  assert(
    header.every((x) => x.font === "13px"),
    "header font sizes differ",
  );
  assert.equal(new Set(header.map((x) => x.y)).size, 1);
  checks.push({
    name: "Header status, workspace select and backup button align at 36px/13px",
    measurements: header,
  });
  await expect(page.locator(".page-head h1")).toHaveText("作品库");
  assert.equal(await page.locator(".page-head .eyebrow").count(), 0);
  checks.push({
    name: "Library uses compact title and no decorative English heading",
  });
  const toolbar = await page.locator(".toolbar > *").evaluateAll((nodes) =>
    nodes.map((n) => ({
      height: n.getBoundingClientRect().height,
      font: getComputedStyle(n).fontSize,
    })),
  );
  assert(
    toolbar.every((x) => x.height === 40 && x.font === "14px"),
    JSON.stringify(toolbar),
  );
  checks.push({
    name: "Library filters and selection button share 40px/14px",
    measurements: toolbar,
  });
  async function shot(name) {
    if (name !== "keyboard-help-headless")
      await page.evaluate(() => {
        window.scrollTo(0, 0);
        return new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
      });
    await page.evaluate(() => {
      if (!document.querySelector("#qa-watermark")) {
        const tag = document.createElement("div");
        tag.id = "qa-watermark";
        tag.textContent = "无头渲染 · 演示数据 · 非桌面运行";
        tag.style.cssText =
          "position:fixed;right:12px;bottom:92px;background:#32253d;color:#ead8fa;font:12px Segoe UI;padding:5px 9px;border:1px solid #8e70a3;border-radius:6px;z-index:999;pointer-events:none";
        document.body.append(tag);
      }
    });
    const file = path.join(out, name + ".png");
    await page.screenshot({ path: file, fullPage: false });
    screens.push(file);
  }
  await shot("01-library-headless");
  await page
    .getByRole("textbox", { name: "搜索作品", exact: true })
    .fill("那天刚好下雨");
  await expect(page.locator(".work-card")).toHaveCount(1);
  await page.getByRole("textbox", { name: "搜索作品", exact: true }).fill("");
  await expect(page.locator(".work-card")).toHaveCount(fixture.works.length);
  checks.push({
    name: "Library filtering preserves actual page behavior on fixture data",
  });
  const libraryControls = await page
    .locator(".work-card button,.page-head button.primary,.form-grid input")
    .evaluateAll((ns) =>
      ns.map((n) => ({
        height: n.getBoundingClientRect().height,
        font: getComputedStyle(n).fontSize,
        family: getComputedStyle(n).fontFamily,
      })),
    );
  assert(libraryControls.every((x) => x.height === 40 && x.font === "14px"));
  assert.equal(new Set(libraryControls.map((x) => x.family)).size, 1);
  const hierarchy = await page
    .locator("h1,h2,h3")
    .evaluateAll((ns) =>
      ns.map((n) => ({ tag: n.tagName, size: getComputedStyle(n).fontSize })),
    );
  assert(
    hierarchy.every(
      (x) => x.size === { H1: "28px", H2: "18px", H3: "16px" }[x.tag],
    ),
  );
  checks.push({
    name: "Create, card playback and series fields share sizing and font while headings retain hierarchy",
    libraryControls,
    hierarchy,
  });
  await page.locator('.work-card [role="button"]').first().click();
  await expect(page.locator(".page-head h1")).toHaveText(
    fixture.works[0].title,
  );
  await expect(page.getByTestId("lyrics-publication")).toBeVisible();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await shot("作品详情-headless");
  checks.push({
    name: "Work detail, A/B controls and lyric preview render from fixture with no write or playback",
  });
  for (const [nav, title] of [
    ["总览", "总览"],
    ["本地模板", "本地模板"],
    ["封面工作室", "封面工作室"],
    ["发布中心", "发布中心"],
    ["数据看板", "数据看板"],
    ["配置中心", "配置中心"],
    ["AI 聊天创作", "AI 聊天创作"],
  ]) {
    await page.getByRole("button", { name: nav, exact: true }).first().click();
    await expect(page.locator(".page-head h1").first()).toHaveText(title);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      nav + " overflow",
    );
    await shot(nav + "-headless");
    checks.push({ name: nav + " renders without horizontal overflow" });
  }
  const feeHelp = page.getByRole("button", { name: "费率参考", exact: true });
  await feeHelp.scrollIntoViewIfNeeded();
  await feeHelp.focus();
  const feePopup = page.getByRole("tooltip").filter({ visible: true });
  await expect(feePopup).toBeVisible();
  const feeBox = await feePopup.boundingBox();
  const triggerBox = await feeHelp.boundingBox();
  assert(
    feeBox.x >= 12 &&
      feeBox.y >= 12 &&
      feeBox.x + feeBox.width <= 1440 - 12 &&
      feeBox.y + feeBox.height <= 1000 - 80,
    "HelpNote escapes safe viewport: " + JSON.stringify({ feeBox, triggerBox }),
  );
  assert(
    triggerBox.y + triggerBox.height <= 920,
    "focused help is obscured by player",
  );
  await shot("keyboard-help-headless");
  await page.keyboard.press("Escape");
  const noteBounds = [];
  for (const note of await page.locator(".help-note-trigger").filter({visible:true}).all()) {
    await note.scrollIntoViewIfNeeded();
    await note.focus();
    await expect
      .poll(async () => {
        const r = await note.boundingBox();
        return r.y >= 0 && r.y + r.height <= 920;
      })
      .toBe(true);
    const popup = page.getByRole("tooltip").filter({ visible: true });
    await expect(popup).toBeVisible();
    const box = await popup.boundingBox(),
      anchor = await note.boundingBox();
    const name = await note.innerText();
    assert(
      box.x >= 12 &&
        box.y >= 12 &&
        box.x + box.width <= 1428 &&
        box.y + box.height <= 920,
      name + " tooltip outside viewport",
    );
    assert(
      anchor.y >= 0 && anchor.y + anchor.height <= 920,
      name + " trigger behind player: " + JSON.stringify({ anchor, box }),
    );
    noteBounds.push({ name, box, anchor });
    await page.keyboard.press("Escape");
  }
  const bottomNote = page.getByRole("button", {
    name: "文本任务说明",
    exact: true,
  });
  await bottomNote.evaluate((button) => {
    button.blur();
    window.scrollBy(0, button.getBoundingClientRect().top - (innerHeight - 38));
  });
  await bottomNote.focus();
  await expect
    .poll(async () => {
      const r = await bottomNote.boundingBox();
      return r.y + r.height <= 920;
    })
    .toBe(true);
  const bottomAnchor = await bottomNote.boundingBox(),
    bottomPopup = await page
      .getByRole("tooltip")
      .filter({ visible: true })
      .boundingBox();
  assert(bottomAnchor.y + bottomAnchor.height <= 920);
  assert(bottomPopup.y >= 12 && bottomPopup.y + bottomPopup.height <= 920);
  await page.keyboard.press("Escape");
  checks.push({
    name: "Keyboard HelpNote stays within viewport and above fixed player",
    feeBox,
    triggerBox,
    noteBounds,
    bottomAnchor,
    bottomPopup,
  });
  await page.getByRole("button", { name: "配置中心", exact: true }).click();
  const help = page.getByRole("button", { name: "平台说明", exact: true });
  await help.focus();
  await expect(
    page.getByRole("tooltip").filter({ visible: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip").filter({ visible: true })).toHaveCount(
    0,
  );
  checks.push({ name: "Keyboard help opens on focus and dismisses on Escape" });
  const scrollBefore = await page.evaluate(() => scrollY);
  await page.getByRole("button", { name: "试听说明", exact: true }).focus();
  await expect(
    page.getByRole("tooltip").filter({ visible: true }),
  ).toBeVisible();
  const playerHelpBox = await page
    .getByRole("tooltip")
    .filter({ visible: true })
    .boundingBox();
  assert(
    playerHelpBox.y >= 12 && playerHelpBox.y + playerHelpBox.height <= 920,
    "Player help escapes viewport: " + JSON.stringify(playerHelpBox),
  );
  assert.equal(await page.evaluate(() => scrollY), scrollBefore);
  await page.keyboard.press("Escape");
  checks.push({
    name: "Player help stays above the player without scrolling the page",
    playerHelpBox,
  });
  for (const size of [
    { width: 1280, height: 800 },
    { width: 960, height: 800 },
  ]) {
    await page.setViewportSize(size);
    await page.getByRole("button", { name: "作品库", exact: true }).click();
    await expect(versionLabel).toBeVisible();
    const bounds = await versionLabel.boundingBox();
    assert(
      bounds.y >= 0 && bounds.y + bounds.height <= size.height - 80,
      "Version hidden behind player at " + size.width,
    );
    const side = await page.locator("aside").boundingBox();
    assert(
      bounds.x >= side.x && bounds.x + bounds.width <= side.x + side.width,
      "Version overflows sidebar",
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      JSON.stringify(size),
    );
    await shot("library-" + size.width + "-headless");
    checks.push({
      name: "Library has no horizontal overflow at " + size.width,
    });
  }
  if(process.env.RAINFALL_DEEP_COPY_AUDIT==='1'){
    await page.setViewportSize({width:1440,height:1000});
    checks.push(...await auditDeepCopy(page,out,{verify:process.env.RAINFALL_COPY_BASELINE!=='1'}));
  }
  calls.push(...(await page.evaluate(() => window.__fixtureCalls)));
  assert.equal(external.length, 0);
  assert.equal(errors.length, 0, errors.join("; "));
  assert(!calls.some((x) => /generate|execute|submit|publish.simple/.test(x)));
  const report = {
    passed: true,
    kind: "headless-built-renderer-with-isolated-fixture",
    desktopAcceptance: false,
    visibleWindowsOpened: false,
    uiRoot,
    userAgent,
    versionPresentation: {
      packageVersion: appMetadata.version,
      displayed: "v" + appMetadata.version,
      fixtureBridge: true,
    },
    uiFiles: fs
      .readdirSync(uiRoot, { recursive: true })
      .filter((f) => fs.statSync(path.join(uiRoot, f)).isFile())
      .map((f) => ({
        path: f,
        sha256: crypto
          .createHash("sha256")
          .update(fs.readFileSync(path.join(uiRoot, f)))
          .digest("hex"),
      })),
    checks,
    screens,
    errors,
    externalRequests: external.length,
    bridgeCalls: calls,
  };
  fs.writeFileSync(
    path.join(out, "headless-verification.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({ passed: true, checks: checks.length, screens }, null, 2),
  );
} catch (e) {
  fs.writeFileSync(
    path.join(out, "headless-verification.json"),
    JSON.stringify(
      {
        passed: false,
        kind: "headless-built-renderer-with-isolated-fixture",
        desktopAcceptance: false,
        visibleWindowsOpened: false,
        checks,
        screens,
        errors,
        external,
        error: String(e),
      },
      null,
      2,
    ),
  );
  throw e;
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
