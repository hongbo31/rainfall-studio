import {
  DecisionInputSchema,
  PolicySchema,
  RULE_VERSION,
  dimensionIds,
  groups,
  type Assessment,
  type Decision,
  type DecisionInput,
  type DimensionId,
  type Level,
  type Policy,
} from "./contracts";
import { pairHash, score, meetsThresholds } from "./scoring";
import { validateAssessments } from "./rules";

export function policyIssues(input: Policy): string[] {
  const p = PolicySchema.parse(input),
    keys = [
      "thresholds",
      "maxRevisions",
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
    ] as const;
  return [
    ...keys
      .filter((k) => p[k] === null || !p.approvalRefs[k])
      .map((k) => "UNAPPROVED_" + k),
    ...(!p.calibrationApprovalRef ? ["CALIBRATION_NOT_APPROVED"] : []),
  ];
}
const emptyScores = () =>
  score(
    Object.fromEntries(dimensionIds.map((id) => [id, null])) as Record<
      DimensionId,
      Level
    >,
  );
const reportLevels = (reports: Assessment[]) =>
  Object.assign({}, ...reports.map((a) => a.levels)) as Record<
    DimensionId,
    Level
  >;
function reportsReady(
  i: DecisionInput,
  reports: Assessment[],
  review: boolean,
) {
  const checked = validateAssessments(i.pair, reports),
    profile = i.policy.evaluatorProfile![review ? "review" : "primary"];
  const reasons = [...checked.reasons];
  if (!groups.every((g) => reports.filter((a) => a.group === g).length === 1))
    reasons.push("MISSING_GROUP");
  if (
    reports.some(
      (a) =>
        a.ruleVersion !== RULE_VERSION ||
        a.policyVersion !== i.policy.version ||
        a.modelId !== profile.modelId ||
        a.modelVersion !== profile.modelVersion ||
        a.promptVersion !== profile.promptVersion,
    )
  )
    reasons.push("STALE_ASSESSMENT_PROFILE");
  return reasons;
}
export function decide(input: DecisionInput): Decision {
  const i = DecisionInputSchema.parse(input),
    p = i.policy,
    reasons = i.hard.issues.map((x) => "hard:" + x.code);
  let scores = emptyScores();
  const result = (
    state: Decision["state"],
    wouldPass: boolean | null = null,
    extra: string[] = [],
  ): Decision => ({
    state,
    wouldPass,
    canProceedToMusic: false,
    reasons: [...new Set([...reasons, ...extra])],
    scores,
  });
  if (i.hard.status === "failed") reasons.push("hard_failure");
  if (i.expectedPairHash !== pairHash(i.pair))
    return result("pending", null, ["STALE_PAIR"]);
  if (i.costState === "unknown" || i.hard.status === "pending")
    return result("pending", null, [
      i.costState === "unknown" ? "COST_UNKNOWN" : "HARD_CHECK_PENDING",
    ]);
  const unapproved = policyIssues(p);
  if (unapproved.length)
    return result(
      "shadow",
      i.hard.status === "failed" ? false : null,
      unapproved,
    );
  const revise = () =>
    result(
      i.revisionCount < p.maxRevisions ? "revise" : "manual",
      false,
      i.revisionCount >= p.maxRevisions ? ["REVISION_LIMIT"] : [],
    );
  if (i.hard.status === "failed") {
    if (i.review !== null) {
      const reviewIssues = [...reportsReady(i, i.primary, false), ...reportsReady(i, i.review, true)];
      if (i.review.some((a) => i.primary.some((b) => a.sessionId === b.sessionId))) reviewIssues.push("REVIEW_SESSION_REUSED");
      if (!i.reviewHard) reviewIssues.push("REVIEW_HARD_MISSING");
      if (reviewIssues.length) return result("pending", null, reviewIssues);
      if (i.reviewHard!.status !== i.hard.status) return result("manual", false, ["HARD_DISAGREEMENT"]);
    }
    return revise();
  }
  const primaryIssues = reportsReady(i, i.primary, false);
  if (primaryIssues.length) return result("pending", null, primaryIssues);
  if (i.primary.some((a) => a.confidence === null))
    return result("pending", null, ["CONFIDENCE_MISSING"]);
  const primary = reportLevels(i.primary);
  scores = score(primary);
  const hasCritical = (v: Record<DimensionId, Level>) =>
    p.criticalDimensions!.some((id) => v[id] === 0);
  if (hasCritical(primary)) reasons.push("critical0");
  const passes = (v: Record<DimensionId, Level>) =>
    meetsThresholds(score(v), p.thresholds) === true && !hasCritical(v);
  const needsReview =
    i.primary.some((a) => a.confidence! < p.minimumConfidence!) ||
    groups
      .concat("S" as any)
      .some(
        (g) =>
          Math.abs(
            scores[g as "L" | "M" | "C" | "S"]! -
              p.thresholds[g as "L" | "M" | "C" | "S"],
          ) <= p.borderlineBand!,
      );
  if (needsReview && i.review === null)
    return result("review", passes(primary), ["INDEPENDENT_REVIEW_REQUIRED"]);
  let effective = primary;
  if (i.review !== null) {
    if (i.review.some((a) => a.status !== "complete"))
      return result("manual", null, ["REVIEW_FAILED"]);
    const reviewIssues = reportsReady(i, i.review, true);
    if (
      i.review.some((a) => i.primary.some((b) => a.sessionId === b.sessionId))
    )
      reviewIssues.push("REVIEW_SESSION_REUSED");
    if (!i.reviewHard) reviewIssues.push("REVIEW_HARD_MISSING");
    if (reviewIssues.length) return result("pending", null, reviewIssues);
    if (i.reviewHard!.status !== i.hard.status)
      return result("manual", false, ["HARD_DISAGREEMENT"]);
    if (
      i.review.some(
        (a) => a.confidence === null || a.confidence < p.minimumConfidence!,
      )
    )
      return result("manual", null, ["REVIEW_CONFIDENCE_INSUFFICIENT"]);
    const reviewed = reportLevels(i.review),
      rs = score(reviewed);
    const scoreGap = (["L", "M", "C", "S"] as const).some(
      (k) => Math.abs(scores[k]! - rs[k]!) >= p.majorScoreGap!,
    );
    if (
      dimensionIds.some(
        (id) => Math.abs(primary[id]! - reviewed[id]!) >= p.majorLevelGap!,
      ) ||
      scoreGap ||
      passes(primary) !== passes(reviewed) ||
      hasCritical(primary) !== hasCritical(reviewed)
    )
      return result("manual", false, ["MAJOR_DISAGREEMENT"]);
    const owners = new Map<string, string>();
    for (const a of [...i.primary, ...i.review])
      for (const f of a.findings) {
        if (owners.has(f.defectKey) && owners.get(f.defectKey) !== f.owner)
          return result("manual", null, ["REVIEW_DUPLICATE_ATTRIBUTION"]);
        owners.set(f.defectKey, f.owner);
      }
    effective = Object.fromEntries(
      dimensionIds.map((id) => [id, Math.min(primary[id]!, reviewed[id]!)]),
    ) as Record<DimensionId, Level>;
    scores = score(effective);
  }
  if (hasCritical(effective) && !reasons.includes("critical0"))
    reasons.push("critical0");
  return passes(effective) ? result("pass", true) : revise();
}
