const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto");
const { Studio, tickPlanCenter } = require(process.env.RAINFALL_ROUTING_BUNDLE);
require("node:net").Socket.prototype.connect = function () {
  throw Error("NO_EXTERNAL_NETWORK");
};
function fixture(t) {
  const s = new Studio(
    path.resolve("output/test-runs/routing-" + randomUUID()),
    "production",
  );
  t.after(() => s.close());
  return { s, artist: s.all("artists")[0], call: (m, i) => s.call(m, i) };
}
async function profile(x, kind, providerId, modelId) {
  return x.call("apiProfile.save", {
    profile: {
      id: randomUUID(),
      kind,
      providerId,
      label: providerId + " test",
      modelId,
      executionEnabled: false,
    },
    expectedRevision: null,
  });
}
async function defaults(x, role, profileId) {
  const old = await x.call("generationConfig.read");
  return x.call("generationConfig.save", {
    role,
    profileId,
    expectedRevision: old.revision,
  });
}
function plan(x, extra = {}) {
  return {
    id: randomUUID(),
    title: "Routing test",
    artistId: x.artist.id,
    enabled: false,
    schedule: { kind: "daily", localTime: "09:00" },
    theme: "An original story",
    styleTemplate: "",
    material: { source: "provider" },
    text: {},
    music: { route: "manual" },
    routing: {
      text: { source: "default" },
      image: { source: "default" },
      music: { source: "default" },
    },
    outputs: { lyrics: true, cover: false, music: false },
    ...extra,
  };
}
test("three independent defaults preserve legacy profiles and reject cross-role or secret injection", async (t) => {
  const x = fixture(t),
    p = await profile(x, "text", "doubao", "ep-test"),
    music = await profile(x, "music", "yourmusic", "chirp-v6"),
    image = await profile(x, "image", "local_image", null);
  let d = await x.call("generationConfig.read");
  assert.deepEqual(d.roles, { text: null, image: null, music: null });
  await defaults(x, "text", p.id);
  await defaults(x, "music", music.id);
  await defaults(x, "image", image.id);
  d = await x.call("generationConfig.read");
  assert.equal(d.roles.text, p.id);
  assert.equal(d.roles.image, image.id);
  assert.equal(d.roles.music, music.id);
  await assert.rejects(
    () => defaults(x, "image", p.id),
    /GENERATION_ROLE_MISMATCH/,
  );
  await assert.rejects(() =>
    x.call("generationConfig.save", {
      role: "text",
      profileId: p.id,
      expectedRevision: d.revision,
      secret: "never",
    }),
  );
  assert.equal(
    (await x.call("apiProfile.list")).find((v) => v.id === p.id).revision,
    p.revision,
  );
});
test("plan execution freezes independent routes and changing defaults never rewrites an existing run", async (t) => {
  const x = fixture(t),
    a = await profile(x, "text", "doubao", "ep-a"),
    b = await profile(x, "text", "deepseek", "deepseek-flash"),
    image = await profile(x, "image", "dot_image", null),
    music = await profile(x, "music", "yourmusic", "chirp-v6");
  for (const [r, p] of [
    ["text", a],
    ["image", image],
    ["music", music],
  ])
    await defaults(x, r, p.id);
  const pc = x.s.planCenterService(),
    p = pc.save({
      plan: plan(x, { outputs: { lyrics: true, cover: true, music: true } }),
      expectedRevision: null,
    });
  assert.equal(p.routeSnapshot.text.profileId, a.id);
  assert.equal(p.routeSnapshot.image.providerId, "dot_image");
  assert.equal(p.routeSnapshot.music.modelId, "chirp-v6");
  assert.equal(p.music.profileId, music.id);
  assert.equal(p.music.route, "pule");
  const preview = pc.preview({ id: p.id }),
    r = pc.run({
      id: p.id,
      expectedRevision: p.revision,
      summaryHash: preview.summaryHash,
      requestId: randomUUID(),
      source: "manual",
    });
  await defaults(x, "text", b.id);
  assert.equal(
    pc.list().runs.find((v) => v.id === r.id).snapshot.text.profileId,
    a.id,
  );
  pc.stop({ runId: r.id });
  const pv = pc.preview({ id: p.id }),
    r2 = pc.run({
      id: p.id,
      expectedRevision: p.revision,
      summaryHash: pv.summaryHash,
      requestId: randomUUID(),
      source: "manual",
    });
  assert.equal(r2.state, "blocked");
  assert.equal(
    pc.list().items.find((i) => i.runId === r2.id).reason,
    "ROUTE_DEFAULT_CHANGED",
  );
  assert.equal(x.s.all("operations").length, 0);
});
test("manual generation uses the same real plan/provider route and keeps request replay pinned", async (t) => {
  const x = fixture(t),
    p = await profile(x, "text", "doubao", "ep-manual");
  await defaults(x, "text", p.id);
  const input = {
    requestId: randomUUID(),
    artistId: x.artist.id,
    storyBeat: "A rainy street",
    storyStage: "meeting",
    styleTemplate: "华语流行、民谣、木吉他、轻鼓组",
    outputs: { lyrics: true, cover: false, music: false },
    text: { consent: false },
    music: { consent: false },
  };
  const a = await x.call("manualCreation.prepare", input);
  assert.equal(a.run.snapshot.text.profileId, p.id);
  assert.equal(a.run.snapshot.routeSnapshot.text.modelId, "ep-manual");
  assert.equal(a.run.snapshot.styleTemplate, input.styleTemplate);
  tickPlanCenter(x.s);
  assert.equal(x.s.all("operations").length, 0);
  const other = await profile(x, "text", "deepseek", "deepseek-flash");
  await defaults(x, "text", other.id);
  assert.equal(
    (await x.call("manualCreation.prepare", input)).run.id,
    a.run.id,
  );
  await assert.rejects(
    () => x.call("manualCreation.prepare", { ...input, storyBeat: "changed" }),
    /IDEMPOTENCY_CONFLICT/,
  );
});
test("cover requests use image defaults only, freeze external import routing and refuse unavailable image APIs", async (t) => {
  const x = fixture(t),
    text = await profile(x, "text", "doubao", "ep-text"),
    image = await profile(x, "image", "local_image", null);
  await defaults(x, "text", text.id);
  await defaults(x, "image", image.id);
  const work = await x.call("work.save", {
    title: "Original cover test",
    artistId: x.artist.id,
    story: "A story",
    lyrics: "[Verse]\nRain\n[Chorus]\nHome",
    prompt: "warm pop",
    parameters: {},
    rights: "Local test",
    ai: "assisted",
  });
  const input = { workId: work.id, requestId: randomUUID(), brief: "rain" };
  const request = await x.call("cover.request", input);
  assert.equal(request.generationRoute.role, "image");
  assert.equal(request.generationRoute.profileId, image.id);
  assert.equal(request.generationRoute.capability, "external_import");
  const pending = await profile(x, "image", "image_pending", "unverified");
  await defaults(x, "image", pending.id);
  assert.equal(
    (await x.call("cover.request", input)).generationRoute.profileId,
    image.id,
  );
  await assert.rejects(
    () => x.call("cover.request", { ...input, requestId: randomUUID() }),
    /IMAGE_ADAPTER_UNAVAILABLE/,
  );
  assert.equal(x.s.all("operations").length, 0);
});

test("artist revision and story are frozen into the actual provider prompt, later edits do not rewrite them", async (t) => {
  const x = fixture(t);
  x.artist = await x.call("artist.save", {
    id: x.artist.id,
    expected: x.artist.revision,
    name: "Original Artist",
    defaults: {
      ...x.artist.defaults,
      instruments: "piano and strings",
      seriesStory: "meeting to confession",
    },
  });
  let p = await profile(x, "text", "doubao", "ep-style");
  const { revision, ...meta } = p;
  p = await x.call("apiProfile.save", {
    profile: {
      ...meta,
      textPricing: {
        currency: "CNY",
        modelId: "ep-style",
        inputMicrosPerMillionTokens: 1000000,
        outputMicrosPerMillionTokens: 2000000,
        source: "offline test",
        version: "test-v1",
        responseModelIds: ["ep-style"],
      },
    },
    expectedRevision: revision,
  });
  await defaults(x, "text", p.id);
  const input = {
    requestId: randomUUID(),
    artistId: x.artist.id,
    storyBeat: "A rainy street",
    storyStage: "first meeting",
    outputs: { lyrics: true, cover: false, music: false },
    text: { consent: true, budgetMicros: 1000000 },
    music: { consent: false },
  };
  const result = await x.call("manualCreation.prepare", input);
  assert.equal(result.run.snapshot.artistSnapshot.revision, x.artist.revision);
  assert.equal(
    result.run.snapshot.artistSnapshot.defaults.instruments,
    "piano and strings",
  );
  await x.call("artist.save", {
    id: x.artist.id,
    expected: x.artist.revision,
    name: "Renamed",
    defaults: { ...x.artist.defaults, instruments: "guitar" },
  });
  tickPlanCenter(x.s);
  const job = x.s.repo
    .all("settings")
    .find((row) => row.value?.kind === "provider_text")?.value;
  assert.ok(job, "actual provider job is prepared");
  assert.match(job.styleTemplate, /piano and strings/);
  assert.match(job.styleTemplate, /meeting to confession/);
  assert.match(job.theme, /first meeting/);
  assert.equal(
    x.s
      .planCenterService()
      .list()
      .runs.find((r) => r.id === result.run.id).snapshot.artistSnapshot.name,
    "Original Artist",
  );
  assert.equal(x.s.all("operations").length, 0);
});

test("public binding entry cannot fabricate verified identity or open an unsupported adapter", async (t) => {
  const x = fixture(t),
    account = await x.call("account.save", {
      provider: "tme",
      name: "Local test",
      dailyLimit: 3,
    });
  const before = x.s.all("bindings");
  assert.deepEqual(await x.call("accountIdentity.list"), []);
  const selection = {
    artistId: x.artist.id,
    accountId: account.id,
    provider: "tme",
  };
  const result = await x.call("accountIdentity.start", selection);
  assert.equal(result.reason, "IDENTITY_ADAPTER_UNVERIFIED");
  assert.equal(result.bindingState, "unsupported");
  await assert.rejects(() =>
    x.call("accountIdentity.start", {
      ...selection,
      remoteAccountId: "injected",
      remoteArtistId: "injected",
      bindingState: "bound",
    }),
  );
  assert.deepEqual(x.s.all("bindings"), before);
  assert.equal(x.s.externalRequests, 0);
});

test("manual DeepSeek and Doubao execute the frozen route through Main broker fixture and save original final text works", async (t) => {
  const { ProviderTextService, createProviderTextBroker } = require(
      process.env.RAINFALL_ROUTING_BUNDLE,
    ),
    { draft } = require("./fixtures/workflow.cjs");
  for (const providerId of ["deepseek", "doubao"]) {
    const x = fixture(t);
    let p = await profile(x, "text", providerId, "fixture-" + providerId);
    const { revision, ...meta } = p;
    p = await x.call("apiProfile.save", {
      profile: {
        ...meta,
        textPricing: {
          currency: providerId === "doubao" ? "CNY" : "USD",
          modelId: p.modelId,
          inputMicrosPerMillionTokens: 1000,
          outputMicrosPerMillionTokens: 1000,
          source: "offline fixture",
          version: "v1",
          responseModelIds: [p.modelId],
        },
      },
      expectedRevision: revision,
    });
    await defaults(x, "text", p.id);
    const created = await x.call("manualCreation.prepare", {
        requestId: randomUUID(),
        artistId: x.artist.id,
        storyBeat: "Original rainy street story",
        storyStage: "first meeting",
        styleTemplate: "华语流行、R&B、温暖、轻鼓组",
        outputs: { lyrics: true, cover: false, music: false },
        text: { consent: true, budgetMicros: 1000000 },
        music: { consent: false },
      }),
      text = new ProviderTextService(x.s.repo, { recover: false }),
      requests = [];
    const rpc = async (method, input) => {
      if (method === "internal.providerText.list") return text.list();
      if (method === "internal.providerText.claim") return text.claim(input);
      if (method === "internal.providerText.context")
        return text.context(input.id);
      if (method === "internal.providerText.record") return text.record(input);
      if (method === "internal.providerText.note") return text.note(input);
      throw Error("RPC_NOT_ALLOWED:" + method);
    };
    const broker = createProviderTextBroker({
      rpc: async (m, i) => ({ ok: true, value: await rpc(m, i) }),
      available: () => true,
      credentials: {
        apiCredentialStatus: async () => ({ configured: true }),
        withProviderTextAdapter: async (_input, cb) =>
          cb({
            invoke: async (request, guard) => {
              await guard();
              requests.push(request);
              const job = text.context(request.jobId).job,
                quote = job.pair?.lyrics
                  .split("\n")
                  .find((l) => l.length >= 4 && !l.startsWith("[")),
                content =
                  request.phase === "score"
                    ? {
                        revisionId: job.draftId,
                        dimensions: { lyrics: 85, style: 85, coherence: 85 },
                        findings: [
                          '[lyrics] "' +
                            quote +
                            '" supports the original scene and narrative.',
                        ],
                      }
                    : draft();
              return {
                operationId: request.operationId,
                providerId: request.providerId,
                requestedModelId: request.modelId,
                status: "complete",
                providerRequestId: "offline-" + request.operationId,
                providerModel: request.modelId,
                finishReason: "stop",
                httpStatus: 200,
                usage: {
                  promptTokens: 100,
                  completionTokens: 200,
                  cachedTokens: 0,
                },
                content: JSON.stringify(content),
                reason: null,
              };
            },
          }),
      },
    });
    tickPlanCenter(x.s);
    await broker.pump();
    tickPlanCenter(x.s);
    await broker.pump();
    tickPlanCenter(x.s);
    tickPlanCenter(x.s);
    tickPlanCenter(x.s);
    assert.equal(
      requests.length,
      2,
      JSON.stringify({
        jobs: text.list(),
        stages: x.s.planCenterService().list().stageAttempts,
      }),
    );
    assert.ok(
      requests.every(
        (r) =>
          r.providerId === providerId &&
          r.profileId === p.id &&
          r.modelId === p.modelId,
      ),
    );
    assert.match(requests[0].messages[1].content, /first meeting/);
    assert.match(requests[0].messages[1].content, /华语流行、R&B、温暖、轻鼓组/);
    const run = x.s
        .planCenterService()
        .list()
        .runs.find((r) => r.id === created.run.id),
      item = x.s
        .planCenterService()
        .list()
        .items.find((i) => i.runId === created.run.id);
    assert.equal(run.state, "completed");
    assert.ok(item.workId, "lyrics-only final is saved into library");
    const work = x.s.get("works", item.workId);
    assert.ok(work.lyrics.length > 20);
    assert.equal(work.artistSnapshot.id, x.artist.id);
    assert.equal(work.assets.audio_A, undefined);
    assert.equal(x.s.externalRequests, 0);
    broker.stop();
  }
});

test("queued publication rechecks the frozen identity at each write and uncertain submissions require reconciliation", async (t) => {
  const x = fixture(t),
    { assertTaskIdentity } = require(process.env.RAINFALL_ROUTING_BUNDLE),
    account = await x.call("account.save", {
      provider: "tme",
      name: "Offline identity scope",
      dailyLimit: 3,
    }),
    id = randomUUID(),
    workId = randomUUID(),
    runId = randomUUID(),
    bindingId = randomUUID();
  const frozen = {
      bindingId,
      bindingRevision: 1,
      artistId: x.artist.id,
      accountId: account.id,
      provider: "tme",
      namespace: "offline-explicit",
      remoteAccountId: "account-1",
      remoteArtistId: "artist-1",
    },
    target = {
      platform: "qqmusic",
      accountId: account.id,
      enabled: true,
      identityBindingId: bindingId,
      identitySnapshot: frozen,
    };
  x.s.save("settings", {
    id: "unified-publication:v1:" + id,
    value: {
      id,
      workId,
      accountId: account.id,
      targets: ["qqmusic"],
      state: "preparing",
    },
  });
  x.s.save("settings", {
    id: "plan-publication:v1:offline",
    value: {
      publicationTaskId: id,
      runId,
      workId,
      accountId: account.id,
      platform: "qqmusic",
    },
  });
  x.s.save("settings", {
    id: "plan-center:run:" + runId,
    value: {
      id: runId,
      snapshot: {
        artistId: x.artist.id,
        routing: {},
        publishTargets: [target],
      },
    },
  });
  let checks = 0,
    revoked = false;
  x.s.accountIdentityService = () => ({
    assertPublishScope: (scope) => {
      checks++;
      assert.deepEqual(scope, { ...frozen, externalState: "not_started" });
      if (revoked) throw Error("BINDING_REVOKED");
    },
  });
  assertTaskIdentity(x.s, id);
  revoked = true;
  assert.throws(() => assertTaskIdentity(x.s, id), /BINDING_REVOKED/);
  assert.equal(checks, 2);
  revoked = false;
  x.s.save("operations", {
    id: randomUUID(),
    kind: "tme_ai_submission",
    phase: "submit",
    receiptScope: { workId },
    state: "unknown",
  });
  assert.throws(() => assertTaskIdentity(x.s, id), /RECONCILIATION_REQUIRED/);
  assert.equal(checks, 2);
});
test("long manual stories remain intact and authorized music cannot silently switch selected model", async (t) => {
  const x = fixture(t),
    text = await profile(x, "text", "doubao", "ep-long"),
    music = await profile(x, "music", "yourmusic", "chirp-v6");
  await defaults(x, "text", text.id);
  await defaults(x, "music", music.id);
  const story = "original ".repeat(700);
  const r = await x.call("manualCreation.prepare", {
    requestId: randomUUID(),
    artistId: x.artist.id,
    storyBeat: story,
    outputs: { lyrics: true, cover: false, music: false },
    text: { consent: false },
    music: { consent: false },
  });
  assert.equal(r.run.snapshot.storyContext.storyBeat, story.trim());
  assert.throws(
    () =>
      x.s
        .planCenterService()
        .save({
          plan: plan(x, {
            outputs: { lyrics: true, cover: false, music: true },
            music: {
              route: "pule",
              profileId: music.id,
              profileRevision: music.revision,
              modelId: "chirp-v6-wild",
              consent: true,
            },
            authorization: { text: false, music: true, publish: false },
          }),
          expectedRevision: null,
        }),
    /MUSIC_ROUTE_CONFIRMATION_MISMATCH/,
  );
});

test("music-owned cover keeps its frozen image override and work-only grants cannot bypass identity", async (t) => {
  const x = fixture(t),
    { assertWorkIdentityWrite } = require(process.env.RAINFALL_ROUTING_BUNDLE),
    text = await profile(x, "text", "doubao", "ep-music"),
    image = await profile(x, "image", "dot_image", null),
    local = await profile(x, "image", "local_image", null),
    music = await profile(x, "music", "yourmusic", "chirp-v6");
  await defaults(x, "text", text.id);
  await defaults(x, "image", local.id);
  await defaults(x, "music", music.id);
  const pc = x.s.planCenterService(),
    p = pc.save({
      plan: plan(x, {
        outputs: { lyrics: true, cover: true, music: true },
        routing: {
          text: { source: "default" },
          image: { source: "override", profileId: image.id },
          music: { source: "default" },
        },
      }),
      expectedRevision: null,
    }),
    pv = pc.preview({ id: p.id }),
    r = pc.run({
      id: p.id,
      expectedRevision: p.revision,
      summaryHash: pv.summaryHash,
      requestId: randomUUID(),
      source: "manual",
    }),
    item = pc.list().items.find((i) => i.runId === r.id),
    work = await x.call("work.save", {
      title: "Original music work",
      artistId: x.artist.id,
      story: "Original story",
      lyrics: "[Verse]\nRain falls\n[Chorus]\nHome again",
      prompt: "warm pop",
      parameters: {},
      rights: "Pending user review",
      ai: "generated",
    });
  pc.bindWork({ itemId: item.id, workId: work.id, versions: [] });
  const request = await x.call("cover.request", {
    workId: work.id,
    requestId: randomUUID(),
    brief: "Original offline cover",
  });
  assert.equal(request.generationRoute.profileId, image.id);
  assert.equal(request.generationRoute.source, "override");
  assert.throws(
    () => assertWorkIdentityWrite(x.s, { workId: work.id }),
    /IDENTITY_PUBLICATION_TASK_REQUIRED/,
  );
  const stray = randomUUID();
  x.s.save("settings", {
    id: "unified-publication:v1:" + stray,
    value: {
      id: stray,
      workId: work.id,
      accountId: randomUUID(),
      targets: ["qqmusic"],
      state: "queued",
    },
  });
  assert.throws(
    () =>
      assertWorkIdentityWrite(x.s, {
        workId: work.id,
        publicationTaskId: stray,
      }),
    /PLATFORM_ARTIST_MAPPING_REQUIRED/,
  );
  assert.equal(x.s.externalRequests, 0);
});
