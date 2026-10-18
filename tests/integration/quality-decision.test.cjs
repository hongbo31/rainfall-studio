const test = require("node:test"),
  assert = require("node:assert/strict"),
  q = require(process.env.RAINFALL_QUALITY_BUNDLE || "../../build/quality.cjs");
const {
  pair,
  policy,
  levels,
  assessments,
} = require("../fixtures/quality.cjs");
function input(values = levels()) {
  const p = pair(),
    pol = policy();
  return {
    pair: p,
    policy: pol,
    hard: { status: "clear", issues: [] },
    primary: assessments(p, values, pol),
    review: null,
    reviewHard: null,
    revisionCount: 0,
    costState: "settled",
    expectedPairHash: q.pairHash(p),
  };
}
test('independent hard disagreements require manual review in either direction',()=>{
 const i=input();i.review=assessments(i.pair,levels(),i.policy,true);
 const failed={status:'failed',issues:[{code:'contradiction',evidence:[]}]},clear={status:'clear',issues:[]};
 assert.equal(q.decide({...i,hard:failed,reviewHard:clear}).state,'manual');
 assert.equal(q.decide({...i,hard:clear,reviewHard:failed}).state,'manual');
 assert.equal(q.decide({...i,hard:failed,review:null,reviewHard:null,primary:[]}).state,'revise');
});
test("quality gate requires every approval and never permits music even for a pass", () => {
  const i = input(levels([4, 3, 3, 3], [4, 3, 3, 3], [4, 3, 3]));
  assert.equal(q.decide(i).state, "pass");
  assert.equal(q.decide(i).canProceedToMusic, false);
  for (const key of Object.keys(i.policy.approvalRefs)) {
    const p = structuredClone(i.policy);
    delete p.approvalRefs[key];
    assert.equal(q.decide({ ...i, policy: p }).state, "shadow", key);
  }
  for (const key of [
    "criticalDimensions",
    "borderlineBand",
    "minimumConfidence",
    "majorLevelGap",
    "majorScoreGap",
    "evaluationRetryLimit",
    "merge",
    "calibrationMinimum",
    "calibrationAcceptance",
    "evaluatorProfile",
    "calibrationApprovalRef",
  ])
    assert.equal(
      q.decide({ ...i, policy: { ...i.policy, [key]: null } }).state,
      "shadow",
      key,
    );
  const hard = {
    status: "failed",
    issues: [{ code: "empty", evidence: [], path: "lyrics" }],
  };
  assert.equal(q.decide({ ...i, hard, primary: [] }).state, "revise");
  assert.equal(q.decide({ ...i, hard, primary: [] }).scores.S, null);
  const shadow = q.decide({ ...i, hard, policy: policy(false) });
  assert.equal(shadow.state, "shadow");
  assert.equal(shadow.wouldPass, false);
  assert.equal(q.decide({ ...i, hard, revisionCount: 2 }).state, "manual");
  assert.throws(() => q.decide({ ...i, revisionCount: 3 }));
});
test("quality review keeps critical zero, borderline and confidence distinct", () => {
  let i = input();
  i.primary[0].confidence = 0.7;
  assert.equal(q.decide(i).state, "review");
  i.primary[0].confidence = null;
  assert.equal(q.decide(i).state, "pending");
  i = input(levels([2, 3, 4, 4], [2, 4, 3, 4], [3, 4, 3]));
  assert.equal(q.decide(i).state, "review");
  i = input(levels([4, 0, 4, 4]));
  assert(!q.decide(i).reasons.includes("critical0"));
  i = input(levels([0, 4, 4, 4]));
  assert(q.decide(i).reasons.includes("critical0"));
  i = input();
  i.primary[0].confidence = 0.7;
  i.review = assessments(i.pair, levels(), i.policy, true);
  i.reviewHard = i.hard;
  assert.equal(q.decide(i).state, "pass");
  i.review[0].levels.L1 = 2;
  i.review[0].findings = assessments(
    i.pair,
    levels([2, 4, 4, 4]),
    i.policy,
    true,
  )[0].findings;
  assert.equal(q.decide(i).state, "manual");
});
test("quality stale evidence and review failures cannot release a pair", () => {
  const i = input();
  for (const mutation of [
    { pairHash: "old" },
    { ruleVersion: "old" },
    { policyVersion: "old" },
    { modelId: "different" },
    { status: "failed" },
    { status: "insufficient" },
  ]) {
    const reports = structuredClone(i.primary);
    Object.assign(reports[0], mutation);
    assert.equal(q.decide({ ...i, primary: reports }).state, "pending");
  }
  assert.equal(q.decide({ ...i, expectedPairHash: "old" }).state, "pending");
  assert.equal(q.decide({ ...i, costState: "unknown" }).state, "pending");
  i.primary[0].confidence = 0.7;
  i.review = assessments(i.pair, levels(), i.policy, true);
  i.reviewHard = i.hard;
  i.review[0].sessionId = i.primary[0].sessionId;
  assert.equal(q.decide(i).state, "pending");
  i.review = assessments(i.pair, levels(), i.policy, true);
  i.review[0].status = "failed";
  assert.equal(q.decide(i).state, "manual");
  i.review = assessments(i.pair, levels(), i.policy, true);
  i.reviewHard = {
    status: "failed",
    issues: [{ code: "contradiction", evidence: [] }],
  };
  assert.equal(q.decide(i).state, "manual");
});
test("nonmajor review merges dimension minima and retains separate evidence ownership", () => {
  const i = input();
  i.primary[0].confidence = 0.7;
  i.review = assessments(i.pair, levels([3, 4, 4, 4]), i.policy, true);
  i.reviewHard = i.hard;
  const d = q.decide(i);
  assert.equal(d.state, "pass");
  assert.equal(d.scores.L, 92.5);
  assert.equal(d.canProceedToMusic, false);
  i.review = assessments(i.pair, levels(), i.policy, true).slice(0, 2);
  assert.equal(q.decide(i).state, "pending");
});
