import {
  AssessmentSchema,
  GroupSchema,
  PairSchema,
  RuleEvidenceSchema,
  dimensionIds,
  type Assessment,
  type Group,
  type HardCheck,
  type Pair,
  type RuleEvidence,
  type Span,
} from "./contracts";
import { hashValue, pairHash } from "./scoring";

export const validSpan = (pair: Pair, s: Span) =>
  Number.isSafeInteger(s.start) &&
  Number.isSafeInteger(s.end) &&
  s.start >= 0 &&
  s.end > s.start &&
  s.end <= pair[s.field].length &&
  pair[s.field].slice(s.start, s.end) === s.quote;
export function evaluationContext(input: Pair, group: Group) {
  const p = PairSchema.parse(input);
  GroupSchema.parse(group);
  return {
    text:
      group === "L"
        ? p.lyrics
        : group === "M"
          ? p.musicPrompt
          : JSON.stringify({ lyrics: p.lyrics, musicPrompt: p.musicPrompt }),
    intent: p.intent,
    language: p.language,
    style: p.style,
    capability: p.capability,
  };
}
export function checkHardRules(input: Pair, evidence: RuleEvidence): HardCheck {
  const p = PairSchema.parse(input),
    issues: HardCheck["issues"] = [];
  let failed = false,
    pending = false;
  for (const field of new Set([
    "musicPrompt",
    ...p.capability.requiredFields,
  ] as const)) {
    if (!p[field].trim()) {
      failed = true;
      issues.push({ code: "empty", path: field, evidence: [] });
    }
  }
  if (!p.lyrics.trim() && !p.capability.requiredFields.includes("lyrics")) {
    pending = true;
    issues.push({ code: "LYRICS_POLICY_REQUIRED", path: "lyrics", evidence: [] });
  }
  for (const field of ["lyrics", "musicPrompt"] as const) {
    if (
      /^\{\{(?:WRITE_LYRICS_HERE|WRITE_PROMPT_HERE)\}\}$/.test(p[field].trim())
    ) {
      failed = true;
      issues.push({
        code: "placeholder",
        evidence: [{ field, start: 0, end: p[field].length, quote: p[field] }],
      });
    }
  }
  if (
    !p.capability.verified ||
    !p.capability.lengthUnit ||
    p.capability.limits.lyrics === undefined ||
    p.capability.limits.musicPrompt === undefined
  ) {
    pending = true;
    issues.push({ code: "CAPABILITY_UNKNOWN", evidence: [] });
  } else
    for (const field of ["lyrics", "musicPrompt"] as const) {
      const length =
        p.capability.lengthUnit === "utf16"
          ? p[field].length
          : Array.from(p[field]).length;
      if (length > p.capability.limits[field]!) {
        failed = true;
        issues.push({
          code: "verified_limit_exceeded",
          path: field,
          evidence: [
            { field, start: 0, end: p[field].length, quote: p[field] },
          ],
        });
      }
    }
  const parsed = RuleEvidenceSchema.safeParse(evidence);
  if (!parsed.success) {
    pending = true;
    issues.push({ code: "INVALID_RULE_EVIDENCE", evidence: [] });
  } else
    for (const e of parsed.data) {
      const valid = e.evidence.length
        ? e.evidence.every((s) => validSpan(p, s))
        : e.path !== undefined &&
          ["lyrics", "musicPrompt", "intent", "language", "style"].includes(
            e.path,
          ) &&
          !p[
            e.path as keyof Pick<
              Pair,
              "lyrics" | "musicPrompt" | "intent" | "language" | "style"
            >
          ].trim();
      if (!valid) {
        pending = true;
        issues.push({ code: "INVALID_RULE_EVIDENCE", evidence: [] });
        continue;
      }
      if (e.certainty === "confirmed") failed = true;
      else pending = true;
      issues.push({
        code: e.certainty === "suspected" ? "suspected_" + e.code : e.code,
        evidence: e.evidence,
        ...(e.path ? { path: e.path } : {}),
      });
    }
  return { status: failed ? "failed" : pending ? "pending" : "clear", issues };
}
export function validateAssessments(
  input: Pair,
  reports: Assessment[],
): { valid: boolean; reasons: string[] } {
  const p = PairSchema.parse(input),
    reasons: string[] = [],
    owners = new Map<string, string>(),
    sessions = new Set<string>(),
    seenGroups = new Set<string>();
  for (const raw of reports) {
    const parsed = AssessmentSchema.safeParse(raw);
    if (!parsed.success) {
      reasons.push("ASSESSMENT_SCHEMA");
      continue;
    }
    const a = parsed.data;
    if (a.status !== "complete")
      reasons.push("EVALUATION_" + a.status.toUpperCase());
    if (seenGroups.has(a.group)) reasons.push("DUPLICATE_GROUP");
    seenGroups.add(a.group);
    if (sessions.has(a.sessionId)) reasons.push("SESSION_REUSED");
    sessions.add(a.sessionId);
    if (
      a.pairHash !== pairHash(p) ||
      a.contextHash !== hashValue(evaluationContext(p, a.group))
    )
      reasons.push("STALE_CONTEXT");
    const ids = dimensionIds.filter((id) => id.startsWith(a.group));
    const visibleFields = a.group === "L" ? ["lyrics", "intent"] : a.group === "M" ? ["musicPrompt", "intent"] : ["lyrics", "musicPrompt", "intent"];
    const visibleSpan = (s: Span) => visibleFields.includes(s.field) && validSpan(p, s);
    if (
      Object.keys(a.levels).some((id) => !id.startsWith(a.group)) ||
      ids.some((id) => a.levels[id] === undefined || a.levels[id] === null)
    )
      reasons.push("INCOMPLETE_GROUP");
    for (const f of a.findings) {
      if (
        !f.owner.startsWith(a.group) ||
        !f.evidence.length ||
        !f.evidence.every(visibleSpan)
      )
        reasons.push("INVALID_FINDING");
      if (
        f.missingPath &&
        (!/^(lyrics|musicPrompt|intent)(\.[a-zA-Z0-9_]+)*$/.test(f.missingPath) || !visibleFields.includes(f.missingPath.split(".")[0]))
      )
        reasons.push("INVALID_MISSING_PATH");
      if (owners.has(f.defectKey) && owners.get(f.defectKey) !== f.owner)
        reasons.push("DUPLICATE_ATTRIBUTION");
      owners.set(f.defectKey, f.owner);
    }
    for (const id of ids)
      if (
        a.levels[id] !== undefined &&
        a.levels[id] !== null &&
        a.levels[id]! < 4 &&
        !a.findings.some(
          (f) =>
            f.owner === id &&
            f.evidence.length &&
            f.evidence.every(visibleSpan),
        )
      )
        reasons.push("DEDUCTION_WITHOUT_EVIDENCE");
  }
  return { valid: reasons.length === 0, reasons: [...new Set(reasons)] };
}
