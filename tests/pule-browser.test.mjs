import assert from "node:assert/strict";
import filesystem from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { Worker } from "node:worker_threads";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import sharp from "sharp";
import { headlessChromiumOptions, launchHeadlessChromium } from "../scripts/lib/headless-chromium.mjs";

const output = path.resolve("output/pule-browser-test/automation.cjs");
await build({
  stdin: { resolveDir: process.cwd(), contents: [
    'export { createPuleBrowserJobs, readPlanPuleWave } from "./src/main/pule-browser";',
    'export { runPuleBrowser } from "./src/main/pule-browser-page";',
    'export { PlatformBrowserSessions, accountBrowserDirectory } from "./src/main/browser-accounts";',
    'export { ApiCredentials } from "./src/main/api-credentials";',
    'export { puleCreateUrl } from "./src/shared/pule-browser";',
    'export { platformAccountLoginUrl, platformPageUrls } from "./src/shared/platform-directory";',
  ].join("\n") },
  outfile: output, bundle: true, platform: "node", format: "cjs", packages: "external",
});
const { createPuleBrowserJobs, readPlanPuleWave, runPuleBrowser, puleCreateUrl, PlatformBrowserSessions, accountBrowserDirectory,
  ApiCredentials, platformAccountLoginUrl, platformPageUrls }
  = createRequire(import.meta.url)(output);
const html = await fs.readFile(new URL("./fixtures/pule-browser.html", import.meta.url), "utf8");
const coverA = await sharp({ create: { width: 512, height: 512, channels: 3, background: "#51209c" } }).jpeg().toBuffer();
const coverB = await sharp({ create: { width: 768, height: 768, channels: 3, background: "#226365" } }).webp().toBuffer();

test("谱乐执行记录读取最近状态窗口之外的已保存任务", async t => {
  const temp = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(temp, "rainfall-pule-history-"));
  t.after(async () => {
    assert.equal(path.dirname(await fs.realpath(root)), temp);
    await fs.rm(root, { recursive: true, force: true });
  });
  const directory = path.join(root, "runtime", "pule-browser-jobs");
  await fs.mkdir(directory, { recursive: true });
  const records = Array.from({ length: 25 }, (_, index) => ({
    id: randomUUID(), accountId: "account", title: "制作 " + index, status: "completed", step: "cover",
    updatedAt: new Date(Date.UTC(2026, 10, 21, 0, index)).toISOString(), files: [],
  }));
  await Promise.all(records.map(async job => {
    const file = path.join(directory, job.id + ".json");
    const time = new Date(job.updatedAt);
    await fs.writeFile(file, JSON.stringify({ job, requestHash: job.id }));
    await fs.utimes(file, time, time);
  }));

  const jobs = createPuleBrowserJobs({ root });
  assert.deepEqual(jobs.status(), records.slice(-20).reverse());
  assert.deepEqual(jobs.history(), records.reverse());
});

function wave(note) {
  const data = Buffer.alloc(48);
  data.write("RIFF", 0);
  data.writeUInt32LE(40, 4);
  data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(8000, 24);
  data.writeUInt32LE(16000, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(4, 40);
  data.writeInt16LE(note, 44);
  return data;
}

async function waitFor(read, description) {
  const deadline = Date.now() + 12_000;
  do {
    const value = read();
    if (value) return value;
    await delay(20);
  } while (Date.now() < deadline);
  assert.fail("timed out waiting for " + description);
}

async function fixture(t, browser, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rainfall-pule-"));
  const audioPath = path.join(root, "cover.wav");
  const downloadRoot = path.join(root, "configured-downloads");
  const singers = { A: "陈白狐", B: "小川" };
  const archiveFolderNames = {
    A: "素素_陈白狐_6080国语苦情女歌手",
    B: options.sharedArchiveFolder ? "素素_陈白狐_6080国语苦情女歌手" : "素素_小川_6080国语苦情女歌手",
  };
  const coverProfile = { profileId: randomUUID(), expectedRevision: 4 };
  await fs.writeFile(audioPath, wave(33));
  if (!options.missingConfiguredDirectory) await fs.mkdir(downloadRoot);
  const context = await browser.newContext({ acceptDownloads: true });
  const events = [];
  const requests = [];
  const wavLinkRequests = [];
  const coverRequests = [];
  const scopes = [];
  let opened = 0;
  let closed = 0;
  let workspace = 0;
  let page;
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.href === puleCreateUrl) {
      const settings = { ...options };
      if ((options.stallDownloadFile || options.providerWav) && opened > 1) {
        const renamed = events.find(event => event.startsWith("name-applied:new-b:"));
        settings.savedSongs = [
          { id: "new-a", title: input.title },
          { id: "new-b", title: renamed?.slice("name-applied:new-b:".length) ?? input.title },
        ];
        if (!options.stallEveryDownload && opened > (options.stallDownloadAttempts ?? 1)) delete settings.stallDownloadFile;
      }
      return route.fulfill({ contentType: "text/html; charset=utf-8", body: html.replace("__TEST_OPTIONS__", JSON.stringify(settings)) });
    }
    const official = new URL(puleCreateUrl).origin;
    const wavOrigin = options.providerWav === "popup" ? "https://storage.googleapis.com" : "https://oss.yourmusic.fun";
    if (options.providerWav && url.origin === official && url.pathname === "/api/music/v2/wav/make") {
      const { songId } = route.request().postDataJSON();
      const take = Object.entries(options.wavRequestIds ?? {}).find(([, id]) => id === songId)?.[0] ?? songId;
      assert.ok(["new-a", "new-b"].includes(take));
      wavLinkRequests.push(songId);
      await delay(options.waveLinkDelay ?? 250);
      return route.fulfill({ json: { code: options.waveLinkCode ?? 200, data: wavOrigin + "/fixture-" + take + ".wav" } });
    }
    if (!(url.origin === official || options.providerWav && url.origin === wavOrigin) || !/^\/fixture-[a-z-]+\.wav$/u.test(url.pathname)) return route.abort();
    requests.push(url.pathname);
    if (options.providerWav) await delay(options.waveBodyDelay ?? 250);
    else if (url.pathname === "/fixture-new-b.wav") await delay(220);
    if (options.interruptFirstB && opened === 1 && url.pathname === "/fixture-new-b.wav")
      return route.fulfill({ status: 503, headers: { "access-control-allow-origin": official } });
    const body = options.badWav && url.pathname.endsWith("b.wav") ? Buffer.from("<html>error</html>")
      : wave(url.pathname.endsWith("b.wav") ? 200 : 100);
    return route.fulfill({
      headers: { "content-type": "audio/wav", "access-control-allow-origin": official,
        ...(options.providerWav === "popup" && !options.popupAttachment
          ? {} : { "content-disposition": 'attachment; filename="sample.wav"' }) }, body,
    });
  });
  const credentials = new ApiCredentials({
    context: () => ({ mode: "production", generation: workspace }),
    getProfile: async id => id === coverProfile.profileId ? {
      id, revision: coverProfile.expectedRevision, kind: "image", providerId: "zhipu_image",
      modelId: "cogview-3-flash", label: "智谱测试", executionEnabled: false,
    } : undefined,
    vault: { isAvailable: () => true, has: () => !options.noCoverKey, get: () => "fixture-key" },
    connectionRequest: async request => {
      if (request.method === "GET") {
        assert.equal(request.headers, undefined);
        assert.equal(request.binary, true);
        const second = new URL(request.url).pathname === "/B.jpg";
        // The signature passes the API transport check, but this truncated PNG cannot be decoded.
        if (second && options.badCover) return { status: 200, body: Buffer.from("89504e470d0a1a0a", "hex") };
        return { status: 200, body: second ? coverB : coverA };
      }
      const version = coverRequests.length % 2 ? "B" : "A";
      const files = jobs.status().flatMap(job => job.files);
      assert.ok(files.some(file => (options.sharedArchiveFolder || file.version === version) && filesystem.existsSync(file.path)));
      await request.assertDispatch();
      coverRequests.push({ version, ...request.body });
      events.push("cover-api:" + version);
      await delay(110);
      request.assertActive();
      if (options.firstCoverFails && version === "A") return { status: 429 };
      if (options.strictCoverRequest &&
          (request.body.size !== "1024x1024" || Array.from(request.body.prompt).length > 1000))
        return { status: 400 };
      return { status: 200, body: { data: [{ url: "https://cdn.bigmodel.cn/" + version + ".jpg" }] } };
    },
  });
  const create = () => createPuleBrowserJobs({
    root,
    captureWorkspace: () => {
      const previous = workspace;
      return () => { if (workspace !== previous) throw Error("WORKSPACE_CHANGED"); };
    },
    chooseAudio: async () => audioPath,
    scope: async (accountId, artistId, publication, coverImage) => {
      scopes.push({ accountId, artistId, publication, ...(coverImage && { coverImage }) });
      return { accountName: "谱乐测试账号", gender: options.scopeGender ?? "female",
        timbre: options.missingVoice ? "未配置的音色" : "小川",
        archiveRoot: options.noDownloadDirectory ? null : downloadRoot, archiveFolderNames, singers,
        coverProfile: options.noCoverProfile ? null : { ...coverProfile, ...(coverImage && { modelId: coverImage.modelId }) },
        coverResolution: options.coverResolution };
    },
    credentials,
    withPage: async (accountId, signal, run) => {
      opened++;
      const taskPage = await context.newPage();
      page = taskPage;
      taskPage.on("console", message => {
        if (message.text().startsWith("fixture:")) events.push(message.text().slice(8));
      });
      const abort = () => { void taskPage.close().catch(() => undefined); };
      signal.addEventListener("abort", abort, { once: true });
      try { await run(taskPage); }
      finally {
        signal.removeEventListener("abort", abort);
        await taskPage.close();
        closed++;
      }
    },
    run: async (page, input, hooks, _timeouts, phase) => {
      try {
        await runPuleBrowser(page, input, hooks, {
          control: 1_500, login: 2_500, poll: 25, generation: 1_400, processing: 2_000,
          download: options.downloadTimeout ?? (options.realDownloadDelay ? 9_000 : 2_000),
          ...(options.realDownloadDelay ? {} : { afterWavClick: 180 }),
          form: 3_000, inputSettle: 30, ...(options.realSubmitDelay ? {} : { afterSubmit: 30 }),
        }, phase);
      } catch (error) {
        events.push("driver: " + error.message);
        throw error;
      }
    },
  });
  const jobs = create();
  t.after(async () => {
    await jobs.close();
    await context.close();
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    await fs.rm(root, { recursive: true, force: true, maxRetries: 3 });
  });
  const input = { requestId: randomUUID(), accountId: randomUUID(), artistId: randomUUID(),
    mode: "custom", title: "雨夜未归人", lyrics: "雨声一阵一阵", style: "复古民谣", instrumental: false };
  const current = () => jobs.status().find(job => job.id === input.requestId);
  const diagnose = () => JSON.stringify({ job: current(), events, requests, coverRequests });
  const wait = (status, kind) => waitFor(() => {
    const job = current();
    if (job?.status === status && (!kind || job.quote?.kind === kind)) return job;
    if (job && !["running", "awaiting_confirmation"].includes(job.status)) assert.fail(diagnose());
  }, status);
  const waitDownload = () => waitFor(() => {
    if (requests.includes("/fixture-new-b.wav")) return true;
    if (current()?.status === "needs_review") assert.fail(diagnose());
  }, "second WAV request");
  const confirm = job => jobs.confirm({ id: job.id, quoteId: job.quote.id });
  const startCover = async (overrides = {}) => {
    const file = await jobs.chooseAudio();
    await jobs.start({ ...input, ...overrides, mode: "cover", uploadAuthorized: true, uploadToken: file.token });
    return file;
  };
  return { jobs, wait, waitDownload, input, confirm, startCover, audioPath, downloadRoot, archiveFolderNames,
    events, requests, wavLinkRequests, coverRequests, coverProfile, scopes, create,
    waitLogin: () => waitFor(() => current()?.step === "login" && current(), "login"),
    get page() { return page; }, context,
    get opened() { return opened; },
    get closed() { return closed; },
    changeWorkspace() { workspace++; },
  };
}

test("谱乐新版制作表单填写标题、保留正确声线并完成一轮", async t => {
  const browser = await launchHeadlessChromium(chromium);
  t.after(() => browser.close());
  for (const [scopeGender, selectedGender, expectedVoice, clicks] of [
    ["female", "女声", "女声", []],
    ["other", "男声", "不限", ["gender:男声"]],
  ]) {
    await t.test(expectedVoice, async t => {
      const f = await fixture(t, browser, { currentForm: true, scopeGender, selectedGender });
      await f.jobs.start(f.input);
      const completed = await f.wait("completed");
      assert.deepEqual(f.events.filter(event => event.startsWith("gender:")), clicks);
      assert.equal(f.events.filter(event => event === "generate:雨夜未归人|雨声一阵一阵|复古民谣|vocal").length, 1);
      assert.ok(f.events.includes("submitted-voice:" + expectedVoice));
      assert.deepEqual(completed.chargeAttempts, [{ kind: "generation" }]);
      assert.deepEqual(completed.files.map(file => file.version), ["A", "B"]);
    });
  }
});

test("谱乐第一首的下载弹窗自行关闭后继续保存第二首", async t => {
  const browser = await launchHeadlessChromium(chromium);
  t.after(() => browser.close());
  const fixtureRun = await fixture(t, browser, { fadeFirstDownloadDialog: true });
  await fixtureRun.jobs.start({ ...fixtureRun.input, alternateTitle: "夜灯" });
  const result = await fixtureRun.wait("completed");
  assert.deepEqual(result.files.map(({ version, songId, name }) => [version, songId, name]), [
    ["A", "new-a", "雨夜未归人.wav"], ["B", "new-b", "夜灯.wav"],
  ]);
  assert.deepEqual(fixtureRun.requests, ["/fixture-new-a.wav", "/fixture-new-b.wav"]);
  assert.ok(fixtureRun.events.includes("download-dialog-dismissed:new-a"));
});

test("谱乐最多重新下载原歌曲三次并保留已保存的版本", async t => {
  const browser = await launchHeadlessChromium(chromium);
  t.after(() => browser.close());
  for (const stallEveryDownload of [false, true]) {
    await t.test(stallEveryDownload ? "三次重试耗尽后停止" : "第三次重试成功", async t => {
      const f = await fixture(t, browser, {
        stallDownloadFile: "new-b", stallDownloadAttempts: 3, stallEveryDownload, downloadTimeout: 1_200,
      });
      await f.jobs.start({ ...f.input, alternateTitle: "夜灯" });
      const result = await f.wait(stallEveryDownload ? "needs_review" : "completed");
      assert.equal(result.code, stallEveryDownload ? "PULE_DOWNLOAD_NOT_STARTED" : undefined);
      assert.equal(f.opened, 4);
      assert.equal(f.closed, 4);
      assert.equal(f.events.filter(event => event.startsWith("generate:")).length, 1);
      assert.deepEqual(f.events.filter(event => event.startsWith("download-file:")), [
        "download-file:new-a", ...Array(4).fill("download-file:new-b"),
      ]);
      assert.deepEqual(result.chargeAttempts, [{ kind: "generation" }]);
      assert.deepEqual(result.files.map(file => file.name), stallEveryDownload ? ["雨夜未归人.wav"] : ["雨夜未归人.wav", "夜灯.wav"]);
      assert.deepEqual(await fs.readFile(result.files[0].path), wave(100));
      if (!stallEveryDownload) assert.deepEqual(await fs.readFile(result.files[1].path), wave(200));
      assert.deepEqual(result.coverAttempts, stallEveryDownload ? ["A"] : ["A", "B"]);
    });
  }
});

test("谱乐的下载弹窗和新页面共用同一首歌的重试次数", async t => {
  const browser = await launchHeadlessChromium(chromium);
  t.after(() => browser.close());
  const f = await fixture(t, browser, {
    wavRetries: { "new-b": 2 }, stallDownloadFile: "new-b", stallEveryDownload: true,
  });
  await f.jobs.start(f.input);
  const result = await f.wait("needs_review");
  assert.equal(result.code, "PULE_DOWNLOAD_RETRIES_EXHAUSTED");
  assert.equal(f.opened, 2);
  assert.equal(f.events.filter(event => event === "retry:new-b").length, 2);
  assert.deepEqual(result.files.map(file => file.version), ["A"]);
});

test("谱乐准备 WAV、等待地址和接收音频共用同一个截止时间", async t => {
  const browser = await launchHeadlessChromium(chromium);
  t.after(() => browser.close());
  const f = await fixture(t, browser, {
    providerWav: "fetch", wavRequestIds: { "new-a": "new-a", "new-b": "new-b" },
    waveLinkDelay: 300, waveBodyDelay: 1_150, downloadTimeout: 1_500,
  });
  await f.jobs.start(f.input);
  const result = await f.wait("needs_review");
  assert.equal(result.code, "PULE_DOWNLOAD_TIMEOUT");
  assert.equal(f.opened, 4);
  assert.deepEqual(f.wavLinkRequests, Array(8).fill("new-a"));
  assert.deepEqual(result.files, []);
});

for (const [mode, options] of [
  ["页面接收", { providerWav: "fetch", unrelatedBlob: true }],
  ["新标签播放", { providerWav: "popup" }],
  ["新标签附件", { providerWav: "popup", popupAttachment: true }],
]) test(`谱乐按原歌曲回执接收 WAV（${mode}）`, async t => {
  const browser = await launchHeadlessChromium(chromium);
  t.after(() => browser.close());
  const f = await fixture(t, browser, options);
  await f.jobs.start({ ...f.input, alternateTitle: "夜灯" });
  const result = await f.wait("completed");
  assert.equal(f.opened, 1);
  assert.deepEqual([...new Set(f.requests)], ["/fixture-new-a.wav", "/fixture-new-b.wav"]);
  assert.deepEqual(f.wavLinkRequests, ["new-a", "new-b"]);
  assert.deepEqual(result.files.map(({ version, songId, name }) => [version, songId, name]), [
    ["A", "new-a", "雨夜未归人.wav"], ["B", "new-b", "夜灯.wav"],
  ]);
  assert.deepEqual(await fs.readFile(result.files[0].path), wave(100));
  assert.deepEqual(await fs.readFile(result.files[1].path), wave(200));
  assert.equal(f.events.filter(event => event.startsWith("generate:")).length, 1);
  await waitFor(() => f.context.pages().length === 0, "the task and its download tabs to close");
});

test("谱乐使用 WAV 准备环节的内部 ID 识别下载，同时保留原作品回执", async t => {
  const browser = await launchHeadlessChromium(chromium);
  t.after(() => browser.close());
  const f = await fixture(t, browser, { providerWav: "popup", wavRequestIds: { "new-a": 7281003, "new-b": "8791000000000000042" } });
  await f.jobs.start({ ...f.input, alternateTitle: "夜灯" });
  const result = await f.wait("completed");
  assert.equal(f.opened, 1);
  assert.deepEqual(f.wavLinkRequests, [7281003, 7281003, "8791000000000000042", "8791000000000000042"]);
  assert.deepEqual(result.files.map(({ version, songId, name }) => [version, songId, name]), [
    ["A", "new-a", "雨夜未归人.wav"], ["B", "new-b", "夜灯.wav"],
  ]);
  assert.deepEqual(await fs.readFile(result.files[0].path), wave(100));
  assert.deepEqual(await fs.readFile(result.files[1].path), wave(200));
  assert.equal(f.events.filter(event => event.startsWith("generate:")).length, 1);
});

test("谱乐 WAV 弹窗对应其他歌名时停止下载", async t => {
  const browser = await launchHeadlessChromium(chromium);
  t.after(() => browser.close());
  const f = await fixture(t, browser, { providerWav: "fetch", wavRequestIds: { "new-a": 7281003 }, wavTitleMismatch: "new-a" });
  await f.jobs.start({ ...f.input, alternateTitle: "夜灯" });
  const result = await f.wait("needs_review");
  assert.equal(result.code, "PULE_WAV_IDENTITY_UNCONFIRMED");
  assert.deepEqual(f.wavLinkRequests, [7281003]);
  assert.deepEqual(result.songIds, ["new-a", "new-b"]);
  assert.deepEqual(f.requests, []);
  assert.equal(f.opened, 1);
});

test("谱乐第二首复用第一首的 WAV 内部 ID 时保留第一首并停止", async t => {
  const browser = await launchHeadlessChromium(chromium);
  t.after(() => browser.close());
  const f = await fixture(t, browser, { providerWav: "fetch", wavRequestIds: { "new-a": 7281003, "new-b": 7281003 } });
  await f.jobs.start({ ...f.input, alternateTitle: "夜灯" });
  const result = await f.wait("needs_review");
  assert.equal(result.code, "PULE_WAV_IDENTITY_UNCONFIRMED");
  assert.deepEqual(f.wavLinkRequests, [7281003, 7281003, 7281003]);
  assert.deepEqual(f.requests, ["/fixture-new-a.wav"]);
  assert.deepEqual(result.files.map(file => file.name), ["雨夜未归人.wav"]);
  assert.equal(f.opened, 1);
});

test("谱乐 WAV 地址暂时不可用时只补下载 B 版", async t => {
  const browser = await launchHeadlessChromium(chromium);
  t.after(() => browser.close());
  const f = await fixture(t, browser, {
    providerWav: "fetch", wavRequestIds: { "new-a": 7281003, "new-b": "8791000000000000042" }, interruptFirstB: true,
  });
  await f.jobs.start({ ...f.input, alternateTitle: "夜灯" });
  const result = await f.wait("completed");
  assert.ok(f.events.includes("driver: PULE_WAV_TRANSFER_FAILED"));
  assert.deepEqual(f.wavLinkRequests,
    [7281003, 7281003, "8791000000000000042", "8791000000000000042", "8791000000000000042", "8791000000000000042"]);
  assert.equal(f.opened, 2);
  assert.equal(f.events.filter(event => event.startsWith("generate:")).length, 1);
  assert.deepEqual(result.files.map(file => file.name), ["雨夜未归人.wav", "夜灯.wav"]);
  assert.deepEqual(await fs.readFile(result.files[0].path), wave(100));
  assert.deepEqual(await fs.readFile(result.files[1].path), wave(200));
});

test("谱乐拒绝 WAV 下载额度时保留原回执并停止自动重试", async t => {
  const browser = await launchHeadlessChromium(chromium);
  t.after(() => browser.close());
  const f = await fixture(t, browser, { providerWav: "fetch", waveLinkCode: 402 });
  await f.jobs.start({ ...f.input, alternateTitle: "夜灯" });
  const result = await f.wait("needs_review");
  assert.equal(result.code, "PULE_INSUFFICIENT_CREDITS");
  assert.equal(f.opened, 1);
  assert.deepEqual(result.songIds, ["new-a", "new-b"]);
  assert.deepEqual(f.wavLinkRequests, ["new-a"]);
  assert.deepEqual(f.requests, []);
});

test("任务中心 WAV 导入使用谱乐浏览器的 80 MiB 上限", async t => {
  const parent = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(parent, "rainfall-plan-wave-size-"));
  t.after(async () => {
    assert.equal(path.dirname(await fs.realpath(root)), parent);
    await fs.rm(root, { recursive: true, force: true });
  });
  const readWave = (size, guard) => readPlanPuleWave({
    async saveAs(file) {
      const prefix = wave(100);
      prefix.writeUInt32LE(size - 8, 4);
      prefix.writeUInt16LE(2, 22);
      prefix.writeUInt32LE(48_000, 24);
      prefix.writeUInt32LE(192_000, 28);
      prefix.writeUInt16LE(4, 32);
      prefix.writeUInt32LE(size - 44, 40);
      await fs.writeFile(file, prefix, { flag: "wx" });
      await fs.truncate(file, size);
    },
  }, root, guard);

  await t.test("接受超过 50 MiB 的 275 秒立体声 WAV", async () => {
    const size = 44 + 275 * 192_000;
    const bytes = await readWave(size, async () => {});
    assert.equal(bytes.length, size);
    assert.equal(bytes.readInt16LE(44), 100);
  });

  await t.test("拒绝超过 80 MiB 的 WAV", async () => {
    await assert.rejects(readWave(80 * 1024 * 1024 + 4, () => assert.fail("超限 WAV 不应进入导入")), {
      message: "PULE_AUDIO_SIZE",
    });
  });
  assert.deepEqual(await fs.readdir(root), []);
});

test("a stalled WAV transfer times out after ten minutes even if cancellation never settles", async t => {
  const parent = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(parent, "rainfall-pule-transfer-"));
  t.after(async () => {
    assert.equal(path.dirname(await fs.realpath(root)), parent);
    await fs.rm(root, { recursive: true, force: true });
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let temporary, finish, cancelled = 0;
  const transfer = readPlanPuleWave({
    saveAs: file => { temporary = file; return new Promise(resolve => { finish = resolve; }); },
    cancel: () => { cancelled++; return new Promise(() => {}); },
  }, root, () => assert.fail("a timed out transfer cannot be imported"));
  const outcome = transfer.then(() => "saved", error => error.message);
  await Promise.resolve();
  t.mock.timers.tick(10 * 60_000 - 1);
  await Promise.resolve();
  assert.equal(cancelled, 0);
  t.mock.timers.tick(1);
  t.mock.timers.reset();
  const result = await Promise.race([outcome, delay(350, "pending")]);
  await fs.writeFile(temporary, wave(200));
  finish();
  await outcome;
  assert.equal(result, "PULE_DOWNLOAD_TIMEOUT");
  assert.equal(cancelled, 1);
  await waitFor(() => !filesystem.existsSync(temporary), "late temporary download to be removed");
});

test("谱乐 AI Playwright control and task recovery", async t => {
  const browser = await launchHeadlessChromium(chromium);
  t.after(() => browser.close());

  await t.test("plan phases submit pure music once and download the saved B recording by ID", async t => {
    const input = { requestId: randomUUID(), accountId: randomUUID(), artistId: randomUUID(), mode: "custom",
      title: "器乐计划 A", alternateTitle: "器乐计划 B", lyrics: "", style: "木吉他器乐", instrumental: true };
    const context = await browser.newContext({ acceptDownloads: true });
    t.after(() => context.close());
    const events = [], requests = [], charges = [], downloads = [];
    let songIds = [];
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.href === puleCreateUrl) {
        const savedSongs = songIds.slice().reverse().map(id => ({ id, title: input.title }));
        return route.fulfill({ contentType: "text/html; charset=utf-8",
          body: html.replace("__TEST_OPTIONS__", JSON.stringify({ savedSongs })) });
      }
      if (url.origin !== new URL(puleCreateUrl).origin || url.pathname !== "/fixture-new-b.wav") return route.abort();
      requests.push(url.pathname);
      return route.fulfill({ headers: { "content-type": "audio/wav", "content-disposition": "attachment; filename=sample.wav" }, body: wave(200) });
    });
    const page = await context.newPage();
    page.on("console", message => { if (message.text().startsWith("fixture:")) events.push(message.text().slice(8)); });
    const hooks = { guard: async () => {}, validateAudio: () => assert.fail("unexpected audio upload"), step: () => {},
      approveCover: async () => assert.fail("unexpected cover request"),
      beforeCharge: async kind => { charges.push(kind); assert.equal(await page.getByRole("switch", { name: "纯音乐" }).isChecked(), true); },
      identify: async ids => { songIds = ids; },
      saveWave: async (version, id, download, title) => {
        assert.equal(await download.failure(), null);
        downloads.push([version, id, title]);
      },
      generateCover: async () => assert.fail("the plan uses its own cover stage"),
    };
    const fast = { control: 2_000, form: 2_000, generation: 2_000, inputSettle: 25, afterSubmit: 30, poll: 25, afterWavClick: 130 };
    await runPuleBrowser(page, input, hooks, fast, { kind: "submit" });
    assert.deepEqual(songIds, ["new-a", "new-b"]);
    assert.deepEqual(requests, []);
    await runPuleBrowser(page, input, hooks, fast, { kind: "download", songIds, versions: ["B"] });
    assert.deepEqual(charges, ["generation"]);
    assert.deepEqual(requests, ["/fixture-new-b.wav"]);
    assert.deepEqual(downloads, [["B", "new-b", "器乐计划 B"]]);
    assert.ok(events.includes("generate:器乐计划 A||木吉他器乐|instrumental"));
    assert.ok(events.includes("name-applied:new-b:器乐计划 B"));
  });

  await t.test("requires the configured download location before opening a task page", async t => {
    const f = await fixture(t, browser, { noDownloadDirectory: true });
    await assert.rejects(f.jobs.start(f.input), /DOWNLOAD_ROOT_REQUIRED/);
    assert.equal(f.opened, 0);
    assert.deepEqual(f.jobs.status(), []);
    assert.deepEqual(f.requests, []);
  });

  await t.test("stops before opening the task page if the configured folder is unavailable", async t => {
    const f = await fixture(t, browser, { missingConfiguredDirectory: true });
    await assert.rejects(f.jobs.start(f.input), /DOWNLOAD_ROOT_UNAVAILABLE/);
    assert.equal(f.opened, 0);
    assert.deepEqual(f.jobs.status(), []);
    await assert.rejects(fs.stat(f.downloadRoot), { code: "ENOENT" });
  });

  for (const [option, code] of [
    ["noCoverProfile", "PULE_COVER_PROFILE_REQUIRED"], ["noCoverKey", "PULE_COVER_CREDENTIAL_REQUIRED"],
  ]) {
    await t.test("checks the cover API setup before starting: " + option, async t => {
      const f = await fixture(t, browser, { [option]: true });
      await assert.rejects(f.jobs.start(f.input), new RegExp(code));
      assert.equal(f.opened, 0);
      assert.deepEqual(f.jobs.status(), []);
    });
  }

  await t.test("automatically submits generation when the website has no displayed price", async t => {
    const f = await fixture(t, browser, { noGenerationPrice: true, pairPromptDelay: 220 });
    const publication = { platform: "fanqie", accountId: randomUUID() };
    await f.jobs.start({ ...f.input, publication });
    const done = await f.wait("completed");
    assert.deepEqual(f.scopes, [{ accountId: f.input.accountId, artistId: f.input.artistId, publication }]);
    assert.deepEqual(done.chargeAttempts, [{ kind: "generation" }]);
    assert.deepEqual(done.songIds, ["new-a", "new-b"]);
    assert.equal(f.events.filter(event => event === "make-click").length, 1);
    assert.equal(f.events.filter(event => event === "pair-confirmed").length, 1);
    assert.ok(f.events.indexOf("more:new-a") > f.events.indexOf("settled"));
  });

  await t.test("leaves an unrelated confirmation prompt alone", async t => {
    const f = await fixture(t, browser, { unrelatedPrompt: true });
    await f.jobs.start(f.input);
    const result = await f.wait("needs_review");
    assert.equal(result.code, "PULE_RESULT_UNCLEAR");
    assert.deepEqual(result.chargeAttempts, [{ kind: "generation" }]);
    assert.ok(!f.events.includes("unrelated-confirmed"));
    assert.deepEqual(f.requests, []);
  });

  await t.test("retries each WAV and generates its cover before moving to the next singer directory", async t => {
    const f = await fixture(t, browser, {
      oldSameTitle: true, renameReorders: true, keepFirstDownloadDialog: true, coverResolution: 1440, strictCoverRequest: true,
      wavRetries: { "new-a": 1, "new-b": 3 },
    });
    const lyrics = "雨声一阵\n" + "窗前还亮着一盏灯，等你回来。\n".repeat(72).trimEnd();
    const request = { ...f.input, alternateTitle: "夜灯", lyrics: lyrics.replace(/\n/gu, "\r\n") };
    await f.jobs.start(request);
    await f.jobs.start(request);
    assert.equal(f.opened, 1);
    await assert.rejects(f.jobs.start({ ...request, title: "复用请求" }), /PULE_REQUEST_CONFLICT/);
    await assert.rejects(f.jobs.start({ ...request, requestId: randomUUID() }), /PULE_ACCOUNT_BUSY/);
    await f.waitDownload();
    assert.equal(f.closed, 0);
    const done = await f.wait("completed");
    assert.equal(f.closed, 1);
    assert.deepEqual(f.events.slice(0, 3), ["timbre", "apply:小川", "gender:女声"]);
    assert.deepEqual(done.songIds, ["new-a", "new-b"]);
    assert.deepEqual(f.requests, ["/fixture-new-a.wav", "/fixture-new-b.wav"]);
    assert.deepEqual(done.outputDirectories, {
      A: path.join(f.downloadRoot, f.archiveFolderNames.A), B: path.join(f.downloadRoot, f.archiveFolderNames.B),
    });
    assert.deepEqual((await fs.readdir(f.downloadRoot)).sort(), Object.values(f.archiveFolderNames).sort());
    assert.deepEqual(done.files.map(file => file.name), ["雨夜未归人.wav", "夜灯.wav"]);
    assert.deepEqual(done.files.map(file => file.path), done.files.map(file => path.join(done.outputDirectories[file.version], file.name)));
    assert.deepEqual(await fs.readFile(done.files[0].path), wave(100));
    assert.deepEqual(await fs.readFile(done.files[1].path), wave(200));
    assert.deepEqual(done.files.map(file => file.lyrics?.name), ["雨夜未归人.txt", "夜灯.txt"]);
    assert.deepEqual(done.files.map(file => file.cover?.name), ["雨夜未归人.png", "夜灯.png"]);
    assert.deepEqual(await Promise.all(done.files.map(file => fs.readFile(file.lyrics.path, "utf8"))),
      [lyrics, lyrics]);
    const images = await Promise.all(done.files.map(async file => sharp(await fs.readFile(file.cover.path)).metadata()));
    assert.deepEqual(images.map(image => [image.format, image.width, image.height]), [["png", 1440, 1440], ["png", 1440, 1440]]);
    const firstPixel = await Promise.all(done.files.map(async file => sharp(await fs.readFile(file.cover.path)).stats()));
    assert.ok(firstPixel[0].channels[0].mean > firstPixel[1].channels[0].mean);
    for (const file of done.files) {
      const directory = done.outputDirectories[file.version];
      assert.equal(file.lyrics.path, path.join(directory, file.lyrics.name));
      assert.equal(file.cover.path, file.path.replace(/\.wav$/u, ".png"));
      assert.deepEqual((await fs.readdir(directory)).sort(), [file.name, file.lyrics.name, file.cover.name].sort());
    }
    assert.deepEqual(f.coverRequests.map(call => [call.version, call.model, call.size]),
      [["A", "cogview-3-flash", "1024x1024"], ["B", "cogview-3-flash", "1024x1024"]]);
    assert.match(f.coverRequests[0].prompt, /《雨夜未归人》.*陈白狐/su);
    assert.match(f.coverRequests[1].prompt, /《夜灯》.*小川/su);
    assert.deepEqual(done.coverAttempts, ["A", "B"]);
    assert.ok(f.events.includes("generate:雨夜未归人|" + lyrics + "|复古民谣|vocal"));
    assert.deepEqual(f.events.slice(f.events.indexOf("settled")), [
      "settled", "more:new-b", "rename-menu-scrolled:new-b",
      "save-name:new-b:夜灯", "name-applied:new-b:夜灯",
      "more:new-a", "wav-menu:new-a", "retry:new-a", "download-file:new-a", "cover-api:A", "download-dialog-closed:new-a",
      "more:new-b", "wav-menu:new-b", "retry:new-b", "retry:new-b", "retry:new-b", "download-file:new-b", "cover-api:B",
    ]);
  });

  await t.test("waits two seconds after selecting WAV before clicking the retry button", async t => {
    const f = await fixture(t, browser, { realDownloadDelay: true, wavRetries: { "new-a": 1 } });
    await f.jobs.start(f.input);
    await f.wait("completed");
    const timing = f.events.find(event => event.startsWith("retry-delay:"));
    assert.ok(timing && Number(timing.split(":")[1]) >= 1990, f.events.join(", "));
  });

  await t.test("reuses an existing singer directory and keeps version materials together when a name is taken", async t => {
    const f = await fixture(t, browser);
    const directory = path.join(f.downloadRoot, f.archiveFolderNames.A);
    await fs.mkdir(directory);
    await fs.writeFile(path.join(directory, "雨夜未归人.txt"), "之前的歌词");
    const mkdir = filesystem.mkdirSync;
    const archiveCreations = [];
    t.mock.method(filesystem, "mkdirSync", (destination, options) => {
      if (path.dirname(destination) === f.downloadRoot) archiveCreations.push(destination);
      return mkdir(destination, options);
    });
    await f.jobs.start(f.input);
    const done = await f.wait("completed");
    assert.equal(done.outputDirectories.A, path.join(directory, "雨夜未归人 (2)"));
    assert.deepEqual(archiveCreations, [path.join(f.downloadRoot, f.archiveFolderNames.B)]);
    assert.equal(await fs.readFile(path.join(directory, "雨夜未归人.txt"), "utf8"), "之前的歌词");
    assert.deepEqual([done.files[0].name, done.files[0].lyrics.name, done.files[0].cover.name],
      ["雨夜未归人.wav", "雨夜未归人.txt", "雨夜未归人.png"]);
  });

  await t.test("keeps concurrent accounts' jobs and same-title downloads separate in shared singer directories", async t => {
    const x = await fixture(t, browser, { sharedArchiveFolder: true });
    const second = { ...x.input, requestId: randomUUID(), accountId: randomUUID() };
    await Promise.all([x.jobs.start(x.input), x.jobs.start(second)]);
    const ownJobs = () => x.jobs.status().filter(job => job.id === x.input.requestId || job.id === second.requestId);
    assert.deepEqual(ownJobs().map(job => job.status), ["running", "running"]);
    await assert.rejects(x.jobs.start({ ...x.input, requestId: randomUUID() }), /PULE_ACCOUNT_BUSY/);

    const completed = await waitFor(() => {
      const jobs = ownJobs();
      if (jobs.some(job => job.status !== "running" && job.status !== "completed"))
        assert.fail(JSON.stringify({ jobs, events: x.events }));
      return jobs.length === 2 && jobs.every(job => job.status === "completed") ? jobs : undefined;
    }, "both accounts' downloads");
    const saved = completed.flatMap(job => job.files);
    assert.equal(saved.length, 4);
    assert.equal(new Set(saved.flatMap(file => [file.path, file.lyrics.path, file.cover.path])).size, 12);
    assert.deepEqual(saved.map(file => path.dirname(path.relative(path.join(x.downloadRoot, x.archiveFolderNames.A), file.path))).sort(),
      [".", "雨夜未归人 (2)", "雨夜未归人 (3)", "雨夜未归人 (4)"].sort());
    for (const file of saved) {
      assert.equal(file.name, "雨夜未归人.wav");
      assert.equal(file.lyrics.path, file.path.replace(/\.wav$/u, ".txt"));
      assert.equal(file.cover.path, file.path.replace(/\.wav$/u, ".png"));
      assert.equal(await fs.readFile(file.lyrics.path, "utf8"), x.input.lyrics);
      assert.equal((await sharp(file.cover.path).metadata()).format, "png");
    }
  });

  await t.test("uses the filechooser, confirms cover processing, and generates an instrumental automatically", async t => {
    const f = await fixture(t, browser, { oldCover: true, noGenerationPrice: true, pairPromptDelay: 0, sharedArchiveFolder: true });
    const file = await f.startCover({ instrumental: true, lyrics: "" });
    assert.equal(file.name, "cover.wav");
    const cover = await f.wait("awaiting_confirmation", "processing");
    assert.equal(cover.quote.credits, 50);
    assert.deepEqual(f.events, ["file:cover.wav", "save"]);
    f.confirm(cover);
    assert.throws(() => f.confirm(cover), /PULE_QUOTE_EXPIRED/);
    const done = await f.wait("completed");
    assert.deepEqual(done.chargeAttempts, [{ kind: "processing", credits: 50 }, { kind: "generation" }]);
    assert.deepEqual(f.events.slice(0, 6), ["file:cover.wav", "save", "process", "cover", "make-click", "pair-confirmed"]);
    assert.ok(f.events.includes("generate:雨夜未归人||复古民谣|instrumental"));
    assert.ok(done.files.every(file => !file.lyrics));
    assert.deepEqual(done.files.map(file => file.cover?.name), ["雨夜未归人.png", "雨夜未归人.png"]);
    assert.equal(done.outputDirectories.B, path.join(done.outputDirectories.A, "雨夜未归人 (2)"));
    assert.deepEqual(await fs.readdir(f.downloadRoot), [f.archiveFolderNames.A]);
    assert.deepEqual((await fs.readdir(done.outputDirectories.A)).sort(), ["雨夜未归人 (2)", "雨夜未归人.png", "雨夜未归人.wav"]);
    assert.deepEqual((await fs.readdir(done.outputDirectories.B)).sort(), ["雨夜未归人.png", "雨夜未归人.wav"]);
  });

  await t.test("flags an unfinished copyright upload and never starts song generation", async t => {
    const f = await fixture(t, browser, { incompleteCover: true });
    await f.startCover();
    f.confirm(await f.wait("awaiting_confirmation", "processing"));
    const review = await f.wait("needs_review");
    assert.equal(review.code, "PULE_COVER_RESULT_UNCLEAR");
    assert.deepEqual(review.chargeAttempts, [{ kind: "processing", credits: 50 }]);
    assert.deepEqual(f.events.slice(0, 3), ["file:cover.wav", "save", "process"]);
    assert.equal(f.events.some(event => event.startsWith("generate:")), false);
  });

  await t.test("refuses a changed copyright processing fee before clicking", async t => {
    const f = await fixture(t, browser);
    await f.startCover();
    const quote = await f.wait("awaiting_confirmation", "processing");
    await f.page.locator("#processAudio").evaluate(el => { el.textContent = "开始处理（70 积分）"; });
    f.confirm(quote);
    assert.equal((await f.wait("failed")).code, "PULE_PRICE_CHANGED");
    assert.deepEqual(f.events.slice(0, 2), ["file:cover.wav", "save"]);
    assert.ok(!f.events.includes("process"));
  });

  for (const [options, dismissed] of [
    [{ redundantLogin: true }, ["login-closed", "reward-closed"]],
    [{ rewardsPrompt: true }, ["reward-closed"]],
  ]) {
    await t.test("dismisses " + dismissed.join(" and ") + " while retaining the signed-in session", async t => {
      const f = await fixture(t, browser, options);
      await f.jobs.start(f.input);
      await f.wait("completed");
      assert.deepEqual(f.events.slice(0, dismissed.length), dismissed);
      assert.ok(!f.events.includes("login-opened"));
      assert.ok(!f.events.includes("claimed-reward"));
    });
  }

  await t.test("waits for slow fields to retain their values and delayed gender selection", async t => {
    const f = await fixture(t, browser, { slowFields: true });
    await f.jobs.start(f.input);
    await f.wait("completed");
    assert.deepEqual(f.events.filter(event => event.startsWith("field-ready:")), [
      "field-ready:songTitle", "field-ready:lyrics", "field-ready:style",
    ]);
    const payload = "generate:雨夜未归人|雨声一阵一阵|复古民谣|vocal";
    assert.ok(f.events.indexOf("gender:女声") < f.events.indexOf(payload));
    assert.ok(f.events.includes(payload));
  });

  await t.test("clicks the supplied make button and waits eight seconds after the official confirmation", async t => {
    const f = await fixture(t, browser, {
      ariaLabelDiffers: true, realSubmitDelay: true, previousTitle: "之前的榜首", pairPromptDelay: 220,
    });
    await f.jobs.start(f.input);
    await f.wait("completed");
    const delays = f.events.filter(event => event.startsWith("after-submit-ms:")).map(event => Number(event.split(":")[1]));
    assert.equal(delays.length, 2);
    assert.ok(delays[0] >= 7_990);
    assert.equal(f.events.filter(event => event === "pair-confirmed").length, 1);
    assert.equal(f.events.filter(event => event.startsWith("generate:")).length, 1);
  });

  await t.test("requires the newly produced title at the top even if two candidates appear elsewhere", async t => {
    const f = await fixture(t, browser, { leaveOldFirst: true, previousTitle: "旧榜首" });
    await f.jobs.start(f.input);
    assert.equal((await f.wait("needs_review")).code, "PULE_RESULT_UNCLEAR");
    assert.ok(f.events.includes("settled"));
    assert.equal(f.events.some(event => event.startsWith("more:")), false);
    assert.deepEqual(f.requests, []);
  });

  await t.test("stops before renaming or downloading when the first title has not changed, even with two new IDs", async t => {
    const f = await fixture(t, browser, { previousTitle: "雨夜未归人" });
    await f.jobs.start({ ...f.input, alternateTitle: "夜灯" });
    const result = await f.wait("needs_review");
    assert.equal(result.code, "PULE_FIRST_TITLE_UNCHANGED", f.events.join(", "));
    assert.ok(f.events.includes("settled"));
    assert.equal(f.events.some(event => event.startsWith("more:")), false);
    assert.deepEqual(f.requests, []);
  });

  await t.test("requires the second recording title to be saved before downloading either WAV", async t => {
    const f = await fixture(t, browser, { renameFails: true });
    await f.jobs.start({ ...f.input, alternateTitle: "夜灯" });
    const result = await f.wait("needs_review");
    assert.equal(result.code, "PULE_RENAME_UNCONFIRMED", f.events.join(", "));
    assert.equal(result.step, "rename");
    assert.deepEqual(result.songIds, ["new-a", "new-b"]);
    assert.ok(f.events.includes("save-name:new-b:夜灯"));
    assert.deepEqual(f.requests, []);
  });

  await t.test("can verify new results when the song list was empty before production", async t => {
    const f = await fixture(t, browser, { emptyHistory: true });
    await f.jobs.start(f.input);
    assert.deepEqual((await f.wait("completed")).songIds, ["new-a", "new-b"]);
  });

  for (const [option, name] of [
    ["restoringSession", "waits for account restoration even when the creation tab has appeared"],
    ["refreshingSession", "waits for the account UI to settle during form entry"],
    ["unrelatedLogin", "does not mistake an unrelated login button for an expired session"],
  ]) {
    await t.test(name, async t => {
      const f = await fixture(t, browser, { [option]: true });
      await f.jobs.start(f.input);
      await f.wait("completed");
      assert.ok(!f.events.includes("form-before-session"));
      assert.ok(!f.events.includes("login-opened"));
    });
  }

  await t.test("opens login and continues the original task in the same page after sign-in", async t => {
    const f = await fixture(t, browser, { expired: true });
    await f.jobs.start(f.input);
    await f.waitLogin();
    const loginPage = f.page;
    const login = loginPage.getByRole("dialog").filter({ hasText: "继续你的音乐创作" });
    await login.getByRole("button", { name: "测试完成登录" }).waitFor({ state: "visible" });
    assert.deepEqual(f.events, ["login-opened"]);
    await login.getByRole("button", { name: "测试完成登录" }).click();

    await f.wait("completed");
    assert.equal(f.page, loginPage);
    assert.equal(f.opened, 1);
    assert.deepEqual(f.events.slice(0, 5), ["login-opened", "signed-in", "timbre", "apply:小川", "gender:女声"]);
    assert.equal(f.closed, 1);
  });

  await t.test("closing the task page cancels a pending charge confirmation", async t => {
    const f = await fixture(t, browser);
    await f.startCover();
    const quote = await f.wait("awaiting_confirmation", "processing");
    await f.page.close();
    const stopped = await f.wait("stopped");
    assert.equal(stopped.code, "PULE_WINDOW_CLOSED");
    assert.equal(stopped.quote, undefined);
    assert.throws(() => f.confirm(quote), /PULE_QUOTE_EXPIRED/);
    assert.ok(!f.events.some(event => event.startsWith("generate:")));
  });

  for (const [option, code] of [
    ["expired", "PULE_LOGIN_TIMEOUT"], ["missingVoice", "PULE_TIMBRE_UNAVAILABLE"],
    ["agreement", "PULE_AGREEMENT_REQUIRED"], ["lowCredits", "PULE_INSUFFICIENT_CREDITS"],
  ]) {
    await t.test("stops safely on " + option, async t => {
      const f = await fixture(t, browser, { [option]: true });
      await f.jobs.start(f.input);
      const failed = await f.wait("failed");
      assert.equal(failed.code, code);
      assert.equal(failed.possibleCharge, undefined);
      assert.ok(!f.events.some(item => item === "accepted" || item.startsWith("generate:")));
    });
  }

  await t.test("requires two newly identified results before requesting WAVs", async t => {
    const f = await fixture(t, browser, { incomplete: true });
    await f.jobs.start(f.input);
    assert.equal((await f.wait("needs_review")).code, "PULE_RESULT_UNCLEAR");
    assert.deepEqual(f.requests, []);
  });

  await t.test("keeps the first file when the second is invalid, and records uncertainty across restart", async t => {
    const f = await fixture(t, browser, { badWav: true });
    await f.jobs.start(f.input);
    await f.waitDownload();
    const restarted = f.create();
    assert.equal(restarted.status()[0].status, "needs_review");
    assert.equal(restarted.status()[0].possibleCharge, "generation");
    const failed = await f.wait("needs_review");
    assert.equal(failed.code, "PULE_WAV_INVALID");
    assert.deepEqual(failed.files.map(file => file.version), ["A"]);
    assert.deepEqual(await fs.readFile(failed.files[0].path), wave(100));
    assert.deepEqual((await fs.readdir(path.dirname(failed.files[0].path))).sort(),
      [failed.files[0].name, failed.files[0].lyrics.name, failed.files[0].cover.name].sort());
    assert.equal((await restarted.start(f.input)).status, "needs_review");
    assert.equal(f.opened, 1);
  });

  await t.test("stops if the second download dialog never appears and keeps the completed A WAV", async t => {
    const f = await fixture(t, browser, { missingDownloadDialog: "new-b" });
    await f.jobs.start(f.input);
    const review = await f.wait("needs_review");
    assert.equal(review.code, "PULE_DOWNLOAD_CONFIRM_UNAVAILABLE", f.events.join(", "));
    assert.deepEqual(review.files.map(file => file.version), ["A"]);
    assert.deepEqual(f.requests, ["/fixture-new-a.wav"]);
    assert.ok(f.events.includes("wav-menu:new-b"));
    assert.ok(!f.events.includes("unrelated-download-click"));
    assert.equal(f.closed, 1);
  });

  await t.test("clicks retry at most three times for a failed WAV and keeps the completed first recording", async t => {
    const f = await fixture(t, browser, { wavRetries: { "new-b": 4 } });
    await f.jobs.start(f.input);
    const review = await f.wait("needs_review");
    assert.equal(review.code, "PULE_DOWNLOAD_RETRIES_EXHAUSTED");
    assert.equal(f.events.filter(event => event === "retry:new-b").length, 3);
    assert.deepEqual(f.requests, ["/fixture-new-a.wav"]);
    assert.deepEqual(review.coverAttempts, ["A"]);
    assert.ok(review.files[0].cover);
  });

  await t.test("continues with the second WAV after an API failure on the first cover without resending it", async t => {
    const f = await fixture(t, browser, { firstCoverFails: true });
    await f.jobs.start(f.input);
    const review = await f.wait("needs_review");
    assert.equal(review.code, "PULE_COVER_HTTP_429");
    assert.deepEqual(review.coverAttempts, ["A", "B"]);
    assert.deepEqual(f.requests, ["/fixture-new-a.wav", "/fixture-new-b.wav"]);
    assert.deepEqual(review.files.map(file => [file.version, Boolean(file.lyrics), Boolean(file.cover)]),
      [["A", true, false], ["B", true, true]]);
  });

  await t.test("keeps both WAV and TXT files when the second song's cover is invalid", async t => {
    const f = await fixture(t, browser, { badCover: true });
    await f.jobs.start(f.input);
    const review = await f.wait("needs_review");
    assert.equal(review.code, "PULE_COVER_INVALID");
    assert.deepEqual(review.files.map(file => [file.version, Boolean(file.lyrics), Boolean(file.cover)]),
      [["A", true, true], ["B", true, false]]);
    const savedFiles = (await Promise.all(Object.values(review.outputDirectories).map(directory => fs.readdir(directory)))).flat();
    assert.equal(savedFiles.length, 5);
    assert.ok(savedFiles.every(name => /\.(wav|txt|png)$/u.test(name)));
    assert.equal(f.closed, 1);
  });

  await t.test("validates the selected file identity before opening the browser", async t => {
    const f = await fixture(t, browser);
    const file = await f.jobs.chooseAudio();
    await fs.appendFile(f.audioPath, Buffer.from("changed"));
    await assert.rejects(f.jobs.start({ ...f.input, mode: "cover", uploadAuthorized: true, uploadToken: file.token }),
      /PULE_AUDIO_CHANGED/);
    assert.equal(f.opened, 0);
  });

  await t.test("stops at a workspace change and never confirms a stopped task", async t => {
    const f = await fixture(t, browser);
    await f.startCover();
    const quote = await f.wait("awaiting_confirmation", "processing");
    f.changeWorkspace();
    assert.throws(() => f.confirm(quote), /WORKSPACE_CHANGED/);
    f.jobs.invalidate();
    assert.equal((await f.wait("stopped")).code, "WORKSPACE_CHANGED");
    assert.throws(() => f.confirm(quote), /PULE_QUOTE_EXPIRED/);
    assert.deepEqual(f.requests, []);
  });
});

test("谱乐 uses the explicitly selected cover model for both archived recordings", async t => {
  const browser = await launchHeadlessChromium(chromium);
  t.after(() => browser.close());
  const f = await fixture(t, browser, { coverResolution: 1440 });
  const coverImage = { ...f.coverProfile, providerId: "zhipu_image", modelId: "glm-image" };
  await f.jobs.start({ ...f.input, alternateTitle: "夜灯", coverImage });
  const job = await f.wait("completed");
  assert.deepEqual(f.scopes[0].coverImage, coverImage);
  assert.deepEqual(job.coverImage, { providerId: "zhipu_image", modelId: "glm-image" });
  assert.deepEqual(f.coverRequests.map(request => [request.version, request.model]), [["A", "glm-image"], ["B", "glm-image"]]);
  assert.match(f.coverRequests[0].prompt, /《雨夜未归人》.*陈白狐.*雨声一阵一阵/u);
  assert.match(f.coverRequests[1].prompt, /《夜灯》.*小川.*雨声一阵一阵/u);
  assert.ok(job.files.every(file => file.cover?.path === file.path.replace(/\.wav$/u, ".png")));
});

test("谱乐 uses the selected publishing account and artist independently of its login and defaults", async t => {
  const coreFile = path.join(path.dirname(output), "core.cjs");
  await build({
    entryPoints: ["src/core/index.ts"], outfile: coreFile, bundle: true, platform: "node", format: "cjs", packages: "external",
  });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rainfall-pule-scope-"));
  const core = new Worker(`
    const { parentPort, workerData } = require("node:worker_threads");
    process.argv[2] = workerData.root;
    process.argv[3] = "production";
    process.parentPort = {
      on: (event, run) => parentPort.on(event, data => run({ data })),
      postMessage: data => parentPort.postMessage(data),
    };
    require(workerData.coreFile);
  `, { eval: true, workerData: { root, coreFile } });
  t.after(async () => {
    await core.terminate();
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    await fs.rm(root, { recursive: true, force: true, maxRetries: 3 });
  });
  assert.deepEqual(await once(core, "message"), [{ ready: true }]);
  async function request(method, input = {}) {
    const id = randomUUID();
    const response = once(core, "message");
    core.postMessage({ id, method, input });
    const [message] = await response;
    assert.equal(message.id, id);
    return message.result;
  }
  const call = async (method, input) => {
    const result = await request(method, input);
    assert.equal(result.ok, true, result.error?.code);
    return result.value;
  };
  const addAccount = (name, provider) => call("account.save", { name, provider, dailyLimit: 3 });
  const publication = await addAccount("素素", "fanqie");
  const defaultPublication = await addAccount("默认番茄账号", "fanqie");
  const accounts = [await addAccount("谱乐甲", "yourmusic"), await addAccount("谱乐乙", "yourmusic")];
  const snapshot = await call("snapshot");
  const saved = snapshot.platformConfigurations.find(platform => platform.target === "fanqie");
  await call("platformConfig.setAccount", { target: "fanqie", accountId: defaultPublication.id, expectedRevision: saved?.revision ?? 0 });
  const artist = await call("accountLocalArtist.save", {
    accountId: publication.id, defaults: { ...snapshot.artists[0].defaults, coverResolution: 1440 }, promptTemplateId: null,
    profile: { lyricist: "词作者", composer: "曲作者", singer: "陈白狐", contractMode: "exclusive", gender: "female", voicePersona: "小川" },
    secondSinger: { name: "陈天狐" },
  });
  for (const account of accounts) {
    assert.deepEqual(await call("accountLocalArtist.list", { accountId: account.id }), []);
    const scope = await call("internal.puleBrowser.scope", {
      accountId: account.id, artistId: artist.id, publication: { platform: "fanqie", accountId: publication.id },
    });
    assert.equal(scope.accountName, account.name);
    assert.equal(scope.gender, "female");
    assert.equal(scope.timbre, "小川");
    assert.equal(scope.coverResolution, 1440);
    assert.deepEqual(scope.singers, { A: "陈白狐", B: "陈天狐" });
    assert.deepEqual(scope.archiveFolderNames, { A: "素素_陈白狐_未关联提示词", B: "素素_陈天狐_未关联提示词" });
  }
  const defaultScope = await call("internal.puleBrowser.scope", { accountId: accounts[0].id, artistId: artist.id });
  assert.deepEqual(defaultScope.singers, { A: "陈白狐", B: "陈天狐" });
  assert.deepEqual(defaultScope.archiveFolderNames, { A: "默认番茄账号_陈白狐_未关联提示词", B: "默认番茄账号_陈天狐_未关联提示词" });
  const archiveRoot = path.join(root, "cover-retry-archive");
  await fs.mkdir(archiveRoot);
  await call("internal.downloadArchive.configureDirectory", { root: archiveRoot, expectedRevision: 0 });
  const profile = { id: randomUUID(), providerId: "zhipu_image", kind: "image", modelId: "cogview-3-flash",
    label: "封面测试", executionEnabled: false };
  await call("apiProfile.save", { profile, expectedRevision: null });
  await call("generationConfig.save", { role: "image", profileId: profile.id, expectedRevision: 0 });
  const coverScope = await call("internal.sunoCnBrowser.coverScope", {
    folders: { A: "素素_陈白狐_未关联提示词", B: "素素_陈天狐_未关联提示词" },
  });
  assert.equal(coverScope.archiveRoot, archiveRoot);
  assert.deepEqual(coverScope.coverProfile, { profileId: profile.id, expectedRevision: 1 });
  assert.equal(coverScope.coverResolution, 1440);
  assert.deepEqual(coverScope.singers, { A: "陈白狐", B: "陈天狐" });
  const ark = { ...profile, id: randomUUID(), providerId: "doubao_image", modelId: "doubao-seedream-5-5-261028", label: "方舟配置" };
  await call("apiProfile.save", { profile: ark, expectedRevision: null });
  const sunoAccount = await addAccount("苏诺甲", "suno_cn");
  const choice = { providerId: "doubao_image", profileId: ark.id, modelId: "doubao-seedream-5-0-pro-260628" };
  const coverImage = { ...choice, expectedRevision: 1 };
  const input = { accountId: accounts[0].id, artistId: artist.id, coverImage };
  const expected = { profileId: ark.id, expectedRevision: 1, modelId: choice.modelId };
  assert.deepEqual((await call("internal.puleBrowser.scope", input)).coverProfile, expected);
  assert.deepEqual((await call("internal.sunoCnBrowser.scope", { ...input, accountId: sunoAccount.id })).coverProfile, expected);
  assert.equal((await request("internal.puleBrowser.scope", { ...input, coverImage: { ...coverImage, profileId: profile.id } })).error?.code,
    "IMAGE_PROFILE_REQUIRED");
  assert.equal((await request("internal.puleBrowser.scope", { ...input, coverImage: { ...coverImage, modelId: "glm-image" } })).error?.code,
    "IMAGE_MODEL_REQUIRED");
  await call("apiProfile.save", { profile: { ...ark, label: "更新方舟配置" }, expectedRevision: 1 });
  assert.equal((await request("internal.puleBrowser.scope", input)).error?.code, "REVISION_CONFLICT");
  assert.deepEqual((await call("internal.sunoCnBrowser.coverScope", { coverImage: choice })).coverProfile, { ...expected, expectedRevision: 2 });
  assert.equal((await call("generationConfig.read")).roles.image, profile.id);
  const wrongAccount = await request("internal.puleBrowser.scope", { accountId: publication.id, artistId: artist.id });
  assert.equal(wrongAccount.error?.code, "PULE_ACCOUNT_REQUIRED");
  const wrongPlatform = await request("internal.puleBrowser.scope", {
    accountId: accounts[0].id, artistId: artist.id, publication: { platform: "qqmusic", accountId: publication.id },
  });
  assert.equal(wrongPlatform.error?.code, "PULE_PUBLICATION_ACCOUNT_REQUIRED");
  const wrongArtist = await request("internal.puleBrowser.scope", {
    accountId: accounts[0].id, artistId: artist.id, publication: { platform: "fanqie", accountId: defaultPublication.id },
  });
  assert.equal(wrongArtist.error?.code, "PULE_ARTIST_REQUIRED");
  const legacyArtist = await call("accountLocalArtist.save", {
    accountId: accounts[0].id, defaults: artist.defaults, promptTemplateId: null,
    profile: { lyricist: "作词", composer: "作曲", singer: "旧制作艺人", contractMode: "non_exclusive" },
  });
  const oldScope = await call("internal.puleBrowser.scope", { accountId: accounts[0].id, artistId: legacyArtist.id });
  assert.deepEqual(oldScope.singers, { A: "旧制作艺人", B: "旧制作艺人" });
  const missingArtist = await request("internal.puleBrowser.scope", { accountId: accounts[0].id, artistId: randomUUID() });
  assert.equal(missingArtist.error?.code, "PULE_ARTIST_REQUIRED");
  await call("internal.close");
});

test("parallel 谱乐 accounts use separate profiles and reuse only their own login sessions", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rainfall-pule-profile-"));
  const launchCalls = [];
  const loginRequests = [];
  const loginUrl = platformAccountLoginUrl("yourmusic");
  assert.equal(loginUrl, "https://app.yourmusic.fun/?inviteCode=FJVMEINAXD");
  assert.equal(platformPageUrls.yourmusic, "https://app.yourmusic.fun/create");
  assert.equal(platformAccountLoginUrl("netease"), platformPageUrls.netease);
  const loginLanding = new URL("/", loginUrl).href;
  const oldPageUrl = new URL("/personal", loginUrl).href;
  const signedInPage = '<h1>专属登录窗口</h1><aside><button aria-haspopup="dialog" aria-expanded="false" aria-label="谱乐测试账号 · 更多">个人空间</button></aside>';
  let accountContext;
  const sessions = new PlatformBrowserSessions(root, async (profile, provider) => {
    launchCalls.push({ profile, provider });
    const context = await chromium.launchPersistentContext(profile, {
      ...headlessChromiumOptions(chromium), acceptDownloads: true,
    });
    await context.route("**/*", route => {
      const url = route.request().url();
      if (url === loginUrl) {
        loginRequests.push(url);
        return route.fulfill({ contentType: "text/html; charset=utf-8", body: signedInPage + '<script>history.replaceState(null, "", "/")</script>' });
      }
      if (url === oldPageUrl) return route.fulfill({ contentType: "text/html", body: "<h1>原有页面</h1>" });
      if (url === puleCreateUrl || url === loginLanding) return route.fulfill({ contentType: "text/html; charset=utf-8", body: signedInPage });
      return route.abort();
    });
    if (launchCalls.length === 2) await context.pages()[0].goto(oldPageUrl);
    accountContext = context;
    return context;
  });
  const accountId = randomUUID();
  const otherId = randomUUID();
  const account = { id: accountId, provider: "yourmusic", name: "测试", dailyLimit: 0 };
  const profile = accountBrowserDirectory(root, accountId);
  const abort = new AbortController();
  t.after(async () => {
    abort.abort();
    await sessions.close();
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    await fs.rm(root, { recursive: true, force: true, maxRetries: 3 });
  });
  assert.deepEqual(sessions.status(accountId), { opened: false, savedProfile: false });
  const taskPage = await sessions.withPulePage(accountId, abort.signal, async page => {
    await page.goto(puleCreateUrl);
    assert.equal(await page.getByRole("heading").innerText(), "专属登录窗口");
    return page;
  });
  assert.ok(taskPage.isClosed());
  assert.deepEqual(sessions.status(accountId), { opened: false, savedProfile: true });
  assert.deepEqual(launchCalls, [{ profile, provider: "yourmusic" }]);

  await sessions.open(account, loginUrl, () => {});
  const loginPage = accountContext.pages().find(page => page.url() === loginLanding);
  assert.ok(loginPage);
  assert.deepEqual(loginRequests, [loginUrl]);
  await sessions.open(account, loginUrl, () => {});
  assert.deepEqual(loginRequests, [loginUrl]);
  assert.equal(accountContext.pages().length, 2);
  assert.ok(accountContext.pages().some(page => page.url() === oldPageUrl));
  await loginPage.evaluate(() => {
    sessionStorage.setItem("fixture-pule-session", "signed-in");
    localStorage.setItem("fixture-pule-account", "account-one");
  });
  const reusedTaskPage = await sessions.withPulePage(accountId, abort.signal, async page => {
    assert.equal(launchCalls.length, 2);
    assert.notEqual(page, loginPage);
    await page.goto(puleCreateUrl);
    assert.equal(await page.evaluate(() => sessionStorage.getItem("fixture-pule-session")), "signed-in");
    await assert.rejects(sessions.withPulePage(accountId, abort.signal, async () => {}), /PULE_ACCOUNT_BUSY/);
    const otherPage = await sessions.withPulePage(otherId, abort.signal, async other => {
      await other.goto(puleCreateUrl);
      assert.notEqual(other.context(), page.context());
      assert.equal(await other.evaluate(() => localStorage.getItem("fixture-pule-account")), null);
      await other.evaluate(() => localStorage.setItem("fixture-pule-account", "account-two"));
      assert.equal(await page.evaluate(() => localStorage.getItem("fixture-pule-account")), "account-one");
      assert.equal(sessions.status(accountId).opened, true);
      assert.equal(sessions.status(otherId).opened, true);
      return other;
    });
    assert.ok(otherPage.isClosed());
    assert.ok(!page.isClosed());
    assert.deepEqual(sessions.status(otherId), { opened: false, savedProfile: true });
    assert.deepEqual(launchCalls.at(-1), { profile: accountBrowserDirectory(root, otherId), provider: "yourmusic" });
    const closed = page.waitForEvent("close", { timeout: 3_000 });
    abort.abort();
    await closed;
    return page;
  });
  assert.ok(reusedTaskPage.isClosed());
  assert.equal(await loginPage.getByRole("heading").innerText(), "专属登录窗口");
  assert.deepEqual(sessions.status(accountId), { opened: true, savedProfile: true });
  assert.equal((await sessions.puleStatus(accountId)).puleState, "signed_in");
});

test("task windows on the same music account inherit login and isolate storage and cancellation", async t => {
  const temp = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(temp, "rainfall-task-windows-"));
  const loginUrl = platformAccountLoginUrl("yourmusic");
  const origin = new URL(loginUrl).origin;
  const fixturePage = '<h1>歌曲制作</h1><aside><button aria-haspopup="dialog" aria-expanded="false" aria-label="测试账号 · 更多">个人空间</button></aside>';
  const route = context => context.route("**/*", request => new URL(request.request().url()).origin === origin
    ? request.fulfill({ contentType: "text/html; charset=utf-8", body: fixturePage }) : request.abort());
  let loginContext;
  const headlessLoginReads = [];
  const sessions = new PlatformBrowserSessions(root, async (profile, _provider, headless) => {
    headlessLoginReads.push(headless === true);
    loginContext = await chromium.launchPersistentContext(profile, headlessChromiumOptions(chromium));
    await route(loginContext);
    return loginContext;
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
  const account = { id: randomUUID(), provider: "yourmusic", name: "专属账号", dailyLimit: 1 };
  await sessions.open(account, loginUrl, () => {});
  const loginPage = loginContext.pages()[0];
  await loginPage.evaluate(() => {
    localStorage.setItem("account-fixture", "account");
    sessionStorage.setItem("login-fixture", "session");
    document.cookie = "signed-in=fixture; path=/";
  });
  await loginContext.addCookies([{name:"unrelated",value:"fixture-only",url:"https://fixture.invalid/"}]);

  const scopes = [randomUUID(), randomUUID()].map(runId => ({ runId, accountId: account.id, provider: account.provider }));
  const a = new AbortController(), b = new AbortController();
  const firstReady = Promise.withResolvers(), secondReady = Promise.withResolvers();
  const holdFirst = Promise.withResolvers(), holdSecond = Promise.withResolvers();
  const open = async (scope, signal, ready, hold) => sessions.withTaskMusicPage(scope, signal, async page => {
    await page.goto(puleCreateUrl);
    assert.deepEqual(await page.evaluate(() => [localStorage.getItem("account-fixture"), sessionStorage.getItem("login-fixture"), document.cookie]),
      ["account", "session", "signed-in=fixture"]);
    assert.deepEqual(await page.context().cookies("https://fixture.invalid/"), []);
    ready.resolve(page);
    await hold.promise;
  });
  const first = open(scopes[0], a.signal, firstReady, holdFirst), second = open(scopes[1], b.signal, secondReady, holdSecond);
  const [pageA, pageB] = await Promise.race([
    Promise.all([firstReady.promise, secondReady.promise]),
    first.then(() => assert.fail("first window did not open")),
    second.then(() => assert.fail("second window did not open")),
  ]);
  assert.notEqual(pageA.context().browser(), pageB.context().browser());
  await pageA.evaluate(() => localStorage.setItem("account-fixture", "task A only"));
  assert.equal(await pageB.evaluate(() => localStorage.getItem("account-fixture")), "account");
  assert.equal(await loginPage.evaluate(() => localStorage.getItem("account-fixture")), "account");
  const closed = pageA.waitForEvent("close", { timeout: 4000 });
  a.abort();
  await closed;
  holdFirst.resolve();
  await first;
  assert.equal(pageB.isClosed(), false);
  assert.equal(loginPage.isClosed(), false);
  holdSecond.resolve();
  await second;
  await sessions.withTaskMusicPage(scopes[1], b.signal, async page => assert.equal(page, pageB));
  await sessions.closeTaskWindow(scopes[1].runId);
  assert.ok(pageB.isClosed());

  await sessions.closeAccount(account.id);
  const restored = { ...scopes[0], runId: randomUUID() };
  await sessions.withTaskMusicPage(restored, b.signal, async page => {
    await page.goto(puleCreateUrl);
    assert.equal(await page.evaluate(() => localStorage.getItem("account-fixture")), "account");
  });
  assert.deepEqual(headlessLoginReads, [false, true]);
  await sessions.closeTaskWindow(restored.runId);
});
