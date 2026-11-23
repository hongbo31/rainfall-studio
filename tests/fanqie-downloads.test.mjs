import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { compileFunction } from "node:vm";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { launchHeadlessChromium } from "../scripts/lib/headless-chromium.mjs";

const project = path.resolve(import.meta.dirname, "..");
const { outputFiles } = await build({
  stdin: { contents: `
    export { Repository } from './src/core/database';
    export { setDownloadDirectory } from './src/core/download-archive';
    export { readFanqieDownloadArchive, assertFanqieDownloadTrack } from './src/core/fanqie-downloads';
    export { FanqieUploadBroker } from './src/main/fanqie/upload-broker';
    export { PlanCenterService } from './src/core/plan-center';
    export { fanqieDirectoryCleanupStatus, planFanqieDirectoryAction } from './src/core/plan-fanqie-directory';
    export { createPlanFanqieDirectoryPublisher } from './src/main/fanqie/plan-directory-publisher';
    export { callPublicationTasks, tickPublicationTasks } from './src/core/publication-task-integration';
  `, resolveDir: project },
  bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
});
const mod = { exports: {} };
compileFunction(outputFiles[0].text, ["module", "exports", "require", "__dirname"])(
  mod, mod.exports, createRequire(import.meta.url), path.join(project, "output"),
);
const { Repository, setDownloadDirectory, readFanqieDownloadArchive, assertFanqieDownloadTrack, FanqieUploadBroker } = mod.exports;
const { PlanCenterService, fanqieDirectoryCleanupStatus, planFanqieDirectoryAction, createPlanFanqieDirectoryPublisher,
  callPublicationTasks, tickPublicationTasks } = mod.exports;

function archiveFixture(t) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "rainfall-fanqie-download-")));
  const downloads = path.join(root, "downloads");
  fs.mkdirSync(downloads);
  const repo = new Repository(":memory:");
  t.after(() => repo.close());
  const accountId = randomUUID(), otherAccountId = randomUUID(), templateId = randomUUID();
  repo.save("accounts", { id: accountId, provider: "fanqie", name: "素素" });
  repo.save("accounts", { id: otherAccountId, provider: "fanqie", name: "素素_团队" });
  repo.save("promptTemplates", { id: templateId, name: "国语苦情" });
  repo.save("accountLocalArtists", {
    id: randomUUID(), accountId, name: "陈白_狐", promptTemplateId: templateId,
    profile: { singer: "陈白_狐", lyricist: "本地词作者", composer: "本地曲作者", contractMode: "exclusive" },
    secondSinger: { name: "陈天狐" },
  });
  repo.save("accountLocalArtists", {
    id: randomUUID(), accountId, name: "纯音乐艺人", defaults: { voice: "instrumental" },
    profile: { singer: "纯音乐艺人", lyricist: "本地词作者", composer: "本地曲作者", contractMode: "exclusive" },
  });
  setDownloadDirectory(repo, { expectedRevision: 0, root: downloads });
  const write = (folder, files) => {
    const directory = path.join(downloads, folder);
    fs.mkdirSync(directory, { recursive: true });
    for (const [name, bytes] of Object.entries(files)) fs.writeFileSync(path.join(directory, name), bytes);
    return directory;
  };
  const song = (folder, title, { lyrics = true, cover = true, ext = ".WAV" } = {}) => write(folder, {
    [title + ext]: `single recording: ${title}`,
    ...(lyrics ? { [title + ".TXT"]: "\ufeff隔离歌词" } : {}),
    ...(cover ? { [title + ".PNG"]: "cover fixture" } : {}),
  });
  const studio = { mode: "production", repo };
  return { root, repo, downloads, write, song, accountId, otherAccountId, studio,
    scan: scope => readFanqieDownloadArchive(studio, { accountId, scope }) };
}

const folderA = "素素_陈白_狐_国语苦情";
const folderB = "素素_陈天狐_国语苦情";

test("scans only this account and binds each recording to its directory singer and sidecars", t => {
  const f = archiveFixture(t);
  const first = f.song(folderA, "《回信》");
  f.write(folderB, {
    "只此一次_B_abcd1234abcd.mp3": "a different recording",
    "只此一次_歌词_1234abcd1234.txt": "fixture lyrics",
    "只此一次_封面_abcd1234abcd.png": "A cover",
    "只此一次_封面 B_abcdabcdabcd.jpg": "B cover",
  });
  f.song("素素_纯音乐艺人_轻音乐", "散步", { lyrics: false });
  f.song("素素_新歌手_引擎_其他", "缺歌词", { lyrics: false });
  f.song(folderA, "缺封面", { cover: false });
  f.song(folderA, "回信", { ext: ".mp3" });
  f.song("素素_团队_别的歌手_引擎", "其他账号");
  f.song("素素plus_新歌手_引擎", "近名账号");
  f.song("素素_只有歌手", "少了一段");
  const archive = f.scan();
  const byTitle = title => archive.items.find(item => item.title === title && !item.issue);
  assert.equal(archive.items.length, 6);
  assert.equal(byTitle("回信").singer, "陈白_狐");
  assert.equal(byTitle("回信").credits.lyricist, "本地词作者");
  assert.equal(byTitle("只此一次 - B").singer, "陈天狐");
  assert.equal(path.basename(byTitle("只此一次 - B").source.cover.file), "只此一次_封面 B_abcdabcdabcd.jpg");
  assert.equal(byTitle("散步").instrumental, true);
  assert.equal(byTitle("散步").source.lyrics, undefined);
  assert.equal(archive.items.find(item => item.title === "缺歌词").singer, "新歌手");
  assert(archive.items.some(item => item.issue === "FANQIE_DOWNLOAD_SAME_TITLE"));
  assert(archive.items.some(item => item.issue === "FANQIE_DOWNLOAD_COVER_REQUIRED"));
  assert(archive.items.some(item => item.issue === "FANQIE_DOWNLOAD_LYRICS_REQUIRED"));
  assert.deepEqual(readFanqieDownloadArchive(f.studio, { accountId: f.otherAccountId }).items.map(item => item.title), ["其他账号"]);
  const prepared = archive.items.find(item => item.audioName === "《回信》.WAV" && !item.issue) ?? byTitle("回信");
  fs.appendFileSync(prepared.source.audio.file, " replaced");
  assert.throws(() => assertFanqieDownloadTrack(prepared), /FANQIE_DOWNLOADS_CHANGED/);
  assert.notEqual(f.scan().fingerprint, archive.fingerprint);
  assert(fs.existsSync(first));
});

test("selection refuses ambiguous account aliases and ignores linked directories", t => {
  const f = archiveFixture(t);
  const other = f.song("别人_歌手_引擎", "外部歌曲");
  fs.symlinkSync(other, path.join(f.downloads, folderA), process.platform === "win32" ? "junction" : "dir");
  assert.deepEqual(f.scan().items, []);
  f.repo.save("accounts", { id: randomUUID(), provider: "fanqie", name: "素素 " });
  assert.throws(() => f.scan(), /FANQIE_DOWNLOAD_ACCOUNT_AMBIGUOUS/);
});

test("scans title-only materials, including a single numbered folder and its companion proof", t => {
  const f = archiveFixture(t);
  const artist = f.repo.all("accountLocalArtists").find(item => item.name === "陈白_狐");
  f.repo.save("accountLocalArtists", { ...artist, hasCopyrightProof: true });
  const title = "信纸_写了一半";
  const nested = path.join(folderA, title + " (2)");
  const directory = f.song(nested, title);
  const rights = f.write(path.join(nested, "授权附件"), { [title + ".png"]: "proof fixture" });
  f.song(nested, "其他文件");
  f.song(path.join(folderA, "无关目录"), "不在上传范围");
  const [track, ...others] = f.scan().items;
  assert.deepEqual(others, []);
  assert.equal(track.folder, folderA);
  assert.equal(track.title, title);
  assert.equal(track.source.cover.file, path.join(directory, title + ".PNG"));
  assert.equal(track.source.lyrics.file, path.join(directory, title + ".TXT"));
  assert.equal(track.source.proof.file, path.join(rights, title + ".png"));
  assert.deepEqual(f.scan({ folder: folderA, id: track.id }).items, [track]);

  f.song(folderA, title);
  f.write(path.join(folderA, "授权附件"), { [title + ".png"]: "first proof" });
  const duplicates = f.scan().items;
  assert.deepEqual(duplicates.map(item => item.issue), [undefined, "FANQIE_DOWNLOAD_SAME_TITLE"]);
  assert.equal(duplicates[1].id, track.id);
});

const catalogUrl = "https://www.novelfm.com/creator/music/finished/ugc";
const preference = { mode: "exclusive", platforms: ["fanqie_music"], confirmContractManually: true };
function observeVerification(root, result, planDirectory) {
  const state = planDirectory ?? path.join(root, "production", "fanqie");
  const batchFile = planDirectory ? path.join(state, "download-runs", result.id, "batch.json") : path.join(state, "download-batch.json");
  const journal = JSON.parse(fs.readFileSync(batchFile, "utf8"));
  const records = result.items.filter(item => item.round === result.round && item.state === "uploaded")
    .map(item => ({ id: item.workId, title: item.title })).sort((a, b) => a.id.localeCompare(b.id));
  const receiptsHash = createHash("sha256").update(JSON.stringify(records)).digest("hex");
  const file = path.join(state, "download-runs", result.id, "verification-" + result.round + ".json");
  fs.writeFileSync(file, JSON.stringify({
    id: result.id, round: result.round, accountKey: journal.accountKey, receiptsHash,
    stage: "security_verification", observedAt: new Date().toISOString(),
  }));
}
function uploadFixture(f) {
  const report = { accountKey: "a".repeat(64) };
  const authors = { lyricist: "备用署名", composer: "备用署名", singer: "备用署名" };
  const artists = ["备用署名", "陈白_狐", "陈天狐", "本地词作者", "本地曲作者", "纯音乐艺人"].map((name, index) => ({
    artistId: String(50000 + index), name,
  }));
  const uploads = [], forms = [], contracts = [], rows = [], pages = [];
  let opens = 0;
  const addRow = (title, stage = "contract_pending", officialStatus = "待授权") => {
    const row = { id: String(987654321012345678n + BigInt(rows.length)), title, stage, officialStatus };
    rows.push(row);
    return row;
  };
  const options = {
    root: f.root, available: () => true, generation: () => 1, downloads: async scope => f.scan(scope),
    session: {
      status: () => ({ connected: opens > 0 }),
      ui: async action => { assert.equal(action, "open"); opens++; },
      mark: () => {},
      run: async action => action({ pages: () => pages }, () => {}),
      resolveDirectorySingers: async (_context, guard, accountKey, names) => {
        await guard();
        assert.equal(accountKey, report.accountKey);
        return new Map(names.map((name, index) => [
          name.trim().normalize("NFC"), {artistId: artists.find(artist => artist.name === name)?.artistId ?? String(60000 + index)},
        ]));
      },
      inspect: async () => ({ accountId: "10000", report, artists,
        catalog: { url: catalogUrl, source: "fixture", complete: true, total: rows.length, rows: structuredClone(rows) } }),
    },
    materials: async (_root, material) => ({ audio: material.audio, cover: material.cover,
      ...(!material.instrumental ? { lyrics: { file: path.join(f.root, "prepared.txt"), bytes: Buffer.byteLength(material.lyrics), text: material.lyrics } } : {}) }),
    verify: async () => {},
    executeDirectoryForm: async (_context, songs, callbacks) => {
      await callbacks.intent("first-step:preflight");
      await callbacks.intent("first-step:confirm-upload");
      uploads.push(...songs);
      forms.push(songs.map(song => song.title));
      for (const song of songs) addRow(song.title);
      return { url: () => catalogUrl + "/uploadProduct", isClosed: () => false, goto: async () => {}, on: () => {}, off: () => {} };
    },
    authorize: async (_root, _session, accountKey, ids, rules, guard, _stateDirectory, wholeBatch, options) => {
      await guard();
      assert.equal(accountKey, report.accountKey);
      assert.deepEqual(rules, preference);
      assert.equal(wholeBatch, true);
      if (!options.resume || !contracts.some(previous => previous.join() === ids.join())) contracts.push(ids);
      return ids.map(id => ({ id, title: rows.find(row => row.id === id).title, status: "等待合同确认", phase: "awaiting_signature" }));
    },
  };
  const broker = new FanqieUploadBroker(options);
  const configure = (directoryPreferences, owner = broker) => owner.ui("saveConfiguration", { version: 1, authors, useWorkMaterials: true, publicationConsent: true,
    authorizationPreference: preference, ...(directoryPreferences ? { directoryPreferences } : {}) });
  const preview = (owner = broker) => owner.ui("previewDownloads");
  return { options, broker, uploads, forms, contracts, rows, pages, configure, preview, addRow, opens: () => opens };
}

test("a standalone Fanqie plan scans its configured account locally and preserves verified receipts", async t => {
  const f = archiveFixture(t), fixture = uploadFixture(f);
  const recycled = [];
  let held = true;
  fixture.options.root = path.join(f.root, "application");
  fixture.options.stateDirectory = path.join(fixture.options.root, "production", "fanqie", "accounts", f.accountId);
  fixture.options.trashDownload = async file => {
    if (held && path.basename(file) === "歌曲甲.PNG") throw Error("FILE_IN_USE");
    recycled.push(file);
    fs.unlinkSync(file);
  };
  let broker = new FanqieUploadBroker(fixture.options);
  await fixture.configure({ limit: 100, signContract: true }, broker);
  const center = new PlanCenterService(f.repo, {
    prepareDownloads: () => assert.fail("a local publisher does not create generation directories"),
  });
  const studio = { ...f.studio, root: fixture.options.root, now: () => new Date(), planCenterService: () => center };
  const target = { platform: "fanqie", accountId: f.accountId,
    fanqieBatch: { limit: 1, signContract: false } };
  const plan = center.save({ expectedRevision: null, plan: {
    id: randomUUID(), title: "独立目录发布", artistId: "", schedule: { kind: "daily", localTime: "09:00" },
    material: { source: "workflow" }, outputs: { lyrics: false, cover: false, music: false },
    text: {}, music: { route: "manual" },
    workflow: { accountId: f.accountId, platform: "fanqie", graph: { nodes: ["publish:fanqie"], edges: [] },
      publications: [target], mode: "musician", inspiration: "", maxRewrites: 0 },
  } });
  assert.equal(plan.workflowSnapshot, undefined);
  const publication = (action, input) => planFanqieDirectoryAction(studio, action, input);
  const publisher = createPlanFanqieDirectoryPublisher({
    available: () => true, generation: () => 1,
    forAccount: async accountId => { assert.equal(accountId, f.accountId); return broker; },
    rpc: async (method, input) => {
      try { return { ok: true, value: publication(method.split(".").at(-1), input) }; }
      catch (error) { return { ok: false, error: { code: error.message } }; }
    },
  });
  const preview = center.preview({ id: plan.id });
  assert.equal(preview.summary.routeIssue, undefined);
  const request = () => ({ id: plan.id, expectedRevision: plan.revision, summaryHash: preview.summaryHash, requestId: randomUUID() });
  const run = id => center.list().runs.find(row => row.id === id);
  f.song("素素_团队_其他歌手", "另一个账号的作品");
  f.song(folderA, "缺少封面", { cover: false });
  assert.throws(() => center.run({ ...request(), source: "manual" }), /WORKFLOW_PUBLICATION_CONFIRMATION_REQUIRED/);
  const empty = center.run({ ...request(), source: "manual", confirmPublication: true });
  await publisher.pump();
  assert.equal(run(empty.id).state, "stopped");
  assert.equal(run(empty.id).reason, "FANQIE_DOWNLOADS_EMPTY");
  assert.equal(fixture.opens(), 0);
  assert.equal(run(empty.id).stopRequested, false);

  const secondPlan = center.save({ expectedRevision: null, plan: { ...plan, id: randomUUID(), title: "下一条发布计划" } });
  const listed = callPublicationTasks(studio, "publicationTasks.list", {});
  assert(listed.plans.some(row => row.id === plan.id && row.publishes));
  const task = callPublicationTasks(studio, "publicationTasks.save", { expectedRevision: null, task: {
    id: randomUUID(), title: "接续上传", execution: { kind: "manual" }, steps: [{ kind: "plans", planIds: [plan.id, secondPlan.id] }],
    consent: true, prepareContract: false,
  } });
  callPublicationTasks(studio, "publicationTasks.start", { id: task.id, requestId: randomUUID(), expectedRevision: task.revision });
  tickPublicationTasks(studio);
  await publisher.pump();
  assert.equal(center.list().runs.at(-1).state, "stopped");
  f.song(folderA, "歌曲甲");
  f.song(folderB, "歌曲乙");
  // Lose the Core reply after the upload. The next pump still uses the original journal.
  tickPublicationTasks(studio);
  const active = center.list().runs.findLast(row => row.planId === secondPlan.id);
  const job = publication("list", {}).find(row => row.id === active.id);
  assert.deepEqual(job.target.fanqieBatch, target.fanqieBatch);
  assert.equal(job.target.accountKey, undefined);
  assert.equal(job.target.configurationHash, undefined);
  const directoryRequest = {
    id: job.id, preferences: target.fanqieBatch, prepareContract: job.prepareContract,
  };
  const check = async () => publication("current", { runId: active.id });
  let batch = await broker.publishPlanDirectory(directoryRequest, "start", check);
  assert.equal(batch.state, "awaiting_signature");
  assert.equal(batch.cleanupPending, true);
  assert.equal(batch.preferences.signContract, false);
  assert.deepEqual(fixture.forms, [["歌曲甲"]]);
  broker = new FanqieUploadBroker(fixture.options);
  await publisher.pump();
  assert.equal(run(active.id).state, "waiting");
  for (let index = 0; index < 2; index++) {
    const ids = fixture.contracts[index];
    assert.equal(ids.length, 1);
    fixture.rows.find(row => row.id === ids[0]).contract = { state: "awaiting_signature", id: String(987654321012345600n + BigInt(index)) };
    observeVerification(fixture.options.root, batch, fixture.options.stateDirectory);
    batch = await broker.publishPlanDirectory(directoryRequest, "reconcile", check);
  }
  assert.equal(batch.state, "complete");
  await publisher.pump();
  assert.equal(run(active.id).state, "completed");
  assert.equal(run(active.id).reason, "FANQIE_DOWNLOAD_CLEANUP_PENDING");
  assert.deepEqual(fixture.forms, [["歌曲甲"], ["歌曲乙"]]);
  const saved = JSON.parse(fs.readFileSync(path.join(fixture.options.stateDirectory, "download-runs", active.id, "batch.json"), "utf8"));
  assert.equal(saved.accountKey, "a".repeat(64));
  const { directory } = publication("diagnostics", { runId: active.id });
  assert.equal(directory, path.join(fixture.options.stateDirectory, "download-runs", active.id));
  const trace = fs.readFileSync(path.join(directory, "trace.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(trace.find(entry => entry.step === "directory:scan").details, { candidateCount: 3, readyCount: 2, batchLimit: 1 });
  assert.deepEqual(trace.filter(entry => entry.step === "directory:batch-selection").map(entry => entry.details.batchSize), [1, 1]);
  assert.deepEqual(trace.filter(entry => entry.step === "directory:receipts" && entry.event === "ok").map(entry => entry.details.submittedCount), [1, 1]);
  assert.deepEqual(fixture.contracts, fixture.rows.map(row => [row.id]));
  assert.equal(await broker.ui("downloadStatus"), null, "the plan never replaces the manual batch");
  assert.equal(fs.existsSync(path.join(f.downloads, folderA, "歌曲甲.PNG")), true);
  tickPublicationTasks(studio);
  assert.equal(callPublicationTasks(studio, "publicationTasks.history", { id: task.id })[0].state, "completed");
  held = false;
  await broker.pumpDownloadCleanup(Date.now() + 60_000);
  assert.deepEqual(recycled.map(file => path.basename(file)).sort(), [
    "歌曲甲.PNG", "歌曲甲.TXT", "歌曲甲.WAV", "歌曲乙.PNG", "歌曲乙.TXT", "歌曲乙.WAV",
  ].sort());
  assert.equal(fs.existsSync(path.join(f.downloads, "素素_团队_其他歌手", "另一个账号的作品.WAV")), true);
  assert.deepEqual(center.list().items, []);
  assert.deepEqual(center.list().stageAttempts, []);

  const stopped = center.run({ ...request(), source: "manual", confirmPublication: true });
  const stoppedSong = "停止前尚未上传";
  f.song(folderA, stoppedSong);
  broker = new FanqieUploadBroker({
    ...fixture.options,
    executeDirectoryForm: (context, songs, callbacks) => fixture.options.executeDirectoryForm(context, songs, {
      ...callbacks,
      intent: async (step, index) => {
        if (step === "first-step:confirm-upload") center.stop({ runId: stopped.id });
        await callbacks.intent(step, index);
      },
    }),
  });
  await publisher.pump();
  assert.equal(run(stopped.id).state, "stopped");
  assert.equal(run(stopped.id).stopRequested, true);
  assert.equal(fs.existsSync(path.join(f.downloads, folderA, stoppedSong + ".WAV")), true);
  assert.deepEqual(fixture.forms, [["歌曲甲"], ["歌曲乙"]], "stop prevents the next confirmation");
});

test("the task signing choice overrides the directory default and a batch uses only the three available songs", async t => {
  const f = archiveFixture(t), fixture = uploadFixture(f);
  for (const title of ["歌曲1", "歌曲2", "歌曲3"]) f.song(folderA, title);
  const { broker } = fixture;
  await fixture.configure({ limit: 10, signContract: false });
  const plan = { id: randomUUID(), prepareContract: true, preferences: { limit: 100, signContract: false } };
  const check = async () => {};
  const awaiting = await broker.publishPlanDirectory(plan, "start", check);
  assert.equal(awaiting.preferences.signContract, true);
  assert.equal(awaiting.state, "awaiting_signature");
  assert.deepEqual(fixture.forms, [["歌曲1", "歌曲2", "歌曲3"]]);
  assert.deepEqual(fixture.contracts, [fixture.rows.map(row => row.id)]);
  for (const row of fixture.rows) row.contract = { state: "awaiting_signature", id: "987654321012345611" };
  observeVerification(fixture.options.root, awaiting, path.join(fixture.options.root, "production", "fanqie"));
  assert.equal((await broker.publishPlanDirectory(plan, "reconcile", check)).state, "awaiting_signature");
  for (const row of fixture.rows) Object.assign(row, { stage: "reviewing", officialStatus: "审核中" });
  const complete = await broker.publishPlanDirectory(plan, "reconcile", check);
  assert.equal(complete.state, "complete");
  assert.deepEqual(fixture.forms, [["歌曲1", "歌曲2", "歌曲3"]]);
  assert.equal(fixture.contracts.length, 1);
});

test("a fresh directory batch sends singers outside the first roster page to the upload form", async t => {
  const f = archiveFixture(t), run = uploadFixture(f);
  f.song("素素_锤宝里_测试引擎", "门前小溪");
  f.song("素素_锤七叶_测试引擎", "灯花落一寸");
  f.song(folderA, "已投稿作品");
  run.addRow("已投稿作品", "reviewing", "审核中");
  const inspect = run.options.session.inspect;
  run.options.session.inspect = async (...args) => {
    const result = await inspect(...args);
    return { ...result, artists: result.artists.slice(0, 1) };
  };
  await run.configure();

  const before = await run.preview();
  const oldId = randomUUID();
  const state = path.join(f.root, "production", "fanqie");
  fs.writeFileSync(path.join(state, "download-batch.json"), JSON.stringify({ id: oldId, state: "complete",
    items: before.items.map(item => ({ ...item, state: "failed", issue: "FANQIE_ARTIST_NAME_NOT_FOUND" })) }));
  const preview = await run.preview();
  assert.equal(preview.batch.id, oldId);
  assert.ok(preview.items.every(item => !item.issue));

  const batch = await run.broker.ui("publishDownloads", { fingerprint: preview.fingerprint, consent: true });
  assert.notEqual(batch.id, oldId);
  assert.equal(batch.state, "awaiting_signature");
  assert.deepEqual(Object.fromEntries(run.uploads.map(song => [song.title, song.authors.singer])), {
    门前小溪: "锤宝里", 灯花落一寸: "锤七叶",
  });
  assert.deepEqual(batch.items.map(({state, issue}) => [state, issue]).sort(), [
    ["skipped", "FANQIE_OFFICIAL_RECORD_ALREADY_EXISTS"], ["uploaded", undefined], ["uploaded", undefined],
  ]);
});

test("directory resolves all new singers once before opening a form and isolates an ambiguous singer", async t => {
  const f = archiveFixture(t), run = uploadFixture(f);
  f.song("素素_锤宝里_测试引擎", "清风甲");
  f.song("素素_锤宝里_测试引擎", "清风乙");
  f.song("素素_锤七叶_测试引擎", "歧义作品");
  f.song(folderA, "已投稿作品");
  run.addRow("已投稿作品", "reviewing", "审核中");
  const requests = [];
  const singerId = "9876543210123456781";
  run.options.session.resolveDirectorySingers = async (context, guard, accountKey, names) => {
    await guard();
    assert.deepEqual(context.pages(), []);
    assert.equal(accountKey, "a".repeat(64));
    assert.equal(run.forms.length, 0);
    requests.push([...names].sort());
    return new Map([
      ["锤宝里", {artistId: singerId}],
      ["锤七叶", {issue: "FANQIE_ARTIST_NAME_AMBIGUOUS"}],
    ]);
  };
  await run.configure({limit: 100, signContract: false});
  const {fingerprint} = await run.preview();
  const batch = await run.broker.ui("publishDownloads", {fingerprint, consent: true});
  assert.deepEqual(requests, [["锤七叶", "锤宝里"]]);
  assert.deepEqual(run.uploads.map(({title, singerArtistId}) => [title, singerArtistId]).sort(), [
    ["清风乙", singerId], ["清风甲", singerId],
  ]);
  assert.equal(batch.items.find(item => item.title === "歧义作品").issue, "FANQIE_ARTIST_NAME_AMBIGUOUS");
  assert.equal(batch.items.find(item => item.title === "已投稿作品").state, "skipped");
});

test("directory opens no upload form when the singer lookup changes accounts", async t => {
  const f = archiveFixture(t), run = uploadFixture(f);
  f.song(folderA, "账号切换作品");
  let lookups = 0;
  run.options.session.resolveDirectorySingers = async (_context, guard, accountKey) => {
    await guard();
    assert.equal(accountKey, "a".repeat(64));
    lookups++;
    throw Error("FANQIE_CATALOG_SCOPE_CHANGED");
  };
  await run.configure({limit: 100, signContract: false});
  const {fingerprint} = await run.preview();
  const batch = await run.broker.ui("publishDownloads", {fingerprint, consent: true});
  assert.equal(lookups, 1);
  assert.deepEqual(run.forms, []);
  assert.equal(batch.issue, "FANQIE_CATALOG_SCOPE_CHANGED");
});

test("verifies a consented directory batch, uses exact singers and prepares one contract from fresh official IDs", async t => {
  const f = archiveFixture(t);
  const first = f.song(folderA, "歌曲甲");
  f.song(folderB, "歌曲乙", { ext: ".MP3" });
  f.song("素素_纯音乐艺人_轻音乐", "纯曲", { lyrics: false });
  const run = uploadFixture(f);
  assert.equal((await run.preview()).configurationRequired, true);
  await run.configure();
  const before = await run.preview();
  assert.equal(run.opens(), 0, "preview is local");
  assert(!JSON.stringify(before).includes(f.root.replace(/\\/g, "\\\\")));
  await assert.rejects(run.broker.ui("publishDownloads", { fingerprint: before.fingerprint, consent: false }));
  const original = path.join(first, "歌曲甲.TXT");
  fs.appendFileSync(original, "\n更新后的歌词");
  await assert.rejects(run.broker.ui("publishDownloads", { fingerprint: before.fingerprint, consent: true }), /FANQIE_DOWNLOADS_CHANGED/);
  assert.equal(run.opens(), 0);
  const { fingerprint } = await run.preview();
  const batch = await run.broker.ui("publishDownloads", { fingerprint, consent: true });
  assert.equal(batch.state, "awaiting_signature");
  assert.equal(run.uploads.length, 3);
  assert.equal(run.forms.length, 1);
  assert.equal(new Set(run.uploads.map(input => input.scope.sessionId)).size, 1);
  const byTitle = title => run.uploads.find(input => input.title === title);
  assert.deepEqual(byTitle("歌曲甲").authors, { singer: "陈白_狐", lyricist: "本地词作者", composer: "本地曲作者" });
  assert.equal(byTitle("歌曲乙").authors.singer, "陈天狐");
  assert.match(byTitle("歌曲甲").assets.lyrics.text, /^隔离歌词\n更新后的歌词$/u);
  assert.equal(byTitle("纯曲").instrumental, true);
  assert.equal(byTitle("纯曲").assets.lyrics, undefined);
  assert.deepEqual(run.contracts, [batch.items.map(item => item.workId)]);
  await assert.rejects(run.broker.ui("publishDownloads", { fingerprint: (await run.preview()).fingerprint, consent: true }), /FANQIE_RECONCILIATION_REQUIRED/);
  const pendingAfterRestart = await new FanqieUploadBroker(run.options).ui("reconcileDownloads");
  assert.equal(pendingAfterRestart.state, "awaiting_signature");
  assert.equal(pendingAfterRestart.issue, "FANQIE_AUTHORIZATION_RECONCILIATION_REQUIRED");
  assert.equal(run.contracts.length, 1, "a saved pending contract is reused for status checks");
  assert.equal(run.forms.length, 1);
  Object.assign(run.rows[0], { stage: "unknown", officialStatus: "处理中" });
  const pending = await run.broker.ui("reconcileDownloads");
  assert.equal(pending.state, "needs_review");
  assert.equal(pending.items[0].issue, "FANQIE_CATALOG_STATUS_UNVERIFIED");
  assert.equal(run.contracts.length, 1);
  for (const row of run.rows) Object.assign(row, { stage: "reviewing", officialStatus: "审核中" });
  const restarted = new FanqieUploadBroker(run.options);
  const reviewed = await restarted.ui("reconcileDownloads");
  assert.equal(reviewed.state, "complete");
  assert(reviewed.items.every(item => item.officialStatus === "审核中"));
  assert.equal(run.contracts.length, 1);
  const renamed = path.join(first, "另一歌名.WAV");
  fs.copyFileSync(path.join(first, "歌曲甲.WAV"), renamed);
  fs.copyFileSync(original, path.join(first, "另一歌名.TXT"));
  fs.copyFileSync(path.join(first, "歌曲甲.PNG"), path.join(first, "另一歌名.PNG"));
  const after = await run.preview(restarted);
  assert.equal(after.items.filter(item => !item.issue).length, 1);
  const replay = await restarted.ui("publishDownloads", { fingerprint: after.fingerprint, consent: true });
  assert.equal(replay.items[0].state, "skipped");
  assert.equal(run.uploads.length, 3);
  assert.equal(fs.readFileSync(original, "utf8"), "\ufeff隔离歌词\n更新后的歌词");
});

test("existing official titles do not use the upload quota or get added to a new contract", async t => {
  const f = archiveFixture(t);
  const run = uploadFixture(f);
  for (let number = 1; number <= 100; number++) {
    const title = `歌曲${number}`;
    f.song(folderA, title);
    run.addRow(title, "reviewing", "审核中");
  }
  f.song(folderA, "歌曲101");
  await run.configure();
  const { fingerprint } = await run.preview();
  const batch = await run.broker.ui("publishDownloads", { fingerprint, consent: true });
  assert.deepEqual(run.uploads.map(input => input.title), ["歌曲101"]);
  assert.equal(batch.items.filter(item => item.state === "skipped").length, 100);
  assert.deepEqual(run.contracts, [[run.rows.at(-1).id]]);
});

test("one new execution saves a paused batch and uploads only new local songs", async t => {
  const f = archiveFixture(t);
  f.song(folderA, "已有回执");
  const run = uploadFixture(f);
  const execute = run.options.executeDirectoryForm;
  run.options.executeDirectoryForm = async (...args) => {
    const page = await execute(...args);
    return run.forms.length === 1 ? {...page, isClosed: () => true} : page;
  };
  const authorize = run.options.authorize;
  run.options.authorize = async (...args) => {
    if (run.forms.length === 1) throw Error("FANQIE_BROWSER_OPERATION_FAILED");
    return authorize(...args);
  };
  const broker = new FanqieUploadBroker(run.options);
  await run.configure(undefined, broker);
  const before = await run.preview(broker);
  const previous = await broker.ui("publishDownloads", {fingerprint: before.fingerprint, consent: true});
  assert.equal(previous.state, "needs_review");
  assert.equal(previous.remaining, 0);
  assert.equal(previous.items[0].workId, run.rows[0].id);

  f.song(folderA, "新歌");
  const current = await run.preview(broker);
  const request = {fingerprint: current.fingerprint, consent: true, limit: 1, signContract: false};
  await assert.rejects(broker.ui("publishDownloads", {...request, replaceBatchId: randomUUID()}), /FANQIE_BATCH_SCOPE_CHANGED/);
  const next = await broker.ui("publishDownloads", {...request, replaceBatchId: previous.id});
  assert.notEqual(next.id, previous.id);
  assert.equal(next.state, "awaiting_signature");
  assert.deepEqual(next.preferences, {limit: 1, signContract: false});
  assert.deepEqual(run.forms, [["已有回执"], ["新歌"]]);
  assert.deepEqual(run.contracts, [[run.rows[1].id]]);
  const saved = JSON.parse(fs.readFileSync(path.join(f.root, "production", "fanqie", "download-history", previous.id + ".json"), "utf8"));
  assert.equal(saved.items[0].workId, previous.items[0].workId);
  assert.equal(saved.state, "needs_review");
});

test("an interrupted final confirmation is reconciled by official ID without replaying the upload", async t => {
  const f = archiveFixture(t);
  f.song(folderA, "歌曲1");
  f.song(folderA, "歌曲2");
  const run = uploadFixture(f);
  const execute = run.options.executeDirectoryForm;
  run.options.executeDirectoryForm = async (...args) => {
    await execute(...args);
    throw Error("FANQIE_UPLOAD_READBACK_TIMEOUT");
  };
  await run.configure();
  const broker=new FanqieUploadBroker(run.options);
  const { fingerprint } = await run.preview(broker);
  const result = await broker.ui("publishDownloads", { fingerprint, consent: true, limit: 1 });
  assert.equal(result.state, "needs_review");
  assert.deepEqual(result.items.map(item => item.state), ["needs_review", "queued"]);
  assert.equal(run.contracts.length, 0);
  const restarted = new FanqieUploadBroker(run.options);
  assert.equal((await run.preview(restarted)).items.find(item => item.title === "歌曲1").issue, "FANQIE_RECONCILIATION_REQUIRED");
  const resultAfterRead = await restarted.ui("reconcileDownloads");
  assert.equal(resultAfterRead.state, "awaiting_signature");
  assert.equal(resultAfterRead.items[0].workId, run.rows[0].id);
  assert.equal(resultAfterRead.items[1].state, "queued");
  assert.deepEqual(run.contracts, [[run.rows[0].id]]);
  assert.equal(run.uploads.length, 1);
});

test("execution retries a pre-confirmation transfer after the original editor closes", async t => {
  const f = archiveFixture(t);
  f.song(folderA, "上传中断");
  const run = uploadFixture(f);
  const execute = run.options.executeDirectoryForm;
  run.options.executeDirectoryForm = async (_context, songs, callbacks) => {
    if (!run.pages.length) return execute(_context, songs, callbacks);
    await callbacks.intent("upload:audio");
    throw Error("FANQIE_UPLOAD_READBACK_TIMEOUT");
  };
  run.pages.push({url: () => catalogUrl + "/uploadProduct", isClosed: () => false});
  const broker = new FanqieUploadBroker(run.options);
  await run.configure(undefined, broker);
  const first = await run.preview(broker);
  const stopped = await broker.ui("publishDownloads", {fingerprint: first.fingerprint, consent: true});
  assert.equal(stopped.state, "needs_review");
  run.pages.pop();
  const preview = await run.preview(broker);
  assert.equal(preview.items[0].issue, undefined);
  const next = await broker.ui("publishDownloads", {fingerprint: preview.fingerprint, consent: true, replaceBatchId: stopped.id});
  assert.equal(next.state, "awaiting_signature");
  assert.deepEqual(run.forms, [["上传中断"]]);
});

test("a known transfer failure can be cleared after the original editor closes, without automatically uploading again", async t => {
  const f = archiveFixture(t);
  f.song(folderA, "歌曲");
  const run = uploadFixture(f);
  let attempts = 0;
  run.options.executeDirectoryForm = async (_context, _input, callbacks) => {
    attempts++;
    await callbacks.intent("upload:audio");
    run.pages.push({ url: () => catalogUrl + "/uploadProduct", isClosed: () => false });
    throw Error("FANQIE_UPLOAD_READBACK_TIMEOUT");
  };
  await run.configure();
  const broker=new FanqieUploadBroker(run.options);
  const { fingerprint } = await run.preview(broker);
  assert.equal((await broker.ui("publishDownloads", { fingerprint, consent: true })).state, "needs_review");
  assert.equal((await broker.ui("reconcileDownloads")).state, "needs_review");
  run.pages.pop();
  const checked = await broker.ui("reconcileDownloads");
  assert.equal(checked.state, "complete");
  assert.equal(checked.items[0].issue, "FANQIE_DOWNLOAD_UPLOAD_NOT_CONFIRMED");
  assert.equal(attempts, 1);
  assert.equal((await run.preview(broker)).items[0].issue, undefined);
});

test("generates contracts for every round when signing is off and limits the final round to the remaining songs", async t => {
  const f = archiveFixture(t);
  const run = uploadFixture(f);
  for (let number = 1; number <= 5; number++) f.song(folderA, `歌曲${number}`);
  await run.configure({ limit: 2, signContract: true });
  const preview = await run.preview();
  assert.equal(preview.limit, 2);
  assert.equal(preview.items.length, 5);
  let result = await run.broker.ui("publishDownloads", { fingerprint: preview.fingerprint, consent: true, signContract: false });
  assert.equal(result.state, "awaiting_signature");
  assert.deepEqual(run.forms, [["歌曲1", "歌曲2"]]);
  for (let round = 1; round <= 3; round++) {
    assert.equal(result.round, round);
    const contractIds = run.contracts[round - 1];
    const group = run.rows.filter(row => contractIds.includes(row.id));
    for (const row of group)
      row.contract = { state: "awaiting_signature", id: String(987654321012345600n + BigInt(round)) };
    assert.equal((await run.broker.ui("reconcileDownloads")).round, round, "a catalog entry alone cannot attest the verification window");
    observeVerification(run.options.root, result);
    if (round === 1) {
      const correct = group[1].contract;
      group[1].contract = {state: "awaiting_signature", id: "987654321012345699"};
      assert.equal((await run.broker.ui("reconcileDownloads")).round, round, "different contracts cannot attest the full round");
      group[1].contract = correct;
    }
    result = await run.broker.ui("reconcileDownloads");
  }
  assert.equal(result.state, "complete");
  assert.deepEqual(run.forms, [["歌曲1", "歌曲2"], ["歌曲3", "歌曲4"], ["歌曲5"]]);
  assert.equal(run.contracts.length, 3);
  assert.equal(new Set(result.items.map(item => item.workId)).size, 5);
  assert(result.items.every(item => item.officialStatus === "待授权"));
});

test("directory upload and recovery scope every catalog read to the current songs", async t => {
  const f = archiveFixture(t);
  for (let number = 1; number <= 3; number++) f.song(folderA, `本批歌曲${number}`);
  const run = uploadFixture(f);
  const inspect = run.options.session.inspect;
  const scopes = [];
  run.options.session.inspect = async (context, guard, withArtists, trace, queries) => {
    assert(Array.isArray(queries), "directory operations must never ask for the full catalog");
    scopes.push(queries.map(({ title, id }) => id ? [title, id] : title));
    const account = await inspect(context, guard);
    const rows = account.catalog.rows.filter(row => queries.some(query => row.title === query.title && (!query.id || row.id === query.id)));
    return { ...account, catalog: { ...account.catalog, total: rows.length, rows } };
  };
  const broker = new FanqieUploadBroker(run.options);
  await run.configure({ limit: 2, signContract: false });
  const { fingerprint } = await run.preview(broker);
  const initial = await broker.ui("publishDownloads", { fingerprint, consent: true });
  assert.equal(initial.state, "awaiting_signature");
  for (const row of run.rows) Object.assign(row, {stage: "reviewing", officialStatus: "审核中"});
  const second = await broker.ui("reconcileDownloads");
  assert.equal(second.state, "awaiting_signature");
  Object.assign(run.rows.at(-1), {stage: "reviewing", officialStatus: "审核中"});
  const result = await broker.ui("reconcileDownloads");
  assert.equal(result.state, "complete");
  assert.deepEqual(run.forms, [["本批歌曲1", "本批歌曲2"], ["本批歌曲3"]]);
  assert.deepEqual(scopes.map(scope => scope.slice().sort()), [
    ["本批歌曲1", "本批歌曲2"], ["本批歌曲1", "本批歌曲2"], ["本批歌曲1", "本批歌曲2"],
    run.rows.slice(0, 2).map(row => [row.title, row.id]),
    ["本批歌曲3"], ["本批歌曲3"], ["本批歌曲3"],
    [[run.rows[2].title, run.rows[2].id]],
  ]);
  const verified = await broker.ui("reconcileDownloads");
  assert.equal(verified.state, "complete");
  assert.deepEqual(scopes.at(-1).sort(), run.rows.map(row => [row.title, row.id]).sort());
  assert.equal(run.forms.length, 2);
});

test("edited continuation settings apply only to rounds that have not begun", async t => {
  const f = archiveFixture(t);
  for (let number = 1; number <= 4; number++) f.song(folderA, `歌曲${number}`);
  const run = uploadFixture(f);
  const fill = run.options.executeDirectoryForm;
  run.options.executeDirectoryForm = async (...args) => {
    const editor = await fill(...args);
    if (run.forms.length === 1) throw Error("FANQIE_UPLOAD_READBACK_TIMEOUT");
    return editor;
  };
  const broker = new FanqieUploadBroker(run.options);
  await run.configure({ limit: 1, signContract: true });
  const { fingerprint } = await run.preview(broker);
  const interrupted = await broker.ui("publishDownloads", { fingerprint, consent: true });
  assert.equal(interrupted.state, "needs_review");
  assert.equal(interrupted.remaining, 3);

  // A previously saved round stored its signing choice only on the run.
  const file = path.join(f.root, "production", "fanqie", "download-batch.json");
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  delete saved.prepareContracts;
  delete saved.active.signContract;
  fs.writeFileSync(file, JSON.stringify(saved));

  await assert.rejects(broker.ui("reconcileDownloads", { batchId: interrupted.id, preferences: { limit: 0, signContract: false } }));
  const preferences = { limit: 2, signContract: false };
  await assert.rejects(broker.ui("reconcileDownloads", { batchId: randomUUID(), preferences }), /FANQIE_BATCH_SCOPE_CHANGED/);
  const waiting = await broker.ui("reconcileDownloads", { batchId: interrupted.id, preferences });
  assert.equal(waiting.state, "awaiting_signature");
  assert.deepEqual(waiting.preferences, preferences);
  assert.deepEqual(run.contracts, [[run.rows[0].id]]);
  assert.deepEqual(run.forms, [["歌曲1"]]);

  Object.assign(run.rows[0], { stage: "reviewing", officialStatus: "审核中" });
  const finished = await broker.ui("reconcileDownloads");
  assert.equal(finished.state, "complete");
  assert.deepEqual(run.forms, [["歌曲1"], ["歌曲2", "歌曲3"], ["歌曲4"]]);
  assert.equal(run.contracts.length, 1);
  assert.equal((await run.preview(broker)).limit, 1, "the account defaults are unchanged");
});

test("uses the directory artist's release settings and requires that song's proof sidecar", t => {
  const f = archiveFixture(t);
  const artist = f.repo.all("accountLocalArtists").find(item => item.name === "陈白_狐");
  f.repo.save("accountLocalArtists", { ...artist, musicType: "cover", songAttribute: "multi_version", isAiWork: false, hasCopyrightProof: true });
  f.song(folderA, "翻唱测试");
  assert.equal(f.scan().items[0].issue, "FANQIE_DOWNLOAD_PROOF_REQUIRED");
  f.write(folderA, { "翻唱测试_版权证明.pdf": "%PDF-1.7 synthetic" });
  assert.equal(f.scan().items[0].issue, "FANQIE_DOWNLOAD_ORIGINAL_SINGER_REQUIRED");
  const updated = { ...f.repo.get("accountLocalArtists", artist.id), originalSinger: "原艺人" };
  f.repo.save("accountLocalArtists", updated);
  assert.equal(f.scan().items[0].issue, "FANQIE_DOWNLOAD_ORIGINAL_WORK_REQUIRED");
  f.repo.save("accountLocalArtists", { ...updated, originalWorkId: "987654321012345678" });
  const [item] = f.scan().items;
  assert.equal(item.issue, undefined);
  assert.equal(item.formTitle, "翻唱测试");
  assert.equal(item.title, "翻唱测试(Cover 原艺人)");
  assert.deepEqual(item.release, { musicType: "cover", songAttribute: "multi_version", ai: false, proofRequired: true,
    contractMode: "exclusive", originalSinger: "原艺人", originalWorkId: "987654321012345678" });
  assert.equal(path.basename(item.source.proof.file), "翻唱测试_版权证明.pdf");
  f.song(folderA, "压缩版权材料");
  f.song(folderA, "扫描版权材料");
  const folder = f.write(folderA, {
    "压缩版权材料_版权证明.zip": "synthetic ZIP",
    "扫描版权材料_版权证明.bmp": "synthetic BMP",
  });
  const zip = path.join(folder, "压缩版权材料_版权证明.zip");
  fs.truncateSync(zip, 51 * 1024 * 1024);
  let items = f.scan().items;
  assert.equal(items.find(track => track.formTitle === "压缩版权材料").source.proof.bytes, 51 * 1024 * 1024);
  assert.equal(path.basename(items.find(track => track.formTitle === "扫描版权材料").source.proof.file), "扫描版权材料_版权证明.bmp");
  fs.truncateSync(zip, 200 * 1024 * 1024 + 1);
  items = f.scan().items;
  assert.equal(items.find(track => track.formTitle === "压缩版权材料").issue, "FANQIE_DOWNLOAD_PROOF_INVALID");
});

test("keeps the local cover title in its form and verifies the decorated official receipt", async t => {
  const f = archiveFixture(t);
  const artist = f.repo.all("accountLocalArtists").find(item => item.name === "陈白_狐");
  f.repo.save("accountLocalArtists", { ...artist, musicType: "cover", originalSinger: "原艺人" });
  f.song(folderA, "翻唱回执");
  const run = uploadFixture(f);
  const execute = run.options.executeDirectoryForm;
  run.options.executeDirectoryForm = async (...args) => {
    const page = await execute(...args);
    assert.equal(args[1][0].originalSinger, "原艺人");
    run.rows[0].title = "翻唱回执(Cover 原艺人)";
    return page;
  };
  const authorize = run.options.authorize;
  run.options.authorize = async (...args) => {
    assert.deepEqual(args[8].uploadedTitles, ["翻唱回执"]);
    assert.deepEqual(args[8].records, [{id: run.rows[0].id, title: "翻唱回执(Cover 原艺人)"}]);
    return authorize(...args);
  };
  const broker = new FanqieUploadBroker(run.options);
  await run.configure();
  const {fingerprint} = await run.preview(broker);
  const batch = await broker.ui("publishDownloads", {fingerprint, consent: true});
  assert.equal(batch.state, "awaiting_signature");
  assert.deepEqual(run.forms, [["翻唱回执"]]);
  assert.equal(batch.items[0].workId, run.rows[0].id);
});

test("recycles confirmed round materials and waits for official signing before the next signed round", async t => {
  const f = archiveFixture(t);
  const folder = f.write(folderA, {
    "夜里_A_1234abcd1234.wav": "recording A",
    "夜里_B_1234abcd1234.wav": "recording B",
    "夜里_歌词_abcdabcdabcd.txt": "shared lyrics",
    "夜里_封面_abcdabcdabcd.png": "shared cover",
  });
  const {options,rows,forms,contracts}=uploadFixture(f);
  options.root=path.join(f.root,"application-data");
  const retained=path.join(options.root,"library-recording.wav");
  fs.mkdirSync(options.root);
  fs.writeFileSync(retained,"work library recording");
  const removed=[];
  options.trashDownload=async file=>{
    fs.renameSync(file,path.join(f.root,randomUUID()+"-recycled"+path.extname(file)));
    removed.push(path.basename(file));
  };
  const broker=new FanqieUploadBroker(options);
  await broker.ui("saveConfiguration", {version:1,useWorkMaterials:true,publicationConsent:true,
    authors:{singer:"备用署名",composer:"备用署名",lyricist:"备用署名"},authorizationPreference:preference,
    directoryPreferences:{limit:1,signContract:true}});
  const preview=await broker.ui("previewDownloads");
  const first=await broker.ui("publishDownloads",{fingerprint:preview.fingerprint,consent:true});
  assert.equal(first.state,"awaiting_signature");
  assert.equal(first.remaining,1);
  assert.deepEqual(forms,[["夜里 - A"]]);
  assert.deepEqual(removed,["夜里_A_1234abcd1234.wav"]);
  const runFolder=path.join(options.root,"production","fanqie","download-runs",first.id);
  observeVerification(options.root, first);
  const pending=await broker.ui("reconcileDownloads");
  assert.equal(pending.state,"awaiting_signature");
  assert.deepEqual(removed,["夜里_A_1234abcd1234.wav"],"the verification window does not trigger cleanup");
  Object.assign(rows[0], {contract: {state: "awaiting_signature", id: "987654321012345600"}});
  const generated=await broker.ui("reconcileDownloads");
  assert.equal(generated.state,"awaiting_signature");
  assert.equal(generated.round,1);
  assert.deepEqual(removed,["夜里_A_1234abcd1234.wav"]);
  assert.equal(fs.existsSync(path.join(folder,"夜里_歌词_abcdabcdabcd.txt")),true);
  Object.assign(rows[0],{stage:"reviewing",officialStatus:"审核中"});
  const second=await broker.ui("reconcileDownloads");
  assert.equal(second.state,"awaiting_signature");
  assert.equal(second.round,2);
  assert.deepEqual(forms,[["夜里 - A"],["夜里 - B"]]);
  assert.deepEqual(removed,["夜里_A_1234abcd1234.wav","夜里_B_1234abcd1234.wav","夜里_歌词_abcdabcdabcd.txt","夜里_封面_abcdabcdabcd.png"]);
  assert.equal(fs.existsSync(path.join(folder,"夜里_歌词_abcdabcdabcd.txt")),false);
  observeVerification(options.root, second);
  Object.assign(rows[1],{stage:"reviewing",officialStatus:"审核中"});
  const finished=await broker.ui("reconcileDownloads");
  assert.equal(finished.state,"complete");
  assert.equal(contracts.length,2);
  assert.deepEqual(removed,["夜里_A_1234abcd1234.wav","夜里_B_1234abcd1234.wav","夜里_歌词_abcdabcdabcd.txt","夜里_封面_abcdabcdabcd.png"]);
  assert.equal(fs.readFileSync(retained,"utf8"),"work library recording");
  assert(fs.readFileSync(path.join(runFolder,"trace.jsonl"),"utf8").includes("directory:recycle"));
});

test("recycles the numbered export after upload readback and before contract preparation", async t => {
  const f = archiveFixture(t);
  const title = "同名歌曲";
  const nested = f.song(path.join(folderA, title + " (2)"), title);
  const unrelated = f.write(folderA, { "同名歌曲 (3).txt": "unrelated" });
  const run = uploadFixture(f);
  run.options.root = path.join(f.root, "application");
  const recycled = [], atAuthorization = [];
  run.options.trashDownload = async file => { recycled.push(file); fs.unlinkSync(file); };
  const authorize = run.options.authorize;
  run.options.authorize = async (...args) => {
    atAuthorization.push(...recycled);
    return authorize(...args);
  };
  const broker = new FanqieUploadBroker(run.options);
  await run.configure({ limit: 1, signContract: false }, broker);
  const { fingerprint } = await run.preview(broker);
  const first = await broker.ui("publishDownloads", { fingerprint, consent: true });
  assert.equal(first.state, "awaiting_signature");
  const expected = ["同名歌曲.PNG", "同名歌曲.TXT", "同名歌曲.WAV"];
  assert.deepEqual(atAuthorization.map(file => path.relative(nested, file)).sort(), expected);
  assert.equal(fs.existsSync(path.join(run.options.root, "production", "fanqie", "download-runs", first.id, "verification-1.json")), false);
  observeVerification(run.options.root, first);
  run.rows[0].contract = { state: "awaiting_signature", id: "987654321012345600" };
  const finished = await broker.ui("reconcileDownloads");
  assert.equal(finished.state, "complete");
  assert.equal(finished.issue, undefined);
  assert.deepEqual(recycled.map(file => path.relative(nested, file)).sort(), expected);
  assert.equal(fs.readFileSync(path.join(unrelated, "同名歌曲 (3).txt"), "utf8"), "unrelated");
});

test("recycles only songs with confirmed upload IDs and recovers a delayed receipt without resubmitting", async t => {
  const f = archiveFixture(t);
  const folder = f.song(folderA, "歌曲1");
  f.song(folderA, "歌曲2");
  const run = uploadFixture(f);
  run.options.root = path.join(f.root, "application");
  run.options.trashDownload = async file => fs.unlinkSync(file);
  const execute = run.options.executeDirectoryForm;
  run.options.executeDirectoryForm = async (...args) => {
    const page = await execute(...args);
    run.rows.pop();
    return page;
  };
  const broker = new FanqieUploadBroker(run.options);
  await run.configure(undefined, broker);
  const { fingerprint } = await run.preview(broker);
  const first = await broker.ui("publishDownloads", { fingerprint, consent: true });
  assert.equal(first.state, "needs_review");
  assert.deepEqual(first.items.map(item => item.state), ["uploaded", "needs_review"]);
  assert.deepEqual(fs.readdirSync(folder).sort(), ["歌曲2.PNG", "歌曲2.TXT", "歌曲2.WAV"]);
  assert.equal(run.contracts.length, 0);

  run.addRow("歌曲2");
  const recovered = await new FanqieUploadBroker(run.options).ui("reconcileDownloads");
  assert.equal(recovered.state, "awaiting_signature");
  assert.deepEqual(fs.readdirSync(folder), []);
  assert.deepEqual(run.forms, [["歌曲1", "歌曲2"]]);
  assert.deepEqual(run.contracts, [run.rows.map(row => row.id)]);
});

test("continues signing while a held download waits for background recycling across restart", async t => {
  const f = archiveFixture(t);
  const folder = f.song(folderA, "歌曲1");
  f.song(folderA, "歌曲2");
  const run = uploadFixture(f);
  run.options.root = path.join(f.root, "application");
  let locked = true;
  run.options.trashDownload = async file => {
    if (locked && path.basename(file) === "歌曲1.TXT") throw Error("FILE_IN_USE");
    fs.unlinkSync(file);
  };
  const broker = new FanqieUploadBroker(run.options);
  await run.configure(undefined, broker);
  const { fingerprint } = await run.preview(broker);
  const first = await broker.ui("publishDownloads", { fingerprint, consent: true });
  assert.equal(first.state, "awaiting_signature");
  assert.equal(first.issue, undefined);
  assert.equal(first.cleanupPending, true);
  assert.equal(first.items[0].workId, run.rows[0].id);
  assert.deepEqual(fs.readdirSync(folder), ["歌曲1.TXT"]);
  const traceFile = path.join(run.options.root, "production", "fanqie", "download-runs", first.id, "trace.jsonl");
  const trace = fs.readFileSync(traceFile, "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert(trace.some(entry => entry.step === "directory:recycle:lyrics" && entry.songIndex === 1 && entry.code === "FANQIE_RECYCLE_OS_FAILED"));
  assert.equal(run.contracts.length, 1);

  run.options.session.run = () => assert.fail("background recycling must remain local");
  const restarted = new FanqieUploadBroker(run.options);
  const due = Date.now() + 60_000;
  await restarted.pumpDownloadCleanup(due);
  assert.deepEqual(fs.readdirSync(folder), ["歌曲1.TXT"]);
  assert.equal((await restarted.ui("downloadStatus")).cleanupPending, true);
  locked = false;
  await restarted.pumpDownloadCleanup(due + 60_000);
  const recovered = await restarted.ui("downloadStatus");
  assert.equal(recovered.state, "awaiting_signature");
  assert.equal(recovered.issue, undefined);
  assert.equal(recovered.cleanupPending, undefined);
  assert.equal(recovered.items[0].workId, first.items[0].workId);
  assert.deepEqual(fs.readdirSync(folder), []);
  assert.deepEqual(run.forms, [["歌曲1", "歌曲2"]]);
  assert.equal(run.contracts.length, 1);
});

test("stopping a task during audio readback stops its directory plan before any upload confirmation", async t => {
  const f = archiveFixture(t), fixture = uploadFixture(f);
  const root = path.join(f.root, "application");
  const stateDirectory = path.join(root, "production", "fanqie", "accounts", f.accountId);
  f.song(folderA, "音频等待停止");
  const center = new PlanCenterService(f.repo, { prepareDownloads: () => assert.fail("local publication only") });
  const studio = { ...f.studio, root, now: () => new Date(), planCenterService: () => center };
  const plan = center.save({ expectedRevision: null, plan: {
    id: randomUUID(), title: "目录上传", artistId: "", schedule: { kind: "daily", localTime: "09:00" },
    material: { source: "workflow" }, outputs: { lyrics: false, cover: false, music: false },
    text: {}, music: { route: "manual" },
    workflow: { accountId: f.accountId, platform: "fanqie", graph: { nodes: ["publish:fanqie"], edges: [] },
      publications: [{ platform: "fanqie", accountId: f.accountId }],
      mode: "musician", inspiration: "", maxRewrites: 0 },
  } });
  const task = callPublicationTasks(studio, "publicationTasks.save", { expectedRevision: null, task: {
    id: randomUUID(), title: "停止目录发布", execution: { kind: "manual" }, steps: [{ kind: "plans", planIds: [plan.id] }],
    consent: true, prepareContract: false,
  } });
  const parentRun = callPublicationTasks(studio, "publicationTasks.start", {
    id: task.id, requestId: randomUUID(), expectedRevision: task.revision,
  });
  const executeForm = fixture.options.executeDirectoryForm;
  let audioIntents = 0, readbackError, stopped;
  const broker = new FanqieUploadBroker({ ...fixture.options, root, stateDirectory,
    async executeDirectoryForm(context, songs, callbacks) {
      await callbacks.intent("upload:audio", 0);
      audioIntents++;
      stopped = callPublicationTasks(studio, "publicationTasks.stop", { id: parentRun.id });
      try { await callbacks.checkStopped(); }
      catch (error) { readbackError = error.message; throw error; }
      return executeForm(context, songs, callbacks);
    },
  });
  await fixture.configure(undefined, broker);
  const rpcCalls = [];
  const publisher = createPlanFanqieDirectoryPublisher({
    available: () => true, generation: () => 1, forAccount: async () => broker,
    async rpc(method, input) {
      const name = method.split(".").at(-1);
      rpcCalls.push(name);
      try { return { ok: true, value: planFanqieDirectoryAction(studio, name, input) }; }
      catch (error) { return { ok: false, error: { code: error.message } }; }
    },
  });
  tickPublicationTasks(studio);
  await publisher.pump();
  assert.equal(audioIntents, 1);
  assert.equal(readbackError, "STOP_REQUESTED");
  assert.equal(stopped.state, "stopped");
  const child = center.list().runs.find(row => row.id === stopped.linked[0].id);
  assert.equal(child.state, "stopped");
  assert.equal(child.stopRequested, true);
  assert.deepEqual(fixture.uploads, []);
  assert.deepEqual(fixture.rows, []);
  assert.deepEqual(fixture.contracts, []);
  const uploads = path.join(stateDirectory, "uploads");
  const [file] = fs.readdirSync(uploads);
  const journal = JSON.parse(fs.readFileSync(path.join(uploads, file), "utf8"));
  assert.equal(journal.pending, "upload:audio");
  assert.equal(journal.phase, "unknown");
  assert.equal(journal.reason, "STOP_REQUESTED");
  rpcCalls.length = 0;
  tickPublicationTasks(studio);
  await publisher.pump();
  assert.deepEqual(rpcCalls, ["list"]);
  assert.equal(audioIntents, 1);
  const [history] = callPublicationTasks(studio, "publicationTasks.history", { id: task.id });
  assert.equal(history.state, "stopped");
});

test("retries historical plan cleanup locally with exactly the original saved receipts", async t => {
  const f = archiveFixture(t), fixture = uploadFixture(f);
  const root = path.join(f.root, "application");
  const stateDirectory = path.join(root, "production", "fanqie", "accounts", f.accountId);
  const folder = f.song(folderA, "已上传");
  const remaining = path.join(folder, "已上传.PNG");
  const attempts = [];
  let locked = true;
  let archiveUnavailable = false;
  const executeForm = fixture.options.executeDirectoryForm;
  fixture.options.executeDirectoryForm = async (...args) => {
    const editor = await executeForm(...args);
    archiveUnavailable = true;
    return editor;
  };
  fixture.options.downloads = async scope => archiveUnavailable ? { items: [] } : f.scan(scope);
  let broker = new FanqieUploadBroker({ ...fixture.options, root, stateDirectory, trashDownload: async file => {
    attempts.push(file);
    if (file === remaining && locked) throw Error("FILE_IN_USE");
    fs.unlinkSync(file);
  } });
  await fixture.configure(undefined, broker);
  const center = new PlanCenterService(f.repo, { prepareDownloads: () => assert.fail("local publication only") });
  const studio = { ...f.studio, root, now: () => new Date(), planCenterService: () => center };
  const plan = center.save({ expectedRevision: null, plan: {
    id: randomUUID(), title: "目录上传", artistId: "", schedule: { kind: "daily", localTime: "09:00" },
    material: { source: "workflow" }, outputs: { lyrics: false, cover: false, music: false },
    text: {}, music: { route: "manual" },
    workflow: { accountId: f.accountId, platform: "fanqie", graph: { nodes: ["publish:fanqie"], edges: [] },
      publications: [{ platform: "fanqie", accountId: f.accountId, fanqieBatch: { limit: 30, signContract: false } }],
      mode: "musician", inspiration: "", maxRewrites: 0 },
  } });
  const action = (name, input) => planFanqieDirectoryAction(studio, name, input);
  const publisher = createPlanFanqieDirectoryPublisher({
    available: () => true, generation: () => 1,
    forAccount: async accountId => { assert.equal(accountId, f.accountId); return broker; },
    rpc: async (method, input) => {
      try { return { ok: true, value: action(method.split(".").at(-1), input) }; }
      catch (error) { return { ok: false, error: { code: error.message } }; }
    },
  });
  const task = callPublicationTasks(studio, "publicationTasks.save", { expectedRevision: null, task: {
    id: randomUUID(), title: "上传后回收", execution: { kind: "manual" }, steps: [{ kind: "plans", planIds: [plan.id] }],
    consent: true, prepareContract: false,
  } });
  callPublicationTasks(studio, "publicationTasks.start", { id: task.id, requestId: randomUUID(), expectedRevision: task.revision });
  tickPublicationTasks(studio);
  await publisher.pump();
  const { id: runId } = center.list().runs.find(run => run.planId === plan.id);
  const readRun = () => center.list().runs.find(run => run.id === runId);
  assert.equal(readRun().reason, "FANQIE_DOWNLOAD_CLEANUP_FAILED");
  // Older upload-only batches did not save a contract preparation flag.
  const batchPath = path.join(stateDirectory, "download-runs", runId, "batch.json");
  const legacy = JSON.parse(fs.readFileSync(batchPath, "utf8"));
  delete legacy.prepareContracts;
  fs.writeFileSync(batchPath, JSON.stringify(legacy));
  const historical = action("record", { runId, state: "failed", reason: readRun().reason });
  tickPublicationTasks(studio);
  assert.equal(fanqieDirectoryCleanupStatus(root, historical), "pending");
  fs.unlinkSync(path.join(folder, "已上传.WAV"));
  fs.unlinkSync(path.join(folder, "已上传.TXT"));
  assert.deepEqual(fs.readdirSync(folder), ["已上传.PNG"]);

  fixture.options.session.run = () => assert.fail("cleanup must not connect to the browser");
  archiveUnavailable = false;
  attempts.length = 0;
  const uploads = path.join(stateDirectory, "uploads");
  const receiptPath = path.join(uploads, fs.readdirSync(uploads).find(file => file.endsWith(".json")));
  const receipt = fs.readFileSync(receiptPath, "utf8");
  const wrongReceipt = JSON.parse(receipt);
  wrongReceipt.download.sourceIdentity += ":changed";
  fs.writeFileSync(receiptPath, JSON.stringify(wrongReceipt));
  await assert.rejects(publisher.retryCleanup({ runId }), /FANQIE_SAVED_WORK_READBACK_REQUIRED/);
  assert.deepEqual(attempts, []);
  fs.writeFileSync(receiptPath, receipt);

  await publisher.recoverLegacyCleanup();
  assert.equal(fanqieDirectoryCleanupStatus(root, readRun()), "queued");
  assert.deepEqual(attempts, [remaining, remaining, remaining]);
  assert.deepEqual(fs.readdirSync(folder), ["已上传.PNG"]);
  locked = false;
  await broker.pumpDownloadCleanup(Date.now() + 60_000);
  assert.deepEqual(attempts, [remaining, remaining, remaining, remaining]);
  assert.deepEqual(fs.readdirSync(folder), []);
  assert.deepEqual(fixture.forms, [["已上传"]]);
  assert.deepEqual(fixture.contracts, []);
  assert.equal(fs.readFileSync(receiptPath, "utf8"), receipt);
  assert.equal(fanqieDirectoryCleanupStatus(root, readRun()), "recycled");
  assert.deepEqual(readRun(), historical);
  await publisher.retryCleanup({ runId });
  assert.equal(attempts.length, 4, "reopening the recovered run does not recycle again");
  const progress = callPublicationTasks(studio, "publicationTasks.list", { expandedTaskId: task.id }).tasks[0].planProgress;
  assert.equal(progress[0].reason, "FANQIE_DOWNLOAD_CLEANUP_RECOVERED");
});

test("recovers a pending plan batch whose legacy journal marked cleanup without recycling", async t => {
  const f = archiveFixture(t);
  const folder = f.song(folderA, "旧批歌曲");
  const run = uploadFixture(f);
  run.options.root = path.join(f.root, "application");
  const plan = { id: randomUUID(), preferences: { limit: 1, signContract: true } };
  const check = async () => {};
  const broker = new FanqieUploadBroker(run.options);
  await run.configure(undefined, broker);
  const first = await broker.publishPlanDirectory(plan, "start", check);
  assert.equal(first.state, "awaiting_signature");
  const file = path.join(run.options.root, "production", "fanqie", "download-runs", plan.id, "batch.json");
  const journal = JSON.parse(fs.readFileSync(file, "utf8"));
  journal.active.materialsRecycled = true;
  fs.writeFileSync(file, JSON.stringify(journal));

  const restored = new FanqieUploadBroker({ ...run.options, trashDownload: async file => fs.unlinkSync(file) });
  const recovered = await restored.publishPlanDirectory(plan, "reconcile", check);
  assert.equal(recovered.state, "awaiting_signature");
  assert.equal(recovered.items[0].workId, first.items[0].workId);
  assert.deepEqual(fs.readdirSync(folder), []);
  assert.deepEqual(run.forms, [["旧批歌曲"]]);
});

test("recycling a submitted cover preserves that file when another recording still needs it as proof", async t => {
  const f = archiveFixture(t);
  const artist = f.repo.all("accountLocalArtists").find(item => item.name === "陈白_狐");
  f.repo.save("accountLocalArtists", { ...artist, hasCopyrightProof: true });
  const folder = f.song(folderA, "歌曲甲", { lyrics: false });
  f.song(folderA, "歌曲甲_版权证明");
  f.write(folderA, { "歌曲甲_版权证明_版权证明.pdf": "%PDF-1.7 fixture" });
  const { options, rows } = uploadFixture(f);
  options.root = path.join(f.root, "application");
  const recycled = [];
  options.trashDownload = async file => { recycled.push(path.basename(file)); fs.unlinkSync(file); };
  const broker = new FanqieUploadBroker(options);
  await broker.ui("saveConfiguration", { version: 1, useWorkMaterials: true, publicationConsent: true,
    authors: { singer: "备用署名", composer: "备用署名", lyricist: "备用署名" }, authorizationPreference: preference });
  const preview = await broker.ui("previewDownloads");
  assert.equal(preview.items.find(track => track.title === "歌曲甲").issue, "FANQIE_DOWNLOAD_LYRICS_REQUIRED");
  const first = await broker.ui("publishDownloads", { fingerprint: preview.fingerprint, consent: true });
  assert.equal(first.state, "awaiting_signature");
  assert.equal(rows[0].title, "歌曲甲_版权证明");
  observeVerification(options.root, first);
  Object.assign(rows[0], { stage: "reviewing", officialStatus: "审核中" });
  assert.equal((await broker.ui("reconcileDownloads")).state, "complete");
  assert.deepEqual(recycled, ["歌曲甲_版权证明.WAV", "歌曲甲_版权证明.TXT"]);
  assert(fs.existsSync(path.join(folder, "歌曲甲_版权证明.PNG")));
});

test("a completed round preserves copyright proof when the same file is another submitted cover", async t => {
  const f = archiveFixture(t);
  const artist = f.repo.all("accountLocalArtists").find(item => item.name === "陈白_狐");
  f.repo.save("accountLocalArtists", { ...artist, hasCopyrightProof: true });
  const folder = f.song(folderA, "歌曲甲");
  f.song(folderA, "歌曲甲_版权证明");
  f.write(folderA, { "歌曲甲_版权证明_版权证明.pdf": "%PDF-1.7 fixture" });
  const {options, rows, configure, preview} = uploadFixture(f);
  options.root = path.join(f.root, "application");
  options.trashDownload = async file => fs.unlinkSync(file);
  const broker = new FanqieUploadBroker(options);
  await configure(undefined, broker);
  const {fingerprint} = await preview(broker);
  const first = await broker.ui("publishDownloads", {fingerprint, consent: true, signContract: false});
  assert.equal(first.state, "awaiting_signature");
  assert.equal(rows.length, 2);
  observeVerification(options.root, first);
  for (const row of rows) row.contract = {state: "awaiting_signature", id: "987654321012345600"};
  assert.equal((await broker.ui("reconcileDownloads")).state, "complete");
  assert.deepEqual(fs.readdirSync(folder).sort(), ["歌曲甲_版权证明.PNG", "歌曲甲_版权证明_版权证明.pdf"].sort());
});

test("a settings change after a signed round releases unsent songs for a freshly confirmed run", async t => {
  const f = archiveFixture(t);
  f.song(folderA, "歌曲1");
  f.song(folderA, "歌曲2");
  const run = uploadFixture(f);
  await run.configure({ limit: 1, signContract: true });
  const preview = await run.preview();
  const first = await run.broker.ui("publishDownloads", { fingerprint: preview.fingerprint, consent: true });
  observeVerification(run.options.root, first);
  Object.assign(run.rows[0], { stage: "reviewing", officialStatus: "审核中" });
  await run.configure({ limit: 2, signContract: true });
  const finished = await run.broker.ui("reconcileDownloads");
  assert.equal(finished.state, "complete");
  assert.equal(finished.issue, "FANQIE_CONFIGURATION_CHANGED");
  assert.deepEqual(finished.items.map(item => item.state), ["uploaded", "failed"]);
  assert.equal(run.forms.length, 1);
  const fresh = await run.preview();
  assert.deepEqual(fresh.items.filter(item => !item.issue).map(item => item.title), ["歌曲2"]);
});

async function signingFixture(t, titles, signContract = true, generation) {
  const f = archiveFixture(t);
  for (const title of titles) f.song(folderA, title);
  const {options, rows, forms} = uploadFixture(f);
  const browser = await launchHeadlessChromium(chromium);
  t.after(() => browser.close());
  const context = await browser.newContext({serviceWorkers: "block"});
  const formUrl = catalogUrl + "/uploadProduct";
  const releaseUrl = new URL("/creator/music/publishWorks", catalogUrl).href;
  const verifyOrigin = "https://verification.invalid";
  const missingLink = verifyOrigin + "/result?text=" + encodeURIComponent("未进入签约阶段，签约链接未生成。");
  const refused = [];
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    let body;
    if (url.href === formUrl) body = '<h2>确认签约协议</h2><button>确认签署</button>';
    else if (url.href === releaseUrl) body = "<h2>发布作品</h2>";
    else if (url.pathname === "/creator/music/home" && url.origin === new URL(catalogUrl).origin) body = "番茄创作首页";
    else if (url.href === missingLink) body = "暂时无法打开";
    else if (url.origin === verifyOrigin && url.pathname === "/direct")
      body = '<h2>文件签署</h2><div class="ds-signature-base">签名区</div><button>签署</button>';
    else if (url.origin === verifyOrigin && url.pathname === "/sms") body = "<span>数据安全验证</span>";
    else if (url.origin === verifyOrigin && url.pathname === "/signed") body = "<h2>签署完成</h2>";
    else if (url.origin === verifyOrigin && url.pathname === "/help") body = "<h2>文件签署</h2><p>签署说明</p>";
    else {
      refused.push(url.origin);
      return route.abort();
    }
    return route.fulfill({contentType: "text/html; charset=utf-8", body});
  });
  const previews = [];
  let generationAttempts = 0;
  const authorize = options.authorize;
  options.session.run = async action => action(context, () => {});
  options.authorize = async (...args) => {
    const page = previews[0] ?? await context.newPage();
    await page.goto(formUrl);
    previews.push(page);
    const results = await authorize(...args);
    if (generation && args[8].beforeGenerate) {
      await page.evaluate(popup => {
        document.querySelector("button").onclick = event => {
          if (popup) {
            event.currentTarget.innerHTML = '<span>合同生成中</span>';
            window.open(popup, "_blank");
          }
        };
      }, generation === "verification" ? verifyOrigin + "/sms" : undefined);
      await args[8].beforeGenerate(page);
      const journal = JSON.parse(fs.readFileSync(path.join(f.root, "production", "fanqie", "download-batch.json"), "utf8"));
      assert(Number.isFinite(journal.active.contractGenerationRequestedAt));
      generationAttempts++;
      await page.getByRole("button", {name: "确认签署", exact: true}).click();
    } else args[8].onPreview(page);
    return results;
  };
  const broker = new FanqieUploadBroker(options);
  await broker.ui("saveConfiguration", {version: 1, useWorkMaterials: true, publicationConsent: true,
    authors: {singer: "备用署名", composer: "备用署名", lyricist: "备用署名"}, authorizationPreference: preference,
    directoryPreferences: {limit: 1, signContract}});
  const preview = await broker.ui("previewDownloads");
  const first = await broker.ui("publishDownloads", {fingerprint: preview.fingerprint, consent: true});
  assert.equal(first.state, "awaiting_signature");
  const wait = async (ready, message, timeout = 4500) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await ready()) return;
      await delay(100);
    }
    assert.fail(message);
  };
  const trace = path.join(f.root, "production", "fanqie", "download-runs", first.id, "trace.jsonl");
  return {broker, options, first, rows, forms, context, previews, trace, wait, releaseUrl, verifyOrigin, missingLink, refused,
    generationAttempts: () => generationAttempts};
}

test("waits for generation to finish even if the owned security page is already open, then continues without a repeat click", async t => {
  const {broker, rows, forms, previews, trace, wait, generationAttempts} = await signingFixture(t, ["甲", "乙"], false, "verification");
  const page = previews[0];
  assert.equal(generationAttempts(), 1);
  await wait(() => page.context().pages().length === 2, "Fanqie opens one verification tab");
  const marker = path.join(path.dirname(trace), "verification-1.json");
  await delay(650);
  assert.equal((await broker.ui("downloadStatus")).signatureStage, "generating");
  assert.equal(fs.existsSync(marker), false);
  assert.deepEqual(forms, [["甲"]]);
  rows[0].contract = {state: "awaiting_signature", id: "987654321012345600"};
  await page.evaluate(() => { document.body.innerHTML = '<p>已跳转签约页</p>'; });
  await wait(() => fs.existsSync(marker), "the owned verification window is observed after generation stops");
  await wait(async () => {
    const status = await broker.ui("downloadStatus");
    return status.round === 2 && status.state === "awaiting_signature";
  }, "the next batch starts automatically once the official contract exists", 18_000);
  assert.deepEqual(forms, [["甲"], ["乙"]]);
  assert.equal(rows[0].stage, "contract_pending");
  await wait(() => generationAttempts() === 2 && page.context().pages().length === 2,
    "the next round replaces the finished round's verification tab");
  const lastPopup = page.context().pages().find(tab => tab !== page);
  rows[1].contract = {state: "awaiting_signature", id: "987654321012345601"};
  await page.evaluate(() => { document.body.innerHTML = '<p>已跳转签约页</p>'; });
  await wait(async () => (await broker.ui("downloadStatus")).state === "complete", "the last generated contract completes the batch");
  await wait(() => page.isClosed() && lastPopup.isClosed(), "completion closes both pages of the dedicated browser window");
  assert.equal(generationAttempts(), 2);
});

test("starts the 15 minute deadline at the generation click and never clicks twice for one round on recovery", {timeout: 25_000}, async t => {
  const {broker, options, rows, first, forms, previews, trace, wait, generationAttempts} = await signingFixture(t, ["甲"], false, "silent");
  assert.equal(generationAttempts(), 1);
  assert.equal(first.signatureStage, "generating");
  const now = Date.now;
  const mocked = t.mock.method(Date, "now", () => now() + 15 * 60_000 + 1);
  await wait(async () => (await broker.ui("downloadStatus")).issue === "FANQIE_CONTRACT_GENERATION_TIMEOUT",
    "the deadline applies even if the website never renders a spinner or an additional window");
  mocked.mock.restore();
  rows[0].contract = {state: "not_created"};
  const restored = new FanqieUploadBroker(options);
  const resumed = await restored.ui("reconcileDownloads", {batchId: first.id});
  assert.equal(resumed.signatureStage, "manual_confirmation");
  assert.equal(previews.length, 2);
  assert.equal(generationAttempts(), 1);
  assert.deepEqual(forms, [["甲"]]);
  assert.equal(fs.existsSync(path.join(path.dirname(trace), "verification-1.json")), false);
});

test("requires the new security verification page before waiting for a signed receipt", async t => {
  const fixture = await signingFixture(t, ["甲", "乙"]);
  const {broker, first, rows, forms, context, previews, trace, wait, verifyOrigin, missingLink, refused} = fixture;
  assert.equal(first.remaining, 1);
  const page = previews[0];
  const marker = path.join(path.dirname(trace), "verification-1.json");
  const downloadStatus = () => broker.ui("downloadStatus");
  const stage = async () => (await downloadStatus()).signatureStage;
  const initialStage = await stage();
  const unrelated = await context.newPage();
  await unrelated.goto(verifyOrigin + "/sms");
  await page.evaluate(() => {
    document.querySelector("button").onclick = event => {event.target.textContent = "合同生成中";};
  });
  const manualConfirm = page.getByRole("button", {name: "确认签署", exact: true});
  await manualConfirm.click();
  await wait(async () => await stage() === "generating", "the observed click starts generation");
  const generatingStage = await stage();
  assert.equal(fs.existsSync(marker), false, "an independently opened verification tab cannot attest this batch");
  await page.evaluate(() => {document.querySelector("button").textContent = "确认签署";});
  await wait(async () => (await downloadStatus()).issue === "FANQIE_CONTRACT_GENERATION_FAILED",
    "a return to the confirm button records the failed generation");
  assert.equal(context.pages().length, 2, "Rainfall waits for the user's next action");
  await manualConfirm.click();
  await wait(async () => await stage() === "generating", "the user's new click clears the old generation failure");
  assert.equal((await downloadStatus()).issue, undefined);
  await page.evaluate(() => {
    document.body.innerHTML = '<p>已跳转签约页</p><button>跳转授权</button>';
  });
  await wait(async () => await stage() === "open_signing_page", "the official handoff exposes the opening stage");
  const openingStage = await stage();
  const openAuthorizedPopup = async url => {
    await page.evaluate(target => {
      document.querySelector("button").onclick = () => {
        const link = document.createElement("a");
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.href = target;
        document.body.append(link);
        link.click();
        link.remove();
      };
    }, url);
    const [popup] = await Promise.all([
      page.waitForEvent("popup"), page.getByRole("button", {name: "跳转授权"}).click(),
    ]);
    await popup.waitForLoadState("domcontentloaded");
    return popup;
  };
  await openAuthorizedPopup(verifyOrigin + "/help");
  await openAuthorizedPopup(missingLink);
  await wait(async () => (await downloadStatus()).issue === "FANQIE_CONTRACT_LINK_NOT_READY",
    "a deferred signing link yields an actionable error");
  assert.equal(fs.existsSync(marker), false, "the official link-not-ready page cannot attest this batch");
  await openAuthorizedPopup(verifyOrigin + "/direct");
  await delay(650);
  assert.equal(fs.existsSync(marker), false, "the signature editor alone does not attest the security stage");
  const signing = await openAuthorizedPopup(verifyOrigin + "/sms");
  await wait(() => fs.existsSync(marker), "the owned security verification page can be located among unrelated tabs");
  assert.equal(JSON.parse(fs.readFileSync(marker, "utf8")).stage, "security_verification");
  assert.equal(initialStage, "manual_confirmation");
  assert.equal(generatingStage, "generating");
  assert.equal(openingStage, "open_signing_page");
  assert.equal(await stage(), "complete_signing");
  assert.equal((await downloadStatus()).issue, undefined);
  const traceEntries = fs.readFileSync(trace, "utf8").trim().split("\n").map(JSON.parse);
  const generationError = traceEntries.find(entry => entry.code === "FANQIE_CONTRACT_GENERATION_FAILED");
  assert.match(generationError.screenshot, /^screenshots\/event-.*\.png$/u);
  const linkError = traceEntries.find(entry => entry.code === "FANQIE_CONTRACT_LINK_NOT_READY");
  assert.match(linkError.screenshot, /^screenshots\/event-.*\.png$/u);
  assert.equal(linkError.screenshotMode, "redacted-signing-layout");
  assert.doesNotMatch(JSON.stringify(traceEntries), /verification\.invalid|签约链接未生成/u);
  assert.equal(forms.length, 1, "a signing page alone does not advance the batch");

  Object.assign(rows[0], {stage: "reviewing", officialStatus: "审核中"});
  await wait(async () => {
    const status = await downloadStatus();
    return status.round === 2 && status.state === "awaiting_signature";
  }, "the identical official work must reach review before the next round begins", 18_000);
  assert.equal(forms.length, 2);
  assert.equal(forms.flat().filter(title => title === "甲").length, 1);
  assert.equal(signing.isClosed(), false, "readback can complete while the signing page stays open");

  const secondMarker = path.join(path.dirname(trace), "verification-2.json");
  const second = previews[1];
  await second.evaluate(origin => {
    document.querySelector("button").onclick = () => window.open(origin + "/sms", "_blank");
  }, verifyOrigin);
  const [secondSigning] = await Promise.all([
    second.waitForEvent("popup"), second.getByRole("button", {name: "确认签署"}).click(),
  ]);
  await wait(() => fs.existsSync(secondMarker), "the usual security verification step remains supported");
  await secondSigning.goto(verifyOrigin + "/signed");
  Object.assign(rows[1], {stage: "reviewing", officialStatus: "审核中"});
  await wait(async () => (await downloadStatus()).state === "complete", "the signed receipts complete the full batch", 18_000);
  await wait(() => second.isClosed() && signing.isClosed() && secondSigning.isClosed(),
    "the finished upload and both verified signing pages close");
  assert.equal(unrelated.isClosed(), false, "a page opened outside this run remains available");
  assert.deepEqual(refused, []);
});

test("leaving the contract preview keeps the existing uploads pending without reporting generation", async t => {
  const {broker, options, first, rows, forms, previews, trace, wait, releaseUrl} = await signingFixture(t, ["甲"]);
  await previews[0].goto(releaseUrl);
  await wait(async () => (await broker.ui("downloadStatus")).issue === "FANQIE_CONTRACT_PREVIEW_LEFT",
    "returning to the release menu reports that the contract preview was left");
  await wait(() => fs.readFileSync(trace, "utf8").includes('"code":"FANQIE_CONTRACT_PREVIEW_LEFT"'),
    "the execution log records leaving the contract preview");
  const entries = fs.readFileSync(trace, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(entries.some(entry => entry.step === "contract:generation"), false);
  assert.equal(entries.find(entry => entry.code === "FANQIE_CONTRACT_PREVIEW_LEFT").step, "contract:preview-left");

  const restored = new FanqieUploadBroker(options);
  const pending = await restored.ui("reconcileDownloads");
  assert.equal(pending.id, first.id);
  assert.equal(pending.state, "awaiting_signature");
  assert.equal(pending.issue, "FANQIE_CONTRACT_PREVIEW_LEFT");
  assert.equal(pending.items[0].workId, first.items[0].workId);
  assert.deepEqual(forms, [["甲"]]);
  Object.assign(rows[0], {stage: "reviewing", officialStatus: "审核中"});
  const checked = await restored.ui("reconcileDownloads");
  assert.equal(checked.state, "complete");
  assert.equal(checked.issue, undefined);
  assert.deepEqual(forms, [["甲"]]);
});

test("one status check resumes a saved batch and watches the new preview until review", async t => {
  const {broker, options, first, rows, forms, previews, trace, wait, releaseUrl, verifyOrigin} =
    await signingFixture(t, ["甲"]);
  rows[0].contract = {state: "not_created"};
  const help = await Promise.all([
    previews[0].waitForEvent("popup"),
    previews[0].evaluate(origin => { window.open(origin + "/help", "_blank"); }, verifyOrigin),
  ]).then(([popup]) => popup);
  await previews[0].goto(releaseUrl);
  await wait(async () => (await broker.ui("downloadStatus")).issue === "FANQIE_CONTRACT_PREVIEW_LEFT",
    "an auxiliary popup cannot keep an abandoned preview active", 8_000);
  assert.equal(help.isClosed(), false);

  const restored = new FanqieUploadBroker(options);
  await assert.rejects(restored.ui("reconcileDownloads", {batchId: randomUUID()}), /FANQIE_BATCH_SCOPE_CHANGED/);
  const resumed = await restored.ui("reconcileDownloads", {batchId: first.id});
  assert.equal(resumed.id, first.id);
  assert.equal(resumed.signatureStage, "manual_confirmation", "the first status check must execute preparation");
  assert.equal(resumed.issue, undefined);
  assert.equal(previews.length, 2);
  assert.deepEqual(forms, [["甲"]]);

  const page = previews[1];
  await page.evaluate(origin => {
    document.querySelector("button").onclick = () => window.open(origin + "/sms", "_blank");
  }, verifyOrigin);
  await page.getByRole("button", {name: "确认签署", exact: true}).click();
  const marker = path.join(path.dirname(trace), "verification-1.json");
  await wait(() => fs.existsSync(marker), "the resumed run automatically observes the user's verification page");
  Object.assign(rows[0], {stage: "reviewing", officialStatus: "审核中"});
  await wait(async () => (await restored.ui("downloadStatus")).state === "complete",
    "the original batch is reconciled without another status check", 18_000);
  assert.deepEqual(forms, [["甲"]]);
});
