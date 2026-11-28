import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";
import { compileFunction } from "node:vm";
import { build } from "esbuild";

const { outputFiles } = await build({
  stdin: { contents: `export { Repository } from './src/core/database';
    export { LyricWritingService } from './src/core/lyric-writing';`, resolveDir: process.cwd() },
  bundle: true, platform: "node", packages: "external", format: "cjs", write: false,
});
const compiled = { exports: {} };
compileFunction(outputFiles[0].text, ["module", "exports", "require", "__dirname"])(
  compiled, compiled.exports, createRequire(import.meta.url), process.cwd(),
);
const { Repository, LyricWritingService } = compiled.exports;
const craftRule = /歌词创作准则 v1/u;
const draft = { title: "留灯", alternateTitle: "归途", style: "粤语民谣", language: "粤语", lyrics: "门边留着一盏灯" };
const review = { rubric: { styleFit: 16, narrative: 16, naturalness: 16, singability: 16, hook: 16 },
  languageMatches: true, findings: ["保留门边的灯，补充人物的动作"] };

function setup(t) {
  const repo = new Repository(":memory:");
  t.after(() => repo.close());
  const profileId = randomUUID(), artistId = randomUUID();
  repo.save("settings", { id: `api-profile:${profileId}`, kind: "text", providerId: "deepseek", label: "隔离用例",
    modelId: "mock-model", revision: 1, executionEnabled: false,
    textPricing: { currency: "USD", modelId: "mock-model", inputMicrosPerMillionTokens: 1_000_000,
      outputMicrosPerMillionTokens: 1_000_000, source: "fixture", version: "fixture", responseModelIds: ["mock-model"] } });
  repo.save("accountLocalArtists", { id: artistId, name: "隔离艺人", revision: 1, defaults: { language: "粤语", genre: "民谣" } });
  const input = { id: randomUUID(), profileId, profileRevision: 1, mode: "musician", inspiration: "",
    artistId, templateId: null, maxRewrites: 2, consent: true };
  const service = new LyricWritingService(repo, () => new Date("2026-11-28T08:00:00Z"));
  function record(request, data, overrides = {}) {
    return service.record({ id: request.jobId, operationId: request.operationId, result: {
      operationId: request.operationId, providerId: request.providerId, requestedModelId: request.modelId,
      providerRequestId: "fixture", providerModel: request.modelId, finishReason: "stop", httpStatus: 200,
      usage: { promptTokens: 100, completionTokens: 100, cachedTokens: 0 }, content: JSON.stringify(data),
      status: "complete", reason: null, ...overrides,
    } });
  }
  return { repo, input, service, record };
}

test("new vocal jobs persist private craft rules across generate, score, rewrite and reload, but not prompt suggestions", t => {
  const { repo, input, service, record } = setup(t);
  const started = service.start(input);
  assert.equal(repo.get("lyricJobs", input.id).lyricCraftVersion, 1);
  for (const visible of [started, service.read(input.id), service.list()[0], service.context(input.id).job]) {
    assert.equal(Object.hasOwn(visible, "lyricCraftVersion"), false);
  }
  const generate = new LyricWritingService(repo).claim(input.id);
  assert.match(generate.messages[0].content, craftRule);
  assert.match(generate.messages[0].content, /DJ.*完整唱段/u);
  assert.match(generate.messages[0].content, /粤语.*助词/u);
  record(generate, draft);
  const score = service.claim(input.id);
  assert.match(score.messages[0].content, craftRule);
  assert.match(score.messages[0].content, /hook.*全曲记忆点/u);
  assert.match(score.messages[0].content, /narrative.*循环/u);
  assert.match(score.messages[0].content, /原句.*问题.*影响.*修订方向/u);
  record(score, review);
  const rewrite = service.claim(input.id);
  assert.match(rewrite.messages[0].content, craftRule);
  assert.match(rewrite.messages[0].content, /弱句/u);
  record(rewrite, { lyrics: "你收起伞，把灯留在门边" });
  const done = record(service.claim(input.id), { ...review, rubric: undefined, score: 95 });
  assert.equal(done.state, "complete");
  assert.equal(done.rewrites, 1);
  assert.equal(done.versions.length, 2);
  assert.equal(Object.hasOwn(done, "lyricCraftVersion"), false);
  service.suggest({ id: input.id, requestId: randomUUID(), consent: true });
  assert.doesNotMatch(service.claim(input.id).messages[0].content, craftRule);
});

for (const kind of ["instrumental", "inspiration"]) test(`${kind} jobs never receive lyric craft rules, even with a stored marker`, t => {
  const { repo, input, service, record } = setup(t);
  let table = "lyricJobs";
  if (kind === "instrumental") {
    repo.save("accountLocalArtists", { id: input.artistId, name: "器乐艺人", defaults: { voice: "instrumental" } });
    service.start(input);
  } else {
    table = "inspirationJobs";
    const accountId = randomUUID();
    repo.save("accounts", { id: accountId, provider: "fanqie" });
    repo.save("accountLocalArtists", { ...repo.get("accountLocalArtists", input.artistId), accountId });
    service.startInspiration({ id: input.id, profileId: input.profileId, profileRevision: 1,
      platform: "fanqie", accountId, artistId: input.artistId, artistRevision: 1, consent: true });
  }
  const stored = repo.get(table, input.id);
  assert.equal(stored.lyricCraftVersion, undefined);
  repo.save(table, { ...stored, lyricCraftVersion: 1 });
  const generate = service.claim(input.id);
  assert.doesNotMatch(generate.messages[0].content, craftRule);
  const outcome = record(generate, kind === "instrumental"
    ? { title: "留灯", alternateTitle: "归途", style: "助眠纯音乐" }
    : { title: "留灯", alternateTitle: "归途", inspiration: "雨夜归家的场景" });
  if (kind === "instrumental") assert.equal(outcome.state, "complete");
  else assert.doesNotMatch(service.claim(input.id).messages[0].content, craftRule);
});

test("idempotent start and stored legacy stages never backfill craft rules", t => {
  const { repo, input, service, record } = setup(t);
  service.start(input);
  const stored = repo.get("lyricJobs", input.id);
  delete stored.lyricCraftVersion;
  repo.save("lyricJobs", stored);
  assert.deepEqual(service.start(input), service.read(input.id));
  assert.equal(repo.get("lyricJobs", input.id).lyricCraftVersion, undefined);
  const generate = service.claim(input.id);
  assert.doesNotMatch(generate.messages[0].content, craftRule);
  record(generate, draft);
  const score = service.claim(input.id);
  assert.doesNotMatch(score.messages[0].content, craftRule);
  record(score, review);
  assert.doesNotMatch(service.claim(input.id).messages[0].content, craftRule);
});

function blockedSource(fixture, version, phase) {
  const { repo, service, input, record } = fixture;
  const attemptId = randomUUID();
  service.startForPlan(input, attemptId);
  if (phase !== "generate") record(service.claim(input.id), draft);
  if (phase === "rewrite") record(service.claim(input.id), review);
  const stored = repo.get("lyricJobs", input.id);
  const source = { ...stored, state: "blocked", reason: "TEXT_CONTENT_INVALID", reservedMicros: 0, lyricCraftVersion: version };
  repo.save("lyricJobs", source);
  return { source, retrySource: { jobId: input.id, attemptId } };
}

for (const version of [undefined, 1]) for (const phase of ["generate", "score", "rewrite"]) {
  test(`blocked ${phase} retry inherits ${version ?? "legacy"} rules before estimation`, t => {
    const fixture = setup(t);
    const { repo, service, input } = fixture;
    const { retrySource } = blockedSource(fixture, version, phase);
    const id = randomUUID();
    const retried = service.startForPlan({ ...input, id }, randomUUID(), retrySource);
    assert.equal(retried.phase, phase);
    assert.equal(repo.get("lyricJobs", id).lyricCraftVersion, version);
    assert.equal(Object.hasOwn(retried, "lyricCraftVersion"), false);
    const request = service.claim(id);
    assert.equal(craftRule.test(request.messages[0].content), version === 1);
  });
}

for (const version of [undefined, 1]) test(`completed rejected-draft retry also inherits ${version ?? "legacy"} rules`, t => {
  const fixture = setup(t);
  const { repo, input, service } = fixture;
  const { source, retrySource } = blockedSource(fixture, version, "rewrite");
  repo.save("lyricJobs", { ...source, state: "rejected", rewrites: source.maxRewrites });
  const id = randomUUID();
  const retried = service.startForPlan({ ...input, id }, randomUUID(), retrySource);
  assert.equal(retried.state, "complete");
  assert.equal(repo.get("lyricJobs", id).lyricCraftVersion, version);
  assert.equal(Object.hasOwn(retried, "lyricCraftVersion"), false);
  assert.throws(() => service.claim(id), /LYRIC_STATE_NOT_READY/u);
});

for (const phase of ["generate", "score", "rewrite"]) test(`${phase} automatic budgets retain legacy bounds and add each future rule exactly once`, t => {
  const fixture = setup(t);
  const { repo, service, input } = fixture;
  const { source, retrySource } = blockedSource(fixture, undefined, phase);
  const legacyId = randomUUID();
  const legacy = service.startForPlan({ ...input, id: legacyId }, randomUUID(), retrySource);
  const legacyRequest = service.claim(legacyId);
  repo.save("lyricJobs", { ...source, lyricCraftVersion: 1 });
  const modernId = randomUUID();
  const modern = service.startForPlan({ ...input, id: modernId }, randomUUID(), retrySource);
  const modernRequest = service.claim(modernId);
  assert.notEqual(modern.budgetMicros, legacy.budgetMicros);
  if (phase === "generate") {
    const fresh = service.startForPlan({ ...input, id: randomUUID() }, randomUUID());
    assert.equal(fresh.budgetMicros, modern.budgetMicros, "new jobs must select their rule version before initial estimation");
  }

  // Obtain each added system fragment from actual outgoing messages, independently of the budget helper.
  const fragments = {};
  for (const nextPhase of ["score", "rewrite"]) {
    const id = randomUUID();
    const versionId = randomUUID();
    const baseline = { ...source, id, state: "ready", phase: nextPhase, budgetMicros: 1_000_000_000,
      versions: [{ ...draft, id: versionId, review: { ...review, revisionId: versionId, score: 80 } }], lyricCraftVersion: undefined };
    repo.save("lyricJobs", baseline);
    const oldRequest = service.claim(id);
    repo.save("lyricJobs", { ...baseline, lyricCraftVersion: 1 });
    const newRequest = service.claim(id);
    fragments[nextPhase] = Buffer.byteLength(JSON.stringify(newRequest.messages), "utf8") - Buffer.byteLength(JSON.stringify(oldRequest.messages), "utf8");
    assert.ok(fragments[nextPhase] > 0);
  }
  const brief = { inspiration: source.inspiration, musician: source.musician, promptTemplate: source.template };
  const scoreBase = 177792 + Buffer.byteLength(JSON.stringify(JSON.stringify(brief)), "utf8");
  const rewriteBase = scoreBase + 204000;
  const laterScores = 2 + (phase === "generate" ? 1 : 0);
  const laterRewrites = 2 - (phase === "rewrite" ? 1 : 0);
  const currentCost = request => Buffer.byteLength(JSON.stringify(request.messages), "utf8") + 1024 + request.maxOutputTokens;
  assert.equal(legacy.budgetMicros, currentCost(legacyRequest) + laterScores * (scoreBase + 2048) + laterRewrites * (rewriteBase + 4096));
  assert.equal(modern.budgetMicros, currentCost(modernRequest)
    + laterScores * (scoreBase + fragments.score + 2048)
    + laterRewrites * (rewriteBase + fragments.rewrite + 4096));
});

test("budget rejection and stop preserve the persisted craft version without dispatching another request", t => {
  const { repo, input, service } = setup(t);
  service.start({ ...input, budgetMicros: 1 });
  assert.throws(() => service.claim(input.id), /TEXT_BUDGET_INSUFFICIENT/u);
  assert.equal(service.read(input.id).state, "blocked");
  assert.equal(repo.get("lyricJobs", input.id).lyricCraftVersion, 1);
  const id = randomUUID();
  service.start({ ...input, id });
  assert.equal(service.stop(id).state, "stopped");
  assert.equal(repo.get("lyricJobs", id).lyricCraftVersion, 1);
  assert.throws(() => service.claim(id), /LYRIC_STATE_NOT_READY/u);
});
