const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MaterialWorkbenchService } = require("../build/material-workbench.cjs");
function repo() {
  const map = new Map();
  return {
    getSetting: (k) => map.get(k),
    setSetting: (k, v) => map.set(k, structuredClone(v)),
  };
}
async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "material-test-"));
  fs.writeFileSync(path.join(root, "lyrics.txt"), "words");
  fs.writeFileSync(path.join(root, "style.txt"), "warm pop");
  await require("sharp")({
    create: { width: 16, height: 16, channels: 3, background: "red" },
  })
    .png()
    .toFile(path.join(root, "cover.png"));
  fs.writeFileSync(
    path.join(root, "song-map-001-100.json"),
    JSON.stringify([
      {
        id: "001",
        title: "One",
        lyrics_file: "lyrics.txt",
        style_file: "style.txt",
        cover_file: "cover.png",
      },
    ]),
  );
  return root;
}
async function setup() {
  const root = await fixture(),
    r = repo(),
    s = new MaterialWorkbenchService(r, {
      fixture: true,
      fixtureFeeBoundCredits: 2,
      verifyAsset: () => true,
    });
  s.configure({ root });
  await s.scan({ sourceId: s.list().sources[0].id });
  return { root, r, s };
}
function enqueue(s, id = "r") {
  const m = s.list().materials[0];
  return s.enqueue({
    materialIds: [m.id],
    expectedRevisions: { [m.id]: m.revision },
    requestId: id,
    profileId: "p",
    profileRevision: 1,
    modelId: "m",
    artistId: "a",
    budgetCredits: 10,
    consent: true,
  });
}
test("scan and rescan preserve identities and detect changed source", async () => {
  const { root, s } = await setup();
  const first = s.list().materials[0];
  await s.scan({ sourceId: first.sourceId });
  assert.equal(s.list().materials[0].id, first.id);
  assert.equal(s.list().materials[0].revision, 1);
  fs.writeFileSync(path.join(root, "lyrics.txt"), "changed");
  await s.scan({ sourceId: first.sourceId });
  assert.equal(s.list().materials[0].state, "invalid");
  assert.equal(s.list().materials[0].revision, 2);
  assert.throws(() => enqueue(s));
  fs.rmSync(root, { recursive: true });
});
test("production fee gate cannot dispatch", async () => {
  const { root, r, s } = await setup();
  enqueue(s);
  const production = new MaterialWorkbenchService(r);
  assert.equal(production.claimNext(), undefined);
  assert.equal(production.list().generationCapability.available, false);
  fs.rmSync(root, { recursive: true });
});
test("durable serial lifecycle, dedup and verified versions", async () => {
  const { root, s } = await setup();
  enqueue(s);
  enqueue(s);
  assert.equal(s.list().jobs.length, 1);
  const j = s.claimNext();
  assert.equal(j.state, "dispatching");
  assert.equal(s.claimNext(), undefined);
  s.recordSubmitted({ jobId: j.id, providerSongIds: ["a", "b"] });
  assert.equal(s.reconcile({ jobId: j.id }).providerSongIds.length, 2);
  assert.equal(s.retry({ jobId: j.id }).id, j.id);
  const versions = ["A", "B"].map((version, i) => ({
    id: version,
    jobId: j.id,
    workId: "w",
    assetId: version,
    version,
    providerSongId: i ? "b" : "a",
    sha256: "f".repeat(64),
    createdAt: new Date().toISOString(),
  }));
  s.recordAssets({ jobId: j.id, workId: "w", versions });
  assert.equal(s.list().materials[0].state, "generated");
  assert.equal(s.list().materials[0].versions.length, 2);
  fs.rmSync(root, { recursive: true });
});
test("restart of dispatch becomes unknown and cannot retry", async () => {
  const { root, r, s } = await setup();
  enqueue(s);
  const j = s.claimNext();
  const restarted = new MaterialWorkbenchService(r, {
    fixture: true,
    fixtureFeeBoundCredits: 2,
  });
  assert.equal(restarted.list().jobs[0].state, "unknown");
  assert.throws(() => restarted.retry({ jobId: j.id }));
  assert.equal(restarted.claimNext(), undefined);
  fs.rmSync(root, { recursive: true });
});

test("failed original downloads block successors until reconciliation", async () => {
  const { root, s } = await setup();
  enqueue(s);
  const j = s.claimNext();
  s.recordSubmitted({ jobId: j.id, providerSongIds: ["a", "b"] });
  s.recordFailure({ jobId: j.id, reason: "download unavailable" });
  const row = JSON.parse(
    fs.readFileSync(path.join(root, "song-map-001-100.json")),
  )[0];
  row.id = "002";
  row.title = "Two";
  fs.copyFileSync(path.join(root, "cover.png"), path.join(root, "cover2.png"));
  row.cover_file = "cover2.png";
  fs.writeFileSync(
    path.join(root, "song-map-001-100.json"),
    JSON.stringify([
      JSON.parse(fs.readFileSync(path.join(root, "song-map-001-100.json")))[0],
      row,
    ]),
  );
  await s.scan({ sourceId: s.list().sources[0].id });
  const m = s.list().materials[1];
  s.enqueue({
    materialIds: [m.id],
    expectedRevisions: { [m.id]: m.revision },
    requestId: "two",
    profileId: "p",
    profileRevision: 1,
    modelId: "m",
    artistId: "a",
    budgetCredits: 10,
    consent: true,
  });
  assert.equal(s.claimNext(), undefined);
  fs.rmSync(root, { recursive: true });
});

test("all 100 source mappings decode without source writes and rescan stable", async () => {
  const root = path.resolve(
    "../Rainfall-Materials-Pending/2026-10-20_100-songs",
  );
  const rows = JSON.parse(
    fs.readFileSync(path.join(root, "song-map-001-100.json")),
  );
  const crypto = require("node:crypto");
  const tracked = [
    ...new Set(
      rows.flatMap((r) =>
        [r.lyrics_file, r.style_file, r.cover_file, r.metadata_file].filter(
          Boolean,
        ),
      ),
    ),
  ];
  const digest = () =>
    tracked.map((p) =>
      crypto
        .createHash("sha256")
        .update(fs.readFileSync(path.join(root, p)))
        .digest("hex"),
    );
  const before = digest();
  const s = new MaterialWorkbenchService(repo());
  s.configure({ root });
  await s.scan({ sourceId: s.list().sources[0].id });
  const first = s.list().materials;
  assert.equal(first.length, 100);
  assert.equal(
    first.filter((m) => m.validationReasons.length).length,
    0,
    JSON.stringify(
      first
        .filter((m) => m.validationReasons.length)
        .map((m) => [m.number, m.validationReasons]),
    ),
  );
  assert.equal(first.filter((m) => m.style.includes("Mandarin")).length, 100);
  await s.scan({ sourceId: s.list().sources[0].id });
  assert.deepEqual(
    s.list().materials.map((m) => [m.id, m.revision]),
    first.map((m) => [m.id, m.revision]),
  );
  assert.deepEqual(digest(), before);
});
test("rename retains source identity, missing and ambiguous paths block dispatch", async () => {
  const { root, s } = await setup();
  const first = s.list().materials[0];
  fs.renameSync(path.join(root, "lyrics.txt"), path.join(root, "renamed.txt"));
  await s.scan({ sourceId: first.sourceId });
  assert.equal(s.list().materials[0].id, first.id);
  assert.equal(s.list().materials[0].revision, 1);
  assert.equal(s.list().materials[0].state, "pending");
  fs.copyFileSync(path.join(root, "renamed.txt"), path.join(root, "copy.txt"));
  await s.scan({ sourceId: first.sourceId });
  assert.equal(s.list().materials[0].state, "invalid");
  assert.throws(() => enqueue(s));
  fs.rmSync(root, { recursive: true });
});
test("pause, stale cover, missing cover and undecodable cover fail closed", async () => {
  const { root, s } = await setup();
  const m = s.list().materials[0];
  enqueue(s);
  s.pause();
  assert.equal(s.claimNext(), undefined);
  assert.equal(
    s.coverPath({ materialId: m.id, revision: 1 }),
    m.checks.cover.path,
  );
  fs.writeFileSync(path.join(root, "cover.png"), "broken");
  assert.throws(() => s.coverPath({ materialId: m.id, revision: 1 }));
  s.resume();
  assert.equal(s.claimNext(), undefined);
  await s.scan({ sourceId: m.sourceId });
  assert.equal(s.list().materials[0].checks.cover.valid, false);
  fs.unlinkSync(path.join(root, "cover.png"));
  await s.scan({ sourceId: m.sourceId });
  assert.equal(s.list().materials[0].checks.cover.exists, false);
  fs.rmSync(root, { recursive: true });
});
test("metadata/index mismatches reject cover assignment", async () => {
  const { root, s } = await setup();
  let rows = JSON.parse(
    fs.readFileSync(path.join(root, "song-map-001-100.json")),
  );
  rows[0].metadata_file = "metadata.json";
  fs.writeFileSync(
    path.join(root, "metadata.json"),
    JSON.stringify({ id: "other", title: "Other", cover_sha256: "bad" }),
  );
  fs.writeFileSync(
    path.join(root, "song-map-001-100.json"),
    JSON.stringify(rows),
  );
  await s.scan({ sourceId: s.list().sources[0].id });
  assert.equal(s.list().materials[0].state, "invalid");
  assert.match(s.list().materials[0].validationReasons.join(" "), /metadata/i);
  fs.rmSync(root, { recursive: true });
});

test("verified audio with unknown charge retains reservation and blocks paid successor", async () => {
  const { root, s } = await setup();
  enqueue(s);
  const j = s.claimNext();
  s.recordSubmitted({ jobId: j.id, providerSongIds: ["a", "b"] });
  s.recordAssets({
    jobId: j.id,
    workId: "w",
    versions: ["A", "B"].map((version, i) => ({
      id: version,
      jobId: j.id,
      workId: "w",
      assetId: version,
      version,
      providerSongId: i ? "b" : "a",
      sha256: "f".repeat(64),
      createdAt: "now",
    })),
  });
  assert.equal(s.list().jobs[0].actualCredits, null);
  assert.equal(s.list().budget.reserved, 2);
  assert.equal(s.list().budget.unknown, true);
  fs.rmSync(root, { recursive: true });
});

test("mutation of index after scan blocks enqueue", async () => {
  const { root, s } = await setup();
  const rows = JSON.parse(
    fs.readFileSync(path.join(root, "song-map-001-100.json")),
  );
  rows[0].title = "Changed index title";
  fs.writeFileSync(
    path.join(root, "song-map-001-100.json"),
    JSON.stringify(rows),
  );
  assert.throws(() => enqueue(s), /index|source/i);
  fs.rmSync(root, { recursive: true });
});
test("local fixture upper bound blocks budget overflow", async () => {
  const { root, r, s } = await setup();
  enqueue(s);
  const bounded = new MaterialWorkbenchService(r, {
    fixture: true,
    fixtureFeeBoundCredits: 20,
  });
  assert.equal(bounded.claimNext(), undefined);
  assert.equal(bounded.list().jobs[0].state, "blocked");
  fs.rmSync(root, { recursive: true });
});

test("generated state requires both verified A and B recordings", async () => {
  const { root, s } = await setup();
  enqueue(s);
  const j = s.claimNext();
  s.recordSubmitted({ jobId: j.id, providerSongIds: ["a"] });
  assert.throws(
    () =>
      s.recordAssets({
        jobId: j.id,
        workId: "w",
        versions: [
          {
            id: "a",
            jobId: j.id,
            workId: "w",
            assetId: "a",
            version: "A",
            providerSongId: "a",
            sha256: "f".repeat(64),
            createdAt: "now",
          },
        ],
      }),
    /audio|verified|pair/i,
  );
  assert.notEqual(s.list().materials[0].state, "generated");
  fs.rmSync(root, { recursive: true });
});

test("trusted verifier is mandatory and explicit regeneration retains earlier versions", async () => {
  const { root, r, s } = await setup();
  enqueue(s);
  const j = s.claimNext();
  s.recordSubmitted({ jobId: j.id, providerSongIds: ["a", "b"] });
  const versions = ["A", "B"].map((version, i) => ({
    id: version,
    jobId: j.id,
    workId: "w",
    assetId: version,
    version,
    providerSongId: i ? "b" : "a",
    sha256: "f".repeat(64),
    createdAt: "now",
  }));
  const untrusted = new MaterialWorkbenchService(r, {
    fixture: true,
    fixtureFeeBoundCredits: 2,
  });
  assert.throws(
    () => untrusted.recordAssets({ jobId: j.id, workId: "w", versions }),
    /verified/,
  );
  s.recordAssets({ jobId: j.id, workId: "w", versions, actualCredits: 2 });
  const m = s.list().materials[0];
  assert.throws(() => enqueue(s, "again"), /regeneration/);
  s.enqueue({
    materialIds: [m.id],
    expectedRevisions: { [m.id]: m.revision },
    requestId: "again",
    profileId: "p",
    profileRevision: 1,
    modelId: "m",
    artistId: "a",
    budgetCredits: 10,
    consent: true,
    regenerate: true,
  });
  assert.equal(s.list().materials[0].versions.length, 2);
  assert.equal(
    s.getJobContext({ jobId: j.id }).material.checks.cover.sha256,
    m.checks.cover.sha256,
  );
  s.selectVersion({ materialId: m.id, versionId: "B" });
  assert.equal(s.list().materials[0].selectedVersionId, "B");
  assert.throws(() =>
    s.selectVersion({ materialId: m.id, versionId: "foreign" }),
  );
  fs.rmSync(root, { recursive: true });
});

test("two indexed materials cannot share an aliased cover path", async () => {
  const { root, s } = await setup();
  const rows = JSON.parse(
    fs.readFileSync(path.join(root, "song-map-001-100.json")),
  );
  rows.push({ ...rows[0], id: "002", title: "Two", cover_file: "./cover.png" });
  fs.writeFileSync(
    path.join(root, "song-map-001-100.json"),
    JSON.stringify(rows),
  );
  await s.scan({ sourceId: s.list().sources[0].id });
  assert.equal(
    s
      .list()
      .materials.every((m) =>
        m.validationReasons.some((r) => r.includes("multiple materials")),
      ),
    true,
  );
  fs.rmSync(root, { recursive: true });
});

test("constructing and listing absent or unchanged workbench state performs no writes", () => {
  const values = new Map();
  let writes = 0;
  const repository = {
    getSetting: (k) => values.get(k),
    setSetting: (k, v) => {
      writes++;
      values.set(k, structuredClone(v));
    },
  };
  new MaterialWorkbenchService(repository).list();
  assert.equal(writes, 0);
  values.set("material-workbench.v1", {
    sources: [],
    materials: [],
    jobs: [],
    paused: true,
    limit: 0,
    contexts: {},
  });
  new MaterialWorkbenchService(repository).list();
  assert.equal(writes, 0);
});
