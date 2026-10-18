import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import path from "node:path";
const require = createRequire(import.meta.url),
  w = require(process.env.RAINFALL_PRODUCTION_FLOW_BUNDLE);
const { draft } = require("./fixtures/workflow.cjs");
const sha = "a".repeat(64),
  termsHash = "b".repeat(64);

test("Beijing 09:00 fires at 01:00 UTC and never repeats at 09:00 UTC", (t) => {
  const x = setup(t);
  x.now("2026-10-17T00:59:50Z");
  const p = x.service.savePlan({
    plan: { ...x.plan, timezone: "Asia/Shanghai", localTime: "09:00" },
    expectedRevision: null,
  });
  x.service.enable({ id: p.id, expectedRevision: p.revision });
  x.now("2026-10-17T01:00:10Z");
  x.service.tick();
  let rows = x.service.list();
  assert.equal(rows.runs.length, 1);
  assert.equal(rows.runs[0].budgetDate, "2026-10-17");
  assert.equal(rows.occurrences[0].intendedAt, "2026-10-17T01:00:00.000Z");
  x.service.tick();
  x.now("2026-10-17T09:00:10Z");
  x.service.tick();
  assert.equal(x.service.list().runs.length, 1);
});

test("Beijing local dates govern the run cap across UTC midnight and random trigger identities", (t) => {
  const x = setup(t);
  x.now("2026-10-16T23:59:50Z");
  const p = x.service.savePlan({
    plan: { ...x.plan, timezone: "Asia/Shanghai", localTime: "09:00" },
    expectedRevision: null,
  });
  const first = x.service.trigger({ planId: p.id, requestId: randomUUID() });
  assert.equal(first.budgetDate, "2026-10-17");
  x.service.enable({ id: p.id, expectedRevision: p.revision });
  x.now("2026-10-17T00:59:50Z");
  x.service.tick();
  x.now("2026-10-17T01:00:10Z");
  x.service.tick();
  for (let n = 0; n < 5; n++)
    assert.throws(
      () => x.service.trigger({ planId: p.id, requestId: randomUUID() }),
      /DAILY_RUN_LIMIT/,
    );
  assert.equal(x.service.list().runs.length, 1);
  assert.ok(
    x.service.list().occurrences.some((o) => o.reason === "DAILY_RUN_LIMIT"),
  );
  x.now("2026-10-17T16:00:10Z");
  const second = x.service.trigger({ planId: p.id, requestId: randomUUID() });
  assert.equal(second.budgetDate, "2026-10-18");
  assert.notEqual(second.id, first.id);
});

test("restart preserves Beijing due occurrences and same-day trigger idempotency", (t) => {
  const x = setup(t);
  x.now("2026-10-17T00:59:50Z");
  const p = x.service.savePlan({
    plan: { ...x.plan, timezone: "Asia/Shanghai", localTime: "09:00" },
    expectedRevision: null,
  });
  x.service.enable({ id: p.id, expectedRevision: p.revision });
  let service = new w.ProductionFlowService(x.repo, x.options);
  x.now("2026-10-17T01:00:10Z");
  service.tick();
  const first = service.list().runs[0];
  service = new w.ProductionFlowService(x.repo, x.options);
  service.tick();
  x.now("2026-10-17T01:00:40Z");
  service.tick();
  assert.equal(service.list().runs.length, 1);
  assert.equal(service.list().occurrences.length, 1);
  assert.equal(
    service.trigger({ planId: p.id, requestId: first.requestId }).id,
    first.id,
  );
  for (let n = 0; n < 5; n++)
    assert.throws(
      () => service.trigger({ planId: p.id, requestId: randomUUID() }),
      /DAILY_RUN_LIMIT/,
    );
});
function setup(t, changes = {}) {
  assert.equal(typeof w.ProductionFlowService, "function");
  const repo = new w.Repository(
    path.resolve(
      "output/test-runs",
      "production-flow-" + randomUUID(),
      "library.sqlite",
    ),
  );
  t.after(() => repo.close());
  const artistId = randomUUID(),
    textProfileId = randomUUID(),
    musicProfileId = randomUUID(),
    accountId = randomUUID();
  repo.save("artists", {
    id: artistId,
    name: "Local author",
    revision: 1,
    defaults: { language: "Chinese", genre: "acoustic pop" },
  });
  for (const [id, kind, providerId] of [
    [textProfileId, "text", "deepseek"],
    [musicProfileId, "music", "yourmusic"],
  ])
    repo.save("settings", {
      id: "api-profile:" + id,
      kind,
      providerId,
      label: "Offline profile",
      modelId: null,
      executionEnabled: false,
      revision: 1,
    });
  let now = new Date("2026-10-15T08:59:50Z"),
    works = 0;
  const options = {
    now: () => now,
    createWork: (run, candidate) => {
      works++;
      const workId = randomUUID();
      repo.save("works", {
        id: workId,
        artistId,
        title: candidate.draft.title,
        lyrics: candidate.pair.lyrics,
        source: candidate.source,
      });
      return { workId };
    },
    verifyMusicPricing: () => true,
    publicationAuthority: () => ({
      allowed: true,
      termsHash,
      evidenceId: "saved-authority",
    }),
    ...changes,
  };
  const service = new w.ProductionFlowService(repo, options);
  const plan = {
    id: randomUUID(),
    artistId,
    title: "Local song",
    theme: "quiet homecoming",
    timezone: "Etc/UTC",
    localTime: "09:00",
    candidateMode: "local_template",
    scoreMode: "rule_based",
    text: null,
    music: null,
    publication: null,
    autoContinue: false,
    threshold: 75,
    maxRevisions: 2,
    maxScoreRetries: 2,
    maxRunsPerDay: 1,
    template: null,
  };
  const text = {
    profileId: textProfileId,
    profileRevision: 1,
    modelId: "deepseek-flash",
    maxOutputTokens: 2048,
    budgetMicros: 100000,
    consent: true,
  };
  const music = {
    profileId: musicProfileId,
    profileRevision: 1,
    modelId: "chirp-v6",
    maxCostPerRequestCredits: 2,
    budgetCredits: 2,
    pricingEvidence: "offline-verified-quote",
    consent: true,
  };
  const publication = { target: "tme", accountId, termsHash };
  return {
    repo,
    service,
    plan,
    text,
    music,
    publication,
    options,
    works: () => works,
    now: (value) => (now = new Date(value)),
  };
}
function start(x, patch = {}) {
  const p = x.service.savePlan({
    plan: { ...x.plan, ...patch },
    expectedRevision: null,
  });
  return {
    p,
    run: x.service.trigger({ planId: p.id, requestId: randomUUID() }),
  };
}
function approveCandidate(x, run) {
  return x.service.approve({
    id: run.id,
    stage: "candidate",
    expectedRevision: x.service.context(run.id).run.revision,
    consent: true,
  });
}
function claimNext(x, id) {
  const n = x.service.next({ id });
  assert.ok(n.task);
  return x.service.claim({ id, expectedRevision: n.run.revision });
}
function finishMaterials(x, id) {
  const run = x.service.context(id).run,
    work = x.repo.get("works", run.workId),
    coverId = randomUUID(),
    versionId = randomUUID(),
    plainHash = w.hash(w.cleanLyricText(work.lyrics).cleaned);
  x.repo.save("assets", { id: coverId, kind: "image", sha256: "c".repeat(64) });
  x.repo.save("settings", {
    id: "lyrics-version:" + versionId,
    kind: "lyrics-version",
    version: { id: versionId, workId: work.id, rawHash: w.hash(work.lyrics) },
  });
  x.repo.save("works", {
    ...work,
    assets: { ...work.assets, cover: coverId },
    lyricsVersionId: versionId,
    lyricsConfirmation: {
      versionId,
      plainHash,
      audioHash: x.repo.get("assets", work.assets.audio_A).sha256,
    },
    rightsConfirmed: true,
  });
}

test("default production schedule really creates a local candidate, stops for review and deduplicates the day", (t) => {
  const x = setup(t),
    p = x.service.savePlan({ plan: x.plan, expectedRevision: null });
  x.service.enable({ id: p.id, expectedRevision: p.revision });
  x.now("2026-10-15T09:00:10Z");
  x.service.tick();
  const rows = x.service.list();
  assert.equal(rows.runs.length, 1);
  const r = rows.runs[0];
  assert.equal(r.stage, "candidate");
  assert.equal(r.state, "awaiting_approval");
  assert.equal(r.candidate.source, "local_template");
  assert.equal(r.candidate.method, "rule_based");
  assert.equal(x.repo.all("operations").length, 0);
  assert.equal(x.works(), 0);
  x.service.tick();
  assert.equal(x.service.list().runs.length, 1);
  assert.throws(
    () => x.service.trigger({ planId: p.id, requestId: randomUUID() }),
    /DAILY_RUN_LIMIT/,
  );
});

test("sleep gaps skip rather than backfill and one failed run cannot block another plan", (t) => {
  const x = setup(t, {
    createWork: () => {
      throw Error("offline failure");
    },
  });
  let p = x.service.savePlan({
    plan: { ...x.plan, autoContinue: true },
    expectedRevision: null,
  });
  x.service.enable({ id: p.id, expectedRevision: p.revision });
  x.now("2026-10-15T10:00:00Z");
  x.service.tick();
  assert.equal(x.service.list().runs.length, 0);
  assert.ok(
    x.service.list().occurrences.some((o) => o.reason === "SLEEP_GAP_SKIP"),
  );
  const other = x.service.savePlan({
    plan: { ...x.plan, id: randomUUID() },
    expectedRevision: null,
  });
  x.service.enable({ id: other.id, expectedRevision: other.revision });
  x.now("2026-10-16T08:59:50Z");
  x.service.tick();
  const bad = x.service.trigger({ planId: p.id, requestId: randomUUID() });
  x.service.next({ id: bad.id });
  approveCandidate(x, bad);
  x.now("2026-10-16T09:00:10Z");
  x.service.tick();
  const runs = x.service.list().runs;
  assert.equal(runs.length, 2);
  assert.ok(runs.some((r) => r.state === "failed"));
  assert.ok(runs.some((r) => r.state === "awaiting_approval"));
});

test("candidate approval advances through rule based score into a real work and blocks unpaid music", (t) => {
  const x = setup(t),
    { run } = start(x);
  x.service.next({ id: run.id });
  approveCandidate(x, run);
  const n = x.service.next({ id: run.id });
  assert.equal(n.run.stage, "music");
  assert.equal(n.run.state, "blocked");
  assert.ok(n.run.reasons.includes("MUSIC_AUTHORIZATION_REQUIRED"));
  assert.equal(x.works(), 1);
  assert.equal(n.run.score.method, "rule_based");
  assert.equal(x.repo.get("works", n.run.workId).source, "local_template");
  assert.equal(x.repo.all("operations").length, 0);
});

test("text generation claims persist before execution, score retries never regenerate and the same text budget applies", (t) => {
  const x = setup(t),
    { run } = start(x, {
      candidateMode: "deepseek",
      scoreMode: "deepseek",
      text: x.text,
    });
  const first = claimNext(x, run.id);
  assert.equal(first.task.type, "text_generate");
  assert.equal(
    x.repo.get("operations", first.operation.id).state,
    "dispatching",
  );
  const result = {
    operationId: first.operation.id,
    requestedModelId: "deepseek-flash",
    status: "complete",
    providerRequestId: "remote-1",
    providerModel: "deepseek-flash",
    finishReason: "stop",
    usage: {
      prompt_tokens: 100,
      completion_tokens: 200,
      prompt_cache_hit_tokens: 0,
      prompt_cache_miss_tokens: 100,
    },
    estimatedCostMicros: 270,
    priceVersion: "deepseek-peak-usd-2026-10-16",
    draft: draft(),
    reasons: [],
    httpStatus: 200,
  };
  x.service.record({
    id: run.id,
    operationId: first.operation.id,
    result: { type: "text_generate", result },
  });
  approveCandidate(x, run);
  const score = claimNext(x, run.id);
  assert.equal(score.task.type, "text_score");
  const invalid = {
    operationId: score.operation.id,
    requestedModelId: "deepseek-flash",
    status: "invalid",
    providerRequestId: "score-1",
    providerModel: "deepseek-flash",
    finishReason: "length",
    usage: result.usage,
    estimatedCostMicros: 270,
    priceVersion: result.priceVersion,
    revisionId: x.service.context(run.id).run.candidate.id,
    score: null,
    reasons: ["TEXT_FINISH_NOT_STOP"],
    httpStatus: 200,
  };
  x.service.record({
    id: run.id,
    operationId: score.operation.id,
    result: { type: "text_score", result: invalid },
  });
  let current = x.service.context(run.id).run;
  assert.equal(current.stage, "score");
  x.service.retry({ id: run.id, expectedRevision: current.revision });
  const again = claimNext(x, run.id);
  assert.equal(again.task.type, "text_score");
  assert.equal(
    x.repo.all("operations").filter((o) => o.taskType === "text_generate")
      .length,
    1,
  );
  assert.equal(x.service.context(run.id).run.textSpentMicros, 540);
});

test("accepted music without actual cost keeps the full reserve but allows original assets to materialize", (t) => {
  const x = setup(t),
    { run } = start(x, { music: x.music, publication: x.publication });
  x.service.next({ id: run.id });
  approveCandidate(x, run);
  const submitted = claimNext(x, run.id);
  assert.equal(submitted.task.type, "music_submit");
  x.service.record({
    id: run.id,
    operationId: submitted.operation.id,
    result: {
      type: "music_submit",
      status: "accepted",
      trackingId: "original-task",
      songIds: ["song-a", "song-b"],
      actualCostCredits: null,
      evidenceId: null,
    },
  });
  let current = x.service.context(run.id).run;
  assert.equal(current.musicReservedCredits, 2);
  assert.equal(current.stage, "assets");
  const assets = claimNext(x, run.id);
  assert.equal(assets.task.type, "music_assets");
  assert.deepEqual(assets.task.request.songIds, ["song-a", "song-b"]);
  const managed = ["song-a", "song-b"].map((providerSongId, index) => {
    const id = randomUUID();
    x.repo.save("assets", { id, kind: "audio", sha256: sha });
    return { providerSongId, assetId: id, sha256: sha, ordinal: index };
  });
  x.service.record({
    id: run.id,
    operationId: assets.operation.id,
    result: { type: "music_assets", status: "complete", assets: managed },
  });
  finishMaterials(x, run.id);
  current = x.service.next({ id: run.id }).run;
  assert.equal(current.stage, "publication");
  assert.equal(current.state, "awaiting_approval");
  assert.equal(current.assets.length, 2);
  assert.equal(current.musicReservedCredits, 2);
  assert.equal(
    x.repo.all("operations").filter((o) => o.taskType === "music_submit")
      .length,
    1,
  );
});

test("unknown dispatch survives restart without another charge or submission", (t) => {
  const x = setup(t),
    { run } = start(x, { candidateMode: "deepseek", text: x.text });
  const first = claimNext(x, run.id);
  const recovered = new w.ProductionFlowService(x.repo, x.options),
    current = recovered.context(run.id).run;
  assert.equal(current.state, "unknown");
  assert.equal(x.repo.get("operations", first.operation.id).state, "unknown");
  assert.throws(
    () => recovered.retry({ id: run.id, expectedRevision: current.revision }),
    /OUTCOME_UNKNOWN/,
  );
  assert.throws(
    () => recovered.claim({ id: run.id, expectedRevision: current.revision }),
    /OUTCOME_UNKNOWN/,
  );
  assert.equal(x.repo.all("operations").length, 1);
  assert.ok(current.textReservedMicros > 0);
});

test("music quote and profile revisions are checked before any payable claim", (t) => {
  const x = setup(t, { verifyMusicPricing: () => false }),
    { run } = start(x, { music: x.music });
  x.service.next({ id: run.id });
  approveCandidate(x, run);
  let n = x.service.next({ id: run.id });
  assert.ok(n.run.reasons.includes("MUSIC_PRICING_UNVERIFIED"));
  assert.equal(x.repo.all("operations").length, 0);
  const y = setup(t),
    started = start(y, { candidateMode: "deepseek", text: y.text });
  y.repo.save("settings", {
    ...y.repo.get("settings", "api-profile:" + y.text.profileId),
    revision: 2,
  });
  assert.throws(() => claimNext(y, started.run.id), /PROFILE_REVISION_CHANGED/);
  assert.equal(y.repo.all("operations").length, 0);
});

test("publication requires real saved authority and records an official receipt only after separate per-run approval", (t) => {
  const x = setup(t, { publicationAuthority: () => null }),
    { run } = start(x, { music: x.music, publication: x.publication });
  x.service.next({ id: run.id });
  approveCandidate(x, run);
  const music = claimNext(x, run.id);
  x.service.record({
    id: run.id,
    operationId: music.operation.id,
    result: {
      type: "music_submit",
      status: "accepted",
      trackingId: "t",
      songIds: ["a", "b"],
      actualCostCredits: 2,
      evidenceId: "invoice",
    },
  });
  const assets = claimNext(x, run.id);
  const managed = ["a", "b"].map((providerSongId, ordinal) => {
    const id = randomUUID();
    x.repo.save("assets", { id, kind: "audio", sha256: sha });
    return { providerSongId, assetId: id, sha256: sha, ordinal };
  });
  x.service.record({
    id: run.id,
    operationId: assets.operation.id,
    result: { type: "music_assets", status: "complete", assets: managed },
  });
  finishMaterials(x, run.id);
  let current = x.service.next({ id: run.id }).run;
  assert.throws(
    () =>
      x.service.approve({
        id: run.id,
        stage: "publication",
        expectedRevision: current.revision,
        consent: true,
        accountId: x.publication.accountId,
        termsHash,
      }),
    /PUBLICATION_AUTHORITY_REQUIRED/,
  );
  x.options.publicationAuthority = () => ({
    allowed: true,
    termsHash,
    evidenceId: "verified-authority",
  });
  current = x.service.approve({
    id: run.id,
    stage: "publication",
    expectedRevision: current.revision,
    consent: true,
    accountId: x.publication.accountId,
    termsHash,
  });
  const publish = claimNext(x, run.id);
  assert.equal(publish.task.type, "publication_submit");
  x.service.record({
    id: run.id,
    operationId: publish.operation.id,
    result: {
      type: "publication_submit",
      status: "accepted",
      externalId: "official-release",
    },
  });
  const receipt = claimNext(x, run.id);
  assert.equal(receipt.task.type, "publication_poll");
  x.service.record({
    id: run.id,
    operationId: receipt.operation.id,
    result: {
      type: "publication_poll",
      status: "complete",
      externalId: "official-release",
      receipt: {
        externalId: "official-release",
        evidenceId: "official-receipt",
        observedAt: "2026-10-15T09:00:00Z",
        source: "official",
      },
    },
  });
  assert.equal(x.service.context(run.id).run.state, "completed");
});

test("manually imported audio and cover require lyric alignment and rights before ready to publish", (t) => {
  const x = setup(t),
    { run } = start(x);
  x.service.next({ id: run.id });
  approveCandidate(x, run);
  let current = x.service.next({ id: run.id }).run;
  assert.ok(current.reasons.includes("NEEDS_MUSIC_MATERIALS"));
  const revision = current.revision;
  x.service.next({ id: run.id });
  assert.equal(x.service.context(run.id).run.revision, revision);
  const audioId = randomUUID();
  x.repo.save("assets", { id: audioId, kind: "audio", sha256: sha });
  let work = x.repo.get("works", current.workId);
  x.repo.save("works", { ...work, assets: { audio_A: audioId } });
  x.service.next({ id: run.id });
  assert.notEqual(x.service.context(run.id).run.state, "ready_to_publish");
  finishMaterials(x, run.id);
  current = x.service.next({ id: run.id }).run;
  assert.equal(current.state, "ready_to_publish");
  assert.equal(current.stage, "publication");
  assert.equal(current.materialMode, "manual");
  assert.equal(x.repo.all("operations").length, 0);
  const stable = current.revision;
  x.service.next({ id: run.id });
  assert.equal(x.service.context(run.id).run.revision, stable);
});

test("each rewritten candidate needs new approval and instrumental revisions stay structurally valid and bounded", (t) => {
  const x = setup(t),
    d = draft();
  d.sections = d.sections.slice(0, 1);
  d.sections[0].lines = ["One line", "Second line"];
  d.hook = { sectionId: d.sections[0].id, startLine: 0, endLine: 2 };
  d.vocalPlan = [{ sectionId: d.sections[0].id, voice: "male" }];
  const { run } = start(x, { template: d, threshold: 95 });
  x.service.next({ id: run.id });
  approveCandidate(x, run);
  let current = x.service.next({ id: run.id }).run;
  assert.equal(current.state, "awaiting_approval");
  assert.equal(current.stage, "candidate");
  assert.equal(current.candidateApproved, false);
  assert.equal(current.revisionCount, 1);
  assert.equal(x.works(), 0);
  const y = setup(t),
    instrumental = {
      ...draft(),
      instrumental: true,
      sections: [],
      hook: null,
      vocalPlan: [],
    };
  for (const p of Object.values(instrumental.musicPrompts))
    p.positiveStyle = "{{WRITE_PROMPT_HERE}}";
  const started = start(y, { template: instrumental });
  let r = y.service.next({ id: started.run.id }).run;
  for (let n = 0; n < 3; n++) {
    approveCandidate(y, r);
    r = y.service.next({ id: r.id }).run;
  }
  assert.equal(r.state, "failed");
  assert.equal(r.revisionCount, 2);
  assert.equal(r.versions.length, 3);
  assert.ok(r.versions.every((v) => v.draft.sections.length === 0));
});

test("only explicit confirmed-unsent proof releases a charge reservation", (t) => {
  for (const proof of [undefined, false, true]) {
    const x = setup(t),
      { run } = start(x, { candidateMode: "deepseek", text: x.text }),
      claim = claimNext(x, run.id);
    const saved = x.service.record({
      id: run.id,
      operationId: claim.operation.id,
      result: {
        type: "text_generate",
        status: "confirmed_unsent",
        reason: "LOCAL_NOT_SENT",
        ...(proof === undefined ? {} : { confirmedUnsent: proof }),
      },
    });
    assert.equal(saved.state, proof === true ? "blocked" : "unknown");
    assert.equal(
      saved.textReservedMicros,
      proof === true ? 0 : claim.operation.reservedAmount,
    );
  }
});

test("legacy text calls in flight exclude new production calls on the same profile", (t) => {
  const x = setup(t),
    { run } = start(x, { candidateMode: "deepseek", text: x.text });
  const id = randomUUID();
  x.repo.save("operations", {
    id,
    operationKey: id,
    kind: "live_text",
    provider: "deepseek",
    accountRef: x.text.profileId,
    state: "dispatching",
    costState: "reserved",
  });
  assert.throws(() => claimNext(x, run.id), /FLOW_PROVIDER_BUSY/);
  assert.equal(x.repo.all("operations").length, 1);
});

test("asset polling waits between attempts and ends after its original 24 hour tracking deadline", (t) => {
  const x = setup(t),
    { run } = start(x, { music: x.music });
  x.service.next({ id: run.id });
  approveCandidate(x, run);
  const music = claimNext(x, run.id);
  x.service.record({
    id: run.id,
    operationId: music.operation.id,
    result: {
      type: "music_submit",
      status: "accepted",
      songIds: ["a", "b"],
      trackingId: "t",
      actualCostCredits: null,
      evidenceId: null,
    },
  });
  const poll = claimNext(x, run.id);
  x.service.record({
    id: run.id,
    operationId: poll.operation.id,
    result: { type: "music_assets", status: "pending" },
  });
  assert.equal(x.service.next({ id: run.id }).task, null);
  x.now("2026-10-16T09:00:00Z");
  const n = x.service.next({ id: run.id });
  assert.equal(n.task, null);
  assert.equal(n.run.state, "blocked");
  assert.ok(n.run.reasons.includes("TRACKING_DEADLINE_EXCEEDED"));
  assert.equal(
    x.repo.all("operations").filter((o) => o.taskType === "music_submit")
      .length,
    1,
  );
});

test("daily production scheduling resolves DST gaps and disable stops further runs", (t) => {
  const x = setup(t);
  x.now("2026-03-08T06:59:50Z");
  const p = x.service.savePlan({
    plan: { ...x.plan, timezone: "America/New_York", localTime: "02:30" },
    expectedRevision: null,
  });
  x.service.enable({ id: p.id, expectedRevision: p.revision });
  x.now("2026-03-08T07:00:10Z");
  x.service.tick();
  assert.equal(x.service.list().runs.length, 1);
  assert.equal(
    x.service.list().occurrences[0].intendedAt,
    "2026-03-08T07:00:00.000Z",
  );
  x.service.disable({ id: p.id, expectedRevision: p.revision });
  x.now("2026-03-09T07:00:10Z");
  x.service.tick();
  assert.equal(x.service.list().runs.length, 1);
});

test("publication polling cannot replace the original provider release identity", (t) => {
  const x = setup(t),
    { run } = start(x, { publication: x.publication });
  x.service.next({ id: run.id });
  approveCandidate(x, run);
  let r = x.service.next({ id: run.id }).run;
  const audioId = randomUUID();
  x.repo.save("assets", { id: audioId, kind: "audio", sha256: sha });
  x.repo.save("works", {
    ...x.repo.get("works", r.workId),
    assets: { audio_A: audioId },
  });
  finishMaterials(x, run.id);
  r = x.service.next({ id: run.id }).run;
  x.service.approve({
    id: r.id,
    stage: "publication",
    expectedRevision: r.revision,
    consent: true,
    accountId: x.publication.accountId,
    termsHash,
  });
  const submit = claimNext(x, run.id);
  x.service.record({
    id: r.id,
    operationId: submit.operation.id,
    result: {
      type: "publication_submit",
      status: "accepted",
      externalId: "original-release",
    },
  });
  const poll = claimNext(x, r.id);
  assert.throws(
    () =>
      x.service.record({
        id: r.id,
        operationId: poll.operation.id,
        result: {
          type: "publication_poll",
          status: "complete",
          externalId: "different-release",
          receipt: {
            externalId: "different-release",
            evidenceId: "wrong-receipt",
            observedAt: "2026-10-15T09:00:00Z",
            source: "official",
          },
        },
      }),
    /RECEIPT_ID_MISMATCH/,
  );
  assert.equal(x.service.context(r.id).run.externalId, "original-release");
});

test("read-only interrupted downloads can retry original IDs without another music submission", (t) => {
  const x = setup(t),
    { run } = start(x, { music: x.music });
  x.service.next({ id: run.id });
  approveCandidate(x, run);
  const music = claimNext(x, run.id);
  x.service.record({
    id: run.id,
    operationId: music.operation.id,
    result: {
      type: "music_submit",
      status: "accepted",
      songIds: ["a", "b"],
      trackingId: "same-task",
      actualCostCredits: null,
      evidenceId: null,
    },
  });
  claimNext(x, run.id);
  const restored = new w.ProductionFlowService(x.repo, x.options),
    r = restored.context(run.id).run;
  assert.equal(r.state, "blocked");
  assert.ok(r.reasons.includes("READ_ONLY_INTERRUPTED"));
  restored.retry({ id: r.id, expectedRevision: r.revision });
  const n = restored.next({ id: r.id }),
    claim = restored.claim({ id: r.id, expectedRevision: n.run.revision });
  assert.equal(claim.task.type, "music_assets");
  assert.deepEqual(claim.task.request.songIds, ["a", "b"]);
  assert.equal(
    x.repo.all("operations").filter((o) => o.taskType === "music_submit")
      .length,
    1,
  );
});

test("restored runs cannot resume an old paid authorization", (t) => {
  const x = setup(t),
    { run } = start(x, { candidateMode: "deepseek", text: x.text });
  const key = "production-flow:run:" + run.id,
    stored = x.repo.get("settings", key);
  x.repo.save("settings", {
    ...stored,
    value: {
      ...stored.value,
      state: "blocked",
      reasons: ["RESTORED_REQUIRES_REVIEW"],
    },
  });
  assert.throws(
    () => x.service.retry({ id: run.id, expectedRevision: run.revision }),
    /RESTORED_REQUIRES_REVIEW/,
  );
  assert.equal(x.repo.all("operations").length, 0);
});

test("legacy unknown read-only operations recover only the current run operation", (t) => {
  const x = setup(t),
    { run } = start(x, { music: x.music });
  x.service.next({ id: run.id });
  approveCandidate(x, run);
  const music = claimNext(x, run.id);
  x.service.record({
    id: run.id,
    operationId: music.operation.id,
    result: {
      type: "music_submit",
      status: "accepted",
      songIds: ["a", "b"],
      actualCostCredits: null,
      evidenceId: null,
    },
  });
  const poll = claimNext(x, run.id);
  x.repo.save("operations", { ...poll.operation, state: "unknown" });
  const key = "production-flow:run:" + run.id,
    stored = x.repo.get("settings", key);
  x.repo.save("settings", {
    ...stored,
    value: { ...stored.value, state: "unknown" },
  });
  const resumed = new w.ProductionFlowService(x.repo, x.options);
  assert.equal(resumed.context(run.id).run.state, "blocked");
  assert.ok(
    resumed.context(run.id).run.reasons.includes("READ_ONLY_INTERRUPTED"),
  );
});

test("explicit manual fallback bypasses an unverified quote without deleting the future plan grant", (t) => {
  const x = setup(t, { verifyMusicPricing: () => false }),
    { run, p } = start(x, { music: x.music });
  x.service.next({ id: run.id });
  approveCandidate(x, run);
  let r = x.service.next({ id: run.id }).run;
  assert.ok(r.reasons.includes("MUSIC_PRICING_UNVERIFIED"));
  assert.equal(typeof x.service.useManualAssets, "function");
  assert.throws(() =>
    x.service.useManualAssets({
      id: r.id,
      expectedRevision: r.revision,
      consent: false,
    }),
  );
  r = x.service.useManualAssets({
    id: r.id,
    expectedRevision: r.revision,
    consent: true,
  });
  assert.equal(r.plan.music, null);
  assert.equal(r.materialMode, "manual");
  assert.deepEqual(
    x.service.list().plans.find((plan) => plan.id === p.id).music,
    x.music,
  );
  assert.equal(x.repo.all("operations").length, 0);
  const id = randomUUID();
  x.repo.save("assets", { id, kind: "audio", sha256: sha });
  const work = x.repo.get("works", r.workId);
  x.repo.save("works", { ...work, assets: { audio_A: id } });
  finishMaterials(x, r.id);
  assert.equal(x.service.next({ id: r.id }).run.state, "ready_to_publish");
});

test("manual fallback cannot conceal any previous music submission or an unknown outcome", (t) => {
  const x = setup(t),
    { run } = start(x, { music: x.music });
  x.service.next({ id: run.id });
  approveCandidate(x, run);
  const submit = claimNext(x, run.id);
  assert.throws(
    () =>
      x.service.useManualAssets({
        id: run.id,
        expectedRevision: submit.run.revision,
        consent: true,
      }),
    /MANUAL_ASSETS_SCOPE/,
  );
  x.service.record({
    id: run.id,
    operationId: submit.operation.id,
    result: {
      type: "music_submit",
      status: "confirmed_unsent",
      confirmedUnsent: true,
      reason: "NOT_SENT",
    },
  });
  const r = x.service.context(run.id).run;
  assert.throws(
    () =>
      x.service.useManualAssets({
        id: r.id,
        expectedRevision: r.revision,
        consent: true,
      }),
    /MUSIC_SUBMISSION_ALREADY_EXISTS/,
  );
  assert.deepEqual(x.service.context(r.id).run.plan.music, x.music);
});

test("global pause blocks every unfinished run and preserves an in-flight receipt without advancing it", (t) => {
  const x = setup(t),
    { run } = start(x, { candidateMode: "deepseek", text: x.text });
  const claim = claimNext(x, run.id);
  assert.equal(typeof x.service.pauseAll, "function");
  x.service.pauseAll();
  const result = {
    operationId: claim.operation.id,
    requestedModelId: "deepseek-flash",
    status: "complete",
    providerRequestId: "real-offline-receipt",
    providerModel: "deepseek-flash",
    finishReason: "stop",
    usage: {
      prompt_tokens: 100,
      completion_tokens: 200,
      prompt_cache_hit_tokens: 0,
      prompt_cache_miss_tokens: 100,
    },
    estimatedCostMicros: 270,
    priceVersion: "deepseek-peak-usd-2026-10-16",
    draft: draft(),
    reasons: [],
    httpStatus: 200,
  };
  const saved = x.service.record({
    id: run.id,
    operationId: claim.operation.id,
    result: { type: "text_generate", result },
  });
  assert.equal(saved.state, "blocked");
  assert.ok(saved.reasons.includes("AUTOMATION_PAUSED"));
  assert.equal(saved.textSpentMicros, 270);
  assert.equal(x.service.next({ id: run.id }).task, null);
});
