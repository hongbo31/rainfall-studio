import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { z } from "zod";
import { hash, type Repository, type Row } from "./database";
import { cleanLyricText } from "../shared/tme-lyrics";
import { listApiProfiles } from "./api-profiles";
import { assertLegacyScheduleEditable } from "./plan-center-ownership";
import { isLegacyOwned } from "./plan-center/storage";
import {
  importedFlowCandidate,
  inboxEvaluationSource,
  syncInboxEvaluation,
} from "./production-flow-inbox";
import { hashValue, pairHash } from "./quality/scoring";
import { parseDraft } from "../shared/creation";
import { deepSeekSystemPrompt } from "./workflow/deepseek";
import { resolveDailyTime } from "./workflow/daily";
import {
  DeepSeekRequestSchema,
  deepSeekResponseModelMatches,
  estimateDeepSeekCostMicros,
} from "../shared/live-text";
import {
  TextEvaluationRequestSchema,
  textEvaluationMessages,
  parseTextEvaluationResult,
} from "../shared/text-evaluation";
import {
  FlowSavePlanSchema,
  FlowEnableSchema,
  FlowTriggerSchema,
  FlowIdSchema,
  FlowClaimSchema,
  FlowRetrySchema,
  FlowApproveSchema,
  FlowBlockSchema,
  FlowRecordSchema,
  FlowUseManualAssetsSchema,
  FlowTextGrantSchema,
  FlowManagedMusicGrantSchema,
  ProductionFlowPlanSchema,
  type FlowAsset,
} from "../shared/production-flow";
import {
  localFlowDraft,
  flowCandidate,
  localFlowScore,
} from "./production-flow-local";

const prefix = "production-flow:";
const managedInboxInput = z.strictObject({
  ownerKey: z.string().trim().min(1).max(1000),
  budgetScope: z.string().trim().min(1).max(1000).optional(),
  candidateId: z.uuid(),
  artistId: z.uuid(),
  text: FlowTextGrantSchema,
  threshold: z.number().min(0).max(100).default(75),
  maxRevisions: z.number().int().min(0).max(2).default(2),
  maxScoreRetries: z.number().int().min(0).max(2).default(2),
});
const managedMusicInput = z.strictObject({
  ownerKey: z.string().trim().min(1).max(1000),
  budgetScope: z.string().trim().min(1).max(1000),
  artistId: z.uuid(),
  evaluationRunId: z.uuid(),
  music: FlowManagedMusicGrantSchema,
});
function managedInboxId(value: string) {
  const digest = hash(value);
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}
type Options = {
  now?: () => Date;
  createWork?: (run: Row, candidate: Row) => { workId: string };
  materializeAssets?: (run: Row, assets: FlowAsset[]) => { workId: string };
  verifyMusicPricing?: (grant: Row) => boolean;
  verifyManagedMusicQuote?: (grant: Row, now: Date) => boolean;
  publicationAuthority?: (input: Row) => {
    allowed: boolean;
    termsHash?: string;
    evidenceId?: string;
    reason?: string;
  } | null;
  publicationMaterials?: (input: Row) => { ready: boolean; reasons: string[] };
};
export class ProductionFlowService {
  constructor(
    readonly repo: Repository,
    readonly options: Options = {},
  ) {
    repo.transaction(() => {
      for (const op of repo
        .all("operations")
        .filter(
          (o) =>
            o.kind === "production_flow" &&
            ["dispatching", "unknown"].includes(o.state),
        )) {
        const readOnly = ["music_assets", "publication_poll"].includes(
          op.taskType,
        );
        repo.save("operations", {
          ...op,
          state: readOnly ? "interrupted" : "unknown",
          costState: op.unit ? "unknown" : op.costState,
          reasons: ["INTERRUPTED_DISPATCH"],
        });
        const run = this.maybe("run", op.runId);
        if (
          run &&
          run.operationId === op.id &&
          (run.state === "dispatching" || (readOnly && run.state === "unknown"))
        )
          this.patch(run, {
            state: readOnly
              ? run.managedMusic && !run.paused
                ? "ready"
                : "blocked"
              : "unknown",
            reasons: [
              readOnly ? "READ_ONLY_INTERRUPTED" : "INTERRUPTED_DISPATCH",
            ],
          });
      }
    });
  }
  now() {
    return this.options.now?.() ?? new Date();
  }
  private get(kind: string, id: string): Row {
    return this.repo.get("settings", prefix + kind + ":" + id).value;
  }
  private maybe(kind: string, id: string): Row | undefined {
    return this.repo.maybe("settings", prefix + kind + ":" + id)?.value;
  }
  private put(kind: string, value: Row) {
    return this.repo.transaction(() => {
      this.repo.save("settings", { id: prefix + kind + ":" + value.id, value });
      if (kind === "run") syncInboxEvaluation(this.repo, value);
      return value;
    });
  }
  private rows(kind: string) {
    return this.repo
      .all("settings")
      .filter((r) => r.id.startsWith(prefix + kind + ":"))
      .map((r) => r.value);
  }
  private patch(run: Row, change: Row) {
    const value: Row = {
      ...run,
      ...change,
      revision: run.revision + 1,
      updatedAt: this.now().toISOString(),
    };
    if (change.stage && change.stage !== run.stage)
      value.history = [
        ...(run.history ?? []),
        { stage: change.stage, at: value.updatedAt },
      ];
    return this.put("run", value);
  }
  list() {
    return {
      plans: this.rows("plan"),
      runs: this.rows("run"),
      occurrences: this.rows("occurrence"),
    };
  }
  context(id: string) {
    const run = this.get("run", id);
    return {
      run,
      plan: this.get("plan", run.planId),
      operation: run.operationId
        ? this.repo.get("operations", run.operationId)
        : null,
      operations: this.repo
        .all("operations")
        .filter((o) => o.kind === "production_flow" && o.runId === id),
    };
  }
  private managedMusicEvaluation(id: string, artistId: string) {
    const evaluation = this.get("run", id),
      candidate = evaluation.candidate;
    const score = evaluation.score;
    const op = score?.operationId
      ? this.repo.maybe("operations", score.operationId)
      : null;
    if (
      !evaluation.inboxCandidateId ||
      !evaluation.plan.inboxEvaluation ||
      evaluation.artistId !== artistId ||
      evaluation.state !== "completed" ||
      !candidate ||
      !score?.passed ||
      score.source !== "model-scored" ||
      score.method !== "deepseek" ||
      score.revisionId !== candidate.id ||
      !op ||
      op.kind !== "production_flow" ||
      op.runId !== evaluation.id ||
      op.taskType !== "text_score" ||
      op.state !== "complete" ||
      op.result?.result?.status !== "complete" ||
      !op.result.result.score?.passed ||
      op.task.request.revisionId !== candidate.id ||
      op.task.request.pair.lyrics !== candidate.pair.lyrics ||
      op.task.request.pair.musicPrompt !== candidate.pair.musicPrompt ||
      !evaluation.versions.some(
        (v: Row) =>
          v.id === candidate.id && hashValue(v) === hashValue(candidate),
      )
    )
      throw Error("MANAGED_MUSIC_EVALUATION_REQUIRED");
    const source = inboxEvaluationSource(
      this.repo,
      evaluation.plan,
      evaluation.inboxCandidateId,
    );
    const finalDraft = this.repo.maybe("drafts", candidate.id);
    if (
      source.sourceHash !== evaluation.inboxSourceHash ||
      source.candidate.evaluation?.runId !== evaluation.id ||
      source.candidate.evaluationState !== "model_passed" ||
      source.candidate.evaluation.currentDraftId !== candidate.id ||
      !finalDraft ||
      finalDraft.evaluationRunId !== evaluation.id ||
      hashValue(finalDraft.draft) !== hashValue(candidate.draft)
    )
      throw Error("MANAGED_MUSIC_EVALUATION_REQUIRED");
    const draft = parseDraft(candidate.draft);
    if (
      candidate.pairHash !== pairHash(candidate.pair) ||
      candidate.pair.lyrics !==
        draft.sections
          .map((s) => `[${s.kind}]\n${s.lines.join("\n")}`)
          .join("\n\n") ||
      candidate.pair.musicPrompt !== draft.musicPrompts.yourmusic.positiveStyle
    )
      throw Error("MANAGED_MUSIC_EVALUATION_REQUIRED");
    return {
      evaluation,
      fingerprint: hashValue({
        candidate,
        score,
        sourceHash: source.sourceHash,
      }),
    };
  }
  /** Internal-only: stable music child from a completed trusted Inbox evaluation. */
  startManagedMusic(raw: unknown) {
    const input = managedMusicInput.parse(raw);
    return this.repo.transaction(() => {
      const key = hash(input.ownerKey),
        inputHash = hashValue(input);
      const previous = this.maybe("managed-music", key);
      if (previous) {
        if (
          previous.ownerKey !== input.ownerKey ||
          previous.inputHash !== inputHash
        )
          throw Error("MANAGED_MUSIC_CONFLICT");
        return this.get("run", previous.runId);
      }
      const { evaluation, fingerprint } = this.managedMusicEvaluation(
        input.evaluationRunId,
        input.artistId,
      );
      const planId = managedInboxId("music:" + input.ownerKey + ":plan");
      if (this.maybe("plan", planId)) throw Error("MANAGED_MUSIC_CONFLICT");
      const plan = ProductionFlowPlanSchema.parse({
        id: planId,
        artistId: input.artistId,
        title: evaluation.candidate.draft.title,
        theme: evaluation.plan.theme,
        timezone: "Asia/Shanghai",
        music: input.music,
        autoContinue: true,
      });
      this.put("plan", {
        ...plan,
        revision: 1,
        enabled: true,
        authorizationRevision: 1,
        managedByPlanCenter: true,
        managedMusic: true,
        managedOwnerKey: input.ownerKey,
        managedBudgetScope: input.budgetScope,
        updatedAt: this.now().toISOString(),
      });
      let run = this.trigger({
        planId,
        requestId: managedInboxId("music:" + input.ownerKey + ":request"),
      });
      const candidate = structuredClone(evaluation.candidate);
      run = this.patch(run, {
        candidate,
        versions: [candidate],
        candidateApproved: true,
        score: structuredClone(evaluation.score),
        stage: "work",
        managedMusic: true,
        managedEvaluationRunId: evaluation.id,
        managedEvaluationFingerprint: fingerprint,
        managedStopped: false,
      });
      this.put("managed-music", {
        id: key,
        ownerKey: input.ownerKey,
        inputHash,
        planId,
        runId: run.id,
      });
      return run;
    });
  }
  managedMusic(ownerKey: string) {
    const key = z.string().trim().min(1).max(1000).parse(ownerKey);
    const mapping = this.maybe("managed-music", hash(key));
    return mapping?.ownerKey === key ? this.get("run", mapping.runId) : null;
  }
  stopManagedMusic(ownerKey: string) {
    return this.repo.transaction(() => {
      const run = this.managedMusic(ownerKey);
      if (!run) return null;
      const plan = this.get("plan", run.planId);
      this.put("plan", {
        ...plan,
        enabled: false,
        authorizationRevision: null,
      });
      if (run.managedStopped) return run;
      // A durable claim is already potentially sent. Its original response/IDs
      // remain collectable, including after stop; no later submit is authorized.
      const drain = run.stage === "assets" && run.songIds.length === 2;
      return this.patch(run, {
        managedStopped: true,
        ...(run.state === "dispatching" ||
        run.state === "unknown" ||
        run.state === "completed" ||
        drain
          ? {}
          : { state: "blocked", reasons: ["PLAN_CENTER_STOPPED"] }),
      });
    });
  }
  /** Internal adapter: one stable plan-center stage owns one text-only evaluation. */
  startManagedInboxEvaluation(raw: unknown) {
    const input = managedInboxInput.parse(raw);
    return this.repo.transaction(() => {
      const key = hash(input.ownerKey),
        inputHash = hashValue(input);
      const previous = this.maybe("managed-inbox", key);
      if (previous) {
        if (
          previous.ownerKey !== input.ownerKey ||
          previous.inputHash !== inputHash
        )
          throw Error("MANAGED_INBOX_EVALUATION_CONFLICT");
        return this.get("run", previous.runId);
      }
      const planId = managedInboxId(input.ownerKey + ":plan");
      if (this.maybe("plan", planId))
        throw Error("MANAGED_INBOX_EVALUATION_CONFLICT");
      const plan = ProductionFlowPlanSchema.parse({
        id: planId,
        artistId: input.artistId,
        title: "Inbox text evaluation",
        theme: "Evaluate the imported song revision",
        timezone: "Asia/Shanghai",
        localTime: null,
        inboxEvaluation: true,
        candidateMode: "deepseek",
        scoreMode: "deepseek",
        text: input.text,
        autoContinue: true,
        threshold: input.threshold,
        maxRevisions: input.maxRevisions,
        maxScoreRetries: input.maxScoreRetries,
      });
      inboxEvaluationSource(this.repo, plan, input.candidateId);
      this.repo.get("artists", input.artistId);
      this.put("plan", {
        ...plan,
        enabled: true,
        revision: 1,
        authorizationRevision: 1,
        managedByPlanCenter: true,
        managedBudgetScope: input.budgetScope ?? null,
        managedOwnerKey: input.ownerKey,
        managedCandidateId: input.candidateId,
        updatedAt: this.now().toISOString(),
      });
      const run = this.trigger({
        planId,
        requestId: managedInboxId(input.ownerKey + ":request"),
        inboxCandidateId: input.candidateId,
      });
      this.put("managed-inbox", {
        id: key,
        ownerKey: input.ownerKey,
        inputHash,
        planId,
        runId: run.id,
      });
      return run;
    });
  }
  stopManagedInboxEvaluation(ownerKey: string) {
    z.string().trim().min(1).max(1000).parse(ownerKey);
    return this.repo.transaction(() => {
      const mapping = this.maybe("managed-inbox", hash(ownerKey));
      if (!mapping || mapping.ownerKey !== ownerKey) return null;
      const plan = this.get("plan", mapping.planId),
        run = this.get("run", mapping.runId);
      this.put("plan", {
        ...plan,
        enabled: false,
        authorizationRevision: null,
      });
      if (["completed", "unknown"].includes(run.state)) return run;
      if (run.paused) return run;
      return this.patch(run, {
        paused: true,
        state: run.state === "dispatching" ? "dispatching" : "blocked",
        reasons: ["PLAN_CENTER_STOPPED"],
      });
    });
  }
  savePlan(raw: unknown) {
    const { plan, expectedRevision } = FlowSavePlanSchema.parse(raw);
    assertLegacyScheduleEditable(this.repo, "production-flow", plan.id);
    return this.repo.transaction(() => {
      this.repo.get("artists", plan.artistId);
      const old = this.maybe("plan", plan.id);
      if (old?.managedByPlanCenter) throw Error("MANAGED_PLAN_INTERNAL_ONLY");
      if ((old?.revision ?? null) !== expectedRevision)
        throw Error("REVISION_CONFLICT");
      if (old && old.artistId !== plan.artistId) throw Error("ARTIST_SCOPE");
      return this.put("plan", {
        ...plan,
        revision: (old?.revision ?? 0) + 1,
        enabled: false,
        authorizationRevision: null,
        updatedAt: this.now().toISOString(),
      });
    });
  }
  enable(raw: unknown) {
    const i = FlowEnableSchema.parse(raw);
    return this.repo.transaction(() => {
      const p = this.get("plan", i.id);
      if (p.managedByPlanCenter) throw Error("MANAGED_PLAN_INTERNAL_ONLY");
      assertLegacyScheduleEditable(this.repo, "production-flow", p.id);
      if (p.revision !== i.expectedRevision) throw Error("REVISION_CONFLICT");
      if (!p.localTime && !p.inboxEvaluation)
        throw Error("SCHEDULE_TIME_REQUIRED");
      if (p.inboxEvaluation) {
        const channel = this.repo.maybe("settings", "inbox-channel");
        if (
          !channel?.enabled ||
          !Object.values(channel.channel.artistRefs).includes(p.artistId)
        )
          throw Error("INBOX_CHANNEL_REQUIRED");
      }
      const saved = this.put("plan", {
        ...p,
        enabled: true,
        authorizationRevision: p.revision,
      });
      this.put("clock", { id: p.id, checkedAt: this.now().toISOString() });
      return saved;
    });
  }
  disable(raw: unknown) {
    const i = FlowEnableSchema.parse(raw),
      p = this.get("plan", i.id);
    if (p.revision !== i.expectedRevision) throw Error("REVISION_CONFLICT");
    return this.put("plan", {
      ...p,
      enabled: false,
      authorizationRevision: null,
    });
  }
  private date(plan: Row) {
    return DateTime.fromJSDate(this.now(), {
      zone: plan.timezone,
    }).toISODate()!;
  }
  trigger(raw: unknown) {
    const i = FlowTriggerSchema.parse(raw);
    return this.repo.transaction(() => {
      const prior = this.rows("run").find((r) => r.requestId === i.requestId);
      if (prior) {
        if (
          prior.planId !== i.planId ||
          (prior.inboxCandidateId ?? undefined) !== i.inboxCandidateId
        )
          throw Error("IDEMPOTENCY_CONFLICT");
        return prior;
      }
      const p = this.get("plan", i.planId),
        date = this.date(p);
      if (
        p.managedMusic &&
        i.requestId !==
          managedInboxId("music:" + p.managedOwnerKey + ":request")
      )
        throw Error("MANAGED_PLAN_INTERNAL_ONLY");
      if (!p.managedByPlanCenter)
        assertLegacyScheduleEditable(this.repo, "production-flow", p.id);
      if (p.managedCandidateId && p.managedCandidateId !== i.inboxCandidateId)
        throw Error("MANAGED_INBOX_EVALUATION_CONFLICT");
      if (!!p.inboxEvaluation !== !!i.inboxCandidateId)
        throw Error("INBOX_EVALUATION_SOURCE_REQUIRED");
      if (
        p.inboxEvaluation &&
        (!p.enabled || p.authorizationRevision !== p.revision)
      )
        throw Error("INBOX_EVALUATION_DISABLED");
      const imported = i.inboxCandidateId
        ? inboxEvaluationSource(this.repo, p, i.inboxCandidateId)
        : null;
      if (imported?.candidate.evaluation?.runId)
        throw Error("INBOX_EVALUATION_ALREADY_STARTED");
      if (
        this.rows("run").filter(
          (r) => r.planId === p.id && r.budgetDate === date,
        ).length >= p.maxRunsPerDay
      )
        throw Error("DAILY_RUN_LIMIT");
      const id = randomUUID();
      const run: Row = {
        id,
        requestId: i.requestId,
        planId: p.id,
        budgetScope: p.managedBudgetScope ?? p.id,
        planRevision: p.revision,
        plan: structuredClone(p),
        artistId: p.artistId,
        budgetDate: date,
        revision: 1,
        stage: "candidate",
        state: "ready",
        candidate: null,
        versions: [],
        score: null,
        revisionCount: 0,
        scoreRetries: 0,
        candidateApproved: false,
        publicationApproval: null,
        workId: null,
        assets: [],
        songIds: [],
        trackingId: null,
        externalId: null,
        receipt: null,
        operationId: null,
        textSpentMicros: 0,
        textReservedMicros: 0,
        musicSpentCredits: 0,
        musicReservedCredits: 0,
        pollAttempts: 0,
        assetRetries: 0,
        reasons: [],
        history: [{ stage: "candidate", at: this.now().toISOString() }],
        createdAt: this.now().toISOString(),
      };
      if (imported) {
        run.inboxCandidateId = imported.candidate.id;
        run.inboxItemHash = imported.candidate.itemHash;
        run.inboxSourceDraftId = imported.draft.id;
        run.inboxSourceHash = imported.sourceHash;
        run.plan.theme = imported.draft.draft.storyBeat || p.theme;
        run.candidate = importedFlowCandidate(
          this.repo,
          run,
          imported.candidate.id,
        );
        run.versions = [run.candidate];
        run.candidateApproved = true;
        run.stage = "score";
      }
      return this.put("run", run);
    });
  }
  tick() {
    for (const plan of this.rows("plan").filter(
      (p) =>
        p.enabled &&
        p.authorizationRevision === p.revision &&
        !p.managedByPlanCenter &&
        !isLegacyOwned(this.repo, "production-flow", p.id),
    )) {
      try {
        if (plan.inboxEvaluation) {
          for (const candidate of this.repo
            .all("textCandidates")
            .filter(
              (c) =>
                c.artistId === plan.artistId &&
                c.isCurrent &&
                c.lineageState === "complete" &&
                c.localCheck?.status !== "failed" &&
                !c.evaluation?.runId,
            )) {
            try {
              this.trigger({
                planId: plan.id,
                requestId: candidate.id,
                inboxCandidateId: candidate.id,
              });
            } catch (error) {
              this.repo.save("textCandidates", {
                ...candidate,
                evaluationState: "model_blocked",
                evaluation: {
                  state: "model_blocked",
                  reasons: [
                    error instanceof Error
                      ? error.message
                      : "INBOX_EVALUATION_BLOCKED",
                  ],
                },
              });
            }
          }
          continue;
        }
        const clock = this.maybe("clock", plan.id),
          now = this.now(),
          stamp = now.toISOString();
        if (!clock) {
          this.put("clock", { id: plan.id, checkedAt: stamp });
          continue;
        }
        if (stamp <= clock.checkedAt) continue;
        const from = DateTime.fromISO(clock.checkedAt, { zone: plan.timezone });
        this.put("clock", { id: plan.id, checkedAt: stamp });
        let day = from.startOf("day"),
          today = DateTime.fromJSDate(now, { zone: plan.timezone });
        if (day < today.minus({ days: 7 }).startOf("day"))
          day = today.minus({ days: 7 }).startOf("day");
        for (
          let n = 0;
          n < 9 && day <= today;
          n++, day = day.plus({ days: 1 })
        ) {
          const at = resolveDailyTime(
            day.toISODate()!,
            plan.localTime,
            plan.timezone,
          ).utc;
          if (at <= clock.checkedAt || at > stamp) continue;
          const id = plan.id + ":" + day.toISODate();
          if (this.maybe("occurrence", id)) continue;
          let reason: string | null = null,
            runId: string | null = null;
          if (
            now.getTime() - new Date(clock.checkedAt).getTime() > 90000 ||
            now.getTime() - new Date(at).getTime() > 90000
          )
            reason = "SLEEP_GAP_SKIP";
          if (!reason)
            try {
              const run = this.trigger({
                planId: plan.id,
                requestId: randomUUID(),
              });
              runId = run.id;
            } catch (e) {
              reason = e instanceof Error ? e.message : "RUN_CREATION_FAILED";
            }
          this.put("occurrence", {
            id,
            planId: plan.id,
            localDate: day.toISODate(),
            intendedAt: at,
            runId,
            state: runId ? "created" : "skipped",
            reason,
            source: "local_schedule",
            createdAt: stamp,
          });
        }
      } catch (e) {
        this.repo.audit("productionFlow.schedule.error", plan.id, {
          reason: e instanceof Error ? e.message : "SCHEDULE_FAILED",
        });
      }
    }
    for (const run of this.rows("run").filter((r) =>
      ["ready", "waiting"].includes(r.state),
    ))
      try {
        this.next({ id: run.id });
      } catch (e) {
        const current = this.get("run", run.id);
        this.patch(current, {
          state: "failed",
          reasons: [e instanceof Error ? e.message : "LOCAL_STAGE_FAILED"],
        });
      }
    return this.list();
  }
  private assertPlan(run: Row) {
    const plan = this.get("plan", run.planId);
    if (
      !plan.managedByPlanCenter &&
      isLegacyOwned(this.repo, "production-flow", plan.id)
    )
      throw Error("PLAN_CENTER_OWNS_SCHEDULE");
    if (plan.revision !== run.planRevision)
      throw Error("PLAN_REVISION_CHANGED");
    if (run.managedMusic && run.stage !== "assets") {
      if (
        run.managedStopped ||
        !plan.enabled ||
        plan.authorizationRevision !== plan.revision
      )
        throw Error("MANAGED_MUSIC_STOPPED");
      const source = this.managedMusicEvaluation(
        run.managedEvaluationRunId,
        run.artistId,
      );
      if (
        source.fingerprint !== run.managedEvaluationFingerprint ||
        hashValue(source.evaluation.candidate) !== hashValue(run.candidate)
      )
        throw Error("MANAGED_MUSIC_SOURCE_CHANGED");
    }
    if (run.inboxCandidateId) {
      if (!plan.enabled || plan.authorizationRevision !== plan.revision)
        throw Error("INBOX_EVALUATION_DISABLED");
      const source = inboxEvaluationSource(
        this.repo,
        plan,
        run.inboxCandidateId,
      );
      if (
        source.candidate.itemHash !== run.inboxItemHash ||
        source.draft.id !== run.inboxSourceDraftId ||
        (run.inboxSourceHash && source.sourceHash !== run.inboxSourceHash)
      )
        throw Error("INBOX_EVALUATION_SOURCE_CHANGED");
    }
  }
  private profile(run: Row, type: "text" | "music") {
    const grant = run.plan[type];
    if (!grant)
      throw Error(
        type === "text"
          ? "TEXT_AUTHORIZATION_REQUIRED"
          : "MUSIC_AUTHORIZATION_REQUIRED",
      );
    const p = listApiProfiles(this.repo).find((p) => p.id === grant.profileId);
    if (
      !p ||
      p.kind !== type ||
      p.providerId !== (type === "text" ? "deepseek" : "yourmusic")
    )
      throw Error("PROFILE_PROVIDER_MISMATCH");
    if (p.revision !== grant.profileRevision)
      throw Error("PROFILE_REVISION_CHANGED");
    return p;
  }
  private risk(profileId: string) {
    return this.repo
      .all("operations")
      .some(
        (o) =>
          (o.accountRef === profileId || o.profileId === profileId) &&
          (o.state === "unknown" || o.costState === "unknown"),
      );
  }
  private musicAuthorized(run: Row) {
    return run.managedMusic
      ? run.plan.music.creditPolicy?.mode === "existing_credits" ||
          this.options.verifyManagedMusicQuote?.(run.plan.music, this.now()) ===
            true
      : this.options.verifyMusicPricing?.(run.plan.music) === true;
  }
  private readyTask(run: Row, operationId = run.id): Row | null {
    const p = run.plan;
    if (
      (run.stage === "candidate" || run.stage === "revise") &&
      p.candidateMode === "deepseek"
    ) {
      if (!p.text) return null;
      const request = DeepSeekRequestSchema.parse({
        operationId,
        modelId: p.text.modelId,
        maxOutputTokens: p.text.maxOutputTokens,
        messages: [
          { role: "system", content: deepSeekSystemPrompt },
          {
            role: "user",
            content: JSON.stringify({
              instruction: p.theme,
              title: p.title,
              artistDefaults:
                this.repo.get("artists", run.artistId).defaults ?? {},
              previousDraft: run.candidate?.draft ?? null,
              feedback: run.score?.findings ?? [],
            }),
          },
        ],
      });
      return {
        type: "text_generate",
        profileId: p.text.profileId,
        profileRevision: p.text.profileRevision,
        request,
      };
    }
    if (run.stage === "score" && p.scoreMode === "deepseek") {
      if (!p.text) return null;
      const request = TextEvaluationRequestSchema.parse({
        operationId,
        modelId: p.text.modelId,
        maxOutputTokens: p.text.maxOutputTokens,
        revisionId: run.candidate.id,
        intent: p.theme,
        pair: {
          lyrics: run.candidate.pair.lyrics,
          musicPrompt: run.candidate.pair.musicPrompt,
        },
        threshold: p.threshold,
      });
      return {
        type: "text_score",
        profileId: p.text.profileId,
        profileRevision: p.text.profileRevision,
        request,
      };
    }
    if (run.stage === "music" && p.music)
      return {
        type: "music_submit",
        profileId: p.music.profileId,
        profileRevision: p.music.profileRevision,
        request: {
          operationId,
          modelId: p.music.modelId,
          draft: run.candidate.draft,
          workId: run.workId,
          maxCostCredits: p.music.maxCostPerRequestCredits,
        },
      };
    if (run.stage === "assets")
      return {
        type: "music_assets",
        profileId: p.music.profileId,
        profileRevision: p.music.profileRevision,
        request: {
          operationId,
          songIds: run.songIds,
          trackingId: run.trackingId,
          workId: run.workId,
        },
      };
    if (run.stage === "publication" && p.publication)
      return {
        type: "publication_submit",
        request: {
          operationId,
          ...p.publication,
          workId: run.workId,
          assets: run.assets,
          candidate: run.candidate,
          payloadHash: this.publicationHash(run),
        },
      };
    if (run.stage === "receipt")
      return {
        type: "publication_poll",
        request: {
          operationId,
          ...p.publication,
          workId: run.workId,
          externalId: run.externalId,
          submissionOperationId: run.publicationOperationId,
        },
      };
    return null;
  }
  next(raw: unknown): { run: Row; task: Row | null } {
    const { id } = FlowIdSchema.parse(raw);
    return this.repo.transaction(() => {
      let run = this.get("run", id);
      if (
        run.state === "blocked" &&
        run.stage === "music" &&
        !run.plan.music &&
        run.workId
      ) {
        const manual = this.manualAssets(run);
        if (manual)
          run = this.patch(run, {
            ...manual,
            stage: "publication",
            state: "ready",
            reasons: [],
          });
      }
      if (
        run.state === "blocked" &&
        run.stage === "publication" &&
        run.reasons.some((r: string) =>
          [
            "COVER_REQUIRED",
            "LYRICS_AUDIO_MATCH_UNCONFIRMED",
            "RIGHTS_CONFIRMATION",
            "NEEDS_MUSIC_MATERIALS",
          ].includes(r),
        )
      ) {
        if (this.materials(run).ready)
          run = this.patch(run, { state: "ready", reasons: [] });
      }
      if (
        [
          "unknown",
          "dispatching",
          "awaiting_approval",
          "blocked",
          "failed",
          "completed",
          "ready_to_publish",
        ].includes(run.state)
      )
        return { run, task: null };
      if (run.nextCheckAt && run.nextCheckAt > this.now().toISOString())
        return { run, task: null };
      if (["assets", "receipt"].includes(run.stage)) {
        const started =
          run.stage === "assets"
            ? run.musicTrackingStartedAt
            : run.publicationTrackingStartedAt;
        if (
          started &&
          this.now().getTime() - new Date(started).getTime() > 86400000
        )
          return {
            run: this.patch(run, {
              state: "blocked",
              reasons: ["TRACKING_DEADLINE_EXCEEDED"],
            }),
            task: null,
          };
      }
      for (let n = 0; n < 16; n++) {
        if (run.stage === "candidate") {
          if (!run.candidate) {
            if (run.plan.candidateMode === "deepseek") {
              if (!run.plan.text)
                return {
                  run: this.patch(run, {
                    state: "blocked",
                    reasons: ["TEXT_AUTHORIZATION_REQUIRED"],
                  }),
                  task: null,
                };
              return { run, task: this.readyTask(run) };
            }
            const candidate = flowCandidate(
              run,
              localFlowDraft(run.plan, this.repo.get("artists", run.artistId)),
              "local_template",
            );
            run = this.patch(run, {
              candidate,
              versions: [...run.versions, candidate],
              state: "awaiting_approval",
              reasons: ["CANDIDATE_REVIEW_REQUIRED"],
            });
            return { run, task: null };
          }
          if (
            run.inboxCandidateId &&
            run.plan.inboxEvaluation &&
            run.plan.autoContinue
          )
            run = this.patch(run, { candidateApproved: true });
          if (!run.candidateApproved)
            return {
              run: this.patch(run, {
                state: "awaiting_approval",
                reasons: ["CANDIDATE_REVIEW_REQUIRED"],
              }),
              task: null,
            };
          run = this.patch(run, {
            stage: "score",
            state: "ready",
            reasons: [],
          });
          continue;
        }
        if (run.stage === "score") {
          if (run.plan.scoreMode === "deepseek") {
            if (!run.plan.text)
              return {
                run: this.patch(run, {
                  state: "blocked",
                  reasons: ["TEXT_AUTHORIZATION_REQUIRED"],
                }),
                task: null,
              };
            return { run, task: this.readyTask(run) };
          }
          const score = localFlowScore(run.candidate, run.plan.threshold);
          run = this.afterScore(run, score);
          if (run.state === "failed") return { run, task: null };
          continue;
        }
        if (run.stage === "revise") {
          if (run.revisionCount >= run.plan.maxRevisions)
            return {
              run: this.patch(run, {
                state: "failed",
                reasons: ["REVISION_LIMIT"],
              }),
              task: null,
            };
          if (run.plan.candidateMode === "deepseek")
            return { run, task: this.readyTask(run) };
          run = this.patch(run, { revisionCount: run.revisionCount + 1 });
          const candidate = flowCandidate(
            run,
            localFlowDraft(
              run.plan,
              this.repo.get("artists", run.artistId),
              run.candidate?.draft,
            ),
            "local_template",
          );
          run = this.patch(run, {
            candidate,
            versions: [...run.versions, candidate],
            stage: "candidate",
            state: "awaiting_approval",
            candidateApproved: false,
            score: null,
            scoreRetries: 0,
            reasons: ["CANDIDATE_REVIEW_REQUIRED"],
          });
          return { run, task: null };
        }
        if (run.stage === "work") {
          if (!this.options.createWork)
            return {
              run: this.patch(run, {
                state: "blocked",
                reasons: ["WORK_MATERIALIZER_UNAVAILABLE"],
              }),
              task: null,
            };
          const work = this.options.createWork(run, run.candidate);
          const actual = this.repo.get("works", work.workId);
          if (actual.artistId !== run.artistId)
            throw Error("WORK_ARTIST_SCOPE");
          run = this.patch(run, {
            workId: work.workId,
            stage: "music",
            state: "ready",
            reasons: [],
          });
          continue;
        }
        if (run.stage === "music") {
          if (!run.plan.music) {
            const manual = this.manualAssets(run);
            if (manual) {
              run = this.patch(run, {
                ...manual,
                stage: "publication",
                state: "ready",
                reasons: [],
              });
              continue;
            }
            return {
              run: this.patch(run, {
                state: "blocked",
                reasons: [
                  "NEEDS_MUSIC_MATERIALS",
                  "MUSIC_AUTHORIZATION_REQUIRED",
                ],
              }),
              task: null,
            };
          }
          if (!this.musicAuthorized(run))
            return {
              run: this.patch(run, {
                state: "blocked",
                reasons: ["MUSIC_PRICING_UNVERIFIED"],
              }),
              task: null,
            };
          return { run, task: this.readyTask(run) };
        }
        if (run.stage === "assets") return { run, task: this.readyTask(run) };
        if (run.stage === "publication") {
          const materials = this.materials(run);
          if (!materials.ready)
            return {
              run: this.patch(run, {
                state: "blocked",
                reasons: materials.reasons,
              }),
              task: null,
            };
          if (!run.plan.publication)
            return {
              run: this.patch(run, {
                state: "ready_to_publish",
                reasons: ["PUBLICATION_TARGET_REQUIRED"],
              }),
              task: null,
            };
          if (!run.publicationApproval)
            return {
              run: this.patch(run, {
                state: "awaiting_approval",
                reasons: ["PUBLICATION_APPROVAL_REQUIRED"],
              }),
              task: null,
            };
          return { run, task: this.readyTask(run) };
        }
        if (run.stage === "receipt") return { run, task: this.readyTask(run) };
        return { run, task: null };
      }
      return {
        run: this.patch(run, {
          state: "failed",
          reasons: ["LOCAL_ADVANCE_LIMIT"],
        }),
        task: null,
      };
    });
  }
  private afterScore(run: Row, score: Row) {
    if (run.inboxCandidateId && score.passed)
      return this.patch(run, {
        score,
        stage: "score",
        state: "completed",
        reasons: [],
      });
    if (score.passed)
      return this.patch(run, {
        score,
        stage: "work",
        state: "ready",
        reasons: [],
      });
    if (run.revisionCount >= run.plan.maxRevisions)
      return this.patch(run, {
        score,
        state: "failed",
        reasons: ["QUALITY_THRESHOLD_NOT_MET", "REVISION_LIMIT"],
      });
    return this.patch(run, {
      score,
      stage: "revise",
      state: "ready",
      reasons: ["QUALITY_THRESHOLD_NOT_MET"],
    });
  }
  private manualAssets(run: Row): Row | null {
    const work = this.repo.get("works", run.workId),
      audio = work.assets?.audio_A
        ? this.repo.maybe("assets", work.assets.audio_A)
        : null;
    if (
      !audio ||
      audio.kind !== "audio" ||
      !/^[a-f0-9]{64}$/.test(audio.sha256 ?? "")
    )
      return null;
    const cover = work.assets?.cover
      ? this.repo.maybe("assets", work.assets.cover)
      : null;
    if (
      !cover ||
      cover.kind !== "image" ||
      !/^[a-f0-9]{64}$/.test(cover.sha256 ?? "")
    )
      return null;
    return {
      materialMode: "manual",
      assets: [
        {
          providerSongId: "manual:" + audio.id,
          assetId: audio.id,
          sha256: audio.sha256,
          ordinal: 0,
        },
      ],
      cover: { assetId: cover.id, sha256: cover.sha256 },
    };
  }
  private materials(run: Row): { ready: boolean; reasons: string[] } {
    const work = this.repo.get("works", run.workId),
      reasons: string[] = [];
    const audio = work.assets?.audio_A
      ? this.repo.maybe("assets", work.assets.audio_A)
      : null;
    const cover = work.assets?.cover
      ? this.repo.maybe("assets", work.assets.cover)
      : null;
    if (
      !audio ||
      audio.kind !== "audio" ||
      !/^[a-f0-9]{64}$/.test(audio.sha256 ?? "")
    )
      reasons.push("NEEDS_MUSIC_MATERIALS");
    if (
      !cover ||
      cover.kind !== "image" ||
      !/^[a-f0-9]{64}$/.test(cover.sha256 ?? "")
    )
      reasons.push("COVER_REQUIRED");
    const trusted = this.options.publicationMaterials?.({ run, work });
    if (trusted) {
      if (!trusted.ready) reasons.push(...trusted.reasons);
    } else {
      const version = this.repo.maybe(
        "settings",
        "lyrics-version:" + work.lyricsVersionId,
      )?.version;
      const clean = cleanLyricText(work.lyrics ?? ""),
        confirmation = work.lyricsConfirmation;
      if (
        !version ||
        version.workId !== work.id ||
        version.rawHash !== hash(work.lyrics ?? "") ||
        !clean.cleaned.trim() ||
        clean.warnings.length ||
        confirmation?.versionId !== version.id ||
        confirmation?.plainHash !== hash(clean.cleaned) ||
        confirmation?.audioHash !== audio?.sha256
      )
        reasons.push("LYRICS_AUDIO_MATCH_UNCONFIRMED");
      if (work.rightsConfirmed !== true) reasons.push("RIGHTS_CONFIRMATION");
    }
    return { ready: reasons.length === 0, reasons: [...new Set(reasons)] };
  }
  private publicationHash(run: Row) {
    const work = this.repo.get("works", run.workId);
    return hashValue({
      workId: work.id,
      workRevision: work.revision ?? null,
      title: work.title ?? null,
      lyrics: work.lyrics ?? null,
      prompt: work.prompt ?? null,
      candidateHash: run.candidate.pairHash,
      assets: run.assets,
      cover: work.assets?.cover
        ? {
            assetId: work.assets.cover,
            sha256: this.repo.get("assets", work.assets.cover).sha256,
          }
        : null,
      lyricsConfirmation: work.lyricsConfirmation ?? null,
      accountId: run.plan.publication?.accountId ?? null,
      termsHash: run.plan.publication?.termsHash ?? null,
    });
  }
  private authority(run: Row) {
    const a = this.options.publicationAuthority?.({
      run,
      work: this.repo.get("works", run.workId),
      publication: run.plan.publication,
    });
    if (
      !a?.allowed ||
      a.termsHash !== run.plan.publication.termsHash ||
      !a.evidenceId
    )
      throw Error(a?.reason ?? "PUBLICATION_AUTHORITY_REQUIRED");
    return a;
  }
  approve(raw: unknown) {
    const i = FlowApproveSchema.parse(raw);
    return this.repo.transaction(() => {
      const run = this.get("run", i.id);
      if (run.revision !== i.expectedRevision) throw Error("REVISION_CONFLICT");
      if (
        !["awaiting_approval", "ready_to_publish"].includes(run.state) ||
        run.stage !== i.stage
      )
        throw Error("APPROVAL_STAGE_MISMATCH");
      this.assertPlan(run);
      if (i.stage === "candidate") {
        if (!run.candidate) throw Error("CANDIDATE_REQUIRED");
        return this.patch(run, {
          candidateApproved: true,
          state: "ready",
          reasons: [],
        });
      }
      if (
        !run.plan.publication ||
        i.accountId !== run.plan.publication.accountId ||
        i.termsHash !== run.plan.publication.termsHash
      )
        throw Error("PUBLICATION_SCOPE_MISMATCH");
      this.assertAssets(run, run.assets);
      const material = this.materials(run);
      if (!material.ready) throw Error(material.reasons[0]);
      const authority = this.authority(run);
      return this.patch(run, {
        publicationApproval: {
          payloadHash: this.publicationHash(run),
          accountId: i.accountId,
          termsHash: i.termsHash,
          evidenceId: authority.evidenceId,
          approvedAt: this.now().toISOString(),
        },
        state: "ready",
        reasons: [],
      });
    });
  }
  private budgetUsed(budgetScope: string, date: string, unit: string) {
    return this.repo
      .all("workflowLedger")
      .filter(
        (e) =>
          (e.budgetScope ?? e.planId) === budgetScope &&
          e.date === date &&
          e.unit === unit,
      )
      .reduce(
        (n, e) =>
          n +
          (e.kind === "reserve"
            ? e.amount
            : e.kind === "release"
              ? -e.amount
              : 0),
        0,
      );
  }
  private ledger(run: Row, op: Row, kind: string, amount: number) {
    this.repo.append("workflowLedger", {
      id: randomUUID(),
      eventKey: "production-flow:" + op.id + ":" + kind,
      operationId: op.id,
      runId: run.id,
      planId: run.planId,
      budgetScope: op.budgetScope ?? run.plan.managedBudgetScope ?? run.planId,
      date: op.budgetDate,
      scope:
        op.unit === "usd_micro_estimate"
          ? "production_flow_text"
          : "production_flow_music",
      kind,
      amount,
      unit: op.unit,
      at: this.now().toISOString(),
    });
  }
  claim(raw: unknown) {
    const i = FlowClaimSchema.parse(raw);
    return this.repo.transaction(() => {
      let run = this.get("run", i.id);
      if (run.revision !== i.expectedRevision) throw Error("REVISION_CONFLICT");
      if (run.state === "unknown") throw Error("OUTCOME_UNKNOWN");
      if (run.state === "dispatching") throw Error("FLOW_TASK_BUSY");
      this.assertPlan(run);
      const n = this.next({ id: i.id });
      run = n.run;
      const task = n.task;
      if (!task) throw Error(run.reasons[0] ?? "FLOW_TASK_NOT_READY");
      const id = randomUUID(),
        actual = this.readyTask(run, id)!;
      if (run.managedMusic && actual.type === "music_submit") {
        const work = this.repo.maybe("works", run.workId);
        if (
          !work ||
          work.artistId !== run.artistId ||
          work.productionFlowRunId !== run.id ||
          work.productionCandidateId !== run.candidate.id ||
          work.productionCandidateHash !== run.candidate.pairHash ||
          work.title !== run.candidate.draft.title ||
          work.lyrics !== run.candidate.pair.lyrics ||
          work.prompt !== run.candidate.pair.musicPrompt
        )
          throw Error("MANAGED_MUSIC_WORK_SCOPE");
      }
      let reserved = 0,
        unit: string | null = null;
      const budgetDate = this.date(run.plan);
      const budgetScope = run.plan.managedBudgetScope ?? run.planId;
      if (
        [
          "text_generate",
          "text_score",
          "music_submit",
          "music_assets",
        ].includes(actual.type)
      )
        this.profile(run, actual.type.startsWith("text") ? "text" : "music");
      if (
        ["text_generate", "text_score", "music_submit"].includes(actual.type)
      ) {
        if (run.managedMusic && actual.type === "music_submit") {
          const shared = this.repo
            .all("operations")
            .filter(
              (o) =>
                o.unit === "provider_credit" &&
                (o.budgetScope ?? o.planId) === budgetScope,
            );
          if (
            shared.some(
              (o) => o.state === "unknown" || o.costState === "unknown",
            )
          )
            throw Error("PROVIDER_RISK_FROZEN");
          if (shared.some((o) => o.state === "dispatching"))
            throw Error("FLOW_PROVIDER_BUSY");
        }
        if (this.risk(actual.profileId)) throw Error("PROVIDER_RISK_FROZEN");
        if (
          this.repo
            .all("operations")
            .some(
              (o) =>
                (o.accountRef === actual.profileId ||
                  o.profileId === actual.profileId) &&
                o.state === "dispatching",
            )
        )
          throw Error("FLOW_PROVIDER_BUSY");
        if (actual.type.startsWith("text")) {
          unit = "usd_micro_estimate";
          const messages =
            actual.type === "text_score"
              ? textEvaluationMessages(actual.request)
              : actual.request.messages;
          reserved = estimateDeepSeekCostMicros(
            run.plan.text.modelId,
            Buffer.byteLength(JSON.stringify(messages), "utf8") + 1024,
            run.plan.text.maxOutputTokens,
          );
          if (
            reserved >
              run.plan.text.budgetMicros -
                run.textSpentMicros -
                run.textReservedMicros ||
            reserved >
              run.plan.text.budgetMicros -
                this.budgetUsed(budgetScope, budgetDate, unit)
          )
            throw Error("TEXT_BUDGET_INSUFFICIENT");
        } else {
          unit = "provider_credit";
          if (!this.musicAuthorized(run))
            throw Error("MUSIC_PRICING_UNVERIFIED");
          reserved = run.plan.music.maxCostPerRequestCredits;
          if (
            reserved >
              run.plan.music.budgetCredits -
                run.musicSpentCredits -
                run.musicReservedCredits ||
            reserved >
              run.plan.music.budgetCredits -
                this.budgetUsed(budgetScope, budgetDate, unit)
          )
            throw Error("MUSIC_BUDGET_INSUFFICIENT");
        }
      }
      if (actual.type === "publication_submit") {
        this.assertAssets(run, run.assets);
        const material = this.materials(run);
        if (!material.ready) throw Error(material.reasons[0]);
        this.authority(run);
        if (this.publicationHash(run) !== run.publicationApproval?.payloadHash)
          throw Error("PUBLICATION_APPROVAL_STALE");
      }
      const operation = {
        id,
        operationKey: "production-flow:" + id,
        kind: "production_flow",
        runId: run.id,
        planId: run.planId,
        budgetScope,
        taskType: actual.type,
        accountRef: actual.profileId ?? run.plan.publication?.accountId ?? null,
        provider: actual.type.startsWith("text")
          ? "deepseek"
          : actual.type.startsWith("music")
            ? "yourmusic"
            : "tme",
        state: "dispatching",
        costState: unit ? "reserved" : "not_applicable",
        unit,
        reservedAmount: reserved,
        budgetDate,
        task: actual,
        requestHash: hashValue(actual.request),
        createdAt: this.now().toISOString(),
      };
      this.repo.save("operations", operation);
      if (unit) this.ledger(run, operation, "reserve", reserved);
      run = this.patch(run, {
        state: "dispatching",
        operationId: id,
        reasons: [],
        ...(unit === "usd_micro_estimate"
          ? { textReservedMicros: run.textReservedMicros + reserved }
          : unit === "provider_credit"
            ? { musicReservedCredits: run.musicReservedCredits + reserved }
            : {}),
        ...(actual.type === "text_generate" && run.stage === "revise"
          ? { revisionCount: run.revisionCount + 1 }
          : {}),
      });
      return { run, task: actual, operation };
    });
  }
  private settle(run: Row, op: Row, cost: number | null) {
    if (!op.unit || cost === null) return run;
    this.ledger(run, op, "settle", cost);
    if (cost < op.reservedAmount)
      this.ledger(run, op, "release", op.reservedAmount - cost);
    if (cost > op.reservedAmount)
      this.ledger(
        run,
        { ...op, id: op.id + ":overage" },
        "reserve",
        cost - op.reservedAmount,
      );
    return op.unit === "usd_micro_estimate"
      ? {
          ...run,
          textReservedMicros: Math.max(
            0,
            run.textReservedMicros - op.reservedAmount,
          ),
          textSpentMicros: run.textSpentMicros + cost,
        }
      : {
          ...run,
          musicReservedCredits: Math.max(
            0,
            run.musicReservedCredits - op.reservedAmount,
          ),
          musicSpentCredits: run.musicSpentCredits + cost,
        };
  }
  private assertAssets(run: Row, assets: FlowAsset[]) {
    if (run.materialMode === "manual") {
      const current = this.manualAssets(run);
      if (
        !current ||
        hashValue(current.assets) !== hashValue(assets) ||
        hashValue(current.cover) !== hashValue(run.cover)
      )
        throw Error("MANUAL_ASSET_SNAPSHOT_CHANGED");
      return;
    }
    if (
      assets.length !== 2 ||
      new Set(assets.map((a) => a.providerSongId)).size !== 2 ||
      new Set(assets.map((a) => a.assetId)).size !== 2 ||
      assets.some((a) => !run.songIds.includes(a.providerSongId))
    )
      throw Error("ORIGINAL_ASSET_SCOPE");
    for (const a of assets) {
      if (run.songIds[a.ordinal] !== a.providerSongId)
        throw Error("ORIGINAL_ASSET_SCOPE");
      const stored = this.repo.get("assets", a.assetId);
      if (stored.kind !== "audio" || stored.sha256 !== a.sha256)
        throw Error("ASSET_HASH_MISMATCH");
    }
  }
  record(raw: unknown) {
    const i = FlowRecordSchema.parse(raw);
    return this.repo.transaction(() => {
      let run = this.get("run", i.id);
      const op = this.repo.get("operations", i.operationId);
      if (
        op.kind !== "production_flow" ||
        op.runId !== run.id ||
        op.taskType !== i.result.type
      )
        throw Error("FLOW_OPERATION_SCOPE");
      const hash = hashValue(i.result);
      const recovery =
        run.managedMusic &&
        op.taskType === "music_submit" &&
        op.state === "unknown" &&
        op.result?.status === "unknown" &&
        i.result.type === "music_submit" &&
        "status" in i.result &&
        i.result.status === "accepted";
      if (op.resultHash) {
        if (op.resultHash === hash) return run;
        if (!recovery) throw Error("IDEMPOTENCY_CONFLICT");
      }
      if (
        run.operationId !== op.id ||
        !["dispatching", "unknown"].includes(op.state)
      )
        throw Error("FLOW_OPERATION_SCOPE");
      let result: any = i.result,
        cost: number | null = null,
        costKnown = !op.unit,
        change: Row = {},
        state = "ready",
        reasons: string[] = [];
      if (
        "status" in result &&
        ["blocked", "confirmed_unsent", "unknown"].includes(result.status)
      ) {
        const unsent =
          ["confirmed_unsent", "blocked"].includes(result.status) &&
          result.confirmedUnsent === true;
        if (unsent) {
          if (op.unit) {
            this.ledger(run, op, "release", op.reservedAmount);
            run =
              op.unit === "usd_micro_estimate"
                ? {
                    ...run,
                    textReservedMicros: Math.max(
                      0,
                      run.textReservedMicros - op.reservedAmount,
                    ),
                  }
                : {
                    ...run,
                    musicReservedCredits: Math.max(
                      0,
                      run.musicReservedCredits - op.reservedAmount,
                    ),
                  };
          }
          state = "blocked";
          costKnown = true;
          reasons = [result.reason];
        } else {
          state = ["music_assets", "publication_poll"].includes(op.taskType)
            ? "blocked"
            : "unknown";
          costKnown = !op.unit;
          reasons = [result.reason];
        }
      } else if (
        result.type === "text_generate" ||
        result.type === "text_score"
      ) {
        const response =
          result.type === "text_score"
            ? parseTextEvaluationResult(result.result, op.task.request)
            : result.result;
        if (
          response.operationId !== op.id ||
          response.requestedModelId !== op.task.request.modelId
        )
          throw Error("TEXT_OPERATION_SCOPE");
        const modelVerified = deepSeekResponseModelMatches(
          response.requestedModelId,
          response.providerModel,
        );
        cost = modelVerified ? response.estimatedCostMicros : null;
        if (
          cost !== null &&
          response.usage &&
          cost !==
            estimateDeepSeekCostMicros(
              response.requestedModelId,
              response.usage.prompt_tokens,
              response.usage.completion_tokens,
            )
        )
          throw Error("COST_ESTIMATE_MISMATCH");
        costKnown = cost !== null;
        run = this.settle(run, op, cost);
        reasons = modelVerified
          ? response.reasons
          : ["TEXT_MODEL_PRICE_UNVERIFIED"];
        if (response.status === "unknown" || !costKnown) {
          state = "unknown";
        } else if (result.type === "text_generate") {
          if (response.status === "complete") {
            const candidate = flowCandidate(
              run,
              response.draft,
              "deepseek-api",
              {
                providerModel: response.providerModel,
                providerRequestId: response.providerRequestId,
                usage: response.usage,
                operationId: op.id,
              },
            );
            change = {
              candidate,
              versions: [...run.versions, candidate],
              score: null,
              scoreRetries: 0,
              stage: "candidate",
              candidateApproved: false,
            };
            {
              state = run.inboxCandidateId ? "ready" : "awaiting_approval";
              reasons = run.inboxCandidateId
                ? []
                : ["CANDIDATE_REVIEW_REQUIRED"];
            }
          } else if (run.revisionCount < run.plan.maxRevisions) {
            change = { stage: "revise" };
            reasons = ["TEXT_DRAFT_INVALID"];
          } else {
            state = "failed";
            reasons = ["TEXT_DRAFT_INVALID", "REVISION_LIMIT"];
          }
        } else if (response.status === "complete") {
          const scored = this.afterScore(run, {
            ...response.score,
            method: "deepseek",
            providerModel: response.providerModel,
            providerRequestId: response.providerRequestId,
            operationId: op.id,
          });
          change = { stage: scored.stage, score: scored.score };
          state = scored.state;
          reasons = scored.reasons;
        } else {
          change = { scoreRetries: run.scoreRetries + 1, stage: "score" };
          state =
            change.scoreRetries > run.plan.maxScoreRetries
              ? "failed"
              : run.inboxCandidateId
                ? "ready"
                : "blocked";
          reasons = ["TEXT_SCORE_INVALID"];
        }
      } else if (result.type === "music_submit") {
        cost = result.actualCostCredits;
        costKnown = cost !== null;
        run = this.settle(run, op, cost);
        change = {
          stage: "assets",
          musicSubmissionOperationId: op.id,
          songIds: result.songIds,
          trackingId: result.trackingId,
          musicTrackingStartedAt: this.now().toISOString(),
          nextCheckAt: null,
          pollAttempts: 0,
        };
      } else if (result.type === "music_assets") {
        if (result.status === "complete") {
          this.assertAssets(run, result.assets);
          if (this.options.materializeAssets) {
            const saved = this.options.materializeAssets(run, result.assets);
            if (saved.workId !== run.workId) throw Error("WORK_ASSET_SCOPE");
          } else {
            const work = this.repo.get("works", run.workId),
              a = result.assets.find((a: FlowAsset) => a.ordinal === 0)!,
              b = result.assets.find((a: FlowAsset) => a.ordinal === 1)!;
            this.repo.save("works", {
              ...work,
              assets: {
                ...work.assets,
                audio_A: a.assetId,
                audio_B: b.assetId,
              },
              assetHistory: [
                ...new Set([
                  ...(work.assetHistory ?? []),
                  a.assetId,
                  b.assetId,
                ]),
              ],
              audioVersions: result.assets,
              source: run.candidate.source,
            });
          }
          change = {
            stage: run.managedMusic ? "assets" : "publication",
            assets: result.assets,
            pollAttempts: 0,
          };
          if (run.managedMusic) state = "completed";
        } else if (result.status === "pending") {
          change = {
            pollAttempts: run.pollAttempts + 1,
            nextCheckAt: new Date(
              this.now().getTime() +
                Math.min(60000, 15000 * 2 ** Math.floor(run.pollAttempts / 4)),
            ).toISOString(),
          };
          state = change.pollAttempts >= 120 ? "blocked" : "waiting";
          reasons = [
            state === "blocked"
              ? "ASSET_TRACKING_LIMIT"
              : "ORIGINAL_ASSETS_PENDING",
          ];
        } else {
          state = "blocked";
          reasons = [result.reason ?? "ORIGINAL_ASSET_DOWNLOAD_FAILED"];
        }
      } else if (
        result.type === "publication_submit" ||
        result.type === "publication_poll"
      ) {
        if (
          result.type === "publication_poll" &&
          (op.task.request.externalId !== run.externalId ||
            (result.externalId && result.externalId !== run.externalId) ||
            (result.receipt && result.receipt.externalId !== run.externalId))
        )
          throw Error("RECEIPT_ID_MISMATCH");
        if (result.status === "complete") {
          if (
            result.receipt.externalId !==
            (result.externalId ?? run.externalId ?? result.receipt.externalId)
          )
            throw Error("RECEIPT_ID_MISMATCH");
          change = {
            stage: "receipt",
            receipt: result.receipt,
            externalId: result.receipt.externalId,
          };
          state = "completed";
        } else if (result.status === "accepted") {
          change = {
            stage: "receipt",
            externalId: result.externalId,
            publicationOperationId: op.id,
            publicationTrackingStartedAt:
              run.publicationTrackingStartedAt ?? this.now().toISOString(),
            nextCheckAt: null,
            pollAttempts: 0,
          };
        } else if (result.status === "pending") {
          change = {
            pollAttempts: run.pollAttempts + 1,
            nextCheckAt: new Date(
              this.now().getTime() +
                Math.min(60000, 15000 * 2 ** Math.floor(run.pollAttempts / 4)),
            ).toISOString(),
          };
          state = change.pollAttempts >= 120 ? "blocked" : "waiting";
          reasons = [
            state === "blocked"
              ? "RECEIPT_TRACKING_LIMIT"
              : "OFFICIAL_RECEIPT_PENDING",
          ];
        } else {
          state = "blocked";
          reasons = [result.reason ?? "PUBLICATION_REJECTED"];
        }
      }
      if (
        op.unit &&
        costKnown &&
        cost !== null &&
        ((op.unit === "usd_micro_estimate" &&
          run.textSpentMicros > run.plan.text.budgetMicros) ||
          (op.unit === "provider_credit" &&
            run.musicSpentCredits > run.plan.music.budgetCredits))
      ) {
        state = "blocked";
        reasons.push("BUDGET_ACTUAL_EXCEEDED");
      }
      this.repo.save("operations", {
        ...op,
        state: state === "unknown" ? "unknown" : "complete",
        costState: costKnown
          ? op.unit
            ? "estimated"
            : "not_applicable"
          : "unknown",
        actualCost: cost,
        result,
        resultHash: hash,
        ...(recovery
          ? {
              recoveryEvidence: [
                ...(op.recoveryEvidence ?? []),
                {
                  result: op.result,
                  resultHash: op.resultHash,
                  at: this.now().toISOString(),
                },
              ],
            }
          : {}),
        reasons,
        completedAt: this.now().toISOString(),
      });
      if (run.paused && !["unknown", "completed"].includes(state)) {
        state = "blocked";
        reasons.push("AUTOMATION_PAUSED");
      }
      return this.patch(run, { ...change, state, reasons });
    });
  }
  retry(raw: unknown) {
    const i = FlowRetrySchema.parse(raw);
    return this.repo.transaction(() => {
      const run = this.get("run", i.id);
      if (run.revision !== i.expectedRevision) throw Error("REVISION_CONFLICT");
      if (run.managedMusic && run.managedStopped && run.stage !== "assets")
        throw Error("MANAGED_MUSIC_STOPPED");
      if (run.reasons.includes("RESTORED_REQUIRES_REVIEW"))
        throw Error("RESTORED_REQUIRES_REVIEW");
      if (run.state === "unknown") throw Error("OUTCOME_UNKNOWN");
      if (!["blocked", "failed"].includes(run.state))
        throw Error("RETRY_SCOPE");
      if (run.stage === "score" && run.scoreRetries > run.plan.maxScoreRetries)
        throw Error("SCORE_RETRY_LIMIT");
      if (run.stage === "revise" && run.revisionCount >= run.plan.maxRevisions)
        throw Error("REVISION_LIMIT");
      if (run.stage === "assets" && run.assetRetries >= 3)
        throw Error("ASSET_RETRY_LIMIT");
      if (
        run.stage === "score" &&
        run.score?.passed === false &&
        run.revisionCount >= run.plan.maxRevisions
      )
        throw Error("REVISION_LIMIT");
      return this.patch(run, {
        state: "ready",
        paused: false,
        reasons: [],
        nextCheckAt: null,
        pollAttempts: 0,
        ...(run.stage === "assets"
          ? { assetRetries: run.assetRetries + 1 }
          : {}),
      });
    });
  }
  block(raw: unknown) {
    const i = FlowBlockSchema.parse(raw),
      run = this.get("run", i.id);
    if (run.revision !== i.expectedRevision) throw Error("REVISION_CONFLICT");
    if (["dispatching", "unknown", "completed"].includes(run.state))
      throw Error("BLOCK_SCOPE");
    return this.patch(run, { state: "blocked", reasons: [i.reason] });
  }
  useManualAssets(raw: unknown) {
    const i = FlowUseManualAssetsSchema.parse(raw);
    return this.repo.transaction(() => {
      const run = this.get("run", i.id);
      if (run.managedMusic) throw Error("MANAGED_PLAN_INTERNAL_ONLY");
      if (run.revision !== i.expectedRevision) throw Error("REVISION_CONFLICT");
      if (run.reasons.includes("RESTORED_REQUIRES_REVIEW"))
        throw Error("RESTORED_REQUIRES_REVIEW");
      if (run.stage !== "music" || !["ready", "blocked"].includes(run.state))
        throw Error("MANUAL_ASSETS_SCOPE");
      if (
        this.repo
          .all("operations")
          .some(
            (op) =>
              op.kind === "production_flow" &&
              op.runId === run.id &&
              op.taskType === "music_submit",
          ) ||
        run.musicReservedCredits > 0 ||
        run.musicSpentCredits > 0
      )
        throw Error("MUSIC_SUBMISSION_ALREADY_EXISTS");
      this.assertPlan(run);
      const updated = this.patch(run, {
        plan: { ...run.plan, music: null },
        materialMode: "manual",
        manualFallback: {
          originalMusicGrant: run.plan.music,
          approvedAt: this.now().toISOString(),
        },
        state: "ready",
        reasons: [],
      });
      this.repo.audit("productionFlow.manualAssets", run.id, {
        noMusicSubmission: true,
      });
      return updated;
    });
  }
  pauseAll() {
    return this.repo.transaction(() => {
      for (const plan of this.rows("plan").filter((p) => p.enabled))
        this.put("plan", {
          ...plan,
          enabled: false,
          authorizationRevision: null,
        });
      for (const run of this.rows("run").filter(
        (r) => !["completed", "unknown"].includes(r.state),
      )) {
        if (run.reasons.includes("RESTORED_REQUIRES_REVIEW")) continue;
        this.patch(run, {
          paused: true,
          state: run.state === "dispatching" ? "dispatching" : "blocked",
          reasons: ["AUTOMATION_PAUSED"],
        });
      }
      return this.list();
    });
  }
}
