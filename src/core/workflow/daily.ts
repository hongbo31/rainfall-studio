import { DateTime } from "luxon";
import { randomUUID } from "node:crypto";
import { Repository, type Row } from "../database";
import { DailyPlanInputSchema } from "../../shared/daily";
export function resolveDailyTime(date: string, time: string, zone: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    throw Error("SCHEDULE_TIME_INVALID");
  const start = DateTime.fromISO(date, { zone }).startOf("day");
  if (!start.isValid || start.toISODate() !== date)
    throw Error("SCHEDULE_DATE_INVALID");
  // Iterate in UTC order: a gap chooses the first legal local minute; a fold chooses the first occurrence.
  for (let i = 0; i < 1500; i++) {
    const t = start.plus({ minutes: i });
    if (t.toISODate() !== date) break;
    if (t.toFormat("HH:mm") >= time)
      return {
        utc: t.toUTC().toISO()!,
        offset: t.offset,
        ruleVersion: "daily-dst-v1",
      };
  }
  throw Error("SCHEDULE_DATE_INVALID");
}
export class DailyScheduler {
  private active = false;
  constructor(
    readonly repo: Repository,
    readonly mode: "production" | "simulation",
    readonly options: {
      now?: () => Date;
      allowFixtureExecution?: boolean;
      dispatch: (plan: Row, occurrence: Row) => Promise<{ runId: string }>;
    },
  ) {}
  now() {
    return this.options.now?.() ?? new Date();
  }
  save(raw: unknown, expectedRevision: number | null) {
    const input = DailyPlanInputSchema.parse(raw);
    this.repo.get("artists", input.artistId);
    if (input.seriesId) this.repo.get("series", input.seriesId);
    return this.repo.transaction(() => {
      const old = this.repo.maybe("dailyPlans", input.id);
      if ((old?.revision ?? null) !== expectedRevision)
        throw Error("REVISION_CONFLICT");
      if (old && old.artistId !== input.artistId) throw Error("ARTIST_SCOPE");
      const plan = {
        ...input,
        revision: (old?.revision ?? 0) + 1,
        state: "draft",
        enabled: false,
        authorizationRevision: null,
        updatedAt: this.now().toISOString(),
      };
      this.repo.save("dailyPlans", plan);
      return plan;
    });
  }
  enable(_id: string, _revision: number): never {
    throw Error("DAILY_EXECUTION_DISABLED");
  }
  preview(plan: Row) {
    const reasons: string[] = ["DAILY_EXECUTION_DISABLED"];
    if (!plan.localTime) reasons.push("SCHEDULE_TIME_REQUIRED");
    if (plan.candidateLimit === null) reasons.push("CANDIDATE_LIMIT_REQUIRED");
    else if (plan.candidateLimit < 2)
      reasons.push("TWO_OUTPUTS_REQUIRE_CAPACITY");
    if (plan.textBudget === null || plan.musicBudget === null)
      reasons.push("BUDGET_REQUIRED");
    if (!plan.textProfileId || !plan.musicProfileId)
      reasons.push("PROVIDER_CONFIGURATION_REQUIRED");
    if (
      plan.missedPolicy === "bounded_catch_up" &&
      (!plan.catchUpHours || !plan.maxCatchUpPerDay)
    )
      reasons.push("CATCH_UP_BOUNDS_REQUIRED");
    reasons.push(
      "QUALITY_CALIBRATION_REQUIRED",
      "PRICING_PRIVACY_RECONCILIATION_REQUIRED",
    );
    const next: Row[] = [];
    if (plan.localTime) {
      let day = DateTime.fromJSDate(this.now(), {
        zone: plan.timezone,
      }).startOf("day");
      for (
        let n = 0;
        n < 4 && next.length < 3;
        n++, day = day.plus({ days: 1 })
      ) {
        try {
          const r = resolveDailyTime(
            day.toISODate()!,
            plan.localTime,
            plan.timezone,
          );
          if (r.utc > this.now().toISOString())
            next.push({
              localDate: day.toISODate(),
              localTime: plan.localTime,
              timezone: plan.timezone,
              ...r,
            });
        } catch {
          reasons.push("SCHEDULE_DATE_INVALID");
        }
      }
    }
    return {
      reasons: [...new Set(reasons)],
      next,
      maximumReachable:
        plan.candidateLimit === null
          ? null
          : Math.floor(plan.candidateLimit / 2) * 2,
      state: plan.state,
    };
  }
  async tick() {
    if (this.active) return;
    if (this.mode !== "simulation" || !this.options.allowFixtureExecution)
      return;
    this.active = true;
    try {
      for (const plan of this.repo
        .all("dailyPlans")
        .filter(
          (p) =>
            p.enabled &&
            p.state === "enabled" &&
            p.authorizationRevision === p.revision,
        )) {
        const now = this.now(),
          stamp = now.toISOString(),
          key = "scheduler:" + plan.id,
          checkpoint = this.repo.maybe("settings", key);
        if (!checkpoint) {
          this.repo.save("settings", { id: key, checkedAt: stamp });
          continue;
        }
        const from = new Date(checkpoint.checkedAt);
        if (now <= from) continue;
        this.repo.save("settings", { id: key, checkedAt: stamp });
        if (
          !plan.localTime ||
          plan.candidateLimit === null ||
          plan.textBudget === null ||
          plan.musicBudget === null
        )
          continue;
        const today = DateTime.fromJSDate(now, { zone: plan.timezone }),
          earliest = DateTime.fromJSDate(from, { zone: plan.timezone }).startOf(
            "day",
          );
        let day =
          earliest < today.minus({ days: 7 }).startOf("day")
            ? today.minus({ days: 7 }).startOf("day")
            : earliest;
        const due: Row[] = [];
        for (
          let n = 0;
          n < 9 && day <= today;
          n++, day = day.plus({ days: 1 })
        ) {
          try {
            const resolved = resolveDailyTime(
              day.toISODate()!,
              plan.localTime,
              plan.timezone,
            );
            if (resolved.utc > checkpoint.checkedAt && resolved.utc <= stamp)
              due.push({ intendedLocalDate: day.toISODate(), ...resolved });
          } catch {
            /* invalid skipped local date has no valid occurrence */
          }
        }
        const existingToday = this.repo
          .all("occurrences")
          .filter(
            (o) =>
              o.planId === plan.id &&
              o.budgetDate === today.toISODate() &&
              o.runId,
          ).length;
        const catchUpCount =
          plan.missedPolicy === "bounded_catch_up" &&
          plan.catchUpHours &&
          plan.maxCatchUpPerDay
            ? Math.max(0, plan.maxCatchUpPerDay - existingToday)
            : 0;
        const catchUpAllowed = due
          .filter(
            (o) =>
              now.getTime() - new Date(o.utc).getTime() <=
              plan.catchUpHours * 3600000,
          )
          .slice(-catchUpCount || due.length);
        let dispatched = 0;
        for (const occurrence of due) {
          const occurrenceKey =
            plan.id + ":" + occurrence.intendedLocalDate + ":daily";
          if (
            this.repo
              .all("occurrences")
              .some((o) => o.occurrenceKey === occurrenceKey)
          )
            continue;
          const elapsed = now.getTime() - from.getTime(),
            lag = now.getTime() - new Date(occurrence.utc).getTime();
          const onTime = elapsed <= 90000 && lag <= 90000;
          let reason: string | null = null;
          if (
            !onTime &&
            !(catchUpCount > dispatched && catchUpAllowed.includes(occurrence))
          )
            reason = "MISSED_POLICY_SKIP";
          const pending = this.repo
            .all("candidates")
            .some(
              (c) =>
                !c.selectedAt &&
                c.selectionDisposition !== "superseded" &&
                (!plan.seriesId ||
                  !c.draftId ||
                  (this.repo.maybe("drafts", c.draftId)?.seriesBaseRevision ??
                    0) >=
                    (this.repo.maybe("seriesCheckpoints", plan.seriesId)
                      ?.revision ?? 0)) &&
                ["ready", "pending", "downloading", "download_failed"].includes(
                  c.state,
                ) &&
                (c.planId === plan.id ||
                  (plan.seriesId && c.seriesId === plan.seriesId)),
            );
          if (pending) reason = "PENDING_SELECTION";
          if (
            this.repo
              .all("operations")
              .some((o) => o.state === "unknown" || o.costState === "unknown")
          )
            reason = "PROVIDER_RISK_FROZEN";
          if (
            this.repo
              .all("occurrences")
              .some((o) => o.planId === plan.id && o.state === "running")
          )
            reason = "ACTIVE_RUN";
          const record = {
            id: randomUUID(),
            planId: plan.id,
            occurrenceKey,
            slot: "daily",
            ...occurrence,
            budgetDate: today.toISODate(),
            scheduleRevision: plan.revision,
            state: reason ? "skipped" : "claimed",
            reason,
            source: "fixture",
            createdAt: stamp,
          };
          this.repo.save("occurrences", record);
          if (reason) continue;
          try {
            const result = await this.options.dispatch(plan, record);
            this.repo.save("occurrences", {
              ...record,
              state: "candidates_ready",
              runId: result.runId,
            });
            dispatched++;
          } catch {
            this.repo.save("occurrences", {
              ...record,
              state: "blocked",
              reason: "DISPATCH_REQUIRES_REVIEW",
            });
          }
        }
      }
    } finally {
      this.active = false;
    }
  }
}
