import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  TmeDraft,
  TmeIdentity,
  TmeLiveUnit,
  TmeLiveReceipt,
} from "../../shared/tme";
export type WindowBinding = {
  pid: number;
  handle: string;
  started: string;
  account: string;
};
export type LiveSnapshot = {
  binding: WindowBinding;
  url: string;
  mode: "album" | "intake" | "authorization" | "success" | "other";
  albumId: string | null;
  rows: {
    title: string;
    songId: string | null;
    status: TmeLiveReceipt["status"];
    reason: string;
  }[];
  form: { title: string; audioName?: string; lyrics?: string } | null;
  agreement: { text: string; modeText: string; checked: boolean } | null;
  submission?: { success: boolean; status: "reviewing" | "unknown" };
};
export interface LiveTransport {
  writeBlockReason?(snapshot: LiveSnapshot): string | null;
  interrupt?(): void;
  dispose?(): void;
  preflight?(d: TmeDraft, b: WindowBinding): string | null;
  observe(
    binding?: WindowBinding,
    expectedAccount?: string,
  ): Promise<LiveSnapshot>;
  stage(d: TmeDraft, b: WindowBinding): Promise<LiveSnapshot>;
  accept(
    d: TmeDraft,
    b: WindowBinding,
    contractHash: string,
  ): Promise<LiveSnapshot>;
  submit(
    d: TmeDraft,
    b: WindowBinding,
    contractHash: string,
  ): Promise<LiveSnapshot>;
}
export interface LiveStore {
  units(batchId?: string): Promise<TmeLiveUnit[]>;
  batches(): Promise<any[]>;
  get(id: string): Promise<TmeDraft>;
  assertCurrent(d: TmeDraft): Promise<void>;
  updateUnit(id: string, p: Partial<TmeLiveUnit>): Promise<TmeLiveUnit>;
  updateBatch(
    id: string,
    p: { state?: string; cancelled?: boolean },
  ): Promise<any>;
  claim(id: string, i: TmeIdentity): Promise<TmeLiveUnit>;
  start(id: string): Promise<TmeLiveUnit>;
}
const key = z.string().min(1).max(100);
export const LiveInspectSchema = z.strictObject({
  expectedAccount: z.string().trim().min(1).max(100),
  accountId: key,
});
export const LiveBatchSchema = z.strictObject({
  batchId: key,
  confirmed: z.literal(true),
});
export const LiveUnitSchema = z.strictObject({ unitId: key });
export const LiveActSchema = z.strictObject({
  unitId: key,
  action: z.enum(["accept", "submit"]),
  permit: z.uuid(),
  reviewHash: z.string().length(64),
  confirmed: z.literal(true),
});
export const LiveCancelSchema = z.strictObject({ batchId: key });
export const LiveSyncSchema = z.strictObject({
  title: z.string().min(1).max(60),
  albumId: z.string().regex(/^\d+$/).max(20),
});
export const agreementHash = (s: LiveSnapshot) =>
  createHash("sha256")
    .update(JSON.stringify([s.agreement?.text, s.agreement?.modeText]))
    .digest("hex");
const sameWindow = (a: WindowBinding, b: WindowBinding) =>
  a.pid === b.pid &&
  a.handle === b.handle &&
  a.started === b.started &&
  a.account === b.account;
export class TmeLiveManager {
  private binding?: WindowBinding;
  private accountId = "";
  private identity?: TmeIdentity;
  private busy = false;
  private cancelled = new Set<string>();
  private permit?: {
    token: string;
    unitId: string;
    action: "accept" | "submit";
    hash: string;
    reviewHash: string;
    expires: number;
  };
  constructor(
    private store: LiveStore,
    private port: LiveTransport,
    private device: string,
  ) {}
  isBusy() {
    return this.busy;
  }
  invalidate() {
    this.port.interrupt?.();
    this.binding = undefined;
    this.identity = undefined;
    this.permit = undefined;
  }
  dispose() {
    this.invalidate();
    this.port.dispose?.();
  }
  private async exclusive<T>(fn: () => Promise<T>) {
    if (this.busy) throw Error("TME_BUSY");
    this.busy = true;
    try {
      return await fn();
    } finally {
      this.busy = false;
    }
  }
  async inspect(raw: unknown) {
    return this.exclusive(async () => {
      const v = LiveInspectSchema.parse(raw);
      this.invalidate();
      const s = await this.port.observe(undefined, v.expectedAccount);
      if (s.binding.account !== v.expectedAccount)
        throw Error("ACCOUNT_CHANGED");
      this.validateOrigin(s);
      this.binding = s.binding;
      this.accountId = v.accountId;
      this.identity = {
        subject: "visible:" + s.binding.account,
        displayName: s.binding.account,
        device: this.device,
        session: randomUUID(),
        source: "browser",
      };
      return {
        connected: true,
        transport: "windows_uia",
        identity: this.identity,
        snapshot: s,
        identityBasis: "visible_nickname_window",
        writeAllowed: !this.port.writeBlockReason?.(s),
        writeBlockReason: this.port.writeBlockReason?.(s) || null,
        reason: "VISIBLE_IDENTITY_NOT_PROVIDER_ID",
      };
    });
  }
  private validateOrigin(s: LiveSnapshot) {
    if (new URL(s.url).origin !== "https://y.tencentmusic.com")
      throw Error("TME_ORIGIN_REQUIRED");
  }
  private assertWritable(s: LiveSnapshot) {
    const reason = this.port.writeBlockReason?.(s);
    if (reason) throw Error(reason);
  }
  private async observe() {
    if (!this.binding || !this.identity) throw Error("WINDOW_BINDING_REQUIRED");
    const s = await this.port.observe(this.binding);
    this.validateOrigin(s);
    if (!sameWindow(this.binding, s.binding)) throw Error("ACCOUNT_CHANGED");
    return s;
  }
  private async unit(id: string, readOnly = false) {
    const u = (await this.store.units()).find((u) => u.id === id);
    if (!u || !u.draftId) throw Error("TME_UNIT_REQUIRED");
    if (u.accountId !== this.accountId) throw Error("ACCOUNT_CHANGED");
    const d = await this.store.get(u.draftId);
    await this.store.assertCurrent(d);
    if (
      d.source !== "local" ||
      d.reviewHash !== u.reviewHash ||
      d.issues.length
    )
      throw Error("REVIEW_STALE");
    if (u.identity && u.identity.subject !== this.identity?.subject)
      throw Error("ACCOUNT_CHANGED");
    if (
      !readOnly &&
      u.identity &&
      u.identity.session !== this.identity?.session
    )
      throw Error("SESSION_REBIND_REQUIRES_READBACK");
    return { u, d };
  }
  private assertSong(s: LiveSnapshot, d: TmeDraft) {
    if (s.albumId !== d.metadata.albumId) throw Error("ALBUM_CHANGED");
    if (s.form?.title !== d.title) throw Error("FORM_WORK_MISMATCH");
  }
  private receipt(
    s: LiveSnapshot,
    title: string,
    albumId: string,
    byClient = false,
  ): TmeLiveReceipt | null {
    if (s.albumId !== albumId) return null;
    const rows = s.rows.filter((r) => r.title === title);
    if (rows.length !== 1) return null;
    const r = rows[0];
    return {
      albumId,
      songId: r.songId || null,
      title,
      status: r.status,
      reason: r.reason || "",
      observedAt: new Date().toISOString(),
      route: new URL(s.url).hash,
      source: "windows_uia",
      match: "visible_title_album",
      submissionByClient: byClient,
    };
  }
  async sync(raw: unknown) {
    return this.exclusive(async () => {
      const v = LiveSyncSchema.parse(raw),
        s = await this.observe();
      const receipt = this.receipt(s, v.title, v.albumId);
      return {
        receipt,
        reason: receipt ? "VISIBLE_ROW_OBSERVED" : "VISIBLE_ROW_NOT_FOUND",
        snapshot: s,
      };
    });
  }
  async runBatch(raw: unknown) {
    const v = LiveBatchSchema.parse(raw);
    return this.exclusive(async () => {
      this.assertWritable(await this.observe());
      const batch = (await this.store.batches()).find(
        (b) => b.id === v.batchId,
      );
      if (!batch) throw Error("TME_BATCH_REQUIRED");
      if (batch.accountId !== this.accountId) throw Error("ACCOUNT_CHANGED");
      if (batch.cancelled || this.cancelled.has(batch.id))
        throw Error("BATCH_CANCELLED");
      const units = await this.store.units(batch.id);
      if (
        units.some(
          (u) =>
            u.pendingAction ||
            [
              "TME_AWAITING_AUTHORIZATION",
              "TME_AWAITING_SUBMIT",
              "TME_RECONCILE_REQUIRED",
            ].includes(u.state),
        )
      )
        return { state: "TME_NEEDS_ACTION" };
      await this.store.updateBatch(batch.id, { state: "TME_RUNNING" });
      for (const initial of units) {
        if (this.cancelled.has(batch.id)) break;
        if (initial.state !== "TME_READY") continue;
        const { u, d } = await this.unit(initial.id);
        const s = await this.observe();
        if (s.albumId !== d.metadata.albumId) {
          await this.store.updateUnit(u.id, {
            state: "TME_BLOCKED",
            reason: "ALBUM_CHANGED",
          });
          continue;
        }
        const prior = this.receipt(s, d.title, d.metadata.albumId!);
        if (prior) {
          await this.store.updateUnit(u.id, {
            state: "TME_OBSERVED_EXISTING",
            receipt: prior,
            reason: "VISIBLE_ROW_REQUIRES_MANUAL_RECORDING_MATCH",
          });
          continue;
        }
        if (!["album", "intake"].includes(s.mode)) {
          await this.store.updateUnit(u.id, {
            state: "TME_BLOCKED",
            reason: "INTAKE_REQUIRED",
          });
          continue;
        }
        const issue = this.port.preflight?.(d, this.binding!);
        if (issue) {
          await this.store.updateUnit(u.id, {
            state: "TME_BLOCKED",
            reason: issue,
          });
          continue;
        }
        try {
          await this.store.claim(u.id, this.identity!);
        } catch (e) {
          if ((e as Error).message !== "DUPLICATE_REMOTE_RECORDING") throw e;
          await this.store.updateUnit(u.id, {
            state: "TME_BLOCKED",
            reason: "DUPLICATE_REMOTE_RECORDING",
          });
          continue;
        }
        if (this.cancelled.has(batch.id)) break;
        try {
          await this.store.start(u.id);
        } catch (e) {
          if ((e as Error).message === "BATCH_CANCELLED") break;
          throw e;
        }
        try {
          await this.observe();
          await this.store.assertCurrent(d);
          const staged = await this.port.stage(d, this.binding!);
          this.validateOrigin(staged);
          if (!sameWindow(this.binding!, staged.binding))
            throw Error("ACCOUNT_CHANGED");
          this.assertSong(staged, d);
          if (!["intake", "authorization"].includes(staged.mode))
            throw Error("FORM_READBACK_REQUIRED");
          await this.store.updateUnit(u.id, {
            state: "TME_AWAITING_AUTHORIZATION",
            pendingAction: null,
            reason: staged.agreement
              ? "PER_SONG_AUTHORIZATION_REQUIRED"
              : "CONTINUE_OFFICIAL_FORM_SELECT_AUTHORIZATION",
            ...(staged.agreement
              ? { contractHash: agreementHash(staged) }
              : {}),
          });
        } catch (e) {
          await this.store.updateUnit(u.id, {
            state: "TME_RECONCILE_REQUIRED",
            reason: this.code(e),
          });
        }
        break; // The current form belongs to one song until its separate decisions are complete.
      }
      await this.store.updateBatch(batch.id, {
        state: this.cancelled.has(batch.id)
          ? "TME_CANCELLED"
          : "TME_NEEDS_ACTION",
      });
      return { state: "TME_NEEDS_ACTION" };
    });
  }
  async cancel(raw: unknown) {
    const v = LiveCancelSchema.parse(raw);
    this.cancelled.add(v.batchId);
    this.permit = undefined;
    return this.store.updateBatch(v.batchId, {
      state: "TME_CANCELLED",
      cancelled: true,
    });
  }
  async review(raw: unknown) {
    const v = LiveUnitSchema.parse(raw);
    return this.exclusive(async () => {
      this.permit = undefined;
      const { u, d } = await this.unit(v.unitId),
        s = await this.observe();
      this.assertWritable(s);
      this.assertSong(s, d);
      if (
        u.pendingAction ||
        !["TME_AWAITING_AUTHORIZATION", "TME_AWAITING_SUBMIT"].includes(
          u.state,
        ) ||
        s.mode !== "authorization" ||
        !s.agreement?.text
      )
        throw Error("AUTHORIZATION_READBACK_REQUIRED");
      const hash = agreementHash(s),
        action =
          u.acceptedContractHash === hash && s.agreement.checked
            ? "submit"
            : "accept";
      const token = randomUUID();
      this.permit = {
        token,
        unitId: u.id,
        action,
        hash,
        reviewHash: d.reviewHash,
        expires: Date.now() + 5 * 60000,
      };
      return {
        unitId: u.id,
        title: d.title,
        albumId: d.metadata.albumId,
        reviewHash: d.reviewHash,
        contractHash: hash,
        agreement: s.agreement,
        action,
        permit: token,
        expiresAt: new Date(this.permit.expires).toISOString(),
      };
    });
  }
  async act(raw: unknown) {
    const v = LiveActSchema.parse(raw);
    return this.exclusive(async () => {
      const p = this.permit;
      this.permit = undefined;
      if (
        !p ||
        p.token !== v.permit ||
        p.unitId !== v.unitId ||
        p.action !== v.action ||
        p.reviewHash !== v.reviewHash ||
        p.expires < Date.now()
      )
        throw Error("ACTION_PERMIT_REQUIRED");
      const { u, d } = await this.unit(v.unitId);
      if (
        (await this.store.batches()).find((b) => b.id === u.batchId)?.cancelled
      )
        throw Error("BATCH_CANCELLED");
      const s = await this.observe();
      this.assertWritable(s);
      this.assertSong(s, d);
      if (
        s.mode !== "authorization" ||
        agreementHash(s) !== p.hash ||
        !s.agreement?.text
      )
        throw Error("AGREEMENT_CHANGED");
      if (
        v.action === "submit" &&
        (u.acceptedContractHash !== p.hash || !s.agreement.checked)
      )
        throw Error("SEPARATE_AUTHORIZATION_REQUIRED");
      await this.store.updateUnit(u.id, {
        state: v.action === "accept" ? "TME_ACCEPTING" : "TME_SUBMITTING",
        pendingAction: v.action,
      });
      try {
        await this.store.assertCurrent(d);
        const r = await this.port[v.action](d, this.binding!, p.hash);
        this.validateOrigin(r);
        if (!sameWindow(this.binding!, r.binding))
          throw Error("ACCOUNT_CHANGED");
        if (v.action === "accept") {
          this.assertSong(r, d);
          if (agreementHash(r) !== p.hash || !r.agreement?.checked)
            throw Error("ACCEPTANCE_READBACK_REQUIRED");
          return await this.store.updateUnit(u.id, {
            state: "TME_AWAITING_SUBMIT",
            pendingAction: null,
            acceptedContractHash: p.hash,
            reason: "SEPARATE_SUBMISSION_REQUIRED",
          });
        }
        const receipt: TmeLiveReceipt | null =
          r.mode === "success" && r.submission?.success
            ? {
                albumId: d.metadata.albumId!,
                songId: null,
                title: d.title,
                status: r.submission.status,
                reason: "",
                observedAt: new Date().toISOString(),
                route: new URL(r.url).hash,
                source: "windows_uia",
                match: "owned_submission_success",
                submissionByClient: true,
              }
            : this.receipt(r, d.title, d.metadata.albumId!, false);
        if (!receipt || receipt.status === "unknown")
          throw Error("SUBMISSION_READBACK_REQUIRED");
        return await this.store.updateUnit(u.id, {
          state: "TME_" + receipt.status.toUpperCase(),
          pendingAction: null,
          receipt,
          reason: receipt.reason,
        });
      } catch (e) {
        return this.store.updateUnit(u.id, {
          state: "TME_RECONCILE_REQUIRED",
          reason: this.code(e),
        });
      }
    });
  }
  async reconcile(raw: unknown) {
    const v = LiveUnitSchema.parse(raw);
    return this.exclusive(async () => {
      const { u, d } = await this.unit(v.unitId, true),
        s = await this.observe(),
        receipt = this.receipt(s, d.title, d.metadata.albumId!);
      if (receipt && receipt.status !== "unknown")
        return this.store.updateUnit(u.id, {
          state: "TME_OBSERVED_EXISTING",
          receipt,
          pendingAction: null,
          reason: "VISIBLE_ROW_REQUIRES_MANUAL_RECORDING_MATCH",
        });
      return this.store.updateUnit(u.id, {
        state: "TME_RECONCILE_REQUIRED",
        reason: "REMOTE_STATE_UNKNOWN",
      });
    });
  }
  private code(e: unknown) {
    return e instanceof Error && /^[A-Z0-9_]+$/.test(e.message)
      ? e.message
      : "UIA_OPERATION_FAILED";
  }
}
