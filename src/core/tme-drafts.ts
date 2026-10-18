import { randomUUID } from "node:crypto";
import type { Studio } from "./studio";
import { hash } from "./database";
import {
  TmeInputSchema,
  type TmeInput,
  type TmeAsset,
  type TmeDraft,
  type TmeIdentity,
  type TmeLiveUnit,
} from "../shared/tme";
import { cleanLyricText } from "../shared/tme-lyrics";
import { publicationPayload } from "./publication-payload";
const prefix = "tme-draft:";
const inFlight = ["CHECKING", "FILLING", "UPLOADING", "SAVING"];
export function cleanTmeLyrics(raw: string) {
  const result = cleanLyricText(raw);
  return { ...result, hash: hash(result.cleaned) };
}
export class TmeDraftService {
  constructor(private s: Studio) {
    for (const u of this.batchUnits())
      if (u.state === "TME_RESERVED")
        this.s.repo.transaction(() =>
          this.releaseUnstarted(u, "RESERVATION_RECOVERED_NO_EXTERNAL_ACTION"),
        );
    for (const u of this.batchUnits())
      if (
        u.pendingAction ||
        ["TME_STAGING", "TME_ACCEPTING", "TME_SUBMITTING"].includes(u.state)
      )
        this.updateUnit(u.id, {
          state: "TME_RECONCILE_REQUIRED",
          reason: "INTERRUPTED_CHECK_REMOTE_FIRST",
        });
    for (const d of this.list())
      if (inFlight.includes(d.state))
        this.update(d.id, d.revision, {
          state: "RECONCILE_REQUIRED",
          reason: "INTERRUPTED_CHECK_REMOTE_FIRST",
        });
  }
  list(): TmeDraft[] {
    return this.s
      .all("settings")
      .filter((r) => r.kind === "tme-draft" && r.id.startsWith(prefix))
      .map((r) => r.draft);
  }
  get(id: string): TmeDraft {
    return this.s.get("settings", prefix + id).draft;
  }
  assertCurrent(d: TmeDraft) {
    const w = this.s.get("works", d.workId);
    if (
      w.revision !== d.workRevision ||
      w.assets.audio_A !== d.assets.audio?.id ||
      (d.metadata.coverPolicy !== "preserve_album" &&
        w.assets.cover !== d.assets.cover?.id)
    )
      throw Error("WORK_SNAPSHOT_CHANGED");
    for (const a of Object.values(d.assets))
      if (a) {
        const current = this.s.get("assets", a.id);
        this.s.locate(a.id);
        if (current.sha256 !== a.sha256) throw Error("ASSET_HASH_CHANGED");
      }
  }
  bind(id: string, revision: number, identity: TmeIdentity) {
    return this.s.repo.transaction(() => {
      const d = this.get(id);
      this.assertCurrent(d);
      if (
        this.list().some(
          (other) =>
            other.id !== d.id &&
            other.identity?.subject === identity.subject &&
            other.identity.source === identity.source &&
            other.assets.audio?.sha256 === d.assets.audio?.sha256,
        )
      )
        throw Error("DUPLICATE_REMOTE_RECORDING");
      if (
        d.identity &&
        (d.identity.subject !== identity.subject ||
          d.identity.source !== identity.source)
      )
        throw Error("ACCOUNT_CHANGED");
      return this.update(id, revision, { identity, state: "CHECKING" });
    });
  }
  private write(d: TmeDraft) {
    this.s.save("settings", { id: prefix + d.id, kind: "tme-draft", draft: d });
    return d;
  }
  preview(raw: TmeInput) {
    const v = TmeInputSchema.parse(raw),
      w = this.s.get("works", v.workId),
      issues: string[] = [];
    const a = this.s.repo.maybe("accounts", v.accountId);
    if (!a || !["tme", "qqmusic", "kugou"].includes(a.provider))
      issues.push("ACCOUNT_REQUIRED");
    const asset = (id: string | undefined, role: string): TmeAsset | null => {
      if (!id) {
        issues.push(role + "_MISSING");
        return null;
      }
      try {
        const a = this.s.get("assets", id),
          f = this.s.locate(id);
        if (
          (role === "AUDIO" && !a.mime.startsWith("audio/")) ||
          (role === "COVER" && !a.mime.startsWith("image/"))
        )
          throw Error("MIME");
        return {
          id: a.id,
          sha256: a.sha256,
          mime: a.mime,
          bytes: a.bytes,
          file: f.file,
        };
      } catch {
        issues.push("ASSET_INVALID");
        return null;
      }
    };
    const assets = {
      audio: asset(w.assets.audio_A, "AUDIO"),
      cover:
        v.metadata.coverPolicy === "preserve_album"
          ? null
          : asset(w.assets.cover, "COVER"),
      proof:
        v.metadata.coverPolicy === "preserve_album" && !v.metadata.proofAssetId
          ? null
          : asset(v.metadata.proofAssetId, "PROOF"),
    };
    if (v.metadata.coverPolicy === "preserve_album" && !v.metadata.albumId)
      issues.push("ALBUM_REQUIRED");
    const m = {
        version: "完整版" as const,
        allowCover: false,
        ...v.metadata,
        genre:v.metadata.genre?.trim()||'流行',
        language:v.metadata.language?.trim()||'国语',
      },
      n = [...m.lyrics].length,
      statement = [...m.statement].length;
    if (n < 10 || n > 20000) issues.push("LYRICS_LENGTH");
    if (statement !== 0 && (statement < 5 || statement > 300))
      issues.push("STATEMENT_LENGTH");
    if (!m.lyricist.trim() || !m.composer.trim()) issues.push("AUTHOR_NAMES");
    if (m.ownComposer === null || m.ownLyricist === null)
      issues.push("AUTHOR_IDENTITY");
    if (m.aiMusic === "unknown") issues.push("AI_UNKNOWN");
    if (m.aiMusic === "yes") {
      if (!m.aiTool.trim()) issues.push("AI_TOOL");
      const date = new Date(m.generatedOn + "T00:00:00Z");
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(m.generatedOn) ||
        Number.isNaN(date.getTime()) ||
        date.toISOString().slice(0, 10) !== m.generatedOn ||
        m.generatedOn > this.s.now().toISOString().slice(0, 10)
      )
        issues.push("AI_DATE");
    }
    const clean = cleanTmeLyrics(w.lyrics),
      reviewHash = hash({
        workId: w.id,
        revision: w.revision,
        accountId: v.accountId,
        title: w.title,
        assets,
        metadata: m,
      });
    return {
      work: w,
      metadata: m,
      assets,
      audio: assets.audio,
      clean,
      lyricsHash: hash(m.lyrics),
      reviewHash,
      issues,
    };
  }
  prepare(raw: TmeInput): TmeDraft {
    const v = TmeInputSchema.parse(raw),
      p = this.preview(v),
      c = v.confirmations,
      issues = [...p.issues];
    if (!c.rights) issues.push("RIGHTS_CONFIRMATION");
    if (!c.authors) issues.push("AUTHOR_CONFIRMATION");
    if (!c.ai) issues.push("AI_CONFIRMATION");
    if (c.lyricsHash !== p.lyricsHash) issues.push("LYRICS_CONFIRMATION");
    if (!p.audio || c.recordingHash !== p.audio.sha256)
      issues.push("AUDIO_MATCH_CONFIRMATION");
    if (c.reviewHash !== p.reviewHash) issues.push("REVIEW_STALE");
    const recordingKey = hash([v.accountId, p.audio?.sha256 || p.work.id]);
    return this.s.repo.transaction(() => {
      const existing = this.list().find((d) => d.recordingKey === recordingKey);
      if (
        existing &&
        (existing.identity ||
          existing.remote ||
          existing.pendingAction ||
          Object.keys(existing.uploads).length)
      )
        return existing;
      if (
        existing &&
        (!["BLOCKED", "AWAITING_ACCOUNT"].includes(existing.state) ||
          (existing.reviewHash === p.reviewHash &&
            JSON.stringify(existing.issues) === JSON.stringify(issues)))
      )
        return existing;
      const now = this.s.now().toISOString();
      const payload = publicationPayload(this.s, p.work),
        originalLyrics = payload.lyrics;
      const aligned =
        !issues.includes("LYRICS_CONFIRMATION") &&
        !issues.includes("AUDIO_MATCH_CONFIRMATION");
      if (v.metadata.lyrics !== originalLyrics.plainText) {
        const version = this.s
          .lyricService()
          .publicationVersion(p.work, v.metadata.lyrics);
        payload.lyrics = {
          ...originalLyrics,
          versionId: version.id,
          source: version.source,
          raw: version.raw,
          plainText: v.metadata.lyrics,
          plainHash: version.plainHash,
          alignmentConfirmed: aligned,
        };
      } else
        payload.lyrics = { ...originalLyrics, alignmentConfirmed: aligned };
      payload.warnings = payload.warnings.filter(
        (code) =>
          ![
            "LYRICS_AUDIO_MATCH_UNCONFIRMED",
            "LYRICS_MISSING",
            "LYRICS_BRACKETS_REQUIRE_REVIEW",
          ].includes(code),
      );
      if (!payload.lyrics.plainText.trim())
        payload.warnings.push("LYRICS_MISSING");
      if (!aligned) payload.warnings.push("LYRICS_AUDIO_MATCH_UNCONFIRMED");
      if (cleanTmeLyrics(v.metadata.lyrics).warnings.length)
        payload.warnings.push("LYRICS_BRACKETS_REQUIRE_REVIEW");
      const d: TmeDraft = {
        id: existing?.id || randomUUID(),
        revision: (existing?.revision || 0) + 1,
        workId: p.work.id,
        workRevision: p.work.revision,
        accountId: v.accountId,
        title: p.work.title,
        source: this.s.mode === "simulation" ? "fixture" : "local",
        state: issues.length ? "BLOCKED" : "AWAITING_ACCOUNT",
        issues,
        originalLyrics: p.work.lyrics,
        originalPrompt: p.work.prompt,
        metadata: p.metadata,
        publicationPayload: { ...payload, originalLyrics },
        reviewHash: p.reviewHash,
        recordingKey,
        fingerprint: hash([recordingKey, p.reviewHash]),
        assets: p.assets,
        identity: null,
        remote: null,
        uploads: {},
        pendingAction: null,
        reason: "",
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };
      this.write(d);
      this.s.repo.audit("tme.prepare", d.id, { state: d.state });
      return d;
    });
  }
  update(
    id: string,
    expectedRevision: number,
    patch: Partial<
      Pick<
        TmeDraft,
        | "state"
        | "identity"
        | "remote"
        | "uploads"
        | "pendingAction"
        | "reason"
        | "live"
      >
    >,
  ): TmeDraft {
    return this.s.repo.transaction(() => {
      const d = this.get(id);
      if (d.revision !== expectedRevision) throw Error("REVISION_CONFLICT");
      return this.write({
        ...d,
        ...patch,
        revision: d.revision + 1,
        updatedAt: this.s.now().toISOString(),
      });
    });
  }
  batchUnits(batchId?: string): TmeLiveUnit[] {
    return this.s
      .all("units")
      .filter(
        (u) => u.kind === "tme_uia" && (!batchId || u.batchId === batchId),
      ) as TmeLiveUnit[];
  }
  batches() {
    return this.s.all("batches").filter((b) => b.kind === "tme_uia");
  }
  planBatch(v: { workIds: string[]; accountId: string }) {
    if (this.s.mode !== "production") throw Error("PRODUCTION_REQUIRED");
    if (!v.workIds.length || v.workIds.length > 100) throw Error("BATCH_LIMIT");
    const account = this.s.get("accounts", v.accountId);
    if (!["tme", "qqmusic", "kugou"].includes(account.provider))
      throw Error("ACCOUNT_REQUIRED");
    const works = [...new Set(v.workIds)].map((id) => this.s.get("works", id));
    if (new Set(works.map((w) => w.artistId)).size !== 1)
      throw Error("BATCH_ARTIST_MISMATCH");
    const items = works.map((w) => ({
      w,
      d: this.list().find(
        (d) => d.workId === w.id && d.accountId === v.accountId,
      ),
    }));
    const snapshotHash = hash([
      v.accountId,
      items.map(({ w, d }) => [w.id, w.revision, d?.id, d?.reviewHash]),
    ]);
    const existing = this.batches().find(
      (b) => b.snapshotHash === snapshotHash && !b.cancelled,
    );
    if (existing) return existing;
    return this.s.repo.transaction(() => {
      const now = this.s.now().toISOString(),
        batch = this.s.save("batches", {
          id: randomUUID(),
          kind: "tme_uia",
          snapshotHash,
          workIds: works.map((w) => w.id),
          accountId: v.accountId,
          state: "TME_READY",
          paused: true,
          cancelled: false,
          mode: "production",
          source: "local",
          createdAt: now,
        });
      for (const { w, d } of items) {
        const issues = [...(d?.issues || [])];
        if (!d) issues.push("PREFLIGHT_REQUIRED");
        else {
          try {
            this.assertCurrent(d);
          } catch {
            issues.push("WORK_SNAPSHOT_CHANGED");
          }
          if (
            d.metadata.coverPolicy !== "preserve_album" ||
            !d.metadata.albumId
          )
            issues.push("EXISTING_ALBUM_REQUIRED");
          if (
            d.identity ||
            d.live ||
            d.remote ||
            d.pendingAction ||
            Object.keys(d.uploads).length
          )
            issues.push("REMOTE_CHECK_REQUIRED");
        }
        this.s.save("units", {
          id: randomUUID(),
          kind: "tme_uia",
          batchId: batch.id,
          workId: w.id,
          accountId: v.accountId,
          draftId: d?.id || null,
          reviewHash: d?.reviewHash || "",
          fingerprint: hash([batch.id, snapshotHash, w.id]),
          state: issues.length ? "TME_BLOCKED" : "TME_READY",
          issues,
          pendingAction: null,
          reason: issues.join(","),
          attempts: 0,
          updatedAt: now,
        });
      }
      this.s.repo.audit("tme.batch_plan", batch.id, { count: items.length });
      return batch;
    });
  }
  updateUnit(id: string, patch: Partial<TmeLiveUnit>) {
    const u = this.s.get("units", id);
    if (u.kind !== "tme_uia") throw Error("TME_UNIT_REQUIRED");
    const safeKeys = [
      "state",
      "pendingAction",
      "reason",
      "attempts",
      "identity",
      "receipt",
      "contractHash",
      "acceptedContractHash",
    ];
    if (Object.keys(patch).some((k) => !safeKeys.includes(k)))
      throw Error("PATCH_REJECTED");
    return this.s.save("units", {
      ...u,
      ...patch,
      updatedAt: this.s.now().toISOString(),
    }) as TmeLiveUnit;
  }
  updateBatch(id: string, patch: { state?: string; cancelled?: boolean }) {
    return this.s.repo.transaction(() => {
      const b = this.s.get("batches", id);
      if (b.kind !== "tme_uia") throw Error("TME_BATCH_REQUIRED");
      const result = this.s.save("batches", { ...b, ...patch, paused: true });
      if (patch.cancelled)
        for (const u of this.batchUnits(id))
          if (u.state === "TME_RESERVED")
            this.releaseUnstarted(u, "BATCH_CANCELLED_BEFORE_EXTERNAL_START");
      return result;
    });
  }
  private releaseUnstarted(u: TmeLiveUnit, reason: string) {
    if (u.state !== "TME_RESERVED" || u.pendingAction || !u.draftId) return;
    const d = this.get(u.draftId),
      same =
        d.identity &&
        u.identity &&
        (["subject", "session", "source"] as const).every(
          (k) => d.identity![k] === u.identity![k],
        );
    if (
      !same ||
      d.state !== "CHECKING" ||
      d.pendingAction ||
      d.remote ||
      d.live ||
      Object.keys(d.uploads).length
    ) {
      this.updateUnit(u.id, {
        state: "TME_RECONCILE_REQUIRED",
        reason: "UNSTARTED_RESERVATION_UNVERIFIED",
      });
      return;
    }
    for (const c of this.s
      .all("claims")
      .filter((c) => c.unitId === u.id && c.source === "browser"))
      this.s.repo.db.prepare("DELETE FROM claims WHERE id=?").run(c.id);
    this.update(d.id, d.revision, {
      identity: null,
      state: "AWAITING_ACCOUNT",
      pendingAction: null,
      reason,
    });
    this.updateUnit(u.id, { state: "TME_READY", identity: undefined, reason });
    this.s.repo.audit("tme.release_unstarted", u.id, { reason });
  }
  startUnit(id: string) {
    return this.s.repo.transaction(() => {
      const u = this.s.get("units", id);
      if (u.kind !== "tme_uia" || !u.draftId) throw Error("TME_UNIT_REQUIRED");
      if (this.s.get("batches", u.batchId).cancelled)
        throw Error("BATCH_CANCELLED");
      if (u.state !== "TME_RESERVED" || u.pendingAction)
        throw Error("TME_UNIT_NOT_RESERVED");
      const d = this.get(u.draftId);
      this.assertCurrent(d);
      if (d.reviewHash !== u.reviewHash || d.issues.length)
        throw Error("REVIEW_STALE");
      return this.updateUnit(id, {
        state: "TME_STAGING",
        pendingAction: "stage",
        attempts: u.attempts + 1,
      });
    });
  }
  claimUnit(id: string, identity: TmeIdentity) {
    return this.s.repo.transaction(() => {
      const u = this.s.get("units", id);
      if (u.kind !== "tme_uia" || !u.draftId) throw Error("TME_UNIT_REQUIRED");
      if (this.s.get("batches", u.batchId).cancelled)
        throw Error("BATCH_CANCELLED");
      if (u.state !== "TME_READY" || u.pendingAction)
        throw Error("TME_UNIT_NOT_READY");
      const d = this.get(u.draftId);
      this.assertCurrent(d);
      if (
        u.reviewHash !== d.reviewHash ||
        u.accountId !== d.accountId ||
        d.issues.length
      )
        throw Error("REVIEW_STALE");
      const key = hash([
        "tme_uia",
        identity.source,
        identity.subject,
        d.assets.audio?.sha256,
      ]);
      const prior = this.s.all("claims").find((c) => c.claimKey === key);
      if (prior && prior.unitId !== id)
        throw Error("DUPLICATE_REMOTE_RECORDING");
      if (
        d.identity ||
        d.remote ||
        d.live ||
        d.pendingAction ||
        Object.keys(d.uploads).length
      )
        throw Error("REMOTE_CHECK_REQUIRED");
      if (!prior)
        this.s.save("claims", {
          id: randomUUID(),
          claimKey: key,
          unitId: id,
          batchId: u.batchId,
          source: "browser",
          createdAt: this.s.now().toISOString(),
        });
      this.bind(d.id, d.revision, identity);
      return this.updateUnit(id, { identity, state: "TME_RESERVED" });
    });
  }
}
