const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto"),
  sharp = require("sharp");
const { Studio } = require("../../build/core.cjs");
async function ready(provider = "netease", targets = [provider]) {
  const root = path.resolve("output/test-runs", randomUUID());
  let now = new Date("2026-10-15T23:59:59Z");
  const s = new Studio(root, "simulation", { now: () => now });
  const a = s.all("artists")[0];
  const w = await s.call("work.save", {
    title: "原创QA声音",
    artistId: a.id,
    story: "测试",
    lyrics: "原创测试文字",
    prompt: "本地",
    parameters: {},
    rights: "原创QA音频与程序绘制图像",
    ai: "none",
  });
  const audio = path.join(root, "qa.wav");
  const n = 8000,
    b = Buffer.alloc(44 + n * 2);
  b.write("RIFF");
  b.writeUInt32LE(36 + n * 2, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(16000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++)
    b.writeInt16LE(Math.sin(i * 0.2) * 2000, 44 + i * 2);
  fs.writeFileSync(audio, b);
  const image = path.join(root, "qa.png");
  await sharp({
    create: { width: 512, height: 512, channels: 4, background: "#795e89" },
  })
    .png()
    .toFile(image);
  await s.importFile(audio, "audio_A", w.id);
  await s.importFile(image, "cover", w.id);
  const c = await s.call("account.save", {
    provider,
    name: "演练账号",
    dailyLimit: 5,
  });
  const bind = await s.call("binding.save", {
    artistId: a.id,
    accountId: c.id,
    targets,
  });
  const p = await s.call("publish.plan", {
    workIds: [w.id],
    destinations: targets.map((target) => ({
      target,
      accountId: c.id,
      bindingId: bind.id,
      kind: "audio_distribution",
    })),
  });
  await s.call("publish.approve", { id: p.id, snapshotHash: p.snapshotHash });
  return {
    s,
    root,
    w,
    p,
    unit: s.all("units")[0],
    time: (x) => (now = new Date(x)),
  };
}
async function ticks(s, n) {
  for (let i = 0; i < n; i++) await s.tick();
}
test("lost acknowledgement survives restart and never repeats commit", async () => {
  const { s, root, p, unit } = await ready();
  await s.call("publish.simulateFault", { id: unit.id, kind: "unknown" });
  await s.call("publish.start", { id: p.id });
  await ticks(s, 5);
  assert.equal(s.get("units", unit.id).state, "SUBMISSION_UNKNOWN");
  assert.equal(s.get("units", unit.id).commitCount, 1);
  assert.equal(
    s
      .all("buckets")
      .filter((b) => b.kind.startsWith("submission"))
      .map((b) => s.balance(b.id).reserved)[0],
    1,
  );
  s.close();
  const r = new Studio(root, "simulation");
  await r.call("publish.retry", { id: p.id });
  await ticks(r, 10);
  assert.equal(r.get("units", unit.id).commitCount, 1);
  assert.equal(r.get("units", unit.id).state, "SUBMISSION_UNKNOWN");
  r.close();
});
test("safe failure retries only failed step and settles one submission", async () => {
  const { s, p, unit } = await ready();
  await s.call("publish.simulateFault", { id: unit.id, kind: "network" });
  await s.call("publish.start", { id: p.id });
  await ticks(s, 5);
  assert.equal(s.get("units", unit.id).state, "RETRY_WAIT");
  await s.call("publish.retry", { id: p.id });
  await ticks(s, 5);
  assert.equal(s.get("units", unit.id).state, "SUBMITTED");
  assert.equal(
    s.balance(s.all("buckets").find((b) => b.kind === "submission_target").id)
      .spent,
    1,
  );
  await s.call("publish.retry", { id: p.id });
  await ticks(s, 6);
  assert.equal(s.get("units", unit.id).commitCount, 2);
  s.close();
});
test("verified simulation TME grouping commits once but counts both target buckets", async () => {
  const { s, p, unit } = await ready("tme", ["qqmusic", "kugou"]);
  assert.equal(s.all("units").length, 1);
  assert.equal(s.all("targets").length, 2);
  await s.call("publish.start", { id: p.id });
  await ticks(s, 5);
  assert.equal(s.get("units", unit.id).commitCount, 1);
  const buckets = s
    .all("buckets")
    .filter((b) => b.kind.startsWith("submission"));
  assert.equal(buckets.length, 3);
  assert.ok(buckets.every((b) => s.balance(b.id).spent === 1));
  s.close();
});
test("review rejection does not refund quota or imply live", async () => {
  const { s, p, unit } = await ready();
  await s.call("publish.simulateFault", { id: unit.id, kind: "rejected" });
  await s.call("publish.start", { id: p.id });
  await ticks(s, 5);
  const u = s.get("units", unit.id);
  assert.equal(u.state, "SUBMITTED");
  assert.equal(u.review, "rejected");
  assert.equal(u.publication, "unknown");
  assert.equal((await s.call("publish.retry", { id: p.id })).retried, 0);
  assert.equal(
    s.balance(s.all("buckets").find((b) => b.kind === "submission_target").id)
      .spent,
    1,
  );
  s.close();
});
test("revoking binding after approval prevents the next remote boundary", async () => {
  const { s, p, unit } = await ready();
  await s.call("publish.start", { id: p.id });
  await ticks(s, 2);
  await s.call("binding.revoke", { id: unit.bindingId });
  await ticks(s, 8);
  assert.equal(s.get("units", unit.id).state, "BLOCKED");
  assert.equal(s.get("units", unit.id).commitCount, 0);
  s.close();
});
test("submission crossing midnight must use execution day bucket", async () => {
  const { s, p, unit, time } = await ready();
  await s.call("publish.start", { id: p.id });
  await ticks(s, 3);
  time("2026-10-16T00:00:02Z");
  await ticks(s, 2);
  const old = s
    .all("buckets")
    .find((b) => b.kind === "submission_target" && b.date === "2026-10-15");
  const next = s
    .all("buckets")
    .find((b) => b.kind === "submission_target" && b.date === "2026-10-16");
  assert.ok(next, "execution-day reservation missing");
  assert.equal(s.balance(old.id).reserved, 0);
  assert.equal(s.balance(next.id).spent, 1);
  s.close();
});
test("backup freezes running plans and invalidates queued execution approvals", async () => {
  const { s, root, p } = await ready();
  await s.call("publish.start", { id: p.id });
  await ticks(s, 1);
  const backup = path.join(root, "frozen.zip");
  await s.backup(backup);
  await s.restore(backup);
  assert.equal(s.all("approvals").length, 0);
  assert.equal(s.all("units")[0].state, "PAUSED");
  await assert.rejects(s.call("publish.start", { id: p.id }));
  s.close();
});
test("safe commit retry reuses already prepared and uploaded results", async () => {
  const { s, p, unit } = await ready();
  await s.call("publish.simulateFault", { id: unit.id, kind: "network" });
  await s.call("publish.start", { id: p.id });
  await ticks(s, 5);
  await s.call("publish.retry", { id: p.id });
  await ticks(s, 5);
  const u = s.get("units", unit.id);
  assert.equal(u.preparedCount, 1);
  assert.equal(u.uploadCount, 1);
  assert.equal(u.commitCount, 2);
  s.close();
});

test("manual receipt is explicit user evidence, independently records review/live, and never submits", async () => {
  const { s, unit } = await ready();
  const report = {
    id: unit.id,
    remoteId: "QA-manual-receipt",
    remoteUrl: "https://music.163.com/",
    review: "approved",
    publication: "unknown",
    reason: "",
    evidence: "QA synthetic manual confirmation; no real posting",
    observedAt: new Date().toISOString(),
  };
  await s.call("publish.recordManual", report);
  const u = s.get("units", unit.id);
  assert.equal(u.state, "SUBMITTED");
  assert.equal(u.receipt.source, "user_report");
  assert.equal(u.review, "approved");
  assert.equal(u.publication, "unknown");
  assert.equal(u.commitCount, 0);
  await s.call("publish.recordManual", report);
  assert.equal(
    s.all("ledger").filter((e) => e.sourceEventId === "QA-manual-receipt")
      .length,
    1,
  );
  assert.equal(s.externalRequests, 0);
  s.close();
});
test("restored paused simulation can be prechecked and approved again without restoring old approval", async () => {
  const { s, root, p } = await ready();
  await s.call("publish.start", { id: p.id });
  await ticks(s, 1);
  const file = path.join(root, "again.zip");
  await s.backup(file);
  await s.restore(file);
  await s.call("publish.revalidate", { id: p.id });
  await s.call("publish.approve", { id: p.id, snapshotHash: p.snapshotHash });
  await s.call("publish.start", { id: p.id });
  await ticks(s, 5);
  assert.equal(s.all("units")[0].state, "SUBMITTED");
  s.close();
});
