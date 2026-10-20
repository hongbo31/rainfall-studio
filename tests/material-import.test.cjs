const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { MaterialWorkbenchService } = require("../build/material-import.cjs");
function repository() {
  const data = new Map();
  return {
    data,
    getSetting: (k) => data.get(k),
    setSetting: (k, v) => data.set(k, structuredClone(v)),
  };
}
async function song(root, folder = "One") {
  const p = path.join(root, folder);
  fs.mkdirSync(p, { recursive: true });
  fs.writeFileSync(path.join(p, "lyrics.txt"), "[Verse]\nOriginal words");
  fs.writeFileSync(path.join(p, "style.txt"), "Warm acoustic pop");
  await require("sharp")({
    create: { width: 16, height: 16, channels: 3, background: "red" },
  })
    .png()
    .toFile(path.join(p, "cover.png"));
  return p;
}
async function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rainfall-import-"));
  await song(root);
  const repo = repository(),
    service = new MaterialWorkbenchService(repo);
  service.configure({ root });
  return { root, repo, service, sourceId: service.list().sources[0].id };
}
test("ordinary folders preview before explicit title confirmation without material mutation", async () => {
  const { root, service, sourceId } = await setup();
  const before = service.list();
  const preview = await service.previewScan({ sourceId });
  assert.equal(preview.format, "folders");
  assert.equal(preview.rows.length, 1);
  assert.equal(preview.rows[0].title, "One");
  assert.equal(preview.rows[0].ready, true);
  assert.equal(preview.rows[0].cover.width, 16);
  assert.deepEqual(service.list(), before);
  await assert.rejects(
    service.confirmImport({
      previewId: preview.id,
      rowIds: [preview.rows[0].id],
      confirmTitles: false,
    }),
  );
  const result = await service.confirmImport({
    previewId: preview.id,
    rowIds: [preview.rows[0].id],
    confirmTitles: true,
  });
  assert.equal(result.materials.length, 1);
  assert.equal(result.materials[0].title, "One");
  assert.equal(result.materials[0].state, "pending");
  assert.equal(
    fs.readFileSync(path.join(root, "One", "lyrics.txt"), "utf8"),
    "[Verse]\nOriginal words",
  );
  fs.rmSync(root, { recursive: true });
});
test("ambiguous and missing roles remain repairable only through explicit preview paths", async () => {
  const { root, service, sourceId } = await setup();
  fs.copyFileSync(
    path.join(root, "One", "cover.png"),
    path.join(root, "One", "second.jpg"),
  );
  fs.renameSync(
    path.join(root, "One", "style.txt"),
    path.join(root, "One", "custom-style.txt"),
  );
  let p = await service.previewScan({ sourceId });
  const r = p.rows[0];
  assert.equal(r.ready, false);
  assert.equal(r.coverPath, "");
  assert.equal(r.stylePath, "");
  p = await service.updatePreview({
    previewId: p.id,
    rowId: r.id,
    title: "Confirmed title",
    lyricsPath: r.lyricsPath,
    stylePath: "One/custom-style.txt",
    coverPath: "One/cover.png",
  });
  assert.equal(p.rows[0].ready, true);
  const result = await service.confirmImport({
    previewId: p.id,
    rowIds: [r.id],
    confirmTitles: true,
  });
  assert.equal(result.materials[0].title, "Confirmed title");
  fs.rmSync(root, { recursive: true });
});
test("changed source between preview and confirm is rejected without committed changes", async () => {
  const { root, service, sourceId } = await setup();
  const p = await service.previewScan({ sourceId });
  fs.writeFileSync(
    path.join(root, "One", "lyrics.txt"),
    "[Verse]\nChanged words",
  );
  await assert.rejects(
    service.confirmImport({
      previewId: p.id,
      rowIds: [p.rows[0].id],
      confirmTitles: true,
    }),
    /CHANGED|STALE/,
  );
  assert.equal(service.list().materials.length, 0);
  fs.rmSync(root, { recursive: true });
});

test("confirmed titles and repaired paths persist; rescan/rebind retain IDs revision and history", async () => {
  const { root, repo, service, sourceId } = await setup();
  fs.copyFileSync(
    path.join(root, "One", "cover.png"),
    path.join(root, "One", "other.jpg"),
  );
  let p = await service.previewScan({ sourceId });
  p = await service.updatePreview({
    previewId: p.id,
    rowId: p.rows[0].id,
    title: "My confirmed title",
    lyricsPath: "One/lyrics.txt",
    stylePath: "One/style.txt",
    coverPath: "One/cover.png",
  });
  let state = await service.confirmImport({
    previewId: p.id,
    rowIds: [p.rows[0].id],
    confirmTitles: true,
  });
  const original = state.materials[0];
  p = await service.previewScan({ sourceId });
  assert.equal(p.rows[0].title, "My confirmed title");
  assert.equal(p.rows[0].coverPath, "One/cover.png");
  assert.equal(p.rows[0].ready, true);
  state = await service.confirmImport({
    previewId: p.id,
    rowIds: [p.rows[0].id],
    confirmTitles: true,
  });
  assert.equal(state.materials[0].id, original.id);
  assert.equal(state.materials[0].revision, 1);
  const moved = fs.mkdtempSync(path.join(os.tmpdir(), "rainfall-rebind-"));
  fs.cpSync(root, moved, { recursive: true });
  p = await service.previewScan({ sourceId, root: moved });
  assert.equal(p.rebind, true);
  assert.equal(service.list().sources[0].root, root);
  state = await service.confirmImport({
    previewId: p.id,
    rowIds: [p.rows[0].id],
    confirmTitles: true,
  });
  assert.equal(state.sources[0].root, moved);
  assert.equal(state.materials[0].id, original.id);
  assert.equal(state.materials[0].revision, 1);
  assert.equal(state.materials[0].title, "My confirmed title");
  assert(state.materials[0].checks.cover.path.startsWith(moved));
  fs.rmSync(root, { recursive: true });
  fs.rmSync(moved, { recursive: true });
});
test("copied songs never merge into existing material; duplicates require explicit acknowledgment", async () => {
  const { root, service, sourceId } = await setup();
  let p = await service.previewScan({ sourceId });
  let state = await service.confirmImport({
    previewId: p.id,
    rowIds: [p.rows[0].id],
    confirmTitles: true,
  });
  const first = state.materials[0];
  fs.cpSync(path.join(root, "One"), path.join(root, "Copy"), {
    recursive: true,
  });
  p = await service.previewScan({ sourceId });
  const copied = p.rows.find((r) => r.suggestedTitle === "Copy");
  assert.equal(copied.existingMaterialId, undefined);
  assert(copied.duplicateMaterialIds.includes(first.id));
  await assert.rejects(
    service.confirmImport({
      previewId: p.id,
      rowIds: [copied.id],
      confirmTitles: true,
    }),
    /DUPLICATE/,
  );
  state = await service.confirmImport({
    previewId: p.id,
    rowIds: [copied.id],
    confirmTitles: true,
    acceptDuplicates: true,
  });
  assert.equal(state.materials.length, 2);
  assert.notEqual(state.materials[0].id, state.materials[1].id);
  fs.rmSync(root, { recursive: true });
});
test("same-named folders in a new source require duplicate acknowledgment and independent UUIDs", async () => {
  const { root, service, sourceId } = await setup();
  await song(root, "nested/One");
  fs.writeFileSync(
    path.join(root, "nested/One/lyrics.txt"),
    "[Verse]\nDifferent words",
  );
  const p = await service.previewScan({ sourceId });
  assert.equal(p.rows.length, 2);
  assert(p.rows.every((r) => r.duplicateRowIds.length === 1));
  await assert.rejects(
    service.confirmImport({
      previewId: p.id,
      rowIds: p.rows.map((r) => r.id),
      confirmTitles: true,
    }),
    /DUPLICATE/,
  );
  const state = await service.confirmImport({
    previewId: p.id,
    rowIds: p.rows.map((r) => r.id),
    confirmTitles: true,
    acceptDuplicates: true,
  });
  assert.equal(new Set(state.materials.map((m) => m.id)).size, 2);
  fs.rmSync(root, { recursive: true });
});
test("adding a cover after preview and stale concurrent preview confirmation both fail atomically", async () => {
  const { root, service, sourceId } = await setup();
  const p = await service.previewScan({ sourceId });
  fs.copyFileSync(
    path.join(root, "One/cover.png"),
    path.join(root, "One/new.jpg"),
  );
  await assert.rejects(
    service.confirmImport({
      previewId: p.id,
      rowIds: [p.rows[0].id],
      confirmTitles: true,
    }),
    /BYTES_CHANGED/,
  );
  fs.unlinkSync(path.join(root, "One/new.jpg"));
  const a = await service.previewScan({ sourceId }),
    b = await service.previewScan({ sourceId });
  await service.confirmImport({
    previewId: a.id,
    rowIds: [a.rows[0].id],
    confirmTitles: true,
  });
  await assert.rejects(
    service.confirmImport({
      previewId: b.id,
      rowIds: [b.rows[0].id],
      confirmTitles: true,
    }),
    /STALE/,
  );
  fs.rmSync(root, { recursive: true });
});

test("advanced manifest supports stable keys and rejects traversal, duplicate keys and invalid covers", async () => {
  const { root, service, sourceId } = await setup();
  fs.writeFileSync(
    path.join(root, "rainfall-materials.json"),
    JSON.stringify({
      version: 1,
      materials: [
        {
          sourceKey: "stable-one",
          title: "Manifest title",
          lyricsPath: "One/lyrics.txt",
          stylePath: "One/style.txt",
          coverPath: "One/cover.png",
        },
      ],
    }),
  );
  let p = await service.previewScan({ sourceId });
  assert.equal(p.format, "manifest");
  assert.equal(p.rows[0].ready, true);
  const data = JSON.parse(
    fs.readFileSync(path.join(root, "rainfall-materials.json")),
  );
  data.materials.push({ ...data.materials[0], coverPath: "../cover.png" });
  fs.writeFileSync(
    path.join(root, "rainfall-materials.json"),
    JSON.stringify(data),
  );
  p = await service.previewScan({ sourceId });
  assert(p.rows.every((r) => !r.ready));
  assert(p.rows[1].errors.some((e) => e.includes("OUTSIDE_ROOT")));
  await assert.rejects(
    service.confirmImport({
      previewId: p.id,
      rowIds: [p.rows[0].id],
      confirmTitles: true,
    }),
    /ROW_HAS_ERRORS/,
  );
  fs.rmSync(root, { recursive: true });
});
test("rename preserves identity, changed confirmed content creates pending revision and retains history", async () => {
  const { root, repo, service, sourceId } = await setup();
  let p = await service.previewScan({ sourceId });
  let state = await service.confirmImport({
    previewId: p.id,
    rowIds: [p.rows[0].id],
    confirmTitles: true,
  });
  const first = state.materials[0];
  const saved = structuredClone(repo.data.get("material-workbench.v1"));
  saved.materials[0].versions = [
    {
      id: "old-version",
      jobId: "old-job",
      workId: "old-work",
      assetId: "old-asset",
      version: "A",
      providerSongId: "old-song",
      sha256: "f".repeat(64),
      createdAt: "old",
    },
  ];
  saved.materials[0].jobIds = ["old-job"];
  saved.materials[0].workId = "old-work";
  saved.materials[0].selectedVersionId = "old-version";
  saved.materials[0].state = "generated";
  repo.data.set("material-workbench.v1", saved);
  const reloaded = new MaterialWorkbenchService(repo);
  fs.renameSync(path.join(root, "One"), path.join(root, "Renamed"));
  p = await reloaded.previewScan({ sourceId });
  assert.equal(p.rows[0].existingMaterialId, first.id);
  state = await reloaded.confirmImport({
    previewId: p.id,
    rowIds: [p.rows[0].id],
    confirmTitles: true,
  });
  assert.equal(state.materials[0].id, first.id);
  assert.equal(state.materials[0].revision, 1);
  assert.equal(state.materials[0].state, "generated");
  fs.writeFileSync(
    path.join(root, "Renamed/lyrics.txt"),
    "[Verse]\nNew confirmed words",
  );
  p = await reloaded.previewScan({ sourceId });
  assert.equal(p.rows[0].existingMaterialId, first.id);
  state = await reloaded.confirmImport({
    previewId: p.id,
    rowIds: [p.rows[0].id],
    confirmTitles: true,
  });
  assert.equal(state.materials[0].revision, 2);
  assert.equal(state.materials[0].state, "pending");
  assert.equal(state.materials[0].versions[0].id, "old-version");
  assert.equal(state.materials[0].workId, "old-work");
  fs.rmSync(root, { recursive: true });
});
test("missing whole prior folder remains visible as repairable preview failure", async () => {
  const { root, service, sourceId } = await setup();
  let p = await service.previewScan({ sourceId });
  const state = await service.confirmImport({
    previewId: p.id,
    rowIds: [p.rows[0].id],
    confirmTitles: true,
  });
  fs.rmSync(path.join(root, "One"), { recursive: true });
  p = await service.previewScan({ sourceId });
  assert.equal(p.rows.length, 1);
  assert.equal(p.rows[0].existingMaterialId, state.materials[0].id);
  assert.equal(p.rows[0].ready, false);
  assert.equal(service.list().materials[0].state, "pending");
  fs.rmSync(root, { recursive: true });
});
test("legacy 100 preview retains generated UUID revision versions and source hashes on confirmation", async () => {
  const root = path.resolve(
      "../Rainfall-Materials-Pending/2026-10-20_100-songs",
    ),
    repo = repository(),
    service = new MaterialWorkbenchService(repo);
  service.configure({ root });
  const sourceId = service.list().sources[0].id;
  await service.scan({ sourceId });
  const first = service.list().materials[0],
    saved = structuredClone(repo.data.get("material-workbench.v1"));
  saved.materials[0].state = "generated";
  saved.materials[0].versions = [
    {
      id: "legacy-a",
      jobId: "legacy-job",
      workId: "legacy-work",
      assetId: "asset-a",
      version: "A",
      providerSongId: "provider-a",
      sha256: "f".repeat(64),
      createdAt: "old",
    },
  ];
  saved.materials[0].workId = "legacy-work";
  repo.data.set("material-workbench.v1", saved);
  const reloaded = new MaterialWorkbenchService(repo),
    before = reloaded.list();
  const p = await reloaded.previewScan({ sourceId });
  assert.equal(p.rows.length, 100);
  assert.equal(
    p.rows.every((r) => r.ready),
    true,
    JSON.stringify(
      p.rows.filter((r) => !r.ready).map((r) => [r.number, r.errors]),
    ),
  );
  assert.deepEqual(reloaded.list(), before);
  const result = await reloaded.confirmImport({
    previewId: p.id,
    rowIds: p.rows.map((r) => r.id),
    confirmTitles: true,
  });
  assert.equal(result.materials[0].id, first.id);
  assert.equal(result.materials[0].revision, 1);
  assert.equal(result.materials[0].state, "generated");
  assert.equal(result.materials[0].versions[0].id, "legacy-a");
  assert.equal(result.materials[0].contentHash, first.contentHash);
});

test("source links, unreadable files, unsafe manifests and inventory limits block confirmation", async () => {
  const { root, service, sourceId } = await setup();
  const read = fs.readFileSync;
  fs.readFileSync = function (file, ...args) {
    if (String(file).endsWith("style.txt")) {
      const e = Error("fixture permission denied");
      e.code = "EACCES";
      throw e;
    }
    return read.call(this, file, ...args);
  };
  let p;
  try {
    p = await service.previewScan({ sourceId });
    assert(p.errors.some((e) => e.includes("UNREADABLE")));
    await assert.rejects(
      service.confirmImport({
        previewId: p.id,
        rowIds: [p.rows[0].id],
        confirmTitles: true,
      }),
      /ERRORS/,
    );
  } finally {
    fs.readFileSync = read;
  }
  fs.writeFileSync(
    path.join(root, "rainfall-materials.json"),
    JSON.stringify({
      version: 1,
      materials: Array.from({ length: 1001 }, (_, i) => ({
        sourceKey: "k" + i,
        title: "Title" + i,
        lyricsPath: "One/lyrics.txt",
        stylePath: "One/style.txt",
        coverPath: "One/cover.png",
      })),
    }),
  );
  p = await service.previewScan({ sourceId });
  assert(p.errors.some((e) => e.includes("ROW_COUNT_LIMIT")));
  assert.equal(service.list().materials.length, 0);
  fs.rmSync(root, { recursive: true });
});
test("hard-linked role files and symlinked directories are refused without following them", async (t) => {
  const { root, service, sourceId } = await setup();
  const outside = fs.mkdtempSync(
    path.join(os.tmpdir(), "rainfall-import-outside-"),
  );
  fs.writeFileSync(path.join(outside, "words.txt"), "secret outside");
  fs.unlinkSync(path.join(root, "One/lyrics.txt"));
  fs.linkSync(
    path.join(outside, "words.txt"),
    path.join(root, "One/lyrics.txt"),
  );
  let p = await service.previewScan({ sourceId });
  assert(p.errors.some((e) => e.includes("LINK_REJECTED")));
  fs.unlinkSync(path.join(root, "One/lyrics.txt"));
  fs.writeFileSync(path.join(root, "One/lyrics.txt"), "[Verse]\nWords");
  try {
    fs.symlinkSync(outside, path.join(root, "linked"), "junction");
    p = await service.previewScan({ sourceId });
    assert(p.errors.some((e) => e.includes("LINK_REJECTED")));
    assert(!p.rows.some((r) => r.lyrics.includes("secret outside")));
  } finally {
    fs.rmSync(root, { recursive: true });
    fs.rmSync(outside, { recursive: true });
  }
});
test("explicit root rebinding rejects outstanding generation jobs without changing either history or root", async () => {
  const { root, repo, service, sourceId } = await setup();
  let p = await service.previewScan({ sourceId });
  await service.confirmImport({
    previewId: p.id,
    rowIds: [p.rows[0].id],
    confirmTitles: true,
  });
  const saved = structuredClone(repo.data.get("material-workbench.v1")),
    m = saved.materials[0];
  saved.jobs.push({
    id: "outstanding",
    materialId: m.id,
    state: "accepted",
    providerSongIds: ["a", "b"],
  });
  m.jobIds.push("outstanding");
  repo.data.set("material-workbench.v1", saved);
  const reloaded = new MaterialWorkbenchService(repo),
    next = fs.mkdtempSync(path.join(os.tmpdir(), "rainfall-rebind-active-"));
  fs.cpSync(root, next, { recursive: true });
  p = await reloaded.previewScan({ sourceId, root: next });
  const before = reloaded.list();
  await assert.rejects(
    reloaded.confirmImport({
      previewId: p.id,
      rowIds: [p.rows[0].id],
      confirmTitles: true,
    }),
    /REBIND_ACTIVE_JOBS/,
  );
  assert.deepEqual(reloaded.list(), before);
  fs.rmSync(root, { recursive: true });
  fs.rmSync(next, { recursive: true });
});

test("legacy metadata cover assignment is verified and explicit role repair can replace incorrect source paths", async () => {
  const { root, service, sourceId } = await setup();
  fs.writeFileSync(
    path.join(root, "One/style.txt"),
    "English Style\nWarm acoustic pop",
  );
  const crypto = require("node:crypto"),
    coverHash = crypto
      .createHash("sha256")
      .update(fs.readFileSync(path.join(root, "One/cover.png")))
      .digest("hex");
  fs.writeFileSync(
    path.join(root, "One/metadata.json"),
    JSON.stringify({
      id: "001",
      title: "One",
      style_en: "Warm acoustic pop",
      lyrics: "[Verse]\nOriginal words",
      lyrics_file: "One/lyrics.txt",
      style_file: "One/style.txt",
      cover_file: "One/cover.png",
      cover_sha256: "wrong",
    }),
  );
  fs.writeFileSync(
    path.join(root, "song-map-001-100.json"),
    JSON.stringify([
      {
        id: "001",
        title: "One",
        lyrics_file: "One/lyrics.txt",
        style_file: "One/style.txt",
        cover_file: "One/cover.png",
        metadata_file: "One/metadata.json",
      },
    ]),
  );
  let p = await service.previewScan({ sourceId });
  assert.equal(p.rows[0].ready, false);
  assert(p.rows[0].errors.some((e) => e.includes("METADATA")));
  fs.rmSync(root, { recursive: true });
});
test("confirmation cannot replace source of outstanding generation job", async () => {
  const { root, repo, service, sourceId } = await setup();
  let p = await service.previewScan({ sourceId });
  await service.confirmImport({
    previewId: p.id,
    rowIds: [p.rows[0].id],
    confirmTitles: true,
  });
  const saved = structuredClone(repo.data.get("material-workbench.v1")),
    m = saved.materials[0];
  saved.jobs.push({
    id: "outstanding",
    materialId: m.id,
    state: "accepted",
    providerSongIds: ["a", "b"],
  });
  m.jobIds.push("outstanding");
  repo.data.set("material-workbench.v1", saved);
  const reloaded = new MaterialWorkbenchService(repo);
  fs.writeFileSync(
    path.join(root, "One/lyrics.txt"),
    "[Verse]\nChanged while pending",
  );
  p = await reloaded.previewScan({ sourceId });
  const before = reloaded.list();
  await assert.rejects(
    reloaded.confirmImport({
      previewId: p.id,
      rowIds: [p.rows[0].id],
      confirmTitles: true,
    }),
    /ACTIVE_JOB_SOURCE_CHANGE/,
  );
  assert.deepEqual(reloaded.list(), before);
  fs.rmSync(root, { recursive: true });
});

test("manifest path changes remain authoritative after earlier import", async () => {
  const { root, service, sourceId } = await setup();
  const manifest = {
    version: 1,
    materials: [
      {
        sourceKey: "one",
        title: "One",
        lyricsPath: "One/lyrics.txt",
        stylePath: "One/style.txt",
        coverPath: "One/cover.png",
      },
    ],
  };
  fs.writeFileSync(
    path.join(root, "rainfall-materials.json"),
    JSON.stringify(manifest),
  );
  let p = await service.previewScan({ sourceId });
  await service.confirmImport({
    previewId: p.id,
    rowIds: [p.rows[0].id],
    confirmTitles: true,
  });
  fs.writeFileSync(
    path.join(root, "One/new-lyrics.txt"),
    "[Verse]\nNew manifest words",
  );
  manifest.materials[0].lyricsPath = "One/new-lyrics.txt";
  fs.writeFileSync(
    path.join(root, "rainfall-materials.json"),
    JSON.stringify(manifest),
  );
  p = await service.previewScan({ sourceId });
  assert.equal(p.rows[0].lyricsPath, "One/new-lyrics.txt");
  assert.match(p.rows[0].lyrics, /New manifest words/);
  fs.rmSync(root, { recursive: true });
});
test("changing exact legacy style section in unchanged shared file increments material revision", async () => {
  const { root, service, sourceId } = await setup();
  fs.writeFileSync(
    path.join(root, "One/style.txt"),
    "01｜One\nStyle: acoustic\n\n02｜Two\nStyle: electronic\n",
  );
  const rows = [
    {
      id: "001",
      title: "One",
      lyrics_file: "One/lyrics.txt",
      style_file: "One/style.txt",
      style_section: "01｜One",
      cover_file: "One/cover.png",
    },
  ];
  fs.writeFileSync(
    path.join(root, "song-map-001-100.json"),
    JSON.stringify(rows),
  );
  let p = await service.previewScan({ sourceId });
  let state = await service.confirmImport({
    previewId: p.id,
    rowIds: [p.rows[0].id],
    confirmTitles: true,
  });
  assert.equal(state.materials[0].style, "acoustic");
  rows[0].style_section = "02｜Two";
  fs.writeFileSync(
    path.join(root, "song-map-001-100.json"),
    JSON.stringify(rows),
  );
  p = await service.previewScan({ sourceId });
  state = await service.confirmImport({
    previewId: p.id,
    rowIds: [p.rows[0].id],
    confirmTitles: true,
  });
  assert.equal(state.materials[0].style, "electronic");
  assert.equal(state.materials[0].revision, 2);
  fs.rmSync(root, { recursive: true });
});
test("new explicit manifest identity never binds previous UUID by matching bytes", async () => {
  const { root, service, sourceId } = await setup();
  const manifest = {
    version: 1,
    materials: [
      {
        sourceKey: "one",
        title: "Original One",
        lyricsPath: "One/lyrics.txt",
        stylePath: "One/style.txt",
        coverPath: "One/cover.png",
      },
    ],
  };
  fs.writeFileSync(
    path.join(root, "rainfall-materials.json"),
    JSON.stringify(manifest),
  );
  let p = await service.previewScan({ sourceId });
  const state = await service.confirmImport({
      previewId: p.id,
      rowIds: [p.rows[0].id],
      confirmTitles: true,
    }),
    first = state.materials[0];
  fs.renameSync(path.join(root, "One"), path.join(root, "New"));
  manifest.materials[0] = {
    sourceKey: "new",
    title: "Independent title",
    lyricsPath: "New/lyrics.txt",
    stylePath: "New/style.txt",
    coverPath: "New/cover.png",
  };
  fs.writeFileSync(
    path.join(root, "rainfall-materials.json"),
    JSON.stringify(manifest),
  );
  p = await service.previewScan({ sourceId });
  const current = p.rows.find((r) => r.sourceKey === "manifest:new");
  assert.equal(current.existingMaterialId, undefined);
  assert.equal(current.title, "Independent title");
  assert(current.duplicateMaterialIds.includes(first.id));
  fs.rmSync(root, { recursive: true });
});

test("explicit history mapping repairs renamed-and-edited folder without selecting missing placeholder", async () => {
  const { root, service, sourceId } = await setup();
  let p = await service.previewScan({ sourceId });
  const initial = await service.confirmImport({
      previewId: p.id,
      rowIds: [p.rows[0].id],
      confirmTitles: true,
    }),
    first = initial.materials[0];
  fs.renameSync(path.join(root, "One"), path.join(root, "New"));
  fs.writeFileSync(
    path.join(root, "New/lyrics.txt"),
    "[Verse]\nNew revised words",
  );
  p = await service.previewScan({ sourceId });
  const revised = p.rows.find((r) => r.sourceKey === "folder:New");
  assert(revised);
  p = await service.updatePreview({
    previewId: p.id,
    rowId: revised.id,
    title: first.title,
    lyricsPath: revised.lyricsPath,
    stylePath: revised.stylePath,
    coverPath: revised.coverPath,
    existingMaterialId: first.id,
  });
  assert.equal(p.rows.find((r) => r.id === revised.id).ready, true);
  const result = await service.confirmImport({
    previewId: p.id,
    rowIds: [revised.id],
    confirmTitles: true,
  });
  assert.equal(result.materials.length, 1);
  assert.equal(result.materials[0].id, first.id);
  assert.equal(result.materials[0].revision, 2);
  fs.rmSync(root, { recursive: true });
});

test("different metadata-selected prompts from unchanged role files have different content hashes", async () => {
  const { root, service, sourceId } = await setup();
  fs.writeFileSync(path.join(root, "One/style.txt"), "acoustic\nelectronic");
  const metadata = {
    id: "001",
    title: "One",
    style_en: "acoustic",
    lyrics: "[Verse]\nOriginal words",
    lyrics_file: "One/lyrics.txt",
    style_file: "One/style.txt",
    cover_file: "One/cover.png",
  };
  fs.writeFileSync(
    path.join(root, "One/metadata.json"),
    JSON.stringify(metadata),
  );
  fs.writeFileSync(
    path.join(root, "song-map-001-100.json"),
    JSON.stringify([
      {
        id: "001",
        title: "One",
        lyrics_file: "One/lyrics.txt",
        style_file: "One/style.txt",
        cover_file: "One/cover.png",
        metadata_file: "One/metadata.json",
      },
    ]),
  );
  let p = await service.previewScan({ sourceId });
  const first = (
    await service.confirmImport({
      previewId: p.id,
      rowIds: [p.rows[0].id],
      confirmTitles: true,
    })
  ).materials[0];
  metadata.style_en = "electronic";
  fs.writeFileSync(
    path.join(root, "One/metadata.json"),
    JSON.stringify(metadata),
  );
  p = await service.previewScan({ sourceId });
  const second = (
    await service.confirmImport({
      previewId: p.id,
      rowIds: [p.rows[0].id],
      confirmTitles: true,
    })
  ).materials[0];
  assert.equal(second.style, "electronic");
  assert.equal(second.revision, 2);
  assert.notEqual(first.contentHash, second.contentHash);
  fs.rmSync(root, { recursive: true });
});

test('configuring a source through a linked root is rejected before storing a collection',async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'rainfall-import-root-link-')),target=path.join(root,'target'),link=path.join(root,'linked');fs.mkdirSync(target);fs.symlinkSync(target,link,'junction');const service=new MaterialWorkbenchService(repository());assert.throws(()=>service.configure({root:link}),/ROOT_LINK/);assert.equal(service.list().sources.length,0);fs.rmSync(root,{recursive:true});});

test('preview covers have no invalid URL and repaired or changed covers receive hash-specific URLs',async()=>{const {root,service,sourceId}=await setup();try{await require('sharp')({create:{width:16,height:16,channels:3,background:'blue'}}).png().toFile(path.join(root,'One/blue.png'));fs.writeFileSync(path.join(root,'One/broken.png'),'not an image');let preview=await service.previewScan({sourceId});const rowId=preview.rows[0].id;assert.equal(preview.rows[0].cover.previewUrl,'');const update=coverPath=>service.updatePreview({previewId:preview.id,rowId,title:'One',lyricsPath:'One/lyrics.txt',stylePath:'One/style.txt',coverPath});preview=await update('One/cover.png');const red=preview.rows[0];assert.equal(red.checks.cover.valid,true);assert.equal(new URL(red.cover.previewUrl).searchParams.get('sha256'),red.checks.cover.sha256);assert.equal(service.previewCoverPath({previewId:preview.id,rowId,sha256:red.checks.cover.sha256}),red.checks.cover.path);preview=await update('One/blue.png');const blue=preview.rows[0];assert.notEqual(blue.cover.previewUrl,red.cover.previewUrl);assert.equal(new URL(blue.cover.previewUrl).searchParams.get('sha256'),blue.checks.cover.sha256);assert.throws(()=>service.previewCoverPath({previewId:preview.id,rowId,sha256:red.checks.cover.sha256}),/STALE/);preview=await update('One/broken.png');assert.equal(preview.rows[0].checks.cover.valid,false);assert.equal(preview.rows[0].cover.previewUrl,'');assert.throws(()=>service.previewCoverPath({previewId:preview.id,rowId}),/UNAVAILABLE/);}finally{fs.rmSync(root,{recursive:true});}});
