import {
  CalibrationConfigSchema,
  CalibrationRowSchema,
  type CalibrationConfig,
  type CalibrationRow,
} from "./contracts";

type Rate = {
  numerator: number;
  denominator: number;
  rate: number | null;
  interval: [number, number] | null;
};
function rate(numerator: number, denominator: number): Rate {
  if (!denominator)
    return { numerator, denominator, rate: null, interval: null };
  const p = numerator / denominator,
    z = 1.959963984540054,
    z2 = z * z,
    d = 1 + z2 / denominator;
  const center = (p + z2 / (2 * denominator)) / d,
    half =
      (z *
        Math.sqrt((p * (1 - p)) / denominator + z2 / (4 * denominator ** 2))) /
      d;
  return {
    numerator,
    denominator,
    rate: p,
    interval: [Math.max(0, center - half), Math.min(1, center + half)],
  };
}
function summarize(rows: CalibrationRow[]) {
  const eligible = rows.filter((r) => r.human !== "disputed"),
    positive = eligible.filter((r) => r.human === "pass"),
    negative = eligible.filter((r) => r.human === "fail"),
    hard = negative.filter((r) => r.humanHardFailure);
  return {
    total: rows.length,
    eligible: eligible.length,
    positive: positive.length,
    negative: negative.length,
    disputed: rows.length - eligible.length,
    falseAccept: rate(
      negative.filter((r) => r.predicted === "pass").length,
      negative.length,
    ),
    falseReject: rate(
      positive.filter((r) => r.predicted === "fail").length,
      positive.length,
    ),
    hardFalseAccept: rate(
      hard.filter((r) => r.predicted === "pass").length,
      hard.length,
    ),
    pending: rate(
      eligible.filter((r) => r.predicted === "pending").length,
      eligible.length,
    ),
    shadow: rate(
      eligible.filter((r) => r.predicted === "shadow").length,
      eligible.length,
    ),
    evaluatedCoverage: rate(
      eligible.filter((r) => r.predicted === "pass" || r.predicted === "fail")
        .length,
      eligible.length,
    ),
    endToEndNonReleaseRate: rate(
      positive.filter((r) => r.predicted !== "pass").length,
      positive.length,
    ),
  };
}
function partition(
  rows: CalibrationRow[],
  config: CalibrationConfig,
  human: boolean,
) {
  const calibration = summarize(rows.filter((r) => r.split === "calibration")),
    validation = summarize(rows.filter((r) => r.split === "validation")),
    warnings: string[] = [];
  if (calibration.eligible < config.minimum.calibration)
    warnings.push("CALIBRATION_SAMPLE_INSUFFICIENT");
  if (calibration.positive < config.minimum.positive)
    warnings.push("POSITIVE_SAMPLE_INSUFFICIENT");
  if (calibration.negative < config.minimum.negative)
    warnings.push("NEGATIVE_SAMPLE_INSUFFICIENT");
  if (validation.eligible < config.minimum.validation)
    warnings.push("VALIDATION_SAMPLE_INSUFFICIENT");
  const minimumMet = warnings.length === 0;
  const targets = config.targets.map((t) => {
    const subset = rows.filter(
        (r) => r.language === t.language && r.style === t.style,
      ),
      cal = summarize(subset.filter((r) => r.split === "calibration")),
      val = summarize(subset.filter((r) => r.split === "validation"));
    const messages = [];
    if (!cal.eligible) messages.push("CALIBRATION_STRATUM_MISSING");
    if (!val.eligible) messages.push("VALIDATION_STRATUM_MISSING");
    if (!val.positive || !val.negative)
      messages.push("VALIDATION_STRATUM_CLASS_MISSING");
    return { ...t, calibration: cal, validation: val, warnings: messages };
  });
  if (targets.some((t) => t.warnings.length))
    warnings.push("STRATUM_COVERAGE_INSUFFICIENT");
  const checks = [
    [validation.hardFalseAccept.rate, config.acceptance.hardFalseAcceptMax],
    [validation.falseAccept.rate, config.acceptance.falseAcceptMax],
    [validation.falseReject.rate, config.acceptance.falseRejectMax],
  ] as const;
  if (checks.some(([v]) => v === null))
    warnings.push("VALIDATION_METRIC_UNESTIMABLE");
  const acceptanceMet = checks.some(([v, max]) => v !== null && v > max)
    ? false
    : minimumMet &&
        !targets.some((t) => t.warnings.length) &&
        checks.every(([v]) => v !== null)
      ? true
      : null;
  return {
    calibration,
    validation,
    targets,
    warnings,
    minimumMet,
    acceptanceMet,
    accuracyEvidence: human && rows.some((r) => r.human !== "disputed"),
  };
}
export function calibrate(
  rawRows: CalibrationRow[],
  rawConfig: CalibrationConfig,
) {
  const config = CalibrationConfigSchema.parse(rawConfig),
    rows = rawRows.map((r) => CalibrationRowSchema.parse(r)),
    ids = new Set<string>();
  for (const row of rows) {
    if (ids.has(row.id)) throw Error("DUPLICATE_SAMPLE");
    ids.add(row.id);
    if (
      row.ruleVersion !== config.ruleVersion ||
      row.policyVersion !== config.policyVersion
    )
      throw Error("VERSION_MISMATCH");
  }
  return {
    kind: "offline-calibration" as const,
    ruleVersion: config.ruleVersion,
    policyVersion: config.policyVersion,
    mixed: new Set(rows.map((r) => r.labelSource)).size > 1,
    human: partition(
      rows.filter((r) => r.labelSource === "human"),
      config,
      true,
    ),
    synthetic: partition(
      rows.filter((r) => r.labelSource === "synthetic"),
      config,
      false,
    ),
    limitations: [
      "Labels are caller-supplied; synthetic fixtures are not semantic accuracy evidence.",
      "Wilson intervals disclose sampling uncertainty, not independence or representativeness.",
      "No execution permission or calibration approval is produced. Audio benefit requires separately authorized listening evaluation.",
    ],
  };
}
export type CalibrationReport = ReturnType<typeof calibrate>;
