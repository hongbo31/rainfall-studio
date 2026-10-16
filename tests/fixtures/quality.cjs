const { randomUUID } = require("node:crypto");
const ids = ["L1", "L2", "L3", "L4", "M1", "M2", "M3", "M4", "C1", "C2", "C3"];
const levels = (l = [4, 4, 4, 4], m = [4, 4, 4, 4], c = [4, 4, 4]) =>
  Object.fromEntries(ids.map((id, i) => [id, [...l, ...m, ...c][i]]));
function pair(overrides = {}) {
  return {
    attemptId: randomUUID(),
    revisionId: randomUUID(),
    parentRevisionId: null,
    lyrics: "雨还没停……\n[副歌]\n你会来吗？",
    musicPrompt: "温柔的人声，轻声进入，尾声留白",
    intent: "用克制的语气写一次等待",
    language: "中文",
    style: "民谣",
    generator: {
      modelId: "fixture-generator",
      modelVersion: "1",
      promptVersion: "1",
    },
    lockedSpans: [],
    capability: {
      version: "fixture-cap-1",
      verified: true,
      lengthUnit: "codepoint",
      limits: { lyrics: 5000, musicPrompt: 1000 },
      requiredFields: ["lyrics", "musicPrompt"],
    },
    ...overrides,
  };
}
module.exports = { ids, levels, all4: levels(), pair };
function policy(approved = true) {
  const values = {
    version: "fixture-policy-1",
    thresholds: { L: 75, M: 75, C: 80, S: 80 },
    maxRevisions: 2,
    criticalDimensions: ["L1", "M2", "C2"],
    borderlineBand: 2,
    minimumConfidence: 0.8,
    majorLevelGap: 2,
    majorScoreGap: 10,
    evaluationRetryLimit: 1,
    merge: "per_dimension_min",
    calibrationMinimum: {
      calibration: 40,
      positive: 20,
      negative: 20,
      validation: 20,
    },
    calibrationAcceptance: {
      hardFalseAcceptMax: 0,
      falseAcceptMax: 0.05,
      falseRejectMax: 0.15,
    },
    evaluatorProfile: {
      primary: {
        modelId: "fixture-primary",
        modelVersion: "1",
        promptVersion: "1",
      },
      review: {
        modelId: "fixture-review",
        modelVersion: "1",
        promptVersion: "1",
      },
    },
    approvalRefs: {},
    calibrationApprovalRef: approved
      ? "FIXTURE_ONLY_NOT_HUMAN_CALIBRATION"
      : null,
  };
  values.approvalRefs = approved
    ? Object.fromEntries(
        Object.keys(values)
          .filter(
            (k) =>
              !["version", "approvalRefs", "calibrationApprovalRef"].includes(
                k,
              ),
          )
          .map((k) => [k, "FIXTURE_ONLY_APPROVAL"]),
      )
    : {};
  return values;
}
function assessment(
  p,
  group,
  values = levels(),
  pol = policy(),
  review = false,
) {
  const { pairHash, hashValue, evaluationContext } = require(
    process.env.RAINFALL_QUALITY_BUNDLE || "../../build/quality.cjs",
  );
  const field = group === "M" ? "musicPrompt" : "lyrics",
    content = p[field];
  return {
    id: randomUUID(),
    sessionId: randomUUID(),
    contextHash: hashValue(evaluationContext(p, group)),
    pairHash: pairHash(p),
    ruleVersion: "quality-v1",
    policyVersion: pol.version,
    ...pol.evaluatorProfile[review ? "review" : "primary"],
    group,
    levels: Object.fromEntries(
      ids.filter((id) => id.startsWith(group)).map((id) => [id, values[id]]),
    ),
    findings: ids
      .filter(
        (id) => id.startsWith(group) && values[id] !== null && values[id] < 4,
      )
      .map((id) => ({
        id: randomUUID(),
        defectKey: "fixture-" + id,
        impact: "FIXTURE: 此句表达的目标不够清楚",
        suggestion: "FIXTURE: 只修改引用的问题",
        owner: id,
        evidence: [{ field, start: 0, end: content.length, quote: content }],
      })),
    confidence: 1,
    status: "complete",
  };
}
const assessments = (p, values = levels(), pol = policy(), review = false) =>
  ["L", "M", "C"].map((g) => assessment(p, g, values, pol, review));
module.exports = { ...module.exports, policy, assessment, assessments };
