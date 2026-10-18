import { randomUUID } from "node:crypto";
import type { Repository, Row } from "./database";
import { listApiProfiles } from "./api-profiles";
import { parseDraft } from "../shared/creation";
import {
  LiveTextPrepareSchema,
  LiveTextClaimSchema,
  LiveTextRecordSchema,
  DeepSeekRequestSchema,
  estimateDeepSeekCostMicros,
  deepSeekPriceVersion,
  deepSeekResponseModelMatches,
  type DeepSeekModel,
  type LiveTextResult,
} from "../shared/live-text";
import { PairSchema } from "./quality/contracts";
import { hashValue, pairHash } from "./quality/scoring";
import { checkHardRules } from "./quality/rules";
import { deepSeekSystemPrompt } from "./workflow/deepseek";

const prefix = "live-text-job:";
export class LiveTextService {
  constructor(
    readonly repo: Repository,
    readonly options: { now?: () => Date } = {},
  ) {
    // A process restart cannot establish whether a dispatched HTTP request was charged.
    repo.transaction(() => {
      for (const op of repo
        .all("operations")
        .filter(
          (o) =>
            o.kind === "live_text" &&
            ["dispatching", "unknown"].includes(o.state),
        )) {
        repo.save("operations", {
          ...op,
          state: "unknown",
          costState: "unknown",
          reasons: ["TEXT_INTERRUPTED_DISPATCH"],
        });
        const saved = repo.maybe("settings", prefix + op.jobId);
        if (saved?.job.state === "dispatching")
          repo.save("settings", {
            ...saved,
            job: {
              ...saved.job,
              state: "unknown",
              revision: saved.job.revision + 1,
              reasons: ["TEXT_INTERRUPTED_DISPATCH"],
            },
          });
      }
    });
  }
  now() {
    return (this.options.now?.() ?? new Date()).toISOString();
  }
  private job(id: string): Row {
    return this.repo.get("settings", prefix + id).job;
  }
  private save(job: Row) {
    this.repo.save("settings", { id: prefix + job.id, job });
    return job;
  }
  private profile(id: string, revision: number) {
    const profile = listApiProfiles(this.repo).find((p) => p.id === id);
    if (
      !profile ||
      profile.kind !== "text" ||
      profile.providerId !== "deepseek"
    )
      throw Error("TEXT_PROFILE_REQUIRED");
    if (profile.revision !== revision) throw Error("REVISION_CONFLICT");
    return profile;
  }
  list() {
    return this.repo
      .all("settings")
      .filter((r) => r.id.startsWith(prefix))
      .map((r) => r.job);
  }
  prepare(raw: unknown) {
    const input = LiveTextPrepareSchema.parse(raw),
      requestHash = hashValue(input);
    return this.repo.transaction(() => {
      const prior = this.list().find((j) => j.requestId === input.requestId);
      if (prior) {
        if (prior.requestHash !== requestHash)
          throw Error("IDEMPOTENCY_CONFLICT");
        return prior;
      }
      this.profile(input.profileId, input.expectedProfileRevision);
      const artist = this.repo.get("artists", input.artistId);
      const parent = input.parentDraftId
        ? this.repo.get("drafts", input.parentDraftId)
        : null;
      if (
        parent &&
        (parent.artistId !== input.artistId ||
          (input.seriesId && parent.seriesId !== input.seriesId))
      )
        throw Error("DRAFT_SCOPE");
      if (input.seriesId) {
        const series = this.repo.get("series", input.seriesId);
        if (series.artistId && series.artistId !== input.artistId)
          throw Error("ARTIST_SCOPE");
      }
      const job = this.save({
        id: randomUUID(),
        ...input,
        requestHash,
        revision: 1,
        state: "prepared",
        source: "deepseek-api",
        callCount: 0,
        spentMicros: 0,
        reservedMicros: 0,
        costUnit: "usd_micro_estimate",
        priceVersion: deepSeekPriceVersion,
        draftId: null,
        operationId: null,
        reasons: [],
        artistRevision: artist.revision,
        artistDefaults: artist.defaults ?? {},
        seriesBaseRevision: input.seriesId
          ? (this.repo.maybe("seriesCheckpoints", input.seriesId)?.revision ??
            0)
          : 0,
        createdAt: this.now(),
      });
      this.repo.audit("text.live.prepared", job.id, {
        profileId: input.profileId,
        modelId: input.modelId,
        budgetMicros: input.budgetMicros,
        maxRevisions: input.maxRevisions,
      });
      return job;
    });
  }
  context(id: string) {
    const job = this.job(id),
      operation = job.operationId
        ? this.repo.get("operations", job.operationId)
        : null;
    const currentProfile =
      listApiProfiles(this.repo).find((p) => p.id === job.profileId) ?? null;
    return {
      job,
      operation,
      currentProfile,
      request: operation?.request ?? null,
    };
  }
  claim(raw: unknown) {
    const input = LiveTextClaimSchema.parse(raw);
    return this.repo.transaction(() => {
      const job = this.job(input.id);
      if (job.revision !== input.expectedRevision)
        throw Error("REVISION_CONFLICT");
      if (job.state === "unknown") throw Error("OUTCOME_UNKNOWN");
      if (job.state === "dispatching") throw Error("TEXT_TASK_BUSY");
      if (job.callCount >= job.maxRevisions + 1) throw Error("REVISION_LIMIT");
      if (job.state === "complete" && !input.feedback)
        throw Error("REVISION_FEEDBACK_REQUIRED");
      this.profile(job.profileId, job.expectedProfileRevision);
      if (
        this.repo
          .all("operations")
          .some(
            (o) =>
              o.provider === "deepseek" &&
              o.accountRef === job.profileId &&
              (o.state === "unknown" || o.costState === "unknown"),
          )
      )
        throw Error("PROVIDER_RISK_FROZEN");
      if (
        this.repo
          .all("operations")
          .some(
            (o) =>
              o.provider === "deepseek" &&
              o.accountRef === job.profileId &&
              o.state === "dispatching",
          )
      )
        throw Error("TEXT_PROVIDER_BUSY");
      const parentId = job.draftId ?? job.parentDraftId;
      const parent = parentId ? this.repo.get("drafts", parentId) : null;
      const operationId = randomUUID();
      const request = DeepSeekRequestSchema.parse({
        operationId,
        modelId: job.modelId,
        maxOutputTokens: job.maxOutputTokens,
        messages: [
          { role: "system", content: deepSeekSystemPrompt },
          {
            role: "user",
            content: JSON.stringify({
              instruction: job.instruction,
              artistDefaults: job.artistDefaults,
              previousDraft: parent?.draft ?? null,
              lockedQuotes: job.lockedQuotes,
              feedback:
                input.feedback ?? (job.state === "invalid" ? job.reasons : []),
              localRuleFeedback: parent?.localCheck ?? null,
            }),
          },
        ],
      });
      // Byte count plus fixed framing allowance deliberately overestimates input tokens.
      // The provider usage remains authoritative for the subsequent estimate; never call this an invoice.
      const inputTokenAllowance =
        Buffer.byteLength(JSON.stringify(request.messages), "utf8") + 1024;
      const reservedMicros = estimateDeepSeekCostMicros(
        job.modelId,
        inputTokenAllowance,
        job.maxOutputTokens,
      );
      if (
        reservedMicros >
        job.budgetMicros - job.spentMicros - job.reservedMicros
      )
        throw Error("BUDGET_INSUFFICIENT");
      const operation = {
        id: operationId,
        operationKey: "live-text:" + job.id + ":" + job.callCount,
        kind: "live_text",
        provider: "deepseek",
        source: "deepseek-api",
        accountRef: job.profileId,
        profileRevision: job.expectedProfileRevision,
        jobId: job.id,
        ordinal: job.callCount,
        state: "dispatching",
        costState: "reserved",
        reservedMicros,
        inputTokenAllowance,
        requestedModelId: job.modelId,
        maxOutputTokens: job.maxOutputTokens,
        priceVersion: deepSeekPriceVersion,
        request,
        requestHash: hashValue(request),
        createdAt: this.now(),
      };
      this.repo.save("operations", operation);
      this.ledger(job.id, operationId, "reserve", reservedMicros);
      const updated = this.save({
        ...job,
        state: "dispatching",
        revision: job.revision + 1,
        operationId,
        callCount: job.callCount + 1,
        reservedMicros: job.reservedMicros + reservedMicros,
        reasons: [],
        updatedAt: this.now(),
      });
      this.repo.audit("text.live.claimed", operationId, {
        jobId: job.id,
        reservedMicros,
      });
      return { job: updated, operation, request };
    });
  }
  private ledger(
    jobId: string,
    operationId: string,
    kind: string,
    amount: number,
  ) {
    this.repo.append("workflowLedger", {
      id: randomUUID(),
      eventKey: "live-text:" + operationId + ":" + kind,
      jobId,
      operationId,
      scope: "live_text",
      kind,
      amount,
      unit: "usd_micro_estimate",
      date: this.now().slice(0, 10),
      at: this.now(),
    });
  }
  record(raw: unknown) {
    const input = LiveTextRecordSchema.parse(raw);
    // Recheck at the durable boundary, even if an upstream adapter supplied a cheap estimate.
    const result: LiveTextResult =
      input.result.usage &&
      !deepSeekResponseModelMatches(
        input.result.requestedModelId,
        input.result.providerModel,
      )
        ? {
            ...input.result,
            status: "invalid",
            estimatedCostMicros: null,
            draft: null,
            reasons: [
              ...new Set([
                ...input.result.reasons,
                "TEXT_MODEL_PRICE_UNVERIFIED",
              ]),
            ],
          }
        : input.result;
    return this.repo.transaction(() => {
      const job = this.job(input.id),
        op = this.repo.get("operations", input.operationId);
      if (
        op.kind !== "live_text" ||
        op.jobId !== job.id ||
        result.operationId !== op.id ||
        result.requestedModelId !== op.requestedModelId
      )
        throw Error("TEXT_OPERATION_SCOPE");
      const resultHash = hashValue(result);
      if (op.resultHash) {
        if (op.resultHash !== resultHash) throw Error("IDEMPOTENCY_CONFLICT");
        return job;
      }
      if (job.operationId !== op.id) throw Error("TEXT_OPERATION_SCOPE");
      if (!["dispatching", "unknown"].includes(op.state))
        throw Error("TEXT_RECORD_STATE");
      if (
        result.usage &&
        result.estimatedCostMicros !== null &&
        result.estimatedCostMicros !==
          estimateDeepSeekCostMicros(
            op.requestedModelId as DeepSeekModel,
            result.usage.prompt_tokens,
            result.usage.completion_tokens,
          )
      )
        throw Error("COST_ESTIMATE_MISMATCH");
      const knownCost = result.estimatedCostMicros;
      let draftId = job.draftId,
        state = result.status,
        reasons = [...result.reasons];
      if (result.status === "complete") {
        const text = result
          .draft!.sections.map((s) => `[${s.kind}]\n${s.lines.join("\n")}`)
          .join("\n\n");
        const parentId = job.draftId ?? job.parentDraftId,
          parent = parentId ? this.repo.get("drafts", parentId) : null;
        const previousText = parent
          ? (parent.pair?.lyrics ??
            parseDraft(parent.draft)
              .sections.map((s) => `[${s.kind}]\n${s.lines.join("\n")}`)
              .join("\n\n"))
          : "";
        const lockChanged = job.lockedQuotes.some((quote: string) => {
          const count = (value: string) => value.split(quote).length - 1;
          return count(text) !== Math.max(1, count(previousText));
        });
        if (lockChanged) {
          state = "invalid";
          reasons.push("LOCKED_CONTENT_CHANGED");
        } else {
          const d = this.storeDraft(job, op, result);
          draftId = d.id;
          if (d.localCheck.status === "failed") {
            state = "invalid";
            reasons.push("LOCAL_RULES_FAILED");
          }
        }
      }
      const spentMicros = job.spentMicros + (knownCost ?? 0);
      if (knownCost !== null && spentMicros > job.budgetMicros) {
        state = "invalid";
        reasons.push("BUDGET_ESTIMATE_EXCEEDED");
      }
      this.repo.save("operations", {
        ...op,
        state: result.status,
        costState: knownCost === null ? "unknown" : "estimated",
        result,
        resultHash,
        providerRequestId: result.providerRequestId,
        providerModel: result.providerModel,
        usage: result.usage,
        estimatedCostMicros: knownCost,
        finishReason: result.finishReason,
        reasons,
        completedAt: this.now(),
      });
      if (knownCost !== null) {
        this.ledger(job.id, op.id, "settle", knownCost);
        if (op.reservedMicros > knownCost)
          this.ledger(job.id, op.id, "release", op.reservedMicros - knownCost);
      }
      const updated = this.save({
        ...job,
        state,
        reasons,
        revision: job.revision + 1,
        draftId,
        spentMicros,
        reservedMicros:
          knownCost === null
            ? job.reservedMicros
            : Math.max(0, job.reservedMicros - op.reservedMicros),
        updatedAt: this.now(),
      });
      this.repo.audit("text.live.recorded", op.id, {
        jobId: job.id,
        state,
        estimatedCostMicros: knownCost,
      });
      return updated;
    });
  }
  private storeDraft(job: Row, op: Row, result: LiveTextResult) {
    const draft = parseDraft(result.draft),
      id = randomUUID();
    const lyrics = draft.sections
      .map((s) => `[${s.kind}]\n${s.lines.join("\n")}`)
      .join("\n\n");
    const pair = PairSchema.parse({
      attemptId: job.id,
      revisionId: id,
      parentRevisionId: job.draftId ?? job.parentDraftId,
      lyrics,
      musicPrompt: draft.musicPrompts.yourmusic.positiveStyle,
      intent: job.instruction,
      language: draft.language,
      style: draft.style,
      generator: {
        modelId: result.providerModel!,
        modelVersion: result.providerModel!,
        promptVersion: "deepseek-creative-json-v1",
      },
      lockedSpans: job.lockedQuotes.map((quote: string) => ({
        field: "lyrics",
        start: lyrics.indexOf(quote),
        end: lyrics.indexOf(quote) + quote.length,
        quote,
      })),
      capability: {
        version: "music-target-unverified-v1",
        verified: false,
        lengthUnit: null,
        limits: {},
        requiredFields: draft.instrumental
          ? ["musicPrompt"]
          : ["lyrics", "musicPrompt"],
      },
    });
    const localCheck = checkHardRules(pair, []);
    const row = {
      id,
      turnId: job.id,
      sessionId: job.id,
      artistId: job.artistId,
      seriesId: job.seriesId,
      seriesBaseRevision: job.seriesBaseRevision,
      parentDraftId: job.draftId ?? job.parentDraftId,
      revision: op.ordinal,
      source: "deepseek-api",
      draft,
      pair,
      pairHash: pairHash(pair),
      qualityState: "local_rules_only",
      localCheck,
      provider: "deepseek",
      providerRequestId: result.providerRequestId,
      providerModel: result.providerModel,
      generationOperationId: op.id,
      usage: result.usage,
      at: this.now(),
    };
    this.repo.save("drafts", row);
    return row;
  }
}
