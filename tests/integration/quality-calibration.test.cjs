const test = require("node:test"),
  assert = require("node:assert/strict"),
  q = require(process.env.RAINFALL_QUALITY_BUNDLE || "../../build/quality.cjs");
const { randomUUID } = require("node:crypto");
const config = {
  ruleVersion: "quality-v1",
  policyVersion: "fixture-policy-1",
  minimum: { calibration: 40, positive: 20, negative: 20, validation: 20 },
  targets: [{ language: "中文", style: "民谣" }],
  acceptance: {
    hardFalseAcceptMax: 0,
    falseAcceptMax: 0.05,
    falseRejectMax: 0.15,
  },
};
const row = (overrides = {}) => ({
  id: randomUUID(),
  split: "validation",
  language: "中文",
  style: "民谣",
  human: "fail",
  humanHardFailure: false,
  predicted: "fail",
  labelSource: "human",
  ruleVersion: "quality-v1",
  policyVersion: "fixture-policy-1",
  ...overrides,
});
test("calibration reports exact false-accept/reject denominators and pending coverage", () => {
  const bad = Array.from({ length: 20 }, (_, i) =>
    row({ predicted: i === 0 ? "pass" : "fail", humanHardFailure: i < 4 }),
  );
  const good = Array.from({ length: 20 }, (_, i) =>
    row({
      human: "pass",
      predicted: i < 3 ? "fail" : i < 5 ? "pending" : "pass",
    }),
  );
  const r = q.calibrate([...bad, ...good], config),
    v = r.human.validation;
  assert.equal(v.falseAccept.rate, 0.05);
  assert.equal(v.falseAccept.denominator, 20);
  assert.equal(v.falseReject.rate, 0.15);
  assert.equal(v.endToEndNonReleaseRate.rate, 0.25);
  assert.equal(v.hardFalseAccept.rate, 0.25);
  assert.equal(v.pending.numerator, 2);
  assert.equal(v.falseAccept.interval.length, 2);
  assert(v.falseAccept.interval[0] < 0.05 && v.falseAccept.interval[1] > 0.05);
  assert.equal(r.human.acceptanceMet, false);
  assert(r.human.warnings.includes("CALIBRATION_SAMPLE_INSUFFICIENT"));
});
test("synthetic calibration cannot become human accuracy evidence", () => {
  const human = row(),
    synthetic = Array.from({ length: 40 }, () =>
      row({ labelSource: "synthetic", predicted: "pass" }),
    );
  const r = q.calibrate([human, ...synthetic], config);
  assert.equal(r.mixed, true);
  assert.equal(r.human.validation.falseAccept.denominator, 1);
  assert.equal(r.synthetic.validation.falseAccept.denominator, 40);
  assert.equal(r.synthetic.accuracyEvidence, false);
  assert.equal(
    q.calibrate(synthetic, config).human.validation.falseAccept.rate,
    null,
  );
  assert.equal("calibrationApprovalRef" in r, false);
});
test("zero denominators, disputed labels and missing strata are explicit", () => {
  const r = q.calibrate([row({ human: "disputed" })], config);
  assert.equal(r.human.validation.falseAccept.rate, null);
  assert.equal(r.human.validation.falseAccept.interval, null);
  assert.equal(r.human.validation.disputed, 1);
  assert(r.human.warnings.includes("VALIDATION_SAMPLE_INSUFFICIENT"));
  assert(r.human.targets[0].warnings.length > 0);
});
test("calibration rejects duplicate sample identities and mixed rules/policies or contradictory human labels", () => {
  const a = row();
  assert.throws(() => q.calibrate([a, a], config), /DUPLICATE_SAMPLE/);
  assert.throws(
    () => q.calibrate([row({ ruleVersion: "old" })], config),
    /VERSION_MISMATCH/,
  );
  assert.throws(
    () => q.calibrate([row({ policyVersion: "old" })], config),
    /VERSION_MISMATCH/,
  );
  assert.throws(() =>
    q.calibrate([row({ human: "pass", humanHardFailure: true })], config),
  );
});
