const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs");
const { levels, all4, pair } = require("../fixtures/quality.cjs");
const api = () => {
  const bundle =
    process.env.RAINFALL_QUALITY_BUNDLE || "../../build/quality.cjs";
  assert(
    fs.existsSync(require.resolve(bundle)),
    "quality bundle not implemented",
  );
  return require(bundle);
};
test("quality score uses exact approved weights and never rounds a borderline pass", () => {
  const { score, meetsThresholds } = api();
  const low = score(levels([2, 3, 4, 4], [2, 4, 3, 4], [3, 4, 3]));
  assert.equal(low.S, 79.9375);
  assert.equal(meetsThresholds(low), false);
  const good = score(levels([4, 3, 3, 3], [4, 3, 3, 3], [4, 3, 3]));
  assert.equal(good.S, 82.875);
  assert.equal(meetsThresholds(good), true);
  assert.equal(meetsThresholds(good, { L: 90, M: 75, C: 80, S: 80 }), false);
  assert.equal(score(all4).S, 100);
  assert.equal(score(levels([0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0])).S, 0);
});
test("missing quality levels stay null and invalid levels or omitted fields are rejected", () => {
  const { score, meetsThresholds } = api();
  const s = score({ ...all4, L1: null });
  assert.equal(s.L, null);
  assert.equal(s.S, null);
  assert.equal(meetsThresholds(s), null);
  for (const v of [-1, 5, 1.5, Infinity])
    assert.throws(() => score({ ...all4, L1: v }));
  const { L1, ...missing } = all4;
  assert.throws(() => score(missing));
});
test("pair hash binds content and capability independent of property ordering", () => {
  const { pairHash } = api(),
    p = pair();
  assert.equal(
    pairHash(p),
    pairHash(Object.fromEntries(Object.entries(p).reverse())),
  );
  assert.notEqual(pairHash(p), pairHash({ ...p, musicPrompt: "另一个方向" }));
  assert.notEqual(
    pairHash(p),
    pairHash({ ...p, capability: { ...p.capability, version: "2" } }),
  );
});
