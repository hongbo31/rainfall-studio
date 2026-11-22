import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { chromium, expect } from "@playwright/test";
import { build } from "esbuild";
import sharp from "sharp";
import { launchHeadlessChromium } from "../scripts/lib/headless-chromium.mjs";
import { scrollWithPinnedClose } from "./fixtures/pinned-close.mjs";

const project = path.resolve(import.meta.dirname, "..");

test("platform cards open their configured pages and execute through the matching workflows", async t => {
  const renderer = await build({
    absWorkingDir: project, entryPoints: ["src/renderer/main.tsx"], bundle: true, write: false, outdir: "build",
  });
  const accounts = [
    { id: "account-a", name: "腾讯甲", provider: "tme", dailyLimit: 3 },
    { id: "account-b", name: "腾讯乙", provider: "tme", dailyLimit: 3 },
    { id: "fanqie-a", name: "番茄甲", provider: "fanqie", dailyLimit: 3 },
    { id: "fanqie-b", name: "番茄乙", provider: "fanqie", dailyLimit: 3 },
    { id: "qishui-a", name: "汽水甲", provider: "qishui", dailyLimit: 3 },
    { id: "pule-a", name: "谱乐甲", provider: "yourmusic", dailyLimit: 3 },
    { id: "pule-b", name: "谱乐乙", provider: "yourmusic", dailyLimit: 3 },
    { id: "suno-a", name: "Suno 甲", provider: "suno", dailyLimit: 3 },
    { id: "suno-b", name: "Suno 乙", provider: "suno", dailyLimit: 3 },
  ];
  const works = [{ id: "debug-work", title: "调试作品", alternateTitle: "窗边的雨", artistId: "artist-fanqie-b",
    selectedAudioVariant: "B", assets: { audio_A: "a", audio_B: "b" }, config: { genre: "民谣", voice: "female" }, ai: "generated" }];
  const artists = [
    { id: "artist-pule-a", accountId: "pule-a", name: "创作艺人乙", defaults: { voice: "instrumental" } },
    { id: "artist-fanqie-a", accountId: "fanqie-a", name: "创作艺人甲", defaults: { voice: "male" } },
    { id: "artist-fanqie-b", accountId: "fanqie-a", name: "创作艺人乙", accountLocalArtist: true,
      profile: { singer: "创作艺人乙", lyricist: "作者甲", composer: "作者乙", contractMode: "exclusive",
        gender: "female", voicePersona: "小川" },
      defaults: { voice: "female", genre: "苦情歌", coverResolution: 1440 },
      secondSinger: { name: "二号歌手" }, promptTemplateId: "engine-a" },
    { id: "artist-fanqie-c", accountId: "fanqie-b", name: "纯音乐艺人", defaults: { voice: "instrumental", genre: "钢琴" } },
    { id: "artist-tme-a", accountId: "account-b", name: "腾讯艺人", defaults: { voice: "male", genre: "摇滚", coverResolution: 1536 } },
  ];
  const batchPlans = [1, 2, 3, 4].map(number => ({ id: "batch-" + number, title: "计划 " + number, revision: 1 }));
  const plans = [{ id: "plan-a", title: "待发计划", revision: 1, publishes: true }, ...batchPlans];
  const batchTask = { id: "batch-task", title: "部分失败的测试任务", enabled: true, revision: 1, consent: true,
    execution: { kind: "manual" }, steps: [{ kind: "plans", planIds: batchPlans.map(plan => plan.id) }] };
  const batchRun = { id: "batch-run", taskId: batchTask.id, state: "partial", source: "manual",
    detail: "执行完毕 · 成功 3 个 · 失败 1 个", startedAt: "2026-11-20T08:00:00Z", plans: batchPlans, linked: [],
    logs: [{ at: "2026-11-20T08:05:00Z", state: "running", detail: "计划失败 · 2/4 · 计划 2 · PUBLICATION_PLAN_CHANGED" }] };
  const batchProgress = batchPlans.map((plan, index) => ({ planId: plan.id, title: plan.title,
    state: index === 1 ? "failed" : "completed", ...(index === 1 ? {
      runId: "failed-plan-run", reason: "PULE_DOWNLOAD_TIMEOUT", items: [{ id: "failed-song", ordinal: 1, title: "一封信", state: "failed",
        stages: [{ id: "failed-stage", stage: "music_assets", state: "failed", reason: "PULE_DOWNLOAD_TIMEOUT" }] }],
    } : { items: [] }),
  }));
  const tasks = [{ task: {
    id: "task-a", title: "既有任务", enabled: true, revision: 2, consent: true,
    execution: { kind: "manual" }, steps: [
      { kind: "plans", planIds: ["plan-a"] }, { kind: "publish", targets: [{ platform: "qqmusic", accountId: "account-a" }] },
    ],
  } }, { task: batchTask, run: batchRun }];
  const accountChanges = [], savedTasks = [], opened = [], checkedAccounts = [], puleCalls = [];
  const taskExecutionCalls = [];
  const debugCalls = [], openedAccounts = [], lyricCalls = [];
  const modelChanges = [], defaultChanges = [];
  const coverGenerations = [];
  const imageGenerations = [], imageKeyWrites = [], imageKeyChecks = [], imageKeyClears = [];
  const imageKeys = new Map([
    ["zhipu-primary", { secret: "zpfixture5678", mask: "zp*******5678" }],
    ["openai-image-primary", { secret: "opfixture1234", mask: "op*******1234" }],
    ["ark-image-primary", { secret: "arfixture9012", mask: "ar*******9012" }],
  ]);
  const imagePreview = (await sharp({ create: { width: 8, height: 8, channels: 3, background: "navy" } }).jpeg().toBuffer()).toString("base64");
  const lyricTests = new Map();
  const configuredKeys = new Set(["deepseek-primary", "deepseek-secondary", "ark-image-primary"]);
  const textProfiles = [
    { id: "deepseek-secondary", providerId: "deepseek", label: "DeepSeek 备用", modelId: "deepseek-test-b", revision: 1 },
    { id: "deepseek-primary", providerId: "deepseek", label: "DeepSeek 主配置", modelId: "deepseek-test-a", revision: 3 },
    { id: "doubao-primary", providerId: "doubao", label: "方舟测试配置", modelId: "doubao-test", revision: 2 },
  ].map(profile => ({
    ...profile, executionEnabled: false, kind: "text", textPricing: {
      currency: profile.providerId === "doubao" ? "CNY" : "USD", modelId: profile.modelId,
      inputMicrosPerMillionTokens: 1000, outputMicrosPerMillionTokens: 2000,
      source: "fixture", version: "fixture", responseModelIds: [profile.modelId],
    },
  }));
  const modelProfiles = [...textProfiles, {
    id: "zhipu-primary", kind: "image", providerId: "zhipu_image", modelId: "cogview-3-flash",
    label: "智谱测试配置", revision: 2, executionEnabled: false,
  }, {
    id: "ark-image-primary", kind: "image", providerId: "doubao_image", modelId: "doubao-seedream-5-5-261028",
    label: "方舟封面配置", revision: 1, executionEnabled: false,
  }];
  const puleJobs = new Map();
  const sunoRequests = [];
  const sunoCoverRetries = [];
  let savedSunoCoverJob = { id: "suno-cover-job", accountId: "suno-cn-a", title: "封面待补的苏诺曲",
    status: "needs_review", step: "cover", code: "PULE_COVER_HTTP_400", coverErrorCode: "1261", songIds: ["a", "b"],
    files: [ { version: "A", songId: "a", name: "A.wav", path: "A.wav" }, { version: "B", songId: "b", name: "B.wav", path: "B.wav" } ] };
  const archivedPuleJobs = [];
  let downloadConfigured = false;
  let puleStarts = 0;
  let puleHistoryReads = 0;
  let puleState = "unverified";
  let platformWorkflow;
  let platformConfiguration = { target: "qqmusic", accountId: "account-a", revision: 3 };
  const defaults = { revision: 0, roles: { text: "deepseek-primary", image: null, music: null } };
  const configurationHash = "a".repeat(64);
  const accountKey = "b".repeat(64);
  const ok = value => ({ ok: true, value });
  const queuedTrack = { id: "queued-track", folder: "番茄甲_歌手甲_引擎",
    audioName: "目录歌曲甲.wav", title: "目录歌曲甲", singer: "歌手甲" };
  const pausedBatchId = "00000000-0000-4000-8000-000000000001";
  const archiveBatchId = "00000000-0000-4000-8000-000000000002";
  let firstAccountScans = 0;
  let pendingDirectoryBatch = { id: pausedBatchId, state: "needs_review", remaining: 0, issue: "FANQIE_BROWSER_OPERATION_FAILED",
    preferences: { limit: 100, signContract: true }, items: [{ ...queuedTrack, id: "old-track", title: "已投稿作品",
      state: "uploaded", officialStatus: "待授权", workId: "987654321012345600" }] };
  let secondDirectoryBatch = null;

  const browser = await launchHeadlessChromium(chromium);
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  page.setDefaultTimeout(6000);
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.exposeFunction("studioCall", (method, input = {}) => {
    switch (method) {
      case "runtime": return ok({});
      case "snapshot": return ok({ mode: "production", accounts, artists, accountLocalArtists: artists,
        works, assets: [], series: [], exceptions: [], resources: { finished: 0, cost: {}, candidate: {} },
        platformConfigurations: [platformConfiguration, { target: "fanqie", accountId: "fanqie-a", revision: 2 }],
        platformWorkflow: platformWorkflow ?? { profiles: modelProfiles, defaults: defaults.roles } });
      case "apiProfile.list": return ok(modelProfiles);
      case "apiProfile.save": {
        modelChanges.push(input);
        const index = modelProfiles.findIndex(profile => profile.id === input.profile.id);
        assert.equal(modelProfiles[index].revision, input.expectedRevision);
        modelProfiles[index] = { ...input.profile, revision: input.expectedRevision + 1 };
        return ok(modelProfiles[index]);
      }
      case "platformImage.prepareCredential": {
        const profile = modelProfiles.find(profile => profile.kind === "image" && profile.providerId === input.providerId);
        if (profile) return ok(profile);
        assert.equal(input.providerId, "openai_image");
        const created = { id: "openai-image-primary", kind: "image", providerId: input.providerId,
          modelId: "gpt-image-2.6-flare", label: "OpenAI 封面生成", executionEnabled: false, revision: 1 };
        modelProfiles.push(created);
        return ok(created);
      }
      case "platformImage.setDefault": {
        const profile = modelProfiles.find(profile => profile.id === input.profileId);
        assert.equal(profile?.revision, input.expectedRevision);
        if (input.onlyIfUnset && defaults.roles.image) return ok(defaults);
        if (input.modelId !== profile.modelId) { profile.modelId = input.modelId; profile.revision++; }
        defaultChanges.push({ role: "image", profileId: profile.id, expectedRevision: defaults.revision });
        defaults.roles.image = profile.id;
        defaults.revision++;
        return ok(defaults);
      }
      case "platformImage.generate":
        imageGenerations.push(input);
        return ok({ base64: imagePreview, filename: "腾讯艺人-封面.jpg", resolution: input.resolution });
      case "textConfig.list": return ok([]);
      case "promptLibrary.list": return ok([{ id: "engine-a", name: "苦情歌引擎" }]);
      case "generationConfig.read": return ok(defaults);
      case "generationConfig.save": {
        defaultChanges.push(input);
        assert.equal(defaults.revision, input.expectedRevision);
        defaults.roles[input.role] = input.profileId;
        defaults.revision++;
        return ok(defaults);
      }
      case "cover.list": {
        const image = modelProfiles.find(profile => profile.id === defaults.roles.image);
        const manualCover = image ? { providerId: image.providerId, modelId: image.modelId } : null;
        return ok({ requests: [], receipts: [], manualCover });
      }
      case "cover.inboxStatus": return ok([]);
      case "cover.generate":
        coverGenerations.push(input);
        return ok({ requestId: input.requestId, manualGeneration: true, state: "waiting" });
      case "planCenter.list": return ok({ plans });
      case "platformConfig.setAccount":
        accountChanges.push(input);
        platformConfiguration = { target: input.target, accountId: input.accountId, revision: input.expectedRevision + 1 };
        return ok(platformConfiguration);
      case "account.save": {
        assert.equal(input.provider, "suno_cn");
        const account = { id: "suno-cn-a", ...input };
        accounts.push(account);
        return ok(account);
      }
      case "publish.preview":
        debugCalls.push({ method, input });
        return ok({ title: "调试作品", recordingSlot: "audio_B", issues: [input.target === "douyin" ? "缺少视频" : "缺少封面"] });
      case "publish.simple": {
        debugCalls.push({ method, input });
        const [target] = input.targets;
        return ok({ pipeline: [{ id: "debug-" + target, workId: input.workIds[0], title: "调试作品",
          accountId: input.accountOverrides[target], targets: input.targets, state: "needs_materials" }] });
      }
      case "publish.qishui.fill":
        debugCalls.push({ method, input });
        return ok({ stage: "form_ready" });
      case "accountSession.open":
        openedAccounts.push(input);
        return ok({ opened: true, savedProfile: true,
          ...(input.accountId === "pule-b" ? { puleState } : {}),
          ...(input.accountId === "fanqie-a" ? { profileVerified: true } : {}),
        });
      case "accountSession.status": return input.accountId === "pule-b"
        ? ok({ opened: true, savedProfile: true, puleState })
        : ok({ opened: false, savedProfile: false });
      case "lyricWriting.start": {
        lyricCalls.push(input);
        const job = { id: input.id, state: "ready", phase: "generate", versions: [] };
        lyricTests.set(input.id, job);
        return ok(job);
      }
      case "lyricWriting.read": return ok(lyricTests.get(input.id));
      case "puleBrowser.status": return ok([...puleJobs.values()].reverse());
      case "sunoCnBrowser.status": return ok([savedSunoCoverJob]);
      case "sunoCnBrowser.history": return ok([{ id: "legacy-suno-job", accountId: "suno-cn-a", title: "已生成的苏诺曲",
        status: "needs_review", step: "download", code: "PULE_BROWSER_INTERRUPTED", songIds: ["A", "B"], files: [] }, savedSunoCoverJob]);
      case "sunoCnBrowser.retryCovers":
        sunoCoverRetries.push(input);
        savedSunoCoverJob = { ...savedSunoCoverJob, status: "completed", code: undefined, coverErrorCode: undefined,
          files: savedSunoCoverJob.files.map(file => ({ ...file, cover: { name: file.version + ".png", path: file.version + ".png" } })) };
        return ok(savedSunoCoverJob);
      case "sunoCnBrowser.start": {
        sunoRequests.push(input);
        return ok({ id: input.requestId, title: input.title, accountId: input.accountId, step: "opening", status: "running", files: [] });
      }
      case "puleBrowser.history":
        puleHistoryReads += 1;
        return ok([...puleJobs.values()].reverse().concat(archivedPuleJobs));
      case "puleBrowser.chooseAudio": return ok({ token: "cover-audio", name: "翻唱素材.wav" });
      case "puleBrowser.start": {
        puleStarts += 1;
        if (!downloadConfigured) return { ok: false, error: { code: "DOWNLOAD_ROOT_REQUIRED", message: "DOWNLOAD_ROOT_REQUIRED" } };
        puleCalls.push({ method, input });
        const job = { id: input.requestId, accountId: input.accountId, title: input.title, mode: input.mode,
          accountName: accounts.find(account => account.id === input.accountId).name, step: "login", status: "running",
          updatedAt: new Date().toISOString(), files: [] };
        puleJobs.set(input.accountId, job);
        return ok(job);
      }
      case "puleBrowser.confirm":
      case "puleBrowser.stop": {
        puleCalls.push({ method, input });
        const job = [...puleJobs.values()].find(item => item.id === input.id);
        const stopping = method === "puleBrowser.stop";
        return ok(Object.assign(job, stopping ? { status: "stopped", code: "PULE_STOPPED" }
          : { status: "running", step: "processing", quote: undefined }));
      }
      case "publicationTasks.list": return ok({ tasks: tasks.map(row => row.task.id === input.expandedTaskId && row.run?.id === batchRun.id
        ? { ...row, planProgress: batchProgress } : row), plans });
      case "publicationTasks.history": return ok(input.id === batchTask.id ? [{
        ...batchRun,
        logs: [...batchRun.logs, ...Array.from({ length: 12 }, (_, index) => ({
          at: batchRun.logs[0].at, state: "running", detail: "发布进度 " + (index + 1),
        }))],
      }] : []);
      case "publicationTasks.start": {
        taskExecutionCalls.push({ method, input });
        const row = tasks.find(row => row.task.id === input.id);
        row.run = { ...batchRun, id: "current-task-run", state: "waiting", detail: "正在执行第一个计划" };
        return ok(row.run);
      }
      case "publicationTasks.stop": {
        taskExecutionCalls.push({ method, input });
        const row = tasks.find(row => row.run?.id === input.id);
        row.run = { ...row.run, state: "stopped", detail: "已停止后续步骤" };
        return ok(row.run);
      }
      case "publicationTasks.save":
        savedTasks.push(input);
        tasks.push({ task: { ...input.task, revision: 1, enabled: true } });
        return ok(input.task);
      default: return { ok: false, error: { code: "UNEXPECTED_FIXTURE_CALL", message: method } };
    }
  });
  await page.exposeFunction("studioOpenOfficial", provider => {
    opened.push(provider);
    return ok(true);
  });
  await page.exposeFunction("studioCredentialStatus", ({ profileId, includeMaskedKey }) => ok({
    profileId, configured: configuredKeys.has(profileId), state: configuredKeys.has(profileId) ? "stored_unverified" : "absent",
    maskedKey: includeMaskedKey && configuredKeys.has(profileId) ? imageKeys.get(profileId)?.mask : undefined,
  }));
  await page.exposeFunction("studioWriteCredential", ({ profileId, expectedRevision, secret }) => {
    assert.equal(modelProfiles.find(profile => profile.id === profileId)?.revision, expectedRevision);
    assert.equal(secret, imageKeys.get(profileId)?.secret);
    imageKeyWrites.push(profileId);
    configuredKeys.add(profileId);
    return ok({ profileId, configured: true, state: "stored_unverified", maskedKey: imageKeys.get(profileId).mask });
  });
  await page.exposeFunction("studioCheckCredential", ({ profileId, expectedRevision }) => {
    const profile = modelProfiles.find(profile => profile.id === profileId);
    assert.equal(profile?.revision, expectedRevision);
    assert.equal(configuredKeys.has(profileId), true);
    imageKeyChecks.push(profileId);
    const invalid = profile.providerId === "openai_image";
    return ok({ profileId, providerId: profile.providerId, state: invalid ? "unauthorized" : "connected",
      httpStatus: invalid ? 401 : 200, failureCode: null, scope: "authentication_only", paidGenerationRequested: false });
  });
  await page.exposeFunction("studioClearCredential", ({ profileId, expectedRevision }) => {
    assert.equal(modelProfiles.find(profile => profile.id === profileId)?.revision, expectedRevision);
    imageKeyClears.push(profileId);
    configuredKeys.delete(profileId);
    return ok({ profileId, configured: false, state: "absent" });
  });
  await page.exposeFunction("studioFanqie", (method, input) => {
    if (method === "status") return ok({ connected: false, report: null });
    if (method === "downloadStatus") return ok(input.accountId === "fanqie-a" ? pendingDirectoryBatch : secondDirectoryBatch);
    if (method === "previewDownloads") {
      const second = input.accountId === "fanqie-b";
      if (!second) {
        firstAccountScans++;
        return ok({ fingerprint: "a".repeat(64), configurationRequired: false, limit: 100,
          items: [queuedTrack], batch: pendingDirectoryBatch });
      }
      return ok({ fingerprint: "b".repeat(64), configurationRequired: false, limit: 100,
        items: secondDirectoryBatch?.issue ? [] : [{ id: "archive-track", folder: "番茄乙_歌手乙_引擎", audioName: "目录歌曲.wav",
          title: "目录歌曲乙", singer: "歌手乙" }], batch: secondDirectoryBatch });
    }
    if (method === "publishDownloads" || method === "reconcileDownloads") {
      debugCalls.push({ method, input });
      if (input.accountId === "fanqie-a") {
        pendingDirectoryBatch = { id: "00000000-0000-4000-8000-000000000003", state: "complete",
          items: [{ ...queuedTrack, state: "uploaded", officialStatus: "审核中", workId: "987654321012345601" }] };
        return ok(pendingDirectoryBatch);
      }
      secondDirectoryBatch = { id: archiveBatchId, hasDiagnostics: true, preferences: { limit: 2, signContract: true },
        ...(method === "publishDownloads" ? { state: "needs_review", issue: "FANQIE_DOWNLOAD_CLEANUP_FAILED" }
          : { state: "awaiting_signature", signatureStage: "manual_confirmation" }),
        items: [{ id: "archive-track", folder: "番茄乙_歌手乙_引擎", audioName: "目录歌曲.wav",
          title: "目录歌曲乙", singer: "歌手乙", state: "uploaded", workId: "987654321012345678", officialStatus: "待授权" }] };
      return ok(secondDirectoryBatch);
    }
    checkedAccounts.push({ method, input });
    if (method === "configuration") return ok({ configurationHash });
    if (method === "open") return ok({ connected: true, report: null });
    return ok({ connected: true, report: { complete: true, accountKey } });
  });
  const url = "http://127.0.0.1/";
  await page.route("**/*", route => route.request().url() === url
    ? route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="zh-CN"><div id="root"></div></html>' })
    : route.abort());
  await page.addInitScript(() => {
    window.rainfall = {
      call: window.studioCall, openOfficial: window.studioOpenOfficial,
      fanqieCatalog: window.studioFanqie, fanqieUpload: window.studioFanqie,
      apiCredentialStatus: window.studioCredentialStatus,
      writeApiCredential: window.studioWriteCredential,
      checkApiConnection: window.studioCheckCredential,
      clearApiCredential: window.studioClearCredential,
    };
  });
  await page.goto(url);
  await page.addStyleTag({ content: renderer.outputFiles.find(file => file.path.endsWith(".css")).text });
  await page.addScriptTag({ content: renderer.outputFiles.find(file => file.path.endsWith(".js")).text });

  const navigation = page.getByRole("navigation");
  await navigation.getByRole("button", { name: "平台管理", exact: true }).click();
  const labels = await navigation.getByRole("button").allTextContents();
  const lyricsIndex = labels.findIndex(label => label.includes("AI作词"));
  assert.match(labels[lyricsIndex + 1], /平台管理$/);
  assert.match(labels[lyricsIndex + 2], /计划中心$/);
  assert.match(labels[lyricsIndex + 3], /任务中心$/);
  const platforms = page.getByRole("region", { name: "发布平台", exact: true });
  await expect(platforms.getByRole("heading", { level: 3 })).toHaveText([
    "网易云音乐", "汽水音乐", "QQ 音乐", "酷狗音乐", "抖音视频", "番茄音乐",
  ]);
  await expect(platforms.getByText("支持工作流发布", { exact: true })).toHaveCount(3);
  await expect(platforms.getByText("暂不支持工作流发布", { exact: true })).toHaveCount(2);
  await expect(platforms.getByRole("article", { name: "汽水音乐", exact: true })
    .getByText("支持计划工作流发布", { exact: true })).toBeVisible();
  const qq = platforms.getByRole("article", { name: "QQ 音乐", exact: true });
  const openPage = card => card.getByRole("button", { name: /^打开 .* 页面$/u });
  const execute = card => card.getByRole("button", { name: "执行", exact: true });
  const allCards = page.locator(".platform-management-grid > article").filter({
    has: page.getByRole("button", { name: "执行", exact: true }),
  });
  await expect(allCards).toHaveCount(15);
  for (const card of await allCards.all()) {
    const header = card.locator(":scope > .platform-management-card-header");
    await expect(openPage(header)).toBeVisible();
    await expect(execute(header)).toBeVisible();
    await expect(header.getByRole("button")).toHaveCount(2);
  }
  async function checkCardLayout(width) {
    await page.setViewportSize({ width, height: 900 });
    const aligned = await allCards.evaluateAll(cards => cards.every(card => {
      const header = card.querySelector(":scope > .platform-management-card-header");
      const actions = header.querySelector(".platform-management-card-actions").getBoundingClientRect();
      const bounds = header.getBoundingClientRect();
      return Math.abs(actions.right - bounds.right) < 1 && Math.abs(actions.top - bounds.top) < 1 &&
        actions.left >= bounds.left && card.scrollWidth <= card.clientWidth + 1;
    }));
    assert.ok(aligned, "actions fit the top-right of every card at " + width);
  }
  await checkCardLayout(1000);
  await checkCardLayout(1360);
  const qqDefault = qq.getByRole("combobox", { name: "QQ 音乐默认发布账号" });
  await expect(qqDefault).toHaveValue("account-a");
  await qqDefault.selectOption("account-b");
  await expect(qqDefault).toHaveValue("account-b");
  assert.deepEqual(accountChanges, [{ target: "qqmusic", accountId: "account-b", expectedRevision: 3 }]);
  await openPage(qq).click();
  await expect(qq.getByRole("status")).toHaveText("请在专属窗口核对登录");
  await openPage(platforms.getByRole("article", { name: "番茄音乐", exact: true })).click();
  await expect(platforms.getByRole("article", { name: "番茄音乐", exact: true }).getByRole("status")).toHaveText("登录已核对");
  assert.deepEqual(openedAccounts, [{ accountId: "account-b" }, { accountId: "fanqie-a" }]);
  assert.deepEqual(opened, []);
  await openPage(platforms.getByRole("article", { name: "网易云音乐", exact: true })).click();
  await expect.poll(() => opened).toEqual(["netease"]);

  await expect(platforms.getByRole("button", { name: "执行", exact: true })).toHaveCount(6);
  const openDebug = async title => {
    await platforms.getByRole("article", { name: title, exact: true }).getByRole("button", { name: "执行", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: title + (title === "番茄音乐" ? " · 目录上传" : " · 自动化调试") });
    await expect(dialog).toBeVisible();
    const bounds = await dialog.boundingBox();
    assert.ok(bounds && Math.abs(bounds.x + bounds.width - page.viewportSize().width) <= 1);
    return dialog;
  };
  const selectWork = dialog => dialog.getByRole("combobox", { name: "作品", exact: true }).selectOption("debug-work");
  const closeDebug = dialog => dialog.getByRole("button", { name: "关闭", exact: true }).click();
  const fanqieDebug = await openDebug("番茄音乐");
  const debugAccount = fanqieDebug.getByRole("combobox", { name: "发布账号", exact: true });
  await expect(debugAccount).toHaveValue("fanqie-a");
  await expect(fanqieDebug.getByText("需核对投稿", { exact: true })).toBeVisible();
  const limit = fanqieDebug.getByRole("spinbutton", { name: "每批上传上限" });
  const signContract = fanqieDebug.getByRole("combobox", { name: "是否签约" });
  await expect(limit).toBeEditable();
  await expect(signContract).toBeEnabled();
  await expect(signContract.locator("option")).toHaveText(["是，签署后继续", "否，合同生成后继续"]);
  const downloads = fanqieDebug.getByRole("region", { name: "下载目录歌曲", exact: true });
  await expect(downloads.getByText("目录歌曲甲", { exact: true })).toBeVisible();
  assert(await downloads.evaluate(section =>
    !!section.previousElementSibling?.querySelector('input[type="number"]') &&
    section.nextElementSibling?.getAttribute("aria-label") === "最近一批投稿"
  ), "upload settings precede the download list, which sits directly above the latest submission");
  const executeUpload = fanqieDebug.getByRole("button", { name: "执行上传", exact: true });
  const separateActions = fanqieDebug.getByRole("button", { name: /核对投稿状态|恢复批次|核对并继续下一批/u });
  const confirmRemaining = fanqieDebug.getByRole("checkbox", { name: /确认本批/ });
  await expect(separateActions).toHaveCount(0);
  await expect(executeUpload).toBeDisabled();
  await expect(confirmRemaining).toBeEnabled();
  await limit.fill("6");
  await signContract.selectOption("false");
  const scansBefore = firstAccountScans;
  await downloads.getByRole("button", { name: "重新扫描", exact: true }).click();
  await expect.poll(() => firstAccountScans).toBe(scansBefore + 1);
  await expect(downloads.getByRole("button", { name: "重新扫描", exact: true })).toBeEnabled();
  await expect(limit).toHaveValue("6");
  await expect(signContract).toHaveValue("false");
  assert.deepEqual(debugCalls, [], "editing and rescanning do not start uploads");
  await expect(confirmRemaining).toBeEnabled();
  await expect(executeUpload).toBeDisabled();
  await confirmRemaining.check();
  await expect(executeUpload).toBeEnabled();
  await limit.fill("101");
  await expect(executeUpload).toBeDisabled();
  await limit.fill("6");
  await expect(confirmRemaining).not.toBeChecked();
  await expect(executeUpload).toBeDisabled();
  await confirmRemaining.check();
  await executeUpload.click();
  await expect(fanqieDebug.getByText("审核中 · 作品 ID 987654321012345601", { exact: true })).toBeVisible();
  await expect(separateActions).toHaveCount(0);
  await expect(executeUpload).toBeDisabled();
  await expect(confirmRemaining).not.toBeChecked();
  await debugAccount.selectOption("fanqie-b");
  await expect(fanqieDebug.getByText("目录歌曲乙", { exact: true })).toBeVisible();
  await expect(fanqieDebug.getByText("歌手乙", { exact: true })).toBeVisible();
  await expect(fanqieDebug.getByRole("combobox", { name: "作品", exact: true })).toHaveCount(0);
  await expect(fanqieDebug.getByRole("button", { name: "执行上传", exact: true })).toBeDisabled();
  assert.equal(debugCalls.length, 1, "one click starts the new upload without a separate recovery call");
  await expect(fanqieDebug.getByRole("combobox", { name: "是否签约" }).locator("option"))
    .toHaveText(["是，签署后继续", "否，合同生成后继续"]);
  await fanqieDebug.getByRole("spinbutton", { name: "每批上传上限" }).fill("2");
  await fanqieDebug.getByRole("combobox", { name: "是否签约" }).selectOption("true");
  await expect(fanqieDebug.getByText("本批最多处理 1 首", { exact: true })).toBeVisible();
  await fanqieDebug.getByRole("checkbox", { name: /确认本批/ }).check();
  await fanqieDebug.getByRole("button", { name: "执行上传", exact: true }).click();
  await expect(fanqieDebug.getByText(/下载文件未能移入回收站/)).toBeVisible();
  await expect(downloads.getByText("该账号的下载目录下暂无歌曲。", { exact: true })).toBeVisible();
  await expect(separateActions).toHaveCount(0);
  await confirmRemaining.check();
  await executeUpload.click();
  await expect(fanqieDebug.getByRole("region", { name: "最近一批投稿" }).getByRole("status")).toHaveText("等待你确认签署");
  await expect(fanqieDebug.getByText("在番茄页面核对合同后，点击「确认签署」。", { exact: true })).toBeVisible();
  await expect(fanqieDebug.getByText("待授权 · 作品 ID 987654321012345678", { exact: true })).toBeVisible();
  await expect(separateActions).toHaveCount(0);
  await expect(executeUpload).toBeDisabled();
  secondDirectoryBatch = { ...secondDirectoryBatch, state: "complete", signatureStage: undefined,
    items: secondDirectoryBatch.items.map(item => ({ ...item, officialStatus: "审核中" })) };
  await expect(fanqieDebug.getByText("审核中 · 作品 ID 987654321012345678", { exact: true })).toBeVisible();
  await expect(fanqieDebug.getByRole("button", { name: "打开执行日志", exact: true })).toBeVisible();
  await expect(separateActions).toHaveCount(0);
  const viewport = page.viewportSize();
  await page.setViewportSize({ ...viewport, height: 450 });
  const fanqieClose = await scrollWithPinnedClose(executeUpload, fanqieDebug.getByRole("button", { name: "关闭", exact: true }));
  await page.mouse.click(fanqieClose.x, fanqieClose.y);
  await expect(fanqieDebug).toHaveCount(0);
  await page.setViewportSize(viewport);
  await expect(platforms.getByRole("article", { name: "番茄音乐", exact: true })
    .getByRole("combobox", { name: "番茄音乐默认发布账号" })).toHaveValue("fanqie-a");

  const qqDebug = await openDebug("QQ 音乐");
  await expect(qqDebug.getByRole("combobox", { name: "发布账号", exact: true })).toHaveValue("account-b");
  await selectWork(qqDebug);
  await qqDebug.getByRole("button", { name: "执行发布准备", exact: true }).click();
  await expect(qqDebug.getByRole("region", { name: "发布进度" }).getByText("待补材料", { exact: true })).toBeVisible();
  await closeDebug(qqDebug);

  const kugouDebug = await openDebug("酷狗音乐");
  await selectWork(kugouDebug);
  const prepareKugou = kugouDebug.getByRole("button", { name: "执行发布准备", exact: true });
  await expect(prepareKugou).toBeDisabled();
  await kugouDebug.getByRole("combobox", { name: "发布账号", exact: true }).selectOption("account-a");
  await selectWork(kugouDebug);
  await prepareKugou.click();
  await expect(kugouDebug.getByRole("region", { name: "发布进度" }).getByText("腾讯甲", { exact: true })).toBeVisible();
  await closeDebug(kugouDebug);

  const qishuiDebug = await openDebug("汽水音乐");
  await expect(qishuiDebug.getByRole("combobox", { name: "发布账号", exact: true })).toHaveValue("qishui-a");
  await selectWork(qishuiDebug);
  await expect(qishuiDebug.getByRole("textbox", { name: "表演者", exact: true })).toHaveValue("二号歌手");
  await qishuiDebug.getByRole("button", { name: "填写并上传到官网", exact: true }).click();
  await expect(qishuiDebug.getByText("已填表上传，请核对官网", { exact: true })).toBeVisible();
  await closeDebug(qishuiDebug);

  const douyinDebug = await openDebug("抖音视频");
  await selectWork(douyinDebug);
  await douyinDebug.getByRole("button", { name: "执行预检", exact: true }).click();
  await expect(douyinDebug.getByText("缺少视频", { exact: true })).toBeVisible();
  await expect(douyinDebug.getByRole("button", { name: "执行上传", exact: true })).toHaveCount(0);
  await closeDebug(douyinDebug);
  const neteaseDebug = await openDebug("网易云音乐");
  await selectWork(neteaseDebug);
  await neteaseDebug.getByRole("button", { name: "执行预检", exact: true }).click();
  await expect(neteaseDebug.getByText("缺少封面", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(neteaseDebug).toHaveCount(0);
  assert.deepEqual(debugCalls, [
    { method: "publishDownloads", input: { accountId: "fanqie-a", fingerprint: "a".repeat(64), consent: true,
      limit: 6, signContract: false, replaceBatchId: pausedBatchId } },
    { method: "publishDownloads", input: { accountId: "fanqie-b", fingerprint: "b".repeat(64), consent: true, limit: 2, signContract: true } },
    { method: "reconcileDownloads", input: { accountId: "fanqie-b", batchId: archiveBatchId, preferences: { limit: 2, signContract: true } } },
    { method: "publish.simple", input: { workIds: ["debug-work"], targets: ["qqmusic"], accountOverrides: { qqmusic: "account-b" } } },
    { method: "publish.simple", input: { workIds: ["debug-work"], targets: ["kugou"], accountOverrides: { kugou: "account-a" } } },
    { method: "publish.qishui.fill", input: { accountId: "qishui-a", workId: "debug-work", variant: "B",
      useVersionMetadata: true, performer: "二号歌手", composer: "作者乙", lyricist: "作者甲", ai: true, aiTool: "Suno" } },
    { method: "publish.preview", input: { target: "douyin", accountId: null, workId: "debug-work" } },
    { method: "publish.preview", input: { target: "netease", accountId: null, workId: "debug-work" } },
  ]);

  const models = page.getByRole("region", { name: "文本模型", exact: true });
  const deepseek = models.getByRole("article", { name: "DeepSeek", exact: true });
  const doubao = models.getByRole("article", { name: "豆包 / 火山方舟", exact: true });
  const codex = models.getByRole("article", { name: "Codex CLI / SDK", exact: true });
  await expect(deepseek
    .getByText("支持工作流调用", { exact: true })).toBeVisible();
  await expect(doubao
    .getByText("支持工作流调用", { exact: true })).toBeVisible();
  await expect(codex
    .getByText("可选 · 本地适配器未配置", { exact: true })).toBeVisible();
  await openPage(deepseek).click();
  await expect.poll(() => opened.at(-1)).toBe("deepseek");
  await openPage(doubao).click();
  await expect.poll(() => opened.at(-1)).toBe("doubao");
  await execute(codex).click();
  await expect(codex.getByRole("status")).toHaveText("自动化暂未接入");
  assert.deepEqual(lyricCalls, []);
  await execute(deepseek).click();
  const deepseekTest = page.getByRole("dialog", { name: "DeepSeek · 自动化调试" });
  await expect(deepseekTest.getByLabel("模型配置", { exact: true })).toHaveValue("deepseek-primary");
  await expect(deepseekTest.getByRole("option", { name: /方舟测试配置/u })).toHaveCount(0);
  const brief = "测试词只写夜归的街灯";
  await deepseekTest.getByRole("textbox", { name: "测试内容" }).fill(brief);
  assert.deepEqual(lyricCalls, [], "opening the test does not submit a paid job");
  await deepseekTest.getByRole("button", { name: "开始测试", exact: true }).click();
  await expect.poll(() => lyricCalls.length).toBe(1);
  assert.deepEqual({ ...lyricCalls[0], id: "id" }, { id: "id", mode: "inspiration", artistId: null,
    inspiration: brief, profileId: "deepseek-primary", profileRevision: 3, maxRewrites: 0, consent: true });
  const lyricJob = lyricTests.get(lyricCalls[0].id);
  Object.assign(lyricJob, { state: "complete", versions: [{ id: "v-a", title: "灯火", alternateTitle: "晚归", style: "民谣",
    lyrics: "街灯照我回家", review: { score: 97, languageMatches: true } }] });
  await expect(deepseekTest.getByText("街灯照我回家", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 600, height: 350 });
  const textClose = await scrollWithPinnedClose(deepseekTest.getByRole("textbox", { name: "测试内容" }),
    deepseekTest.getByRole("button", { name: "关闭", exact: true }));
  await page.mouse.click(textClose.x, textClose.y);
  await expect(deepseekTest).toHaveCount(0);
  await page.setViewportSize(viewport);

  await execute(doubao).click();
  const doubaoTest = page.getByRole("dialog", { name: "豆包 / 火山方舟 · 自动化调试" });
  await expect(doubaoTest.getByLabel("模型配置", { exact: true })).toHaveValue("doubao-primary");
  const testDoubao = doubaoTest.getByRole("button", { name: "开始测试", exact: true });
  await testDoubao.click();
  await expect(doubaoTest.getByRole("alert")).toContainText("API Key");
  assert.equal(lyricCalls.length, 1);
  configuredKeys.add("doubao-primary");
  await testDoubao.click();
  await expect.poll(() => lyricCalls.length).toBe(2);
  assert.equal(lyricCalls[1].profileId, "doubao-primary");
  assert.equal(lyricCalls[1].profileRevision, 2);
  lyricTests.get(lyricCalls[1].id).state = "rejected";
  await expect(doubaoTest.getByRole("status")).toHaveText("评分已完成 · 未达标");
  await closeDebug(doubaoTest);
  await models.getByRole("button", { name: "配置模型 API", exact: true }).click();
  const textSettings = page.getByRole("dialog", { name: "配置文本模型", exact: true });
  const deepseekSettings = textSettings.getByRole("article", { name: "DeepSeek 主配置", exact: true });
  const doubaoSettings = textSettings.getByRole("article", { name: "方舟测试配置", exact: true });
  await expect(textSettings.getByRole("combobox", { name: "API 平台", exact: true })).toHaveValue("deepseek");
  await expect(doubaoSettings.getByRole("option", { name: "Doubao Seed 2.1 Lite", exact: true })).toBeAttached();
  await expect(deepseekSettings.getByRole("option", { name: "DeepSeek V4.1 Flash-1017", exact: true })).toBeAttached();
  await expect(textSettings.getByRole("article", { name: "智谱测试配置", exact: true })).toHaveCount(0);
  await deepseekSettings.getByLabel("官方模型", { exact: true }).selectOption("deepseek-v4-pro");
  await deepseekSettings.getByRole("button", { name: "保存模型与计费", exact: true }).click();
  await expect.poll(() => modelChanges.length).toBe(1);
  assert.equal(modelChanges[0].profile.modelId, "deepseek-v4-pro");
  assert.equal(modelChanges[0].profile.textPricing.modelId, "deepseek-v4-pro");
  assert.equal(modelChanges[0].profile.textPricing.outputMicrosPerMillionTokens, 3_960_000);
  await closeDebug(textSettings);
  await execute(deepseek).click();
  await expect(deepseekTest.getByRole("option", { name: /主配置 · deepseek-v4-pro/u })).toBeAttached();
  await closeDebug(deepseekTest);

  const imageModels = page.getByRole("region", { name: "图像模型", exact: true });
  await expect(imageModels.getByText("GPT Image 2.6 Sunburst", { exact: true })).toBeVisible();
  await expect(imageModels.getByText(/GLM-Image.*¥0.10\/次/u)).toBeVisible();
  const arkImage = imageModels.getByRole("article", { name: "豆包 / 火山方舟", exact: true });
  await expect(arkImage.getByText("Doubao Seedream 5.5", { exact: true })).toBeVisible();
  await expect(arkImage.getByText("Doubao Seedream 5.0 Pro", { exact: true })).toBeVisible();
  for (const [title, provider] of [["OpenAI 封面生成", "openai_image"], ["智谱 AI", "zhipu_image"], ["豆包 / 火山方舟", "doubao_image"]]) {
    const card = imageModels.getByRole("article", { name: title, exact: true });
    await openPage(card).click();
    await expect.poll(() => opened.at(-1)).toBe(provider);
  }
  await navigation.getByRole("button", { name: "配置中心", exact: true }).click();
  await expect(page.getByText("文本服务配置", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "封面图片", exact: true }).click();
  const imageSettings = page.getByRole("form", { name: "封面 API", exact: true });
  await expect(imageSettings.locator("input, select, textarea")).toHaveCount(2);
  const imageProvider = imageSettings.getByLabel("提供商 / 渠道", { exact: true });
  const apiKey = imageSettings.getByLabel("API Key", { exact: true });
  const saveKey = imageSettings.getByRole("button", { name: "保存 Key", exact: true });
  const checkKey = imageSettings.getByRole("button", { name: "检查连接", exact: true });
  await expect(apiKey).toHaveAttribute("type", "password");
  for (const [provider, profileId] of [["zhipu_image", "zhipu-primary"], ["openai_image", "openai-image-primary"]]) {
    await imageProvider.selectOption(provider);
    await expect(apiKey).toHaveValue("");
    await apiKey.fill(imageKeys.get(profileId).secret);
    await saveKey.click();
    await expect.poll(() => imageKeyWrites.at(-1)).toBe(profileId);
    await expect(imageSettings.getByText("已保存 Key", { exact: true })).toBeVisible();
    await expect(apiKey).toHaveValue(imageKeys.get(profileId).mask);
    await expect(apiKey).toHaveAttribute("readonly", "");
    await expect(saveKey).toBeDisabled();
    assert.ok(!imageKeyChecks.includes(profileId), "saving a key performs no connection check");
    await checkKey.click();
    await expect.poll(() => imageKeyChecks.at(-1)).toBe(profileId);
    await expect(imageSettings.getByRole("status")).toContainText(provider === "openai_image" ? "API Key 认证失败" : "API Key 已通过认证");
  }
  await expect(page.getByText("文本服务配置", { exact: true })).toHaveCount(0);
  await imageSettings.getByRole("button", { name: "清除 Key", exact: true }).click();
  await expect(apiKey).toHaveValue("");
  await expect(checkKey).toBeDisabled();
  assert.deepEqual(imageKeyClears, ["openai-image-primary"]);
  await imageProvider.selectOption("zhipu_image");
  await expect(apiKey).toHaveValue(imageKeys.get("zhipu-primary").mask);
  await expect(imageSettings.getByText("API Key 认证失败", { exact: false })).toHaveCount(0);
  await imageSettings.getByRole("button", { name: "更换 Key", exact: true }).click();
  await expect(apiKey).toHaveValue("");
  await expect(apiKey).toHaveAttribute("type", "password");
  await expect(checkKey).toBeDisabled();
  await imageProvider.selectOption("doubao_image");
  await expect(apiKey).toHaveValue(imageKeys.get("ark-image-primary").mask);
  await checkKey.click();
  await expect(imageSettings.getByRole("status")).toContainText("API Key 已通过认证");
  assert.deepEqual(imageKeyWrites, ["zhipu-primary", "openai-image-primary"]);
  assert.deepEqual(imageKeyChecks, ["zhipu-primary", "openai-image-primary", "ark-image-primary"]);
  await page.getByRole("tab", { name: "歌词与提示词", exact: true }).click();
  await expect(page.getByText("文本服务配置", { exact: true })).toBeVisible();
  await navigation.getByRole("button", { name: "平台管理", exact: true }).click();
  await expect(imageModels.getByText(/默认 · 智谱测试配置/u)).toBeVisible();
  assert.deepEqual(defaults.roles, { text: "deepseek-primary", image: "zhipu-primary", music: null });
  await arkImage.getByRole("button", { name: "账号信息", exact: true }).click();
  const arkSettings = page.getByRole("dialog", { name: "豆包 / 火山方舟 · 账号信息", exact: true });
  await expect(arkSettings.locator("input, select, textarea")).toHaveCount(4);
  const selectedModel = arkSettings.getByLabel("图像模型", { exact: true });
  const targetPlatform = arkSettings.getByLabel("发布平台", { exact: true });
  const selectedArtist = arkSettings.getByLabel("艺人", { exact: true });
  await selectedModel.selectOption("doubao-seedream-5-0-pro-260628");
  await targetPlatform.selectOption("fanqie");
  await expect(selectedArtist.locator('option[value="artist-tme-a"]')).toHaveCount(0);
  await selectedArtist.selectOption("artist-fanqie-b");
  await expect(arkSettings.getByText("1440 × 1440", { exact: true })).toBeVisible();
  await targetPlatform.selectOption("qqmusic");
  await expect(selectedArtist).toHaveValue("");
  await selectedArtist.selectOption("artist-tme-a");
  await expect(arkSettings.getByText("1536 × 1536", { exact: true })).toBeVisible();
  await arkSettings.getByLabel("创意描述", { exact: true }).fill("雨夜玻璃上的霓虹倒影");
  await arkSettings.getByRole("button", { name: "生成图片", exact: true }).click();
  await expect.poll(() => imageGenerations.at(-1)).toEqual({ profileId: "ark-image-primary", expectedRevision: 1,
    providerId: "doubao_image", modelId: "doubao-seedream-5-0-pro-260628", platform: "qqmusic", artistId: "artist-tme-a",
    resolution: 1536, prompt: "雨夜玻璃上的霓虹倒影" });
  await expect(arkSettings.getByRole("img", { name: "生成的封面", exact: true })).toBeVisible();
  const downloadLink = arkSettings.getByRole("link", { name: "下载图片", exact: true });
  await expect(downloadLink).toHaveAttribute("download", "腾讯艺人-封面.jpg");
  const downloadReady = page.waitForEvent("download");
  await downloadLink.click();
  const download = await downloadReady;
  assert.equal(download.suggestedFilename(), "腾讯艺人-封面.jpg");
  assert.equal(await download.failure(), null);
  assert.equal(defaults.roles.image, "zhipu-primary");
  await arkSettings.getByRole("button", { name: "设为工作流默认", exact: true }).click();
  await expect.poll(() => defaultChanges.at(-1)).toEqual({ role: "image", profileId: "ark-image-primary", expectedRevision: 1 });
  await closeDebug(arkSettings);
  await expect(imageModels.getByText(/默认 · 方舟封面配置.*doubao-seedream-5-0-pro-260628/u)).toBeVisible();
  assert.equal(lyricCalls.length, 2, "editing models does not implicitly submit a test");
  assert.deepEqual(coverGenerations, [], "saving a model does not generate a cover");
  await navigation.getByRole("button", { name: "封面工作室", exact: true }).click();
  await page.getByRole("button", { name: "用 Doubao Seedream 5.0 Pro 生成封面（参考 ¥0.30/张）", exact: true }).click();
  await expect.poll(() => coverGenerations[0]?.confirmedModelId).toBe("doubao-seedream-5-0-pro-260628");
  assert.equal(coverGenerations[0].workId, "debug-work");
  await navigation.getByRole("button", { name: "平台管理", exact: true }).click();

  const generation = page.getByRole("region", { name: "歌曲生成", exact: true });
  const pule = generation.getByRole("article", { name: "谱乐 AI", exact: true });
  const suno = generation.getByRole("article", { name: "Suno", exact: true });
  const sunoCn = generation.getByRole("article", { name: "苏诺之音", exact: true });
  const miaoxiang = generation.getByRole("article", { name: "妙响", exact: true });
  await expect(generation.getByRole("heading", { name: "谱乐 AI", exact: true })).toBeVisible();
  await expect(pule.getByRole("form", { name: "谱乐 AI 自动制作" })).toHaveCount(0);
  await expect(generation.getByText("支持工作流生成", { exact: true })).toBeVisible();
  await expect(suno
    .getByText("API 合同待核验", { exact: true })).toBeVisible();
  await expect(miaoxiang
    .getByText("API 接入待确认", { exact: true })).toBeVisible();
  await suno.getByLabel("Suno 账号").selectOption("suno-b");
  await openPage(suno).click();
  await expect.poll(() => openedAccounts.at(-1)).toEqual({ accountId: "suno-b" });
  await openPage(miaoxiang).click();
  await expect.poll(() => opened.at(-1)).toBe("miaoxiang");
  await execute(miaoxiang).click();
  await expect(miaoxiang.getByText("自动化暂未接入", { exact: true })).toBeVisible();
  await expect(sunoCn.getByText("官网自动创作", { exact: true })).toBeVisible();
  await openPage(sunoCn).click();
  await expect.poll(() => opened.at(-1)).toBe("suno_cn");
  await sunoCn.getByRole("button", { name: "管理账号", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "账号平台" })).toHaveValue("suno_cn");
  const sunoCnAccounts = page.getByRole("region", { name: "平台账号列表" });
  await expect(sunoCnAccounts.getByText("暂无账号", { exact: true })).toBeVisible();
  await sunoCnAccounts.getByRole("button", { name: "＋ 添加账号", exact: true }).click();
  await sunoCnAccounts.getByRole("textbox", { name: "新账号备注", exact: true }).fill("苏诺创作账号");
  await sunoCnAccounts.getByRole("button", { name: "保存账号", exact: true }).click();
  await expect(sunoCnAccounts.getByRole("button", { name: "苏诺创作账号", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "打开专属登录窗口", exact: true }).click();
  await expect.poll(() => openedAccounts.at(-1)).toEqual({ accountId: "suno-cn-a" });
  await navigation.getByRole("button", { name: "平台管理", exact: true }).click();
  const sunoCnAccount = sunoCn.getByRole("combobox", { name: "苏诺之音 账号", exact: true });
  await expect(sunoCnAccount.locator("option")).toHaveText(["选择账号", "苏诺创作账号"]);
  await expect(sunoCnAccount).toHaveValue("suno-cn-a");
  await openPage(sunoCn).click();
  await expect.poll(() => openedAccounts.at(-1)).toEqual({ accountId: "suno-cn-a" });
  await execute(sunoCn).click();
  const sunoForm = page.getByRole("form", { name: "苏诺之音 自动制作", exact: true });
  await expect(sunoForm.getByLabel("苏诺之音 账号", { exact: true })).toHaveValue("suno-cn-a");
  const sunoImage = sunoForm.getByLabel("提供商 / 渠道", { exact: true });
  const sunoModel = sunoForm.getByLabel("图像模型", { exact: true });
  await expect(sunoImage).toHaveValue("doubao_image");
  await expect(sunoModel).toHaveValue("doubao-seedream-5-0-pro-260628");
  await sunoImage.selectOption("zhipu_image");
  assert.deepEqual(await sunoModel.locator("option").evaluateAll(options => options.map(option => option.value)), ["cogview-3-flash", "glm-image"]);
  await sunoModel.selectOption("glm-image");
  await expect(sunoForm.getByRole("textbox", { name: "创意描述", exact: true })).toHaveCount(0);
  await expect(sunoForm.getByRole("checkbox", { name: "纯音乐", exact: true })).toBeDisabled();
  await sunoForm.getByLabel("艺人信息", { exact: true }).selectOption("artist-fanqie-c");
  await expect(sunoForm.getByRole("checkbox", { name: "纯音乐", exact: true })).toBeChecked();
  await expect(sunoForm.getByRole("textbox", { name: "歌词", exact: true })).toHaveCount(0);
  await sunoForm.getByLabel("歌名", { exact: true }).fill("苏诺曲 A");
  await sunoForm.getByLabel("B 版歌名（可选）", { exact: true }).fill("苏诺曲 B");
  await expect(sunoForm.getByRole("textbox", { name: "音乐风格", exact: true })).toHaveValue("钢琴");
  await sunoForm.getByRole("button", { name: "开始制作", exact: true }).click();
  await expect.poll(() => sunoRequests.length).toBe(1);
  assert.deepEqual({ ...sunoRequests[0], requestId: "id" }, { requestId: "id", accountId: "suno-cn-a", artistId: "artist-fanqie-c",
    mode: "custom", title: "苏诺曲 A", alternateTitle: "苏诺曲 B", lyrics: "", style: "钢琴", instrumental: true,
    coverImage: { providerId: "zhipu_image", modelId: "glm-image", profileId: "zhipu-primary", expectedRevision: 2 } });
  await sunoForm.getByRole("button", { name: "执行记录", exact: true }).click();
  const sunoHistory = page.getByRole("dialog", { name: "苏诺之音 · 执行记录", exact: true });
  await expect(sunoHistory.getByText("歌曲已生成，WAV 下载未完成。请在「我的创作」核对原歌曲。", { exact: true })).toBeVisible();
  await expect(sunoHistory.getByText("智谱拒绝了过长的封面提示词（1261）。", { exact: true })).toBeVisible();
  await sunoHistory.getByRole("button", { name: "补生成封面", exact: true }).click();
  await expect.poll(() => sunoCoverRetries).toEqual([{ id: "suno-cover-job" }]);
  await expect(sunoHistory.getByText("A.png", { exact: true })).toBeVisible();
  await expect(sunoHistory.getByRole("button", { name: "补生成封面", exact: true })).toHaveCount(0);
  assert.equal(sunoRequests.length, 1);
  await sunoHistory.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("dialog", { name: "苏诺之音 · 歌曲制作", exact: true }).getByRole("button", { name: "关闭" }).click();
  assert.equal((await pule.boundingBox()).width, (await suno.boundingBox()).width);
  const cardAccount = pule.getByRole("combobox", { name: "谱乐 AI 账号", exact: true });
  await cardAccount.selectOption("pule-b");
  await openPage(pule).click();
  await expect.poll(() => openedAccounts.at(-1)).toEqual({ accountId: "pule-b" });
  await expect(pule.getByText("登录待核对", { exact: true })).toBeVisible();
  puleState = "signed_in";
  await expect(pule.getByText("登录有效", { exact: true })).toBeVisible();

  const musicPanel = page.getByRole("dialog", { name: "谱乐 AI · 歌曲制作", exact: true });
  const closeMusicPanel = musicPanel.getByRole("button", { name: "关闭", exact: true });
  const accountPagesOpened = openedAccounts.length;
  await expect(musicPanel).toHaveCount(0);
  await execute(pule).click();
  await expect(musicPanel).toBeVisible();
  assert.equal(openedAccounts.length, accountPagesOpened, "opening the panel keeps the official page closed");
  const automation = musicPanel.getByRole("form", { name: "谱乐 AI 自动制作" });
  await expect(automation).toBeVisible();
  for (const width of [510, 1360]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await musicPanel.evaluate(panel => {
      const rect = panel.getBoundingClientRect();
      return rect.right === window.innerWidth && rect.left >= 0 && rect.height === window.innerHeight &&
        panel.scrollWidth <= panel.clientWidth + 1;
    }), "production form fits the right-hand panel at " + width);
  }
  const puleAccount = automation.getByLabel("谱乐 AI 账号", { exact: true });
  const publicationPlatform = automation.getByLabel("发布平台", { exact: true });
  const publicationAccount = automation.getByLabel("发布账号", { exact: true });
  const musicArtist = automation.getByLabel("艺人信息", { exact: true });
  const musicStyle = automation.getByRole("textbox", { name: "音乐风格", exact: true });
  const lyrics = automation.getByRole("textbox", { name: "歌词", exact: true });
  const artistDetails = automation.getByRole("group", { name: "艺人资料", exact: true });
  const instrumental = automation.getByRole("checkbox", { name: "纯音乐", exact: true });
  const make = automation.getByRole("button", { name: "开始制作", exact: true });
  const puleImage = automation.getByLabel("提供商 / 渠道", { exact: true });
  const puleModel = automation.getByLabel("图像模型", { exact: true });
  await expect(puleImage).toHaveValue("doubao_image");
  await puleImage.selectOption("openai_image");
  await expect(make).toBeDisabled();
  await expect(automation.getByText("请在配置中心保存所选图像渠道的 API Key。", { exact: true })).toBeVisible();
  await puleImage.selectOption("doubao_image");
  await puleModel.selectOption("doubao-seedream-5-5-261028");
  const viewPuleHistory = automation.getByRole("button", { name: "执行记录", exact: true });
  await expect(viewPuleHistory).toBeVisible();
  const puleHistory = page.getByRole("dialog", { name: "谱乐 AI · 执行记录", exact: true });
  const closePuleHistory = puleHistory.getByRole("button", { name: "关闭", exact: true });
  await expect(puleHistory).toHaveCount(0);
  assert.equal(puleHistoryReads, 0, "archived jobs are read when opening the records view");
  await viewPuleHistory.click();
  await expect(puleHistory.getByText("暂无执行记录", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(puleHistory).toHaveCount(0);
  await expect(viewPuleHistory).toBeFocused();
  archivedPuleJobs.push(...Array.from({ length: 25 }, (_, index) => ({
    id: "past-" + index, title: "较早的制作 " + index, status: "completed", step: "cover", files: [],
    updatedAt: new Date(Date.UTC(2026, 10, 20, 0, 24 - index)).toISOString(),
  })));
  const songTitle = automation.getByLabel("歌名", { exact: true });
  const alternateTitle = automation.getByLabel("B 版歌名（可选）", { exact: true });
  const mode = automation.getByLabel("制作方式", { exact: true });
  await expect(puleAccount).toHaveValue("pule-b");
  await mode.selectOption("cover");
  await expect(automation.getByRole("button", { name: "选择翻唱音频", exact: true })).toBeVisible();
  await expect(make).toBeDisabled();
  await mode.selectOption("custom");
  await make.click();
  await expect(songTitle).toBeFocused();
  assert.equal(puleStarts, 0, "opening the panel and submitting invalid song fields leave the automation untouched");
  await publicationPlatform.selectOption("fanqie");
  await expect(publicationAccount.locator("option")).toHaveText(["请选择发布账号", "番茄甲", "番茄乙"]);
  await expect(musicArtist).toBeDisabled();
  await publicationAccount.selectOption("fanqie-b");
  await expect(musicArtist.locator("option")).toHaveText(["请选择艺人", "纯音乐艺人"]);
  await musicArtist.selectOption("artist-fanqie-c");
  await expect(instrumental).toBeChecked();
  await expect(lyrics).toHaveCount(0);
  await expect(musicStyle).toHaveValue("钢琴");

  await publicationPlatform.selectOption("qqmusic");
  await expect(artistDetails).toHaveCount(0);
  await expect(publicationAccount.locator("option")).toHaveText(["请选择发布账号", "腾讯甲", "腾讯乙"]);
  await publicationAccount.selectOption("account-b");
  await musicArtist.selectOption("artist-tme-a");
  await expect(instrumental).not.toBeChecked();
  await expect(musicStyle).toHaveValue("摇滚");

  await publicationPlatform.selectOption("fanqie");
  await publicationAccount.selectOption("fanqie-a");
  await expect(musicArtist.locator("option")).toHaveText(["请选择艺人", "创作艺人甲", "创作艺人乙"]);
  await musicArtist.selectOption("artist-fanqie-b");
  await expect(instrumental).not.toBeChecked();
  for (const [field, value] of Object.entries({
    创作类型: "带歌词", 风格: "苦情歌", 封面分辨率: "1440 × 1440", 默认词作者: "作者甲", 默认曲作者: "作者乙",
    "A 版歌手": "创作艺人乙", "B 版歌手": "二号歌手", 音色: "小川",
  })) await expect(artistDetails.getByRole("textbox", { name: field, exact: true })).toHaveValue(value);
  for (const [field, value] of Object.entries({
    提示词引擎: "engine-a", 签约模式: "exclusive", 歌手数量: "2", 性别: "female",
  })) await expect(artistDetails.getByRole("combobox", { name: field, exact: true })).toHaveValue(value);
  await expect(artistDetails.getByRole("combobox", { name: "提示词引擎" }).locator("option:checked")).toHaveText("苦情歌引擎");
  await expect(musicStyle).toHaveValue("苦情歌");
  await instrumental.check();
  await musicArtist.selectOption("artist-fanqie-a");
  await expect(instrumental).not.toBeChecked();
  await musicArtist.selectOption("artist-fanqie-b");
  await songTitle.fill("练习曲");
  await alternateTitle.fill("夜里的练习曲");
  await lyrics.fill("灯亮了");
  await musicStyle.fill("民谣");
  await page.keyboard.press("Escape");
  await expect(musicPanel).toHaveCount(0);
  await expect(execute(pule)).toBeFocused();
  await pule.getByRole("heading", { name: "谱乐 AI", exact: true }).click();
  await expect(musicPanel).toBeVisible();
  await expect(songTitle).toHaveValue("练习曲");
  await expect(alternateTitle).toHaveValue("夜里的练习曲");
  await expect(lyrics).toHaveValue("灯亮了");
  await expect(musicStyle).toHaveValue("民谣");
  assert.equal(puleStarts, 0, "reopening with a complete form leaves it ready to submit");
  await make.click();
  await expect(musicPanel.getByRole("alert")).toHaveText("请先在配置中心的「下载目录」选择文件夹。");
  await expect(make).toBeEnabled();
  downloadConfigured = true;
  await make.click();
  await expect(make).toBeDisabled();
  await expect(musicPanel.getByRole("list", { name: "谱乐 AI 制作任务", exact: true })).toHaveCount(0);
  await expect(puleHistory).toHaveCount(0);
  assert.equal(puleHistoryReads, 1);
  await viewPuleHistory.click();
  const jobs = puleHistory.getByRole("list", { name: "谱乐 AI 制作任务", exact: true });
  const bJob = jobs.getByRole("listitem").filter({ has: page.getByText("谱乐乙", { exact: true }) });
  await expect(bJob.getByRole("status")).toHaveText(/请在谱乐 AI 窗口登录/);
  await expect(jobs.getByText("较早的制作 24", { exact: true })).toBeVisible();
  await expect(bJob.locator("time")).toHaveAttribute("datetime", puleJobs.get("pule-b").updatedAt);
  assert.equal(puleCalls.length, 1);
  assert.deepEqual({ ...puleCalls[0].input, requestId: "id" }, {
    requestId: "id", accountId: "pule-b", artistId: "artist-fanqie-b",
    publication: { platform: "fanqie", accountId: "fanqie-a" }, mode: "custom",
    title: "练习曲", alternateTitle: "夜里的练习曲", lyrics: "灯亮了", style: "民谣", instrumental: false,
    coverImage: { providerId: "doubao_image", modelId: "doubao-seedream-5-5-261028", profileId: "ark-image-primary", expectedRevision: 2 },
  });
  await closePuleHistory.click();
  await expect(puleHistory).toHaveCount(0);
  await expect(songTitle).toHaveValue("练习曲");
  await closeMusicPanel.click();
  await expect(musicPanel).toHaveCount(0);
  await expect(pule.getByText("1 个制作任务进行中", { exact: true })).toBeVisible();
  await expect(openPage(pule)).toBeDisabled();
  const puleJob = puleJobs.get("pule-b");
  puleJob.step = "generation";
  await execute(pule).click();
  await expect(make).toBeDisabled();

  await puleAccount.selectOption("pule-a");
  await expect(musicArtist).toHaveValue("artist-fanqie-b");
  await expect(make).toBeEnabled();
  await songTitle.fill("另一首练习曲");
  await mode.selectOption("cover");
  await automation.getByRole("button", { name: "选择翻唱音频", exact: true }).click();
  await automation.getByRole("checkbox", { name: "我有权上传此音频" }).check();
  await make.click();
  await expect(make).toBeDisabled();
  await viewPuleHistory.click();
  await expect(jobs.getByText("谱乐甲", { exact: true })).toBeVisible();
  await expect(bJob.getByRole("status")).toHaveText("正在制作歌曲");
  await expect(puleHistory.getByRole("button", { name: /确认使用.*积分/u })).toHaveCount(0);
  assert.equal(puleCalls.length, 2);
  assert.deepEqual({ ...puleCalls[1].input, requestId: "other-id" }, {
    ...puleCalls[0].input, requestId: "other-id", accountId: "pule-a", title: "另一首练习曲",
    mode: "cover", uploadToken: "cover-audio", uploadAuthorized: true,
  });
  assert.notEqual(puleCalls[0].input.requestId, puleCalls[1].input.requestId);

  puleJob.step = "rename";
  await expect(bJob.getByRole("status")).toHaveText("正在修改第二首歌名");
  puleJob.step = "cover";
  await expect(bJob.getByRole("status")).toHaveText("正在生成封面");
  Object.assign(puleJob, { status: "completed", outputDirectories: { A: "素素_歌手甲_引擎", B: "素素_歌手乙_引擎" }, files: [
    { version: "A", name: "练习曲 - A.wav" },
    { version: "B", name: "夜里的练习曲 - B.wav",
      lyrics: { name: "夜里的练习曲 - B.txt" }, cover: { name: "夜里的练习曲 - B.png" } },
  ] });
  const savedFiles = puleHistory.getByRole("list", { name: "已保存的制作文件" });
  await expect(savedFiles.getByText("练习曲 - A.wav", { exact: true })).toBeVisible();
  await expect(savedFiles.getByText("夜里的练习曲 - B.wav", { exact: true })).toBeVisible();
  await expect(savedFiles.getByText("夜里的练习曲 - B.txt", { exact: true })).toBeVisible();
  await expect(savedFiles.getByText("夜里的练习曲 - B.png", { exact: true })).toBeVisible();
  await expect(puleHistory.getByText("A 版目录 素素_歌手甲_引擎", { exact: true })).toBeVisible();
  await expect(puleHistory.getByText("B 版目录 素素_歌手乙_引擎", { exact: true })).toBeVisible();
  assert.deepEqual(puleCalls.map(call => call.method), ["puleBrowser.start", "puleBrowser.start"]);
  await puleHistory.evaluate(panel => { panel.scrollTop = panel.scrollHeight; });
  const closeBounds = await closePuleHistory.boundingBox();
  assert.ok(closeBounds.y >= 0 && closeBounds.y + closeBounds.height <= 900, "the records remain closable after scrolling");
  await closePuleHistory.click();
  const coverJob = puleJobs.get("pule-a");
  Object.assign(coverJob, {
    status: "awaiting_confirmation", step: "processing", quote: { id: "quote-a", kind: "processing", credits: 50 },
  });
  await expect(automation.getByText("有制作任务待确认", { exact: true })).toBeVisible();
  await viewPuleHistory.click();
  const aJob = jobs.getByRole("listitem").filter({ has: page.getByText("另一首练习曲", { exact: true }) });
  await aJob.getByRole("button", { name: "确认使用 50 积分" }).click();
  await expect(aJob.getByRole("status")).toHaveText("正在处理版权音频");
  await aJob.getByRole("button", { name: "停止", exact: true }).click();
  await expect(aJob.getByRole("status")).toHaveText("已停止任务。");
  assert.deepEqual(puleCalls.slice(2), [
    { method: "puleBrowser.confirm", input: { id: coverJob.id, quoteId: "quote-a" } },
    { method: "puleBrowser.stop", input: { id: coverJob.id } },
  ]);
  puleJobs.set("pule-a", { ...coverJob, id: "newer-job", title: "更新的制作", code: undefined, status: "completed" });
  await expect(jobs.getByText("更新的制作", { exact: true })).toBeVisible();
  await expect(aJob.getByRole("status")).toHaveText("已停止任务。");
  await closePuleHistory.click();
  await expect(puleHistory).toHaveCount(0);
  await automation.getByRole("button", { name: "管理谱乐 AI 账号" }).click();
  puleState = "unverified";
  await page.getByRole("button", { name: "谱乐乙", exact: true }).click();
  const session = page.getByRole("region", { name: "账号会话" });
  await expect(session.getByText("登录待核对", { exact: true })).toBeVisible();
  puleState = "signed_in";
  await expect(session.getByText("登录有效", { exact: true })).toBeVisible();
  puleState = "login_required";
  await expect(session.getByText("请在窗口登录", { exact: true })).toBeVisible();
  await navigation.getByRole("button", { name: "平台管理", exact: true }).click();
  assert.deepEqual(savedTasks, []);
  await qq.getByRole("button", { name: "管理账号", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "账号平台" })).toHaveValue("tme");

  await navigation.getByRole("button", { name: "任务中心", exact: true }).click();
  await expect(page.getByRole("heading", { name: "任务中心", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "在浏览器打开", exact: true })).toHaveCount(0);
  const batch = page.getByRole("row", { name: /部分失败的测试任务/u });
  await expect(batch.getByText("部分失败", { exact: true })).toBeVisible();
  await expect(batch.getByText("执行完毕 · 成功 3 个 · 失败 1 个", { exact: true })).toBeVisible();
  const expandTask = batch.getByRole("button", { name: batchTask.title, exact: true });
  await expandTask.press("Enter");
  await expect(expandTask).toHaveAttribute("aria-expanded", "true");
  const linkedPlans = page.getByRole("region", { name: `${batchTask.title}的关联计划` });
  const failedPlan = linkedPlans.getByRole("article", { name: "计划 2" });
  await expect(failedPlan.locator(".publication-plan-card-head").getByText("失败", { exact: true })).toBeVisible();
  await expect(failedPlan.getByText(/谱乐音频下载超过 10 分钟/u)).toBeVisible();
  await failedPlan.getByText("阶段明细", { exact: true }).click();
  await expect(failedPlan.getByText("下载歌曲", { exact: true })).toBeVisible();
  await expect(linkedPlans.getByRole("article", { name: "计划 3" }).getByText("已完成", { exact: true })).toBeVisible();
  await expandTask.click();
  await expect(linkedPlans).toHaveCount(0);
  const resultFilter = page.getByRole("combobox", { name: "执行结果", exact: true });
  await resultFilter.selectOption("partial");
  await expect(page.getByRole("row", { name: /既有任务/u })).toHaveCount(0);
  await batch.getByRole("button", { name: "记录", exact: true }).click();
  const history = page.getByRole("dialog", { name: "执行记录", exact: true });
  await expect(history.getByText("计划失败 · 2/4 · 计划 2 · 计划配置已修改，请在计划中心核对。", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 600, height: 340 });
  const logClose = await scrollWithPinnedClose(history.locator("summary").first(), history.getByRole("button", { name: "关闭", exact: true }));
  await page.mouse.click(logClose.x, logClose.y);
  await expect(history).toHaveCount(0);
  await page.setViewportSize(viewport);
  await resultFilter.selectOption("");
  await batch.getByRole("button", { name: "立即执行", exact: true }).click();
  await batch.getByRole("button", { name: "停止", exact: true }).click();
  await expect(batch.getByText("已停止", { exact: true })).toBeVisible();
  await expect(batch.getByRole("button", { name: "立即执行", exact: true })).toBeEnabled();
  assert.deepEqual(taskExecutionCalls.map(({ method, input }) => [method, input.id]), [
    ["publicationTasks.start", batchTask.id], ["publicationTasks.stop", "current-task-run"],
  ]);
  const legacy = page.getByRole("row", { name: /既有任务/ });
  await expect(legacy.getByRole("button", { name: "立即执行", exact: true })).toBeDisabled();
  await legacy.getByRole("button", { name: "编辑", exact: true }).click();
  const previous = page.getByRole("dialog", { name: "编辑任务" });
  await expect(previous.getByRole("group", { name: "上传并发布", exact: true })).toHaveCount(0);
  await expect(previous.getByRole("checkbox", { name: /执行关联计划及其发布步骤/ })).not.toBeChecked();
  await previous.getByRole("button", { name: "关闭", exact: true }).click();

  await page.getByRole("button", { name: "＋ 新建任务", exact: true }).click();
  const draft = page.getByRole("dialog", { name: "新建任务" });
  await draft.getByLabel("任务名称").fill("新任务");
  await draft.getByLabel("执行方式").selectOption("scheduled");
  const prepareContract = draft.getByRole("combobox", { name: "是否签署合同", exact: true });
  await expect(prepareContract.locator("option")).toHaveText(["请选择", "是", "否"]);
  await draft.getByRole("button", { name: "选择关联计划", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "选择关联计划", exact: true });
  await picker.getByRole("checkbox", { name: "待发计划" }).check();
  await page.setViewportSize({ width: 600, height: 360 });
  await scrollWithPinnedClose(picker.getByRole("button", { name: "确认关联", exact: true }), picker.getByRole("button", { name: "关闭", exact: true }));
  await picker.getByRole("button", { name: "确认关联", exact: true }).click();
  await scrollWithPinnedClose(draft.getByRole("button", { name: "保存任务", exact: true }), draft.getByRole("button", { name: "关闭", exact: true }));
  await page.setViewportSize(viewport);
  await expect(draft.getByRole("group", { name: "上传并发布", exact: true })).toHaveCount(0);
  await expect(draft.getByRole("combobox", { name: "发布账号" })).toHaveCount(0);
  await expect(draft.getByRole("button", { name: "保存任务", exact: true })).toBeDisabled();
  await draft.getByRole("checkbox", { name: /执行关联计划及其发布步骤/ }).check();
  await expect(draft.getByRole("button", { name: "保存任务", exact: true })).toBeDisabled();
  await prepareContract.selectOption("no");
  await expect(draft.getByText("番茄目录发布生成待签合同后继续。", { exact: true })).toBeVisible();
  await draft.getByRole("checkbox", { name: /执行关联计划及其发布步骤/ }).check();
  await draft.getByRole("button", { name: "保存任务", exact: true }).click();
  await expect(page.getByRole("row", { name: /新任务/ })).toBeVisible();
  assert.deepEqual(savedTasks[0].task.steps, [{ kind: "plans", planIds: ["plan-a"] }]);
  assert.equal(savedTasks[0].task.prepareContract, false);
  await page.getByRole("row", { name: /新任务/ }).getByRole("button", { name: "编辑", exact: true }).click();
  await expect(previous.getByLabel("是否签署合同")).toHaveValue("no");
  await previous.getByRole("button", { name: "关闭", exact: true }).click();
  assert.deepEqual(checkedAccounts, []);

  platformWorkflow = { defaults: defaults.roles, profiles: [], nodes: [
    { id: "publish:qqmusic", label: "QQ 音乐", kind: "publish", available: false, reason: "测试发布暂停" },
    { id: "music:fixture_api", label: "测试歌曲渠道", kind: "music", available: false, reason: "测试歌曲待接入" },
    { id: "text:fixture_api", label: "测试文本模型", kind: "text", available: false, reason: "测试模型待接入" },
  ] };
  await navigation.getByRole("button", { name: "平台管理", exact: true }).click();
  await expect(qq.getByText("测试发布暂停", { exact: true })).toBeVisible();
  await expect(qq.getByRole("combobox", { name: "QQ 音乐默认发布账号" })).toHaveValue("account-b");
  await expect(generation.getByRole("article", { name: "测试歌曲渠道", exact: true })
    .getByText("测试歌曲待接入", { exact: true })).toBeVisible();
  await expect(models.getByRole("article", { name: "测试文本模型", exact: true })
    .getByText("测试模型待接入", { exact: true })).toBeVisible();
  await expect(models.getByRole("button", { name: "配置模型 API", exact: true })).toHaveCount(0);
  assert.deepEqual(pageErrors, []);
});
