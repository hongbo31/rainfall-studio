import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";
import { compileFunction } from "node:vm";
import { build } from "esbuild";

const { outputFiles } = await build({
  stdin: { contents: `export { Repository } from './src/core/database';
    export { LyricWritingService } from './src/core/lyric-writing';
    export { lyricResultText, lyricResultVersion } from './src/shared/lyric-writing';
    export { prepareCreationTask, startCreationTask, materializeCreationTaskWork } from './src/core/creation-tasks';
    export { PlanCenterService } from './src/core/plan-center';
    export { executePlanCenter, tickPlanCenter } from './src/core/plan-center-integration';
    export { planPuleAction } from './src/core/plan-pule';
    export { YourMusicAdapter } from './src/core/workflow/yourmusic';
    export { createPlanPuleRunner } from './src/main/plan-pule';
    export { ProviderTextAdapter } from './src/core/workflow/provider-text';
    export { ApiCredentials } from './src/main/api-credentials';
    export { saveGenerationConfig } from './src/core/generation-config';
    export { createProviderTextBroker } from './src/main/provider-text';`, resolveDir: process.cwd() },
  bundle: true, platform: "node", packages: "external", format: "cjs", write: false,
});
const compiled = { exports: {} };
compileFunction(outputFiles[0].text, ["module", "exports", "require", "__dirname"])(
  compiled, compiled.exports, createRequire(import.meta.url), process.cwd(),
);
const { Repository, LyricWritingService, lyricResultText, lyricResultVersion, ProviderTextAdapter, ApiCredentials, saveGenerationConfig, createProviderTextBroker } = compiled.exports;

test("a submitted creation draft waits for an explicit run or one-time schedule", t => {
  const { prepareCreationTask, startCreationTask, materializeCreationTaskWork, PlanCenterService } = compiled.exports;
  const repo = new Repository(":memory:");
  t.after(() => repo.close());
  let clock = new Date("2026-11-19T08:00:00Z");
  const center = new PlanCenterService(repo, { now: () => clock });
  const artist = { id: randomUUID(), name: "歌手", revision: 1, defaults: { voice: "female" } };
  repo.save("accountLocalArtists", artist);
  repo.save("artists", artist);
  const studio = { repo, now: () => clock, mode: "production", planCenterService: () => center,
    saveWork: draft => repo.save("works", { ...draft, id: randomUUID() }) };
  const request = { requestId: randomUUID(), artistId: artist.id, draft: { title: "等灯", alternateTitle: "窗边的光", lyrics: "[主歌]\n窗灯等我", style: "民谣" },
    songType: "vocal", outputs: { cover: false, music: false }, music: { consent: false } };
  const plan = prepareCreationTask(studio, request);
  assert.equal(prepareCreationTask(studio, request).id, plan.id);
  assert.throws(() => startCreationTask(studio, request), /CREATION_TASK_ALREADY_STAGED/);
  assert.equal(center.list().runs.length, 0);
  assert.equal(center.listCreationTasks()[0].state, "pending");
  const preview = center.preview({ id: plan.id });
  const run = center.run({ id: plan.id, expectedRevision: preview.planRevision, summaryHash: preview.summaryHash, requestId: randomUUID(), source: "manual" });
  const item = center.list().items[0];
  assert.equal(center.listCreationTasks()[0].state, "running");
  assert.equal(center.next({ runId: run.id }).stage, "materials");
  materializeCreationTaskWork(studio, run, item);
  materializeCreationTaskWork(studio, run, item);
  assert.deepEqual(repo.all("works").map(({ title, alternateTitle, lyrics, prompt }) => ({ title, alternateTitle, lyrics, prompt })),
    [{ title: request.draft.title, alternateTitle: "窗边的光", lyrics: request.draft.lyrics, prompt: request.draft.style }]);
  assert.equal(center.listCreationTasks()[0].workId, repo.all("works")[0].id);
  const materials = center.claim({ runId: run.id, itemId: item.id, stage: "materials" });
  center.record({ attemptId: materials.id, status: "succeeded", evidenceId: "fixture-work" });
  assert.equal(center.listCreationTasks()[0].state, "completed");
  assert.throws(() => center.scheduleCreation({ id: plan.id, expectedRevision: plan.revision,
    schedule: { kind: "once", date: "2026-11-19", localTime: "15:59" } }), /CREATION_SCHEDULE_IN_PAST/);
  center.scheduleCreation({ id: plan.id, expectedRevision: plan.revision, schedule: { kind: "once", date: "2026-11-19", localTime: "17:00" } });
  assert.equal(center.read({ id: plan.id }).schedule.localTime, "17:00");
  assert.equal(center.listCreationTasks()[0].schedule, undefined);
  clock = new Date("2026-11-19T09:00:01Z");
  center.tick();
  center.tick();
  const rows = center.list();
  const scheduledRuns = rows.runs.filter(row => row.source === "scheduled");
  assert.equal(scheduledRuns.length, 1);
  assert.equal(rows.plans[0].enabled, false);
  const scheduledItem = rows.items.find(row => row.runId === scheduledRuns[0].id);
  const scheduledMaterials = center.claim({ runId: scheduledItem.runId, itemId: scheduledItem.id, stage: "materials" });
  center.record({ attemptId: scheduledMaterials.id, status: "unknown", reason: "FIXTURE_PENDING" });
  assert.equal(center.listCreationTasks()[0].runId, scheduledItem.runId);
  assert.equal(center.listCreationTasks()[0].state, "unknown");
  center.reconcile({ attemptId: scheduledMaterials.id, status: "failed", evidenceId: "fixture-checked", reason: "FIXTURE_FAILED" });
  assert.equal(center.listCreationTasks()[0].state, "failed");
});

test("creating a music task starts its API run once and submits the saved content", async t => {
  const { startCreationTask, PlanCenterService, planPuleAction, YourMusicAdapter, createPlanPuleRunner } = compiled.exports;
  const repo = new Repository(":memory:");
  t.after(() => repo.close());
  let archiveUnavailable = true;
  const center = new PlanCenterService(repo, { capabilities: { music: { available: true } }, prepareDownloads() {
    if (archiveUnavailable) throw Error("DOWNLOAD_ROOT_UNAVAILABLE");
    return [];
  } });
  const artist = { id: randomUUID(), name: "歌手", revision: 1, defaults: { voice: "female", duration: 165 } };
  repo.save("accountLocalArtists", artist);
  repo.save("artists", artist);
  const profileId = randomUUID(), modelId = "chirp-v6";
  repo.save("settings", { id: "api-profile:" + profileId, kind: "music", providerId: "yourmusic", executionEnabled: false, label: "谱乐", revision: 1, modelId });
  saveGenerationConfig(repo, { role: "music", profileId, expectedRevision: 0 });
  const studio = { mode: "production", repo, now: () => new Date(), planCenterService: () => center };
  const input = { requestId: randomUUID(), artistId: artist.id, songType: "vocal", outputs: { cover: false, music: true },
    draft: { title: "等灯", lyrics: "[主歌]\n\n窗灯等我\n[副歌]\n灯亮了", style: "民谣、木吉他", vocalGender: "male" },
    music: { consent: true, profileId, profileRevision: 1, modelId } };
  const calls = [];
  const adapter = new YourMusicAdapter({ source: "fixture", credential: async () => "fixture", request: async request => {
    await request.assertDispatch();
    calls.push({ url: request.url, body: request.body });
    return { status: 202, body: { task_id: "fixture-tracking", status: "pending",
      songs: [{ id: "fixture-a", status: "pending", audio_url: null, duration: null },
        { id: "fixture-b", status: "pending", lyric: null, title: null }] } };
  } });
  const runner = createPlanPuleRunner({ available: () => true, generation: () => 1,
    rpc: async (method, raw) => ({ ok: true, value: await planPuleAction(studio, method.split(".").at(-1), raw) }),
    credentials: { apiCredentialStatus: async () => ({ configured: true }), withMusicAdapter: async (_, run) => run(adapter) } });
  await runner.pump();
  assert.equal(calls.length, 0);
  assert.throws(() => startCreationTask(studio, input), /DOWNLOAD_ROOT_UNAVAILABLE/);
  assert.equal(center.list().plans.length, 0);
  assert.equal(center.list().runs.length, 0);
  archiveUnavailable = false;
  const { plan, run } = startCreationTask(studio, input);
  assert.equal(center.listCreationTasks()[0].state, "running");
  assert.equal(run.planId, plan.id);
  assert.equal(startCreationTask(studio, input).run.id, run.id);
  assert.equal(center.list().runs.length, 1);
  await runner.pump();
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/v1\/suno\/generate\/custom$/u);
  assert.deepEqual(calls[0].body, { title: input.draft.title, lyrics: input.draft.lyrics, tags: input.draft.style,
    negative_tags: "", model: modelId, instrumental: false, duration: 165, is_max_mode: false, vocal_gender: "male" });
  assert.equal(center.next({ runId: run.id }).stage, "music_assets");
  assert.equal(center.list().stageAttempts.filter(attempt => attempt.stage.startsWith("text")).length, 0);

  center.stop({ runId: run.id });
  const { run: instrumentalRun } = startCreationTask(studio, { ...input, requestId: randomUUID(), songType: "instrumental" });
  await runner.pump();
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /\/v1\/suno\/generate\/custom$/u);
  assert.deepEqual(calls[1].body, { title: input.draft.title, lyrics: "", tags: input.draft.style,
    negative_tags: "vocals, spoken word", model: modelId, instrumental: true, duration: 165, is_max_mode: false });
  assert.equal(center.next({ runId: instrumentalRun.id }).stage, "music_assets");
});

test("a lost custom receipt is recovered from exactly matching history without submitting again", async t => {
  const { startCreationTask, PlanCenterService, planPuleAction, YourMusicAdapter, createPlanPuleRunner } = compiled.exports;
  const repo = new Repository(":memory:");
  t.after(() => repo.close());
  let time = Date.parse("2026-11-19T12:36:37Z");
  const now = () => new Date(time);
  const center = new PlanCenterService(repo, { now, capabilities: { music: { available: true } } });
  const artist = { id: randomUUID(), name: "歌手", revision: 1, defaults: { voice: "female" } };
  repo.save("accountLocalArtists", artist);
  repo.save("artists", artist);
  const profileId = randomUUID(), modelId = "chirp-v6";
  repo.save("settings", { id: "api-profile:" + profileId, kind: "music", providerId: "yourmusic", executionEnabled: false,
    label: "谱乐", revision: 1, modelId });
  saveGenerationConfig(repo, { role: "music", profileId, expectedRevision: 0 });
  const studio = { mode: "production", repo, now, planCenterService: () => center };
  const request = { requestId: randomUUID(), artistId: artist.id, songType: "vocal", outputs: { cover: false, music: true },
    draft: { title: "雨夜", lyrics: "[主歌]\n灯亮了", style: "民谣与钢琴", vocalGender: "female" },
    music: { consent: true, profileId, profileRevision: 1, modelId } };
  const { run } = startCreationTask(studio, request);
  let submissions = 0, historyCalls = 0;
  const remote = { title: request.draft.title, lyric: request.draft.lyrics.replace("\n", "\r\n"), tags: request.draft.style,
    instrumental: false, model_name: modelId, created_at: new Date(time + 3000).toISOString(), status: "succeeded" };
  const pair = [{ id: "song-a", ...remote }, { id: "song-b", ...remote }];
  const adapter = new YourMusicAdapter({ source: "fixture", credential: async () => "fixture", request: async req => {
    if (req.method === "POST") {
      submissions++;
      await req.assertDispatch();
      throw Error("HTTP_TIMEOUT");
    }
    assert.match(req.url, /\/v1\/music\/generations\/history\?page=1&size=100$/u);
    historyCalls++;
    return { status: 200, body: { data: historyCalls === 1 ? [{ ...pair[0], tags: "曲风不同" }, pair[1]] : pair, total: 2 } };
  } });
  const runner = createPlanPuleRunner({ available: () => true, generation: () => 1,
    rpc: async (method, raw) => ({ ok: true, value: await planPuleAction(studio, method.split(".").at(-1), raw) }),
    credentials: { apiCredentialStatus: async () => ({ configured: true }), withMusicAdapter: async (_, send) => send(adapter) } });
  await runner.pump();
  assert.equal(center.listCreationTasks()[0].state, "unknown");
  assert.equal(center.list().stageAttempts[0].reason, "MUSIC_SUBMISSION_TIMEOUT");
  time += 10_000;
  await runner.pump();
  assert.equal(center.list().stageAttempts[0].state, "unknown");
  assert.equal(historyCalls, 1);
  await runner.pump();
  assert.equal(historyCalls, 1);
  time += 120_000;
  await runner.pump();
  assert.equal(submissions, 1);
  assert.equal(historyCalls, 2);
  assert.equal(center.list().stageAttempts[0].state, "succeeded");
  assert.deepEqual(center.list().stageAttempts[0].result, { songIds: ["song-a", "song-b"] });
  assert.equal(center.next({ runId: run.id }).stage, "music_assets");
});

function setup(t) {
  const repo = new Repository(":memory:");
  t.after(() => repo.close());
  const profileId = randomUUID();
  const modelId = "mock-model";
  repo.save("settings", { id: `api-profile:${profileId}`, kind: "text", providerId: "deepseek", label: "隔离用例", modelId,
    revision: 1, executionEnabled: false, textPricing: { currency: "USD", modelId, inputMicrosPerMillionTokens: 10_000,
      outputMicrosPerMillionTokens: 10_000, source: "fixture", version: "fixture", responseModelIds: [modelId] } });
  const service = new LyricWritingService(repo, () => new Date("2026-11-19T08:00:00Z"));
  const input = { id: randomUUID(), profileId, profileRevision: 1, mode: "inspiration", inspiration: "雨夜回家",
    artistId: null, templateId: null, budgetMicros: 100_000, maxRewrites: 10, consent: true };
  const result = (request, data) => ({ operationId: request.operationId, providerId: request.providerId, requestedModelId: request.modelId,
    providerRequestId: "fixture", providerModel: request.modelId, finishReason: "stop", httpStatus: 200,
    usage: { promptTokens: 100, completionTokens: 100, cachedTokens: 0 }, content: JSON.stringify(data), status: "complete", reason: null });
  const record = (request, data) => service.record({ id: input.id, operationId: request.operationId, result: result(request, data) });
  return { repo, service, input, record, result };
}

test("inspiration mode uses the selected platform artist and scores only the generated concept", t => {
  const { repo, service, input, record } = setup(t);
  const accountId = randomUUID(), otherAccount = randomUUID(), artistId = randomUUID(), templateId = randomUUID();
  repo.save("accounts", { id: accountId, provider: "fanqie", name: "私用账号备注" });
  repo.save("accounts", { id: otherAccount, provider: "fanqie", name: "另一账号" });
  repo.save("promptTemplates", { id: templateId, name: "原始风格", content: "钢琴独奏，傍晚气氛" });
  repo.save("accountLocalArtists", {
    id: artistId, accountId, revision: 1, name: "器乐艺人", promptTemplateId: templateId,
    defaults: { voice: "instrumental", genre: "钢琴", language: "中文", mood: "平静" },
    profile: { singer: "艺人", contractMode: "exclusive" },
  });
  const request = {
    id: input.id, platform: "fanqie", accountId, artistId, artistRevision: 1,
    profileId: input.profileId, profileRevision: 1, consent: true,
  };
  assert.throws(() => service.startInspiration({ ...request, platform: "qqmusic" }), /ACCOUNT_PROVIDER_MISMATCH/);
  assert.throws(() => service.startInspiration({ ...request, accountId: otherAccount }), /ARTIST_ACCOUNT_MISMATCH/);
  assert.throws(() => service.startInspiration({ ...request, artistRevision: 2 }), /LYRIC_ARTIST_CHANGED/);
  assert.throws(() => service.startInspiration({ ...request, inspiration: "多余的用户输入" }));
  const started = service.startInspiration(request);
  assert.equal(started.kind, "inspiration");
  assert.deepEqual(service.startInspiration(request), started);
  assert.equal(repo.maybe("lyricJobs", input.id), undefined, "legacy workers cannot dispatch inspiration jobs");
  assert.equal(service.ready()[0].id, input.id);

  const generation = service.claim(input.id);
  assert.equal(generation.phase, "generate");
  assert.match(generation.messages[0].content, /灵感/);
  const context = JSON.parse(generation.messages[1].content);
  assert.equal(context.platform, "番茄音乐");
  assert.equal(context.musician.genre, "钢琴");
  assert.match(context.promptTemplate, /钢琴独奏/);
  assert.doesNotMatch(generation.messages[1].content, /私用账号备注|contractMode/);

  const concept = { title: "向晚", alternateTitle: "屋檐下的静音", inspiration: "下班后停在屋檐下数落雨声，气氛逐渐平静。" };
  const generated = record(generation, { ...concept, title: "《向·晚》", alternateTitle: "【屋檐下／的静音🌧】" });
  assert.equal(generated.phase, "score");
  assert.deepEqual(generated.versions, []);
  const score = service.claim(input.id);
  assert.equal(score.phase, "score");
  assert.equal(score.revisionId, generated.inspirationResult.id);
  assert.equal(JSON.parse(score.messages[1].content).revisionId, undefined);
  assert.equal(JSON.parse(score.messages[1].content).title, concept.title);
  assert.equal(JSON.parse(score.messages[1].content).alternateTitle, concept.alternateTitle);
  assert.match(generation.messages[0].content, /核心场景/);
  assert.match(score.messages[1].content, /下班后停在屋檐下/);
  assert.doesNotMatch(score.messages[1].content, /钢琴独奏，傍晚气氛/);
  const output = { score: 91, languageMatches: true, findings: ["两个标题可进一步拉开意象"] };
  const review = { ...output, revisionId: generated.inspirationResult.id };
  const finished = record(score, output);
  assert.equal(finished.state, "rejected");
  assert.deepEqual(finished.inspirationResult, { ...concept, id: review.revisionId, review });
  assert.deepEqual(service.ready(), []);
  assert.equal(service.list()[0].title, concept.title);
  assert.deepEqual(new LyricWritingService(repo).read(input.id).inspirationResult, finished.inspirationResult);
});

for (const mode of ["inspiration", "musician"]) test(`a saved ${mode} workflow passes the musician and verified draft through in order`, t => {
  const { repo, service, input, result } = setup(t);
  const { PlanCenterService, executePlanCenter, tickPlanCenter, planPuleAction } = compiled.exports;
  const artistId = randomUUID(), accountId = randomUUID(), templateId = randomUUID(), musicId = randomUUID();
  const instrumental = mode === "musician";
  const artist = { id: artistId, revision: 1, name: "本地歌手", promptTemplateId: templateId,
    defaults: { voice: instrumental ? "instrumental" : "female", genre: "民谣", duration: 165 },
    profile: { singer: "本地歌手", gender: "female", lyricist: "词作者", composer: "曲作者", contractMode: "exclusive" } };
  repo.save("accounts", { id: accountId, provider: "fanqie", name: "我的平台账号" });
  repo.save("accountLocalArtists", artist);
  repo.save("artists", artist);
  repo.save("promptTemplates", { id: templateId, revision: 1, name: "叙事模板", content: "写回家路上的故事" });
  repo.save("settings", { id: "api-profile:" + musicId, kind: "music", providerId: "yourmusic", revision: 1,
    label: "谱乐", modelId: "chirp-v6", executionEnabled: false });
  const center = new PlanCenterService(repo, { capabilities: { text: { available: true }, music: { available: true } } });
  const studio = { repo, root: "fixture-library", now: () => new Date(), mode: "production",
    lyricWritingService: () => service, planCenterService: () => center };
  const plan = center.save({ expectedRevision: null, plan: { id: randomUUID(), title: "计划", artistId,
    schedule: { kind: "daily", localTime: "09:00" },
    material: { source: "workflow" }, outputs: { lyrics: true, cover: false, music: true },
    workflow: { accountId, platform: "fanqie", mode, inspiration: instrumental ? "" : "雨夜回家", maxRewrites: 3 },
    routing: { text: { source: "override", profileId: input.profileId }, image: { source: "default" },
      music: { source: "override", profileId: musicId } },
    text: { consent: true }, music: { route: "pule", profileId: musicId, profileRevision: 1, modelId: "chirp-v6",
      consent: true, budgetCredits: 1, maxCostPerRequestCredits: 1, versionPolicy: "first",
      creditPolicy: { mode: "uncapped_existing_credits", noRecharge: true, actualCostUnknown: true, consent: true } },
    authorization: { text: true, music: true, publish: false },
  } });
  assert.equal(plan.workflowSnapshot.accountName, "我的平台账号");
  assert.equal(plan.songType, instrumental ? "instrumental" : "vocal");
  const preview = center.preview({ id: plan.id });
  const run = center.run({ id: plan.id, expectedRevision: plan.revision, summaryHash: preview.summaryHash, requestId: randomUUID(), source: "debug" });
  const item = center.list().items[0];
  assert.throws(() => center.claim({ runId: run.id, itemId: item.id, stage: "music_submit" }), /STAGE_PREREQUISITE/);
  const tick = () => tickPlanCenter(studio);
  tick();
  tick();
  assert.equal(service.ready().length, 1);
  const id = service.ready()[0].id;
  const stage = center.list().stageAttempts[0];
  assert.throws(() => center.record({ attemptId: stage.id, status: "succeeded", evidenceId: id }),
    /WORKFLOW_LYRICS_EVIDENCE_REQUIRED/);
  const first = service.claim(id);
  const context = JSON.parse(first.messages[1].content);
  assert.equal(context.musician.lyricist, "词作者");
  assert.equal(context.musician.name, "本地歌手");
  assert.equal(context.inspiration, instrumental ? "" : "雨夜回家");
  assert.equal(context.promptTemplate, instrumental ? "写回家路上的故事" : null);
  const generated = { title: "灯还亮着", alternateTitle: "夜行", style: "民谣与钢琴",
    ...(instrumental ? {} : { lyrics: "[主歌]\n灯还亮着", language: "中文" }) };
  service.record({ id, operationId: first.operationId, result: result(first, {
    ...generated, title: "〈灯还亮着〉", alternateTitle: "夜·行✨",
  }) });
  if (!instrumental) {
    const score = service.claim(id);
    service.record({ id, operationId: score.operationId, result: result(score, {
      score: 98, languageMatches: true, findings: ["适合演唱"],
    }) });
  }
  tick();
  const draft = center.list().items[0].material;
  assert.equal(draft.title, generated.title);
  assert.equal(draft.alternateTitle, generated.alternateTitle);
  if (instrumental) assert.equal(Object.hasOwn(draft, "lyrics"), false);
  else assert.equal(draft.lyrics, generated.lyrics);
  assert.equal(center.next({ runId: run.id }).stage, "music_submit");
  const [task] = planPuleAction(studio, "list", {});
  const music = planPuleAction(studio, "claim", task);
  assert.equal(music.custom.title, generated.title);
  assert.equal(music.custom.style, generated.style);
  assert.equal(music.custom.lyrics, generated.lyrics ?? "");
  assert.equal(music.custom.vocalGender, instrumental ? undefined : "female");

  executePlanCenter(studio, "planCenter.stop", { runId: run.id });
  planPuleAction(studio, "record", { ...task, attemptId: music.attemptId, status: "failed", reason: "fixture-stopped" });
  const nextRun = center.run({ id: plan.id, expectedRevision: plan.revision, summaryHash: preview.summaryHash,
    requestId: randomUUID(), source: "debug" });
  tick();
  assert.equal(service.ready().length, 1);
  assert.equal(executePlanCenter(studio, "planCenter.stop", { runId: nextRun.id }).state, "stopped");
  assert.equal(service.ready().length, 0);
  assert.deepEqual(planPuleAction(studio, "list", {}), []);
  repo.save("promptTemplates", { ...repo.get("promptTemplates", templateId), revision: 2 });
  assert.equal(center.preview({ id: plan.id }).summary.routeIssue, "WORKFLOW_TEMPLATE_CHANGED");
});

test("both lyric modes use automatic limits and a musician's linked template", t => {
  const { repo, service, input } = setup(t);
  delete input.budgetMicros;
  const other = randomUUID(), linked = randomUUID(), artistId = randomUUID();
  repo.save("promptTemplates", { id: linked, name: "关联模板", content: "关联内容" });
  repo.save("promptTemplates", { id: other, name: "其他模板", content: "其他内容" });
  repo.save("accountLocalArtists", { id: artistId, name: "歌手", promptTemplateId: linked });
  const inspiration = service.start({ ...input, templateId: other });
  assert.equal(inspiration.templateName, null);
  assert.ok(inspiration.budgetMicros > 0);
  const musician = service.start({ ...input, id: randomUUID(), mode: "musician", artistId, templateId: other });
  assert.equal(musician.templateName, "关联模板");
  const request = service.claim(musician.id);
  assert.deepEqual(JSON.parse(request.messages[1].content).inspiration, "");
  assert.match(request.messages[1].content, /关联内容/);
});

test("an instrumental musician receives titles and style in one text call", t => {
  const { repo, service, input, record } = setup(t);
  const artistId = randomUUID(), templateId = randomUUID();
  repo.save("accountLocalArtists", { id: artistId, name: "器乐艺人", defaults: { voice: "instrumental", language: "泰语" }, promptTemplateId: templateId });
  repo.save("promptTemplates", { id: templateId, name: "钢琴模板", content: "深夜独奏，温暖钢琴" });
  assert.throws(() => service.start({ ...input, mode: "musician", artistId, expectedSongType: "vocal" }), /LYRIC_MUSICIAN_SONG_TYPE_CHANGED/);
  const started = service.start({ ...input, mode: "musician", artistId });
  assert.equal(started.songType, "instrumental");
  assert.equal(started.maxRewrites, 0);
  const request = service.claim(input.id);
  assert.match(request.messages[0].content, /纯音乐/);
  assert.match(request.messages[1].content, /深夜独奏/);

  const finished = record(request, {
    title: "《คืนฝัน\uFE0F🎵》", alternateTitle: "「  Echo\t　7 ℹ️ 1️⃣ ✨! 」", style: "温暖钢琴", lyrics: "多余的歌词",
  });
  assert.equal(finished.state, "complete");
  assert.equal(finished.versions[0].lyrics, undefined);
  assert.equal(finished.versions[0].review, null);
  assert.equal(lyricResultText(finished.versions[0]), "คืนฝัน、Echo 7\r\n温暖钢琴");
  assert.match(request.messages[0].content, /声音.*画面/);
  assert.equal(JSON.parse(request.messages[1].content).musician.language, "泰语");
  assert.deepEqual(service.ready(), []);
  assert.equal(service.list()[0].songType, "instrumental");
});

test("the lyrics TXT starts with both titles, then the style and lyrics", () => {
  assert.equal(lyricResultText({ title: "等灯", alternateTitle: "夜归", style: "民谣", lyrics: "窗灯等我\n已经秋天" }),
    "等灯、夜归\r\n民谣\r\n窗灯等我\r\n已经秋天");
});

test("generated titles must still be nonempty, distinct and within the limit after cleanup", t => {
  const { service, input, result } = setup(t);
  for (const [title, alternateTitle] of [
    ["《🎵！？》", "窗灯"],
    ["《Rain·Home》", "ＲＡＩＮ home✨"],
    ["夜".repeat(41), "听雨"],
  ]) {
    const id = randomUUID();
    service.start({ ...input, id });
    const request = service.claim(id);
    const job = service.record({ id, operationId: request.operationId, result: result(request, {
      title, alternateTitle, style: "民谣", language: "中文", lyrics: "窗灯等我",
    }) });
    assert.equal(job.state, "blocked");
    assert.equal(job.reason, "LYRIC_RESULT_INVALID");
    assert.deepEqual(job.versions, []);
  }
});

test("new and historical lyric results expose at most 1000 style characters", t => {
  const { repo, service, input, record } = setup(t);
  const atLimit = "风".repeat(999) + "🎵";
  const overflow = atLimit + "超出的风格描述";
  service.start(input);
  const request = service.claim(input.id);
  const result = record(request, { title: "等灯", alternateTitle: "夜归", style: overflow, language: "中文", lyrics: "窗灯等我" });
  assert.equal(result.phase, "score");
  assert.equal(result.versions[0].style, atLimit);
  const stored = repo.get("lyricJobs", input.id);
  assert.equal(stored.versions[0].style, atLimit);
  repo.save("lyricJobs", { ...stored, versions: [{ ...stored.versions[0], title: "《旧歌名》", style: overflow }] });
  const historical = service.read(input.id).versions[0];
  assert.equal(historical.title, "《旧歌名》");
  assert.equal(historical.style, atLimit);
  assert.equal(lyricResultText(historical).split("\r\n")[1], atLimit);
  assert.equal(repo.get("lyricJobs", input.id).versions[0].style, overflow);
});

test("generate, independently score, rewrite the same song, and suggest a separate prompt", t => {
  const { repo, service, input, record } = setup(t);
  const templateId = randomUUID();
  const artistId = randomUUID();
  repo.save("promptTemplates", { id: templateId, name: "原模板", revision: 1, content: "保留副歌气口的模板" });
  repo.save("accountLocalArtists", { id: artistId, name: "本地歌手", profile: { singer: "本地歌手", voicePersona: "细腻", contractMode: "exclusive" }, defaults: { genre: "民谣", language: "中文" }, promptTemplateId: templateId });
  service.start({ ...input, mode: "musician", artistId, inspiration: "" });
  const first = service.claim(input.id);
  assert.match(first.messages[1].content, /本地歌手/);
  assert.match(first.messages[1].content, /保留副歌气口的模板/);
  assert.doesNotMatch(first.messages[1].content, /contractMode/);
  const firstResult = record(first, {
    title: "《等·灯✨》", alternateTitle: "【夜归？！】", style: "民谣、木吉他", language: "中文",
    lyrics: "[主歌]\n窗灯等我回家，雨落下来。", creativeSummary: "用窗灯串起雨夜归家的段落。",
  });
  const [firstVersion] = firstResult.versions;
  assert.equal(firstVersion.title, "等灯");
  assert.equal(firstVersion.alternateTitle, "夜归");
  assert.equal(firstVersion.style, "民谣、木吉他");
  assert.equal(firstVersion.lyrics, "[主歌]\n窗灯等我回家，雨落下来。");
  assert.equal(firstVersion.creativeSummary, "用窗灯串起雨夜归家的段落。");
  assert.match(first.messages[0].content, /副歌.*短句/);
  assert.match(first.messages[0].content, /文字、数字和词间空格/);
  assert.match(first.messages[0].content, /lyrics, title, alternateTitle/);
  const score = service.claim(input.id);
  assert.match(score.messages[1].content, /窗灯等我回家/);
  assert.match(score.messages[1].content, /保留副歌气口的模板/);
  record(score, { revisionId: firstResult.versions[0].id, score: 88, languageMatches: true, findings: ["补足动作细节"] });
  const rewrite = service.claim(input.id);
  assert.match(rewrite.messages[1].content, /补足动作细节/);
  const revised = record(rewrite, { lyrics: "[主歌]\n收起雨伞听见门响" });
  const done = record(service.claim(input.id), { revisionId: revised.versions[1].id, score: 96, languageMatches: true, findings: ["画面清晰"] });
  assert.equal(done.state, "complete");
  assert.equal(done.rewrites, 1);
  assert.deepEqual(done.versions.map(({ title, alternateTitle }) => [title, alternateTitle]), [["等灯", "夜归"], ["等灯", "夜归"]]);
  service.suggest({ id: input.id, requestId: randomUUID(), consent: true });
  const prompt = record(service.claim(input.id), { prompt: "优先用具体动作刻画人物关系" });
  assert.equal(prompt.suggestedPrompt, "优先用具体动作刻画人物关系");
  assert.equal(repo.get("promptTemplates", templateId).content, "保留副歌气口的模板");
});

test("vocal lyrics default to a target of 90 and stop when they meet it", t => {
  const { service, input, record } = setup(t);
  for (const targetScore of [-1, 90.5, 101]) {
    assert.throws(() => service.start({ ...input, targetScore }));
  }
  const started = service.start(input);
  assert.equal(started.targetScore, 90);
  record(service.claim(input.id), { title: "等灯", alternateTitle: "夜归", style: "民谣", language: "中文", lyrics: "雨落在窗边" });
  const score = service.claim(input.id);
  const finished = record(score, { score: 90, languageMatches: true, findings: ["语句适合演唱"] });
  assert.equal(finished.state, "complete");
  assert.equal(finished.resultVersionId, finished.versions[0].id);
  assert.equal(finished.versions[0].review.revisionId, score.revisionId);
  assert.equal(finished.rewrites, 0);
  assert.deepEqual(service.ready(), []);
});

test("a complete rubric accepts integer strings and ignores extra commentary and redundant totals", t => {
  const { service, input, record } = setup(t);
  service.start(input);
  record(service.claim(input.id), { title: "等灯", alternateTitle: "夜归", style: "民谣", language: "中文", lyrics: "雨落在窗边" });
  const request = service.claim(input.id);
  const rubric = { styleFit: 18, narrative: 19, naturalness: 20, singability: 19, hook: 18 };
  const findings = ["副歌气口自然"];
  const outcome = record(request, {
    rubric: { ...rubric, naturalness: " 20 ", comment: "未经请求的分项说明" }, score: "94 分", languageMatches: true,
    findings, summary: "未经请求的总评",
  });
  assert.equal(outcome.state, "complete");
  assert.deepEqual(outcome.versions[0].review, { rubric, score: 94, revisionId: request.revisionId, languageMatches: true, findings });
});

for (const [issue, contents] of [
  ["json", () => "{broken"],
  ["score", valid => JSON.stringify({ ...valid, score: "96" })],
  ["languageMatches", valid => JSON.stringify({ ...valid, languageMatches: "true" })],
  ["findings", valid => JSON.stringify({ ...valid, findings: "词句流畅" })],
  ["rubric", valid => JSON.stringify({ ...valid, rubric: { styleFit: 19, narrative: 19, naturalness: 19, singability: 19, hook: "21" } })],
  ["revision", valid => JSON.stringify({ ...valid, revisionId: randomUUID() })],
]) test(`malformed reviews preserve the draft and diagnose ${issue}`, t => {
  const { service, input, record, result } = setup(t);
  service.start(input);
  const saved = record(service.claim(input.id), { title: "等灯", alternateTitle: "夜归", style: "民谣", language: "中文", lyrics: "雨落在窗边" });
  const request = service.claim(input.id);
  const valid = { score: 96, languageMatches: true, findings: ["词句流畅"] };
  const outcome = service.record({ id: input.id, operationId: request.operationId, result: { ...result(request, valid), content: contents(valid) } });
  assert.equal(outcome.state, "blocked");
  assert.equal(outcome.reason, "LYRIC_REVIEW_INVALID");
  assert.equal(outcome.reviewIssue, issue);
  assert.deepEqual(outcome.versions, saved.versions);
  assert.ok(outcome.spentMicros > saved.spentMicros);
  assert.equal(outcome.reservedMicros, 0);
  assert.deepEqual(service.ready(), []);
});

test("a review cannot attach to a revision other than the one claimed", t => {
  const { repo, service, input, record } = setup(t);
  service.start(input);
  const saved = record(service.claim(input.id), { title: "等灯", alternateTitle: "夜归", style: "民谣", language: "中文", lyrics: "雨落在窗边" });
  const request = service.claim(input.id);
  const dispatching = repo.get("lyricJobs", input.id);
  const replacement = { ...saved.versions[0], id: randomUUID(), lyrics: "另一份歌词" };
  repo.save("lyricJobs", { ...dispatching, versions: [...dispatching.versions, replacement] });
  const outcome = record(request, { score: 96, languageMatches: true, findings: ["词句流畅"] });
  assert.equal(outcome.state, "blocked");
  assert.equal(outcome.reviewIssue, "revision");
  assert.deepEqual(outcome.versions.at(-1), replacement);
});

test("an interrupted plan rewrite uses the remaining attempts and keeps the best verified draft", t => {
  const { repo, service, input, record, result } = setup(t);
  const artistId = randomUUID();
  repo.save("accountLocalArtists", { id: artistId, name: "歌手", defaults: { language: "中文" } });
  service.startForPlan({ ...input, artistId, maxRewrites: 2 }, randomUUID());
  const original = { title: "等灯", alternateTitle: "夜归", style: "民谣", language: "中文", lyrics: "雨落在窗边" };
  record(service.claim(input.id), original);
  const scored = record(service.claim(input.id), { score: 76, languageMatches: true, findings: ["保留副歌"] });
  const endRewrite = (request, finishReason, tokens) => service.record({ id: input.id, operationId: request.operationId, result: {
    ...result(request, null), status: "invalid", content: null, finishReason, reason: "TEXT_RESPONSE_METADATA_INVALID",
    usage: { promptTokens: 100, completionTokens: tokens, cachedTokens: 0 },
  } });
  const request = service.claim(input.id);
  const interrupted = endRewrite(request, "length", request.maxOutputTokens);
  assert.equal(interrupted.state, "ready");
  assert.equal(interrupted.phase, "rewrite");
  assert.equal(interrupted.rewrites, 1);
  assert.equal(interrupted.reservedMicros, 0);
  assert.deepEqual(interrupted.versions, scored.versions);
  assert.deepEqual(interrupted.textIssue, { phase: "rewrite", reason: "TEXT_OUTPUT_TRUNCATED", httpStatus: 200,
    finishReason: "length", hasReceipt: true, completionTokens: request.maxOutputTokens, maxOutputTokens: request.maxOutputTokens });

  const retry = service.claim(input.id);
  assert.equal(retry.phase, "rewrite");
  assert.equal(retry.revisionId, request.revisionId);
  assert.ok(retry.maxOutputTokens > request.maxOutputTokens);
  assert.notEqual(retry.operationId, request.operationId);
  assert.equal(JSON.parse(retry.messages[1].content).lyrics, original.lyrics);
  const final = endRewrite(retry, "insufficient_system_resource", 10);
  assert.equal(final.state, "complete");
  assert.equal(final.rewrites, 2);
  assert.equal(final.resultVersionId, request.revisionId);
  assert.equal(final.textIssue.reason, "TEXT_OUTPUT_INTERRUPTED");
  assert.ok(final.spentMicros > interrupted.spentMicros);
  assert.deepEqual(final.versions, scored.versions);
});

test("an unusable reply before the first verified draft has a single budgeted retry and keeps the same scoring target", t => {
  const { repo, service, input, record, result } = setup(t);
  const artistId = randomUUID();
  repo.save("accountLocalArtists", { id: artistId, name: "歌手" });
  service.startForPlan({ ...input, artistId }, randomUUID());
  const saved = record(service.claim(input.id), { title: "等灯", alternateTitle: "夜归", style: "民谣", language: "中文", lyrics: "雨落在窗边" });
  const blank = () => {
    const request = service.claim(input.id);
    assert.equal(request.phase, "score");
    assert.equal(request.revisionId, saved.versions[0].id);
    return service.record({ id: input.id, operationId: request.operationId, result: { ...result(request, null), content: " \n " } });
  };
  const retried = blank();
  assert.equal(retried.state, "ready");
  assert.equal(retried.textIssue.reason, "TEXT_CONTENT_INVALID");
  const blocked = blank();
  assert.equal(blocked.state, "blocked");
  assert.equal(blocked.reason, "TEXT_CONTENT_INVALID");
  assert.deepEqual(blocked.versions, saved.versions);
  assert.deepEqual(service.ready(), []);
});

test("the automatic response retry stops when the settled call leaves insufficient budget", t => {
  const { repo, service, input, result } = setup(t);
  const artistId = randomUUID();
  repo.save("accountLocalArtists", { id: artistId, name: "歌手" });
  service.startForPlan({ ...input, artistId, budgetMicros: 100 }, randomUUID());
  const request = service.claim(input.id);
  const outcome = service.record({ id: input.id, operationId: request.operationId, result: {
    ...result(request, null), status: "invalid", content: null, finishReason: "length", reason: "TEXT_RESPONSE_METADATA_INVALID",
    usage: { promptTokens: 9900 - request.maxOutputTokens, completionTokens: request.maxOutputTokens, cachedTokens: 0 },
  } });
  assert.equal(outcome.state, "blocked");
  assert.equal(outcome.reason, "TEXT_OUTPUT_TRUNCATED");
  assert.equal(outcome.spentMicros, 99);
  assert.equal(outcome.reservedMicros, 0);
  assert.deepEqual(service.ready(), []);
});

for (const reason of ["content_filter", null]) test(`a plan does not recover automatically from ${reason ?? "an unknown outcome"}`, t => {
  const { repo, service, input, record, result } = setup(t);
  const artistId = randomUUID();
  repo.save("accountLocalArtists", { id: artistId, name: "歌手" });
  service.startForPlan({ ...input, artistId }, randomUUID());
  record(service.claim(input.id), { title: "等灯", alternateTitle: "夜归", style: "民谣", language: "中文", lyrics: "雨落在窗边" });
  const scored = record(service.claim(input.id), { score: 76, languageMatches: true, findings: ["保留副歌"] });
  const request = service.claim(input.id);
  const response = result(request, null);
  const outcome = service.record({ id: input.id, operationId: request.operationId, result: reason
    ? { ...response, content: null, status: "invalid", finishReason: reason, reason: "TEXT_RESPONSE_METADATA_INVALID" }
    : { ...response, content: null, status: "unknown", finishReason: null, httpStatus: null, usage: null, reason: "TEXT_OUTCOME_UNKNOWN" } });
  assert.equal(outcome.state, reason ? "blocked" : "unknown");
  assert.equal(outcome.reason, reason ? "TEXT_CONTENT_FILTERED" : "TEXT_OUTCOME_UNKNOWN");
  assert.deepEqual(outcome.versions, scored.versions);
  assert.deepEqual(service.ready(), []);
});

for (const plan of [false, true]) test(`${plan ? "plan" : "standalone"} lyric reviews use the original brief and revise the best eligible draft`, async t => {
  const { repo, service, input } = setup(t);
  const artistId = randomUUID();
  const promptTemplateId = randomUUID();
  const template = "6080 国语苦情歌，保留短句副歌和自然气口";
  repo.save("promptTemplates", { id: promptTemplateId, name: "苦情歌", content: template });
  repo.save("accountLocalArtists", { id: artistId, name: "本地歌手", promptTemplateId, defaults: { language: "中文" } });
  const settings = { ...input, mode: "musician", artistId, inspiration: "", targetScore: 93, maxRewrites: 4 };
  if (plan) service.startForPlan(settings, randomUUID());
  else service.start(settings);

  const first = "我沿着灯影走到站台";
  const second = "我一路走到老车站，停了半天没说话";
  const third = "末班车进站时，我把车票攥皱";
  const initialStyle = "国语苦情民谣，慢板，副歌留出长尾音";
  const rubric = { styleFit: 18, narrative: 17, naturalness: 18, singability: 17, hook: 18 };
  const responses = [
    { title: "灯影", alternateTitle: "末班车进站", style: initialStyle, language: "中文", lyrics: first },
    { rubric, languageMatches: true, findings: ["加一个具体动作", "保留‘灯影’的开场画面"] },
    { lyrics: second, creativeSummary: "把‘灯影’换成长句" },
    { score: 99, rubric: { ...rubric, styleFit: 12, singability: 7 }, languageMatches: true, findings: ["长句的气口不自然"] },
    { lyrics: third },
    { score: 93, languageMatches: true, findings: ["语句自然，动作清楚"] },
  ];
  const messages = [];
  const adapter = new ProviderTextAdapter({ credential: async () => "offline-test-token", request: async outbound => {
    await outbound.assertDispatch();
    const message = JSON.parse(outbound.body.messages[1].content);
    const content = responses[messages.push(message) - 1];
    return { status: 200, body: { id: `fixture-${messages.length}`, model: "mock-model",
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }],
      usage: { prompt_tokens: 50, completion_tokens: 40, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 50 } } };
  } });
  const revisions = [];
  for (let index = 0; index < responses.length; index++) {
    assert.equal(service.ready()[0]?.id, input.id);
    const request = service.claim(input.id);
    revisions.push(request.revisionId);
    if (request.phase === "score") assert.match(request.messages[0].content, /资深作词人.*首稿/);
    const received = await adapter.invoke(request);
    assert.notEqual(received.content, null);
    service.record({ id: request.jobId, operationId: request.operationId, result: received });
    if (index === 2) {
      // A saved rewrite may carry a different style. Review against the first draft anyway.
      const saved = repo.get("lyricJobs", input.id);
      repo.save("lyricJobs", { ...saved, versions: [saved.versions[0], { ...saved.versions[1], style: "快板流行舞曲" }] });
    }
  }

  const finished = service.read(input.id);
  const [initial, revised, final] = finished.versions;
  assert.deepEqual(revisions, [null, initial.id, initial.id, revised.id, initial.id, final.id]);
  assert.deepEqual(messages.slice(1).map(({ lyrics, revisionId, previousScore, targetScore, findings }) =>
    ({ lyrics, revisionId, previousScore, targetScore, findings })), [
    { lyrics: first, revisionId: undefined, previousScore: undefined, targetScore: undefined, findings: undefined },
    { lyrics: first, revisionId: undefined, previousScore: 88, targetScore: 93, findings: responses[1].findings },
    { lyrics: second, revisionId: undefined, previousScore: undefined, targetScore: undefined, findings: undefined },
    { lyrics: first, revisionId: undefined, previousScore: 88, targetScore: 93, findings: responses[1].findings },
    { lyrics: third, revisionId: undefined, previousScore: undefined, targetScore: undefined, findings: undefined },
  ]);
  for (const message of messages.slice(1)) {
    assert.equal(message.style, initialStyle);
    assert.equal(message.creativeBrief.promptTemplate, template);
    assert.equal(message.creativeBrief.musician.language, "中文");
  }
  assert.deepEqual(initial.review.rubric, rubric);
  assert.equal(initial.review.score, 88);
  assert.equal(revised.review.score, 72);
  assert.deepEqual(messages[4].discardedRevision, { score: 72, languageMatches: true,
    findings: responses[3].findings, creativeSummary: responses[2].creativeSummary });
  assert.equal(messages[2].languageMatches, true);
  assert.equal(messages[4].languageMatches, true);
  assert.equal(finished.state, "complete");
  assert.equal(finished.rewrites, 2);
  assert.equal(finished.resultVersionId, final.id);
  assert.deepEqual(service.ready(), []);
  assert.throws(() => service.claim(input.id), /LYRIC_STATE_NOT_READY/);
});

test("an earlier identical lyric becomes the current draft with its original review after reload", t => {
  const { repo, service, input, record } = setup(t);
  const first = "雨落在窗边";
  const second = "雨里有人叩响窗";
  const third = "我收好雨伞，听见你敲了两下窗";
  service.start({ ...input, targetScore: 93, maxRewrites: 3 });
  record(service.claim(input.id), { title: "等灯", alternateTitle: "夜归", style: "民谣", language: "中文", lyrics: first });
  const score = (value, finding) => {
    const request = service.claim(input.id);
    return record(request, { revisionId: request.revisionId, score: value, languageMatches: true, findings: [finding] });
  };
  const initial = score(91, "明确等待的人物").versions[0];
  record(service.claim(input.id), { lyrics: second });
  const revised = score(84, "调整叙事顺序").versions[1];
  assert.equal(lyricResultVersion(service.read(input.id)).id, revised.id);
  const repeated = record(service.claim(input.id), { lyrics: first });
  assert.equal(repeated.phase, "rewrite");
  assert.equal(repeated.rewrites, 2);
  assert.deepEqual(repeated.versions.map(version => version.id), [initial.id, revised.id]);

  const reopened = new LyricWritingService(repo);
  assert.equal(lyricResultVersion(reopened.read(input.id)).id, initial.id);
  const restartsFrom = reopened.claim(input.id);
  assert.equal(restartsFrom.revisionId, initial.id);
  const request = JSON.parse(restartsFrom.messages[1].content);
  assert.equal(request.lyrics, first);
  assert.equal(request.previousScore, initial.review.score);
  assert.deepEqual(request.findings, initial.review.findings);
  const changed = record(restartsFrom, { lyrics: third });
  assert.equal(lyricResultVersion(changed).lyrics, third);
  assert.equal(changed.versions.at(-1).rewriteNumber, 3);
  const finished = score(90, "最后一句还能润色");
  assert.equal(finished.state, "complete");
  assert.equal(finished.rewrites, 3);
  assert.equal(finished.resultVersionId, initial.id);
  assert.deepEqual(service.ready(), []);
});

test("custom lyric targets keep the highest score when valid rewrites run out", t => {
  const { service, input, record } = setup(t);
  const original = "雨落在窗边";
  service.start({ ...input, targetScore: 93, maxRewrites: 2 });
  record(service.claim(input.id), { title: "等灯", alternateTitle: "夜归", style: "民谣", language: "中文", lyrics: original });
  const score = value => {
    const request = service.claim(input.id);
    return record(request, { revisionId: request.revisionId, score: value, languageMatches: true, findings: ["继续调整断句"] });
  };
  assert.equal(score(91).phase, "rewrite");
  const rewrite = service.claim(input.id);
  assert.equal(JSON.parse(rewrite.messages[1].content).targetScore, 93);
  const repeated = record(rewrite, { lyrics: original });
  assert.equal(repeated.phase, "rewrite");
  assert.equal(repeated.rewrites, 1);
  assert.equal(repeated.versions.length, 1);
  record(service.claim(input.id), { lyrics: "雨里有人叩响窗" });
  const finished = score(84);
  assert.equal(finished.state, "complete");
  assert.equal(finished.rewrites, 2);
  assert.equal(finished.resultVersionId, finished.versions[0].id);
  assert.equal(service.read(input.id).targetScore, 93);
  assert.deepEqual(service.ready(), []);
  service.suggest({ id: input.id, requestId: randomUUID(), consent: true });
  const suggested = record(service.claim(input.id), { prompt: "把动作放在句尾" });
  assert.equal(suggested.state, "complete");
  assert.equal(suggested.resultVersionId, finished.resultVersionId);
});

test("budget, model revision and interrupted dispatch prevent unapproved retries", t => {
  const { repo, service, input } = setup(t);
  service.start({ ...input, budgetMicros: 1 });
  assert.throws(() => service.claim(input.id), /TEXT_BUDGET_INSUFFICIENT/);
  assert.equal(service.read(input.id).state, "blocked");
  const profileKey = `api-profile:${input.profileId}`;
  const profile = repo.get("settings", profileKey);
  const changed = { ...input, id: randomUUID() };
  service.start(changed);
  repo.save("settings", { ...profile, revision: 2 });
  assert.throws(() => service.claim(changed.id), /TEXT_PROFILE_REVISION_CHANGED/);
  assert.equal(service.read(changed.id).state, "blocked");
  repo.save("settings", profile);
  const next = { ...input, id: randomUUID() };
  service.start(next);
  service.claim(next.id);
  const reopened = new LyricWritingService(repo);
  assert.equal(reopened.read(next.id).state, "unknown");
  assert.notEqual(reopened.read(next.id).reservedMicros, 0);
  assert.throws(() => reopened.claim(next.id), /LYRIC_STATE_NOT_READY/);
});

test("the existing text adapter runs the inspiration flow and stops after ten rewrites", async t => {
  const { service, input } = setup(t);
  assert.throws(() => service.start({ ...input, consent: false }));
  assert.equal(service.list().length, 0);
  service.start(input);
  assert.equal(service.start(input).id, input.id);
  const calls = [];
  const adapter = new ProviderTextAdapter({ credential: async () => "offline-test-token", request: async outbound => {
    await outbound.assertDispatch();
    assert.equal(outbound.url, "https://api.deepseek.com/chat/completions");
    const user = JSON.parse(outbound.body.messages[1].content);
    const index = calls.push(user);
    let output;
    if (index === 1) {
      assert.equal(user.inspiration, "雨夜回家");
      assert.equal(user.musician, null);
      output = { title: "窗灯", alternateTitle: "伞边", style: "民谣", language: "中文", lyrics: "雨落在窗边" };
    } else if (Object.hasOwn(user, "previousScore")) {
      output = { lyrics: `第${index}版雨夜歌词` };
    } else {
      output = { score: 97, languageMatches: false, findings: ["请按目标语言修改"] };
    }
    return { status: 200, body: { id: `fixture-${index}`, model: "mock-model", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output) } }],
      usage: { prompt_tokens: 50, completion_tokens: 40, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 50 } } };
  } });
  const broker = createProviderTextBroker({ queue: "lyricWriting", available: () => true,
    credentials: { apiCredentialStatus: async () => ({ configured: true }), withProviderTextAdapter: async (_scope, run) => run(adapter) },
    rpc: async (method, value) => {
      assert.match(method, /^internal\.lyricWriting\./);
      try {
        const handlers = { list: () => service.ready(), claim: () => ({ request: service.claim(value.id) }),
          context: () => service.context(value.id), record: () => service.record(value), note: () => service.note(value.id, value.reason) };
        return { ok: true, value: handlers[method.split(".").at(-1)]() };
      } catch (error) { return { ok: false, error: { code: error.message } }; }
    },
  });
  for (let index = 0; index < 23; index++) await broker.pump();
  const job = service.read(input.id);
  assert.equal(calls.length, 22);
  assert.equal(job.rewrites, 10);
  assert.equal(job.state, "complete");
  assert.equal(job.versions.length, 11);
  assert.ok(job.versions.every(version => version.review.score === 97 && !version.review.languageMatches));
  assert.equal(job.resultVersionId, job.versions[10].id);
});

test("lyrics follow the configured text API using its model, price and saved credential", async t => {
  const { repo, service, input } = setup(t);
  assert.throws(() => service.start({ ...input, followDefault: true }), /LYRIC_DEFAULT_PROFILE_CHANGED/);
  saveGenerationConfig(repo, { role: "text", profileId: input.profileId, expectedRevision: 0 });
  const original = service.start({ ...input, followDefault: true });

  const profileId = randomUUID();
  const modelId = "doubao-seed-2-1-pro-260915";
  repo.save("settings", { id: `api-profile:${profileId}`, kind: "text", providerId: "doubao", label: "新默认豆包", modelId,
    revision: 1, executionEnabled: false, textPricing: { currency: "CNY", modelId, inputMicrosPerMillionTokens: 10_000,
      outputMicrosPerMillionTokens: 20_000, source: "fixture", version: "fixture", responseModelIds: [modelId] } });
  saveGenerationConfig(repo, { role: "text", profileId, expectedRevision: 1 });
  assert.equal(service.start({ ...input, followDefault: true }).id, original.id);
  assert.throws(() => service.start({ ...input, id: randomUUID(), followDefault: true }), /LYRIC_DEFAULT_PROFILE_CHANGED/);
  assert.equal(service.claim(original.id).providerId, "deepseek");

  const next = service.start({ ...input, id: randomUUID(), profileId, followDefault: true });
  const credentials = new Map();
  const calls = [];
  const serviceCredentials = new ApiCredentials({
    vault: { isAvailable: () => true, has: binding => credentials.has(binding.accountId),
      put: (binding, secret) => credentials.set(binding.accountId, secret), get: binding => credentials.get(binding.accountId) },
    getProfile: async id => ({ ...repo.get("settings", `api-profile:${id}`), id }),
    context: () => ({ mode: "production", generation: 1 }),
    textRequest: async request => {
      calls.push(request);
      return { status: 200, body: { id: "fixture-reply", model: modelId, choices: [{ finish_reason: "stop", message: { content:
        JSON.stringify({ title: "归人", alternateTitle: "听雨", style: "民谣", language: "中文", lyrics: "把雨伞放在门边" }) } }],
        usage: { prompt_tokens: 100, completion_tokens: 200, prompt_tokens_details: { cached_tokens: 0 } } } };
    },
  });
  await serviceCredentials.writeApiCredential({ profileId, expectedRevision: 1, secret: "fixture-doubao-key" });
  assert.equal(calls.length, 0);
  assert.equal(next.currency, "CNY");
  const request = service.claim(next.id);
  await serviceCredentials.withProviderTextAdapter({ profileId, expectedRevision: request.profileRevision }, async adapter => {
    const result = await adapter.invoke(request);
    service.record({ id: next.id, operationId: request.operationId, result });
  });
  assert.equal(calls[0].url, "https://ark.cn-beijing.volces.com/api/v3/chat/completions");
  assert.equal(calls[0].headers.Authorization, "Bearer fixture-doubao-key");
  assert.equal(calls[0].body.model, modelId);
  assert.equal(service.read(next.id).spentMicros, 5);
  assert.doesNotMatch(JSON.stringify(service.read(next.id)), /fixture-doubao-key/);
});
