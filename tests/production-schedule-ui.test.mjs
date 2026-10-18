import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const w = createRequire(import.meta.url)(
  process.env.RAINFALL_PRODUCTION_SCHEDULE_UI_BUNDLE,
);

test("new production plans default to Beijing 09:00 regardless of the host timezone", () => {
  const old = process.env.TZ;
  try {
    process.env.TZ = "America/Los_Angeles";
    const html = w.renderProductionDefaults();
    assert.match(html, /value="Asia\/Shanghai"/);
    assert.match(html, /type="time"[^>]*value="09:00"/);
    assert.ok(html.includes("北京时间 09:00 (UTC+08:00 / 01:00 UTC)"));
    assert.equal(w.productionDefaultTimezone, "Asia/Shanghai");
    assert.equal(w.productionDefaultLocalTime, "09:00");
  } finally {
    if (old === undefined) delete process.env.TZ;
    else process.env.TZ = old;
  }
});

test("schedule cards show Beijing time, explicit UTC conversion and the next due ISO", () => {
  assert.equal(typeof w.productionSchedulePreview, "function");
  const plan = { timezone: "Asia/Shanghai", localTime: "09:00", enabled: true };
  const preview = w.productionSchedulePreview(
    plan,
    new Date("2026-10-16T23:59:50Z"),
  );
  assert.equal(preview.description, "北京时间 09:00 (UTC+08:00 / 01:00 UTC)");
  assert.equal(preview.nextDueIso, "2026-10-17T01:00:00.000Z");
  assert.equal(
    w.productionSchedulePreview(
      plan,
      new Date("2026-10-16T23:59:50Z"),
      "2026-10-17T09:00:00.000Z",
    ).nextDueIso,
    preview.nextDueIso,
  );
  assert.equal(
    w.productionSchedulePreview(
      plan,
      new Date("2026-10-16T23:59:50Z"),
      preview.nextDueIso,
    ).nextDueIso,
    preview.nextDueIso,
  );
  const html = w.renderProductionSchedule(plan, "2026-10-16T23:59:50Z");
  assert.ok(html.includes(preview.description));
  assert.ok(html.includes("2026-10-17 09:00"));
  assert.ok(html.includes('dateTime="2026-10-17T01:00:00.000Z"'));
  assert.ok(html.includes("2026-10-17T01:00:00.000Z"));
});

test("a passed Beijing slot previews the next local day and disabled plans are labeled previews", () => {
  const plan = {
    timezone: "Asia/Shanghai",
    localTime: "09:00",
    enabled: false,
  };
  assert.equal(
    w.productionSchedulePreview(plan, new Date("2026-10-17T01:00:10Z"))
      .nextDueIso,
    "2026-10-18T01:00:00.000Z",
  );
  const html = w.renderProductionSchedule(plan, "2026-10-17T01:00:10Z");
  assert.ok(html.includes("下次时间预览（当前停用）"));
  assert.ok(!html.includes("下次到期："));
});

test("zone-specific previews honor DST and never label a missing schedule as active", () => {
  assert.equal(
    w.productionSchedulePreview(
      { timezone: "America/New_York", localTime: "09:00" },
      new Date("2026-07-01T00:00:00Z"),
    ).utcTime,
    "13:00",
  );
  assert.equal(
    w.productionSchedulePreview(
      { timezone: "America/New_York", localTime: "09:00" },
      new Date("2026-01-01T00:00:00Z"),
    ).utcTime,
    "14:00",
  );
  const gap = w.productionSchedulePreview(
    { timezone: "America/New_York", localTime: "02:30" },
    new Date("2026-03-08T06:00:00Z"),
  );
  assert.equal(gap.nextDueIso, "2026-03-08T07:00:00.000Z");
  assert.equal(gap.resolvedLocalTime, "03:00");
  const fold = w.productionSchedulePreview(
    { timezone: "America/New_York", localTime: "01:30" },
    new Date("2026-11-01T04:00:00Z"),
  );
  assert.equal(fold.nextDueIso, "2026-11-01T05:30:00.000Z");
  const missing = w.productionSchedulePreview(
    { timezone: "Asia/Shanghai", localTime: null },
    new Date("2026-10-17T00:00:00Z"),
  );
  assert.equal(missing.nextDueIso, null);
  assert.equal(missing.valid, false);
});
