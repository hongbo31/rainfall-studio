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

function managedMusicStart(x, changes = {}) {
  const s = managedInboxStart(x, {ownerKey:'score-owner:'+randomUUID()});
  const evaluated = recordInboxScore(x, s.run);
  const {pricingEvidence, ...grant} = x.music;
  const input = {ownerKey:'music-owner:'+randomUUID(),budgetScope:'unified-plan:music-fixture',artistId:x.plan.artistId,
    evaluationRunId:evaluated.id,music:{...grant,creditPolicy:{mode:'existing_credits',noRecharge:true,actualCostUnknown:true,consent:true}},...changes};
  return {input,evaluated,run:x.service.startManagedMusic(input)};
}

test('managed music uses only the passed final inbox draft, is text-free and owner-idempotent',t=>{
  const x=setup(t),s=managedMusicStart(x),n=x.service.next({id:s.run.id});
  assert.equal(n.task.type,'music_submit');
  assert.deepEqual(n.task.request.draft,s.evaluated.candidate.draft);
  assert.equal(n.run.plan.text,null);
  assert.equal(n.run.plan.publication,null);
  assert.equal(x.service.startManagedMusic(s.input).id,s.run.id);
  assert.equal(x.works(),1);
  assert.throws(()=>x.service.startManagedMusic({...s.input,music:{...s.input.music,budgetCredits:3}}),/MANAGED_MUSIC_CONFLICT/);
  assert.equal(x.repo.all('operations').filter(o=>o.runId===s.run.id).length,0);
});

test('managed music consumes the passed rewritten final draft rather than the imported original',t=>{
  const x=setup(t),s=managedInboxStart(x);
  let evaluation=recordInboxScore(x,s.run,30);
  evaluation=recordInboxRewrite(x,evaluation,{...draft(),title:'Final revised scored title'});
  evaluation=recordInboxScore(x,evaluation,80);
  const {pricingEvidence,...grant}=x.music;
  const child=x.service.startManagedMusic({ownerKey:'rewritten-music',budgetScope:'shared',artistId:x.plan.artistId,evaluationRunId:evaluation.id,music:{...grant,creditPolicy:{mode:'existing_credits',noRecharge:true,actualCostUnknown:true,consent:true}}});
  const next=x.service.next({id:child.id});
  assert.equal(next.task.request.draft.title,'Final revised scored title');
  assert.equal(next.run.candidate.id,evaluation.candidate.id);
  assert.notEqual(x.repo.get('drafts',s.draftId).draft.title,'Final revised scored title');
});

test('managed music rejects unscored/local drafts, wrong artist and legacy credit authorization',t=>{
  const x=setup(t),s=managedInboxStart(x);
  const {pricingEvidence,...grant}=x.music;
  const input={ownerKey:'music',budgetScope:'shared',artistId:x.plan.artistId,evaluationRunId:s.run.id,
    music:{...grant,creditPolicy:{mode:'existing_credits',noRecharge:true,actualCostUnknown:true,consent:true}}};
  assert.throws(()=>x.service.startManagedMusic(input),/MANAGED_MUSIC_EVALUATION_REQUIRED/);
  recordInboxScore(x,s.run);
  assert.throws(()=>x.service.startManagedMusic({...input,music:x.music}));
  assert.throws(()=>x.service.startManagedMusic({...input,artistId:randomUUID()}),/MANAGED_MUSIC_EVALUATION_REQUIRED/);
  const run=x.service.context(s.run.id).run;
  x.repo.save('settings',{id:'production-flow:run:'+run.id,value:{...run,score:{...run.score,revisionId:randomUUID()}}});
  assert.throws(()=>x.service.startManagedMusic(input),/MANAGED_MUSIC_EVALUATION_REQUIRED/);
  assert.equal(x.works(),0);
});

test('managed existing-credit consent bypasses old pricingEvidence while trusted quote remains fail closed',t=>{
  const x=setup(t,{verifyMusicPricing:()=>false}),s=managedMusicStart(x);
  assert.equal(claimNext(x,s.run.id).task.type,'music_submit');
  const y=setup(t),q=managedMusicStart(y,{music:{profileId:y.music.profileId,profileRevision:1,modelId:'chirp-v6',budgetCredits:2,maxCostPerRequestCredits:2,consent:true,creditPolicy:{mode:'trusted_quote',quoteId:randomUUID()}}});
  assert.equal(y.service.next({id:q.run.id}).task,null);
  assert.deepEqual(y.service.context(q.run.id).run.reasons,['MUSIC_PRICING_UNVERIFIED']);
});

test('managed music stop before submit forbids claims and retry cannot reauthorize it',t=>{
  const x=setup(t),s=managedMusicStart(x);
  x.service.next({id:s.run.id});
  x.service.stopManagedMusic(s.input.ownerKey);
  let run=x.service.context(s.run.id).run;
  assert.equal(x.service.next({id:run.id}).task,null);
  assert.throws(()=>x.service.claim({id:run.id,expectedRevision:run.revision}),/MANAGED_MUSIC_STOPPED/);
  assert.throws(()=>x.service.retry({id:run.id,expectedRevision:run.revision}),/MANAGED_MUSIC_STOPPED/);
  assert.equal(x.service.startManagedMusic(s.input).id,s.run.id);
  assert.equal(x.repo.all('operations').filter(o=>o.runId===run.id).length,0);
});

test('managed accepted music drains original IDs after stop and completes without publication gates',t=>{
  const x=setup(t),s=managedMusicStart(x),c=claimNext(x,s.run.id);
  x.service.stopManagedMusic(s.input.ownerKey);
  x.service.record({id:s.run.id,operationId:c.operation.id,result:{type:'music_submit',status:'accepted',trackingId:'original',songIds:['original-A','original-B'],actualCostCredits:null,evidenceId:null}});
  const poll=claimNext(x,s.run.id);
  assert.deepEqual(poll.task.request.songIds,['original-A','original-B']);
  const assets=[0,1].map(ordinal=>({providerSongId:poll.task.request.songIds[ordinal],assetId:randomUUID(),sha256:sha,ordinal}));
  for(const a of assets)x.repo.save('assets',{id:a.assetId,kind:'audio',sha256:a.sha256});
  const done=x.service.record({id:s.run.id,operationId:poll.operation.id,result:{type:'music_assets',status:'complete',assets}});
  assert.equal(done.state,'completed');
  assert.equal(done.stage,'assets');
  assert.equal(done.managedStopped,true);
  assert.equal(x.service.next({id:done.id}).task,null);
  assert.equal(x.repo.all('operations').filter(o=>o.runId===done.id&&o.taskType==='music_submit').length,1);
});

test('managed unknown restart keeps reservation and blocks POST across profiles in the same budget',t=>{
  const x=setup(t),a=managedMusicStart(x);
  const secondProfile=randomUUID();
  x.repo.save('settings',{...x.repo.get('settings','api-profile:'+x.music.profileId),id:'api-profile:'+secondProfile});
  const b=x.service.startManagedMusic({...a.input,ownerKey:'other-music-owner',music:{...a.input.music,profileId:secondProfile,budgetCredits:100}});
  const claim=claimNext(x,a.run.id);
  assert.throws(()=>claimNext(x,b.id),/FLOW_PROVIDER_BUSY/);
  const restarted=new w.ProductionFlowService(x.repo,x.options);
  assert.equal(restarted.context(a.run.id).run.state,'unknown');
  const next=restarted.next({id:b.id});
  assert.throws(()=>restarted.claim({id:b.id,expectedRevision:next.run.revision}),/PROVIDER_RISK_FROZEN/);
  restarted.stopManagedMusic(a.input.ownerKey);
  assert.equal(restarted.startManagedMusic(a.input).state,'unknown');
  assert.equal(x.repo.all('workflowLedger').filter(e=>e.unit==='provider_credit'&&e.kind==='release').length,0);
});

test('managed read-only restart after stop resumes original song IDs without manual reauthorization',t=>{
  const x=setup(t),s=managedMusicStart(x),c=claimNext(x,s.run.id);
  x.service.record({id:s.run.id,operationId:c.operation.id,result:{type:'music_submit',status:'accepted',trackingId:'t',songIds:['a','b'],actualCostCredits:null,evidenceId:null}});
  claimNext(x,s.run.id);
  x.service.stopManagedMusic(s.input.ownerKey);
  const restarted=new w.ProductionFlowService(x.repo,x.options),n=restarted.next({id:s.run.id});
  assert.equal(n.task?.type,'music_assets');
  const poll=restarted.claim({id:s.run.id,expectedRevision:n.run.revision});
  assert.deepEqual(poll.task.request.songIds,['a','b']);
  assert.equal(x.repo.all('operations').filter(o=>o.runId===s.run.id&&o.taskType==='music_submit').length,1);
});

test('managed budget is shared across repository connections and resets at Beijing midnight',t=>{
  const x=setup(t),a=managedMusicStart(x),profileId=randomUUID();
  x.repo.save('settings',{...x.repo.get('settings','api-profile:'+x.music.profileId),id:'api-profile:'+profileId});
  const b=x.service.startManagedMusic({...a.input,ownerKey:'second-day-owner',music:{...a.input.music,profileId}});
  x.service.next({id:b.id});
  const otherRepo=new w.Repository(x.repo.filename);t.after(()=>otherRepo.close());
  const other=new w.ProductionFlowService(otherRepo,x.options);
  x.now('2026-10-19T15:59:00Z');
  const c=claimNext(x,a.run.id);
  x.service.record({id:a.run.id,operationId:c.operation.id,result:{type:'music_submit',status:'accepted',trackingId:'t',songIds:['a','b'],actualCostCredits:2,evidenceId:'fixture-cost'}});
  let n=other.next({id:b.id});
  assert.throws(()=>other.claim({id:b.id,expectedRevision:n.run.revision}),/MUSIC_BUDGET_INSUFFICIENT/);
  x.now('2026-10-19T16:00:00Z');n=other.next({id:b.id});
  const nextDay=other.claim({id:b.id,expectedRevision:n.run.revision});
  assert.equal(nextDay.operation.budgetDate,'2026-10-20');
  assert.equal(nextDay.operation.budgetScope,a.input.budgetScope);
  assert.notEqual(nextDay.operation.planId,c.operation.planId);
});

test('managed source mutation after child creation blocks a payable claim',t=>{
  const x=setup(t),s=managedMusicStart(x);
  const final=x.repo.get('drafts',s.evaluated.candidate.id);
  x.repo.save('drafts',{...final,draft:{...final.draft,title:'tampered'}});
  assert.throws(()=>claimNext(x,s.run.id),/MANAGED_MUSIC_EVALUATION_REQUIRED/);
  assert.equal(x.repo.all('operations').filter(o=>o.runId===s.run.id).length,0);
});

test('managed plans cannot be used as a second legacy text/music schedule',t=>{
  const x=setup(t),s=managedMusicStart(x);
  x.now('2026-10-23T00:00:00Z');
  assert.throws(()=>x.service.trigger({planId:s.run.planId,requestId:randomUUID()}),/MANAGED_PLAN_INTERNAL_ONLY/);
  const n=x.service.next({id:s.run.id});
  assert.throws(()=>x.service.useManualAssets({id:s.run.id,expectedRevision:n.run.revision,consent:true}),/MANAGED_PLAN_INTERNAL_ONLY/);
});

test('late original accepted receipt recovers managed unknown once without a second POST',t=>{
  const x=setup(t),s=managedMusicStart(x),c=claimNext(x,s.run.id);
  x.service.record({id:s.run.id,operationId:c.operation.id,result:{type:'music_submit',status:'unknown',reason:'TIMEOUT'}});
  x.service.stopManagedMusic(s.input.ownerKey);
  const accepted={type:'music_submit',status:'accepted',trackingId:'original',songIds:['a','b'],actualCostCredits:null,evidenceId:null};
  const recovered=x.service.record({id:s.run.id,operationId:c.operation.id,result:accepted});
  assert.equal(recovered.stage,'assets');
  assert.equal(claimNext(x,s.run.id).task.type,'music_assets');
  assert.throws(()=>x.service.record({id:s.run.id,operationId:c.operation.id,result:{...accepted,songIds:['other','ids']}}),/IDEMPOTENCY_CONFLICT/);
  assert.equal(x.repo.all('operations').filter(o=>o.runId===s.run.id&&o.taskType==='music_submit').length,1);
  assert.equal(x.repo.get('operations',c.operation.id).recoveryEvidence[0].result.reason,'TIMEOUT');
});

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
        prompt: candidate.pair.musicPrompt,
        productionFlowRunId: run.id,
        productionCandidateId: candidate.id,
        productionCandidateHash: candidate.pairHash,
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
function inboxStart(x, patch = {}) {
  const id = randomUUID(),
    draftId = randomUUID(),
    channelId = randomUUID();
  x.repo.save("settings", {
    id: "inbox-channel",
    enabled: true,
    revision: 1,
    channel: {
      id: channelId,
      workspaceId: randomUUID(),
      workspaceRef: "test",
      artistRefs: { creator: x.plan.artistId },
      seriesRefs: {},
    },
  });
  x.repo.save("drafts", {
    id: draftId,
    artistId: x.plan.artistId,
    seriesId: null,
    source: "local-inbox",
    draft: draft(),
  });
  x.repo.save("textCandidates", {
    id,
    draftId,
    artistId: x.plan.artistId,
    seriesId: null,
    source: { channelId, provenance: { model: null, promptVersion: null } },
    isCurrent: true,
    lineageState: "complete",
    evaluationState: "model_pending",
    localCheck: {
      status: "pending",
      issues: [{ code: "CAPABILITY_UNKNOWN", evidence: [] }],
    },
    externalItemId: "offline-original",
    externalRevision: 1,
    itemHash: "a".repeat(64),
  });
  const p = x.service.savePlan({
    plan: {
      ...x.plan,
      inboxEvaluation: true,
      localTime: null,
      candidateMode: "deepseek",
      scoreMode: "deepseek",
      text: x.text,
      autoContinue: true,
      ...patch,
    },
    expectedRevision: null,
  });
  x.service.enable({ id: p.id, expectedRevision: p.revision });
  return { id, draftId, p };
}
function evaluationReceipt(claim, level = 80, invalid = false) {
  const request = claim.task.request;
  const phrase = request.pair.lyrics
    .split("\n")
    .find((s) => s.length >= 4 && !s.startsWith("["));
  return {
    type: "text_score",
    result: {
      operationId: claim.operation.id,
      revisionId: request.revisionId,
      requestedModelId: "deepseek-flash",
      status: invalid ? "invalid" : "complete",
      providerRequestId: "offline-score-" + claim.operation.id,
      providerModel: "deepseek-flash",
      finishReason: invalid ? "length" : "stop",
      usage: {
        prompt_tokens: 100,
        completion_tokens: 200,
        prompt_cache_hit_tokens: 0,
        prompt_cache_miss_tokens: 100,
      },
      estimatedCostMicros: 270,
      priceVersion: "deepseek-peak-usd-2026-10-16",
      score: invalid
        ? null
        : {
            revisionId: request.revisionId,
            dimensions: { lyrics: level, style: level, coherence: level },
            overall: level,
            findings: [
              '[lyrics] "' +
                phrase +
                '" supports the stated scene with concrete details and consistent tone.',
            ],
            threshold: request.threshold,
            passed: level >= request.threshold,
            source: "model-scored",
            calibration: "not_human_calibrated",
          },
      reasons: invalid ? ["TEXT_FINISH_NOT_STOP"] : [],
      httpStatus: 200,
    },
  };
}
function recordInboxScore(x, run, level = 80, invalid = false) {
  const claim = claimNext(x, run.id);
  assert.equal(claim.task.type, "text_score");
  x.service.record({
    id: run.id,
    operationId: claim.operation.id,
    result: evaluationReceipt(claim, level, invalid),
  });
  return x.service.context(run.id).run;
}
function recordInboxRewrite(x, run, finalDraft=draft()) {
  const claim = claimNext(x, run.id);
  assert.equal(claim.task.type, "text_generate");
  x.service.record({
    id: run.id,
    operationId: claim.operation.id,
    result: {
      type: "text_generate",
      result: {
        operationId: claim.operation.id,
        requestedModelId: "deepseek-flash",
        status: "complete",
        providerRequestId: "offline-rewrite-" + claim.operation.id,
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
        draft: finalDraft,
        reasons: [],
        httpStatus: 200,
      },
    },
  });
  return x.service.context(run.id).run;
}

test("inbox evaluation automatically scores a current imported revision without human approval or music work", (t) => {
  const x = setup(t),
    s = inboxStart(x);
  x.service.tick();
  const runs = x.service.list().runs;
  assert.equal(runs.length, 1);
  assert.equal(runs[0].inboxCandidateId, s.id);
  assert.equal(x.service.next({ id: runs[0].id }).task.type, "text_score");
  const done = recordInboxScore(x, runs[0]);
  assert.equal(done.state, "completed");
  assert.equal(x.works(), 0);
  assert.equal(x.repo.all("works").length, 0);
  const c = x.repo.get("textCandidates", s.id);
  assert.equal(c.evaluationState, "model_passed");
  assert.equal(c.evaluation.score.source, "model-scored");
  assert.equal(c.evaluation.score.overall, 80);
  assert.equal(c.draftId, s.draftId);
  assert.equal(
    x.repo.all("operations").every((o) => o.taskType === "text_score"),
    true,
  );
  x.service.tick();
  assert.equal(x.service.list().runs.length, 1);
});
test("inbox quality failure automatically rewrites and rescores at most twice, preserving the imported draft", (t) => {
  const x = setup(t),
    s = inboxStart(x);
  const original = structuredClone(x.repo.get("drafts", s.draftId));
  x.service.tick();
  let run = x.service.list().runs[0];
  run = recordInboxScore(x, run, 30);
  assert.equal(run.stage, "revise");
  for (let n = 0; n < 2; n++) {
    run = recordInboxRewrite(x, run);
    assert.notEqual(run.state, "awaiting_approval");
    run = recordInboxScore(x, run, 30);
  }
  assert.equal(run.state, "failed");
  assert.ok(run.reasons.includes("REVISION_LIMIT"));
  assert.equal(run.revisionCount, 2);
  assert.equal(
    x.repo.get("textCandidates", s.id).evaluationState,
    "model_failed",
  );
  assert.deepEqual(x.repo.get("drafts", s.draftId), original);
  assert.equal(x.repo.all("operations").length, 5);
  assert.equal(x.works(), 0);
  assert.equal(x.service.next({ id: run.id }).task, null);
});
test("inbox invalid model response retries only bounded scoring, while unknown outcomes never replay", (t) => {
  const x = setup(t),
    s = inboxStart(x, { maxScoreRetries: 1 });
  x.service.tick();
  let run = x.service.list().runs[0];
  run = recordInboxScore(x, run, 80, true);
  assert.equal(run.state, "ready");
  run = recordInboxScore(x, run, 80, true);
  assert.equal(run.state, "failed");
  assert.equal(x.repo.all("operations").length, 2);
  assert.equal(x.works(), 0);
  assert.equal(
    x.repo.get("textCandidates", s.id).evaluationState,
    "model_error",
  );
});
test("inbox evaluation cannot use rule scores, music grants, missing consent or publication grants", (t) => {
  const x = setup(t);
  for (const patch of [
    { scoreMode: "rule_based" },
    { music: x.music },
    { publication: x.publication },
    { text: null },
    { autoContinue: false },
    { candidateMode: "local_template" },
  ])
    assert.throws(() =>
      x.service.savePlan({
        plan: {
          ...x.plan,
          inboxEvaluation: true,
          candidateMode: "deepseek",
          scoreMode: "deepseek",
          text: x.text,
          autoContinue: true,
          ...patch,
        },
        expectedRevision: null,
      }),
    );
  assert.equal(x.repo.all("operations").length, 0);
});
test("inbox source edit and pause prevent further claims, without disabling other plans", (t) => {
  const x = setup(t),
    s = inboxStart(x);
  x.service.tick();
  const run = x.service.list().runs[0];
  x.repo.save("textCandidates", {
    ...x.repo.get("textCandidates", s.id),
    isCurrent: false,
  });
  assert.throws(() => claimNext(x, run.id), /INBOX_EVALUATION_SOURCE_CHANGED/);
  assert.equal(x.repo.all("operations").length, 0);
});
test("inbox evaluation budget is enforced before any request and a pending platform limit is not a quality failure", (t) => {
  const x = setup(t),
    s = inboxStart(x, { text: { ...x.text, budgetMicros: 1 } });
  x.service.tick();
  const run = x.service.list().runs[0];
  assert.equal(x.service.next({ id: run.id }).task.type, "text_score");
  assert.throws(() => claimNext(x, run.id), /TEXT_BUDGET_INSUFFICIENT/);
  assert.equal(x.repo.all("operations").length, 0);
  assert.equal(x.works(), 0);
});

test("inbox unknown scoring freezes the profile across restart and never starts another request", (t) => {
  const x = setup(t),
    s = inboxStart(x);
  x.service.tick();
  const run = x.service.list().runs[0],
    claim = claimNext(x, run.id);
  x.service.record({
    id: run.id,
    operationId: claim.operation.id,
    result: {
      type: "text_score",
      status: "unknown",
      reason: "NETWORK_OUTCOME_UNKNOWN",
    },
  });
  const restarted = new w.ProductionFlowService(x.repo, x.options);
  restarted.tick();
  const current = restarted.context(run.id).run;
  assert.equal(current.state, "unknown");
  assert.equal(restarted.next({ id: run.id }).task, null);
  assert.throws(
    () => restarted.retry({ id: run.id, expectedRevision: current.revision }),
    /OUTCOME_UNKNOWN/,
  );
  assert.equal(x.repo.all("operations").length, 1);
  assert.equal(
    x.repo.get("textCandidates", s.id).evaluationState,
    "model_unknown",
  );
  assert.ok(current.textReservedMicros > 0);
});

test("inbox scoring keeps platform capability pending and never overwrites the original cover", (t) => {
  const x = setup(t),
    s = inboxStart(x);
  const original = x.repo.get("drafts", s.draftId);
  x.repo.save("drafts", {
    ...original,
    cover: { assetId: randomUUID(), sha256: sha },
  });
  const saved = structuredClone(x.repo.get("drafts", s.draftId));
  x.service.tick();
  let run = recordInboxScore(x, x.service.list().runs[0], 30);
  run = recordInboxRewrite(x, run);
  run = recordInboxScore(x, run, 85);
  const candidate = x.repo.get("textCandidates", s.id);
  assert.equal(run.state, "completed");
  assert.equal(candidate.evaluation.coverState, "refresh_required");
  assert.equal(candidate.localCheck.status, "pending");
  assert.equal(candidate.localCheck.issues[0].code, "CAPABILITY_UNKNOWN");
  assert.deepEqual(x.repo.get("drafts", s.draftId), saved);
  assert.notEqual(candidate.evaluation.currentDraftId, s.draftId);
  assert.equal(
    x.repo.get("drafts", candidate.evaluation.currentDraftId).source,
    "inbox-evaluation",
  );
  assert.equal(
    x.repo.get("drafts", candidate.evaluation.currentDraftId).cover,
    undefined,
  );
});

test("inbox source body mutation, channel pause and plan disable each prevent a new claim", (t) => {
  for (const change of ["draft", "channel", "plan"]) {
    const x = setup(t),
      s = inboxStart(x);
    x.service.tick();
    const run = x.service.list().runs[0];
    if (change === "draft") {
      const source = x.repo.get("drafts", s.draftId);
      x.repo.save("drafts", {
        ...source,
        draft: { ...source.draft, title: "Changed after import" },
      });
    } else if (change === "channel") {
      const channel = x.repo.get("settings", "inbox-channel");
      x.repo.save("settings", { ...channel, enabled: false });
    } else x.service.disable({ id: s.p.id, expectedRevision: s.p.revision });
    assert.throws(
      () => claimNext(x, run.id),
      /INBOX_EVALUATION_(SOURCE_CHANGED|DISABLED)/,
    );
    assert.equal(x.repo.all("operations").length, 0);
  }
});

test("inbox requests share profile concurrency and reserve the plan daily budget before dispatch", (t) => {
  const x = setup(t),
    s = inboxStart(x, { maxRunsPerDay: 2 });
  const candidate = x.repo.get("textCandidates", s.id),
    otherId = randomUUID();
  x.repo.save("textCandidates", {
    ...candidate,
    id: otherId,
    externalItemId: "offline-other",
  });
  x.service.tick();
  const [first, second] = x.service.list().runs;
  const claimed = claimNext(x, first.id);
  assert.throws(() => claimNext(x, second.id), /FLOW_PROVIDER_BUSY/);
  x.service.record({
    id: first.id,
    operationId: claimed.operation.id,
    result: evaluationReceipt(claimed),
  });
  assert.equal(claimNext(x, second.id).task.type, "text_score");
  assert.equal(x.repo.all("operations").length, 2);
  assert.ok(x.repo.all("workflowLedger").some((e) => e.kind === "reserve"));
});

test("inbox default scoring retries stop after the initial response and two invalid retries", (t) => {
  const x = setup(t);
  inboxStart(x);
  x.service.tick();
  let run = x.service.list().runs[0];
  for (let i = 0; i < 3; i++) run = recordInboxScore(x, run, 80, true);
  assert.equal(run.state, "failed");
  assert.equal(run.scoreRetries, 3);
  assert.equal(run.revisionCount, 0);
  assert.equal(x.repo.all("operations").length, 3);
  assert.throws(
    () => x.service.retry({ id: run.id, expectedRevision: run.revision }),
    /SCORE_RETRY_LIMIT/,
  );
});

function managedInboxStart(x, overrides = {}) {
  const s = inboxStart(x);
  x.service.disable({ id: s.p.id, expectedRevision: s.p.revision });
  const input = {
    ownerKey: "plan-center:offline-run:item:score:1",
    candidateId: s.id,
    artistId: x.plan.artistId,
    text: x.text,
    threshold: 75,
    maxRevisions: 2,
    maxScoreRetries: 2,
    ...overrides,
  };
  return { ...s, input, run: x.service.startManagedInboxEvaluation(input) };
}

test("managed inbox entry is stable, text-only and excluded from legacy candidate scheduling", (t) => {
  const x = setup(t),
    s = managedInboxStart(x);
  const candidate = x.repo.get("textCandidates", s.id);
  x.repo.save("textCandidates", {
    ...candidate,
    id: randomUUID(),
    externalItemId: "unowned",
    evaluation: null,
  });
  x.service.tick();
  assert.equal(x.service.list().runs.length, 1);
  assert.equal(x.service.startManagedInboxEvaluation(s.input).id, s.run.id);
  const plan = x.service.context(s.run.id).plan;
  assert.equal(plan.managedByPlanCenter, true);
  assert.equal(plan.managedCandidateId, s.id);
  assert.equal(plan.localTime, null);
  assert.equal(plan.music, null);
  assert.equal(plan.publication, null);
  assert.throws(
    () =>
      x.service.startManagedInboxEvaluation({
        ...s.input,
        text: { ...x.text, budgetMicros: 999 },
      }),
    /MANAGED_INBOX_EVALUATION_CONFLICT/,
  );
  assert.throws(
    () => x.service.startManagedInboxEvaluation({ ...s.input, threshold: 76 }),
    /MANAGED_INBOX_EVALUATION_CONFLICT/,
  );
  const run = recordInboxScore(x, s.run);
  assert.equal(run.state, "completed");
  assert.equal(x.service.startManagedInboxEvaluation(s.input).id, run.id);
  assert.equal(x.repo.all("operations").length, 1);
});

test("stopping one managed evaluation preserves its in-flight receipt and never reenables its grant", (t) => {
  const x = setup(t),
    s = managedInboxStart(x),
    claim = claimNext(x, s.run.id);
  const other = x.service.savePlan({
    plan: { ...x.plan, id: randomUUID() },
    expectedRevision: null,
  });
  x.service.enable({ id: other.id, expectedRevision: other.revision });
  const stopped = x.service.stopManagedInboxEvaluation(s.input.ownerKey);
  assert.equal(stopped.state, "dispatching");
  const received = x.service.record({
    id: s.run.id,
    operationId: claim.operation.id,
    result: evaluationReceipt(claim, 30),
  });
  assert.equal(received.state, "blocked");
  assert.ok(received.reasons.includes("AUTOMATION_PAUSED"));
  assert.equal(received.textSpentMicros, 270);
  assert.equal(x.service.startManagedInboxEvaluation(s.input).id, received.id);
  assert.equal(x.service.next({ id: received.id }).task, null);
  assert.throws(
    () =>
      x.service.claim({ id: received.id, expectedRevision: received.revision }),
    /INBOX_EVALUATION_DISABLED/,
  );
  assert.equal(
    x.service.list().plans.find((p) => p.id === other.id).enabled,
    true,
  );
  assert.equal(x.repo.all("operations").length, 1);
});

test("managed unknown outcomes remain frozen after stop, restart and repeated start", (t) => {
  const x = setup(t),
    s = managedInboxStart(x),
    claim = claimNext(x, s.run.id);
  x.service.record({
    id: s.run.id,
    operationId: claim.operation.id,
    result: {
      type: "text_score",
      status: "unknown",
      reason: "OUTCOME_UNKNOWN",
    },
  });
  x.service.stopManagedInboxEvaluation(s.input.ownerKey);
  const restarted = new w.ProductionFlowService(x.repo, x.options);
  const same = restarted.startManagedInboxEvaluation(s.input);
  assert.equal(same.state, "unknown");
  assert.equal(restarted.context(same.id).plan.enabled, false);
  assert.equal(x.repo.all("operations").length, 1);
});

test("inbox controller reports real evaluation configuration and paused state", (t) => {
  const x = setup(t),
    controller = new w.InboxController(
      x.repo,
      path.resolve("output/inbox-status-fixture"),
    );
  assert.equal(controller.status().modelEvaluation, "configuration_required");
  const s = inboxStart(x);
  assert.equal(controller.status().modelEvaluation, "configured");
  assert.equal(
    controller.status().inboxEvaluationStatus.plans[0].threshold,
    75,
  );
  x.service.disable({ id: s.p.id, expectedRevision: s.p.revision });
  assert.equal(controller.status().modelEvaluation, "paused");
});

test("inbox daily budget includes earlier runs before any new operation is persisted", (t) => {
  const x = setup(t),
    s = inboxStart(x);
  x.service.tick();
  const run = x.service.list().runs[0];
  x.repo.append("workflowLedger", {
    id: randomUUID(),
    eventKey: "offline-prior-reserve",
    operationId: randomUUID(),
    runId: randomUUID(),
    planId: s.p.id,
    date: run.budgetDate,
    scope: "production_flow_text",
    kind: "reserve",
    amount: x.text.budgetMicros,
    unit: "usd_micro_estimate",
    at: run.createdAt,
  });
  assert.equal(run.textSpentMicros, 0);
  assert.throws(() => claimNext(x, run.id), /TEXT_BUDGET_INSUFFICIENT/);
  assert.equal(x.repo.all("operations").length, 0);
  assert.equal(x.repo.all("workflowLedger").length, 1);
});

function managedBudgetPair(t) {
  const probe = setup(t),
    sample = managedInboxStart(probe);
  const amount = claimNext(probe, sample.run.id).operation.reservedAmount;
  const x = setup(t),
    scope = "unified-plan:" + randomUUID();
  const first = managedInboxStart(x, {
    budgetScope: scope,
    text: { ...x.text, budgetMicros: amount + 269 },
  });
  const otherId = randomUUID(),
    otherProfile = randomUUID();
  x.repo.save("textCandidates", {
    ...x.repo.get("textCandidates", first.id),
    id: otherId,
    externalItemId: "other-budget-item",
    evaluation: null,
  });
  x.repo.save("settings", {
    ...x.repo.get("settings", "api-profile:" + x.text.profileId),
    id: "api-profile:" + otherProfile,
  });
  const secondInput = {
    ...first.input,
    ownerKey: "plan-center:second-owner:score",
    candidateId: otherId,
    text: { ...first.input.text, profileId: otherProfile },
  };
  const second = x.service.startManagedInboxEvaluation(secondInput);
  return { x, scope, first, second, secondInput, amount };
}

test("managed item plans debit one shared daily budget while retaining their actual plan identities", (t) => {
  const { x, scope, first, second, amount } = managedBudgetPair(t);
  const claim = claimNext(x, first.run.id);
  assert.equal(claim.operation.reservedAmount, amount);
  assert.equal(claim.operation.planId, first.run.planId);
  assert.equal(claim.operation.budgetScope, scope);
  assert.equal(x.service.context(second.id).plan.managedBudgetScope, scope);
  assert.notEqual(first.run.planId, second.planId);
  x.service.record({
    id: first.run.id,
    operationId: claim.operation.id,
    result: evaluationReceipt(claim),
  });
  assert.throws(() => claimNext(x, second.id), /TEXT_BUDGET_INSUFFICIENT/);
  assert.equal(x.repo.all("operations").length, 1);
  const entries = x.repo.all("workflowLedger");
  assert.ok(
    entries.every(
      (e) => e.budgetScope === scope && e.planId === first.run.planId,
    ),
  );
  assert.equal(
    entries.reduce(
      (sum, e) =>
        sum +
        (e.kind === "reserve"
          ? e.amount
          : e.kind === "release"
            ? -e.amount
            : 0),
      0,
    ),
    270,
  );
});

test("two managed owners cannot reserve the same shared budget through separate repository connections", (t) => {
  const { x, first, second } = managedBudgetPair(t);
  const otherRepo = new w.Repository(x.repo.filename);
  t.after(() => otherRepo.close());
  const otherService = new w.ProductionFlowService(otherRepo, x.options);
  claimNext(x, first.run.id);
  const pending = otherService.next({ id: second.id });
  assert.throws(
    () =>
      otherService.claim({
        id: second.id,
        expectedRevision: pending.run.revision,
      }),
    /TEXT_BUDGET_INSUFFICIENT/,
  );
  assert.equal(otherRepo.all("operations").length, 1);
  assert.equal(
    otherRepo.all("workflowLedger").filter((e) => e.kind === "reserve").length,
    1,
  );
});

test("managed shared reserves survive an unknown restart and use Beijing dates for the next daily budget", (t) => {
  const { x, scope, first, second, secondInput } = managedBudgetPair(t);
  x.now("2026-10-19T15:59:00Z");
  const claimed = claimNext(x, first.run.id);
  assert.equal(claimed.operation.budgetDate, "2026-10-19");
  const restarted = new w.ProductionFlowService(x.repo, x.options);
  assert.equal(restarted.context(first.run.id).run.state, "unknown");
  assert.equal(
    restarted.startManagedInboxEvaluation(secondInput).id,
    second.id,
  );
  let pending = restarted.next({ id: second.id });
  assert.throws(
    () =>
      restarted.claim({
        id: second.id,
        expectedRevision: pending.run.revision,
      }),
    /TEXT_BUDGET_INSUFFICIENT/,
  );
  assert.equal(
    x.repo.all("workflowLedger").some((e) => e.kind === "release"),
    false,
  );
  x.now("2026-10-19T16:00:00Z");
  pending = restarted.next({ id: second.id });
  const nextDay = restarted.claim({
    id: second.id,
    expectedRevision: pending.run.revision,
  });
  assert.equal(nextDay.operation.budgetDate, "2026-10-20");
  assert.equal(nextDay.operation.budgetScope, scope);
  assert.equal(x.repo.all("operations").length, 2);
});
