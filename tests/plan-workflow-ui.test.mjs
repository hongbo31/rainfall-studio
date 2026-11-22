import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { compileFunction } from "node:vm";
import { chromium, expect } from "@playwright/test";
import { build } from "esbuild";
import { launchHeadlessChromium } from "../scripts/lib/headless-chromium.mjs";
import { scrollWithPinnedClose } from "./fixtures/pinned-close.mjs";

const project = path.resolve(import.meta.dirname, "..");
const account = { id: "creation-account", name: "离线创作账号", provider: "yourmusic" };
const artist = {
  id: "fixture-artist", name: "离线双歌手艺人", accountId: account.id, accountLocalArtist: true,
  defaults: { voice: "female" },
  profile: { singer: "甲歌手", gender: "female", voicePersona: "清亮", lyricist: "词作者", composer: "曲作者", contractMode: "exclusive" },
  secondSinger: { name: "乙歌手", gender: "male", voicePersona: "低沉" },
};

test("the workflow editor exposes a count and a canvas", async () => {
  const { outputFiles } = await build({
    stdin: { resolveDir: project, loader: "tsx", contents: `
      import React from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import { Context } from './src/renderer/context';
      import PlanWorkflowForm from './src/renderer/components/PlanWorkflowForm';
      export default (data, initial) => renderToStaticMarkup(
        <Context.Provider value={{ data }}>
          <PlanWorkflowForm initial={initial} busy={false} error="" onClose={() => {}} onSave={() => {}} />
        </Context.Provider>
      );
    ` },
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
  });
  const compiled = { exports: {} };
  compileFunction(outputFiles[0].text, ["module", "exports", "require"])(
    compiled, compiled.exports, createRequire(import.meta.url),
  );
  const data = { accounts: [account], accountLocalArtists: [artist] };
  const render = compiled.exports.default;
  const html = render(data);
  assert.match(html, /歌曲生成次数/);
  assert.match(html, /aria-label="工作流程画布"/);
  const legacy = render({ ...data, accounts: [{ ...account, provider: "netease" }] }, {
    id: "legacy", title: "旧工作流程", artistId: artist.id, count: 1, enabled: false,
    workflow: { accountId: account.id, platform: "netease", mode: "musician", inspiration: "", maxRewrites: 3 },
    outputs: { lyrics: true, music: true, cover: true }, music: { route: "pule", versionPolicy: "first", consent: true },
  });
  assert.match(legacy, /aria-label="断开连接"/);
});

test("plan center saves a linked graph, starts it directly, and confirms deletion", async t => {
  const renderer = await build({
    absWorkingDir: project, entryPoints: ["src/renderer/main.tsx"], bundle: true, write: false, outdir: "build",
  });
  const calls = { overview: [], runDetail: [], legacyReads: [], read: [], save: [], run: [], stop: [], remove: [], archive: [], directoryTasks: [], lyricRead: [], retry: [], fanqieCatalog: [] };
  const firstLoad = Promise.withResolvers();
  let saving, snapshotGate, fanqieCleanup;
  const createdAt = "2026-11-20T08:12:00Z";
  const downloadRoot = path.join(project, "download-fixture");
  let archive = { revision: 1, root: null, accountId: account.id };
  const plans = [], runs = [], items = [], stageAttempts = [];
  const qishui = { id: "qishui-1", name: "汽水默认账号", provider: "qishui" };
  const otherQishui = { id: "qishui-2", name: "汽水另一个账号", provider: "qishui" };
  const fanqie = { id: "fanqie-a", name: "番茄发布账号", provider: "fanqie" };
  const otherFanqie = { id: "fanqie-b", name: "另一个番茄账号", provider: "fanqie" };
  const sunoAccount = { id: "suno-cn", name: "苏诺创作账号", provider: "suno_cn" };
  const fanqieArtist = { ...artist, id: "f-artist", name: "番茄艺人", accountId: fanqie.id,
    defaults: { voice: "female", genre: "民谣", coverResolution: 1440 }, promptTemplateId: "engine-1" };
  const instrumental = { ...fanqieArtist, id: "i-artist", name: "纯音乐艺人",
    defaults: { ...fanqieArtist.defaults, voice: "instrumental" } };
  const otherArtist = { ...artist, id: "other-artist", name: "另一个账号的艺人", accountId: otherFanqie.id };
  const accounts = [account, qishui, otherQishui, fanqie, otherFanqie, sunoAccount];
  const artists = [artist, fanqieArtist, instrumental, otherArtist];
  let platformWorkflow;
  const ok = value => ({ ok: true, value });
  const failed = code => ({ ok: false, error: { code, message: code } });
  const browser = await launchHeadlessChromium(chromium);
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  page.setDefaultTimeout(6000);
  await page.exposeFunction("workflowFixtureCall", async (method, input = {}) => {
    switch (method) {
      case "runtime": return ok({});
      case "runtime.settings": return ok({ backgroundEnabled: false, loginAtStartup: false });
      case "snapshot":
        await snapshotGate?.promise;
        return ok({ mode: "simulation", accounts, artists, accountLocalArtists: artists,
          platformWorkflow, platformConfigurations: [{ target: "qishui", accountId: qishui.id }],
          works: [], series: [], exceptions: [], resources: { finished: 0, cost: { available: 0, reserved: 0 },
            candidate: { available: 0, reserved: 0, spent: 0 } } });
      case "planCenter.list":
        calls.legacyReads.push(method);
        return ok({ plans, runs, items, stageAttempts, publishAttempts: [], occurrences: [], albumBindings: [], migration: null });
      case "planCenter.dashboard": {
        calls.overview.push(method);
        await firstLoad.promise;
        return ok(plans.map(plan => {
          const history = runs.filter(run => run.planId === plan.id).reverse();
          const standalone = history.filter(run => run.source !== "publication_task");
          return { plan, latest: standalone[0], active: standalone.find(run => !["completed", "stopped", "failed"].includes(run.state)),
            deleteBlocked: history.some(run => ["running", "waiting", "stopping"].includes(run.state) ||
              run.state === "blocked" && stageAttempts.some(attempt => attempt.runId === run.id &&
                ["dispatching", "waiting", "unknown"].includes(attempt.state) && !["music_assets", "cover", "materials"].includes(attempt.stage))),
            stopsOnDelete: history.some(run => run.state === "blocked") };
        }));
      }
      case "planCenter.history": return ok({ runs: runs.filter(run => run.planId === input.id && run.source !== "publication_task").reverse()
        .map(run => ({ ...run, count: run.snapshot.count, completed: items.filter(item => item.runId === run.id && item.state === "completed").length,
          local: run.snapshot.workflow?.graph.nodes.length === 1 })), legacyHistory: {} });
      case "planCenter.runDetail": {
        calls.runDetail.push(input);
        const run = runs.find(run => run.id === input.runId);
        if (!run) return failed("NOT_FOUND");
        return ok({ run, fanqieCleanup: run.id === "task-owned-run" ? fanqieCleanup : undefined,
          fanqieDiagnostics: run.id === "task-owned-run",
          items: items.filter(item => item.runId === run.id), stageAttempts: stageAttempts.filter(attempt => attempt.runId === run.id),
          publishAttempts: [], execution: {}, catalog: {} });
      }
      case "planCenter.retryFanqieCleanup":
        assert.deepEqual(input, { runId: "task-owned-run" });
        fanqieCleanup = "queued";
        return ok(input);
      case "planCenter.openFanqieDiagnostics":
        assert.deepEqual(input, { runId: "task-owned-run" });
        return ok(null);
      case "publicationTasks.list": {
        const linked = runs.find(run => run.id === "task-owned-run");
        if (!linked) return ok({ tasks: [], plans: [] });
        const plan = plans.find(row => row.id === linked.planId);
        if (!plan) return ok({ tasks: [], plans: [] });
        const planRef = { id: plan.id, title: plan.title, revision: plan.revision };
        const task = { id: "linked-task", title: "关联任务测试", revision: 1, enabled: true,
          execution: { kind: "manual" }, steps: [{ kind: "plans", planIds: [plan.id] }] };
        return ok({ plans: [planRef], tasks: [{ task,
          run: { id: "linked-task-run", state: "waiting", detail: "执行计划 " + plan.title, startedAt: createdAt, plans: [planRef],
            linked: [{ id: linked.id, planId: plan.id, owned: true }] },
          planProgress: input.expandedTaskId ? [{ title: plan.title, planId: plan.id,
            runId: linked.id, state: linked.state, owned: true, items: [] }] : undefined,
        }] });
      }
      case "lyricWriting.read": {
        calls.lyricRead.push(input);
        if (stageAttempts[0]?.reason === "LYRIC_REVIEW_INVALID") return ok({ id: input.id, state: "blocked",
          reason: "LYRIC_REVIEW_INVALID", reviewIssue: "findings", rewrites: 0, maxRewrites: 1,
          versions: [{ id: "fixture-lyric-v1", title: "窗灯", review: null }] });
        if (stageAttempts[0]?.reason === "TEXT_OUTPUT_TRUNCATED") return ok({ id: input.id, state: "blocked",
          reason: "TEXT_OUTPUT_TRUNCATED", rewrites: 0, maxRewrites: 1,
          textIssue: { phase: "rewrite", reason: "TEXT_OUTPUT_TRUNCATED", httpStatus: 200, finishReason: "length",
            hasReceipt: true, completionTokens: 4096, maxOutputTokens: 4096 },
          versions: [{ id: "fixture-lyric-v1", title: "窗灯", review: { score: 76, languageMatches: true, findings: ["保留副歌"] } }] });
        return ok({ id: input.id, state: "rejected", rewrites: 2, maxRewrites: 2, versions: [
          { id: "fixture-lyric-v1", title: "窗灯", review: { score: 78, languageMatches: true,
            rubric: { styleFit: 18, narrative: 16, naturalness: 16, singability: 13, hook: 15 }, findings: ["副歌尾句的断句需更自然"] } },
          { id: "fixture-lyric-v2", title: "窗灯", review: { score: 72, languageMatches: true, findings: ["改写后重音不齐"] } },
          { id: "fixture-lyric-v3", title: "窗灯", review: null, reviewIssue: "rubric" },
        ] });
      }
      case "planCenter.retry": {
        calls.retry.push(input);
        runs.find(run => run.id === "fixture-run").state = "running";
        items.find(item => item.id === "fixture-item").state = "running";
        return ok({ id: input.attemptId });
      }
      case "planCenter.catalog":
        calls.legacyReads.push(method);
        return ok({ profiles: [], routes: [{ id: "pule", label: "谱乐 AI" }], platforms: [],
          accounts: accounts.map(row => ({ ...row, label: row.name })) });
      case "planCenter.status": calls.legacyReads.push(method); return ok({});
      case "planAlbums.status": return ok({ operations: [] });
      case "planCenter.fanqieStatus":
      case "accountIdentity.list":
      case "apiProfile.list":
      case "textConfig.list":
        return ok([]);
      case "promptLibrary.list": return ok([{ id: "engine-1", name: "民谣引擎" }]);
      case "generationConfig.read": return ok({ roles: {}, revision: 0 });
      case "directoryTasks.status": {
        calls.directoryTasks.push(method);
        return ok({ sources: [], plans, requests: [], errors: [] });
      }
      case "downloadArchive.read": return ok(archive);
      case "downloadArchive.chooseDirectory":
      case "downloadArchive.clearDirectory": {
        calls.archive.push({ method, input });
        if (input.expectedRevision !== archive.revision) return failed("REVISION_CONFLICT");
        archive = { ...archive, revision: archive.revision + 1, root: method.endsWith("chooseDirectory") ? downloadRoot : null };
        return ok(archive);
      }
      case "planCenter.save": {
        calls.save.push(input);
        await saving?.promise;
        const plan = { ...input.plan, revision: plans.length ? plans[0].revision + 1 : 1, createdAt, needsConfiguration: [], publishTargets: [] };
        plans[0] = plan;
        return ok(plan);
      }
      case "planCenter.read": {
        calls.read.push(input);
        return ok(plans.find(plan => plan.id === input.id));
      }
      case "planCenter.preview": return ok({ planRevision: plans[0].revision, summaryHash: "preview-hash", summary: {} });
      case "planCenter.run": {
        calls.run.push(input);
        if (calls.run.length <= 2) return failed("DOWNLOAD_ROOT_REQUIRED");
        if (plans[0].workflow?.graph.nodes.length === 1) {
          const run = { id: "fixture-directory-run", planId: input.id, state: "stopped", reason: "FANQIE_DOWNLOADS_EMPTY",
            source: input.source, planRevision: input.expectedRevision, snapshot: plans[0], createdAt };
          runs.push(run);
          return ok(run);
        }
        const run = { id: "fixture-run", planId: input.id, state: "running", source: input.source,
          planRevision: input.expectedRevision, snapshot: plans[0], createdAt: "2026-11-20T08:22:00Z" };
        if (calls.run.length === 3) {
          run.state = "blocked";
          items.push({ id: "fixture-item", runId: run.id, ordinal: 1, state: "failed", versions: [] });
          stageAttempts.push({ id: "fixture-lyric-attempt", itemId: "fixture-item", runId: run.id, ordinal: 1,
            stage: "lyric_write", state: "failed", reason: "LYRIC_SCORE_BELOW_THRESHOLD", externalTaskId: "fixture-lyric-job" });
        }
        runs.push(run);
        return ok(run);
      }
      case "planCenter.stop": {
        calls.stop.push(input);
        const index = runs.findIndex(run => run.id === input.runId);
        runs[index] = { ...runs[index], state: "stopped", stopRequested: true };
        return ok(runs[index]);
      }
      case "planCenter.delete": {
        calls.remove.push(input);
        plans.length = 0;
        return ok({ id: input.id });
      }
      default: return failed(`UNEXPECTED_FIXTURE_CALL: ${method}`);
    }
  });
  const url = "http://127.0.0.1/";
  await page.route("**/*", route => route.request().url() === url
    ? route.fulfill({ contentType: "text/html; charset=utf-8", body: '<!doctype html><html lang="zh-CN"><div id="root"></div></html>' })
    : route.abort());
  await page.exposeFunction("workflowFanqieUpload", (action, input) => action === "configuration" ? ok({
    configurationHash: "b".repeat(64),
    configuration: { directoryPreferences: input.accountId === fanqie.id
      ? { limit: 5, signContract: false } : { limit: 10, signContract: true } },
  }) : failed("UNEXPECTED_FIXTURE_CALL"));
  await page.exposeFunction("workflowFanqieCatalog", action => {
    calls.fanqieCatalog.push(action);
    return failed("UNEXPECTED_MANUAL_ACCOUNT_CHECK");
  });
  await page.addInitScript(() => { window.rainfall = {
    call: window.workflowFixtureCall, fanqieUpload: window.workflowFanqieUpload, fanqieCatalog: window.workflowFanqieCatalog,
  }; });
  await page.goto(url);
  await page.addStyleTag({ content: renderer.outputFiles.find(file => file.path.endsWith(".css")).text });
  await page.addScriptTag({ content: renderer.outputFiles.find(file => file.path.endsWith(".js")).text });
  const navigation = page.getByRole("navigation");
  const planCenter = navigation.getByRole("button", { name: "计划中心", exact: true });
  await expect(planCenter).toBeVisible();
  await expect(navigation.getByRole("button", { name: "素材列表", exact: true })).toHaveCount(0);
  await planCenter.click();
  const table = page.getByRole("table", { name: "计划列表" });
  await expect(table.getByRole("columnheader")).toHaveText(["名称", "创建时间", "执行结果", "操作"]);
  await expect(table).toHaveAttribute("aria-busy", "true");
  await expect(table.locator(".loading-spinner")).toBeVisible();
  snapshotGate = Promise.withResolvers();
  firstLoad.resolve();
  await expect(table.getByText("暂无计划", { exact: true })).toBeVisible();
  snapshotGate.resolve();
  snapshotGate = undefined;
  assert.deepEqual(calls.legacyReads, []);
  assert.equal(calls.overview.length, 1);
  await expect(page.getByText("高级选项", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "＋ 新建计划", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新建计划", exact: true });
  await expect(dialog.getByRole("checkbox", { name: "生成封面", exact: true })).toHaveCount(0);
  await expect(dialog.locator("fieldset > legend")).toHaveText(["工作流程"]);
  await expect(dialog.getByText(/高级设置|启用定时执行/)).toHaveCount(0);
  await dialog.getByLabel("名称", { exact: true }).fill("周末旋律");
  await dialog.getByLabel("艺人信息", { exact: true }).selectOption(artist.id);
  await expect(dialog.getByText("甲歌手", { exact: true })).toBeVisible();
  await expect(dialog.getByText("乙歌手", { exact: true })).toBeVisible();
  await expect(dialog.getByText("女声", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/男声|低沉/u)).toHaveCount(0);
  await expect(dialog.getByText("音色", { exact: true })).toBeVisible();
  await expect(dialog.getByText("清亮", { exact: true })).toBeVisible();
  const count = dialog.getByLabel("歌曲生成次数", { exact: true });
  const save = dialog.getByRole("button", { name: "保存计划", exact: true });
  await count.fill("2");
  const canvas = dialog.getByRole("group", { name: "工作流程画布" });
  const palette = dialog.getByRole("group", { name: "流程模块" });
  await canvas.scrollIntoViewIfNeeded();
  await palette.getByRole("button", { name: "创作中心", exact: true }).dragTo(canvas);
  await expect(canvas.getByRole("button", { name: "配置创作中心" })).toBeVisible();
  await palette.getByRole("button", { name: "AI作词", exact: true }).dragTo(canvas);
  await canvas.getByRole("button", { name: "配置AI作词", exact: true }).click();
  const writer = dialog.getByRole("group", { name: "AI作词节点配置" });
  await expect(writer.getByText(artist.name, { exact: true })).toBeVisible();
  await expect(writer.getByRole("combobox")).toHaveCount(2);
  const target = writer.getByRole("spinbutton", { name: "目标评分" });
  await expect(target).toHaveValue("90");
  await expect(writer.getByText("歌名二", { exact: true })).toBeVisible();
  await expect(save).toBeDisabled();
  const output = canvas.getByRole("button", { name: "AI作词输出" });
  const input = canvas.getByRole("button", { name: "创作中心输入" });
  await output.dragTo(input);
  await expect(save).toBeEnabled();
  await target.fill("101");
  await expect(save).toBeDisabled();
  await target.fill("92");
  await expect(save).toBeEnabled();
  await canvas.getByRole("button", { name: "断开连接" }).click();
  await expect(save).toBeDisabled();
  await output.press("Enter");
  await input.press("Enter");
  await expect(save).toBeEnabled();
  await canvas.getByRole("button", { name: "移除创作中心" }).click();
  await expect(save).toBeDisabled();
  await palette.getByRole("button", { name: "创作中心", exact: true }).click();
  await expect(save).toBeDisabled();
  await output.press("Enter");
  await input.press("Enter");
  await count.fill("21");
  await expect(save).toBeDisabled();
  await count.fill("2.5");
  await expect(save).toBeDisabled();
  await count.fill("2");
  saving = Promise.withResolvers();
  await save.click();
  const savingNew = dialog.getByRole("button", { name: "正在保存…", exact: true });
  await expect(savingNew).toBeDisabled();
  await expect(savingNew.locator(".loading-spinner")).toBeVisible();
  saving.resolve();
  saving = undefined;
  const row = table.getByRole("row", { name: /周末旋律/ });
  await expect(row.getByText("未执行", { exact: true })).toBeVisible();
  await expect(row.locator("time")).toHaveAttribute("datetime", createdAt);
  const oldSnapshot = structuredClone(plans[0]);
  const plan = calls.save[0].plan;
  assert.deepEqual(plan.workflow, { accountId: account.id,
    graph: { nodes: ["lyrics", "creation"], edges: [{ from: "lyrics", to: "creation" }] }, mode: "musician", inspiration: "", maxRewrites: 5, targetScore: 92 });
  assert.equal(plan.artistId, artist.id);
  assert.equal(plan.count, 2);
  assert.equal(plan.outputs.cover, true);
  assert.equal(plan.enabled, false);
  assert.deepEqual(plan.schedule, { kind: "daily", localTime: "09:00" });
  assert.deepEqual(plan.routing, { text: { source: "default" }, image: { source: "default" }, music: { source: "default" } });
  assert.equal(plan.music.consent, false);
  assert.equal(plan.authorization.music, false);
  const query = page.getByRole("searchbox", { name: "搜索计划名称" });
  await query.fill("不存在");
  await expect(row).toHaveCount(0);
  await query.fill(" 周末 ");
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: "编辑", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "编辑计划" });
  await expect(editor.getByRole("button", { name: "断开连接" })).toBeVisible();
  await editor.getByRole("button", { name: "配置AI作词", exact: true }).click();
  await expect(editor.getByRole("spinbutton", { name: "目标评分" })).toHaveValue("92");
  await editor.getByRole("button", { name: "配置创作中心", exact: true }).click();
  await expect(editor.getByRole("group", { name: "创作中心节点配置", exact: true })
    .getByRole("checkbox", { name: "生成封面", exact: true })).toBeChecked();
  await editor.getByRole("checkbox", { name: "生成封面", exact: true }).uncheck();
  await editor.getByLabel("歌曲生成次数").fill("3");
  saving = Promise.withResolvers();
  await editor.getByRole("button", { name: "保存计划", exact: true }).click();
  await expect(editor.getByRole("button", { name: "正在保存…", exact: true }).locator(".loading-spinner")).toBeVisible();
  saving.resolve();
  saving = undefined;
  await expect(editor).toHaveCount(0);
  assert.equal(calls.save[1].expectedRevision, 1);
  assert.equal(calls.save[1].plan.count, 3);
  assert.equal(calls.save[1].plan.outputs.cover, false);

  const run = row.getByRole("button", { name: "立刻执行", exact: true });
  const confirmation = page.getByRole("dialog", { name: "立刻执行此计划？" });
  await expect(page.getByText(/按服务计费/)).toBeVisible();
  await run.click();
  const setup = page.getByRole("alert").getByRole("button", { name: "打开下载目录" });
  await expect(setup).toBeVisible();
  assert.equal(calls.run.length, 1);
  await expect(confirmation).toHaveCount(0);
  await run.click();
  await expect.poll(() => calls.run.length).toBe(2);
  await setup.click();
  assert.equal(calls.run[1].requestId, calls.run[0].requestId);
  await expect(page.getByRole("tab", { name: "下载目录", exact: true, selected: true })).toBeVisible();
  const downloads = page.getByRole("tabpanel", { name: "下载目录", exact: true });
  const downloadPath = downloads.getByRole("textbox", { name: "歌曲和发布材料下载位置" });
  const chooseDownload = downloads.getByRole("button", { name: "选择下载目录" });
  const clearDownload = downloads.getByRole("button", { name: "清除目录配置" });
  await expect(downloads.getByRole("combobox")).toHaveCount(0);
  await expect(downloads.getByRole("tab")).toHaveCount(0);
  await expect(downloads.getByRole("button", { name: "添加任务目录" })).toHaveCount(0);
  await expect(downloadPath).toHaveValue("");
  await chooseDownload.click();
  await expect(downloadPath).toHaveValue(downloadRoot);
  await clearDownload.click();
  await expect(downloadPath).toHaveValue("");
  await expect(clearDownload).toHaveCount(0);
  await chooseDownload.click();
  await expect(downloadPath).toHaveValue(downloadRoot);
  assert.deepEqual(calls.archive, [
    { method: "downloadArchive.chooseDirectory", input: { expectedRevision: 1 } },
    { method: "downloadArchive.clearDirectory", input: { expectedRevision: 2 } },
    { method: "downloadArchive.chooseDirectory", input: { expectedRevision: 3 } },
  ]);
  await page.getByText("首次使用引导", { exact: true }).click();
  const firstSetup = page.getByRole("region", { name: "空间准备" });
  await expect(firstSetup.getByRole("button", { name: "打开计划中心" })).toBeVisible();
  await expect(firstSetup.getByRole("button", { name: "配置任务目录" })).toHaveCount(0);
  assert.deepEqual(calls.directoryTasks, []);
  runs.push({ id: "previous-run", planId: plan.id, state: "completed", source: "scheduled",
    planRevision: 1, snapshot: oldSnapshot, createdAt: "2026-11-20T08:13:00Z" });
  items.push({ id: "previous-song", runId: "previous-run", ordinal: 1, state: "completed",
    material: { title: "上一次的歌曲" }, versions: [] });
  const taskRun = { id: "task-owned-run", planId: plan.id, state: "running", source: "publication_task",
    planRevision: 2, snapshot: plans[0], createdAt: "2026-11-20T08:19:00Z" };
  runs.push(taskRun);
  await page.getByRole("button", { name: "任务中心", exact: true }).click();
  await page.getByRole("button", { name: "关联任务测试", exact: true }).click();
  await page.getByRole("button", { name: "查看执行", exact: true }).click();
  const details = page.getByRole("dialog", { name: "计划详情", exact: true });
  await expect(details.getByRole("heading", { name: "任务执行记录" })).toBeVisible();
  await details.getByRole("button", { name: "打开执行日志", exact: true }).click();
  await expect(details.getByRole("button", { name: "停止后续步骤" })).toHaveCount(0);
  await details.getByRole("button", { name: "返回任务中心", exact: true }).click();
  await expect(page.getByRole("heading", { name: "任务中心", exact: true })).toBeVisible();
  taskRun.state = "failed";
  taskRun.reason = "FANQIE_DOWNLOAD_CLEANUP_FAILED";
  fanqieCleanup = "pending";
  await page.getByRole("button", { name: "关联任务测试", exact: true }).click();
  await page.getByRole("button", { name: "查看执行", exact: true }).click();
  await details.getByRole("button", { name: "重试回收", exact: true }).click();
  await expect(details.getByText("已确认上传，下载文件将在后台重试回收。", { exact: true })).toBeVisible();
  await expect(details.getByText("有下载文件未能移入回收站，请查看执行日志。", { exact: true })).toHaveCount(0);
  fanqieCleanup = "recycled";
  await expect(details.getByText("下载文件已补回收。", { exact: true })).toBeVisible();
  await expect(details.getByRole("button", { name: "重试回收", exact: true })).toHaveCount(0);
  await details.getByRole("button", { name: "返回任务中心", exact: true }).click();
  taskRun.state = "running";
  delete taskRun.reason;
  fanqieCleanup = undefined;
  await page.getByRole("button", { name: "计划中心", exact: true }).click();
  await expect(row.getByText("本次已完成", { exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: "停止", exact: true })).toHaveCount(0);
  await row.getByRole("button", { name: "详情", exact: true }).click();
  await expect(details.getByRole("heading", { name: "执行记录（共 1 次）" })).toBeVisible();
  await expect(details.getByRole("button", { name: "停止后续步骤" })).toHaveCount(0);
  await details.getByRole("button", { name: "关闭", exact: true }).click();
  assert.equal(taskRun.state, "running");
  await run.click();
  await expect(run).toBeEnabled();
  taskRun.state = "completed";
  assert.equal(calls.run[2].expectedRevision, 2);
  assert.equal(calls.run[2].summaryHash, "preview-hash");
  assert.equal(calls.run[2].source, "manual");
  assert.equal(calls.run[2].confirmGeneration, true);
  assert.equal(calls.lyricRead.length, 0);
  const result = details.getByRole("region", { name: "执行结果", exact: true });
  const back = details.getByRole("button", { name: "返回执行记录", exact: true });
  await expect(result.getByRole("heading", { name: "第 2 次执行", exact: true })).toBeVisible();
  await result.getByText("查看作词评分", { exact: true }).click();
  await expect(page.getByText(/最高分稿 78 分.*目标 95 分/)).toBeVisible();
  await expect(result.getByText(/风格贴合 18\/20.*文本可唱性 13\/20/)).toBeVisible();
  await expect(page.getByText("副歌尾句的断句需更自然", { exact: true })).toBeVisible();
  await expect(page.getByText(/第 2 稿.*72 分/)).toBeVisible();
  await expect(result.getByText("第 3 稿 · 五项评分需各填 0 到 20 的整数。", { exact: true })).toBeVisible();
  assert.deepEqual(calls.lyricRead, [{ id: "fixture-lyric-job" }]);
  assert.deepEqual(calls.retry, []);
  const viewport = page.viewportSize();
  await page.setViewportSize({ ...viewport, height: 520 });
  const detailClose = await scrollWithPinnedClose(result, details.getByRole("button", { name: "关闭", exact: true }));
  await page.mouse.click(detailClose.x, detailClose.y);
  await expect(details).toHaveCount(0);
  await page.setViewportSize(viewport);
  await run.click();
  const retryConfirmation = page.getByRole("dialog", { name: "继续本次执行？", exact: true });
  const retry = retryConfirmation.getByRole("button", { name: "采用最高分稿并继续（按服务计费）", exact: true });
  await expect(retryConfirmation.getByText(/AI作词.*改写次数已用完/)).toBeVisible();
  await expect(retry).toBeVisible();
  await retryConfirmation.getByRole("button", { name: "取消", exact: true }).click();
  assert.deepEqual(calls.retry, []);
  stageAttempts[0].reason = "LYRIC_REVIEW_INVALID";
  const retryReview = { name: "重新评分（按服务计费）", exact: true };
  await row.getByRole("button", { name: "详情", exact: true }).click();
  await details.getByRole("button", { name: /第 2 次执行/ }).click();
  await result.getByText("查看作词评分", { exact: true }).click();
  await expect(result.getByText("评审意见字段格式错误。", { exact: true })).toBeVisible();
  await result.getByRole("button", retryReview).click();
  await expect(retryConfirmation.getByText("将使用已保存的歌词重新评分。", { exact: true })).toBeVisible();
  await retryConfirmation.getByRole("button", { name: "取消", exact: true }).click();
  assert.deepEqual(calls.retry, []);
  await details.getByRole("button", { name: "关闭", exact: true }).click();
  stageAttempts[0].reason = "TEXT_OUTPUT_TRUNCATED";
  const continueLyrics = { name: "继续作词（按服务计费）", exact: true };
  await row.getByRole("button", { name: "详情", exact: true }).click();
  await details.getByRole("button", { name: /第 2 次执行/ }).click();
  await result.getByText("查看作词评分", { exact: true }).click();
  await expect(result.getByText(/最近一次模型异常.*改写.*模型输出达到长度上限.*4096\/4096 token/)).toBeVisible();
  await result.getByRole("button", continueLyrics).click();
  await expect(retryConfirmation.getByText("从本次失败的作词步骤继续，保留已有稿件和评分。", { exact: true })).toBeVisible();
  await retryConfirmation.getByRole("button", { name: "取消", exact: true }).click();
  assert.deepEqual(calls.retry, []);
  await details.getByRole("button", { name: "关闭", exact: true }).click();
  await run.click();
  await retryConfirmation.getByRole("button", continueLyrics).click();
  await expect(result.getByRole("heading", { name: "第 2 次执行", exact: true })).toBeVisible();
  const stop = row.getByRole("button", { name: "停止", exact: true });
  await expect(stop).toBeEnabled();
  await expect(run).toHaveCount(0);
  assert.deepEqual(calls.retry, [{ attemptId: "fixture-lyric-attempt" }]);
  assert.equal(calls.run.length, 3);

  await back.click();
  await expect(details.getByRole("heading", { name: "执行记录（共 2 次）" })).toBeVisible();
  await details.getByRole("button", { name: /第 1 次执行/ }).click();
  await expect(result.getByRole("heading", { name: "第 1 次执行", exact: true })).toBeVisible();
  await expect(result.getByRole("heading", { name: "上一次的歌曲", exact: true })).toBeVisible();
  await expect(result.getByText("查看作词评分", { exact: true })).toHaveCount(0);
  await details.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.getByRole("region", { name: "执行结果", exact: true })).toHaveCount(0);
  await stop.click();
  await expect(row.getByText("已停止本次", { exact: true })).toBeVisible();
  await expect(run).toBeEnabled();
  assert.deepEqual(calls.stop, [{ runId: "fixture-run" }]);
  assert.equal(taskRun.state, "completed");

  const blockedRun = runs.find(row => row.id === "fixture-run");
  const blockedItem = items.find(row => row.id === "fixture-item");
  blockedRun.state = "blocked";
  blockedRun.stopRequested = false;
  blockedItem.state = "unknown";
  stageAttempts.push({ id: "fixture-music-attempt", itemId: blockedItem.id, runId: blockedRun.id, ordinal: 1,
    stage: "music_submit", state: "unknown", externalTaskId: "fixture-music-receipt" });
  await row.getByRole("button", { name: "详情", exact: true }).click();
  await expect(details).toBeVisible();
  assert.deepEqual(calls.read.at(-1), { id: plan.id });
  await expect(row.getByText("已阻塞", { exact: true })).toBeVisible();
  const remove = row.getByRole("button", { name: "删除", exact: true });
  await expect(remove).toBeDisabled();
  await expect(details.getByRole("button", { name: "删除", exact: true })).toBeDisabled();
  await details.getByRole("button", { name: "关闭", exact: true }).click();
  await run.click();
  await expect(result.getByRole("heading", { name: "第 2 次执行", exact: true })).toBeVisible();
  await expect(result.getByText(/结果未知，待对账.*fixture-music-receipt/)).toBeVisible();
  await expect(retryConfirmation).toHaveCount(0);
  assert.deepEqual(calls.retry, [{ attemptId: "fixture-lyric-attempt" }]);
  assert.equal(calls.run.length, 3);
  await details.getByRole("button", { name: "关闭", exact: true }).click();

  stageAttempts.pop();
  blockedItem.state = "failed";
  await row.getByRole("button", { name: "详情", exact: true }).click();
  await expect(row.getByText("已阻塞", { exact: true })).toBeVisible();
  await expect(remove).toBeEnabled();
  await expect(details.getByRole("button", { name: "删除", exact: true })).toBeEnabled();
  await details.getByRole("button", { name: "关闭", exact: true }).click();
  await remove.click();
  const deletion = page.getByRole("dialog", { name: "删除计划？" });
  await expect(deletion).toBeVisible();
  assert.equal(calls.remove.length, 0);
  await deletion.getByRole("button", { name: "取消", exact: true }).click();
  await remove.click();
  await deletion.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(row).toHaveCount(0);
  assert.deepEqual(calls.remove, [{ id: plan.id, expectedRevision: 2 }]);

  runs.length = 0;
  items.length = 0;
  stageAttempts.length = 0;
  await page.getByRole("button", { name: "＋ 新建计划", exact: true }).click();
  const future = palette.getByRole("button", { name: "新增生成平台", exact: true });
  await expect(future).toHaveCount(0);
  platformWorkflow = {
    nodes: [
      { id: "lyrics", label: "AI作词", kind: "lyrics", available: true },
      { id: "text:deepseek", label: "DeepSeek", kind: "text", available: true },
      { id: "music:yourmusic", label: "谱乐 AI", kind: "music", available: true },
      { id: "music:suno_cn", label: "苏诺之音", kind: "music", available: true },
      { id: "publish:fanqie", label: "番茄音乐", kind: "publish", available: true },
      { id: "publish:qishui", label: "汽水音乐", kind: "publish", available: true },
      { id: "publish:netease", label: "网易云音乐", kind: "publish", available: false },
      { id: "music:fixture-provider", label: "新增生成平台", kind: "music", available: true },
    ],
    profiles: [
      { id: "doubao-text", kind: "text", providerId: "doubao", label: "豆包默认", modelId: "doubao", textPricing: {} },
      { id: "deepseek-text", kind: "text", providerId: "deepseek", label: "DeepSeek 配置", modelId: "deepseek-test", textPricing: {} },
      { id: "pule-music", kind: "music", providerId: "yourmusic", label: "谱乐音乐", modelId: "chirp-test", revision: 1 },
      { id: "ark-cover", kind: "image", providerId: "doubao_image", label: "方舟封面", modelId: "doubao-seedream-5-5-261028", revision: 1 },
    ],
    defaults: { text: "doubao-text", music: "pule-music" },
  };
  await expect(future).toBeEnabled();
  await expect(palette.getByRole("button", { name: "网易云音乐", exact: true })).toBeDisabled();
  await dialog.getByLabel("名称", { exact: true }).fill("直连发布流程");
  const publishingPlatform = dialog.getByLabel("发布平台", { exact: true });
  const artistPicker = dialog.getByLabel("艺人信息", { exact: true });
  await publishingPlatform.selectOption("fanqie");
  await expect(artistPicker).toBeDisabled();
  const publishingAccount = dialog.getByLabel("发布账号", { exact: true });
  await expect(publishingAccount.locator("option")).toHaveText(["选择账号", fanqie.name, otherFanqie.name]);
  await publishingAccount.selectOption(fanqie.id);
  await expect(artistPicker.locator("option")).toHaveText(["选择艺人", fanqieArtist.name, instrumental.name]);
  await artistPicker.selectOption(fanqieArtist.id);
  await expect(dialog.getByText("1440 × 1440", { exact: true })).toBeVisible();
  await expect(dialog.getByText("民谣引擎", { exact: true })).toBeVisible();
  await expect(dialog.getByText("独家签约", { exact: true })).toBeVisible();
  await publishingAccount.selectOption(otherFanqie.id);
  await expect(artistPicker).toHaveValue("");
  await expect(artistPicker.locator("option")).toHaveText(["选择艺人", otherArtist.name]);
  await publishingAccount.selectOption(fanqie.id);
  await artistPicker.selectOption(fanqieArtist.id);
  const missingPublicationInput = dialog.getByRole("status").filter({ hasText: "发布节点需要上游作品" });
  await palette.getByRole("button", { name: "番茄音乐", exact: true }).click();
  await expect(save).toBeEnabled();
  await expect(missingPublicationInput).toHaveCount(0);
  await expect(artistPicker).toHaveCount(0);
  await canvas.getByRole("button", { name: "配置番茄音乐" }).click();
  const fanqieSettings = dialog.getByRole("group", { name: "番茄音乐节点配置", exact: true });
  const batchLimit = fanqieSettings.getByRole("spinbutton", { name: "每批上传上限" });
  const signing = fanqieSettings.getByRole("combobox", { name: "是否签约" });
  await expect(fanqieSettings.getByLabel("番茄音乐发布账号")).toHaveValue(fanqie.id);
  await expect(batchLimit).toHaveValue("5");
  await expect(signing).toHaveValue("false");
  await batchLimit.fill("1");
  await signing.selectOption("true");
  await signing.selectOption("false");
  await expect(fanqieSettings.getByRole("button", { name: /核对番茄账号/ })).toHaveCount(0);
  await expect(batchLimit).toHaveValue("1");
  for (const name of ["DeepSeek", "谱乐 AI", "汽水音乐"]) {
    await palette.getByRole("button", { name, exact: true }).click();
  }
  await canvas.getByRole("button", { name: "DeepSeek输出" }).dragTo(canvas.getByRole("button", { name: "谱乐 AI输入" }));
  await canvas.getByRole("button", { name: "谱乐 AI输出" }).click();
  await canvas.getByRole("button", { name: "汽水音乐输入" }).click();
  await canvas.getByRole("button", { name: "谱乐 AI输出" }).click();
  await canvas.getByRole("button", { name: "番茄音乐输入" }).click();
  await expect(missingPublicationInput).toHaveCount(0);
  await canvas.getByRole("button", { name: "配置汽水音乐" }).press("ArrowDown");
  const nodeColor = label => canvas.getByRole("group", { name: label, exact: true }).evaluate(el => getComputedStyle(el).backgroundColor);
  assert.notEqual(await nodeColor("DeepSeek"), await nodeColor("谱乐 AI"));
  assert.notEqual(await nodeColor("谱乐 AI"), await nodeColor("汽水音乐"));
  await canvas.getByRole("button", { name: "配置DeepSeek" }).click();
  await expect(dialog.getByLabel("DeepSeek 文本 API").locator("option")).toHaveText([
    "匹配配置 · DeepSeek 配置 · deepseek-test", "DeepSeek 配置 · deepseek-test",
  ]);
  await dialog.getByLabel("最多改写次数").selectOption("2");
  await canvas.getByRole("button", { name: "配置谱乐 AI" }).click();
  const generation = dialog.getByRole("group", { name: "谱乐 AI节点配置" });
  await expect(generation.getByLabel("音乐 API")).toHaveCount(0);
  await generation.getByLabel("谱乐 AI 账号").selectOption(account.id);
  await expect(generation.getByText("艺人资料", { exact: true })).toBeVisible();
  await expect(generation.getByLabel("提供商 / 渠道", { exact: true })).toHaveValue("");
  await generation.getByLabel("提供商 / 渠道", { exact: true }).selectOption("doubao_image");
  await expect(generation.getByLabel("图像模型", { exact: true })).toHaveValue("");
  await generation.getByLabel("图像模型", { exact: true }).selectOption("doubao-seedream-5-0-pro-260628");
  const titleMapping = generation.getByLabel("歌名", { exact: true });
  await expect(titleMapping.locator("option")).toHaveText(["选择上游字段", "歌名一", "歌名二", "风格描述", "歌词"]);
  await titleMapping.selectOption("alternateTitle");
  await generation.getByLabel("B 版歌名（可选）", { exact: true }).selectOption("title");
  await generation.getByLabel("音乐风格", { exact: true }).selectOption("style");
  await generation.getByLabel("歌词", { exact: true }).selectOption("lyrics");
  await artistPicker.selectOption(instrumental.id);
  await expect(generation.getByRole("group", { name: "艺人资料", exact: true })).toContainText("纯音乐");
  await expect(generation.getByLabel("歌词", { exact: true })).toHaveCount(0);
  await expect(titleMapping.locator("option")).toHaveText(["选择上游字段", "歌名一", "歌名二", "风格描述"]);
  await expect(titleMapping).toHaveValue("alternateTitle");
  await canvas.getByRole("button", { name: "配置DeepSeek" }).click();
  await expect(dialog.getByRole("spinbutton", { name: "目标评分" })).toHaveCount(0);
  await canvas.getByRole("button", { name: "配置汽水音乐" }).click();
  const accountPicker = dialog.getByLabel("汽水音乐发布账号");
  await expect(accountPicker).toHaveValue(qishui.id);
  await accountPicker.selectOption(otherQishui.id);
  await save.click();
  const graphPlan = calls.save.at(-1).plan;
  assert.deepEqual(graphPlan.workflow.graph.edges, [
    { from: "text:deepseek", to: "music:yourmusic" }, { from: "music:yourmusic", to: "publish:qishui" },
    { from: "music:yourmusic", to: "publish:fanqie" },
  ]);
  assert.ok(graphPlan.workflow.graph.positions["publish:qishui"].y > 0);
  assert.equal(graphPlan.workflow.platform, "fanqie");
  assert.equal(graphPlan.workflow.accountId, fanqie.id);
  assert.equal(graphPlan.workflow.maxRewrites, 2);
  assert.equal(graphPlan.workflow.targetScore, undefined);
  assert.deepEqual(graphPlan.workflow.browserMusic, { provider: "yourmusic", accountId: account.id,
    coverImage: { providerId: "doubao_image", profileId: "ark-cover", modelId: "doubao-seedream-5-0-pro-260628" },
    inputs: { title: "alternateTitle", alternateTitle: "title", style: "style" } });
  assert.equal(graphPlan.songType, "instrumental");
  assert.deepEqual(graphPlan.workflow.publications, [
    { platform: "fanqie", accountId: fanqie.id, fanqieBatch: { limit: 1, signContract: false } },
    { platform: "qishui", accountId: otherQishui.id },
  ]);
  assert.deepEqual(graphPlan.routing.text, { source: "override", profileId: "deepseek-text" });
  assert.equal(graphPlan.outputs.cover, true);
  assert.equal(graphPlan.authorization.publish, false);
  const graphRow = table.getByRole("row", { name: /直连发布流程/ });
  await graphRow.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(editor.getByLabel("发布平台", { exact: true })).toHaveValue("fanqie");
  await expect(editor.getByLabel("发布账号", { exact: true })).toHaveValue(fanqie.id);
  await editor.getByRole("button", { name: "配置谱乐 AI" }).click();
  await expect(editor.getByLabel("歌名", { exact: true })).toHaveValue("alternateTitle");
  await expect(editor.getByRole("group", { name: "艺人资料", exact: true })).toContainText("纯音乐");
  await expect(editor.getByLabel("提供商 / 渠道", { exact: true })).toHaveValue("doubao_image");
  await expect(editor.getByLabel("图像模型", { exact: true })).toHaveValue("doubao-seedream-5-0-pro-260628");
  await editor.getByRole("button", { name: "配置汽水音乐" }).click();
  await expect(editor.getByLabel("汽水音乐发布账号")).toHaveValue(otherQishui.id);
  await editor.getByRole("button", { name: "配置番茄音乐" }).click();
  const savedFanqieSettings = editor.getByRole("group", { name: "番茄音乐节点配置", exact: true });
  await expect(savedFanqieSettings.getByRole("spinbutton", { name: "每批上传上限" })).toHaveValue("1");
  await expect(savedFanqieSettings.getByRole("combobox", { name: "是否签约" })).toHaveValue("false");
  await savedFanqieSettings.getByRole("spinbutton", { name: "每批上传上限" }).fill("101");
  await expect(editor.getByRole("button", { name: "保存计划", exact: true })).toBeDisabled();
  await expect(editor.locator(".plan-workflow-edges path[marker-end]")).toHaveCount(3);
  await editor.getByRole("button", { name: "取消", exact: true }).click();
  await graphRow.getByRole("button", { name: "立刻执行", exact: true }).click();
  await expect(details.getByText("DeepSeek → 谱乐 AI → 汽水音乐 / 番茄音乐", { exact: true })).toBeVisible();
  await expect(confirmation).toHaveCount(0);
  assert.equal(calls.run.at(-1).confirmPublication, true);
  assert.equal(calls.run.at(-1).confirmGeneration, true);

  await details.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "＋ 新建计划", exact: true }).click();
  await dialog.getByLabel("名称", { exact: true }).fill("本地发布计划");
  await palette.getByRole("button", { name: "番茄音乐", exact: true }).click();
  await expect(dialog.getByText(/作品来源.*配置中心的下载目录/)).toBeVisible();
  await expect(dialog.getByRole("group", { name: "封面配置", exact: true })).toHaveCount(0);
  await expect(save).toBeDisabled();
  await fanqieSettings.getByLabel("番茄音乐发布账号").selectOption(otherFanqie.id);
  await expect(save).toBeEnabled();
  await save.click();
  const savedLocal = calls.save.at(-1).plan;
  assert.deepEqual(savedLocal.workflow.graph, { nodes: ["publish:fanqie"], edges: [] });
  assert.equal(savedLocal.workflow.accountId, otherFanqie.id);
  assert.deepEqual(savedLocal.outputs, { lyrics: false, cover: false, music: false });
  assert.equal(savedLocal.artistId, "");
  assert.equal(savedLocal.routing, undefined);
  await table.getByRole("row", { name: /本地发布计划/ }).getByRole("button", { name: "立刻执行", exact: true }).click();
  await expect(details.getByText("下载目录中没有可上传的歌曲，本次已停止")).toBeVisible();
  await expect(confirmation).toHaveCount(0);
  assert.equal(calls.run.at(-1).confirmGeneration, undefined);
  assert.equal(calls.run.at(-1).confirmPublication, true);
  assert.deepEqual(calls.fanqieCatalog, []);

  await details.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "＋ 新建计划", exact: true }).click();
  await dialog.getByLabel("名称", { exact: true }).fill("苏诺双歌手计划");
  await publishingPlatform.selectOption("fanqie");
  await publishingAccount.selectOption(fanqie.id);
  await artistPicker.selectOption(fanqieArtist.id);
  await palette.getByRole("button", { name: "AI作词", exact: true }).click();
  await palette.getByRole("button", { name: "苏诺之音", exact: true }).click();
  await canvas.getByRole("button", { name: "AI作词输出" }).click();
  await canvas.getByRole("button", { name: "苏诺之音输入" }).click();
  await canvas.getByRole("button", { name: "配置苏诺之音" }).click();
  const suno = dialog.getByRole("group", { name: "苏诺之音节点配置" });
  const inherited = suno.getByRole("group", { name: "艺人资料", exact: true });
  for (const field of ["甲歌手", "乙歌手", "清亮", "民谣引擎", "1440 × 1440"]) {
    await expect(inherited.getByText(field, { exact: true })).toBeVisible();
  }
  const sunoLogin = suno.getByLabel("苏诺之音 账号");
  await expect(sunoLogin).toHaveValue("");
  await expect(sunoLogin.locator("option")).toHaveText(["选择账号", sunoAccount.name]);
  await sunoLogin.selectOption(sunoAccount.id);
  await expect(suno.getByLabel("图像模型", { exact: true })).toBeDisabled();
  await suno.getByLabel("提供商 / 渠道", { exact: true }).selectOption("doubao_image");
  await suno.getByLabel("图像模型", { exact: true }).selectOption("doubao-seedream-5-0-pro-260628");
  const sunoInputs = [["歌名", "title"], ["B 版歌名（可选）", "alternateTitle"], ["音乐风格", "style"], ["歌词", "lyrics"]];
  for (const [label, value] of sunoInputs) {
    const field = suno.getByLabel(label, { exact: true });
    await expect(field).toHaveValue("");
    await field.selectOption(value);
  }
  await save.click();
  const sunoPlan = calls.save.at(-1).plan;
  assert.equal(sunoPlan.music.route, "suno_cn_browser");
  assert.deepEqual(sunoPlan.workflow.browserMusic, { provider: "suno_cn", accountId: sunoAccount.id,
    coverImage: { providerId: "doubao_image", modelId: "doubao-seedream-5-0-pro-260628", profileId: "ark-cover" },
    inputs: { title: "title", alternateTitle: "alternateTitle", style: "style", lyrics: "lyrics" } });
  await table.getByRole("row", { name: /苏诺双歌手计划/u }).getByRole("button", { name: "编辑", exact: true }).click();
  await editor.getByRole("button", { name: "配置苏诺之音", exact: true }).click();
  await page.setViewportSize({ ...viewport, height: 600 });
  const editorClose = await scrollWithPinnedClose(editor.getByRole("button", { name: "保存计划", exact: true }),
    editor.getByRole("button", { name: "关闭", exact: true }));
  await page.mouse.click(editorClose.x, editorClose.y);
  await expect(editor).toHaveCount(0);
  await page.setViewportSize(viewport);

  const { browserMusic, ...oldWorkflow } = graphPlan.workflow;
  plans[0] = { ...graphPlan, title: "旧谱乐计划", revision: plans[0].revision, createdAt, needsConfiguration: [], publishTargets: [],
    workflow: { ...oldWorkflow, pule: { accountId: browserMusic.accountId, inputs: browserMusic.inputs } },
    routeSnapshot: { image: { source: "override", capability: "image_api", profileId: "ark-cover",
      providerId: "doubao_image", modelId: "doubao-seedream-5-5-261028" } } };
  await navigation.getByRole("button", { name: "创作中心", exact: true }).click();
  await planCenter.click();
  const legacyRow = table.getByRole("row", { name: /旧谱乐计划/u });
  await legacyRow.getByRole("button", { name: "编辑", exact: true }).click();
  await editor.getByRole("button", { name: "配置谱乐 AI" }).click();
  await expect(editor.getByLabel("谱乐 AI 账号", { exact: true })).toHaveValue(account.id);
  await expect(editor.getByLabel("歌名", { exact: true })).toHaveValue("alternateTitle");
  await expect(editor.getByLabel("提供商 / 渠道", { exact: true })).toHaveValue("doubao_image");
  await expect(editor.getByLabel("图像模型", { exact: true })).toHaveValue("doubao-seedream-5-5-261028");
  assert.deepEqual(pageErrors, []);
});
