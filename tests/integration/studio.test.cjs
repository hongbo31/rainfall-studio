const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { Studio } = require("../../build/core.cjs");
const base = path.resolve("output/test-runs");
fs.mkdirSync(base, { recursive: true });
const defaults = {
  genre: "流行",
  voice: "female",
  lyricTone: "克制叙事",
  bpmMin: 72,
  bpmMax: 96,
  coverStyle: "暖紫雨夜",
  language: "中文",
  mood: "温柔",
  duration: 180,
};
function setup(mode = "simulation") {
  let now = new Date("2026-10-15T08:00:00Z");
  const root = path.join(base, randomUUID());
  const s = new Studio(root, mode, { now: () => now });
  return { s, root, time: (x) => (now = new Date(x)) };
}
async function artist(s, name = "测试艺人") {
  return s.call("artist.save", { name, defaults });
}
async function work(s, a, title = "原创QA作品") {
  return s.call("work.save", {
    title,
    artistId: a.id,
    story: "相识到告白",
    lyrics: "雨落在屋檐\n你走到我身边",
    prompt: "原创爱情民谣",
    parameters: {},
    rights: "原创QA测试素材",
    ai: "none",
  });
}
async function acct(s, a, provider = "netease") {
  const c = await s.call("account.save", {
    provider,
    name: "QA " + provider,
    dailyLimit: 3,
  });
  const b = await s.call("binding.save", {
    artistId: a.id,
    accountId: c.id,
    targets: [provider],
  });
  return { c, b };
}
test("SQLite WAL/FK and artist data survive restart", async () => {
  const { s, root } = setup();
  const a = await artist(s);
  assert.equal(s.db.pragma("journal_mode", { simple: true }), "wal");
  assert.equal(s.db.pragma("foreign_keys", { simple: true }), 1);
  s.close();
  const r = new Studio(root, "simulation");
  assert.ok((await r.call("snapshot", {})).artists.some((x) => x.id === a.id));
  r.close();
});
test("artist defaults and account bindings remain independent", async () => {
  const { s } = setup();
  const a = await artist(s, "甲"),
    b = await artist(s, "乙");
  const { c, b: binding } = await acct(s, a);
  assert.equal(c.artistId, undefined);
  assert.equal(s.checkBinding(binding.id, a.id, c.id, "netease"), true);
  assert.throws(() => s.checkBinding(binding.id, b.id, c.id, "netease"));
  await s.call("binding.revoke", { id: binding.id });
  assert.throws(() => s.checkBinding(binding.id, a.id, c.id, "netease"));
  s.close();
});
test("invalid BPM and optimistic work conflicts reject", async () => {
  const { s } = setup();
  await assert.rejects(
    s.call("artist.save", {
      name: "bad",
      defaults: { ...defaults, bpmMin: 150, bpmMax: 60 },
    }),
  );
  const a = await artist(s),
    w = await work(s, a);
  await assert.rejects(s.call("work.save", { ...w, expected: 99 }));
  s.close();
});
test("creation freezes defaults and track overrides", async () => {
  const { s } = setup();
  const a = await artist(s);
  const run = await s.call("creation.start", {
    artistId: a.id,
    title: "独立配置",
    story: "原创故事",
    overrides: { voice: "duet" },
  });
  await s.call("artist.save", {
    id: a.id,
    name: "新名",
    expected: a.revision,
    defaults: { ...defaults, voice: "male" },
  });
  assert.equal(s.get("runs", run.id).config.voice, "duet");
  assert.equal(s.get("runs", run.id).state, "waiting_external");
  s.close();
});
test("multi-bucket reservation is atomic, settlement idempotent and unknown held", async () => {
  const { s } = setup();
  const x = s.ensureBucket("candidate", "qa", "2026-10-15", 1),
    y = s.ensureBucket("cost", "qa", "2026-10-15", 10);
  assert.throws(() =>
    s.reserve("op", [
      { id: x.id, amount: 2 },
      { id: y.id, amount: 5 },
    ]),
  );
  assert.equal(s.balance(y.id).reserved, 0);
  s.reserve("op", [
    { id: x.id, amount: 1 },
    { id: y.id, amount: 5 },
  ]);
  s.markUnknown("op");
  assert.throws(() => s.release("op", "not-proven"));
  assert.equal(s.balance(y.id).reserved, 5);
  s.settle("op", "receipt-1");
  s.settle("op", "receipt-1");
  assert.equal(s.balance(y.id).spent, 5);
  s.close();
});
test("unsent reservations roll at midnight while unknown retains risk", async () => {
  const { s, time } = setup();
  const x = s.ensureBucket("submission_target", "qa", "2026-10-15", 2);
  s.reserve("unsent", [{ id: x.id, amount: 1 }]);
  time("2026-10-16T00:00:00Z");
  s.rollover("unsent");
  assert.equal(s.balance(x.id).reserved, 0);
  const next = s.all("buckets").find((b) => b.date === "2026-10-16");
  assert.equal(s.balance(next.id).reserved, 1);
  s.markUnknown("unsent");
  assert.throws(() => s.rollover("unsent"));
  s.close();
});
test("daily scheduler does not duplicate, backfill or silently authorize paid generation", async () => {
  const { s, time } = setup();
  const a = await artist(s);
  const p = await s.call("plan.save", {
    artistId: a.id,
    title: "每日故事",
    story: "原创",
    timezone: "Etc/UTC",
    time: "08:01",
    enabled: true,
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
  time("2026-10-15T08:01:10Z");
  await s.tick();
  await s.tick();
  assert.equal(s.all("runs").filter((x) => x.planId === p.id).length, 1);
  time("2026-10-18T08:03:00Z");
  await s.tick();
  assert.equal(
    s.all("runs").filter((x) => x.planId === p.id).length,
    1,
    "no missed/closed catchup",
  );
  assert.equal(s.all("runs")[0].state, "waiting_external");
  await assert.rejects(
    s.call("plan.save", {
      ...p,
      checkpoints: { ...p.checkpoints, publish: "automatic" },
    }),
  );
  s.close();
});
test("DST resolves missing time forward and repeated time only once", () => {
  const { s } = setup();
  const spring = s.resolveSchedule("2026-03-08", "02:30", "America/New_York");
  assert.equal(spring, "2026-03-08T07:00:00.000Z");
  const fall = s.resolveSchedule("2026-11-01", "01:30", "America/New_York");
  assert.equal(fall, "2026-11-01T05:30:00.000Z");
  s.close();
});
test("production never permits simulated submission, even with invented approval", async () => {
  const { s } = setup("production");
  const a = await artist(s);
  const w = await work(s, a);
  const { c, b } = await acct(s, a);
  const p = await s.call("publish.plan", {
    workIds: [w.id],
    destinations: [
      {
        target: "netease",
        accountId: c.id,
        bindingId: b.id,
        kind: "audio_distribution",
      },
    ],
  });
  assert.equal(s.all("units")[0].state, "BLOCKED");
  await assert.rejects(
    s.call("publish.approve", { id: p.id, snapshotHash: p.snapshotHash }),
  );
  assert.equal(s.externalRequests, 0);
  s.close();
});
test("snapshot invalidation and duplicate route claims prevent double submission", async () => {
  const { s } = setup();
  const a = await artist(s);
  const w = await work(s, a);
  const { c, b } = await acct(s, a);
  const dest = {
    target: "netease",
    accountId: c.id,
    bindingId: b.id,
    kind: "audio_distribution",
  };
  const p = await s.call("publish.plan", {
    workIds: [w.id],
    destinations: [dest],
  });
  const again = await s.call("publish.plan", {
    workIds: [w.id],
    destinations: [dest],
  });
  assert.equal(p.id, again.id);
  await assert.rejects(
    s.call("publish.approve", { id: p.id, snapshotHash: "0".repeat(64) }),
  );
  s.close();
});
test("media is copied and hash verified across source removal/restart", async () => {
  const { s, root } = setup();
  const a = await artist(s),
    w = await work(s, a);
  const source = path.join(root, "qa.wav");
  writeWav(source);
  const asset = await s.importFile(source, "audio_A", w.id);
  fs.unlinkSync(source);
  s.close();
  const r = new Studio(root, "simulation");
  assert.ok(fs.existsSync(r.locate(asset.id).file));
  assert.equal(r.get("works", w.id).assets.audio_A, asset.id);
  r.close();
});
test("backups restore media and freeze plans and queue; corrupt ZIP preserves current DB", async () => {
  const { s, root } = setup();
  const a = await artist(s),
    w = await work(s, a);
  const source = path.join(root, "qa.wav");
  writeWav(source);
  const asset = await s.importFile(source, "audio_A", w.id);
  const backup = path.join(root, "backup.zip");
  await s.backup(backup);
  await s.call("work.save", {
    ...s.get("works", w.id),
    expected: 1,
    title: "改后",
  });
  await s.restore(backup);
  assert.equal(s.get("works", w.id).title, "原创QA作品");
  assert.ok(fs.existsSync(s.locate(asset.id).file));
  const broken = path.join(root, "broken.zip");
  fs.writeFileSync(broken, "invalid");
  await assert.rejects(s.restore(broken));
  assert.equal(s.get("works", w.id).title, "原创QA作品");
  s.close();
});
test("unsafe path, wrong MIME and unknown IPC are rejected", async () => {
  const { s, root } = setup();
  const f = path.join(root, "evil.png");
  fs.writeFileSync(f, "<script>alert(1)</script>");
  await assert.rejects(s.importFile(f, "cover"));
  await assert.rejects(s.call("raw.exec", { command: "anything" }));
  assert.throws(() => s.locate("../secrets"));
  s.close();
});
test("metrics import replaces cumulative snapshot and preserves missing/source", async () => {
  const { s, root } = setup();
  const f = path.join(root, "report.csv");
  fs.writeFileSync(
    f,
    "platform,account,work,date,plays,favorites,comments\nnetease,QA,原创,2026-10-15,100,,2\n",
  );
  await s.importReport(f);
  await s.importReport(f);
  assert.equal(s.all("metrics").length, 1);
  assert.equal(s.all("metrics")[0].favorites, null);
  assert.equal(s.all("metrics")[0].source, "import");
  s.close();
});
function writeWav(file) {
  const sampleRate = 16000,
    n = 16000,
    data = Buffer.alloc(44 + n * 2);
  data.write("RIFF");
  data.writeUInt32LE(36 + n * 2, 4);
  data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(sampleRate, 24);
  data.writeUInt32LE(sampleRate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++)
    data.writeInt16LE(
      Math.round(Math.sin((i * 2 * Math.PI * 440) / sampleRate) * 4000),
      44 + i * 2,
    );
  fs.writeFileSync(file, data);
}
module.exports = { writeWav };
