const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto"),
  sharp = require("sharp");
const { Studio } = require("../../build/core.cjs");
function setup() {
  const root = path.resolve("output/test-runs", randomUUID()),
    s = new Studio(root, "simulation");
  return { root, s, a: s.all("artists")[0] };
}
async function plan(s, a, policy) {
  return s.call("plan.save", {
    artistId: a.id,
    title: "检查点QA",
    story: "原创故事",
    timezone: "Etc/UTC",
    time: "08:00",
    enabled: false,
    candidateLimit: 2,
    finishedGoal: 1,
    costLimit: 0,
    overrides: {},
    checkpoints: {
      lyrics: "manual",
      candidate: "manual",
      cover: "manual",
      finished: "manual",
      publish: "manual",
      ...policy,
    },
  });
}
test("manual lyrics cannot be bypassed by importing audio first", async () => {
  const { s, a } = setup(),
    p = await plan(s, a, {}),
    r = await s.call("creation.start", {
      artistId: a.id,
      planId: p.id,
      title: "QA检查点",
      story: "故事",
      overrides: {},
    });
  const w = s.get("works", r.workId);
  s.save("works", { ...w, assets: { audio_A: randomUUID() } });
  s.refreshRunForWork(w.id);
  assert.equal(s.get("runs", r.id).step, "lyrics");
  s.close();
});
test("candidate manual checkpoint and automatic cover policy are applied independently", async () => {
  const { s, a } = setup(),
    p = await plan(s, a, { lyrics: "automatic", cover: "automatic" }),
    r = await s.call("creation.start", {
      artistId: a.id,
      planId: p.id,
      title: "QA检查点",
      story: "故事",
      overrides: {},
    });
  const w = s.get("works", r.workId);
  s.save("works", {
    ...w,
    assets: { audio_A: randomUUID(), cover: randomUUID() },
  });
  s.refreshRunForWork(w.id);
  assert.equal(s.get("runs", r.id).step, "candidate");
  await s.call("run.confirm", { id: r.id, step: "candidate" });
  assert.equal(s.get("runs", r.id).step, "finished");
  assert.equal(
    s.all("steps").find((x) => x.runId === r.id && x.name === "cover").state,
    "succeeded",
  );
  s.close();
});
test("tightening budget updates current bucket without removing old reservations", async () => {
  const { s } = setup();
  const snap = s.snapshot();
  s.reserve("inflight", [{ id: snap.resources.cost.id, amount: 1000 }]);
  await s.call("budget.save", { costLimit: 500, candidateLimit: 1 });
  const next = s.snapshot();
  assert.equal(next.resources.cost.limit, 500);
  assert.equal(next.resources.cost.reserved, 1000);
  assert.equal(next.resources.cost.available, 0);
  s.close();
});
test("repeating unknown-outcome recovery never duplicates the risk ledger", () => {
  const { s } = setup();
  const bucket = s.ensureBucket("cost", "recovery", "2026-10-15", 100);
  s.reserve("crash-op", [{ id: bucket.id, amount: 5 }]);
  s.markUnknown("crash-op");
  s.markUnknown("crash-op");
  assert.equal(s.balance(bucket.id).reserved, 5);
  assert.equal(
    s
      .all("ledger")
      .filter((e) => e.operationId === "crash-op" && e.kind === "unknown")
      .length,
    1,
  );
  s.close();
});
