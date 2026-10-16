import { z } from "zod";
import { randomUUID } from "node:crypto";
import { Repository, type Row } from "../database";
import { hashValue, pairHash } from "../quality/scoring";
import type { MusicAdapter } from "./yourmusic";
import { MusicRequestSchema } from "../../shared/music";
export { MusicRequestSchema };
export class MusicService {
  private active = new Set<string>();
  private stopped = false;
  constructor(
    readonly repo: Repository,
    readonly mode: "production" | "simulation",
    readonly options: {
      adapter: MusicAdapter;
      now?: () => Date;
      dailyLimit?: number;
      ingest: (bytes: Buffer, mime: string) => Promise<{ id: string }>;
    },
  ) {
    for (const op of repo
      .all("operations")
      .filter((o) => o.kind === "music" && o.state === "dispatching"))
      repo.save("operations", {
        ...op,
        state: "unknown",
        costState: "unknown",
        reasons: ["INTERRUPTED_SUBMISSION"],
      });
  }
  now() {
    return (this.options.now?.() ?? new Date()).toISOString();
  }
  stop() {
    this.stopped = true;
  }
  private patch(id: string, changes: Row) {
    return this.repo.save("operations", {
      ...this.repo.get("operations", id),
      ...changes,
    });
  }
  private ledger(op: Row, kind: string, amount: number, key: string) {
    this.repo.append("workflowLedger", {
      id: randomUUID(),
      eventKey: key,
      operationId: op.id,
      scope: "music",
      accountRef: op.accountRef,
      kind,
      amount,
      unit: "fixture_credit",
      date: op.budgetDate,
      at: this.now(),
    });
  }
  prepare(raw: z.infer<typeof MusicRequestSchema>) {
    const i = MusicRequestSchema.parse(raw),
      requestHash = hashValue(i);
    return this.repo.transaction(() => {
      const old = this.repo
        .all("operations")
        .find((o) => o.kind === "music" && o.requestId === i.requestId);
      if (old) {
        if (old.requestHash !== requestHash)
          throw Error("IDEMPOTENCY_CONFLICT");
        return old;
      }
      const draft = this.repo.get("drafts", i.draftId);
      if (
        draft.pairHash !== i.expectedPairHash ||
        pairHash(draft.pair) !== i.expectedPairHash
      )
        throw Error("STALE_PAIR");
      const reasons: string[] = [];
      if (this.mode === "production")
        reasons.push(
          "LIVE_EXECUTION_DISABLED",
          "PRICING_PRIVACY_PERMISSION_REQUIRED",
          "CLIENT_KEY_RECONCILIATION_UNVERIFIED",
        );
      if (
        this.mode === "simulation" &&
        this.options.adapter.source !== "fixture"
      )
        reasons.push("SIMULATION_FIXTURE_REQUIRED");
      const evaluation = this.repo
        .all("evaluations")
        .find(
          (e) => e.draftId === draft.id && e.pairHash === i.expectedPairHash,
        );
      if (evaluation?.decision.state !== "pass")
        reasons.push("QUALITY_NOT_PASSED");
      const session = this.repo.maybe("creativeSessions", draft.sessionId);
      if (session && session.draftId !== draft.id)
        reasons.push("DRAFT_NO_LONGER_CURRENT");
      const pending = this.repo
        .all("operations")
        .filter(
          (o) =>
            o.kind === "music" &&
            o.draftId === draft.id &&
            !["blocked", "cancelled"].includes(o.state),
        );
      const reservedCandidates = pending.reduce(
        (n, o) => n + Math.max(2, (o.songIds ?? []).length),
        0,
      );
      if (i.candidateLimit - reservedCandidates < 2)
        reasons.push("TWO_OUTPUTS_REQUIRE_CAPACITY");
      const attemptOperationIds = this.repo
        .all("operations")
        .filter(
          (o) =>
            o.kind === "music" && o.attemptId === (draft.turnId ?? draft.id),
        )
        .map((o) => o.id);
      let attemptUsed = 0;
      for (const e of this.repo
        .all("workflowLedger")
        .filter((e) => attemptOperationIds.includes(e.operationId))) {
        if (e.kind === "reserve") attemptUsed += e.amount;
        if (e.kind === "release") attemptUsed -= e.amount;
      }
      if (i.budgetLimit - attemptUsed < 2) reasons.push("BUDGET_INSUFFICIENT");
      if (
        this.repo
          .all("operations")
          .some(
            (o) =>
              o.kind === "music" &&
              o.accountRef === i.accountRef &&
              (o.state === "unknown" || o.costState === "unknown"),
          )
      )
        reasons.push("PROVIDER_RISK_FROZEN");
      const entries = this.repo
        .all("workflowLedger")
        .filter(
          (e) =>
            e.date === this.now().slice(0, 10) && e.unit === "fixture_credit",
        );
      let used = 0;
      for (const e of entries) {
        if (e.kind === "reserve") used += e.amount;
        if (e.kind === "release") used -= e.amount;
      }
      if (i.budgetLimit < 2 || (this.options.dailyLimit ?? 100) - used < 2)
        reasons.push("BUDGET_INSUFFICIENT");
      if (this.stopped) reasons.push("WORKSPACE_STOPPED");
      const op = {
        id: randomUUID(),
        ...i,
        requestHash,
        operationKey: "music:" + i.requestId,
        kind: "music",
        attemptId: draft.turnId ?? draft.id,
        provider: "yourmusic",
        capabilityVersion: this.options.adapter.capabilities.version,
        mode: this.mode,
        source: this.options.adapter.source,
        state: reasons.length ? "blocked" : "prepared",
        reasons,
        costState: reasons.length ? "not_reserved" : "reserved",
        budgetDate: this.now().slice(0, 10),
        createdAt: this.now(),
        songIds: [],
        maxOutputs: 2,
        maxCost: 2,
        queryErrors: 0,
      };
      this.repo.save("operations", op);
      if (!reasons.length) this.ledger(op, "reserve", 2, op.id + ":reserve");
      return op;
    });
  }
  async submit(id: string) {
    let op = this.repo.get("operations", id);
    if (
      op.kind !== "music" ||
      op.state !== "prepared" ||
      this.active.has(id) ||
      this.stopped
    )
      return op;
    const frozen = this.repo
      .all("operations")
      .some(
        (o) =>
          o.id !== id &&
          o.kind === "music" &&
          o.accountRef === op.accountRef &&
          (o.state === "unknown" || o.costState === "unknown"),
      );
    if (frozen)
      return this.repo.transaction(() => {
        this.ledger(op, "release", 2, op.id + ":release");
        return this.patch(id, {
          state: "blocked",
          costState: "not_dispatched",
          reasons: ["PROVIDER_RISK_FROZEN"],
        });
      });
    const today = this.now().slice(0, 10);
    if (op.budgetDate !== today) {
      const moved = this.repo.transaction(() => {
        this.ledger(
          op,
          "release",
          2,
          id + ":rollover:" + op.budgetDate + ":release",
        );
        let used = 0;
        for (const e of this.repo
          .all("workflowLedger")
          .filter((e) => e.date === today && e.unit === "fixture_credit")) {
          if (e.kind === "reserve") used += e.amount;
          if (e.kind === "release") used -= e.amount;
        }
        if ((this.options.dailyLimit ?? 100) - used < 2) {
          this.patch(id, {
            state: "blocked",
            costState: "not_dispatched",
            reasons: ["BUDGET_DAY_CHANGED", "BUDGET_INSUFFICIENT"],
          });
          return false;
        }
        op = this.patch(id, { budgetDate: today });
        this.ledger(op, "reserve", 2, id + ":rollover:" + today + ":reserve");
        return true;
      });
      if (!moved) return this.repo.get("operations", id);
    }
    this.active.add(id);
    this.patch(id, { state: "dispatching" });
    try {
      let r;
      try {
        r = await this.options.adapter.submit({
          draft: this.repo.get("drafts", op.draftId).draft,
          modelId: op.modelId,
          operationId: id,
        });
      } catch {
        r = { state: "unknown" };
      }
      if (!this.repo.db.open) return;
      if (this.stopped)
        return this.patch(id, {
          state: "unknown",
          costState: "unknown",
          reasons: ["WORKSPACE_CHANGED"],
        });
      if (
        r.state !== "accepted" ||
        !Array.isArray(r.songIds) ||
        !r.songIds.length
      )
        return this.patch(id, {
          state: "unknown",
          costState: "unknown",
          reasons: ["SUBMISSION_OUTCOME_UNKNOWN"],
        });
      this.repo.transaction(() => {
        const costKnown =
          this.options.adapter.source === "fixture" &&
          Number.isSafeInteger(r.actualCost) &&
          r.actualCost >= 0 &&
          r.actualCost <= 2 &&
          r.evidenceId;
        op = this.patch(id, {
          state: "accepted",
          trackingId: r.trackingId,
          songIds: r.songIds,
          costState: costKnown ? "settled" : "unknown",
          reasons: r.songIds.length > 2 ? ["OUTPUT_BOUND_EXCEEDED"] : [],
          overrun: r.songIds.length > 2,
          nextCheckAt: this.now(),
        });
        if (costKnown) {
          this.ledger(
            op,
            "settle",
            r.actualCost,
            op.id + ":settle:" + r.evidenceId,
          );
          if (r.actualCost < 2)
            this.ledger(op, "release", 2 - r.actualCost, op.id + ":release");
        }
        for (const [ordinal, songId] of r.songIds.entries()) {
          const outputIdentity = hashValue({
            mode: this.mode,
            provider: "yourmusic",
            accountRef: op.accountRef,
            songId,
          });
          if (
            !this.repo
              .all("candidates")
              .some((c) => c.outputIdentity === outputIdentity)
          )
            this.repo.save("candidates", {
              id: randomUUID(),
              outputIdentity,
              operationId: id,
              draftId: op.draftId,
              artistId: this.repo.get("drafts", op.draftId).artistId,
              seriesId: this.repo.get("drafts", op.draftId).seriesId ?? null,
              planId: this.repo.get("drafts", op.draftId).planId ?? null,
              provider: "yourmusic",
              providerOutputId: songId,
              accountRef: op.accountRef,
              ordinal,
              source: this.options.adapter.source,
              state: "pending",
              downloadAttempts: 0,
              assetId: null,
            });
        }
      });
      return op;
    } finally {
      this.active.delete(id);
    }
  }
  async reconcile(id: string) {
    let op = this.repo.get("operations", id);
    if (
      !["accepted", "polling", "download_failed"].includes(op.state) ||
      this.active.has(id) ||
      this.stopped ||
      op.nextCheckAt > this.now()
    )
      return op;
    if (
      new Date(this.now()).getTime() - new Date(op.createdAt).getTime() >
        86400000 ||
      op.queryErrors >= 5
    )
      return this.patch(id, {
        state: "reconcile_required",
        reasons: ["TRACKING_LIMIT"],
      });
    this.active.add(id);
    try {
      const r = await this.options.adapter.query(op.songIds);
      if (!this.repo.db.open || this.stopped) return;
      if (r.state !== "known") {
        return this.patch(id, {
          state: "polling",
          queryErrors: r.state === "error" ? op.queryErrors + 1 : 0,
          nextCheckAt: new Date(
            new Date(this.now()).getTime() + 15000,
          ).toISOString(),
          reasons: [
            r.state === "pending"
              ? "REMOTE_NOT_YET_VISIBLE"
              : "QUERY_RETRY_WAIT",
          ],
        });
      }
      if (
        !Array.isArray(r.songs) ||
        r.songs.some((s: any) => !op.songIds.includes(s.id))
      )
        return this.patch(id, {
          state: "reconcile_required",
          reasons: ["OUTPUT_ID_MISMATCH"],
        });
      for (const song of r.songs) {
        let candidate = this.repo
          .all("candidates")
          .find((c) => c.operationId === id && c.providerOutputId === song.id);
        if (!candidate || candidate.state === "ready") continue;
        if (song.status === "failed") {
          this.repo.save("candidates", {
            ...candidate,
            state: "failed",
            reason: "REMOTE_TERMINAL_FAILED_COST_SEPARATE",
          });
          continue;
        }
        if (song.status !== "succeeded" || !song.audio_url) continue;
        if (candidate.downloadAttempts >= 4) continue;
        candidate = {
          ...candidate,
          state: "downloading",
          downloadAttempts: candidate.downloadAttempts + 1,
        };
        this.repo.save("candidates", candidate);
        try {
          const audio = await this.options.adapter.download(song.audio_url);
          if (this.stopped || !this.repo.db.open) return;
          const asset = await this.options.ingest(audio.bytes, audio.mime);
          if (this.stopped || !this.repo.db.open) return;
          this.repo.save("candidates", {
            ...candidate,
            state: "ready",
            assetId: asset.id,
            readyAt: this.now(),
          });
        } catch {
          if (this.repo.db.open)
            this.repo.save("candidates", {
              ...candidate,
              state: "download_failed",
              reason: "DOWNLOAD_OR_AUDIO_VALIDATION_FAILED",
            });
        }
      }
      const candidates = this.repo
          .all("candidates")
          .filter((c) => c.operationId === id),
        done =
          candidates.length === op.songIds.length &&
          candidates.every((c) => ["ready", "failed"].includes(c.state));
      return this.patch(id, {
        state: done ? "assets_verified" : "polling",
        queryErrors: 0,
        nextCheckAt: new Date(
          new Date(this.now()).getTime() + 15000,
        ).toISOString(),
        reasons: done ? [] : ["OUTPUTS_PENDING_OR_DOWNLOAD_FAILED"],
      });
    } catch {
      return this.repo.db.open
        ? this.patch(id, {
            state: "polling",
            queryErrors: op.queryErrors + 1,
            nextCheckAt: new Date(
              new Date(this.now()).getTime() + 15000,
            ).toISOString(),
          })
        : undefined;
    } finally {
      this.active.delete(id);
    }
  }
}
