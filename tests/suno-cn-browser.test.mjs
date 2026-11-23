import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import sharp from "sharp";
import { headlessChromiumOptions, launchHeadlessChromium } from "../scripts/lib/headless-chromium.mjs";

const bundle = path.resolve("output/suno-cn-browser-test.cjs");
await build({ stdin: { resolveDir: process.cwd(), contents: `
  export { runSunoCnBrowser } from './src/main/suno-cn-browser-page';
  export { createPuleBrowserJobs } from './src/main/pule-browser';
  export { PlatformBrowserSessions } from './src/main/browser-accounts';
  export { platformPageUrls, sunoCnOrigin } from './src/shared/platform-directory';
` }, bundle: true, platform: "node", format: "cjs", packages: "external", outfile: bundle });
const { runSunoCnBrowser, createPuleBrowserJobs, PlatformBrowserSessions, platformPageUrls, sunoCnOrigin } = createRequire(import.meta.url)(bundle);
const html = await fs.readFile(new URL("./fixtures/suno-cn-browser.html", import.meta.url), "utf8");

for (const scenario of ["vocal", "instrumental", "long-cover-prompt", "cover-rejection", "wav-label-variant", "wav-menu-missing", "wav-menu-retry-b",
  "wav-menu-shared-budget", "wav-menu-replaced-b", "wav-menu-stop-b", "wav-prepare-timeout",
  "wav-prepare-rejected", "wav-download-not-started", "unchanged", "signed-out", "account-origin", "login-hydration", "layout-overflow", "generation-repaint", "already-pending",
  "submit-blocked", "vocal-conflict", "insufficient-credits"]) {
  test(`苏诺之音 ${scenario} uses scoped controls and archives only the confirmed pair`, async t => {
    const browser = await launchHeadlessChromium(chromium);
    t.after(() => browser.close());
    const context = await browser.newContext({ acceptDownloads: true });
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "rainfall-suno-cn-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const archiveRoot = path.join(root, "归档");
    await fs.mkdir(archiveRoot);
    const page = await context.newPage();
    const navigations = [], traces = [];
    const invite = new URL(platformPageUrls.suno_cn);
    const creation = sunoCnOrigin + "/home/#/create?from=invite&invite_id=11619989&model=suno";
    await context.route("**/*", async route => {
      const url = route.request().url();
      if (scenario === "vocal" && url === invite.origin + "/home/") {
        await route.fulfill({ contentType: "text/html", body: `<script>location.replace(${JSON.stringify(creation)})</script>` });
      } else if (route.request().resourceType() === "document" && [invite.origin, sunoCnOrigin].some(origin => url === origin + "/home/")) {
        const state = scenario === "account-origin" && url.startsWith(invite.origin + "/") ? "signed-out" : scenario;
        await route.fulfill({ contentType: "text/html", body: html.replace("SCENARIO", state) });
      } else await route.abort();
    });
    page.on("framenavigated", frame => { if (frame === page.mainFrame()) navigations.push(frame.url()); });
    page.on("console", message => { if (message.text().startsWith("fixture:")) traces.push(JSON.parse(message.text().slice(8))); });
    page.on("pageerror", error => { traces.push(error.message); });

    const cover = await sharp({ create: { width: 800, height: 800, channels: 3, background: "#222244" } }).png().toBuffer();
    const coverPrompts = [];
    const coverProfiles = [];
    const selectedCover = scenario === "cover-rejection" ? {
      profileId: randomUUID(), expectedRevision: 1, providerId: "zhipu_image", modelId: "glm-image",
    } : undefined;
    let pageRuns = 0, stopRequested = false;
    const jobs = createPuleBrowserJobs({
      root, provider: "suno_cn", captureWorkspace: () => () => {}, chooseAudio: async () => null,
      scope: async (_accountId, _artistId, _publication, coverImage) => ({ accountName: "账号", gender: "female", timbre: "小川",
        timbreWeight: 0, styleWeight: 63.4, songType: scenario === "instrumental" ? "instrumental" : "vocal",
        archiveRoot, archiveFolderNames: { A: "账号_甲_引擎", B: "账号_乙_引擎" }, singers: { A: "甲", B: "乙" },
        coverProfile: coverImage ? { profileId: coverImage.profileId, expectedRevision: coverImage.expectedRevision, modelId: coverImage.modelId }
          : { profileId: randomUUID(), expectedRevision: 1 } }),
      coverScope: async (folders, choice) => {
        assert.equal(folders, undefined);
        const { expectedRevision, ...image } = selectedCover;
        assert.deepEqual(choice, image);
        return { archiveRoot, coverProfile: { profileId: image.profileId, expectedRevision: expectedRevision + 1, modelId: image.modelId } };
      },
      credentials: { apiCredentialStatus: async () => ({ configured: true }),
        generatePlanCover: async (profile, prompt, before) => {
          await before();
          coverProfiles.push(profile);
          coverPrompts.push(prompt);
          if (scenario === "cover-rejection" && coverPrompts.length === 1) throw Error("IMAGE_HTTP_400", { cause: "1301" });
          if (Array.from(prompt).length > 256 || Buffer.byteLength(prompt) > 900) throw Error("IMAGE_HTTP_400");
          return cover;
        } },
      withPage: async (_id, _signal, run) => { pageRuns++; await run(page); },
      run: (page, input, hooks) => runSunoCnBrowser(page, input, {
        ...hooks,
        guard: () => {
          if (scenario === "wav-menu-stop-b" && traces.includes("menu:B:1") && !stopRequested) {
            stopRequested = true;
            jobs.stop({ id: jobs.status()[0].id });
          }
          return hooks.guard();
        },
        beforeCharge: async (...args) => {
          await hooks.beforeCharge(...args);
          if (scenario === "submit-blocked") await page.locator(".suno-custom-create-action").evaluate(button => { button.disabled = true; });
        },
      }, { control: scenario.startsWith("wav-menu-") ? 600 : 2000, generation: 2200, download: 3600, downloadStart: 550, poll: 30 }),
    });
    const instrumental = scenario === "instrumental";
    const title = scenario === "unchanged" ? "旧歌" : "窗边的灯";
    const lyrics = scenario === "long-cover-prompt" ? "[Verse]\n我在窗边等你\n" + "雨滴落在窗台上\n".repeat(93) : "我在窗边等你";
    const style = scenario === "long-cover-prompt" ? "怀旧慢板，老电影的褪色光影".repeat(40) : "怀旧慢板";
    const input = { requestId: randomUUID(), accountId: randomUUID(), artistId: randomUUID(), mode: "custom", title,
      alternateTitle: "灯外的雨", lyrics: instrumental ? "" : lyrics, style, instrumental,
      ...(selectedCover && { coverImage: selectedCover }) };
    await jobs.start(input);
    for (let attempt = 0; attempt < 160 && jobs.status()[0]?.status === "running"; attempt++) await delay(40);
    const job = jobs.status()[0];
    if (scenario === "account-origin" || scenario === "login-hydration") assert.equal(job.status, "completed", job.code);
    assert.equal(navigations[0], creation);
    if (scenario === "signed-out" || scenario === "already-pending") {
      assert.equal(job.status, "failed");
      assert.equal(job.code, scenario === "signed-out" ? "SUNO_CN_LOGIN_REQUIRED" : "SUNO_CN_EXISTING_GENERATION");
      assert.equal(job.chargeAttempts, undefined);
      assert.deepEqual(traces, []);
      return;
    }
    if (scenario === "submit-blocked") {
      assert.equal(job.status, "needs_review");
      assert.equal(job.code, "SUNO_CN_SUBMIT_UNCONFIRMED");
      assert.deepEqual(job.chargeAttempts, [{ kind: "generation" }]);
      assert.deepEqual(traces, []);
      assert.deepEqual(job.files, []);
      return;
    }
    if (scenario === "vocal-conflict" || scenario === "insufficient-credits") {
      assert.equal(job.status, "failed");
      assert.equal(job.code, scenario === "vocal-conflict" ? "SUNO_CN_VOCAL_STYLE_CONFLICT" : "SUNO_CN_INSUFFICIENT_CREDITS");
      assert.deepEqual(traces, ["preflight"]);
      assert.deepEqual(job.files, []);
      return;
    }
    if (scenario === "layout-overflow")
      assert.equal(await page.locator(".main-shell").getAttribute("data-scroll-after-mode"), "0,0");
    assert.deepEqual(traces[0], { title, lyrics: input.lyrics, style: input.style, instrumental,
      voice: instrumental ? "随机" : "女声", timbre: instrumental ? "" : "小川", weights: instrumental ? [25, 50] : [0, 63] });
    if (scenario === "unchanged") {
      assert.equal(job.status, "needs_review");
      assert.equal(job.code, "SUNO_CN_FIRST_TITLE_UNCHANGED");
      assert.equal(job.files.length, 0);
      assert.equal(coverPrompts.length, 0);
      return;
    }
    if (scenario === "wav-menu-missing" || scenario === "wav-menu-shared-budget") {
      assert.equal(job.status, "needs_review");
      assert.equal(job.code, "SUNO_CN_WAV_MENU_UNAVAILABLE");
      assert.deepEqual(job.chargeAttempts, [{ kind: "generation" }]);
      assert.deepEqual(job.songIds, [input.requestId + ":A", input.requestId + ":B"]);
      assert.deepEqual(traces.slice(1), scenario === "wav-menu-missing"
        ? ["rename:B:灯外的雨", "menu:A:1", "menu:A:2", "menu:A:3", "menu:A:4"]
        : ["rename:B:灯外的雨", "menu:A:1", "menu:A:2", "prepare:A:1", "menu:A:3", "prepare:A:2", "download:A", "menu:A:4"]);
      assert.equal(job.files.length, 0);
      assert.equal(coverPrompts.length, 0);
      return;
    }
    if (scenario === "wav-menu-replaced-b" || scenario === "wav-menu-stop-b") {
      assert.equal(job.status, "needs_review");
      assert.equal(job.code, scenario === "wav-menu-replaced-b" ? "SUNO_CN_RESULT_UNCLEAR" : "PULE_STOPPED");
      assert.deepEqual(job.chargeAttempts, [{ kind: "generation" }]);
      assert.deepEqual(job.songIds, [input.requestId + ":A", input.requestId + ":B"]);
      assert.deepEqual(job.files.map(file => file.version), ["A"]);
      assert.deepEqual(traces.slice(1), ["rename:B:灯外的雨", "menu:A:1", "download:A", "menu:B:1"]);
      assert.equal(coverPrompts.length, 0);
      return;
    }
    if (scenario === "wav-prepare-rejected") {
      assert.equal(job.status, "needs_review");
      assert.equal(job.code, "SUNO_CN_WAV_PREPARE_FAILED");
      assert.deepEqual(traces.slice(1), ["rename:B:灯外的雨", "prepare:A:1"]);
      assert.deepEqual(job.chargeAttempts, [{ kind: "generation" }]);
      assert.equal(job.files.length, 0);
      return;
    }
    if (scenario === "cover-rejection") {
      assert.equal(job.status, "needs_review");
      assert.equal(job.code, "PULE_COVER_HTTP_400");
      assert.equal(job.coverErrorCode, "1301");
      assert.deepEqual(job.files.map(file => file.version), ["A", "B"]);
      assert.deepEqual(job.coverAttempts, ["A"]);
      assert.deepEqual(job.coverImage, { providerId: "zhipu_image", modelId: "glm-image" });
      await jobs.retryCovers({ id: job.id });
      for (let attempt = 0; attempt < 100 && jobs.status()[0].status === "running"; attempt++) await delay(20);
      const retried = jobs.history()[0];
      assert.equal(retried.status, "completed", retried.code);
      assert.equal(pageRuns, 1);
      assert.equal(coverPrompts[1], coverPrompts[0]);
      assert.match(coverPrompts[2], /《灯外的雨》.*乙/u);
      assert.deepEqual(coverProfiles.map(profile => [profile.profileId, profile.expectedRevision, profile.modelId]),
        [1, 2, 2].map(revision => [selectedCover.profileId, revision, selectedCover.modelId]));
      assert.ok(retried.files.every(file => file.cover?.path === file.path.replace(/\.wav$/u, ".png")));
      return;
    }
    assert.equal(job.status, "completed", `${job.code ?? ""} ${JSON.stringify(traces)}`);
    assert.deepEqual(job.chargeAttempts, [{ kind: "generation" }]);
    const downloadTrace = scenario === "wav-menu-retry-b"
      ? ["menu:A:1", "download:A", "menu:B:1", "menu:B:2", "menu:B:3", "menu:B:4", "download:B"]
      : scenario === "wav-prepare-timeout"
      ? ["prepare:A:1", "prepare:A:2", "download:A", "prepare:B:1", "download:B"]
      : scenario === "wav-download-not-started" ? ["download:A", "download:A", "download:B"] : ["download:A", "download:B"];
    assert.deepEqual(traces.slice(1), ["rename:B:灯外的雨", ...downloadTrace]);
    assert.deepEqual(job.files.map(file => file.name), [title + ".wav", input.alternateTitle + ".wav"]);
    for (const [index, file] of job.files.entries()) {
      const folder = ["账号_甲_引擎", "账号_乙_引擎"][index];
      const recording = path.parse(file.path);
      assert.equal(recording.dir, path.join(archiveRoot, folder));
      assert.equal(await fs.readFile(file.lyrics.path, "utf8"), input.lyrics);
      assert.equal(file.cover.path, path.join(recording.dir, recording.name + ".png"));
    }
    assert.equal(coverPrompts.length, 2);
    assert.notEqual(coverPrompts[0], coverPrompts[1]);
    if (scenario === "long-cover-prompt") {
      for (const prompt of coverPrompts) assert.match(prompt, /我在窗边等你/u);
    }
  });
}

test("苏诺任务使用同一账号的持久登录会话，并各自拥有浏览器窗口", { timeout: 12_000 }, async t => {
  const temp = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(temp, "rainfall-suno-task-windows-"));
  const official = sunoCnOrigin + "/home/";
  const route = context => context.route("**/*", request => request.request().url() === official
    ? request.fulfill({ contentType: "text/html", body: "<h1>本地账号网页替身</h1>" }) : request.abort());
  let accountContext;
  const sessions = new PlatformBrowserSessions(root, async profile => {
    accountContext = await chromium.launchPersistentContext(profile, headlessChromiumOptions(chromium));
    await route(accountContext);
    return accountContext;
  }, async (_provider, storageState) => {
    const browser = await launchHeadlessChromium(chromium);
    const context = await browser.newContext({ storageState });
    await route(context);
    return { context, close: () => browser.close() };
  });
  t.after(async () => {
    await sessions.close();
    assert.equal(path.dirname(await fs.realpath(root)), temp);
    await fs.rm(root, { recursive: true, force: true, maxRetries: 3 });
  });
  const account = { id: randomUUID(), name: "测试账号", provider: "suno_cn", dailyLimit: 1 };
  await sessions.open(account, official, () => {});
  const accountPage = accountContext.pages()[0];
  await accountPage.evaluate(() => localStorage.setItem("fixture-login", "current"));

  const scopes = [randomUUID(), randomUUID()].map(runId => ({ runId, accountId: account.id, provider: account.provider }));
  const signal = new AbortController().signal;
  const firstReady = Promise.withResolvers();
  const finish = Promise.withResolvers();
  const first = sessions.withTaskMusicPage(scopes[0], signal, async page => {
    await page.goto(official);
    assert.equal(await page.evaluate(() => localStorage.getItem("fixture-login")), "current");
    await page.evaluate(() => {
      localStorage.setItem("fixture-login", "renewed");
      sessionStorage.setItem("fixture-page", "A");
    });
    firstReady.resolve(page);
    await finish.promise;
  });
  const windowId = async page => {
    const client = await page.context().newCDPSession(page);
    try { return (await client.send("Browser.getWindowForTarget")).windowId; }
    finally { await client.detach(); }
  };
  try {
    const pageA = await Promise.race([firstReady.promise, first.then(() => assert.fail("missing task window"))]);
    await sessions.withTaskMusicPage(scopes[1], signal, async pageB => {
      await pageB.goto(official);
      assert.equal(await pageB.evaluate(() => localStorage.getItem("fixture-login")), "renewed");
      assert.equal(await pageB.evaluate(() => sessionStorage.getItem("fixture-page")), null);
      assert.notEqual(await windowId(pageA), await windowId(pageB));
      assert.notEqual(await windowId(accountPage), await windowId(pageB));
      await sessions.closeTaskWindow(scopes[0].runId);
      assert.equal(pageA.isClosed(), true);
      assert.equal(pageB.isClosed(), false);
      assert.equal(accountPage.isClosed(), false);
    });
    await sessions.closeTaskWindow(scopes[1].runId);
  } finally {
    finish.resolve();
    await first;
  }
  await sessions.closeAccount(account.id);
  const reopened = { ...scopes[0], runId: randomUUID() };
  await sessions.withTaskMusicPage(reopened, signal, async page => {
    await page.goto(official);
    assert.equal(await page.evaluate(() => localStorage.getItem("fixture-login")), "renewed");
    await sessions.open(account, official, () => {});
    const accountTab = accountContext.pages().find(tab => tab !== page);
    assert.equal(accountTab.url(), official);
    assert.notEqual(await windowId(page), await windowId(accountTab));
  });
});

test("苏诺之音历史封面失败可复用已保存的 WAV 和歌词，补齐缺失的封面", async t => {
  for (const priorCover of [false, true]) await t.test(priorCover ? "保留已生成的 B 版封面" : "恢复两版旧记录", async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "rainfall-suno-cover-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const archiveRoot = path.join(root, "归档");
    const journalRoot = path.join(root, "runtime", "suno-cn-browser-jobs");
    await fs.mkdir(journalRoot, { recursive: true });
    const wav = Buffer.alloc(48);
    wav.write("RIFF", 0);
    wav.write("WAVE", 8);
    const image = await sharp({ create: { width: 768, height: 768, channels: 3, background: "#222244" } }).png().toBuffer();
    const folders = { A: "账号_甲_引擎", B: "账号_乙_引擎" };
    const songIds = ["saved-a", "saved-b"];
    const files = await Promise.all(["窗边的灯", "灯外的雨"].map(async (title, index) => {
      const version = index ? "B" : "A";
      const parent = path.join(archiveRoot, folders[version]);
      const directory = index ? path.join(parent, title + " (2)") : parent;
      await fs.mkdir(directory, { recursive: true });
      const saved = extension => ({ path: path.join(directory, title + extension), name: title + extension });
      const file = { ...saved(".wav"), version, songId: songIds[index], lyrics: saved(".txt") };
      await Promise.all([fs.writeFile(file.path, wav), fs.writeFile(file.lyrics.path, "我在窗边等你")]);
      if (priorCover && index) {
        file.cover = saved(".png");
        await fs.writeFile(file.cover.path, image);
      }
      return file;
    }));
    const id = randomUUID();
    const chargeAttempts = [{ kind: "generation" }];
    const job = { id, accountId: randomUUID(), title: "窗边的灯", status: priorCover ? "running" : "needs_review", step: "cover",
      code: "PULE_COVER_HTTP_400", updatedAt: new Date().toISOString(), files, songIds,
      possibleCharge: "generation", chargeAttempts, coverAttempts: ["A"] };
    const journal = path.join(journalRoot, id + ".json");
    await fs.writeFile(journal, JSON.stringify({ requestHash: "legacy", job }));
    const prompts = [];
    const jobs = createPuleBrowserJobs({ root, provider: "suno_cn", captureWorkspace: () => () => {},
      coverScope: async requestedFolders => {
        assert.deepEqual(requestedFolders, folders);
        return { archiveRoot, coverProfile: { profileId: randomUUID(), expectedRevision: 1 },
          coverResolution: 1440, singers: { A: "甲", B: "乙" } };
      },
      scope: async () => assert.fail("cover recovery must not start song generation"),
      withPage: async () => assert.fail("cover recovery must not open a Suno page"),
      credentials: { apiCredentialStatus: async () => ({ configured: true }),
        generatePlanCover: async (_profile, prompt, before) => { await before(); prompts.push(prompt); return image; } },
    });
    const outside = path.join(root, "unrelated.txt");
    await fs.writeFile(outside, "unrelated text");
    await fs.writeFile(journal, JSON.stringify({ requestHash: "legacy", job: { ...job, files: [
      { ...files[0], lyrics: { ...files[0].lyrics, path: outside } }, files[1],
    ] } }));
    await assert.rejects(jobs.retryCovers({ id }), /PULE_COVER_SOURCE_UNAVAILABLE/u);
    assert.deepEqual(prompts, []);
    await fs.writeFile(journal, JSON.stringify({ requestHash: "legacy", job }));
    await jobs.retryCovers({ id });
    for (let attempt = 0; attempt < 100 && jobs.status()[0].status === "running"; attempt++) await delay(20);
    const result = jobs.history()[0];
    assert.equal(result.status, "completed", result.code);
    assert.equal(result.id, id);
    assert.deepEqual(result.chargeAttempts, chargeAttempts);
    assert.deepEqual(result.songIds, songIds);
    assert.equal(prompts.length, priorCover ? 1 : 2);
    assert.match(prompts[0], /窗边的灯.*我在窗边等你/u);
    for (const [index, file] of result.files.entries()) {
      assert.deepEqual(await fs.readFile(file.path), wav);
      assert.equal(await fs.readFile(file.lyrics.path, "utf8"), "我在窗边等你");
      assert.equal(file.cover.path, file.path.replace(/\.wav$/u, ".png"));
      const bytes = await fs.readFile(file.cover.path);
      if (priorCover && index) assert.deepEqual(bytes, image);
      else assert.equal((await sharp(bytes).metadata()).width, 1440);
    }
  });
});
