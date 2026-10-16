import { randomUUID } from "node:crypto";
import { hash } from "./database";
import type { Studio } from "./studio";
export function plan(s: Studio, input: any) {
  return s.repo.transaction(() => {
    const workIds = [...new Set(input.workIds)] as string[];
    if (workIds.length * input.destinations.length > 500)
      throw Error("BATCH_LIMIT");
    const frozen = workIds.map((id) => s.get("works", id));
    for (const w of frozen)
      for (const d of input.destinations)
        s.checkBinding(d.bindingId, w.artistId, d.accountId, d.target);
    const snapshotHash = hash({
      mode: s.mode,
      works: frozen,
      destinations: input.destinations,
    });
    const existing = s
      .all("batches")
      .find((b) => b.snapshotHash === snapshotHash);
    if (existing) return existing;
    const batch = s.save("batches", {
      id: randomUUID(),
      snapshotHash,
      mode: s.mode,
      createdAt: s.now().toISOString(),
      state: "DRAFT",
      workIds,
      approved: false,
      paused: true,
      source: s.mode === "simulation" ? "simulation" : "local",
    });
    for (const w of frozen) {
      const groups = new Map<string, any[]>();
      for (const d of input.destinations) {
        const account = s.get("accounts", d.accountId);
        const key =
          s.mode === "simulation" &&
          account.provider === "tme" &&
          d.kind === "audio_distribution"
            ? `${account.id}:sim-tme`
            : d.target + ":" + d.accountId + ":" + d.kind;
        groups.set(key, [...(groups.get(key) || []), d]);
      }
      for (const destinations of groups.values()) {
        const d = destinations[0],
          account = s.get("accounts", d.accountId),
          binding = s.get("bindings", d.bindingId);
        const issues: string[] = [];
        if (!w.assets.audio_A) issues.push("缺少音频");
        if (!w.assets.cover) issues.push("缺少封面");
        if (!w.rights || w.rights.startsWith("待") || w.ai === "unknown")
          issues.push("权益或AI来源待确认");
        if (d.kind === "video_post" && !w.assets.video)
          issues.push("视频发布需先包装MP4");
        if (d.target === "douyin" && d.kind !== "video_post")
          issues.push("抖音本入口仅准备视频投稿");
        for (const assetId of Object.values(w.assets) as string[]) {
          try {
            s.locate(assetId);
          } catch {
            issues.push("素材缺失或损坏");
          }
        }
        const recording = w.assets.audio_A
          ? s.get("assets", w.assets.audio_A).sha256
          : w.id;
        for (const target of destinations) {
          const key = hash([
            s.mode,
            recording,
            w.artistId,
            target.target,
            target.kind,
          ]);
          if (s.all("claims").some((c) => c.claimKey === key))
            issues.push("已有同录音目标投稿，请核对历史");
        }
        if (s.mode === "production")
          issues.push("平台自动投稿未获准接入：仅导出人工材料");
        const state = issues.length ? "BLOCKED" : "READY";
        const fingerprint = hash({
          snapshotHash,
          work: w.id,
          destinations,
          bindingRevision: binding.revision,
          accountId: account.id,
        });
        const u = s.save("units", {
          id: randomUUID(),
          batchId: batch.id,
          fingerprint,
          workId: w.id,
          artistId: w.artistId,
          accountId: account.id,
          bindingId: binding.id,
          bindingRevision: binding.revision,
          snapshot: structuredClone(w),
          destinations,
          issues,
          state,
          attempts: 0,
          commitCount: 0,
          remoteOutcome: "not_submitted",
          nextAttemptAt: null,
          review: "unknown",
          publication: "unknown",
        });
        for (const target of destinations)
          s.save("targets", {
            id: randomUUID(),
            batchId: batch.id,
            unitId: u.id,
            workId: w.id,
            target: target.target,
            accountId: target.accountId,
            kind: target.kind,
            review: "unknown",
            publication: "unknown",
            source: s.mode === "simulation" ? "simulation" : "local",
          });
      }
    }
    batch.state = "PRECHECKED";
    s.save("batches", batch);
    s.repo.audit("publish.plan", batch.id, {
      targets: workIds.length * input.destinations.length,
    });
    return batch;
  });
}
export function approve(s: Studio, v: any) {
  if (s.mode !== "simulation") throw Error("LIVE_API_NOT_CONNECTED");
  const b = s.get("batches", v.id);
  if (v.snapshotHash !== b.snapshotHash) throw Error("APPROVAL_STALE");
  const units = s
    .all("units")
    .filter((u) => u.batchId === b.id && u.state === "READY");
  if (!units.length) throw Error("NO_ELIGIBLE_UNITS");
  const approval = s.save("approvals", {
    id: randomUUID(),
    batchId: b.id,
    snapshotHash: b.snapshotHash,
    unitIds: units.map((u) => u.id),
    expiresAt: new Date(s.now().getTime() + 24 * 3600000).toISOString(),
    mode: s.mode,
  });
  b.approved = true;
  b.approvalId = approval.id;
  s.save("batches", b);
  s.repo.audit("publish.approve_simulation", b.id);
  return approval;
}
export function start(s: Studio, id: string) {
  const b = s.get("batches", id);
  if (s.mode !== "simulation") throw Error("LIVE_API_NOT_CONNECTED");
  const approval = s.repo.maybe("approvals", b.approvalId);
  if (
    !approval ||
    approval.snapshotHash !== b.snapshotHash ||
    new Date(approval.expiresAt) < s.now()
  )
    throw Error("APPROVAL_REQUIRED");
  for (const u of s
    .all("units")
    .filter((u) => u.batchId === id && u.state === "PAUSED")) {
    u.state = u.previousState === "RETRY_WAIT" ? "RETRY_WAIT" : "READY";
    s.save("units", u);
  }
  b.paused = false;
  b.state = "RUNNING";
  s.save("batches", b);
  return b;
}
function quotaRequests(s: Studio, u: any) {
  const date = s.now().toISOString().slice(0, 10);
  const account = s.get("accounts", u.accountId);
  const rs = u.destinations.map((d: any) => ({
    id: s.ensureBucket(
      "submission_target",
      `${account.id}:${d.target}:${d.kind}`,
      date,
      account.dailyLimit,
    ).id,
    amount: 1,
  }));
  if (account.provider === "tme")
    rs.push({
      id: s.ensureBucket(
        "submission_route",
        `${account.id}:tme`,
        date,
        account.dailyLimit,
      ).id,
      amount: 1,
    });
  return rs;
}
function currentApproval(s: Studio, u: any) {
  const b = s.get("batches", u.batchId);
  const a = s.repo.maybe("approvals", b.approvalId);
  if (
    b.paused ||
    !a ||
    a.snapshotHash !== b.snapshotHash ||
    !a.unitIds.includes(u.id) ||
    new Date(a.expiresAt) < s.now()
  )
    throw Error("APPROVAL_REQUIRED");
  const binding = s.get("bindings", u.bindingId);
  if (binding.revision !== u.bindingRevision || binding.status === "revoked")
    throw Error("BINDING_CHANGED");
  for (const d of u.destinations)
    s.checkBinding(d.bindingId, u.artistId, d.accountId, d.target);
  for (const id of Object.values(u.snapshot.assets) as string[]) s.locate(id);
}
export async function tick(s: Studio) {
  if (s.mode !== "simulation") return;
  const activeAccounts = new Set<string>();
  let count = 0;
  for (const initial of s.all("units")) {
    if (count >= 2) break;
    if (
      ![
        "READY",
        "PREPARING",
        "UPLOADING",
        "UPLOADED",
        "COMMITTING",
        "RETRY_WAIT",
      ].includes(initial.state)
    )
      continue;
    if (activeAccounts.has(initial.accountId)) continue;
    const u = s.get("units", initial.id);
    const batch = s.get("batches", u.batchId);
    if (batch.paused) continue;
    if (u.state === "RETRY_WAIT" && new Date(u.nextAttemptAt) > s.now())
      continue;
    count++;
    activeAccounts.add(u.accountId);
    try {
      currentApproval(s, u);
      if (u.state === "RETRY_WAIT") {
        if (u.attempts >= 5) {
          u.state = "FAILED_PERMANENT";
          u.reason = "重试次数达到上限";
          s.save("units", u);
          continue;
        }
        u.state = u.retryPhase || "READY";
      }
      if (u.state === "READY") {
        s.repo.transaction(() => {
          s.reserve(u.id, quotaRequests(s, u));
          u.state = "PREPARING";
          u.leaseToken = randomUUID();
          u.leaseUntil = new Date(s.now().getTime() + 60000).toISOString();
          s.save("units", u);
        });
      } else if (u.state === "PREPARING") {
        u.preparedCount = (u.preparedCount || 0) + 1;
        u.state = "UPLOADING";
        u.progress = 0;
        s.save("units", u);
      } else if (u.state === "UPLOADING") {
        u.uploadCount = (u.uploadCount || 0) + 1;
        u.progress = 100;
        u.state = "UPLOADED";
        s.save("units", u);
      } else if (u.state === "UPLOADED") {
        s.repo.transaction(() => {
          s.rollover(u.id);
          for (const d of u.destinations) {
            const key = hash([
              s.mode,
              s.get("assets", u.snapshot.assets.audio_A).sha256,
              u.artistId,
              d.target,
              d.kind,
            ]);
            const old = s.all("claims").find((c) => c.claimKey === key);
            if (old && old.unitId !== u.id) throw Error("DUPLICATE_RECORDING");
            if (!old)
              s.save("claims", {
                id: randomUUID(),
                claimKey: key,
                unitId: u.id,
              });
          }
          u.state = "COMMITTING";
          u.intentAt = s.now().toISOString();
          s.save("units", u);
          s.repo.audit("publish.intent", u.id, { fingerprint: u.fingerprint });
        });
      } else if (u.state === "COMMITTING") {
        s.rollover(u.id);
        u.attempts++;
        u.commitCount++;
        u.dispatchedAt = s.now().toISOString();
        if (u.fault === "unknown") {
          u.state = "SUBMISSION_UNKNOWN";
          u.remoteOutcome = "unknown";
          u.reason = "演练：回执丢失，必须先核对";
          s.markUnknown(u.id);
          s.exception("unit", u.id, "SUBMISSION_UNKNOWN", "unknown");
        } else if (u.fault === "network") {
          u.state = "RETRY_WAIT";
          u.retryPhase = "COMMITTING";
          u.nextAttemptAt = new Date(s.now().getTime() + 5000).toISOString();
          u.fault = null;
          u.reason = "演练：明确未受理的网络失败，5秒后可重试";
          s.exception("unit", u.id, "NETWORK_SAFE_RETRY", "not_submitted");
        } else {
          u.state = "SUBMITTED";
          u.remoteOutcome = "submitted";
          u.receipt = {
            remoteId: "sim:" + randomUUID(),
            source: "simulation",
            acceptedAt: s.now().toISOString(),
          };
          u.review = u.fault === "rejected" ? "rejected" : "pending";
          u.reason = u.fault === "rejected" ? "演练驳回：请补充权益附件" : "";
          s.settle(u.id, u.receipt.remoteId);
          if (u.review === "rejected")
            s.exception("unit", u.id, "REVIEW_REJECTED", "submitted");
          for (const t of s.all("targets").filter((t) => t.unitId === u.id))
            s.save("targets", {
              ...t,
              review: u.review,
              publication: "unknown",
              receipt: u.receipt,
              observedAt: s.now().toISOString(),
            });
        }
        s.save("units", u);
        s.repo.audit("publish.simulated_result", u.id, {
          state: u.state,
          review: u.review,
        });
      }
    } catch (e: any) {
      u.state = "BLOCKED";
      u.reason = e.message;
      s.save("units", u);
      s.exception("unit", u.id, e.message, u.remoteOutcome || "not_submitted");
    }
  }
  for (const b of s.all("batches").filter((b) => !b.paused)) {
    const us = s.all("units").filter((u) => u.batchId === b.id);
    if (
      us.every(
        (u) =>
          ![
            "READY",
            "PREPARING",
            "UPLOADING",
            "UPLOADED",
            "COMMITTING",
            "RETRY_WAIT",
          ].includes(u.state),
      )
    ) {
      b.state = us.some((u) => u.state === "SUBMISSION_UNKNOWN")
        ? "NEEDS_RECONCILIATION"
        : us.every((u) => u.state === "SUBMITTED")
          ? "SUBMITTED"
          : "NEEDS_ACTION";
      s.save("batches", b);
    }
  }
}
export function pause(s: Studio, id: string) {
  const b = s.get("batches", id);
  b.paused = true;
  b.state = "PAUSED";
  return s.save("batches", b);
}
export function retryUnit(s: Studio, id: string) {
  const u = s.get("units", id);
  if (
    u.state === "SUBMISSION_UNKNOWN" ||
    u.state === "SUBMITTED" ||
    u.review === "rejected"
  )
    throw Error("RETRY_UNSAFE");
  if (u.state !== "RETRY_WAIT" || u.attempts >= 5)
    throw Error("NOT_SAFE_RETRY");
  u.nextAttemptAt = s.now().toISOString();
  s.save("units", u);
  for (const e of s.all("exceptions").filter((e) => e.entityId === id))
    s.save("exceptions", { ...e, state: "resolved" });
  return u;
}
export function retry(s: Studio, id: string) {
  let count = 0;
  for (const u of s
    .all("units")
    .filter((u) => u.batchId === id && u.state === "RETRY_WAIT")) {
    retryUnit(s, u.id);
    count++;
  }
  return { retried: count, unknownExcluded: true };
}
export function cancel(s: Studio, id: string) {
  let count = 0;
  for (const u of s
    .all("units")
    .filter(
      (u) =>
        u.batchId === id &&
        ![
          "SUBMITTED",
          "SUBMISSION_UNKNOWN",
          "COMMITTING",
          "CANCELLED",
        ].includes(u.state),
    )) {
    s.release(u.id, "confirmed_not_submitted");
    u.state = "CANCELLED";
    s.save("units", u);
    count++;
  }
  return { cancelled: count, unknownExcluded: true };
}
export function reconcile(s: Studio, id: string) {
  const u = s.get("units", id);
  if (u.state !== "SUBMISSION_UNKNOWN") throw Error("NOT_UNKNOWN");
  s.repo.audit("publish.reconcile", u.id, { result: "inconclusive" });
  return {
    kind: "inconclusive",
    reason:
      "演练未知结果保留；真实接口未连接。请在官方后台核对，不能通过普通重试再次投稿。",
  };
}
export function setFault(s: Studio, id: string, kind: string) {
  if (s.mode !== "simulation") throw Error("SIMULATION_ONLY");
  const u = s.get("units", id);
  if (u.state !== "READY") throw Error("ALREADY_STARTED");
  return s.save("units", { ...u, fault: kind });
}
export function revalidate(s: Studio, id: string) {
  if (s.mode !== "simulation") throw Error("LIVE_API_NOT_CONNECTED");
  return s.repo.transaction(() => {
    const batch = s.get("batches", id);
    batch.approved = false;
    batch.approvalId = null;
    batch.paused = true;
    batch.state = "PRECHECKED";
    s.save("batches", batch);
    for (const u of s
      .all("units")
      .filter(
        (u) =>
          u.batchId === id &&
          u.state === "PAUSED" &&
          u.remoteOutcome === "not_submitted",
      )) {
      for (const d of u.destinations)
        s.checkBinding(d.bindingId, u.artistId, d.accountId, d.target);
      for (const id of Object.values(u.snapshot.assets) as string[])
        s.locate(id);
      s.save("units", { ...u, state: "READY", issues: [] });
    }
    s.repo.audit("publish.revalidate", id);
    return batch;
  });
}
export function recordManual(s: Studio, v: any) {
  return s.repo.transaction(() => {
    const u = s.get("units", v.id);
    if (["COMMITTING", "UPLOADING", "UPLOADED", "PREPARING"].includes(u.state))
      throw Error("REMOTE_IN_FLIGHT");
    if (s.mode === "production" && v.remoteId.startsWith("sim:"))
      throw Error("SIMULATION_RECEIPT_REJECTED");
    if (u.receipt && u.receipt.remoteId !== v.remoteId)
      throw Error("RECEIPT_IDENTITY_IMMUTABLE");
    const recording = u.snapshot.assets.audio_A
      ? s.get("assets", u.snapshot.assets.audio_A).sha256
      : u.workId;
    for (const d of u.destinations) {
      const claimKey = hash([s.mode, recording, u.artistId, d.target, d.kind]);
      const old = s.all("claims").find((c) => c.claimKey === claimKey);
      if (old && old.unitId !== u.id) throw Error("DUPLICATE_RECORDING");
      if (!old)
        s.save("claims", {
          id: randomUUID(),
          claimKey,
          unitId: u.id,
          source: "user_report",
        });
    }
    const observation = {
      review: v.review,
      publication: v.publication,
      reason: v.reason,
      evidence: v.evidence,
      observedAt: v.observedAt,
      source: "user_report",
    };
    u.receipt = u.receipt || {
      remoteId: v.remoteId,
      remoteUrl: v.remoteUrl,
      acceptedAt: v.observedAt,
      source: "user_report",
    };
    const newer =
      !u.statusObservedAt ||
      Date.parse(v.observedAt) >= Date.parse(u.statusObservedAt);
    if (newer) {
      u.review = v.review;
      u.publication = v.publication;
      u.reason = v.reason;
      u.statusObservedAt = v.observedAt;
    }
    u.state = "SUBMITTED";
    u.remoteOutcome = "submitted";
    const events = u.observations || [];
    if (!events.some((o: any) => hash(o) === hash(observation)))
      events.push(observation);
    u.observations = events;
    s.save("units", u);
    const reserved = s
      .all("ledger")
      .filter(
        (e) =>
          e.operationId === u.id &&
          e.kind === "reserve" &&
          !s
            .all("ledger")
            .some(
              (x) =>
                x.operationId === u.id &&
                x.bucketId === e.bucketId &&
                ["settle", "release"].includes(x.kind),
            ),
      );
    if (reserved.length) s.settle(u.id, v.remoteId);
    const count = (kind: string, scope: string, key: string) => {
      const already = s
        .all("ledger")
        .some(
          (e) =>
            e.operationId === u.id &&
            e.kind === "settle" &&
            s.get("buckets", e.bucketId).kind === kind &&
            s.get("buckets", e.bucketId).scope === scope,
        );
      if (already || s.all("ledger").some((e) => e.eventKey === key)) return;
      const account = s.get("accounts", u.accountId),
        bucket = s.ensureBucket(
          kind,
          scope,
          u.receipt.acceptedAt.slice(0, 10),
          account.dailyLimit,
        );
      s.save("ledger", {
        id: randomUUID(),
        operationId: u.id,
        bucketId: bucket.id,
        kind: "settle",
        amount: 1,
        reservedAmount: 0,
        eventKey: key,
        sourceEventId: v.remoteId,
        source: "user_report",
        at: u.receipt.acceptedAt,
      });
    };
    for (const d of u.destinations)
      count(
        "submission_target",
        u.accountId + ":" + d.target + ":" + d.kind,
        "manual:" +
          u.accountId +
          ":" +
          d.target +
          ":" +
          d.kind +
          ":" +
          v.remoteId,
      );
    if (s.get("accounts", u.accountId).provider === "tme")
      count(
        "submission_route",
        u.accountId + ":tme",
        "manual:" + u.accountId + ":route:tme:" + v.remoteId,
      );
    for (const t of s.all("targets").filter((t) => t.unitId === u.id))
      s.save("targets", {
        ...t,
        ...(newer ? observation : {}),
        observations: [...(t.observations || []), observation],
        receipt: u.receipt,
      });
    for (const e of s.all("exceptions").filter((e) => e.entityId === u.id))
      s.save("exceptions", { ...e, state: "resolved" });
    s.repo.audit("publish.manual_report", u.id, {
      remoteId: v.remoteId,
      review: v.review,
      publication: v.publication,
      source: "user_report",
    });
    return u;
  });
}
