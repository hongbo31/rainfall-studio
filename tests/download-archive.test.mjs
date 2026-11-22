import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { compileFunction } from "node:vm";
import test from "node:test";
import { build } from "esbuild";

const project = path.resolve(import.meta.dirname, "..");
const { outputFiles } = await build({
  stdin: { contents: `
    export * from './src/core/download-archive';
    export { Repository } from './src/core/database';
    export { PlanCenterService } from './src/core/plan-center';
    export { setPlatformDefaultAccount } from './src/core/platform-config';
    export { PlanCenterPlanSchema, PlanCenterRunRecordSchema, connectedPlanWorkflowGraph } from './src/shared/plan-center';
  `, resolveDir: project },
  bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
});
const require = createRequire(import.meta.url);
const filesystem = (() => {
  const entries = new Map();
  const handles = new Map();
  const copies = [];
  let fd = 0, inode = 1n;
  const fail = code => { throw Object.assign(Error(code), { code }); };
  const get = file => entries.get(file) ?? fail("ENOENT");
  const directory = file => entries.set(file, { inode: inode++ });
  const write = (file, bytes) => {
    if (entries.has(file)) fail("EEXIST");
    if (get(path.dirname(file)).bytes) fail("ENOTDIR");
    entries.set(file, { bytes: Buffer.from(bytes), inode: inode++ });
  };
  const fs = {
    constants: { COPYFILE_EXCL: 1, W_OK: 2 },
    existsSync: file => entries.has(file),
    realpathSync: { native: file => { get(file); return file; } },
    lstatSync(file, options) {
      if (options?.throwIfNoEntry === false && !entries.has(file)) return;
      const entry = get(file);
      return { dev: 1n, ino: entry.inode, isSymbolicLink: () => !!entry.link, isDirectory: () => !entry.bytes, isFile: () => !!entry.bytes };
    },
    mkdirSync(file, options) {
      if (options?.recursive) { if (!entries.has(file)) directory(file); return; }
      if (entries.has(file)) fail("EEXIST");
      get(path.dirname(file));
      directory(file);
    },
    readdirSync(file) {
      get(file);
      return [...entries].filter(([entry]) => path.dirname(entry) === file)
        .map(([entry, value]) => ({ name: path.basename(entry), isDirectory: () => !value.bytes }));
    },
    rmdirSync(file) { get(file); entries.delete(file); },
    accessSync(file, mode) { assert.equal(mode, 2); get(file); },
    copyFileSync(src, dest, flag) {
      assert.equal(flag, 1);
      write(dest, get(src).bytes);
      copies.push(dest);
    },
    writeFileSync(file, bytes, options) {
      assert.equal(options.flag, "wx");
      write(file, bytes);
    },
    openSync(file) { handles.set(++fd, { bytes: get(file).bytes, position: 0 }); return fd; },
    readSync(handle, buffer, start, length) {
      const entry = handles.get(handle);
      const count = entry.bytes.copy(buffer, start, entry.position, entry.position + length);
      entry.position += count;
      return count;
    },
    closeSync(handle) { handles.delete(handle); },
  };
  return { fs, entries, directory, write, copies };
})();
const module = { exports: {} };
compileFunction(outputFiles[0].text, ["module", "exports", "require", "__dirname"])(module, module.exports,
  specifier => specifier === "node:fs" ? filesystem.fs : require(specifier), project);

function graphArchiveFixture(t, secondSinger) {
  const { Repository, PlanCenterPlanSchema, connectedPlanWorkflowGraph, setDownloadDirectory } = module.exports;
  const repo = new Repository(":memory:");
  t.after(() => repo.close());
  const accountId = randomUUID(), artistId = randomUUID(), templateId = randomUUID();
  repo.save("accounts", { id: accountId, name: "账号当前名" });
  repo.save("artists", { id: artistId, name: "艺人资料名", promptTemplateId: templateId });
  repo.save("promptTemplates", { id: templateId, name: "模板当前名" });
  const plan = PlanCenterPlanSchema.parse({
    id: randomUUID(), title: "等灯", artistId, schedule: { kind: "daily", localTime: "09:00" },
    material: { source: "workflow" }, outputs: { lyrics: true, cover: true, music: true },
    workflow: { accountId, graph: connectedPlanWorkflowGraph, mode: "musician", inspiration: "", maxRewrites: 0 },
    workflowSnapshot: { accountName: "创作/账号", artist: { singer: "歌手/A", lyricist: "词作者", composer: "曲作者", contractMode: "exclusive" },
      ...(secondSinger ? { secondSinger: { name: secondSinger } } : {}), template: { id: templateId, name: "国风:", revision: 1 } },
    routing: { text: { source: "default" }, image: { source: "default" }, music: { source: "default" } },
    text: {}, music: { route: "pule" },
  });
  const root = path.join(project, "fixture-graph-archive-" + plan.id);
  const source = path.join(project, "fixture-graph-vault-" + plan.id);
  filesystem.directory(root);
  filesystem.directory(source);
  const configure = (destination = root, expectedRevision = 0) => setDownloadDirectory(repo, { expectedRevision, root: destination });
  const studio = { repo, mode: "production", get: (table, id) => repo.get(table, id), locate: id => ({ file: repo.get("assets", id).file }) };
  const asset = (ext, bytes) => {
    const id = randomUUID();
    const file = path.join(source, id + "." + ext);
    filesystem.write(file, bytes);
    return repo.save("assets", { id, ext, file, sha256: createHash("sha256").update(bytes).digest("hex") });
  };
  return { accountId, plan, repo, root, studio, configure, asset };
}

function contentsIn(directory, extension) {
  return [...filesystem.entries].filter(([file, entry]) =>
    entry.bytes && path.dirname(file) === directory && path.extname(file) === extension,
  ).map(([, entry]) => entry.bytes.toString());
}

test("download folder names use the saved account, local musician and prompt names", () => {
  const { downloadFolderName } = module.exports;
  assert.equal(downloadFolderName("素素", "陈白狐", "国风苦情"), "素素_陈白狐_国风苦情");
  assert.equal(downloadFolderName("A/B", "小雨:晴", "..\\模板. "), "A-B_小雨-晴_..-模板");
  assert.equal(downloadFolderName("素素", "陈白狐", undefined), "素素_陈白狐_未关联提示词");
});

test("old cover records resolve the artist only when both archive folders identify a unique profile", t => {
  const { findRecordingArchiveArtist, downloadFolderName } = module.exports;
  const { repo } = graphArchiveFixture(t);
  const accountId = randomUUID(), templateId = randomUUID();
  repo.save("accounts", { id: accountId, name: "发布账号" });
  repo.save("promptTemplates", { id: templateId, name: "民谣" });
  const profile = { id: randomUUID(), accountId, name: "测试艺人", profile: { singer: "歌手 A" },
    secondSinger: { name: "歌手 B" }, promptTemplateId: templateId, defaults: { coverResolution: 1440 } };
  repo.save("accountLocalArtists", profile);
  repo.save("accountLocalArtists", { ...profile, id: randomUUID(), secondSinger: { name: "另一位歌手" } });
  const folders = { A: downloadFolderName("发布账号", "歌手 A", "民谣"), B: downloadFolderName("发布账号", "歌手 B", "民谣") };
  assert.equal(findRecordingArchiveArtist(repo, folders)?.defaults.coverResolution, 1440);
  assert.equal(findRecordingArchiveArtist(repo, { ...folders, B: "其他目录" }), undefined);
  repo.save("accountLocalArtists", { ...profile, id: randomUUID() });
  assert.equal(findRecordingArchiveArtist(repo, folders), undefined);
});

test("谱乐 archive folders use the publishing account's own artist and engine", t => {
  const { resolvePuleDownloadArchive, setDownloadAccount, setPlatformDefaultAccount } = module.exports;
  const { repo, root, configure } = graphArchiveFixture(t);
  const fanqie = randomUUID(), tme = randomUUID(), yourmusic = randomUUID();
  const generationEngine = randomUUID(), archiveEngine = randomUUID();
  repo.save("accounts", { id: fanqie, name: "素素", provider: "fanqie" });
  repo.save("accounts", { id: tme, name: "腾讯发布账号", provider: "tme" });
  const pule = repo.save("accounts", { id: yourmusic, name: "素素谱乐", provider: "yourmusic" });
  repo.save("promptTemplates", { id: generationEngine, name: "创作引擎" });
  repo.save("promptTemplates", { id: archiveEngine, name: "6080国语苦情女歌手" });
  const artist = repo.save("accountLocalArtists", { id: randomUUID(), accountId: yourmusic,
    name: "陈白狐", profile: { singer: "陈白狐" }, promptTemplateId: generationEngine });
  repo.save("accountLocalArtists", { id: randomUUID(), accountId: fanqie,
    name: "陈白狐", profile: { singer: "陈白狐" }, secondSinger: { name: "陈天狐" }, promptTemplateId: archiveEngine });
  repo.save("accountLocalArtists", { id: randomUUID(), accountId: fanqie,
    name: "其他艺人", profile: { singer: "其他艺人" }, secondSinger: { name: "其他歌手" }, promptTemplateId: archiveEngine });
  setPlatformDefaultAccount(repo, "fanqie", fanqie, 0);
  setPlatformDefaultAccount(repo, "qqmusic", tme, 0);
  configure();
  assert.deepEqual(resolvePuleDownloadArchive(repo, pule, artist), {
    archiveRoot: root,
    archiveFolderNames: { A: "素素_陈白狐_6080国语苦情女歌手", B: "素素_陈天狐_6080国语苦情女歌手" },
  });
  setDownloadAccount(repo, { expectedRevision: 1, accountId: tme });
  assert.deepEqual(resolvePuleDownloadArchive(repo, pule, artist), {
    archiveRoot: root, archiveFolderNames: { A: "腾讯发布账号_陈白狐_创作引擎", B: "腾讯发布账号_陈白狐_创作引擎" },
  });
});

test("a deleted legacy archive account falls back to the sole default publication account", t => {
  const { preparePlanDownloads, setPlatformDefaultAccount } = module.exports;
  const { accountId, repo, plan, configure } = graphArchiveFixture(t);
  repo.save("accounts", { id: accountId, name: "默认账号", provider: "fanqie" });
  setPlatformDefaultAccount(repo, "fanqie", accountId, 0);
  configure();
  const saved = repo.get("settings", "download-archive:configuration");
  repo.save("settings", { ...saved, value: { ...saved.value, accountId: randomUUID() } });
  const folders = preparePlanDownloads(repo, { ...plan, workflow: undefined });
  assert.deepEqual(folders.map(folder => folder.accountId), [accountId]);
});

test("a plan creates and reuses its directory and a publication and late certificate keep the archived material together", t => {
  const { Repository, PlanCenterService, setDownloadAccount, setDownloadDirectory, preparePlanDownloads, archiveWorkDownloads, archivePublicationDownloads, archiveImportedCertificate } = module.exports;
  const repo = new Repository(":memory:");
  t.after(() => repo.close());
  const accountId = randomUUID(), artistId = randomUUID(), templateId = randomUUID(), workId = randomUUID();
  repo.save("accounts", { id: accountId, name: "素素" });
  const musician = { id: artistId, name: "陈白狐", promptTemplateId: templateId };
  repo.save("accountLocalArtists", musician);
  repo.save("artists", musician);
  repo.save("promptTemplates", { id: templateId, name: "国风苦情" });
  const originalRoot = path.resolve("fixture-download-root"), nextRoot = path.resolve("another-download-root"), sourceRoot = path.resolve("fixture-vault");
  for (const directory of [originalRoot, nextRoot, sourceRoot]) filesystem.directory(directory);
  assert.equal(setDownloadDirectory(repo, { expectedRevision: 0, root: originalRoot }).root, originalRoot);
  const center = new PlanCenterService(repo, { prepareDownloads: plan => preparePlanDownloads(repo, plan) });
  const plan = center.save({ expectedRevision: null, plan: {
    id: randomUUID(), title: "等灯", artistId, schedule: { kind: "daily", localTime: "09:00" },
    material: { source: "manual" }, text: {}, music: { route: "manual" },
  } });
  const preview = center.preview({ id: plan.id });
  const runInput = { id: plan.id, expectedRevision: preview.planRevision, summaryHash: preview.summaryHash, requestId: randomUUID(), source: "manual" };
  assert.throws(() => center.run(runInput), /DOWNLOAD_ACCOUNT_REQUIRED/);
  assert.deepEqual(center.list().runs, []);
  setDownloadAccount(repo, { expectedRevision: 1, accountId });
  const run = center.run(runInput);
  const folder = path.join(originalRoot, "素素_陈白狐_国风苦情");
  assert.equal(filesystem.fs.existsSync(folder), true);
  assert.deepEqual(preparePlanDownloads(repo, plan), run.downloadFolders);
  const workflowAccountId = randomUUID();
  repo.save("accounts", { id: workflowAccountId, name: "计划所选账号" });
  assert.deepEqual(preparePlanDownloads(repo, { ...plan, workflow: { accountId: workflowAccountId } })
    .map(({ accountId, name }) => ({ accountId, name })),
  [{ accountId: workflowAccountId, name: "计划所选账号_陈白狐_国风苦情" }]);

  const studio = { repo, mode: "production", get: (table, id) => repo.get(table, id),
    locate: id => ({ file: repo.get("assets", id).file }) };
  const asset = (id, ext, bytes) => {
    const file = path.join(sourceRoot, id + "." + ext);
    filesystem.write(file, bytes);
    return repo.save("assets", { id, ext, file, sha256: createHash("sha256").update(bytes).digest("hex") });
  };
  const audio = asset(randomUUID(), "mp3", "a recording");
  const alternate = asset(randomUUID(), "mp3", "another recording");
  const cover = asset(randomUUID(), "png", "a cover");
  const work = repo.save("works", { id: workId, artistId, title: "等灯", lyrics: "歌词一\n歌词二", assets: { audio_A: audio.id, audio_B: alternate.id, cover: cover.id } });
  const archived = archiveWorkDownloads(studio, workId, run.downloadFolders);
  assert.equal(archived.length, 6);
  assert.ok(archived.every(file => file.startsWith(folder + path.sep)));
  assert.deepEqual(archiveWorkDownloads(studio, workId, run.downloadFolders), archived);

  const certificate = asset(randomUUID(), "pdf", "%PDF- fixture");
  repo.save("works", { ...work, assets: { ...work.assets, certificate: certificate.id } });
  const withCertificate = archiveImportedCertificate(studio, workId);
  const pdf = path.join(folder, "原创证书", "等灯.pdf");
  assert.ok(withCertificate.includes(pdf));
  assert.equal(filesystem.entries.get(pdf).bytes.toString(), "%PDF- fixture");
  archivePublicationDownloads(studio, [{ workId, accountId }]);
  assert.equal(filesystem.copies.filter(file => file.startsWith(folder + path.sep)).length, 6);

  setDownloadDirectory(repo, { expectedRevision: 2, root: nextRoot });
  filesystem.entries.delete(originalRoot);
  archivePublicationDownloads(studio, [{ workId, accountId }]);
  const newFolder = path.join(nextRoot, "素素_陈白狐_国风苦情");
  assert.equal(filesystem.fs.existsSync(path.join(newFolder, "原创证书", "等灯.pdf")), true);
  const resumed = archiveWorkDownloads(studio, workId, run.downloadFolders);
  assert.equal(resumed.length, 8);
  assert.ok(resumed.every(file => file.startsWith(newFolder + path.sep)));
  assert.equal(filesystem.entries.get(audio.file).bytes.toString(), "a recording");
});

test("graph plans and managed creations require a configured download location", t => {
  const { preparePlanDownloads } = module.exports;
  const { plan, repo } = graphArchiveFixture(t);
  assert.throws(() => preparePlanDownloads(repo, plan), /DOWNLOAD_ROOT_REQUIRED/);
  assert.throws(() => preparePlanDownloads(repo, { ...plan, workflow: undefined, material: { source: "creation" } }),
    /DOWNLOAD_ROOT_REQUIRED/);
  const { graph: _graph, ...legacyWorkflow } = plan.workflow;
  assert.deepEqual(preparePlanDownloads(repo, { ...plan, workflow: { ...legacyWorkflow, platform: "fanqie" } }), []);
});

test("a single-singer graph archives its selected recording and materials in the frozen singer's directory", t => {
  const { preparePlanDownloads, archiveWorkDownloads } = module.exports;
  const { plan, repo, root, studio, configure, asset } = graphArchiveFixture(t);
  configure();
  const work = repo.save("works", { id: randomUUID(), artistId: plan.artistId, title: plan.title, lyrics: "歌词\n下一行",
    assets: { audio_B: asset("mp3", "selected B recording").id, cover: asset("png", "shared cover").id } });
  const folders = preparePlanDownloads(repo, plan);
  assert.deepEqual(folders.map(({ name }) => name), ["创作-账号_歌手-A_国风-"]);
  const directory = path.join(root, "创作-账号_歌手-A_国风-");
  assert.deepEqual(archiveWorkDownloads(studio, work.id, folders).map(file => path.basename(file)).sort(),
    ["等灯.mp3", "等灯.png", "等灯.txt"]);
  assert.deepEqual(contentsIn(directory, ".mp3"), ["selected B recording"]);
  assert.deepEqual(contentsIn(directory, ".png"), ["shared cover"]);
  assert.deepEqual(contentsIn(directory, ".txt"), ["\uFEFF歌词\r\n下一行"]);
});

test("same-title recordings keep title-only files and their own companions in separate folders", t => {
  const { preparePlanDownloads, archiveWorkDownloads } = module.exports;
  const { plan, repo, root, studio, configure, asset } = graphArchiveFixture(t);
  configure();
  const work = repo.save("works", { id: randomUUID(), artistId: plan.artistId, title: "信纸_写了一半", lyrics: "歌词",
    assets: { audio_A: asset("wav", "recording A").id, audio_B: asset("wav", "recording B").id,
      cover: asset("png", "cover A").id, cover_B: asset("png", "cover B").id } });
  const folders = preparePlanDownloads(repo, plan);
  const directory = path.join(root, folders[0].name);
  const second = path.join(directory, "信纸_写了一半 (2)");
  const firstExport = archiveWorkDownloads(studio, work.id, folders);
  assert.deepEqual(firstExport.map(file => path.relative(directory, file)).sort(), [
    ...["wav", "png", "txt"].map(ext => "信纸_写了一半." + ext),
    ...["wav", "png", "txt"].map(ext => path.join(path.basename(second), "信纸_写了一半." + ext)),
  ].sort());
  assert.deepEqual(contentsIn(directory, ".png"), ["cover A"]);
  assert.deepEqual(contentsIn(second, ".wav"), ["recording B"]);
  assert.deepEqual(contentsIn(second, ".png"), ["cover B"]);
  assert.deepEqual(archiveWorkDownloads(studio, work.id, folders, true), firstExport);
});

test("an existing archive keeps its recorded paths when verified or given a late companion", t => {
  const { preparePlanDownloads, archiveWorkDownloads } = module.exports;
  const { plan, repo, root, studio, configure, asset } = graphArchiveFixture(t);
  configure();
  const audio = asset("wav", "previous recording");
  const work = repo.save("works", { id: randomUUID(), artistId: plan.artistId, title: plan.title, assets: { audio_A: audio.id } });
  const folders = preparePlanDownloads(repo, plan);
  const directory = path.join(root, folders[0].name);
  const oldPath = path.join(directory, `${work.title}_A_${audio.sha256.slice(0, 12)}.wav`);
  filesystem.write(oldPath, "previous recording");
  repo.save("settings", { id: "download-archive:work:" + work.id, value: { folders, fingerprint: "old", files: [oldPath] } });
  assert.deepEqual(archiveWorkDownloads(studio, work.id, folders, true), [oldPath]);

  const cover = asset("png", "late cover");
  repo.save("works", { ...work, assets: { ...work.assets, cover: cover.id } });
  const lateCover = path.join(directory, `${work.title}_封面_${cover.sha256.slice(0, 12)}.png`);
  assert.deepEqual(archiveWorkDownloads(studio, work.id, folders, true), [oldPath, lateCover]);
  assert.equal(filesystem.entries.get(oldPath).bytes.toString(), "previous recording");
});

test("restoring a missing legacy B download uses the B song's title for the recording and its companions", t => {
  const { preparePlanDownloads, archiveWorkDownloads } = module.exports;
  const { plan, repo, root, studio, configure, asset } = graphArchiveFixture(t, "第二歌手");
  configure();
  const audioA = asset("wav", "first recording"), audioB = asset("wav", "second recording");
  const work = repo.save("works", { id: randomUUID(), artistId: plan.artistId, title: "信纸写了一半",
    alternateTitle: "雨滴数到天明", lyrics: "测试歌词", assets: {
      audio_A: audioA.id, audio_B: audioB.id, cover: asset("jpg", "cover").id,
    } });
  const folders = preparePlanDownloads(repo, plan);
  const [a, b] = folders.map(folder => path.join(root, folder.name));
  const oldA = path.join(a, `${work.title}_A_${audioA.sha256.slice(0, 12)}.wav`);
  const oldB = path.join(b, `${work.title}_B_${audioB.sha256.slice(0, 12)}.wav`);
  filesystem.write(oldA, "first recording");
  repo.save("settings", { id: "download-archive:work:" + work.id, value: { folders, fingerprint: "old", files: [oldA, oldB] } });

  const files = archiveWorkDownloads(studio, work.id, folders, true);
  assert.ok(files.includes(oldA));
  assert.equal(filesystem.fs.existsSync(oldB), false);
  assert.deepEqual(files.filter(file => path.dirname(file) === b).map(file => path.basename(file)).sort(),
    ["雨滴数到天明.jpg", "雨滴数到天明.txt", "雨滴数到天明.wav"]);
  assert.deepEqual(contentsIn(b, ".wav"), ["second recording"]);
  assert.deepEqual(archiveWorkDownloads(studio, work.id, folders, true), files);
});

test("same-title certificate archives are kept separately even before recordings arrive", t => {
  const { preparePlanDownloads, archiveWorkDownloads } = module.exports;
  const { plan, repo, root, studio, configure, asset } = graphArchiveFixture(t);
  configure();
  const folders = preparePlanDownloads(repo, plan);
  const account = path.join(root, folders[0].name);
  const archive = bytes => {
    const work = repo.save("works", { id: randomUUID(), artistId: plan.artistId, title: plan.title,
      assets: { certificate: asset("pdf", bytes).id } });
    return archiveWorkDownloads(studio, work.id, folders)[0];
  };
  const first = archive("first certificate");
  const second = archive("second certificate");
  assert.equal(first, path.join(account, "原创证书", "等灯.pdf"));
  assert.equal(second, path.join(account, "等灯 (2)", "原创证书", "等灯.pdf"));
  assert.equal(filesystem.entries.get(first).bytes.toString(), "first certificate");
  assert.equal(filesystem.entries.get(second).bytes.toString(), "second certificate");
});

test("two singer directories keep the A and B recordings separate and reuse the same folders", t => {
  const { preparePlanDownloads, archiveWorkDownloads, PlanCenterRunRecordSchema } = module.exports;
  const { plan, repo, root, studio, configure, asset } = graphArchiveFixture(t, "第二/歌手");
  configure();
  const work = repo.save("works", { id: randomUUID(), artistId: plan.artistId, title: plan.title, lyrics: "共享歌词",
    assets: { audio_A: asset("mp3", "recording A").id, audio_B: asset("mp3", "recording B").id, cover: asset("png", "shared cover").id } });
  const previous = preparePlanDownloads(repo, plan);
  const now = "2026-11-20T01:00:00.000Z";
  const run = PlanCenterRunRecordSchema.parse({ id: randomUUID(), planId: plan.id, planRevision: plan.revision, snapshot: plan,
    summaryHash: "fixture", requestId: randomUUID(), source: "manual", state: "waiting", stopRequested: false, createdAt: now, updatedAt: now, downloadFolders: previous });
  assert.deepEqual(run.downloadFolders.map(({ name, audioVersion }) => ({ name, audioVersion })), [
    { name: "创作-账号_歌手-A_国风-", audioVersion: "A" },
    { name: "创作-账号_第二-歌手_国风-", audioVersion: "B" },
  ]);
  const firstArchive = archiveWorkDownloads(studio, work.id, run.downloadFolders);
  assert.equal(firstArchive.length, 6);
  const [firstDirectory, secondDirectory] = run.downloadFolders.map(folder => path.join(root, folder.name));
  assert.deepEqual(contentsIn(firstDirectory, ".mp3"), ["recording A"]);
  assert.deepEqual(contentsIn(secondDirectory, ".mp3"), ["recording B"]);
  assert.deepEqual(contentsIn(firstDirectory, ".png"), ["shared cover"]);
  assert.deepEqual(contentsIn(secondDirectory, ".txt"), ["\uFEFF共享歌词"]);
  assert.deepEqual(preparePlanDownloads(repo, plan), run.downloadFolders);
  assert.deepEqual(archiveWorkDownloads(studio, work.id, run.downloadFolders), firstArchive);
});

test("graph singer folders add a stable suffix when sanitized names collide", t => {
  const { preparePlanDownloads } = module.exports;
  const { plan, repo, configure } = graphArchiveFixture(t, process.platform === "win32" ? "歌手:a" : "歌手:A");
  configure();
  const folders = preparePlanDownloads(repo, plan);
  assert.deepEqual(folders.map(folder => folder.name), [
    "创作-账号_歌手-A_国风-", process.platform === "win32" ? "创作-账号_歌手-a_国风-_B" : "创作-账号_歌手-A_国风-_B",
  ]);
  assert.deepEqual(preparePlanDownloads(repo, plan), folders);
});

test("publication and a late certificate keep both singer archives together after the download location changes", t => {
  const { preparePlanDownloads, archiveWorkDownloads, archivePublicationDownloads, archiveImportedCertificate } = module.exports;
  const { accountId, plan, repo, root, studio, configure, asset } = graphArchiveFixture(t, "第二歌手");
  configure();
  const work = repo.save("works", { id: randomUUID(), artistId: plan.artistId, title: plan.title, assets: {
    audio_A: asset("mp3", "recording A").id, audio_B: asset("mp3", "recording B").id,
  } });
  const folders = preparePlanDownloads(repo, plan);
  const names = ["创作-账号_歌手-A_国风-", "创作-账号_第二歌手_国风-"];
  archiveWorkDownloads(studio, work.id, folders);
  const rights = asset("pdf", "publication rights evidence");
  repo.save("works", { ...work, assets: { ...work.assets, rights: rights.id } });
  const publish = () => archivePublicationDownloads(studio, [{ workId: work.id, accountId }]);
  publish();
  for (const name of names) assert.deepEqual(contentsIn(path.join(root, name, "授权附件"), ".pdf"), ["publication rights evidence"]);

  const currentRoot = root + "-new";
  filesystem.directory(currentRoot);
  configure(currentRoot, 1);
  filesystem.entries.delete(root);
  const current = names.map(name => path.join(currentRoot, name));
  const certificate = asset("pdf", "imported certificate");
  repo.save("works", { ...work, assets: { ...work.assets, rights: rights.id, certificate: certificate.id } });
  archiveImportedCertificate(studio, work.id);
  publish();
  assert.deepEqual(contentsIn(current[0], ".mp3"), ["recording A"]);
  assert.deepEqual(contentsIn(current[1], ".mp3"), ["recording B"]);
  assert.deepEqual(repo.get("settings", "download-archive:work:" + work.id).value.folders.map(folder => folder.root), [root, root, currentRoot, currentRoot]);
  for (const directory of current) {
    assert.deepEqual(contentsIn(path.join(directory, "原创证书"), ".pdf"), ["imported certificate"]);
    assert.deepEqual(contentsIn(path.join(directory, "授权附件"), ".pdf"), ["publication rights evidence"]);
  }
});

test("one unavailable archive directory does not stop other scheduled plans", t => {
  const { Repository, PlanCenterService } = module.exports;
  const repo = new Repository(":memory:");
  t.after(() => repo.close());
  let now = new Date("2026-11-19T08:00:00Z");
  const center = new PlanCenterService(repo, { now: () => now, prepareDownloads(plan) {
    if (plan.title === "目录不可用") throw Error("DOWNLOAD_ROOT_UNAVAILABLE");
    return [];
  } });
  for (const title of ["目录不可用", "其他计划"]) {
    center.save({ expectedRevision: null, plan: { id: randomUUID(), artistId: randomUUID(), title, enabled: true,
      schedule: {kind:"once", date:"2026-11-19", localTime:"17:00"}, material: {source:"manual"}, text:{}, music:{route:"manual"} } });
  }
  now = new Date("2026-11-19T09:00:01Z");
  center.tick();
  const { runs, items } = center.list();
  assert.equal(runs.length, 2);
  const blocked = runs.find(run => run.snapshot.title === "目录不可用");
  assert.equal(blocked.state, "blocked");
  assert.equal(items.find(item => item.runId === blocked.id).reason, "DOWNLOAD_ROOT_UNAVAILABLE");
  assert.equal(runs.find(run => run.snapshot.title === "其他计划").state, "waiting");
});
