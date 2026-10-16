const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto");
const q = require(
    process.env.RAINFALL_QUALITY_BUNDLE || "../../build/quality.cjs",
  ),
  { pair, policy, levels, assessment } = require("../fixtures/quality.cjs");
const root = () => path.resolve("output/test-runs", "quality-" + randomUUID());
function script(p, pol, values = levels()) {
  const responses = {};
  for (const kind of [
    "evaluate_L",
    "evaluate_M",
    "evaluate_C",
    "review_L",
    "review_M",
    "review_C",
  ])
    responses[q.effectKey(p, pol, kind)] = [
      {
        status: "ok",
        actualCost: 1,
        assessment: assessment(
          p,
          kind.at(-1),
          values,
          pol,
          kind.startsWith("review"),
        ),
        hard: { status: "clear", issues: [] },
      },
    ];
  return {
    kind: "fixture",
    responses,
    budgetLimit: 100,
    authorizedSendLimit: 38,
    maxCosts: Object.fromEntries(q.effectKinds.map((k) => [k, 1])),
  };
}
test("quality fixture preserves two total revisions across complete reassessment and replay", async () => {
  const pol = policy(),
    p = pair(),
    p1 = { ...p, revisionId: randomUUID(), parentRevisionId: p.revisionId },
    p2 = { ...p, revisionId: randomUUID(), parentRevisionId: p1.revisionId };
  const low = levels([2, 3, 4, 4], [2, 4, 3, 4], [3, 4, 3]),
    s = script(p, pol, low);
  Object.assign(
    s.responses,
    script(p1, pol, low).responses,
    script(p2, pol, low).responses,
  );
  s.responses[q.effectKey(p, pol, "revise")] = [
    { status: "ok", actualCost: 1, pair: p1 },
  ];
  s.responses[q.effectKey(p1, pol, "revise")] = [
    { status: "ok", actualCost: 1, pair: p2 },
  ];
  const dir = root(),
    j = q.openFixtureJournal(dir);
  let r = await q.runFixture(p, pol, s, j);
  assert.equal(r.decision.state, "manual");
  assert.equal(r.pairs.length, 3);
  assert.equal(r.spent, 20);
  assert.equal(r.reserved, 0);
  assert.equal(r.events.filter((e) => e.type === "revision").length, 2);
  assert.equal(r.events.filter((e) => e.type === "dispatch").length, 20);
  j.close();
  const reopened = q.openFixtureJournal(dir),
    again = await q.runFixture(p, pol, s, reopened);
  assert.deepEqual(again, r);
  await assert.rejects(
    q.runFixture({ ...p, musicPrompt: "changed" }, pol, s, reopened),
    /IDEMPOTENCY_CONFLICT/,
  );
  reopened.close();
});
test("quality fixture handles safe unsent retry with one key but freezes unknown without regeneration", async () => {
  const p = pair(),
    pol = policy(),
    s = script(p, pol),
    key = q.effectKey(p, pol, "evaluate_L");
  s.responses[key].unshift({ status: "confirmed_unsent", actualCost: 0 });
  let j = q.openFixtureJournal(root());
  let r = await q.runFixture(p, pol, s, j);
  assert.equal(r.decision.state, "pass");
  assert.equal(r.spent, 3);
  assert.equal(
    r.events.filter((e) => e.type === "dispatch" && e.operationKey === key)
      .length,
    2,
  );
  j.close();
  s.responses[key] = [{ status: "unknown", actualCost: null }];
  j = q.openFixtureJournal(root());
  r = await q.runFixture(p, pol, s, j);
  assert.equal(r.decision.state, "pending");
  assert.equal(r.frozen, true);
  assert.equal(r.reserved, 20);
  assert.equal(r.events.filter((e) => e.type === "dispatch").length, 1);
  assert.equal(r.pairs.length, 1);
  j.close();
});
test("quality fixture fails closed for evaluation failures, insufficient budget, missing approvals and send caps", async () => {
  const p = pair(),
    pol = policy();
  for (const kind of ["failed", "insufficient", "budget", "approval", "send"]) {
    const s = script(p, pol);
    let selected = pol;
    if (kind === "budget") s.budgetLimit = 19;
    if (kind === "send") s.authorizedSendLimit = 0;
    if (kind === "approval") selected = policy(false);
    if (["failed", "insufficient"].includes(kind))
      s.responses[q.effectKey(p, pol, "evaluate_L")][0].assessment.status =
        kind;
    const j = q.openFixtureJournal(root()),
      r = await q.runFixture(p, selected, s, j);
    assert.notEqual(r.decision.state, "pass");
    assert.equal(r.events.filter((e) => e.type === "revision").length, 0);
    assert.equal(r.decision.canProceedToMusic, false);
    if (["budget", "approval", "send"].includes(kind))
      assert.equal(r.events.filter((e) => e.type === "dispatch").length, 0);
    j.close();
  }
});
test("quality hard failure skips semantic costs and locked text cannot silently change", async () => {
  const p = pair({ lyrics: "" }),
    pol = policy(),
    s = script(p, pol);
  const repaired = {
    ...p,
    lyrics: "修好的文字",
    revisionId: randomUUID(),
    parentRevisionId: p.revisionId,
  };
  s.responses[q.effectKey(p, pol, "revise")] = [
    { status: "ok", actualCost: 1, pair: repaired },
  ];
  Object.assign(s.responses, script(repaired, pol).responses);
  let j = q.openFixtureJournal(root()),
    r = await q.runFixture(p, pol, s, j);
  assert.equal(r.spent, 4);
  assert.equal(r.decision.state, "pass");
  j.close();
  const locked = pair();
  locked.lockedSpans = [{ field: "lyrics", start: 0, end: 1, quote: "雨" }];
  const bad = {
    ...locked,
    lyrics: "晴天",
    revisionId: randomUUID(),
    parentRevisionId: locked.revisionId,
    lockedSpans: [],
  };
  const ls = script(locked, pol, levels([1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1]));
  ls.responses[q.effectKey(locked, pol, "revise")] = [
    { status: "ok", actualCost: 1, pair: bad },
  ];
  j = q.openFixtureJournal(root());
  r = await q.runFixture(locked, pol, ls, j);
  assert.equal(r.decision.state, "pending");
  assert(r.decision.reasons.includes("LOCKED_CONTENT_CHANGED"));
  assert.equal(r.pairs.length, 1);
  j.close();
});
test("quality journal is scoped, idempotent and interrupted dispatch never resubmits", async () => {
  assert.throws(
    () => q.openFixtureJournal(path.resolve("output/not-quality")),
    /JOURNAL_PATH/,
  );
  const p = pair(),
    pol = policy(),
    s = script(p, pol),
    dir = root(),
    base = q.openFixtureJournal(dir);
  const interrupted = {
    ...base,
    read: () => base.read(),
    close: () => base.close(),
    append: (e) => {
      base.append(e);
      if (e.type === "dispatch") throw Error("SIMULATED_CRASH");
    },
  };
  await assert.rejects(q.runFixture(p, pol, s, interrupted), /SIMULATED_CRASH/);
  const r = await q.runFixture(p, pol, s, base);
  assert.equal(r.frozen, true);
  assert.equal(r.events.filter((e) => e.type === "dispatch").length, 1);
  assert.equal(r.reserved, 20);
  base.close();
  const j = q.openFixtureJournal(root()),
    e = {
      eventKey: "same",
      operationKey: "op",
      type: "reserve",
      payload: { amount: 1 },
    };
  j.append(e);
  j.append(e);
  assert.equal(j.read().length, 1);
  assert.throws(
    () => j.append({ ...e, payload: { amount: 2 } }),
    /IDEMPOTENCY_CONFLICT/,
  );
  j.close();
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  fs.writeFileSync(path.join(dir, files.at(-1)), "{");
  const corrupt = q.openFixtureJournal(dir),
    pending = await q.runFixture(p, pol, s, corrupt);
  assert.equal(pending.decision.state, "pending");
  assert.equal(pending.frozen, true);
  corrupt.close();
});

test("all eighteen assessments may retry only proven-unsent attempts within thirty-eight sends", async () => {
  const pol = policy(),
    p = pair(),
    p1 = { ...p, revisionId: randomUUID(), parentRevisionId: p.revisionId },
    p2 = { ...p, revisionId: randomUUID(), parentRevisionId: p1.revisionId };
  const low = levels([2, 3, 4, 4], [2, 4, 3, 4], [3, 4, 3]),
    s = script(p, pol, low);
  Object.assign(
    s.responses,
    script(p1, pol, low).responses,
    script(p2, pol, low).responses,
  );
  for (const responses of Object.values(s.responses))
    responses.unshift({ status: "confirmed_unsent", actualCost: 0 });
  s.responses[q.effectKey(p, pol, "revise")] = [
    { status: "ok", actualCost: 1, pair: p1 },
  ];
  s.responses[q.effectKey(p1, pol, "revise")] = [
    { status: "ok", actualCost: 1, pair: p2 },
  ];
  const j = q.openFixtureJournal(root()),
    r = await q.runFixture(p, pol, s, j);
  assert.equal(r.events.filter((e) => e.type === "dispatch").length, 38);
  assert.equal(r.spent, 20);
  assert.equal(r.pairs.length, 3);
  assert.equal(r.decision.state, "manual");
  j.close();
});

test("journal junctions cannot redirect output and incomplete temporary files cannot restore a pass", async () => {
  const outside = root(),
    linked = root();
  fs.mkdirSync(outside, { recursive: true });
  fs.symlinkSync(outside, linked, "junction");
  try {
    assert.throws(() => q.openFixtureJournal(linked), /JOURNAL_PATH/);
    assert.deepEqual(fs.readdirSync(outside), []);
  } finally {
    fs.unlinkSync(linked);
  }
  const p = pair(),
    pol = policy(),
    s = script(p, pol),
    dir = root(),
    j = q.openFixtureJournal(dir);
  await q.runFixture(p, pol, s, j);
  j.close();
  fs.writeFileSync(path.join(dir, "00000099.json.tmp-crash"), "{");
  const dirty = q.openFixtureJournal(dir),
    r = await q.runFixture(p, pol, s, dirty);
  assert.equal(r.decision.state, "pending");
  assert.equal(r.frozen, true);
  dirty.close();
});
