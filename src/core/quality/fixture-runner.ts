import {
  AssessmentSchema,
  DecisionSchema,
  EffectResultSchema,
  FixtureScriptSchema,
  PairSchema,
  PolicySchema,
  RULE_VERSION,
  effectKinds,
  groups,
  type Assessment,
  type Decision,
  type Effect,
  type EffectResult,
  type FixtureScript,
  type Journal,
  type JournalEvent,
  type Pair,
  type Policy,
  type RunReport,
} from "./contracts";
import { canonical, hashValue, pairHash, score } from "./scoring";
import {
  checkHardRules,
  evaluationContext,
  validSpan,
  validateAssessments,
} from "./rules";
import { decide, policyIssues } from "./decision";

export const effectKey = (p: Pair, policy: Policy, kind: Effect["kind"]) =>
  "quality:" +
  hashValue({
    attemptId: p.attemptId,
    pairHash: pairHash(p),
    kind,
    ruleVersion: RULE_VERSION,
    policyVersion: policy.version,
  });
const emptyScores = () =>
  score({
    L1: null,
    L2: null,
    L3: null,
    L4: null,
    M1: null,
    M2: null,
    M3: null,
    M4: null,
    C1: null,
    C2: null,
    C3: null,
  });
const waiting = (reason: string): Decision => ({
  state: "pending",
  wouldPass: null,
  canProceedToMusic: false,
  reasons: [reason],
  scores: emptyScores(),
});
function balances(events: JournalEvent[]) {
  let spent = 0,
    reserved = 0;
  for (const e of events) {
    const p = e.payload as any;
    if (e.type === "reserve") reserved += p.amount ?? 0;
    if (e.type === "settle") {
      spent += p.actualCost ?? 0;
      reserved -= (p.actualCost ?? 0) + (p.release ?? 0);
    }
  }
  return { spent, reserved: Math.max(0, reserved) };
}
class Halt extends Error {
  constructor(
    readonly decision: Decision,
    readonly frozen = false,
  ) {
    super(decision.reasons.join(","));
  }
}
function locksPreserved(before: Pair, after: Pair) {
  const count = (
    p: Pair,
    field: "lyrics" | "musicPrompt" | "intent",
    quote: string,
  ) => p[field].split(quote).length - 1;
  return before.lockedSpans.every(
    (s) =>
      validSpan(before, s) &&
      after.lockedSpans.some(
        (t) =>
          t.field === s.field && t.quote === s.quote && validSpan(after, t),
      ) &&
      count(before, s.field, s.quote) === count(after, s.field, s.quote),
  );
}
export async function runFixture(
  rawPair: Pair,
  rawPolicy: Policy,
  rawScript: FixtureScript,
  journal: Journal,
): Promise<RunReport> {
  const initial = PairSchema.parse(rawPair),
    policy = PolicySchema.parse(rawPolicy),
    script = FixtureScriptSchema.parse(rawScript);
  let events: JournalEvent[];
  try {
    events = journal.read();
  } catch (error) {
    const prefix = (error as { events?: JournalEvent[] }).events ?? [];
    return {
      decision: waiting("JOURNAL_INTEGRITY"),
      pairs: [initial],
      events: prefix,
      ...balances(prefix),
      frozen: true,
    };
  }
  const identity = hashValue({
      initial,
      policy,
      script,
      ruleVersion: RULE_VERSION,
    }),
    runKey = "attempt:" + initial.attemptId;
  const reserve = events.find((e) => e.eventKey === runKey + ":reserve");
  if (reserve && (reserve.payload as any).identity !== identity)
    throw Error("IDEMPOTENCY_CONFLICT");
  if (events.length && !reserve) throw Error("IDEMPOTENCY_CONFLICT");
  const terminal = events.find((e) => e.eventKey === runKey + ":decision");
  if (terminal) {
    const cached = terminal.payload as Omit<RunReport, "events">;
    return {
      ...structuredClone(cached),
      decision: DecisionSchema.parse(cached.decision),
      events,
    };
  }
  const upper =
    3 *
      effectKinds
        .filter((k) => k !== "revise")
        .reduce((n, k) => n + script.maxCosts[k], 0) +
    2 * script.maxCosts.revise;
  const approved = policyIssues(policy).length === 0;
  const append = (event: JournalEvent) => {
    journal.append(event);
    events = journal.read();
  };
  if (!reserve)
    append({
      eventKey: runKey + ":reserve",
      type: "reserve",
      operationKey: runKey,
      payload: {
        identity,
        amount: approved && script.budgetLimit >= upper ? upper : 0,
        upper,
      },
    });
  let pairs = [
    initial,
    ...events
      .filter((e) => e.type === "revision")
      .map((e) => PairSchema.parse((e.payload as any).pair)),
  ];
  const finish = (decision: Decision, frozen = false): RunReport => {
    if (!frozen) {
      const b = balances(events);
      if (b.reserved)
        append({
          eventKey: runKey + ":release",
          type: "settle",
          operationKey: runKey,
          payload: { actualCost: 0, release: b.reserved },
        });
    }
    const report = { decision, pairs, ...balances(events), frozen };
    append({
      eventKey: runKey + ":decision",
      type: "decision",
      operationKey: runKey,
      payload: report,
    });
    return { ...report, events };
  };
  const halt = (reason: string, frozen = false): never => {
    if (frozen)
      append({
        eventKey: runKey + ":freeze",
        type: "freeze",
        operationKey: runKey,
        payload: { reason },
      });
    throw new Halt(waiting(reason), frozen);
  };
  const invoke = (
    p: Pair,
    kind: Effect["kind"],
    findings: Assessment[] = [],
  ) => {
    const key = effectKey(p, policy, kind),
      maxCost = script.maxCosts[kind];
    for (
      let attempt = 0;
      attempt <= (kind === "revise" ? 0 : (policy.evaluationRetryLimit ?? 0));
      attempt++
    ) {
      const resultKey = key + ":result:" + attempt,
        dispatchKey = key + ":dispatch:" + attempt;
      let existing = events.find((e) => e.eventKey === resultKey),
        response: EffectResult;
      if (!existing) {
        if (events.some((e) => e.eventKey === dispatchKey))
          halt("UNKNOWN_DISPATCH", true);
        if (
          events.filter((e) => e.type === "dispatch").length >=
          Math.min(38, script.authorizedSendLimit)
        )
          halt("SEND_LIMIT");
        if (balances(events).reserved < maxCost) halt("BUDGET_EXHAUSTED");
        const supplied = script.responses[key]?.[attempt];
        if (!supplied) halt("FIXTURE_RESULT_MISSING");
        const context =
          kind === "revise"
            ? { pair: p, findings: findings.flatMap((a) => a.findings) }
            : evaluationContext(p, kind.at(-1) as "L" | "M" | "C");
        append({
          eventKey: dispatchKey,
          type: "dispatch",
          operationKey: key,
          payload: {
            effect: { key, kind, pairHash: pairHash(p), maxCost },
            attempt,
            context,
          },
        });
        response = EffectResultSchema.parse(supplied);
        append({
          eventKey: resultKey,
          type: "result",
          operationKey: key,
          payload: { response },
        });
      } else
        response = EffectResultSchema.parse((existing.payload as any).response);
      if (response.actualCost !== null) {
        append({
          eventKey: key + ":settle:" + attempt,
          type: "settle",
          operationKey: key,
          payload: { actualCost: response.actualCost, release: 0 },
        });
        if (response.actualCost > maxCost) halt("COST_EXCEEDS_RESERVE", true);
      }
      if (response.status === "unknown" || response.actualCost === null)
        halt("COST_OR_RESULT_UNKNOWN", true);
      if (response.status === "confirmed_unsent") {
        if (response.actualCost !== 0) halt("UNSENT_BILLING_CONFLICT", true);
        if (attempt < (policy.evaluationRetryLimit ?? 0) && kind !== "revise")
          continue;
        halt("SAFE_RETRY_EXHAUSTED");
      }
      if (response.status !== "ok") halt("EFFECT_FAILED");
      return response;
    }
    return halt("SAFE_RETRY_EXHAUSTED");
  };
  try {
    if (!approved)
      return finish(
        decide({
          pair: initial,
          policy,
          hard: checkHardRules(initial, []),
          primary: [],
          review: null,
          reviewHard: null,
          revisionCount: 0,
          costState: "settled",
          expectedPairHash: pairHash(initial),
        }),
      );
    if (script.budgetLimit < upper) halt("BUDGET_PREFLIGHT");
    if (pairs.length > 3) halt("REVISION_LIMIT");
    for (;;) {
      const current = pairs.at(-1)!;
      if (current.lockedSpans.some((s) => !validSpan(current, s)))
        halt("LOCKED_CONTENT_INVALID");
      let hard = checkHardRules(current, []),
        primary: Assessment[] = [],
        review: Assessment[] | null = null,
        reviewHard = null;
      if (hard.status === "clear")
        for (const group of groups) {
          const response = invoke(
            current,
            ("evaluate_" + group) as Effect["kind"],
          );
          if (!response.assessment) halt("ASSESSMENT_MISSING");
          const a = AssessmentSchema.parse(response.assessment);
          if (a.group !== group || !validateAssessments(current, [a]).valid)
            halt("EVALUATION_INVALID");
          primary.push(a);
          if (group === "C" && response.hard) hard = response.hard;
        }
      const input = {
        pair: current,
        policy,
        hard,
        primary,
        review,
        reviewHard,
        revisionCount: pairs.length - 1,
        costState: "settled" as const,
        expectedPairHash: pairHash(current),
      };
      let decision = decide(input);
      if (decision.state === "review") {
        review = [];
        for (const group of groups) {
          const response = invoke(
            current,
            ("review_" + group) as Effect["kind"],
          );
          if (!response.assessment) halt("REVIEW_MISSING");
          review.push(AssessmentSchema.parse(response.assessment));
          if (group === "C") reviewHard = response.hard ?? null;
        }
        decision = decide({ ...input, review, reviewHard });
      }
      if (decision.state !== "revise") return finish(decision);
      if (pairs.length >= 3)
        return finish({
          ...decision,
          state: "manual",
          reasons: [...decision.reasons, "REVISION_LIMIT"],
        });
      const response = invoke(current, "revise", [
        ...primary,
        ...(review ?? []),
      ]);
      if (!response.pair) halt("REVISION_MISSING");
      const revised = PairSchema.parse(response.pair);
      if (
        revised.attemptId !== initial.attemptId ||
        revised.parentRevisionId !== current.revisionId ||
        pairs.some((p) => p.revisionId === revised.revisionId)
      )
        halt("REVISION_IDENTITY");
      if (!locksPreserved(current, revised)) halt("LOCKED_CONTENT_CHANGED");
      append({
        eventKey: effectKey(current, policy, "revise") + ":revision",
        type: "revision",
        operationKey: effectKey(current, policy, "revise"),
        payload: { pair: revised },
      });
      pairs.push(revised);
    }
  } catch (error) {
    if (error instanceof Halt) return finish(error.decision, error.frozen);
    throw error;
  }
}
