import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import { compileFunction } from "node:vm";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

const project = path.resolve(import.meta.dirname, "..");
const { outputFiles } = await build({
  stdin: { resolveDir: project, contents: `
    export { Repository } from './src/core/database';
    export { PlanCenterService } from './src/core/plan-center';
    export { executePlanCenter, tickPlanCenter } from './src/core/plan-center-integration';
    export { LyricWritingService } from './src/core/lyric-writing';
    export { ProviderTextAdapter } from './src/core/workflow/provider-text';
    export { saveGenerationConfig } from './src/core/generation-config';
    export { planPuleAction } from './src/core/plan-pule';
    export { createPlanPuleRunner } from './src/main/plan-pule';
    export { preparePlanDownloads, setDownloadDirectory } from './src/core/download-archive';
    export { CenterStore } from './src/core/plan-center/storage';
    export { planFanqieAction, planFanqieJobs } from './src/core/plan-fanqie';
    export { createPlanFanqiePublisher } from './src/main/fanqie/plan-publisher';
    export { readWorkflowPublication, recordWorkflowQishuiSubmission, syncWorkflowPublications, workflowQishuiScope } from './src/core/plan-workflow-publication';
    export { resolveFanqieWork } from './src/core/fanqie-work';
    export { tickPlanLyrics } from './src/core/plan-workflow';
    export { callPublicationTasks, tickPublicationTasks } from './src/core/publication-task-integration';
  ` },
  bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
});
const compiled = { exports: {} };
compileFunction(outputFiles[0].text, ["module", "exports", "require", "__dirname"])(
  compiled, compiled.exports, createRequire(import.meta.url), project,
);
const { Repository, PlanCenterService, LyricWritingService, ProviderTextAdapter, saveGenerationConfig, executePlanCenter,
  tickPlanCenter, planPuleAction, createPlanPuleRunner, preparePlanDownloads, setDownloadDirectory,
  CenterStore, planFanqieAction, planFanqieJobs, createPlanFanqiePublisher, readWorkflowPublication, recordWorkflowQishuiSubmission,
  syncWorkflowPublications, workflowQishuiScope, resolveFanqieWork, tickPlanLyrics, callPublicationTasks, tickPublicationTasks } = compiled.exports;

function fixture(t, { secondSinger, instrumental = false, configure = true, archive = true, root } = {}) {
  const repo = new Repository(":memory:");
  t.after(() => repo.close());
  let clock = Date.parse("2026-11-20T07:00:00Z");
  const now = () => new Date(clock);
  const advance = () => { clock += 20_000; };
  const accountId = randomUUID(), artistId = randomUUID();
  const artist = { id: artistId, name: "艺人信息", accountId, accountLocalArtist: true, revision: 1,
    defaults: { voice: instrumental ? "instrumental" : "female", genre: "民谣", duration: 165 },
    profile: { lyricist: "词作者", composer: "曲作者", singer: "歌手甲", gender: "female", contractMode: "exclusive" }, secondSinger };
  repo.save("accounts", { id: accountId, name: "创作账号", provider: "yourmusic" });
  repo.save("artists", artist);
  repo.save("accountLocalArtists", artist);
  const textId = randomUUID(), modelId = "fixture-text", musicId = randomUUID();
  if (configure) {
    repo.save("settings", { id: "api-profile:" + textId, label: "Fixture text", kind: "text", providerId: "deepseek", modelId,
      executionEnabled: false, revision: 1, textPricing: { currency: "USD", modelId,
        inputMicrosPerMillionTokens: 100, outputMicrosPerMillionTokens: 100, source: "fixture", version: "fixture", responseModelIds: [modelId] } });
    repo.save("settings", { id: "api-profile:" + musicId, label: "Fixture music", kind: "music", providerId: "yourmusic",
      modelId: "chirp-v6", executionEnabled: false, revision: 1 });
    saveGenerationConfig(repo, { role: "text", profileId: textId, expectedRevision: 0 });
    saveGenerationConfig(repo, { role: "music", profileId: musicId, expectedRevision: 1 });
  }
  const center = new PlanCenterService(repo, { now, capabilities: { text: { available: true }, music: { available: true }, cover: { available: true } },
    prepareDownloads: plan => root ? preparePlanDownloads(repo, plan) :
      archive ? [{ accountId, root: path.resolve("fixture-download"), rootIdentity: "fixture", name: "fixture" }] : [] });
  const lyrics = new LyricWritingService(repo, now);
  const studio = { repo, root, mode: "production", now, planCenterService: () => center, lyricWritingService: () => lyrics,
    get: (table, id) => repo.get(table, id), all: table => repo.all(table), save: (table, row) => repo.save(table, row),
    locate: id => ({ file: repo.get("assets", id).file }),
    saveWork: fields => repo.save("works", { ...fields, id: randomUUID() }),
    async importFile(file, _role, _workId, verify) {
      verify();
      const id = randomUUID(), extension = path.extname(file), saved = path.join(root, id + extension);
      fs.copyFileSync(file, saved);
      return repo.save("assets", { id, file: saved, ext: extension.slice(1), sha256: createHash("sha256").update(fs.readFileSync(file)).digest("hex") });
    } };
  const rpc = (method, input) => executePlanCenter(studio, "planCenter." + method, input);
  const draft = { id: randomUUID(), title: "灯下计划", artistId, count: 2, enabled: false,
    schedule: { kind: "daily", localTime: "09:00" }, material: { source: "workflow" }, outputs: { lyrics: true, music: true, cover: false },
    workflow: { accountId, graph: { nodes: ["lyrics", "creation"], edges: [{ from: "lyrics", to: "creation" }] },
      mode: "musician", inspiration: "", maxRewrites: 1 },
    routing: { text: { source: "default" }, image: { source: "default" }, music: { source: "default" } },
    text: {}, music: { route: "pule" }, authorization: { text: false, music: false, publish: false } };
  const startInput = plan => { const preview = rpc("preview", { id: plan.id });
    return { id: plan.id, expectedRevision: plan.revision, summaryHash: preview.summaryHash, requestId: randomUUID(), source: "manual" }; };
  return { center, repo, artist, draft, rpc, studio, now, advance, lyrics, modelId, startInput };
}

test("new graph plans support read, optimistic edits and confirmed removal even before provider setup", t => {
  const { center, rpc, draft, startInput } = fixture(t, { configure: false });
  const incomplete = { ...draft, workflow: { ...draft.workflow, graph: { ...draft.workflow.graph, edges: [] } } };
  assert.throws(() => rpc("save", { plan: incomplete, expectedRevision: null }));
  const plan = rpc("save", { plan: draft, expectedRevision: null });
  assert.equal(rpc("read", { id: plan.id }).count, 2);
  assert.deepEqual(rpc("read", { id: plan.id }).workflow.graph, draft.workflow.graph);
  assert.equal(center.list().runs.length, 0);
  assert.throws(() => rpc("run", { ...startInput(plan), confirmGeneration: true }), /TEXT_ROUTE_REQUIRED/);
  const changed = rpc("save", { plan: { ...plan, title: "修改后的计划" }, expectedRevision: plan.revision });
  assert.equal(changed.title, "修改后的计划");
  assert.equal(changed.createdAt, plan.createdAt);
  assert.throws(() => rpc("delete", { id: plan.id, expectedRevision: plan.revision }), /REVISION_CONFLICT/);
  assert.deepEqual(rpc("delete", { id: plan.id, expectedRevision: changed.revision }), { id: plan.id });
  assert.throws(() => rpc("read", { id: plan.id }), /NOT_FOUND/);
  assert.deepEqual(center.list().plans, []);
});

test("the plan dashboard returns summaries and loads execution evidence only for the requested run", t => {
  const { center, repo, rpc, draft, startInput, studio, now } = fixture(t);
  const plan = rpc("save", { plan: draft, expectedRevision: null });
  const run = rpc("run", { ...startInput(plan), confirmGeneration: true });
  const [item] = center.list().items;
  const stage = center.claim({ runId: run.id, itemId: item.id, stage: "lyric_write" });
  const store = new CenterStore(repo);
  store.put("run", { ...run, state: "completed" });
  store.put("item", { ...item, state: "completed", material: { lyrics: "仅在执行详情读取的歌词" } });
  const owned = store.put("run", { ...run, id: randomUUID(), source: "publication_task" });
  const ownedItem = store.put("item", { ...item, id: randomUUID(), runId: owned.id, material: { lyrics: "任务中心的歌词" } });
  repo.save("works", { id: randomUUID(), title: "无关作品", assets: { audio_A: randomUUID() } });
  const originalAll = studio.all;
  studio.all = table => {
    assert.notEqual(table, "works", "the workflow does not need to scan the music library");
    return originalAll(table);
  };

  const [row] = rpc("dashboard", {});
  assert.equal(row.plan.id, plan.id);
  assert.equal(row.latest.id, run.id);
  assert.equal(row.latest.state, "completed");
  assert.equal(row.latest.snapshot, undefined);
  assert.equal(row.active, undefined);
  assert.equal(row.deleteBlocked, true);
  const history = rpc("history", { id: plan.id });
  assert.deepEqual(history.runs.map(({ id, completed, count }) => [id, completed, count]), [[run.id, 1, plan.count]]);
  assert.equal(history.runs[0].snapshot, undefined);
  const execution = rpc("runDetail", { runId: run.id });
  assert.equal(execution.run.id, run.id);
  assert.ok(execution.items.every(row => row.runId === run.id));
  assert.ok(execution.items.some(row => row.material?.lyrics === "仅在执行详情读取的歌词"));
  assert.ok(execution.stageAttempts.some(row => row.id === stage.id));
  assert.deepEqual(rpc("runDetail", { runId: owned.id }).items.map(row => row.id), [ownedItem.id]);
  assert.equal(rpc("list", {}).runs.length, 2);
});

test("Suno CN workflow requires its explicit account, field mappings and cover model", t => {
  const x = fixture(t);
  const accountId = randomUUID(), profileId = randomUUID();
  const modelId = "doubao-seedream-5-0-pro-260628";
  x.repo.save("accounts", { id: accountId, name: "苏诺账号", provider: "suno_cn" });
  x.repo.save("settings", { id: "api-profile:" + profileId, kind: "image", providerId: "doubao_image",
    modelId: "doubao-seedream-5-5-261028", label: "方舟封面", executionEnabled: false, revision: 1 });
  const node = "music:suno_cn";
  const browserMusic = { provider: "suno_cn", accountId, inputs: { title: "title", style: "style", lyrics: "lyrics" } };
  const draft = { ...x.draft, outputs: { ...x.draft.outputs, cover: true }, workflow: { ...x.draft.workflow,
    graph: { nodes: ["lyrics", node], edges: [{ from: "lyrics", to: node }] }, browserMusic } };
  const incomplete = x.rpc("save", { plan: draft, expectedRevision: null });
  assert.throws(() => x.rpc("run", { ...x.startInput(incomplete), confirmGeneration: true }), /WORKFLOW_IMAGE_SELECTION_REQUIRED/);
  const plan = x.rpc("save", { plan: { ...draft, workflow: { ...draft.workflow, browserMusic: { ...browserMusic,
    coverImage: { profileId, providerId: "doubao_image", modelId } } } }, expectedRevision: incomplete.revision });
  assert.equal(plan.routeSnapshot.music.providerId, "suno_cn");
  assert.equal(plan.routeSnapshot.image.profileId, profileId);
  assert.equal(plan.routeSnapshot.image.modelId, modelId);
  const run = x.rpc("run", { ...x.startInput(plan), confirmGeneration: true });
  assert.equal(run.snapshot.routeSnapshot.image.modelId, modelId);
  assert.equal(x.repo.get("settings", "api-profile:" + profileId).modelId, "doubao-seedream-5-5-261028");
});

test("graph plans require confirmed execution, a valid download location and preserve stopped run history", t => {
  const { center, draft, rpc, startInput } = fixture(t, { archive: false });
  const plan = rpc("save", { plan: draft, expectedRevision: null });
  assert.throws(() => rpc("run", startInput(plan)), /WORKFLOW_CONFIRMATION_REQUIRED/);
  assert.throws(() => rpc("run", { ...startInput(plan), confirmGeneration: true }), /DOWNLOAD_ROOT_REQUIRED/);
  assert.equal(center.list().runs.length, 0);
});

test("plan center does not start old schedules or enable new schedules", t => {
  const { center, draft, rpc, startInput, advance, studio } = fixture(t);
  const schedule = { kind: "daily", localTime: "15:01" };
  const old = center.save({ plan: { ...draft, enabled: true, schedule }, expectedRevision: null });
  for (let i = 0; i < 4; i++) advance();
  tickPlanCenter({ ...studio, root: os.tmpdir() });
  assert.deepEqual(center.list().runs, []);
  assert.deepEqual(center.list().occurrences, []);

  const plan = rpc("save", { plan: { ...old, enabled: true }, expectedRevision: old.revision });
  assert.equal(plan.enabled, false);
  assert.deepEqual(plan.schedule, schedule);
  assert.throws(() => rpc("toggle", { id: plan.id, expectedRevision: plan.revision, enabled: true }), /METHOD_NOT_ALLOWED/);
  assert.throws(() => rpc("scheduleCreation", { id: plan.id, expectedRevision: plan.revision,
    schedule: { kind: "once", date: "2026-11-21", localTime: "09:00" } }), /METHOD_NOT_ALLOWED/);
  const run = rpc("run", { ...startInput(plan), confirmGeneration: true });
  assert.equal(run.source, "manual");
  assert.equal(center.list().runs.length, 1);
});

test("platform nodes pin the exact generation provider and a connected publication account", t => {
  const { center, repo, rpc, draft, startInput } = fixture(t);
  const accountId = randomUUID();
  repo.save("accounts", { id: accountId, name: "汽水账号", provider: "qishui" });
  const imageId = randomUUID();
  repo.save("settings", { id: "api-profile:" + imageId, kind: "image", providerId: "local_image", label: "本地封面", modelId: null, executionEnabled: false, revision: 1 });
  saveGenerationConfig(repo, { role: "image", profileId: imageId, expectedRevision: 2 });
  const graph = {
    nodes: ["publish:qishui", "music:yourmusic", "text:deepseek"],
    edges: [{ from: "text:deepseek", to: "music:yourmusic" }, { from: "music:yourmusic", to: "publish:qishui" }],
    positions: { "publish:qishui": { x: 320, y: 130 } },
  };
  const workflow = { ...draft.workflow, graph, publications: [{ platform: "qishui", accountId }] };
  const plan = rpc("save", { plan: { ...draft, workflow, outputs: { ...draft.outputs, cover: true } }, expectedRevision: null });
  assert.deepEqual(plan.workflow.graph, graph);
  assert.equal(plan.routeSnapshot.text.providerId, "deepseek");
  assert.equal(plan.routeSnapshot.music.providerId, "yourmusic");
  assert.equal(center.list().runs.length, 0);
  assert.throws(() => rpc("run", { ...startInput(plan), confirmGeneration: true }), /WORKFLOW_PUBLICATION_CONFIRMATION_REQUIRED/);
  const run = rpc("run", { ...startInput(plan), confirmGeneration: true, confirmPublication: true });
  assert.equal(run.snapshot.authorization.publish, true);
  assert.deepEqual(run.snapshot.workflow.publications, [{ platform: "qishui", accountId }]);
  assert.equal(center.next({ runId: run.id }).stage, "lyric_write");
});

test("a direct text node cannot silently execute a different provider and invalid links cannot be saved", t => {
  const { center, rpc, draft, startInput } = fixture(t);
  const graph = { nodes: ["text:doubao", "music:yourmusic"], edges: [{ from: "text:doubao", to: "music:yourmusic" }] };
  const plan = rpc("save", { plan: { ...draft, workflow: { ...draft.workflow, graph } }, expectedRevision: null });
  assert.throws(() => rpc("run", { ...startInput(plan), confirmGeneration: true }), /WORKFLOW_TEXT_PROVIDER_REQUIRED/);
  assert.throws(() => rpc("save", { plan: { ...plan, workflow: { ...plan.workflow,
    graph: { ...graph, edges: [...graph.edges, { from: "music:yourmusic", to: "text:doubao" }] } } }, expectedRevision: plan.revision }));
  assert.equal(center.list().runs.length, 0);
});

for (const legacy of [false, true]) test(legacy
  ? "an older rejected lyric plan can adopt its best draft without a new text request"
  : "a lyric plan uses its saved target and passes the highest score downstream after the rewrite limit", t => {
  const { center, repo, draft, artist, rpc, startInput, studio, lyrics } = fixture(t);
  const templateId = randomUUID();
  const template = "60–80 年代普通话苦情歌，简体中文歌词，编曲采用台湾时期的特色。";
  repo.save("promptTemplates", { id: templateId, revision: 1, name: "国语苦情", content: template });
  repo.save("accountLocalArtists", { ...artist, promptTemplateId: templateId, defaults: { ...artist.defaults, language: "中文" } });
  const workflow = { ...draft.workflow, maxRewrites: 2, ...(legacy ? {} : { targetScore: 93 }) };
  const plan = rpc("save", { plan: { ...draft, workflow }, expectedRevision: null });
  assert.equal(rpc("read", { id: plan.id }).workflow.targetScore, workflow.targetScore);
  const run = rpc("run", { ...startInput(plan), confirmGeneration: true });
  assert.equal(run.snapshot.workflow.targetScore, workflow.targetScore);
  const tick = () => {
    const next = center.next({ runId: run.id });
    if (next?.stage === "lyric_write") tickPlanLyrics(studio, run, center.list().items.find(item => item.id === next.itemId), next);
  };
  const claim = () => lyrics.claim(lyrics.ready()[0].id);
  const record = (request, output) => lyrics.record({ id: request.jobId, operationId: request.operationId, result: {
    operationId: request.operationId, providerId: request.providerId, requestedModelId: request.modelId,
    providerRequestId: request.operationId, providerModel: request.modelId, finishReason: "stop", httpStatus: 200,
    usage: { promptTokens: 30, completionTokens: 30, cachedTokens: 0 }, content: JSON.stringify(output), status: "complete", reason: null,
  } });
  const review = (score, findings) => {
    const request = claim();
    assert.equal(request.phase, "score");
    const input = JSON.parse(request.messages[1].content);
    assert.equal(input.creativeBrief.promptTemplate, template);
    assert.equal(input.creativeBrief.musician.language, "中文");
    return record(request, { revisionId: request.revisionId, score, languageMatches: true, findings: [findings] });
  };
  tick();
  if (legacy) {
    const { targetScore, useLyricRubric, ...oldJob } = repo.get("lyricJobs", lyrics.ready()[0].id);
    repo.save("lyricJobs", oldJob);
  }
  const original = "我沿着灯影走到站台";
  const start = record(claim(), { title: "灯影", alternateTitle: "一个人的站台", language: "中文", style: "Taiwanese ballad", lyrics: original });
  review(78, "把停顿放在短句末尾");
  const rewrite = claim();
  assert.equal(rewrite.phase, "rewrite");
  assert.equal(JSON.parse(rewrite.messages[1].content).creativeBrief.promptTemplate, template);
  assert.equal(JSON.parse(rewrite.messages[1].content).targetScore, legacy ? 95 : 93);
  const second = record(rewrite, { lyrics: "我一路走到老车站，停了半天没说话" });
  review(72, "副歌的断句还不自然");
  const anchored = claim();
  const nextInput = JSON.parse(anchored.messages[1].content);
  const base = legacy ? second.versions[1] : start.versions[0];
  assert.equal(anchored.revisionId, base.id);
  assert.equal(nextInput.lyrics, base.lyrics);
  assert.equal(nextInput.previousScore, legacy ? 72 : 78);
  assert.deepEqual(nextInput.findings, [legacy ? "副歌的断句还不自然" : "把停顿放在短句末尾"]);
  record(anchored, { lyrics: "我在站台边把车票捏得发皱" });
  const result = review(72, "句子仍然有点拗口");
  tick();
  const firstAttempt = center.list().stageAttempts[0];
  if (legacy) {
    assert.equal(result.state, "rejected");
    assert.equal(firstAttempt.reason, "LYRIC_SCORE_BELOW_THRESHOLD");
    assert.equal(center.next({ runId: run.id }).stage, "lyric_write");
    assert.deepEqual(lyrics.ready(), []);
    rpc("retry", { attemptId: firstAttempt.id });
    tick();
    tick();
    assert.deepEqual(lyrics.read(result.id), result);
    assert.equal(lyrics.read(center.list().stageAttempts.at(-1).externalTaskId).spentMicros, 0);
  } else {
    assert.equal(result.state, "complete");
    assert.equal(firstAttempt.state, "succeeded");
    assert.equal(center.list().stageAttempts.length, 1);
  }
  assert.deepEqual(lyrics.ready(), []);
  assert.equal(center.next({ runId: run.id }).stage, "music_submit");
  assert.equal(center.list().items[0].material.lyricVersionId, start.versions[0].id);
  assert.equal(center.list().items[0].material.lyrics, original);
});

test("a plan blocked on a legacy invalid review can score its saved draft in the same run", t => {
  const { center, repo, draft, rpc, startInput, studio, lyrics } = fixture(t);
  const plan = rpc("save", { plan: draft, expectedRevision: null });
  const run = rpc("run", { ...startInput(plan), confirmGeneration: true });
  const tick = () => {
    const next = center.next({ runId: run.id });
    if (next?.stage === "lyric_write") tickPlanLyrics(studio, run, center.list().items.find(item => item.id === next.itemId), next);
  };
  const claim = () => lyrics.claim(lyrics.ready()[0].id);
  const record = (request, output) => lyrics.record({ id: request.jobId, operationId: request.operationId, result: {
    operationId: request.operationId, providerId: request.providerId, requestedModelId: request.modelId,
    providerRequestId: request.operationId, providerModel: request.modelId, finishReason: "stop", httpStatus: 200,
    usage: { promptTokens: 100, completionTokens: 100, cachedTokens: 0 }, content: JSON.stringify(output), status: "complete", reason: null,
  } });
  tick();
  const original = { title: "等灯", alternateTitle: "夜归", style: "民谣", language: "中文", lyrics: "雨落在窗边" };
  const saved = record(claim(), original);
  const invalid = record(claim(), { score: 90, languageMatches: true, findings: "评分意见未返回数组" });
  const { reviewRevisionId, reviewIssue, ...legacy } = repo.get("lyricJobs", invalid.id);
  repo.save("lyricJobs", legacy);
  tick();
  const [failed] = center.list().stageAttempts;
  assert.equal(failed.reason, "LYRIC_REVIEW_INVALID");
  assert.equal(center.list().runs[0].state, "blocked");
  assert.deepEqual(lyrics.ready(), []);

  rpc("retry", { attemptId: failed.id });
  tick();
  tick();
  assert.equal(lyrics.ready().length, 1);
  const request = claim();
  assert.equal(request.phase, "score");
  assert.equal(request.revisionId, saved.versions[0].id);
  assert.equal(JSON.parse(request.messages[1].content).lyrics, original.lyrics);
  const reviewed = record(request, { score: 91, languageMatches: true, findings: ["断句自然"] });
  assert.equal(reviewed.state, "complete");
  assert.equal(reviewed.targetScore, saved.targetScore);
  tick();
  assert.equal(center.list().runs.length, 1);
  const attempts = center.list().stageAttempts;
  assert.deepEqual(attempts[0], failed);
  assert.equal(attempts[1].state, "succeeded");
  assert.equal(lyrics.read(invalid.id).spentMicros, invalid.spentMicros);
  assert.equal(center.next({ runId: run.id }).stage, "music_submit");
  assert.deepEqual(center.list().items[0].material, { source: "workflow", title: original.title, alternateTitle: original.alternateTitle,
    lyrics: original.lyrics, musicPrompt: original.style, lyricJobId: reviewed.id, lyricVersionId: request.revisionId });
});

for (const wrongRevision of [false, true]) test(`a plan ${wrongRevision ? "blocks a mismatched review" : "continues from its scored draft after an unusable review"}`, t => {
  const { center, draft, rpc, startInput, studio, lyrics } = fixture(t);
  const plan = rpc("save", { plan: { ...draft, count: 1, workflow: { ...draft.workflow, maxRewrites: 2 } }, expectedRevision: null });
  const run = rpc("run", { ...startInput(plan), confirmGeneration: true });
  const tick = () => {
    const next = center.next({ runId: run.id });
    assert.equal(next?.stage, "lyric_write");
    tickPlanLyrics(studio, run, center.list().items[0], next);
  };
  tick();
  const id = lyrics.ready()[0].id;
  const record = (phase, output) => {
    const request = lyrics.claim(id);
    assert.equal(request.phase, phase);
    return lyrics.record({ id, operationId: request.operationId, result: {
      operationId: request.operationId, providerId: request.providerId, requestedModelId: request.modelId,
      providerRequestId: request.operationId, providerModel: request.modelId, finishReason: "stop", httpStatus: 200,
      usage: { promptTokens: 100, completionTokens: 100, cachedTokens: 0 }, content: JSON.stringify(output), status: "complete", reason: null,
    } });
  };
  const original = { title: "等灯", alternateTitle: "夜归", style: "民谣", language: "中文", lyrics: "雨落在窗边" };
  const initial = record("generate", original).versions[0];
  const reviewed = record("score", { score: 85, languageMatches: true, findings: ["保留原来的副歌"] }).versions[0];
  const firstRewrite = record("rewrite", { lyrics: "收起伞听见了门响" });
  const malformed = { rubric: { styleFit: 17 }, languageMatches: true, findings: ["已检查风格"] };
  const next = record("score", { ...malformed, ...(wrongRevision ? { revisionId: initial.id } : {}) });
  assert.equal(next.reservedMicros, 0);
  assert.deepEqual(next.versions[0], reviewed);
  assert.equal(next.versions[1].review, null);
  if (wrongRevision) {
    assert.equal(next.state, "blocked");
    assert.equal(next.reviewIssue, "revision");
    tick();
    assert.equal(center.list().stageAttempts[0].state, "failed");
    return;
  }
  assert.equal(next.state, "ready");
  assert.equal(next.phase, "rewrite");
  assert.equal(next.rewrites, firstRewrite.rewrites);
  assert.equal(next.versions[1].reviewIssue, "rubric");
  tick();
  assert.equal(center.list().stageAttempts[0].state, "waiting");
  record("rewrite", { lyrics: "我撑着伞站在家门前" });
  const final = record("score", malformed);
  assert.equal(final.state, "complete");
  assert.equal(final.rewrites, 2);
  assert.equal(final.resultVersionId, initial.id);
  assert.deepEqual(final.versions.slice(1).map(v => [v.review, v.reviewIssue]), [[null, "rubric"], [null, "rubric"]]);
  assert.deepEqual(lyrics.ready(), []);
  tick();
  assert.equal(center.list().stageAttempts.length, 1);
  assert.equal(center.list().stageAttempts[0].reason, "LYRIC_BEST_DRAFT_ADOPTED");
  assert.equal(center.next({ runId: run.id }).stage, "music_submit");
  assert.equal(center.list().items[0].material.lyrics, original.lyrics);
  assert.equal(center.list().items[0].material.lyricVersionId, initial.id);
});

test("a plan blocked on an old rewrite response can retry from its saved 76-point draft", t => {
  const { center, repo, draft, rpc, startInput, studio, lyrics } = fixture(t);
  const plan = rpc("save", { plan: { ...draft, count: 1 }, expectedRevision: null });
  const run = rpc("run", { ...startInput(plan), confirmGeneration: true });
  const tick = () => {
    const next = center.next({ runId: run.id });
    if (next?.stage === "lyric_write") tickPlanLyrics(studio, run, center.list().items[0], next);
  };
  const claim = () => lyrics.claim(lyrics.ready()[0].id);
  const record = (request, output) => lyrics.record({ id: request.jobId, operationId: request.operationId, result: {
    operationId: request.operationId, providerId: request.providerId, requestedModelId: request.modelId,
    providerRequestId: request.operationId, providerModel: request.modelId, finishReason: "stop", httpStatus: 200,
    usage: { promptTokens: 100, completionTokens: 100, cachedTokens: 0 }, content: JSON.stringify(output), status: "complete", reason: null,
  } });
  tick();
  const original = { title: "等灯", alternateTitle: "夜归", style: "民谣", language: "中文", lyrics: "雨落在窗边" };
  record(claim(), original);
  const scored = record(claim(), { score: 76, languageMatches: true, findings: ["保留副歌"] });
  const old = repo.get("lyricJobs", scored.id);
  repo.save("lyricJobs", { ...old, state: "blocked", reason: "TEXT_RESPONSE_METADATA_INVALID" });
  tick();
  const [failed] = center.list().stageAttempts;
  assert.equal(failed.reason, "TEXT_RESPONSE_METADATA_INVALID");
  rpc("retry", { attemptId: failed.id });
  tick();
  const resumed = claim();
  assert.equal(resumed.phase, "rewrite");
  assert.equal(resumed.revisionId, scored.versions[0].id);
  assert.equal(JSON.parse(resumed.messages[1].content).lyrics, original.lyrics);
  record(resumed, { lyrics: "我撑着伞站在家门前" });
  record(claim(), { score: 96, languageMatches: true, findings: ["动作与气口清楚"] });
  tick();
  assert.equal(center.next({ runId: run.id }).stage, "music_submit");
  assert.deepEqual(center.list().stageAttempts[0], failed);
  assert.equal(lyrics.read(scored.id).spentMicros, scored.spentMicros);
});

function publicationFixture(t, viaTask = false, prepareContract, fanqieBatch, unbound = false) {
  const x = fixture(t);
  const { center, repo, draft, rpc, startInput, studio } = x;
  const fanqieId = randomUUID(), qishuiId = randomUUID(), imageId = randomUUID();
  const accountKey = "a".repeat(64), configurationHash = "b".repeat(64);
  repo.save("accounts", { id: fanqieId, name: "番茄账号", provider: "fanqie" });
  repo.save("accounts", { id: qishuiId, name: "汽水账号", provider: "qishui" });
  repo.save("settings", { id: "api-profile:" + imageId, kind: "image", providerId: "local_image", label: "本地封面",
    modelId: null, executionEnabled: false, revision: 1 });
  saveGenerationConfig(repo, { role: "image", profileId: imageId, expectedRevision: 2 });
  const graph = { nodes: ["text:deepseek", "music:yourmusic", "publish:fanqie", "publish:qishui"],
    edges: [{ from: "text:deepseek", to: "music:yourmusic" }, { from: "music:yourmusic", to: "publish:fanqie" },
      { from: "music:yourmusic", to: "publish:qishui" }] };
  const workflow = { ...draft.workflow, graph, publications: [
    { platform: "fanqie", accountId: fanqieId, ...(!unbound ? { accountKey, configurationHash } : {}),
      ...(fanqieBatch ? { fanqieBatch } : {}) },
    { platform: "qishui", accountId: qishuiId },
  ] };
  const plan = rpc("save", { plan: { ...draft, workflow, outputs: { ...draft.outputs, cover: true } }, expectedRevision: null });
  const startTask = (contract = prepareContract) => {
    const task = callPublicationTasks(studio, "publicationTasks.save", { expectedRevision: null, task: {
      id: randomUUID(), title: "执行关联计划", execution: { kind: "manual" }, consent: true,
      ...(contract === undefined ? {} : { prepareContract: contract }),
      steps: [{ kind: "plans", planIds: [plan.id] }],
    } });
    const run = callPublicationTasks(studio, "publicationTasks.start", { id: task.id, expectedRevision: task.revision, requestId: randomUUID() });
    tickPublicationTasks(studio);
    return () => callPublicationTasks(studio, "publicationTasks.history", { id: task.id }).find(row => row.id === run.id);
  };
  const taskRun = viaTask ? startTask() : undefined;
  const run = taskRun ? center.list().runs.find(row => row.id === taskRun().linked[0].id) :
    rpc("run", { ...startInput(plan), confirmGeneration: true, confirmPublication: true });
  const items = center.list().items.filter(item => item.runId === run.id).sort((a, b) => a.ordinal - b.ordinal);
  const store = new CenterStore(repo);
  studio.lyricService = () => ({ forWork: work => ({ cleaned: work.lyrics }) });
  const archiveItem = item => {
    const variant = item.ordinal === 1 ? "B" : "A";
    const id = randomUUID(), audio = randomUUID(), cover = randomUUID();
    repo.save("assets", { id: audio, kind: "audio", sha256: "c".repeat(64), bytes: 10, file: "fixture.wav" });
    repo.save("assets", { id: cover, kind: "image", sha256: "d".repeat(64), bytes: 10, file: "fixture.jpg" });
    repo.save("works", { id, title: "草稿 " + item.ordinal, alternateTitle: "归档 B", lyrics: "作词原稿", artistId: draft.artistId,
      ai: "generated", config: { voice: "female" }, selectedAudioVariant: variant, assets: { ["audio_" + variant]: audio, cover },
      audioVersions: [{ assetId: audio, actualLyrics: { text: "[主歌]\n音频实词" } }] });
    store.put("item", { ...item, workId: id, selectedVersion: variant, versions: [{ version: variant, assetId: audio }] });
    for (const stage of ["lyric_write", "music_submit", "music_assets", "cover", "materials"]) {
      const id = `${item.id}:${stage}`;
      store.put("stage", { id, runId: run.id, itemId: item.id, stage, ordinal: 1, idempotencyKey: id, requestHash: id,
        state: "succeeded", createdAt: item.createdAt, updatedAt: item.updatedAt });
    }
    center.refreshPublication(run.id);
    return { id, variant };
  };
  return { ...x, run, items, archiveItem, accountKey, configurationHash, fanqieId, qishuiId, startTask, taskRun };
}

test("a connected Fanqie node can execute with just the selected account and automatically bind it at dispatch", async t => {
  const { center, studio, repo, run, items, archiveItem, fanqieId, accountKey, configurationHash } =
    publicationFixture(t, false, undefined, { limit: 1, signContract: false }, true);
  assert.equal(run.snapshot.workflow.publications[0].accountKey, undefined);
  assert.deepEqual(planFanqieAction(studio, "listWorkflowAccounts", {}), []);
  for (const item of items) archiveItem(item);
  syncWorkflowPublications(studio);
  assert.equal(planFanqieJobs(studio).length, 0);
  assert.equal(readWorkflowPublication(repo, run.id).detail, "WORKFLOW_FANQIE_ACCOUNT_CONNECTING");
  assert.throws(() => planFanqieAction(studio, "recordWorkflowAccount", {
    runId: run.id, accountId: randomUUID(), accountKey, configurationHash,
  }), /FANQIE_BATCH_SCOPE_CHANGED/);
  planFanqieAction(studio, "recordWorkflowAccount", { runId: run.id, accountId: fanqieId, reason: "FANQIE_LOGIN_REQUIRED" });
  assert.equal(readWorkflowPublication(repo, run.id).detail, "FANQIE_LOGIN_REQUIRED");
  assert.equal(center.list().runs[0].state, "blocked");
  assert.equal(planFanqieJobs(studio).length, 0);
  const resolved = [];
  const publisher = createPlanFanqiePublisher({
    available: () => true, generation: () => 1, upload: { status: () => ({ busy: true }) },
    resolveWorkflowAccount: async accountId => { resolved.push(accountId); return { accountKey, configurationHash }; },
    rpc: async (method, input) => {
      try { return { ok: true, value: planFanqieAction(studio, method.split(".").at(-1), input) }; }
      catch (error) { return { ok: false, error: { code: error.message } }; }
    },
  });
  await publisher.pump();
  syncWorkflowPublications(studio);
  await publisher.pump();
  assert.deepEqual(resolved, [fanqieId]);
  const jobs = planFanqieJobs(studio);
  assert.equal(jobs.length, items.length);
  assert.deepEqual(center.list().runs.map(entry => entry.id), [run.id]);
  assert(jobs.every(job => job.accountId === fanqieId && job.accountKey === accountKey &&
    job.configurationHash === configurationHash && job.batchSize === 1));
});

test("a publication task uses its linked plan's publishers and waits for their receipts once", t => {
  const { center, studio, repo, run, items, archiveItem, accountKey, fanqieId, qishuiId, taskRun } = publicationFixture(t, true);
  assert.equal(run.source, "publication_task");
  assert.equal(run.snapshot.authorization.publish, true);
  const first = archiveItem(items[0]);
  syncWorkflowPublications(studio);
  assert.equal(readWorkflowPublication(repo, run.id), undefined);
  assert.equal(planFanqieJobs(studio).length, 0);
  assert.equal(center.next({ runId: run.id, itemId: items[1].id }).state, "ready");
  const second = archiveItem(items[1]);
  syncWorkflowPublications(studio);
  syncWorkflowPublications(studio);
  const batch = planFanqieJobs(studio);
  assert.equal(batch.length, 2);
  assert.ok(batch.every(job => job.accountId === fanqieId && job.state === "ready" && job.publicationRunId === run.id));
  const claimed = planFanqieAction(studio, "claimBatch", { runId: batch[0].runId });
  assert.deepEqual(claimed.items.map(({ workId, variant, useVersionMetadata }) => ({ workId, variant, useVersionMetadata })),
    [first, second].map(work => ({ workId: work.id, variant: work.variant, useVersionMetadata: true })));
  const { fingerprint, ...scoped } = claimed.items[0];
  assert.deepEqual([resolveFanqieWork(studio, scoped).title, resolveFanqieWork(studio, scoped).lyrics, resolveFanqieWork(studio, scoped).fingerprint],
    ["归档 B", "音频实词", fingerprint]);
  assert.equal(resolveFanqieWork(studio, { workId: first.id, variant: "B" }).title, "草稿 1");
  const receipts = claimed.items.map(({ workId }, index) => ({ workId, authorization: "awaiting_signature",
    record: { id: String(11000 + index), title: index ? "草稿 2" : "归档 B", stage: "contract_pending" } }));
  planFanqieAction(studio, "recordBatch", { runId: batch[0].runId, receipts });
  syncWorkflowPublications(studio);
  assert.match(readWorkflowPublication(repo, run.id).detail, /待签署/);
  assert.equal(center.list().runs[0].state, "blocked");
  tickPublicationTasks(studio);
  assert.equal(taskRun().state, "action_required");
  const records = receipts.map(({ record }) => ({ ...record, stage: "reviewing", officialStatus: "审核中", createdAtText: "", publishedAtText: "" }));
  planFanqieAction(studio, "observeAuthorization", { accountId: fanqieId, accountKey, records });
  syncWorkflowPublications(studio);
  assert.equal(readWorkflowPublication(repo, run.id).detail, "WORKFLOW_QISHUI_USER_REQUIRED");
  const scope = work => ({ runId: run.id, accountId: qishuiId, workId: work.id });
  assert.equal(workflowQishuiScope(studio, scope(first)).variant, "B");
  assert.throws(() => workflowQishuiScope(studio, { ...scope(first), accountId: fanqieId }), /WORKFLOW_QISHUI_SCOPE/);
  recordWorkflowQishuiSubmission(studio, { ...scope(first), confirmed: true });
  assert.equal(center.list().runs[0].state, "blocked");
  recordWorkflowQishuiSubmission(studio, { ...scope(second), confirmed: true });
  assert.equal(center.list().runs[0].state, "completed");
  tickPublicationTasks(studio);
  assert.equal(taskRun().state, "completed");
  assert.equal(taskRun().dispatch, undefined);
  assert.equal(planFanqieJobs(studio).length, 2);
});

test("a task that declines signing completes the Fanqie upload without claiming a submission", t => {
  const { studio, repo, run, items, archiveItem, fanqieId, qishuiId, taskRun } =
    publicationFixture(t, true, false, { limit: 2, signContract: false });
  assert.equal(taskRun().snapshot.prepareContract, false);
  assert.equal(run.prepareContract, false);
  const works = items.map(archiveItem);
  syncWorkflowPublications(studio);
  const [batch] = planFanqieJobs(studio);
  assert.equal(batch.accountId, fanqieId);
  const scope = { runId: batch.runId };
  const claim = planFanqieAction(studio, "claimBatch", scope);
  assert.equal(claim.prepareContract, false);
  assert.equal(batch.continueAfterContract, undefined);
  const receipts = works.map(({ id: workId }, index) => ({ workId,
    record: { id: String(12000 + index), title: index ? "草稿 2" : "归档 B", stage: "contract_pending" } }));
  const unknown = { ...receipts[0], record: { ...receipts[0].record, stage: "unknown" } };
  assert.throws(() => planFanqieAction(studio, "recordBatch", { ...scope, receipts: [unknown, receipts[1]] }),
    /FANQIE_SAVED_WORK_READBACK_REQUIRED/);
  planFanqieAction(studio, "recordBatch", { ...scope, receipts });
  syncWorkflowPublications(studio);
  assert.equal(readWorkflowPublication(repo, run.id).detail, "WORKFLOW_QISHUI_USER_REQUIRED");
  for (const work of works) recordWorkflowQishuiSubmission(studio, {
    runId: run.id, accountId: qishuiId, workId: work.id, confirmed: true,
  });
  assert.match(readWorkflowPublication(repo, run.id).detail, /跳过签约/);
  tickPublicationTasks(studio);
  assert.equal(taskRun().state, "completed");
  assert.ok(planFanqieJobs(studio).every(job => job.state === "uploaded" && job.record.stage === "contract_pending"));
});

for (const signContract of [true, false]) {
  test(`Fanqie plan batch settings cap each batch and wait for ${signContract ? "signed" : "generated"} contracts`, t => {
    const settings = { limit: 1, signContract };
    const { studio, center, repo, run, items, archiveItem, accountKey, fanqieId, qishuiId } =
      publicationFixture(t, false, undefined, settings);
    assert.deepEqual(run.snapshot.workflow.publications[0].fanqieBatch, settings);
    const works = items.map(archiveItem);
    syncWorkflowPublications(studio);
    const batches = works.map(work => planFanqieJobs(studio).find(job => job.workId === work.id));
    assert.notEqual(batches[0].runId, batches[1].runId);
    assert.ok(batches.every(job => job.batchSize === 1));
    const [first, second] = batches.map(job => ({ runId: job.runId }));
    const available = () => planFanqieAction(studio, "list", {}).filter(job => job.state === "ready").map(job => job.runId);
    assert.deepEqual(available(), [first.runId]);
    assert.throws(() => planFanqieAction(studio, "claimBatch", second), /FANQIE_PLAN_NOT_READY/);

    const claim = planFanqieAction(studio, "claimBatch", first);
    assert.equal(claim.items.length, 1);
    assert.equal(batches[0].continueAfterContract, signContract ? undefined : true);
    const record = { id: "13100", title: "归档 B", stage: "contract_pending", officialStatus: "待授权",
      createdAtText: "", publishedAtText: "" };
    planFanqieAction(studio, "recordBatch", { ...first,
      receipts: [{ workId: works[0].id, record, authorization: "awaiting_signature" }] });
    assert.deepEqual(available(), []);
    const generated = { ...record, contract: { state: "awaiting_signature", id: "14100" } };
    const observe = record => planFanqieAction(studio, "observeAuthorization", { accountId: fanqieId, accountKey, records: [record] });
    assert.equal(observe({ ...generated, title: "另一首歌" }).updated, 0);
    assert.deepEqual(available(), []);
    observe(generated);
    if (signContract) {
      assert.deepEqual(available(), []);
      observe({ ...record, stage: "reviewing", officialStatus: "审核中" });
    }
    assert.deepEqual(available(), [second.runId]);
    const next = planFanqieAction(studio, "claimBatch", second);
    assert.deepEqual(next.items.map(item => item.workId), [works[1].id]);
    planFanqieAction(studio, "recordBatch", { ...second, receipts: [{ workId: works[1].id,
      record: { id: "13200", title: "草稿 2", stage: "reviewing" }, authorization: "already_processed" }] });
    syncWorkflowPublications(studio);
    for (const work of works) recordWorkflowQishuiSubmission(studio, { runId: run.id, accountId: qishuiId, workId: work.id, confirmed: true });
    assert.equal(center.list().runs.find(row => row.id === run.id).state, "completed");
    if (!signContract) {
      assert.match(readWorkflowPublication(repo, run.id).detail, /已生成待签合同/);
      assert.equal(planFanqieJobs(studio).find(job => job.runId === first.runId).record.stage, "contract_pending");
    }
    assert.equal(planFanqieJobs(studio).length, works.length);
  });
}

test("a publication preparation error is recorded on its linked plan before any dispatch", t => {
  const { center, studio, repo, run, items, archiveItem, taskRun } = publicationFixture(t, true);
  const archived = items.map(archiveItem);
  const work = repo.get("works", archived[0].id);
  repo.save("works", { ...work, selectedAudioVariant: archived[0].variant === "A" ? "B" : "A" });

  syncWorkflowPublications(studio);
  assert.equal(center.list().runs.find(row => row.id === run.id).state, "blocked");
  const problem = readWorkflowPublication(repo, run.id);
  assert.equal(problem.state, "action_required");
  assert.equal(problem.detail, "WORKFLOW_PUBLICATION_MATERIALS_CHANGED");
  assert.equal(problem.dispatch, undefined);
  assert.deepEqual(planFanqieJobs(studio), []);

  tickPublicationTasks(studio);
  assert.deepEqual(taskRun().planFailures, [{ planId: run.planId, reason: problem.detail }]);
  tickPublicationTasks(studio);
  assert.equal(taskRun().state, "failed");
});

test("an upload-only task keeps its contract setting while the independent plan is active", t => {
  const { center, run, startTask } = publicationFixture(t);
  const uploadOnly = startTask(false);
  assert.equal(uploadOnly().state, "waiting");
  assert.equal(uploadOnly().linked.length, 1);
  assert.equal(uploadOnly().planFailures, undefined);
  const [fresh] = uploadOnly().linked;
  assert.equal(fresh.owned, true);
  assert.notEqual(fresh.id, run.id);
  const { runs } = center.list();
  assert.deepEqual(runs.find(row => row.id === run.id), run);
  const child = runs.find(row => row.id === fresh.id);
  assert.equal(child.prepareContract, false);
  assert.equal(child.source, "publication_task");
  assert.equal(center.next({ runId: fresh.id }).stage, "lyric_write");
});

test("stopping the parent plan prevents later publication steps after dispatch is queued", t => {
  const { center, studio, repo, run, items, archiveItem, qishuiId } = publicationFixture(t);
  const works = items.map(archiveItem);
  syncWorkflowPublications(studio);
  const before = readWorkflowPublication(repo, run.id);
  const batch = planFanqieJobs(studio);
  assert.equal(batch.length, 2);
  center.stop({ runId: run.id });
  assert.throws(() => planFanqieAction(studio, "claimBatch", { runId: batch[0].runId }), /STOP_REQUESTED/);
  assert.throws(() => workflowQishuiScope(studio, { runId: run.id, accountId: qishuiId, workId: works[0].id }), /STOP_REQUESTED/);
  syncWorkflowPublications(studio);
  assert.equal(center.list().runs[0].state, "stopped");
  assert.deepEqual(readWorkflowPublication(repo, run.id), before);
  assert.deepEqual(planFanqieJobs(studio), batch);
});

test("a running graph plan cannot be removed until stopped, and deletion preserves results", t => {
  const { center, draft, rpc, startInput } = fixture(t);
  const plan = rpc("save", { plan: draft, expectedRevision: null });
  const input = { ...startInput(plan), confirmGeneration: true };
  const run = rpc("run", input);
  assert.equal(rpc("run", input).id, run.id);
  assert.equal(center.list().items.length, 2);
  assert.equal(rpc("read", { id: plan.id }).authorization.music, false);
  assert.equal(run.snapshot.authorization.music, true);
  const remove = { id: plan.id, expectedRevision: plan.revision };
  assert.throws(() => rpc("delete", remove), /ACTIVE_RUN/);
  assert.equal(center.stop({ runId: run.id }).state, "stopped");
  assert.deepEqual(rpc("delete", remove), { id: plan.id });
  assert.deepEqual(center.list().runs.map(row => row.id), [run.id]);
  assert.equal(center.list().items.length, 2);
  assert.throws(() => rpc("save", { plan: draft, expectedRevision: null }), /PLAN_DELETED/);
});

test("a blocked plan can be deleted after its receipt is settled, preserving the work and execution evidence", t => {
  const { center, draft, repo, rpc, startInput } = fixture(t);
  const plan = rpc("save", { plan: { ...draft, count: 1 }, expectedRevision: null });
  const run = rpc("run", { ...startInput(plan), confirmGeneration: true });
  const [item] = center.list().items;
  const work = repo.save("works", { id: randomUUID(), title: "已有作品", artistId: plan.artistId });
  center.bindWork({ itemId: item.id, workId: work.id, versions: [] });
  const attempt = center.claim({ runId: run.id, itemId: item.id, stage: "lyric_write" });
  center.record({ attemptId: attempt.id, status: "unknown", reason: "TEXT_OUTCOME_UNKNOWN" });
  assert.equal(center.list().runs[0].state, "blocked");
  const deletion = { id: plan.id, expectedRevision: plan.revision };
  assert.throws(() => rpc("delete", deletion), /ACTIVE_RUN/);
  assert.equal(center.list().runs[0].stopRequested, false);

  const reconciled = center.reconcile({ attemptId: attempt.id, status: "not_found", evidenceId: "fixture-receipt" });
  assert.equal(center.list().runs[0].state, "blocked");
  assert.throws(() => rpc("delete", { ...deletion, expectedRevision: plan.revision + 1 }), /REVISION_CONFLICT/);
  assert.equal(center.list().runs[0].stopRequested, false);
  assert.deepEqual(rpc("delete", deletion), { id: plan.id });

  const rows = center.list();
  assert.deepEqual(rows.plans, []);
  assert.equal(rows.runs[0].state, "stopped");
  assert.equal(rows.runs[0].stopRequested, true);
  assert.equal(rows.items[0].workId, work.id);
  assert.deepEqual(rows.stageAttempts, [reconciled]);
  assert.deepEqual(repo.get("works", work.id), work);
  assert.equal(center.next({ runId: run.id }), null);
  assert.throws(() => center.retry({ attemptId: attempt.id }), /STOP_REQUESTED/);
});

test("a graph can run through a separately authorized publication task, but a directory request cannot grant fees", t => {
  const { center, draft, rpc, startInput } = fixture(t);
  const plan = rpc("save", { plan: draft, expectedRevision: null });
  const { source, ...request } = startInput(plan);
  assert.throws(() => center.runDirectory(request), /WORKFLOW_CONFIRMATION_REQUIRED/);
  assert.equal(center.list().runs.length, 0);
  const run = center.runForPublication(request, true);
  assert.equal(run.source, "publication_task");
  assert.deepEqual(run.snapshot.authorization, { text: true, music: true, publish: false });
  assert.equal(center.next({ runId: run.id }).stage, "lyric_write");
  assert.equal(center.next({ runId: run.id }).state, "ready");
});

function musicFixture(t, { secondSinger, instrumental, count, graph, browser, cover = false, sunoCn = false, taskOwned = false }) {
  const parent = fs.realpathSync.native(os.tmpdir());
  const root = fs.mkdtempSync(path.join(parent, "rainfall-plan-fixture-"));
  t.after(() => {
    if (path.dirname(root) === parent && path.basename(root).startsWith("rainfall-plan-fixture-")) fs.rmSync(root, { recursive: true, force: true });
  });
  const x = fixture(t, { secondSinger, instrumental, root });
  const directory = path.join(root, "downloads");
  fs.mkdirSync(directory);
  setDownloadDirectory(x.repo, { root: directory, expectedRevision: 0 });
  const imageId = cover ? randomUUID() : undefined;
  if (imageId) {
    x.repo.save("settings", { id: "api-profile:" + imageId, kind: "image", providerId: sunoCn ? "doubao_image" : "local_image",
      label: "Fixture cover", modelId: sunoCn ? "doubao-seedream-5-5-261028" : "fixture", revision: 1, executionEnabled: false });
    saveGenerationConfig(x.repo, { role: "image", profileId: imageId, expectedRevision: 2 });
    const requests = new Map();
    x.studio.coverHandoff = () => ({
      request: input => requests.set(input.requestId, { id: input.requestId, workId: input.workId,
        context: { title: x.repo.get("works", input.workId).title } }),
      exportRequest: id => requests.get(id),
    });
  }
  const templateId = randomUUID();
  x.repo.save("promptTemplates", { id: templateId, revision: 1, name: "民谣引擎", content: "用叙事写一首民谣" });
  x.repo.save("accountLocalArtists", { ...x.artist, promptTemplateId: templateId, ...(sunoCn && {
    profile: { ...x.artist.profile, voicePersona: "低音", timbreWeight: 14, styleWeight: 54 },
  }) });
  const puleAccountId = browser ? randomUUID() : undefined;
  if (puleAccountId) {
    x.repo.save("accounts", { id: x.draft.workflow.accountId, name: "创作账号", provider: "fanqie" });
    const provider = sunoCn ? "suno_cn" : "yourmusic";
    x.repo.save("accounts", { id: puleAccountId, name: "专属音乐账号", provider });
    saveGenerationConfig(x.repo, { role: "music", profileId: null, expectedRevision: cover ? 3 : 2 });
    graph = { nodes: ["lyrics", "music:" + provider], edges: [{ from: "lyrics", to: "music:" + provider }] };
  }
  const inputs = { title: "alternateTitle", alternateTitle: "title", style: "style", ...(instrumental ? {} : { lyrics: "lyrics" }) };
  const browserWorkflow = sunoCn ? { browserMusic: { accountId: puleAccountId, provider: "suno_cn", inputs,
    coverImage: { providerId: "doubao_image", profileId: imageId, modelId: "doubao-seedream-5-0-pro-260628" } } }
    : { pule: { accountId: puleAccountId, inputs } };
  const plan = x.rpc("save", { plan: { ...x.draft, count, outputs: { ...x.draft.outputs, cover },
    ...(graph ? { workflow: { ...x.draft.workflow, graph, ...(puleAccountId ? { platform: "fanqie", ...browserWorkflow } : {}) } } : {}) }, expectedRevision: null });
  const { source, ...start } = x.startInput(plan);
  const run = taskOwned ? x.center.runForPublication(start, false) : x.rpc("run", { ...start, source, confirmGeneration: true });
  const calls = [], downloads = [], fixtureErrors = [], tick = () => tickPlanCenter(x.studio);
  let originalsReady = false;
  let lostReceipt = false;
  const adapter = {
    async submitCustom(input, dispatch) {
      await dispatch();
      const n = calls.push(input);
      if (lostReceipt) return { state: "unknown", reason: "MUSIC_SUBMISSION_TIMEOUT" };
      return { state: "accepted", trackingId: "job-" + n, songIds: ["song-" + n + "-A", "song-" + n + "-B"] };
    },
    async query(ids) { return { state: "known", songs: ids.map(id => ({ id,
      status: originalsReady ? "succeeded" : "generating", title: "model title", lyric: instrumental ? "" : "returned words",
      audio_url: "https://fixture.invalid/" + id, audio_delivery_status: "original", has_watermark: false })) }; },
    async download(url) { const id = new URL(url).pathname.slice(1); downloads.push(id); return { bytes: Buffer.from(id), mime: "audio/wav" }; },
  };
  const runner = createPlanPuleRunner({ available: () => true, generation: () => 1,
    ...(browser ? { browser: browser(root, puleAccountId) } : {}),
    credentials: { apiCredentialStatus: async identity => {
      if (sunoCn) assert.equal(identity.profileId, imageId);
      else assert.ok(!puleAccountId, "browser generation must use the selected account");
      return { configured: true };
    }, withMusicAdapter: async (_scope, f) => f(adapter) },
    rpc: async (method, raw) => {
      try { return { ok: true, value: await planPuleAction(x.studio, method.split(".").at(-1), raw) }; }
      catch (error) { fixtureErrors.push(error.message); return { ok: false, error: { code: error.message } }; }
    } });
  const writeLyrics = (n, words = "灯下等你 " + n) => {
    const jobs = x.lyrics.ready();
    assert.equal(jobs.length, 1);
    const { id } = jobs[0];
    const record = (request, output) => x.lyrics.record({ id, operationId: request.operationId, result: {
      operationId: request.operationId, providerId: request.providerId, requestedModelId: request.modelId,
      providerRequestId: "fixture", providerModel: x.modelId, finishReason: "stop", httpStatus: 200,
      usage: { promptTokens: 18, completionTokens: 18, cachedTokens: 0 }, content: JSON.stringify(output), status: "complete", reason: null,
    } });
    const version = { title: "窗灯 " + n, alternateTitle: "夜归 " + n, style: "吉他民谣",
      ...(instrumental ? {} : { language: "中文", lyrics: words }) };
    const result = record(x.lyrics.claim(id), version);
    if (!instrumental && result.state === "ready") record(x.lyrics.claim(id), { revisionId: result.versions[0].id, score: 98, languageMatches: true, findings: ["气口自然"] });
    tick();
  };
  return { ...x, plan, run, directory, calls, downloads, fixtureErrors, tick, writeLyrics, puleAccountId, pump: () => runner.pump(),
    originals: ready => { originalsReady = ready; }, loseReceipt: () => { lostReceipt = true; } };
}

test("a running browser task does not prevent a later task on the same account from opening its own window", { timeout: 3000 }, async () => {
  const accountId = randomUUID();
  const runs = [randomUUID(), randomUUID()];
  const queue = [runs[0]];
  const opened = new Map();
  const firstStarted = Promise.withResolvers(), secondStarted = Promise.withResolvers();
  const holdSecond = Promise.withResolvers();
  const records = [];
  const closes = [];
  const runner = createPlanPuleRunner({
    available: () => true, generation: () => 1,
    credentials: {},
    async rpc(method, input) {
      const success = value => ({ ok: true, value });
      switch (method.split(".").at(-1)) {
        case "list": return success(queue.map(runId => ({ runId, itemId: runId + ":item:1", stage: "music_submit" })));
        case "claim": return success({ ...input, attemptId: randomUUID(), custom: { title: input.runId },
          browser: { accountId, artistId: randomUUID(), provider: "yourmusic" } });
        case "current":
        case "authorizeBrowserSubmission": return success(true);
        case "record": records.push(input); return success();
        default: assert.fail(method);
      }
    },
    browser: {
      stagingDirectory: os.tmpdir(),
      async withTaskPage(scope, signal, run) {
        assert.equal(scope.accountId, accountId);
        assert.equal(scope.provider, "yourmusic");
        assert.ok(!opened.has(scope.runId));
        opened.set(scope.runId, signal);
        await run({ id: scope.runId, signal });
      },
      async closeTaskWindow(id) { closes.push(id); },
      async run(page, _input, hooks) {
        if (page.id === runs[0]) {
          await hooks.beforeGeneration();
          firstStarted.resolve();
          await new Promise((_, reject) => page.signal.addEventListener("abort", () => reject(page.signal.reason), { once: true }));
        } else {
          secondStarted.resolve();
          await hooks.beforeGeneration();
          await holdSecond.promise;
          await hooks.beforeCharge("generation");
          await hooks.identify(["second-a", "second-b"]);
        }
      },
    },
  });
  const firstPump = runner.pump();
  await Promise.race([firstStarted.promise, firstPump.then(() => assert.fail("the first task did not open its own window"))]);
  queue.push(runs[1]);
  const secondPump = runner.pump();
  await Promise.race([secondStarted.promise, secondPump.then(() => assert.fail("the running task prevented another window"))]);
  assert.equal(opened.size, 2);
  assert.equal(records.length, 0);
  runner.stop(runs[0]);
  await firstPump;
  assert.ok(opened.get(runs[0]).aborted);
  assert.equal(opened.get(runs[1]).aborted, false);
  assert.ok(closes.includes(runs[0]));
  assert.equal(closes.includes(runs[1]), false);
  holdSecond.resolve();
  await secondPump;
  assert.deepEqual(records.filter(record => record.status === "succeeded").map(record => record.runId), [runs[1]]);
});

test("same-account tasks cannot consume the same browser receipt or submit another unresolved song with that title", t => {
  const x = musicFixture(t, { count: 1, taskOwned: true, browser: () => ({}) });
  const command = (action, input) => planPuleAction(x.studio, action, input);
  const claim = (run, number) => {
    x.tick();
    x.writeLyrics(number);
    const next = command("list", {}).find(task => task.runId === run.id && task.stage === "music_submit");
    const { runId, itemId, stage, attemptId, browser } = command("claim", next);
    assert.equal(browser.accountId, x.puleAccountId);
    return { runId, itemId, stage, attemptId };
  };
  const anotherRun = () => {
    const plan = x.rpc("save", { plan: { ...x.plan, id: randomUUID() }, expectedRevision: null });
    const { source, ...request } = x.startInput(plan);
    return x.center.runForPublication(request, false);
  };
  const first = claim(x.run, 1);
  assert.equal(command("authorizeBrowserSubmission", first), true);
  const receipt = { trackingId: "pule-browser:account-song-a", songIds: ["account-song-a", "account-song-b"] };
  command("record", { ...first, status: "succeeded", receipt });
  const second = claim(anotherRun(), 2);
  assert.equal(command("authorizeBrowserSubmission", second), true);
  assert.throws(() => command("record", { ...second, status: "succeeded", receipt }), /MUSIC_RECEIPT_INVALID/);
  command("record", { ...second, status: "unknown", reason: "WORKFLOW_PULE_BROWSER_RECEIPT_UNKNOWN" });
  const third = claim(anotherRun(), 2);
  assert.throws(() => command("authorizeBrowserSubmission", third), /WORKFLOW_MUSIC_PRIOR_RECEIPT_REQUIRED/);
  assert.equal(command("authorizeBrowserSubmission", claim(anotherRun(), 3)), true);
});

test("a task and an independent run of the same Suno plan open separate windows and keep their own receipts", { timeout: 6000 }, async t => {
  const opened = [], charged = [];
  const firstCharged = Promise.withResolvers(), secondOpened = Promise.withResolvers();
  const releaseFirst = Promise.withResolvers();
  const x = musicFixture(t, { count: 1, cover: true, sunoCn: true, taskOwned: true,
    secondSinger: { name: "歌手乙" }, browser: (root, accountId) => ({
      stagingDirectory: root,
      async withTaskPage(scope, _signal, run) {
        assert.equal(scope.accountId, accountId);
        assert.equal(scope.provider, "suno_cn");
        opened.push(scope.runId);
        if (opened.length === 2) secondOpened.resolve();
        return run({ runId: scope.runId });
      },
      async runSuno(page, input, hooks, { versions }) {
        await hooks.beforeGeneration();
        await hooks.beforeCharge("generation");
        charged.push(page.runId);
        if (charged.length === 1) {
          firstCharged.resolve();
          await releaseFirst.promise;
        }
        await hooks.identify([input.requestId + ":A", input.requestId + ":B"]);
        for (const version of versions) {
          await hooks.saveWave(version, input.requestId + ":" + version, { async saveAs(file) {
            const bytes = Buffer.alloc(50);
            bytes.write("RIFF", 0);
            bytes.write("WAVE", 8);
            bytes[44] = charged.length;
            fs.writeFileSync(file, bytes);
          } }, version === "A" ? input.title : input.alternateTitle);
        }
      },
    }),
  });
  x.tick();
  x.writeLyrics(1);
  const taskPump = x.pump();
  let manualPump;
  let manual;
  try {
    await Promise.race([firstCharged.promise, taskPump.then(() => assert.fail(JSON.stringify(x.fixtureErrors)))]);
    manual = x.rpc("run", { ...x.startInput(x.plan), confirmGeneration: true });
    x.tick();
    x.writeLyrics(2);
    manualPump = x.pump();
    await Promise.race([secondOpened.promise, manualPump.then(() => assert.fail(JSON.stringify(x.fixtureErrors)))]);
    assert.deepEqual(opened, [x.run.id, manual.id]);
    assert.deepEqual(charged, [x.run.id]);
  } finally {
    releaseFirst.resolve();
    await Promise.all([taskPump, manualPump]);
  }
  assert.deepEqual(charged, [x.run.id, manual.id]);
  await x.pump();
  const rows = x.center.list();
  const receipts = rows.stageAttempts.filter(row => row.stage === "music_submit");
  assert.equal(receipts.length, 2);
  assert.ok(receipts.every(row => row.state === "succeeded"));
  assert.equal(new Set(receipts.flatMap(row => row.result.songIds)).size, 4);
  const titles = rows.items.map(item => x.repo.get("works", item.workId).title).sort();
  assert.deepEqual(titles, ["夜归 1", "夜归 2"]);
});

test("Suno CN workflow passes inherited artist values and imports the staged pair without a second submission", async t => {
  let submission, opened = 0;
  const x = musicFixture(t, { count: 1, cover: true, sunoCn: true, secondSinger: { name: "歌手乙" }, browser: (root, accountId) => ({
    stagingDirectory: root,
    async withTaskPage(scope, _signal, run) {
      assert.equal(scope.accountId, accountId);
      assert.equal(scope.provider, "suno_cn");
      opened++;
      return run({});
    },
    async runSuno(_page, input, hooks, { versions }) {
      submission = input;
      assert.deepEqual(versions, ["A", "B"]);
      await hooks.beforeGeneration();
      await hooks.beforeCharge("generation");
      await hooks.identify([input.requestId + ":A", input.requestId + ":B"]);
      for (const version of versions) {
        await hooks.saveWave(version, input.requestId + ":" + version, { async saveAs(file) {
          const bytes = Buffer.alloc(50);
          bytes.write("RIFF", 0);
          bytes.write("WAVE", 8);
          bytes[44] = version === "A" ? 1 : 2;
          fs.writeFileSync(file, bytes);
        } }, version === "A" ? input.title : input.alternateTitle);
      }
    },
  }) });
  x.tick();
  x.writeLyrics(1);
  await x.pump();
  assert.deepEqual([submission.title, submission.alternateTitle, submission.style, submission.lyrics],
    ["夜归 1", "窗灯 1", "吉他民谣", "灯下等你 1"]);
  assert.deepEqual([submission.gender, submission.timbre, submission.timbreWeight, submission.styleWeight], ["female", "低音", 14, 54]);
  const receipt = x.center.list().stageAttempts.find(row => row.stage === "music_submit").result;
  const staged = path.join(x.studio.root, "suno-cn", submission.requestId);
  assert.equal(receipt.sunoWavs.requestId, submission.requestId);
  assert.equal(fs.readFileSync(path.join(staged, "B.wav"))[44], 2);
  await x.pump();
  const [work] = x.repo.all("works");
  assert.equal(work.provider, "suno_cn");
  assert.equal(work.routeSnapshot.image.modelId, "doubao-seedream-5-0-pro-260628");
  assert.ok(work.assets.audio_A && work.assets.audio_B);
  assert.equal(fs.existsSync(staged), false);
  assert.equal(opened, 1);
});

test("Suno CN keeps the saved original and the actual transfer error when the second WAV fails", async t => {
  let input, charges = 0;
  const x = musicFixture(t, { count: 1, cover: true, sunoCn: true, secondSinger: { name: "歌手乙" }, browser: root => ({
    stagingDirectory: root,
    async withTaskPage(_scope, _signal, run) { return run({}); },
    async runSuno(_page, request, hooks) {
      input = request;
      await hooks.beforeGeneration();
      await hooks.beforeCharge("generation");
      charges++;
      await hooks.identify([input.requestId + ":A", input.requestId + ":B"]);
      await hooks.saveWave("A", input.requestId + ":A", { async saveAs(file) {
        const bytes = Buffer.alloc(50);
        bytes.write("RIFF", 0);
        bytes.write("WAVE", 8);
        fs.writeFileSync(file, bytes);
      } }, input.title);
      throw Error("SUNO_CN_DOWNLOAD_NOT_STARTED");
    },
  }) });
  x.tick();
  x.writeLyrics(1);
  await x.pump();
  await x.pump();
  const attempt = x.center.list().stageAttempts.find(row => row.stage === "music_submit");
  assert.equal(attempt.state, "unknown");
  assert.equal(attempt.reason, "SUNO_CN_DOWNLOAD_NOT_STARTED");
  assert.deepEqual(attempt.result.songIds, [input.requestId + ":A", input.requestId + ":B"]);
  assert.equal(attempt.result.sunoWavs.requestId, input.requestId);
  assert.match(attempt.result.sunoWavs.sha256[0], /^[a-f0-9]{64}$/u);
  assert.equal(attempt.result.sunoWavs.sha256[1], null);
  assert.ok(fs.existsSync(path.join(x.studio.root, "suno-cn", input.requestId, "A.wav")));
  assert.equal(charges, 1);
});

test("mapped 谱乐 fields run on the chosen browser account and retry only the known download", async t => {
  const calls = [];
  let wrongTitle = true;
  const x = musicFixture(t, { count: 1, secondSinger: { name: "歌手乙" }, browser: (root, accountId) => ({
    stagingDirectory: root,
    async withTaskPage(scope, _signal, operation) {
      assert.equal(scope.accountId, accountId);
      assert.equal(scope.provider, "yourmusic");
      return operation({});
    },
    async run(_page, input, hooks, _timeouts, phase) {
      calls.push({ input, phase });
      if (phase.kind === "submit") {
        await hooks.beforeGeneration();
        await hooks.beforeCharge("generation");
        await hooks.identify(["browser-song-a", "browser-song-b"]);
        return;
      }
      assert.deepEqual(phase.songIds, ["browser-song-a", "browser-song-b"]);
      for (const [index, song] of phase.songIds.entries()) {
        await hooks.saveWave(index ? "B" : "A", song, { async saveAs(file) {
          const bytes = Buffer.alloc(50);
          bytes.write("RIFF", 0);
          bytes.write("WAVE", 8);
          bytes[44] = index + 1;
          fs.writeFileSync(file, bytes);
        } }, index && !wrongTitle ? input.alternateTitle : input.title);
      }
      wrongTitle = false;
    },
  }) });
  x.tick();
  x.writeLyrics(1);
  await x.pump();
  await x.pump();
  const failed = x.center.list().stageAttempts.find(step => step.stage === "music_assets");
  assert.equal(failed.state, "failed");
  assert.equal(failed.reason, "PULE_SAVED_SONG_TITLE_CHANGED");
  assert.deepEqual(x.repo.all("works"), []);
  x.rpc("retry", { attemptId: failed.id });
  x.advance();
  await x.pump();
  x.tick();
  assert.equal(x.plan.routeSnapshot.music.channel, "pule_browser");
  assert.equal(x.center.list().runs[0].state, "completed", JSON.stringify(x.fixtureErrors));
  assert.deepEqual(calls.map(row => row.phase.kind), ["submit", "download", "download"]);
  for (const { input } of calls) {
    assert.equal(input.accountId, x.puleAccountId);
    assert.deepEqual([input.title, input.alternateTitle, input.style, input.lyrics, input.instrumental],
      ["夜归 1", "窗灯 1", "吉他民谣", "灯下等你 1", false]);
  }
  assert.deepEqual(x.repo.all("works").map(work => [work.title, work.alternateTitle]), [["夜归 1", "窗灯 1"]]);
  const [a, b] = x.run.downloadFolders.map(folder => path.join(x.directory, folder.name));
  assert.deepEqual(fs.readdirSync(a).sort(), ["夜归 1.txt", "夜归 1.wav"]);
  assert.deepEqual(fs.readdirSync(b).sort(), ["窗灯 1.txt", "窗灯 1.wav"]);
  assert.equal(fs.readFileSync(path.join(a, "夜归 1.wav"))[44], 1);
  assert.equal(fs.readFileSync(path.join(b, "窗灯 1.wav"))[44], 2);
});

test("browser plan downloads retry each missing recording up to three times from the original receipt", async t => {
  const attempts = [], charges = [], pageEvents = [];
  const versionAttempts = { A: 0, B: 0 };
  const ids = ["existing-a", "existing-b"];
  const x = musicFixture(t, { count: 1, secondSinger: { name: "歌手乙" }, browser: (root, accountId) => ({
    stagingDirectory: root,
    async withTaskPage(scope, _signal, operation) {
      assert.equal(scope.accountId, accountId);
      pageEvents.push("open");
      try { return await operation({}); }
      finally { pageEvents.push("close"); }
    },
    async run(_page, input, hooks, _timeouts, phase) {
      if (phase.kind === "submit") {
        await hooks.beforeGeneration();
        await hooks.beforeCharge("generation");
        charges.push("generation");
        await hooks.identify(ids);
        return;
      }
      assert.deepEqual(phase.songIds, ids);
      attempts.push(phase.versions);
      for (const version of phase.versions) {
        const index = version === "A" ? 0 : 1;
        const attempt = ++versionAttempts[version];
        await hooks.saveWave(version, ids[index], { async saveAs(file) {
          if (attempt < 4) throw Error("fixture network disconnect");
          const bytes = Buffer.alloc(50);
          bytes.write("RIFF", 0);
          bytes.write("WAVE", 8);
          bytes[44] = index + 1;
          fs.writeFileSync(file, bytes);
        } }, index ? input.alternateTitle : input.title);
      }
    },
  }) });
  x.tick();
  x.writeLyrics(1);
  await x.pump();
  await x.pump();
  x.tick();
  assert.equal(x.center.list().runs[0].state, "completed");
  assert.deepEqual(charges, ["generation"]);
  assert.deepEqual(attempts, [["A", "B"], ["A", "B"], ["A", "B"], ["A", "B"], ["B"], ["B"], ["B"]]);
  assert.deepEqual(pageEvents, Array.from({ length: 8 }, () => ["open", "close"]).flat());
  assert.deepEqual(x.center.list().items[0].versions.map(({ externalId }) => externalId), ids);
});

test("pure music publishes three upstream fields and the browser generation switch is enabled", async t => {
  const submitted = [];
  const x = musicFixture(t, { count: 1, instrumental: true, browser: (root, accountId) => ({
    stagingDirectory: root,
    async withTaskPage(scope, _signal, operation) { assert.equal(scope.accountId, accountId); return operation({}); },
    async run(_page, input, hooks) {
      submitted.push(input);
      await hooks.beforeGeneration();
      await hooks.beforeCharge("generation");
      await hooks.identify(["pure-a", "pure-b"]);
    },
  }) });
  x.tick();
  x.writeLyrics(1);
  const { material } = x.center.list().items[0];
  assert.equal(Object.hasOwn(material, "lyrics"), false);
  assert.deepEqual([material.title, material.alternateTitle, material.musicPrompt], ["窗灯 1", "夜归 1", "吉他民谣"]);
  await x.pump();
  assert.equal(submitted[0].instrumental, true);
  assert.equal(submitted[0].lyrics, "");
  assert.equal(submitted[0].gender, undefined);
});

test("browser plans require explicit compatible mappings before charging or creating a run", t => {
  const { center, draft, rpc, startInput } = fixture(t, { instrumental: true });
  const graph = { nodes: ["lyrics", "music:yourmusic"], edges: [{ from: "lyrics", to: "music:yourmusic" }] };
  const workflow = { ...draft.workflow, graph };
  const save = pule => rpc("save", { plan: { ...draft, id: randomUUID(), workflow: { ...workflow, pule } }, expectedRevision: null });
  const staleAccount = save({ accountId: randomUUID(), inputs: { title: "title", style: "style" } });
  assert.throws(() => rpc("run", { ...startInput(staleAccount), confirmGeneration: true }), /WORKFLOW_PULE_ACCOUNT_REQUIRED/);
  const invalidFields = save({ accountId: draft.workflow.accountId, inputs: { title: "title", style: "lyrics" } });
  assert.throws(() => rpc("run", { ...startInput(invalidFields), confirmGeneration: true }), /WORKFLOW_PULE_INPUTS_REQUIRED/);
  assert.equal(center.list().runs.length, 0);
});

test("a browser submission with a lost receipt does not switch to the API or replay generation", async t => {
  let submits = 0;
  const x = musicFixture(t, { count: 1, browser: (root, accountId) => ({
    stagingDirectory: root,
    async withTaskPage(scope, _signal, operation) { assert.equal(scope.accountId, accountId); return operation({}); },
    async run(_page, _input, hooks) {
      await hooks.beforeGeneration();
      await hooks.beforeCharge("generation");
      submits++;
      throw Error("PULE_RESULT_UNCLEAR");
    },
  }) });
  x.tick();
  x.writeLyrics(1);
  await x.pump();
  const attempt = x.center.list().stageAttempts.find(row => row.stage === "music_submit");
  assert.equal(attempt.state, "unknown");
  assert.equal(attempt.reason, "WORKFLOW_PULE_BROWSER_RECEIPT_UNKNOWN");
  x.advance();
  await x.pump();
  assert.equal(submits, 1);
  assert.throws(() => x.rpc("checkMusicReceipt", { attemptId: attempt.id }), /WORKFLOW_PULE_BROWSER_RECEIPT_UNKNOWN/);
});

test("one singer downloads exactly one original per round and only completes after archiving", async t => {
  const graph = { nodes: ["lyrics", "music:yourmusic"], edges: [{ from: "lyrics", to: "music:yourmusic" }] };
  const x = musicFixture(t, { count: 2, graph });
  x.tick();
  x.writeLyrics(1);
  await x.pump();
  assert.equal(x.calls.length, 1);
  assert.deepEqual([x.calls[0].title, x.calls[0].lyrics, x.calls[0].tags, x.calls[0].vocal_gender],
    ["窗灯 1", "灯下等你 1", "吉他民谣", "female"]);
  await x.pump();
  x.tick();
  assert.equal(x.center.list().items.filter(item => item.state === "completed").length, 0);
  assert.equal(x.lyrics.ready().length, 0);
  x.originals(true);
  x.advance();
  await x.pump();
  x.tick();
  const progress = x.center.list();
  assert.equal(progress.items.filter(item => item.state === "completed").length, 1,
    JSON.stringify({ attempts: progress.stageAttempts.map(({ stage, state, reason }) => ({ stage, state, reason })), errors: x.fixtureErrors }));
  assert.equal(x.downloads.length, 1);
  assert.equal(Object.keys(x.repo.all("works")[0].assets).length, 1);
  x.writeLyrics(2);
  await x.pump();
  await x.pump();
  x.tick();
  assert.equal(x.center.list().runs.find(run => run.id === x.run.id).state, "completed");
  assert.equal(x.calls.length, 2);
  assert.equal(x.downloads.length, 2);
  const folder = path.join(x.directory, "创作账号_歌手甲_民谣引擎");
  assert.equal(fs.readdirSync(folder).filter(name => name.endsWith(".wav")).length, 2);
});

test("two singers get separate A and B files from the same instrumental execution", async t => {
  const previousSecondSinger = { name: "歌手乙", gender: "male", voicePersona: "低沉" };
  const x = musicFixture(t, { count: 1, instrumental: true, secondSinger: previousSecondSinger });
  assert.deepEqual(x.run.snapshot.workflowSnapshot.secondSinger, { name: "歌手乙" });
  const legacySnapshot = { ...x.run.snapshot, workflowSnapshot: {
    ...x.run.snapshot.workflowSnapshot, secondSinger: previousSecondSinger,
  } };
  x.repo.save("settings", { id: "plan-center:run:" + x.run.id, value: { ...x.run, snapshot: legacySnapshot } });
  assert.deepEqual(x.center.list().runs[0].snapshot.workflowSnapshot.secondSinger, previousSecondSinger);
  x.tick();
  x.writeLyrics(1);
  x.originals(true);
  await x.pump();
  await x.pump();
  x.tick();
  assert.equal(x.center.list().runs.find(run => run.id === x.run.id).state, "completed");
  assert.equal(x.calls.length, 1);
  assert.equal(x.calls[0].instrumental, true);
  assert.equal(x.calls[0].lyrics, "");
  assert.equal(x.calls[0].vocal_gender, undefined);
  assert.deepEqual(x.downloads, ["song-1-A", "song-1-B"]);
  for (const [name, slot] of [["歌手甲", "A"], ["歌手乙", "B"]]) {
    const folder = path.join(x.directory, `创作账号_${name}_民谣引擎`);
    const files = fs.readdirSync(folder);
    assert.equal(files.length, 1);
    assert.equal(fs.readFileSync(path.join(folder, files[0]), "utf8"), "song-1-" + slot);
  }
});

test("a plan archives songs and lyrics while a cover is pending and saves all materials to the newly configured directory", async t => {
  const x = musicFixture(t, { count: 1, secondSinger: { name: "歌手乙" }, cover: true });
  x.tick();
  x.writeLyrics(1);
  x.originals(true);
  await x.pump();
  await x.pump();
  x.tick();
  assert.equal(x.center.next({ runId: x.run.id }).stage, "cover");
  assert.equal(x.center.next({ runId: x.run.id }).state, "waiting");

  const folders = x.run.downloadFolders.map(folder => folder.name);
  const extensionsIn = folder => fs.readdirSync(folder).map(name => path.extname(name)).sort();
  for (const folder of folders) assert.deepEqual(extensionsIn(path.join(x.directory, folder)), [".txt", ".wav"]);

  const newRoot = path.join(path.dirname(x.directory), "new-downloads");
  fs.mkdirSync(newRoot);
  setDownloadDirectory(x.repo, { root: newRoot, expectedRevision: 1 });
  const [work] = x.repo.all("works");
  const coverFile = path.join(path.dirname(newRoot), "fixture.png");
  fs.writeFileSync(coverFile, "offline cover");
  const cover = { ...await x.studio.importFile(coverFile, "cover", work.id, () => {}), kind: "image" };
  x.repo.save("assets", cover);
  x.repo.save("works", { ...work, assets: { ...work.assets, cover: cover.id } });
  x.tick();
  x.tick();

  const [run] = x.center.list().runs;
  assert.equal(run.state, "completed");
  assert.ok(run.downloadFolders.every(folder => folder.root === newRoot));
  for (const folder of folders) {
    assert.deepEqual(extensionsIn(path.join(x.directory, folder)), [".txt", ".wav"]);
    assert.deepEqual(extensionsIn(path.join(newRoot, folder)), [".png", ".txt", ".wav"]);
  }
  assert.equal(x.calls.length, 1);
});

test("removing a recording before archiving blocks completion of that round", async t => {
  const x = musicFixture(t, { count: 2 });
  x.tick();
  x.writeLyrics(1);
  x.originals(true);
  await x.pump();
  await x.pump();
  const [work] = x.repo.all("works");
  x.repo.save("works", { ...work, assets: {} });
  x.tick();
  assert.equal(x.center.list().items[0].reason, "WORKFLOW_ARCHIVE_RECORDINGS_CHANGED");
  assert.equal(x.lyrics.ready().length, 0);
  x.repo.save("works", work);
  const attempt = x.center.list().stageAttempts.find(row => row.stage === "materials");
  x.rpc("retry", { attemptId: attempt.id });
  x.tick();
  assert.equal(x.center.list().items[0].state, "completed");
  assert.equal(x.lyrics.ready().length, 1);
  assert.equal(x.calls.length, 1);
});

test("stopping between music polls cancels the download stage and keeps its paid receipt", async t => {
  const x = musicFixture(t, { count: 2 });
  x.tick();
  x.writeLyrics(1);
  await x.pump();
  await x.pump();
  assert.equal(x.center.list().stageAttempts.find(row => row.stage === "music_assets").state, "waiting");
  const stopped = x.rpc("stop", { runId: x.run.id });
  assert.equal(stopped.state, "stopped");
  x.originals(true);
  x.advance();
  await x.pump();
  x.tick();
  const rows = x.center.list();
  assert.equal(rows.stageAttempts.find(row => row.stage === "music_assets").reason, "WORKFLOW_DOWNLOAD_STOPPED");
  assert.deepEqual(rows.stageAttempts.find(row => row.stage === "music_submit").result.songIds, ["song-1-A", "song-1-B"]);
  assert.equal(x.downloads.length, 0);
  assert.equal(x.calls.length, 1);
  assert.equal(x.lyrics.ready().length, 0);
  assert.deepEqual(x.rpc("delete", { id: x.plan.id, expectedRevision: x.plan.revision }), { id: x.plan.id });
});

test("stopping before the text transport sends the request does not leave an unknown paid attempt", async t => {
  const x = musicFixture(t, { count: 1 });
  x.tick();
  const { id } = x.lyrics.ready()[0];
  const request = x.lyrics.claim(id);
  let networkCalls = 0;
  const adapter = new ProviderTextAdapter({ credential: async () => "fixture-only", request: async () => { networkCalls++; throw Error("UNEXPECTED_NETWORK"); } });
  const result = await adapter.invoke(request, async () => {
    x.rpc("stop", { runId: x.run.id });
    throw Error("TEXT_DISPATCH_BLOCKED");
  });
  const job = x.lyrics.record({ id, operationId: request.operationId, result });
  x.tick();
  assert.equal(networkCalls, 0);
  assert.equal(job.state, "stopped");
  assert.equal(job.reservedMicros, 0);
  assert.equal(x.center.list().runs[0].state, "stopped");
});

test("stopping a plan with interrupted lyrics preserves its unknown receipt and ends the run", t => {
  const x = musicFixture(t, { count: 2 });
  x.tick();
  const [{ id }] = x.lyrics.ready();
  const request = x.lyrics.claim(id);
  new LyricWritingService(x.repo, x.now);
  x.tick();
  const old = x.center.list().stageAttempts.find(attempt => attempt.stage === "lyric_write");
  assert.equal(old.reason, "TEXT_PROCESS_INTERRUPTED");
  assert.equal(old.state, "unknown");
  assert.equal(x.rpc("stop", { runId: x.run.id }).state, "stopped");
  x.tick();
  const rows = x.center.list();
  assert.equal(rows.runs[0].state, "stopped");
  assert.ok(rows.items.every(item => item.state === "stopped"));
  assert.deepEqual(rows.stageAttempts, [old]);
  assert.equal(x.lyrics.read(id).operationId, request.operationId);
  assert.deepEqual(x.lyrics.ready(), []);
});

test("rechecking a graph receipt is scoped to the unknown attempt and never submits again", async t => {
  const x = musicFixture(t, { count: 1 });
  x.loseReceipt();
  x.tick();
  x.writeLyrics(1);
  await x.pump();
  const attempt = x.center.list().stageAttempts.find(row => row.stage === "music_submit");
  assert.equal(attempt.state, "unknown");
  assert.deepEqual(x.rpc("checkMusicReceipt", { attemptId: attempt.id }), { runId: x.run.id });
  assert.throws(() => x.rpc("checkMusicReceipt", { attemptId: x.run.id }), /RECONCILE_NOT_REQUIRED/);
  assert.equal(x.center.list().stageAttempts.find(row => row.id === attempt.id).reason, "MUSIC_HISTORY_CHECK_REQUESTED");
  const request = planPuleAction(x.studio, "takeRecovery", {});
  assert.equal(request.scope.attemptId, attempt.id);
  assert.equal(request.match.title, "窗灯 1");
  planPuleAction(x.studio, "recordRecovery", { ...request.scope, outcome: "found",
    songs: ["song-1-A", "song-1-B"].map(id => ({ id, createdAt: attempt.createdAt })) });
  x.originals(true);
  await x.pump();
  x.tick();
  assert.equal(x.downloads.length, 1);
  assert.equal(x.center.list().runs[0].state, "completed");
  assert.equal(x.calls.length, 1);
});

test("unordered history does not relabel the two singers when a paid receipt was lost", async t => {
  const x = musicFixture(t, { count: 1, secondSinger: { name: "歌手乙" } });
  x.loseReceipt();
  x.tick();
  x.writeLyrics(1);
  await x.pump();
  const attempt = x.center.list().stageAttempts.find(row => row.stage === "music_submit");
  x.rpc("checkMusicReceipt", { attemptId: attempt.id });
  const { scope } = planPuleAction(x.studio, "takeRecovery", {});
  const result = planPuleAction(x.studio, "recordRecovery", { ...scope, outcome: "found",
    songs: ["song-1-B", "song-1-A"].map(id => ({ id, createdAt: attempt.createdAt })) });
  assert.equal(result.state, "unknown");
  assert.equal(result.reason, "MUSIC_HISTORY_PAIR_ORDER_UNAVAILABLE");
  assert.deepEqual(planPuleAction(x.studio, "list", {}), []);
  assert.equal(x.calls.length, 1);
});

test("lyrics beyond the music provider limit can be regenerated before a music request", async t => {
  const x = musicFixture(t, { count: 1 });
  x.tick();
  x.writeLyrics(1, "风".repeat(5001));
  await x.pump();
  const attempt = x.center.list().stageAttempts.find(row => row.stage === "lyric_write");
  assert.equal(attempt.reason, "WORKFLOW_LYRICS_TOO_LONG");
  assert.equal(x.calls.length, 0);
  x.rpc("retry", { attemptId: attempt.id });
  x.tick();
  x.writeLyrics(2);
  await x.pump();
  assert.equal(x.calls.length, 1);
  assert.equal(x.calls[0].lyrics, "灯下等你 2");
});
