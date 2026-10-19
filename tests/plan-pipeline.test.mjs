import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { randomUUID, createHash } from "node:crypto";
const require = createRequire(import.meta.url),
  api = require(process.env.RAINFALL_PLAN_PIPELINE_BUNDLE),
  sharp = require("sharp");
const at = "2026-10-19T01:00:00.000Z",
  sha = (x) => createHash("sha256").update(x).digest("hex");
const evidence = [];
function recordEvidence(caseName, x) {
  const rows = x.center.list(),
    item = rows.items[0],
    child = x.flow.list().runs.find((r) => r.managedMusic),
    links = api.planPublicationStatus(x.s);
  evidence.push({
    case: caseName,
    runId: x.run.id,
    itemId: item.id,
    runState: rows.runs[0].state,
    stopRequested: rows.runs[0].stopRequested,
    childRunId: child?.id,
    childState: child?.state,
    workId: item.workId,
    versions: item.versions,
    selectedVersion: item.selectedVersion,
    stages: rows.stageAttempts.map((a) => ({
      stage: a.stage,
      state: a.state,
      childRunId: a.result?.childRunId,
      operationId: a.result?.operationId,
    })),
    calls: {
      score: x.events.filter((e) => e.kind === "text").length,
      submit: x.events.filter((e) => e.kind === "music-submit").length,
      query: x.events.filter((e) => e.kind === "query").length,
      download: x.events.filter((e) => e.kind === "download").length,
    },
    publication: links.map((l) => ({
      publicationTaskId: l.publicationTaskId,
      state: l.state,
      onlineVerified: l.onlineVerified,
      reason: l.reason,
    })),
  });
  fs.writeFileSync(
    path.resolve("output/provider-wiring/plan-pipeline-evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
}
function draft() {
  const prompt = {
    positiveStyle: "Warm acoustic pop, gentle female lead and quiet piano",
    negativeStyle: "",
    durationTarget: 180,
    voiceArrangement: "female",
  };
  return {
    title: "Rain beside the station",
    topic: "A quiet journey home",
    storyBeat: "Two old friends meet at the station after the rain",
    language: "English",
    style: "acoustic pop",
    instrumental: false,
    sections: [
      {
        id: "verse",
        kind: "Verse",
        lines: [
          "The evening train is slowing down",
          "Your window glows across the town",
          "I fold the map and find the street",
          "The rain keeps time beneath my feet",
        ],
      },
      {
        id: "chorus",
        kind: "Chorus",
        lines: [
          "Leave one light beside the door",
          "I know the steps I knew before",
          "The road is long but we are near",
          "Your voice is all I want to hear",
        ],
      },
    ],
    hook: { sectionId: "chorus", startLine: 0, endLine: 4 },
    vocalPlan: [
      { sectionId: "verse", voice: "female" },
      { sectionId: "chorus", voice: "female" },
    ],
    musicPrompts: { suno: prompt, yourmusic: prompt },
    continuityNotes: "Original isolated offline fixture",
  };
}
function wav(seed) {
  const samples = 8000,
    b = Buffer.alloc(44 + samples * 2);
  b.write("RIFF");
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WAVE", 8);
  b.write("fmt ", 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(16000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    b.writeInt16LE(Math.round(Math.sin(i * seed) * 400), 44 + i * 2);
  return b;
}
async function setup(t, { stopOnSubmit = false, musicUnknown = false } = {}) {
  const root = path.resolve("output/test-runs/plan-pipeline-" + randomUUID()),
    s = new api.Studio(root, "production", { now: () => new Date(at) });
  t.after(() => s.close());
  const artistId = s.all("artists")[0].id,
    textId = randomUUID(),
    musicId = randomUUID(),
    accountId = randomUUID();
  const channel = {
    id: "pipeline-channel",
    workspaceId: "pipeline-workspace",
    workspaceRef: "pipeline-workspace-ref",
    artistRefs: { author: artistId },
    seriesRefs: {},
  };
  s.save("settings", {
    id: "inbox-channel",
    channel,
    revision: 1,
    enabled: true,
  });
  for (const [id, kind, providerId] of [
    [textId, "text", "deepseek"],
    [musicId, "music", "yourmusic"],
  ])
    s.save("settings", {
      id: "api-profile:" + id,
      kind,
      providerId,
      label: "pipeline offline fixture",
      revision: 1,
      executionEnabled: false,
      modelId: null,
    });
  s.save("accounts", {
    id: accountId,
    provider: "tme",
    name: "Isolated pipeline account",
    remoteSubject: "1".repeat(64),
  });
  s.save("settings", {
    id: "simple-publishing:platform:v1:qqmusic",
    value: {
      version: 1,
      revision: 1,
      target: "qqmusic",
      accountId,
      artistId,
      lyricist: "Offline writer",
      composer: "Offline composer",
      album: "Pipeline album",
      genre: "pop",
      language: "en",
      aiDisclosure: "generated",
      isCover: false,
    },
  });
  const center = s.planCenterService(),
    plan = center.save({
      plan: {
        id: randomUUID(),
        title: "Offline complete pipeline",
        artistId,
        schedule: { kind: "daily", localTime: "09:00" },
        count: 1,
        theme: "Quiet journey home",
        outputs: { lyrics: true, cover: true, music: true },
        material: { source: "dot", channel: channel.id, identity: "author" },
        text: {
          profileId: textId,
          profileRevision: 1,
          modelId: "deepseek-flash",
          maxOutputTokens: 2048,
          budgetMicros: 100000,
          threshold: 75,
          consent: true,
        },
        music: {
          route: "yourmusic",
          profileId: musicId,
          profileRevision: 1,
          modelId: "chirp-v6-mini",
          maxCostPerRequestCredits: 10,
          budgetCredits: 10,
          creditPolicy: {
            mode: "existing_credits",
            noRecharge: true,
            actualCostUnknown: true,
            consent: true,
          },
          consent: true,
          versionPolicy: "manual",
        },
        authorization: { text: true, music: true, publish: true },
        publishTargets: [
          {
            platform: "qqmusic",
            accountId,
            enabled: true,
            album: { mode: "existing", albumId: "offline-album" },
          },
        ],
      },
      expectedRevision: null,
    });
  const preview = center.preview({ id: plan.id }),
    run = center.run({
      id: plan.id,
      expectedRevision: plan.revision,
      summaryHash: preview.summaryHash,
      requestId: randomUUID(),
      source: "manual",
    }),
    item = center.list().items[0];
  const events = [],
    textAdapter = new api.DeepSeekAdapter({
      credential: async () => "offline-text-fixture",
      request: async (req) => {
        assert.equal(req.url, "https://api.deepseek.com/chat/completions");
        events.push({ kind: "text", request: req });
        const request = JSON.parse(req.body.messages[1].content),
          phrase = request.pair.lyrics
            .split("\n")
            .find((x) => !x.startsWith("[") && x.length >= 4);
        return {
          status: 200,
          body: {
            id: "offline-score-" + events.length,
            model: "deepseek-flash",
            choices: [
              {
                finish_reason: "stop",
                message: {
                  content: JSON.stringify({
                    revisionId: request.revisionId,
                    dimensions: { lyrics: 85, style: 85, coherence: 85 },
                    findings: [
                      '[lyrics] "' +
                        phrase +
                        '" establishes the concrete setting with consistent narrative detail.',
                    ],
                  }),
                },
              },
            ],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 200,
              prompt_cache_hit_tokens: 0,
              prompt_cache_miss_tokens: 100,
            },
          },
        };
      },
    }),
    musicAdapter = new api.YourMusicAdapter({
      source: "fixture",
      credential: async () => "offline-music-fixture",
      request: async (req) => {
        events.push({
          kind:
            req.method === "POST"
              ? "music-submit"
              : req.binary
                ? "download"
                : "query",
          request: req,
        });
        if (req.method === "POST") {
          const child = s
            .productionFlowService()
            .list()
            .runs.find((r) => r.managedMusic);
          assert.equal(
            s.productionFlowService().context(child.id).operation.state,
            "dispatching",
          );
          assert.equal(req.body.model, "chirp-v6-mini");
          if (stopOnSubmit)
            api.executePlanCenter(s, "planCenter.stop", { runId: run.id });
          if (musicUnknown)
            return { status: 503, body: { error: "offline unknown outcome" } };
          return {
            status: 202,
            body: {
              task_id: "pipeline-task",
              status: "pending",
              songs: [
                { id: "pipeline-A", status: "pending" },
                { id: "pipeline-B", status: "pending" },
              ],
            },
          };
        }
        if (!req.binary) {
          assert(req.url.endsWith("songid=pipeline-A%2Cpipeline-B"));
          return {
            status: 200,
            body: ["pipeline-B", "pipeline-A"].map((id) => ({
              id,
              status: "succeeded",
              audio_url: "https://oss.yourmusic.fun/" + id + ".wav",
              title: draft().title,
              lyric: "Original provider lyric for " + id,
              duration: 1,
            })),
          };
        }
        assert.equal(req.headers, undefined);
        return {
          status: 200,
          headers: { "content-type": "audio/wav" },
          body: wav(req.url.includes("pipeline-A") ? 0.2 : 0.4),
        };
      },
    });
  const flow = s.productionFlowService(),
    broker = api.createProductionFlowBroker({
      available: () => true,
      generation: () => 1,
      credentials: {
        apiCredentialStatus: async () => ({ configured: true }),
        withDeepSeekAdapter: async (_id, fn, guard) => {
          guard();
          return fn(textAdapter);
        },
        withMusicAdapter: async (_id, fn, guard) => {
          guard();
          return fn(musicAdapter);
        },
      },
      publication: {
        capability: () => ({
          available: false,
          reasons: ["OFFLINE_PUBLICATION_DISABLED"],
        }),
      },
      rpc: async (method, input) => {
        try {
          const action = method.split(".").at(-1);
          return {
            ok: true,
            value:
              action === "importAudio"
                ? await api.importProductionAudio(s, input)
                : flow[action](input),
          };
        } catch (e) {
          return { ok: false, error: { code: e.message } };
        }
      },
    });
  const coverFile = path.join(root, "fixture-cover.png");
  await sharp({
    create: { width: 3000, height: 3000, channels: 3, background: "#23566a" },
  })
    .png()
    .toFile(coverFile);
  const importedCover = await s.importFile(coverFile, "cover");
  api.tickPlanCenter(s);
  const request = api.planDotStatus(s).requests[0];
  assert.equal(request.itemId, item.id);
  const textPackage = {
    schemaVersion: 2,
    batchId: randomUUID(),
    createdAt: at,
    targetWorkspaceRef: channel.workspaceRef,
    items: [
      {
        externalItemId: request.expectedExternalItemId,
        revision: request.revision,
        parentRevision: null,
        artistRef: "author",
        seriesRef: null,
        draft: draft(),
        provenance: {
          producer: "offline-pipeline-dot",
          model: null,
          promptVersion: null,
          generatedAt: at,
        },
        requestEcho: request,
      },
    ],
  };
  const cover = {
    id: importedCover.id,
    sha256: importedCover.sha256,
    kind: "image",
    ext: "png",
    mime: "image/png",
    bytes: importedCover.bytes,
    metadata: { width: 3000, height: 3000 },
    createdAt: at,
    source: "offline-pipeline",
    label: "Offline pipeline cover",
  };
  const manifest = {
    deliveryVersion: 1,
    deliveryId: "pipeline-delivery",
    createdAt: at,
    targetWorkspaceRef: channel.workspaceRef,
    text: { file: "text.json", sha256: sha(JSON.stringify(textPackage)) },
    images: [
      {
        externalItemId: request.expectedExternalItemId,
        revision: request.revision,
        role: "cover",
        file: "cover-" + cover.sha256 + ".png",
        sha256: cover.sha256,
        bytes: cover.bytes,
        mimeType: "image/png",
        width: 3000,
        height: 3000,
        provenance: {
          producer: "offline-pipeline-dot",
          model: null,
          generatedAt: at,
        },
      },
    ],
  };
  const delivery = new api.DotDeliveryStore(s.repo, channel, s.now),
    receipt = delivery.commit({
      manifest,
      manifestSha256: sha(JSON.stringify(manifest)),
      textPackage,
      images: [
        {
          externalItemId: request.expectedExternalItemId,
          revision: request.revision,
          asset: cover,
        },
      ],
    });
  assert.deepEqual(
    delivery.commit({
      manifest,
      manifestSha256: sha(JSON.stringify(manifest)),
      textPackage,
      images: [
        {
          externalItemId: request.expectedExternalItemId,
          revision: request.revision,
          asset: cover,
        },
      ],
    }),
    receipt,
  );
  return {
    s,
    center,
    plan,
    run,
    item,
    events,
    broker,
    receipt,
    cover,
    flow,
    step: async () => {
      api.tickPlanCenter(s);
      await broker.pump();
      api.tickPlanCenter(s);
    },
  };
}
function stage(x, name) {
  return x.center
    .list()
    .stageAttempts.find((a) => a.itemId === x.item.id && a.stage === name);
}

test("real PlanCenter tick consumes exact dot delivery, scores, generates and confirms B into unified publication journal", async (t) => {
  const x = await setup(t);
  for (let i = 0; i < 8; i++) await x.step();
  const rows = x.center.list(),
    item = rows.items[0],
    work = x.s.get("works", item.workId);
  assert.equal(
    api.planDotStatus(x.s).associations[0].candidateId,
    x.receipt.items[0].candidateId,
  );
  assert.equal(stage(x, "text_score").state, "succeeded");
  assert.equal(stage(x, "text_score").result.assessment.source, "model-scored");
  assert.equal(stage(x, "music_submit").state, "succeeded");
  assert.equal(stage(x, "music_assets").state, "succeeded");
  assert.equal(x.events.filter((e) => e.kind === "text").length, 1);
  assert.equal(x.events.filter((e) => e.kind === "music-submit").length, 1);
  assert.equal(x.events.filter((e) => e.kind === "download").length, 2);
  assert.deepEqual(
    item.versions.map((v) => [v.version, v.externalId]),
    [
      ["A", "pipeline-A"],
      ["B", "pipeline-B"],
    ],
  );
  assert.equal(
    work.audioVersions[0].providerMetadata.lyric,
    "Original provider lyric for pipeline-A",
  );
  assert.equal(x.s.all("works").length, 1);
  assert.equal(
    work.assets.cover,
    x.cover.id,
    "verified dot cover must remain bound to the same managed work",
  );
  assert.equal(
    item.selectedVersion,
    undefined,
    "manual policy must wait for a choice",
  );
  assert.equal(item.materials, undefined);
  api.executePlanCenter(x.s, "planCenter.selectVersion", {
    itemId: item.id,
    version: "B",
  });
  const preview = api.executePlanCenter(x.s, "planCenter.materialPreview", {
    id: item.id,
  });
  api.executePlanCenter(x.s, "planCenter.confirmMaterials", {
    itemId: item.id,
    expectedWorkRevision: preview.workRevision,
    audioHash: preview.audio.sha256,
    coverHash: preview.cover.sha256,
    lyricsHash: preview.lyrics.plainHash,
    rightsStatement:
      "I own this original isolated composition, recording and cover.",
    confirmed: true,
  });
  for (let i = 0; i < 4; i++) await x.step();
  const final = x.center.list().items[0],
    links = api.planPublicationStatus(x.s),
    tasks = api.unifiedPublicationService(x.s).list();
  assert.equal(final.materials.selectedVersion, "B");
  assert.equal(final.materials.audioAssetId, work.assets.audio_B);
  assert.equal(x.s.get("works", work.id).assets.audio_A, work.assets.audio_A);
  assert.equal(x.s.get("works", work.id).assets.audio_B, work.assets.audio_B);
  assert.equal(links.length, 1);
  assert.equal(tasks.length, 1);
  assert.equal(links[0].workId, work.id);
  assert.equal(links[0].accountId, x.run.snapshot.publishTargets[0].accountId);
  assert.equal(links[0].publicationTaskId, tasks[0].id);
  assert.equal(links[0].onlineVerified, false);
  assert.equal(links[0].reason, "ALBUM_CATALOG_REQUIRED");
  assert.equal(stage(x, "cover").state, "succeeded");
  assert.equal(stage(x, "materials").state, "succeeded");
  assert.equal(tasks[0].materialSnapshot.recordingSlot, "audio_B");
  assert.equal(tasks[0].materialSnapshot.audio.assetId, work.assets.audio_B);
  const id = links[0].publicationTaskId;
  await x.step();
  assert.equal(api.planPublicationStatus(x.s)[0].publicationTaskId, id);
  assert.equal(api.unifiedPublicationService(x.s).list().length, 1);
  assert.equal(x.events.filter((e) => e.kind === "music-submit").length, 1);
  recordEvidence("dot-score-music-select-B-confirm-publication", x);
});

test("stopping the real plan before managed music claim prevents every new music POST", async (t) => {
  const x = await setup(t);
  for (let i = 0; i < 6; i++) {
    api.tickPlanCenter(x.s);
    if (x.flow.list().runs.some((r) => r.managedMusic)) break;
    await x.broker.pump();
  }
  const child = x.flow.list().runs.find((r) => r.managedMusic);
  assert(child);
  assert.equal(x.events.filter((e) => e.kind === "music-submit").length, 0);
  api.executePlanCenter(x.s, "planCenter.stop", { runId: x.run.id });
  for (let i = 0; i < 5; i++) await x.step();
  assert.equal(x.flow.context(child.id).run.managedStopped, true);
  assert.equal(x.events.filter((e) => e.kind === "music-submit").length, 0);
  assert.equal(api.unifiedPublicationService(x.s).list().length, 0);
  assert.equal(x.s.all("works").length, 1);
  recordEvidence("stop-before-managed-claim", x);
});

test("unknown provider submission freezes the same plan stage and child across repeated pipeline ticks", async (t) => {
  const x = await setup(t, { musicUnknown: true });
  for (let i = 0; i < 10; i++) await x.step();
  const child = x.flow.list().runs.find((r) => r.managedMusic),
    attempt = stage(x, "music_submit");
  assert.equal(child.state, "unknown");
  assert.equal(attempt.state, "unknown");
  assert.equal(attempt.result.childRunId, child.id);
  assert.equal(x.events.filter((e) => e.kind === "music-submit").length, 1);
  assert.equal(x.events.filter((e) => e.kind === "query").length, 0);
  assert.equal(x.events.filter((e) => e.kind === "download").length, 0);
  assert.equal(
    x.center.list().stageAttempts.filter((a) => a.stage === "music_submit")
      .length,
    1,
  );
  assert.equal(x.s.all("works").length, 1);
  assert.equal(api.unifiedPublicationService(x.s).list().length, 0);
  recordEvidence("unknown-provider-never-repost", x);
});

test("stopping during original paid dispatch still collects exact A/B into stopped item and creates no publication", async (t) => {
  const x = await setup(t, { stopOnSubmit: true });
  for (let i = 0; i < 8; i++) await x.step();
  const rows = x.center.list(),
    item = rows.items[0],
    child = x.flow.list().runs.find((r) => r.managedMusic);
  assert.equal(rows.runs[0].stopRequested, true);
  assert.equal(child.managedStopped, true);
  assert.equal(child.state, "completed");
  assert.equal(child.assets.length, 2);
  assert.equal(item.workId, child.workId);
  assert.equal(item.versions.length, 2);
  assert.deepEqual(
    item.versions.map((v) => v.externalId),
    ["pipeline-A", "pipeline-B"],
  );
  assert.equal(item.materials, undefined);
  assert.equal(api.planPublicationStatus(x.s).length, 0);
  assert.equal(api.unifiedPublicationService(x.s).list().length, 0);
  assert.equal(x.events.filter((e) => e.kind === "music-submit").length, 1);
  assert.equal(x.events.filter((e) => e.kind === "download").length, 2);
  for (let i = 0; i < 3; i++) await x.step();
  assert.equal(x.events.filter((e) => e.kind === "music-submit").length, 1);
  recordEvidence("stop-inflight-original-output-collection", x);
});

test("a corrupt managed work fails only its own stage while another prepared plan and publication projection continue", async (t) => {
  const x = await setup(t);
  for (let i = 0; i < 6; i++) {
    api.tickPlanCenter(x.s);
    if (x.flow.list().runs.some((r) => r.managedMusic)) break;
    await x.broker.pump();
  }
  const child = x.flow.list().runs.find((r) => r.managedMusic);
  assert(child);
  assert.equal(x.events.filter((e) => e.kind === "music-submit").length, 0);

  // Seed a different plan already prepared through the established internal Core
  // fixture interfaces. Its remaining real tick work is material confirmation
  // projection and the existing publication journal; no second paid call is needed.
  const plan = x.center.save({
    plan: {
      ...x.plan,
      id: randomUUID(),
      title: "Independent prepared plan",
      music: { route: "manual", versionPolicy: "first" },
      authorization: { text: true, music: false, publish: true },
    },
    expectedRevision: null,
  });
  const view = x.center.preview({ id: plan.id });
  const run = x.center.run({
    id: plan.id,
    expectedRevision: plan.revision,
    summaryHash: view.summaryHash,
    requestId: randomUUID(),
    source: "manual",
  });
  const item = x.center.list().items.find((i) => i.runId === run.id);
  let work = x.s.saveWork({
    artistId: plan.artistId,
    title: "Independent prepared recording",
    lyrics: "Independent original first line\nIndependent original second line",
    story: "Isolated prepared fixture",
    prompt: "Warm acoustic original fixture",
    parameters: {},
    rights: "Owned original isolated fixture rights",
    ai: "assisted",
  });
  const audioFile = path.join(x.s.root, "independent-prepared.wav");
  fs.writeFileSync(audioFile, wav(0.6));
  const audio = await x.s.importFile(audioFile, "audio_A", work.id);
  await x.s.importFile(x.s.locate(x.cover.id).file, "cover", work.id);
  work = x.s.get("works", work.id);
  x.center.acceptDotCandidate({
    itemId: item.id,
    evidenceId: "independent-prepared-dot-fixture",
    candidate: {
      artistId: plan.artistId,
      channel: plan.material.channel,
      identity: plan.material.identity,
      externalItemId: item.expectedExternalItemId,
      title: work.title,
      lyrics: work.lyrics,
    },
  });
  api.executePlanCenter(x.s, "planCenter.bindWork", {
    itemId: item.id,
    workId: work.id,
    expectedWorkRevision: work.revision,
  });
  for (const stageName of [
    "text_score",
    "music_submit",
    "music_assets",
    "cover",
  ]) {
    const attempt = x.center.claim({
      runId: run.id,
      itemId: item.id,
      stage: stageName,
    });
    assert(attempt.id, JSON.stringify({ stageName, attempt }));
    const result =
      stageName === "text_score"
        ? { source: "model", score: 85 }
        : stageName === "music_assets"
          ? {
              versions: [
                { version: "A", assetId: audio.id, sha256: audio.sha256 },
              ],
            }
          : stageName === "cover"
            ? { assetId: x.cover.id, sha256: x.cover.sha256 }
            : { source: "existing-work", workId: work.id };
    x.center.record({
      attemptId: attempt.id,
      status: "succeeded",
      evidenceId: "independent-prepared-" + stageName,
      result,
    });
  }
  api.executePlanCenter(x.s, "planCenter.bindWork", {
    itemId: item.id,
    workId: work.id,
    expectedWorkRevision: work.revision,
  });
  const material = api.executePlanCenter(x.s, "planCenter.materialPreview", {
    id: item.id,
  });
  api.executePlanCenter(x.s, "planCenter.confirmMaterials", {
    itemId: item.id,
    expectedWorkRevision: material.workRevision,
    audioHash: material.audio.sha256,
    coverHash: material.cover.sha256,
    lyricsHash: material.lyrics.plainHash,
    rightsStatement:
      "I own this independent original fixture recording and cover.",
    confirmed: true,
  });
  assert.equal(
    x.center.next({ runId: run.id, itemId: item.id }).stage,
    "materials",
  );
  assert.equal(api.planPublicationStatus(x.s).length, 0);

  const badWork = x.s.get("works", child.workId);
  const foreignArtist = x.s.save("artists", {
    ...x.s.get("artists", badWork.artistId),
    id: randomUUID(),
    name: "Changed author fixture",
  });
  x.s.saveWork({
    ...badWork,
    expected: badWork.revision,
    artistId: foreignArtist.id,
  });
  const tickErrors = [];
  for (let i = 0; i < 3; i++) {
    try {
      api.tickPlanCenter(x.s);
    } catch (error) {
      tickErrors.push(error.message);
    }
    await x.broker.pump();
  }
  const outer = stage(x, "music_submit");
  const independentMaterials = x.center
    .list()
    .stageAttempts.find((a) => a.itemId === item.id && a.stage === "materials");
  const independentLinks = api
    .planPublicationStatus(x.s)
    .filter((l) => l.itemId === item.id);
  let stopError;
  try {
    api.executePlanCenter(x.s, "planCenter.stop", { runId: x.run.id });
  } catch (error) {
    stopError = error.message;
  }
  const snapshot = {
    tickErrors,
    outerState: outer.state,
    outerReason: outer.reason,
    independentMaterialsState: independentMaterials?.state ?? null,
    independentPublicationLinks: independentLinks.length,
    posts: x.events.filter((e) => e.kind === "music-submit").length,
    stopError: stopError ?? null,
    managedStopped: x.flow.context(child.id).run.managedStopped,
  };
  fs.writeFileSync(
    path.resolve("output/provider-wiring/plan-pipeline-isolation-current.json"),
    JSON.stringify(snapshot, null, 2),
  );
  if (tickErrors.length)
    fs.writeFileSync(
      path.resolve("output/provider-wiring/plan-pipeline-isolation-red.json"),
      JSON.stringify(snapshot, null, 2),
    );
  assert.deepEqual(
    tickErrors,
    [],
    "one corrupt work must not escape the root tick and starve later plans",
  );
  assert.equal(outer.state, "failed");
  assert.match(outer.reason, /MANAGED_MUSIC_WORK_SCOPE/);
  assert.equal(independentMaterials.state, "succeeded");
  assert.equal(independentLinks.length, 1);
  assert.equal(snapshot.posts, 0);
  assert.equal(stopError, undefined);
  assert.equal(snapshot.managedStopped, true);
});

async function unclaimedMusicChild(x) {
  for (let i = 0; i < 6; i++) {
    api.tickPlanCenter(x.s);
    const child = x.flow.list().runs.find((r) => r.managedMusic);
    if (child) {
      assert.equal(stage(x, "music_submit").state, "waiting");
      assert.equal(x.flow.context(child.id).operations.length, 0);
      assert.equal(x.events.filter((e) => e.kind === "music-submit").length, 0);
      return child;
    }
    await x.broker.pump();
  }
  assert.fail(
    "expected the actual tick to create an unclaimed managed music child",
  );
}
function changeManagedArtist(x, child) {
  const work = x.s.get("works", child.workId);
  const artist = x.s.save("artists", {
    ...x.s.get("artists", work.artistId),
    id: randomUUID(),
    name: "Changed managed recording author fixture",
  });
  x.s.saveWork({ ...work, expected: work.revision, artistId: artist.id });
}
function boundaryEvidence(name, snapshot, isRed) {
  fs.writeFileSync(
    path.resolve(
      "output/provider-wiring/plan-pipeline-" + name + "-current.json",
    ),
    JSON.stringify(snapshot, null, 2),
  );
  if (isRed)
    fs.writeFileSync(
      path.resolve(
        "output/provider-wiring/plan-pipeline-" + name + "-red.json",
      ),
      JSON.stringify(snapshot, null, 2),
    );
}

test("an original unknown POST remains outer unknown even when its work changes before the next tick", async (t) => {
  const x = await setup(t, { musicUnknown: true });
  const child = await unclaimedMusicChild(x);
  await x.broker.pump();
  assert.equal(x.flow.context(child.id).run.state, "unknown");
  assert.equal(
    stage(x, "music_submit").state,
    "waiting",
    "outer has not observed the original POST yet",
  );
  changeManagedArtist(x, child);
  const tickErrors = [];
  for (let i = 0; i < 3; i++) {
    try {
      api.tickPlanCenter(x.s);
    } catch (error) {
      tickErrors.push(error.message);
    }
    await x.broker.pump();
  }
  const outer = stage(x, "music_submit");
  const snapshot = {
    tickErrors,
    childState: x.flow.context(child.id).run.state,
    outerState: outer.state,
    outerReason: outer.reason,
    outerOperationId: outer.result?.operationId ?? null,
    outerChildRunId: outer.result?.childRunId ?? null,
    integrationError: outer.result?.integrationError ?? null,
    originalOperationId: x.flow.context(child.id).operation?.id,
    posts: x.events.filter((e) => e.kind === "music-submit").length,
    musicAttempts: x.center
      .list()
      .stageAttempts.filter((a) => a.stage === "music_submit").length,
  };
  boundaryEvidence(
    "unknown-after-work-change",
    snapshot,
    outer.state !== "unknown" || tickErrors.length > 0,
  );
  assert.deepEqual(tickErrors, []);
  assert.equal(
    outer.state,
    "unknown",
    "artifact changes cannot prove an already dispatched POST failed or was unsent",
  );
  assert.equal(snapshot.childState, "unknown");
  assert.equal(snapshot.posts, 1);
  assert.equal(snapshot.musicAttempts, 1);
  assert.equal(snapshot.outerChildRunId, child.id);
  assert.equal(snapshot.outerOperationId, snapshot.originalOperationId);
  assert.equal(snapshot.integrationError, "MANAGED_MUSIC_WORK_SCOPE");
});

test("stopping an undispatched child with changed work finishes stopping without adopting the corrupt work", async (t) => {
  const x = await setup(t);
  const child = await unclaimedMusicChild(x);
  changeManagedArtist(x, child);
  api.executePlanCenter(x.s, "planCenter.stop", { runId: x.run.id });
  const tickErrors = [];
  for (let i = 0; i < 3; i++) {
    try {
      api.tickPlanCenter(x.s);
    } catch (error) {
      tickErrors.push(error.message);
    }
    await x.broker.pump();
  }
  const outer = stage(x, "music_submit"),
    run = x.center.list().runs.find((r) => r.id === x.run.id);
  const snapshot = {
    tickErrors,
    outerState: outer.state,
    outerReason: outer.reason,
    runState: run.state,
    stopRequested: run.stopRequested,
    managedStopped: x.flow.context(child.id).run.managedStopped,
    operations: x.flow.context(child.id).operations.length,
    posts: x.events.filter((e) => e.kind === "music-submit").length,
  };
  boundaryEvidence(
    "stop-corrupt-undispatched",
    snapshot,
    run.state !== "stopped" ||
      outer.state !== "failed" ||
      outer.reason !== "STOPPED_BEFORE_MUSIC_DISPATCH" ||
      tickErrors.length > 0,
  );
  assert.deepEqual(tickErrors, []);
  assert.equal(outer.state, "failed");
  assert.equal(outer.reason, "STOPPED_BEFORE_MUSIC_DISPATCH");
  assert.equal(
    run.state,
    "stopped",
    "a mutable artifact failure must not keep an undispatched stopped child waiting forever",
  );
  assert.equal(snapshot.managedStopped, true);
  assert.equal(snapshot.operations, 0);
  assert.equal(snapshot.posts, 0);
});
