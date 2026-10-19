const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto"),
  { execFileSync } = require("node:child_process"),
  sharp = require("sharp");
const { ffmpeg, Studio, materialEntries, probe } = require("../../build/core.cjs");
async function fixture(run = false) {
  const root = path.resolve("output/test-runs", randomUUID()),
    s = new Studio(root, "simulation", {
      now: () => new Date("2026-10-15T12:00:00Z"),
    }),
    artist = s.all("artists")[0];
  let r, w;
  if (run) {
    const p = await s.call("plan.save", {
      artistId: artist.id,
      title: "QA计划",
      story: "故事",
      timezone: "Etc/UTC",
      time: "08:00",
      enabled: false,
      candidateLimit: 2,
      finishedGoal: 1,
      costLimit: 0,
      overrides: {},
      checkpoints: {
        lyrics: "automatic",
        candidate: "manual",
        cover: "manual",
        finished: "manual",
        publish: "manual",
      },
    });
    r = s.startCreation({
      artistId: artist.id,
      planId: p.id,
      title: "QA成品",
      story: "故事",
      overrides: {},
      date: "2026-10-14",
    });
    w = s.get("works", r.workId);
    w = await s.call("work.save", {
      ...w,
      expected: w.revision,
      rights: "原创QA程序素材",
      ai: "none",
    });
  } else
    w = await s.call("work.save", {
      title: "快照 A",
      artistId: artist.id,
      story: "故事",
      lyrics: "歌词 A",
      prompt: "提示 A",
      parameters: {},
      rights: "原创QA程序素材",
      ai: "none",
    });
  const audio = path.join(root, "qa.wav"),
    cover = path.join(root, "qa.png");
  execFileSync(
    ffmpeg,
    [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=1",
      "-y",
      audio,
    ],
    { windowsHide: true },
  );
  await sharp({
    create: { width: 16, height: 16, channels: 4, background: "#c5a4eb" },
  })
    .png()
    .toFile(cover);
  await s.importFile(audio, "audio_A", w.id);
  await s.importFile(cover, "cover", w.id);
  const account = await s.call("account.save", {
      provider: "netease",
      name: "QA账号1",
      dailyLimit: 5,
    }),
    binding = await s.call("binding.save", {
      artistId: artist.id,
      accountId: account.id,
      targets: ["netease"],
    });
  const batch = await s.call("publish.plan", {
    workIds: [w.id],
    destinations: [
      {
        target: "netease",
        accountId: account.id,
        bindingId: binding.id,
        kind: "audio_distribution",
      },
    ],
  });
  return {
    s,
    root,
    w: s.get("works", w.id),
    artist,
    r,
    batch,
    unit: s.all("units")[0],
    account,
  };
}
const report = (id, extra = {}) => ({
  id,
  remoteId: "QA-positive-receipt",
  remoteUrl: "https://music.163.com/",
  review: "approved",
  publication: "live",
  reason: "",
  evidence: "QA本地人工核对证据，不涉及实际投稿",
  observedAt: "2026-10-15T10:00:00Z",
  ...extra,
});
test("review1: media probe rejects local playlists before opening nested references", () => {
  const root = path.resolve("output/test-runs", randomUUID());
  fs.mkdirSync(root, { recursive: true });
  const ts = path.join(root, "segment.ts"),
    playlist = path.join(root, "selected.m3u8");
  execFileSync(
    ffmpeg,
    [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=duration=1",
      "-c:a",
      "aac",
      "-f",
      "mpegts",
      "-y",
      ts,
    ],
    { windowsHide: true },
  );
  fs.writeFileSync(
    playlist,
    "#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nsegment.ts\n#EXT-X-ENDLIST\n",
  );
  assert.throws(() => probe(playlist));
});
test("review2: old batch material metadata/lyrics remain frozen after draft changes", async () => {
  const { s, w, batch } = await fixture();
  await s.call("work.save", {
    ...w,
    expected: w.revision,
    title: "草稿 B",
    lyrics: "歌词 B",
  });
  const files = materialEntries(s, batch.id),
    meta = JSON.parse(
      files.find((f) => f.name.endsWith("/metadata.json")).text,
    );
  assert.equal(meta.title, "快照 A");
  assert.equal(
    files.find((f) => f.name.endsWith("/lyrics.txt")).text,
    "歌词 A",
  );
  const manifest = JSON.parse(
    files.find((f) => f.name === "manifest.json").text,
  );
  assert.equal(manifest.snapshotHash, batch.snapshotHash);
  s.close();
});
test("review3: manually accepted recording blocks a second account route to the same target", async () => {
  const { s, w, artist, unit } = await fixture();
  await s.call("publish.recordManual", report(unit.id));
  const a = await s.call("account.save", {
      provider: "netease",
      name: "QA账号2",
      dailyLimit: 5,
    }),
    b = await s.call("binding.save", {
      artistId: artist.id,
      accountId: a.id,
      targets: ["netease"],
    });
  const p = await s.call("publish.plan", {
    workIds: [w.id],
    destinations: [
      {
        target: "netease",
        accountId: a.id,
        bindingId: b.id,
        kind: "audio_distribution",
      },
    ],
  });
  assert.equal(s.all("units").find((u) => u.batchId === p.id).state, "BLOCKED");
  s.close();
});
test("review4: older observations remain history without replacing accepted time or newer live state", async () => {
  const { s, unit } = await fixture();
  await s.call("publish.recordManual", report(unit.id));
  await s.call(
    "publish.recordManual",
    report(unit.id, {
      review: "pending",
      publication: "unknown",
      observedAt: "2026-10-14T10:00:00Z",
    }),
  );
  const u = s.get("units", unit.id);
  assert.equal(u.receipt.acceptedAt, "2026-10-15T10:00:00Z");
  assert.equal(u.review, "approved");
  assert.equal(u.publication, "live");
  assert.equal(u.observations.length, 2);
  assert.equal(s.all("ledger").filter((e) => e.kind === "settle").length, 1);
  s.close();
});
test("review5: manual receipt after cancellation records one actual count despite released reserve", async () => {
  const { s, batch, unit } = await fixture();
  await s.call("publish.approve", {
    id: batch.id,
    snapshotHash: batch.snapshotHash,
  });
  await s.call("publish.start", { id: batch.id });
  await s.tick();
  await s.call("publish.cancel", { id: batch.id });
  await s.call("publish.recordManual", report(unit.id));
  await s.call("publish.recordManual", report(unit.id));
  const buckets = s
    .all("buckets")
    .filter((b) => b.kind === "submission_target");
  assert.equal(
    buckets.reduce((n, b) => n + s.balance(b.id).spent, 0),
    1,
  );
  assert.equal(
    buckets.reduce((n, b) => n + s.balance(b.id).reserved, 0),
    0,
  );
  s.close();
});
test("review6: completion cannot bypass pending manual candidate/cover checkpoints", async () => {
  const { s, w, r } = await fixture(true);
  assert.equal(s.get("runs", r.id).step, "candidate");
  assert.throws(() => s.complete(w.id, r.planId));
  s.close();
});
test("review6: completion verifies media bytes and rejects wrong artist plan ownership", async () => {
  const { s, w, root, artist } = await fixture();
  fs.unlinkSync(s.locate(w.assets.audio_A).file);
  assert.throws(() => s.complete(w.id));
  const other = await s.call("artist.save", {
    name: "另一艺人",
    defaults: artist.defaults,
  });
  const p = await s.call("plan.save", {
    artistId: other.id,
    title: "其他计划",
    story: "故事",
    timezone: "Etc/UTC",
    time: "08:00",
    enabled: false,
    candidateLimit: 2,
    finishedGoal: 1,
    costLimit: 0,
    overrides: {},
    checkpoints: {
      lyrics: "automatic",
      candidate: "manual",
      cover: "manual",
      finished: "manual",
      publish: "manual",
    },
  });
  assert.throws(() => s.complete(w.id, p.id));
  s.close();
});
test("review6: finishing confirmed scheduled run credits its original goal date", async () => {
  const { s, w, r } = await fixture(true);
  await s.call("run.confirm", { id: r.id, step: "candidate" });
  await s.call("run.confirm", { id: r.id, step: "cover" });
  await s.call("run.confirm", { id: r.id, step: "finished" });
  assert.equal(
    s.all("completions").find((c) => c.workId === w.id).date,
    "2026-10-14",
  );
  s.close();
});
