import { DateTime } from "luxon";

export const productionDefaultTimezone = "Asia/Shanghai";
export const productionDefaultLocalTime = "09:00";
type Schedule = {
  timezone: string;
  localTime: string | null;
  enabled?: boolean;
};

// Same wall-clock rule as the scheduler: first occurrence in a fold, first legal minute in a gap.
function resolve(date: string, time: string, zone: string) {
  const exact = DateTime.fromISO(`${date}T${time}`, { zone });
  if (
    exact.isValid &&
    exact.toISODate() === date &&
    exact.toFormat("HH:mm") === time
  )
    return exact
      .getPossibleOffsets()
      .sort((a, b) => a.toMillis() - b.toMillis())[0];
  const start = DateTime.fromISO(date, { zone }).startOf("day");
  if (!start.isValid || start.toISODate() !== date) return null;
  for (let n = 0; n < 1500; n++) {
    const minute = start.plus({ minutes: n });
    if (minute.toISODate() !== date) break;
    if (minute.toFormat("HH:mm") >= time) return minute;
  }
  return null;
}

export function productionSchedulePreview(
  plan: Schedule,
  now = new Date(),
  suppliedNextDueIso?: string | null,
) {
  const zoneLabel =
    plan.timezone === productionDefaultTimezone ? "北京时间" : plan.timezone;
  const empty = {
    valid: false,
    description: `${zoneLabel} · 每日时间未设置或无效`,
    nextDueIso: null as string | null,
    nextLocalDateTime: null as string | null,
    resolvedLocalTime: null as string | null,
    utcTime: null as string | null,
    offsetLabel: null as string | null,
  };
  if (!plan.localTime || !/^([01]\d|2[0-3]):[0-5]\d$/.test(plan.localTime))
    return empty;
  const localNow = DateTime.fromJSDate(now, { zone: plan.timezone });
  if (!localNow.isValid) return empty;
  let next: DateTime | null = null;
  if (suppliedNextDueIso) {
    const supplied = DateTime.fromISO(suppliedNextDueIso).setZone(
      plan.timezone,
    );
    const intended = supplied.isValid
      ? resolve(supplied.toISODate()!, plan.localTime, plan.timezone)
      : null;
    if (
      intended &&
      intended.toMillis() === supplied.toMillis() &&
      supplied.toMillis() > now.getTime()
    )
      next = supplied;
  }
  if (!next) {
    for (
      let day = localNow.startOf("day"), n = 0;
      n < 8;
      n++, day = day.plus({ days: 1 })
    ) {
      const intended = resolve(day.toISODate()!, plan.localTime, plan.timezone);
      if (intended && intended.toMillis() > now.getTime()) {
        next = intended;
        break;
      }
    }
  }
  if (!next) return empty;
  const minutes = Math.abs(next.offset),
    offsetLabel = `UTC${next.offset < 0 ? "-" : "+"}${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  const utcTime = next.toUTC().toFormat("HH:mm");
  return {
    valid: true,
    description: `${zoneLabel} ${plan.localTime} (${offsetLabel} / ${utcTime} UTC)`,
    nextDueIso: next.toUTC().toISO()!,
    nextLocalDateTime: next.toFormat("yyyy-MM-dd HH:mm"),
    resolvedLocalTime: next.toFormat("HH:mm"),
    utcTime,
    offsetLabel,
  };
}
