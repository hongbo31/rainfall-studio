import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import type { Studio } from "./studio";
export function ensureBucket(
  s: Studio,
  kind: string,
  scope: string,
  date: string,
  limit: number,
  timezone = "Etc/UTC",
) {
  if (!Number.isSafeInteger(limit) || limit < 0) throw Error("LIMIT_INVALID");
  const existing = s
    .all("buckets")
    .find(
      (b) =>
        b.kind === kind &&
        b.scope === scope &&
        b.date === date &&
        b.timezone === timezone,
    );
  if (existing) {
    if (existing.limit !== limit) {
      existing.limit = limit;
      s.save("buckets", existing);
    }
    return existing;
  }
  const start = DateTime.fromISO(date, { zone: timezone }).startOf("day");
  if (!start.isValid) throw Error("TIMEZONE_INVALID");
  return s.save("buckets", {
    id: randomUUID(),
    kind,
    scope,
    date,
    limit,
    timezone,
    start: start.toUTC().toISO(),
    end: start.plus({ days: 1 }).toUTC().toISO(),
    unit: kind === "cost" ? "CNY_fen" : "count",
    scale: kind === "cost" ? 2 : 0,
    ruleVersion: "local-v1",
  });
}
export function balance(s: Studio, id: string) {
  const bucket = s.get("buckets", id);
  let reserved = 0,
    spent = 0;
  for (const e of s.all("ledger").filter((e) => e.bucketId === id)) {
    if (e.kind === "reserve") reserved += e.amount;
    if (e.kind === "release") reserved -= e.amount;
    if (e.kind === "settle") {
      reserved -= e.reservedAmount;
      spent += e.amount;
    }
  }
  return {
    ...bucket,
    reserved,
    spent,
    available: Math.max(0, bucket.limit - reserved - spent),
  };
}
export function reserve(
  s: Studio,
  op: string,
  requests: { id: string; amount: number }[],
) {
  return s.repo.transaction(() => {
    if (active(s, op).length) return;
    if (
      s.all("ledger").some((e) => e.operationId === op && e.kind === "settle")
    )
      throw Error("OPERATION_ALREADY_SETTLED");
    const combined = new Map<string, number>();
    for (const r of requests) {
      if (!Number.isSafeInteger(r.amount) || r.amount < 0)
        throw Error("AMOUNT_INVALID");
      combined.set(r.id, (combined.get(r.id) || 0) + r.amount);
    }
    for (const [id, amount] of combined) {
      if (balance(s, id).available < amount) throw Error("QUOTA_EXCEEDED");
    }
    for (const [id, amount] of combined)
      s.save("ledger", {
        id: randomUUID(),
        operationId: op,
        bucketId: id,
        kind: "reserve",
        amount,
        eventKey: `${op}:${id}:reserve`,
        at: s.now().toISOString(),
        outcome: "unsent",
      });
  });
}
export function active(s: Studio, op: string) {
  return s
    .all("ledger")
    .filter(
      (e) =>
        e.operationId === op &&
        e.kind === "reserve" &&
        !s
          .all("ledger")
          .some(
            (x) =>
              x.operationId === op &&
              x.bucketId === e.bucketId &&
              ["settle", "release"].includes(x.kind),
          ),
    );
}
export function settle(s: Studio, op: string, event: string) {
  return s.repo.transaction(() => {
    for (const r of active(s, op))
      s.save("ledger", {
        id: randomUUID(),
        operationId: op,
        bucketId: r.bucketId,
        kind: "settle",
        amount: r.amount,
        reservedAmount: r.amount,
        eventKey: `${op}:${r.bucketId}:settle`,
        sourceEventId: event,
        source: s.mode === "simulation" ? "simulation" : "user_report",
        at: s.now().toISOString(),
      });
  });
}
export function release(s: Studio, op: string, evidence: string) {
  if (
    s
      .all("ledger")
      .some((x) => x.operationId === op && x.outcome === "unknown") &&
    evidence !== "confirmed_not_submitted"
  )
    throw Error("RECONCILE_FIRST");
  return s.repo.transaction(() => {
    for (const r of active(s, op))
      s.save("ledger", {
        id: randomUUID(),
        operationId: op,
        bucketId: r.bucketId,
        kind: "release",
        amount: r.amount,
        eventKey: `${op}:${r.bucketId}:release`,
        evidence,
        at: s.now().toISOString(),
      });
  });
}
export function markUnknown(s: Studio, op: string) {
  for (const r of active(s, op).filter(
    (r) =>
      !s
        .all("ledger")
        .some((e) => e.eventKey === `${op}:${r.bucketId}:unknown`),
  ))
    s.save("ledger", {
      id: randomUUID(),
      operationId: op,
      bucketId: r.bucketId,
      kind: "unknown",
      amount: 0,
      outcome: "unknown",
      eventKey: `${op}:${r.bucketId}:unknown`,
      at: s.now().toISOString(),
    });
}
export function rollover(s: Studio, op: string) {
  if (
    s.all("ledger").some((x) => x.operationId === op && x.outcome === "unknown")
  )
    throw Error("RECONCILE_FIRST");
  const rs = active(s, op);
  return s.repo.transaction(() => {
    const next = rs.map((r) => {
      const b = s.get("buckets", r.bucketId);
      const date = DateTime.fromJSDate(s.now(), {
        zone: b.timezone,
      }).toISODate()!;
      return {
        old: r,
        next: ensureBucket(s, b.kind, b.scope, date, b.limit, b.timezone),
      };
    });
    if (next.every((x) => x.old.bucketId === x.next.id)) return;
    for (const x of next)
      if (balance(s, x.next.id).available < x.old.amount)
        throw Error("QUOTA_EXCEEDED");
    release(s, op, "confirmed_not_submitted");
    reserve(
      s,
      op,
      next.map((x) => ({ id: x.next.id, amount: x.old.amount })),
    );
  });
}
