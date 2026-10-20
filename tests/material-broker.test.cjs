const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { MaterialWorkbenchService, createMaterialWorkbenchBroker } = require(
  process.env.RAINFALL_MATERIAL_BROKER_BUNDLE,
);
test("Main reuses provider tasks and serializes full lifecycle without credentials in fixture", async () => {
  const saved = new Map(),
    service = new MaterialWorkbenchService(
      {
        getSetting: (k) => saved.get(k),
        setSetting: (k, v) => saved.set(k, structuredClone(v)),
      },
      { fixture: true, fixtureFeeBoundCredits: 2, verifyAsset: () => true },
    );
  let snap = service.configure({
    root: path.resolve("../Rainfall-Materials-Pending/2026-10-20_100-songs"),
  });
  snap = await service.scan({ sourceId: snap.sources[0].id });
  const ids = snap.materials.slice(0, 2).map((m) => m.id),
    requestId = crypto.randomUUID();
  service.enqueue({
    materialIds: ids,
    expectedRevisions: Object.fromEntries(
      snap.materials.map((m) => [m.id, m.revision]),
    ),
    requestId,
    profileId: crypto.randomUUID(),
    profileRevision: 1,
    modelId: "chirp-v6",
    artistId: crypto.randomUUID(),
    budgetCredits: 10,
    consent: true,
  });
  service.resume();
  let submitted = 0,
    queries = 0,
    credentials = 0;
  const adapter = {
    source: "fixture",
    submit: async () => {
      submitted++;
      return {
        state: "accepted",
        songIds: ["a" + submitted, "b" + submitted],
        trackingId: "task" + submitted,
      };
    },
    query: async (ids) => {
      queries++;
      return {
        state: "complete",
        actualCostCredits: 2,
        songs: ids.map((id) => ({
          id,
          status: "succeeded",
          audio_url: "fixture:" + id,
        })),
      };
    },
    download: async () => ({
      bytes: Buffer.from("fixture-only"),
      mime: "audio/wav",
    }),
  };
  const rpc = async (method, input = {}) => {
    let value;
    const action = method.split(".").at(-1);
    if (action === "prepareWork")
      value = { workId: crypto.randomUUID(), draft: { title: "Fixture" } };
    else if (action === "importAudio") value = {};
    else if (action === "completeJob") {
      const { job } = service.getJobContext(input);
      const workId = crypto.randomUUID();
      value = service.recordAssets({
        jobId: job.id,
        workId,
        actualCredits: input.actualCredits,
        versions: job.providerSongIds.map((p, i) => ({
          id: crypto.randomUUID(),
          jobId: job.id,
          workId,
          assetId: crypto.randomUUID(),
          version: i ? "B" : "A",
          providerSongId: p,
          sha256: "a".repeat(64),
          createdAt: new Date().toISOString(),
        })),
      });
    } else value = await service[action](input);
    return { ok: true, value };
  };
  const broker = createMaterialWorkbenchBroker({
    rpc,
    available: () => true,
    generation: () => 1,
    credentials: {
      withMusicAdapter: async () => {
        credentials++;
        throw Error("CREDENTIALS_FORBIDDEN");
      },
    },
    fixtureAdapter: adapter,
  });
  await broker.pump();
  assert.equal(submitted, 1);
  assert.equal(service.list().jobs[1].state, "queued");
  service.pause();
  await broker.pump();
  assert.equal(queries, 0);
  service.resume();
  await broker.pump();
  assert.equal(service.list().jobs[0].state, "completed");
  assert.equal(submitted, 1);
  await broker.pump();
  assert.equal(submitted, 2);
  assert.equal(credentials, 0);
});

test("Main prepares the same numerically first job that Core durably claims", async () => {
  const saved = new Map(),
    service = new MaterialWorkbenchService(
      {
        getSetting: (k) => saved.get(k),
        setSetting: (k, v) => saved.set(k, structuredClone(v)),
      },
      { fixture: true, fixtureFeeBoundCredits: 2, verifyAsset: () => true },
    );
  let snapshot = service.configure({
    root: path.resolve("../Rainfall-Materials-Pending/2026-10-20_100-songs"),
  });
  snapshot = await service.scan({ sourceId: snapshot.sources[0].id });
  for (const material of [snapshot.materials[9], snapshot.materials[0]])
    service.enqueue({
      materialIds: [material.id],
      expectedRevisions: { [material.id]: material.revision },
      requestId: crypto.randomUUID(),
      profileId: crypto.randomUUID(),
      profileRevision: 1,
      modelId: "fixture",
      artistId: crypto.randomUUID(),
      budgetCredits: 10,
      consent: true,
    });
  const submitted = [];
  const broker = createMaterialWorkbenchBroker({
    available: () => true,
    generation: () => 1,
    credentials: {
      withMusicAdapter: async () => {
        throw Error("CREDENTIALS_FORBIDDEN");
      },
    },
    fixtureAdapter: {
      source: "fixture",
      submit: async (input) => {
        submitted.push(input);
        return { state: "accepted", songIds: ["a", "b"], trackingId: "task" };
      },
      query: async () => ({ songs: [] }),
      download: async () => {
        throw Error("NOT_READY");
      },
    },
    rpc: async (method, input = {}) => {
      const action = method.split(".").at(-1);
      return {
        ok: true,
        value:
          action === "prepareWork"
            ? {
                workId: crypto.randomUUID(),
                draft: { title: service.getJobContext(input).material.title },
              }
            : await service[action](input),
      };
    },
  });
  await broker.pump();
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0].draft.title, snapshot.materials[0].title);
  const jobs = service.list().jobs;
  assert.equal(
    jobs.find((j) => j.materialId === snapshot.materials[0].id).state,
    "accepted",
  );
  assert.equal(
    jobs.find((j) => j.materialId === snapshot.materials[9].id).state,
    "queued",
  );
});

test("pre-dispatch preparation failure persists failure without reserving or retrying", async () => {
  const saved = new Map(),
    service = new MaterialWorkbenchService(
      {
        getSetting: (k) => saved.get(k),
        setSetting: (k, v) => saved.set(k, structuredClone(v)),
      },
      { fixture: true, fixtureFeeBoundCredits: 2, verifyAsset: () => true },
    );
  let snapshot = service.configure({
    root: path.resolve("../Rainfall-Materials-Pending/2026-10-20_100-songs"),
  });
  snapshot = await service.scan({ sourceId: snapshot.sources[0].id });
  const m = snapshot.materials[0];
  service.enqueue({
    materialIds: [m.id],
    expectedRevisions: { [m.id]: m.revision },
    requestId: crypto.randomUUID(),
    profileId: crypto.randomUUID(),
    profileRevision: 1,
    modelId: "fixture",
    artistId: crypto.randomUUID(),
    budgetCredits: 10,
    consent: true,
  });
  let prepared = 0,
    submitted = 0;
  const broker = createMaterialWorkbenchBroker({
    available: () => true,
    generation: () => 1,
    credentials: {
      withMusicAdapter: async () => {
        throw Error("CREDENTIALS_FORBIDDEN");
      },
    },
    fixtureAdapter: {
      source: "fixture",
      submit: async () => {
        submitted++;
        throw Error("NO_SUBMIT");
      },
      query: async () => ({ songs: [] }),
      download: async () => {
        throw Error("NO_DOWNLOAD");
      },
    },
    rpc: async (method, input = {}) => {
      const action = method.split(".").at(-1);
      if (action === "prepareWork") {
        prepared++;
        return { ok: false, error: { code: "FROZEN_COVER_CHANGED" } };
      }
      return { ok: true, value: await service[action](input) };
    },
  });
  await broker.pump();
  await broker.pump();
  const job = service.list().jobs[0];
  assert.equal(job.state, "failed");
  assert.equal(job.reason, "FROZEN_COVER_CHANGED");
  assert.equal(job.reservedCredits, 0);
  assert.equal(prepared, 1);
  assert.equal(submitted, 0);
});
