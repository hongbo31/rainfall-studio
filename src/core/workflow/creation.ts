import { randomUUID } from "node:crypto";
import { Repository, type Row } from "../database";
import {
  GenerateTurnSchema,
  parseDraft,
  type GenerateTurn,
  type CreativeDraft,
} from "../../shared/creation";
import { TextProviderRegistry, type TextResponse } from "./text";
import { hashValue, pairHash } from "../quality/scoring";
import {
  checkHardRules,
  evaluationContext,
  validateAssessments,
} from "../quality/rules";
import { decide, policyIssues } from "../quality/decision";
import {
  AssessmentSchema,
  PairSchema,
  PolicySchema,
  RULE_VERSION,
  groups,
  type Pair,
  type Policy,
  type Assessment,
  type Decision,
} from "../quality/contracts";
import { preferenceSnapshot } from "./preferences";

export const ATTEMPT_RESERVATION = 21; // fixture units: initial + 18 assessments + two revisions
type Options = {
  registry: TextProviderRegistry;
  adapterId?: string;
  policy?: Policy;
  dailyLimit?: number;
  now?: () => Date;
};
class Stop extends Error {
  constructor(
    readonly state: string,
    readonly reasons: string[],
  ) {
    super(reasons.join(","));
  }
}
export class CreationService {
  private running = new Set<string>();
  private generation = 0;
  private stopped = false;
  constructor(
    readonly repo: Repository,
    readonly mode: "production" | "simulation",
    readonly options: Options,
  ) {
    repo.transaction(() => {
      for (const op of repo.all("operations"))
        if (op.state === "dispatching") {
          repo.save("operations", { ...op, state: "unknown" });
          const t = repo.maybe("creativeTurns", op.turnId);
          if (t)
            repo.save("creativeTurns", {
              ...t,
              state: "reconcile_required",
              reasons: ["INTERRUPTED_DISPATCH"],
            });
        }
      for (const t of repo
        .all("creativeTurns")
        .filter((t) => t.state === "running")) {
        const uncertain = repo
          .all("operations")
          .some((o) => o.turnId === t.id && o.state === "unknown");
        repo.save("creativeTurns", {
          ...t,
          state: uncertain ? "reconcile_required" : "paused",
          reasons: [uncertain ? "OUTCOME_UNKNOWN" : "RESTART_REQUIRES_REVIEW"],
        });
        if (!uncertain) {
          let remaining = 0;
          for (const e of repo
            .all("workflowLedger")
            .filter((e) => e.turnId === t.id)) {
            if (e.kind === "reserve") remaining += e.amount;
            else if (e.kind === "settle" || e.kind === "release")
              remaining -= e.amount;
          }
          if (remaining > 0)
            this.ledger(t, "release", remaining, t.id + ":release");
        }
      }
    });
  }
  now() {
    return (this.options.now?.() ?? new Date()).toISOString();
  }
  stop() {
    this.stopped = true;
    this.generation++;
  }
  balance(date = this.now().slice(0, 10)) {
    let reserved = 0,
      spent = 0;
    for (const e of this.repo
      .all("workflowLedger")
      .filter((e) => e.date === date && e.unit === "fixture_credit")) {
      if (e.kind === "reserve") reserved += e.amount;
      if (e.kind === "settle") {
        reserved -= e.amount;
        spent += e.amount;
      }
      if (e.kind === "release") reserved -= e.amount;
    }
    return {
      unit: "fixture_credit",
      spent,
      reserved,
      available: Math.max(
        0,
        (this.options.dailyLimit ?? 100) - spent - reserved,
      ),
    };
  }
  private ledger(turn: Row, kind: string, amount: number, key: string) {
    this.repo.append("workflowLedger", {
      id: randomUUID(),
      eventKey: key,
      turnId: turn.id,
      scope: "text",
      kind,
      amount,
      unit: "fixture_credit",
      date: turn.budgetDate,
      at: this.now(),
    });
  }
  begin(raw: GenerateTurn) {
    const i = GenerateTurnSchema.parse(raw),
      requestHash = hashValue(i);
    return this.repo.transaction(() => {
      const previous = this.repo
        .all("creativeTurns")
        .find((t) => t.requestId === i.requestId);
      if (previous) {
        if (previous.requestHash !== requestHash)
          throw Error("IDEMPOTENCY_CONFLICT");
        return previous;
      }
      const artist = this.repo.get("artists", i.artistId),
        session = this.repo.maybe("creativeSessions", i.sessionId);
      if (session && session.artistId !== i.artistId)
        throw Error("ARTIST_SCOPE");
      if ((session?.revision ?? 0) !== i.expectedRevision)
        throw Error("REVISION_CONFLICT");
      if (
        session?.activeTurnId &&
        ["queued", "running"].includes(
          this.repo.get("creativeTurns", session.activeTurnId).state,
        )
      )
        throw Error("TURN_BUSY");
      const parent = i.parentDraftId
        ? this.repo.get("drafts", i.parentDraftId)
        : null;
      if (
        parent &&
        (parent.sessionId !== i.sessionId || parent.artistId !== i.artistId)
      )
        throw Error("DRAFT_SCOPE");
      if ((session?.draftId ?? null) !== i.parentDraftId)
        throw Error("STALE_DRAFT");
      if (i.seriesId) this.repo.get("series", i.seriesId);
      const preferences = preferenceSnapshot(
        this.repo,
        i.artistId,
        i.seriesId,
        i.excludeWorkIds,
      );
      const adapter = this.options.adapterId
        ? this.options.registry.get(this.options.adapterId)
        : undefined;
      const reasons: string[] = [];
      if (this.mode === "production")
        reasons.push("TEXT_CONFIGURATION_REQUIRED", "LIVE_EXECUTION_DISABLED");
      else if (!adapter || adapter.source !== "fixture")
        reasons.push("SIMULATION_FIXTURE_REQUIRED");
      if (
        this.repo
          .all("operations")
          .some(
            (o) =>
              o.provider === this.options.adapterId && o.state === "unknown",
          )
      )
        reasons.push("PROVIDER_RISK_FROZEN");
      if (
        i.budgetLimit < ATTEMPT_RESERVATION ||
        this.balance().available < ATTEMPT_RESERVATION
      )
        reasons.push("BUDGET_INSUFFICIENT");
      if (this.stopped) reasons.push("WORKSPACE_STOPPED");
      const turn = {
        id: randomUUID(),
        ...i,
        requestHash,
        mode: this.mode,
        source: this.mode === "simulation" ? "fixture" : "unconfigured",
        adapterId: this.options.adapterId ?? null,
        state: reasons.length ? "blocked" : "queued",
        reasons,
        revisionCount: 0,
        draftId: null,
        budgetDate: this.now().slice(0, 10),
        artistRevision: artist.revision,
        seriesBaseRevision: preferences.seriesBaseRevision,
        brief: {
          instruction: i.instruction,
          language: artist.defaults?.language ?? "中文",
          style: artist.defaults?.genre ?? "未指定",
          artistId: artist.id,
          artistRevision: artist.revision,
          seriesId: i.seriesId,
          preferences,
        },
        createdAt: this.now(),
        spent: 0,
      };
      this.repo.save("creativeSessions", {
        ...session,
        id: i.sessionId,
        artistId: i.artistId,
        revision: i.expectedRevision + 1,
        activeTurnId: turn.id,
        draftId: session?.draftId ?? null,
      });
      this.repo.save("creativeTurns", turn);
      if (!reasons.length)
        this.ledger(turn, "reserve", ATTEMPT_RESERVATION, turn.id + ":reserve");
      return turn;
    });
  }
  private patch(id: string, changes: Row) {
    return this.repo.save("creativeTurns", {
      ...this.repo.get("creativeTurns", id),
      ...changes,
    });
  }
  private async invoke(
    turn: Row,
    kind: "generate" | "revise" | "evaluate" | "review",
    suffix: string,
    context: unknown,
    modelId: string,
  ): Promise<TextResponse> {
    if (this.stopped) throw new Stop("paused", ["WORKSPACE_STOPPED"]);
    const operationKey =
        "text:" +
        hashValue({
          turn: turn.id,
          suffix,
          kind,
          policy: this.options.policy?.version,
        }),
      existing = this.repo
        .all("operations")
        .find((o) => o.operationKey === operationKey);
    if (existing) {
      if (existing.state === "complete") return existing.result;
      if (existing.state === "unknown" || existing.state === "dispatching")
        throw new Stop("reconcile_required", ["OUTCOME_UNKNOWN"]);
    }
    const generation = this.generation,
      risk = this.repo
        .all("operations")
        .some(
          (o) =>
            o.provider === turn.adapterId &&
            (o.state === "unknown" || o.costState === "unknown"),
        );
    if (risk) throw new Stop("blocked", ["PROVIDER_RISK_FROZEN"]);
    const op = {
      id: existing?.id ?? randomUUID(),
      operationKey,
      turnId: turn.id,
      kind,
      provider: turn.adapterId,
      requestHash: hashValue(context),
      sessionId: randomUUID(),
      state: "dispatching",
      mode: this.mode,
      at: this.now(),
    };
    this.repo.save("operations", op); // durable boundary before transport
    let result: TextResponse;
    try {
      result = await this.options.registry.invoke(turn.adapterId, {
        kind,
        operationId: op.id,
        sessionId: op.sessionId,
        modelId,
        context,
        maxOutputTokens: 4000,
      });
    } catch {
      result = { status: "unknown", actualCost: null };
    }
    if (generation !== this.generation || this.stopped) {
      if (this.repo.db.open)
        this.repo.save("operations", {
          ...op,
          state: "unknown",
          lateResultAvailable: true,
        });
      throw new Stop("reconcile_required", ["WORKSPACE_CHANGED"]);
    }
    if (
      result.status === "unknown" ||
      result.actualCost === null ||
      !Number.isSafeInteger(result.actualCost) ||
      result.actualCost < 0 ||
      result.actualCost > 1 ||
      !result.evidenceId
    ) {
      this.repo.save("operations", { ...op, state: "unknown" });
      throw new Stop("reconcile_required", ["COST_OR_OUTCOME_UNKNOWN"]);
    }
    this.repo.transaction(() => {
      this.repo.save("operations", { ...op, state: "complete", result });
      this.ledger(turn, "settle", result.actualCost!, op.id + ":settle");
      const t = this.repo.get("creativeTurns", turn.id);
      this.patch(turn.id, { spent: t.spent + result.actualCost! });
    });
    if (result.status === "refused")
      throw new Stop("manual", ["PROVIDER_REFUSED"]);
    if (result.status === "confirmed_unsent")
      throw new Stop("pending", ["CONFIRMED_UNSENT_NO_AUTOMATIC_RETRY"]);
    return result;
  }
  private pair(
    draft: CreativeDraft,
    turn: Row,
    id: string,
    parentId: string | null,
  ): Pair {
    const lyrics = draft.sections
        .map((s) => `[${s.kind}]\n${s.lines.join("\n")}`)
        .join("\n\n"),
      musicPrompt = draft.musicPrompts.yourmusic.positiveStyle;
    const lockedSpans = turn.lockedQuotes.map((quote: string) => ({
      field: "lyrics" as const,
      start: lyrics.indexOf(quote),
      end: lyrics.indexOf(quote) + quote.length,
      quote,
    }));
    return PairSchema.parse({
      attemptId: turn.id,
      revisionId: id,
      parentRevisionId: parentId,
      lyrics,
      musicPrompt,
      intent: turn.instruction,
      language: draft.language,
      style: draft.style,
      generator: {
        modelId: "fixture-generator",
        modelVersion: "1",
        promptVersion: "creative-v1",
      },
      lockedSpans,
      capability: {
        version: "yourmusic-openapi-1.0.0",
        verified: true,
        lengthUnit: "codepoint",
        limits: { lyrics: 5000, musicPrompt: 1000 },
        requiredFields: ["lyrics", "musicPrompt"],
      },
    });
  }
  private async assess(
    turn: Row,
    pair: Pair,
    policy: Policy,
    review = false,
  ): Promise<Assessment[]> {
    const reports: Assessment[] = [];
    for (const group of groups) {
      const visible = evaluationContext(pair, group),
        profile = policy.evaluatorProfile![review ? "review" : "primary"];
      const r = await this.invoke(
        turn,
        review ? "review" : "evaluate",
        pair.revisionId + ":" + group,
        {
          group,
          context: visible,
          pairHash: pairHash(pair),
          contextHash: hashValue(visible),
          ruleVersion: RULE_VERSION,
          policyVersion: policy.version,
          ...profile,
        },
        profile.modelId,
      );
      const a = AssessmentSchema.parse(r.value);
      const op = this.repo
        .all("operations")
        .find((o) =>
          o.result === undefined ? false : o.result.evidenceId === r.evidenceId,
        );
      if (
        a.group !== group ||
        a.sessionId !== op?.sessionId ||
        !validateAssessments(pair, [a]).valid
      )
        throw new Stop("pending", ["ASSESSMENT_INVALID"]);
      reports.push(a);
    }
    return reports;
  }
  async execute(id: string) {
    if (this.running.has(id)) return;
    const initial = this.repo.get("creativeTurns", id);
    if (initial.state !== "queued" || this.stopped) return;
    const today = this.now().slice(0, 10);
    if (initial.budgetDate !== today) {
      const moved = this.repo.transaction(() => {
        this.ledger(
          initial,
          "release",
          ATTEMPT_RESERVATION,
          initial.id + ":rollover:" + initial.budgetDate + ":release",
        );
        if (this.balance(today).available < ATTEMPT_RESERVATION) {
          this.patch(id, {
            state: "blocked",
            reasons: ["BUDGET_DAY_CHANGED", "BUDGET_INSUFFICIENT"],
          });
          return false;
        }
        const updated = this.patch(id, { budgetDate: today });
        this.ledger(
          updated,
          "reserve",
          ATTEMPT_RESERVATION,
          id + ":rollover:" + today + ":reserve",
        );
        return true;
      });
      if (!moved) return;
    }
    this.running.add(id);
    this.patch(id, { state: "running" });
    try {
      const policy = this.options.policy
        ? PolicySchema.parse(this.options.policy)
        : null;
      let parent = initial.parentDraftId,
        previousDraft = parent ? this.repo.get("drafts", parent).draft : null,
        feedback: unknown = [];
      for (let revision = 0; revision <= 2; revision++) {
        this.patch(id, { revisionCount: revision });
        const t = this.repo.get("creativeTurns", id);
        const result = await this.invoke(
          t,
          revision ? "revise" : "generate",
          "v" + revision,
          {
            brief: t.brief,
            previousDraft,
            lockedQuotes: t.lockedQuotes,
            feedback,
          },
          "fixture-generator",
        );
        let draft: CreativeDraft;
        try {
          draft = parseDraft(result.value);
        } catch {
          if (!policy || policyIssues(policy).length)
            throw new Stop("shadow", ["QUALITY_POLICY_UNAPPROVED"]);
          feedback = ["STRUCTURE_INVALID"];
          if (revision === 2)
            throw new Stop("manual", ["STRUCTURE_INVALID", "REVISION_LIMIT"]);
          continue;
        }
        if (
          t.lockedQuotes.some(
            (quote: string) =>
              !draft.sections.some((s) => s.lines.join("\n").includes(quote)),
          )
        )
          throw new Stop("manual", ["LOCKED_CONTENT_CHANGED"]);
        if (
          previousDraft &&
          t.lockedQuotes.some((quote: string) => {
            const count = (value: CreativeDraft) =>
              value.sections
                .map((s) => s.lines.join("\n"))
                .join("\n")
                .split(quote).length - 1;
            return count(previousDraft) !== count(draft);
          })
        )
          throw new Stop("manual", ["LOCKED_CONTENT_CHANGED"]);
        const draftId = randomUUID(),
          pair = this.pair(draft, t, draftId, parent),
          row = {
            id: draftId,
            turnId: id,
            sessionId: t.sessionId,
            artistId: t.artistId,
            seriesId: t.seriesId,
            seriesBaseRevision: t.seriesBaseRevision,
            planId: t.dailyPlanId ?? null,
            parentDraftId: parent,
            revision,
            source: "fixture",
            draft,
            pair,
            pairHash: pairHash(pair),
            at: this.now(),
          };
        this.repo.transaction(() => {
          this.repo.save("drafts", row);
          this.patch(id, { draftId });
          this.repo.save("creativeSessions", {
            ...this.repo.get("creativeSessions", t.sessionId),
            draftId,
          });
        });
        parent = draftId;
        previousDraft = draft;
        if (!policy || policyIssues(policy).length)
          throw new Stop("shadow", ["QUALITY_POLICY_UNAPPROVED"]);
        let hard = checkHardRules(pair, []),
          primary: Assessment[] = [],
          review: Assessment[] | null = null;
        if (hard.status === "clear")
          primary = await this.assess(t, pair, policy);
        const base = {
          pair,
          policy,
          hard,
          primary,
          review,
          reviewHard: null,
          revisionCount: revision,
          costState: "settled" as const,
          expectedPairHash: pairHash(pair),
        };
        let decision: Decision = decide(base);
        if (decision.state === "review") {
          review = await this.assess(t, pair, policy, true);
          decision = decide({
            ...base,
            review,
            reviewHard: checkHardRules(pair, []),
          });
        }
        this.repo.save("evaluations", {
          id: randomUUID(),
          turnId: id,
          draftId,
          pairHash: pairHash(pair),
          primary,
          review,
          hard,
          decision,
          ruleVersion: RULE_VERSION,
          policyVersion: policy.version,
          source: "fixture",
          at: this.now(),
        });
        if (decision.state === "pass") throw new Stop("ready_for_review", []);
        if (decision.state !== "revise")
          throw new Stop(decision.state, decision.reasons);
        feedback = {
          hard,
          findings: [...primary, ...(review ?? [])].flatMap((a) => a.findings),
        };
      }
      throw new Stop("manual", ["REVISION_LIMIT"]);
    } catch (e) {
      const stop =
        e instanceof Stop
          ? e
          : new Stop("pending", ["INVALID_PROVIDER_RESULT"]);
      if (this.repo.db.open)
        this.patch(id, { state: stop.state, reasons: stop.reasons });
    } finally {
      this.running.delete(id);
      if (this.repo.db.open) {
        const t = this.repo.get("creativeTurns", id);
        if (t.state !== "reconcile_required") {
          this.repo.transaction(() => {
            this.ledger(
              t,
              "release",
              ATTEMPT_RESERVATION - t.spent,
              id + ":release",
            );
          });
        }
      }
    }
    if (!this.repo.db.open) return;
    return this.repo.get("creativeTurns", id);
  }
}
