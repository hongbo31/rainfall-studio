import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const {
  summarizeReports,
  reportScopeKey,
  renderInsights,
  describeWorkReadiness,
  renderEntry,
  renderTmeStudio,
} = createRequire(import.meta.url)("../build/clarity-ui.cjs");
const scope = { date: "2026-10-16", platform: "qqmusic", basisConfirmed: true };
const row = (id, plays = null, extra = {}) => ({
  id,
  platform: "qqmusic",
  date: "2026-10-16",
  plays,
  favorites: null,
  comments: null,
  fileHash: "abc",
  ...extra,
});
test("empty/all-missing reports are unknown while measured zero is retained", () => {
  assert.equal(summarizeReports([], scope).metrics.plays.value, null);
  const missing = summarizeReports([row("a"), row("b")], scope).metrics.plays;
  assert.equal(missing.value, null);
  assert.equal(missing.known, 0);
  assert.equal(missing.total, 2);
  assert.deepEqual(summarizeReports([row("a", 0)], scope).metrics.plays, {
    value: 0,
    known: 1,
    total: 1,
    overflow: false,
  });
});
test("partial report totals include known rows and expose coverage without filling missing values", () => {
  const m = summarizeReports([row("a", 100), row("b"), row("c", 0)], scope)
    .metrics.plays;
  assert.deepEqual(m, { value: 100, known: 2, total: 3, overflow: false });
});
test("report totals require explicit date/platform/basis and exclude other snapshots", () => {
  const rows = [
    row("today", 10),
    row("yesterday", 300, { date: "2026-10-15" }),
    row("other-platform", 500, { platform: "netease" }),
  ];
  assert.equal(
    summarizeReports(rows, { ...scope, date: "" }).status,
    "choose_date",
  );
  assert.equal(
    summarizeReports(rows, { ...scope, platform: "" }).status,
    "choose_platform",
  );
  assert.equal(
    summarizeReports(rows, { ...scope, basisConfirmed: false }).status,
    "confirm_basis",
  );
  assert.equal(
    summarizeReports(rows, { ...scope, basisConfirmed: false }).metrics.plays
      .value,
    null,
  );
  assert.equal(summarizeReports(rows, scope).metrics.plays.value, 10);
});
test("source or filter change invalidates the same-basis confirmation identity", () => {
  const rows = [row("a", 10), row("b", 20)],
    key = reportScopeKey(rows, scope);
  assert.equal(reportScopeKey([...rows].reverse(), scope), key);
  for (const changed of [
    [row("a", 11), row("b", 20)],
    [row("a", 10, { fileHash: "new" }), row("b", 20)],
  ])
    assert.notEqual(reportScopeKey(changed, scope), key);
  assert.notEqual(reportScopeKey(rows, { ...scope, date: "2026-10-15" }), key);
  assert.notEqual(reportScopeKey(rows, { ...scope, platform: "netease" }), key);
});
test("invalid or unsafe counts cannot be rendered as precise measured totals", () => {
  const invalid = summarizeReports(
    [row("a", -1), row("b", NaN), row("c", "8")],
    scope,
  ).metrics.plays;
  assert.equal(invalid.known, 0);
  assert.equal(invalid.value, null);
  const large = summarizeReports(
    [row("a", Number.MAX_SAFE_INTEGER), row("b", 1)],
    scope,
  ).metrics.plays;
  assert.equal(large.overflow, true);
  assert.equal(large.value, null);
});
test("initial reports page asks for scope and does not label empty metrics as zero", () => {
  const html = renderInsights();
  assert(html.includes("请选择统计日期"));
  assert(html.includes("核对指标口径"));
  assert(!html.includes("播放快照合计"));
});
const work = {
  id: "w",
  revision: 2,
  assets: { audio_A: "a", cover: "c" },
  rights: "用户记录的来源说明",
  ai: "generated",
};
const payload = {
  workId: "w",
  workRevision: 2,
  audio: { assetId: "a" },
  cover: { assetId: "c" },
  lyrics: { plainText: "保留的演唱文本", alignmentConfirmed: true },
  warnings: [],
};
test("work next step identifies missing audio/lyrics/cover/source without inventing publication readiness", () => {
  const missing = describeWorkReadiness(
    { ...work, assets: {}, rights: "", ai: "unknown" },
    {
      ...payload,
      audio: null,
      cover: null,
      lyrics: { plainText: "", alignmentConfirmed: false },
    },
    "已保存",
  );
  assert.deepEqual(
    missing.items.map((i) => i.key),
    ["audio", "lyrics", "cover", "rights"],
  );
  assert.equal(missing.ready, false);
  assert.equal(missing.next.key, "audio");
  const unconfirmed = describeWorkReadiness(
    work,
    { ...payload, lyrics: { ...payload.lyrics, alignmentConfirmed: false } },
    "已保存",
  );
  assert.equal(unconfirmed.next.key, "lyrics");
  assert.equal(unconfirmed.ready, false);
  const prepared = describeWorkReadiness(work, payload, "已保存");
  assert.equal(prepared.ready, true);
  assert.equal(prepared.next.key, "publish");
  assert(prepared.next.label.includes("预检"));
});
test("unsaved work or stale/failed preview cannot show ready materials", () => {
  assert.equal(
    describeWorkReadiness(work, payload, "等待保存…").next.key,
    "save",
  );
  for (const p of [
    null,
    { ...payload, workId: "other" },
    { ...payload, workRevision: 1 },
    { ...payload, audio: { assetId: "different" } },
  ]) {
    const result = describeWorkReadiness(work, p, "已保存");
    assert.equal(result.ready, false);
    assert.equal(result.state, "checking");
  }
});
test("entry and template UI names distinguish ideas, local templates and old plans", () => {
  const home = renderEntry("overview"),
    create = renderEntry("create");
  assert(home.includes("聊聊新想法"));
  assert(home.includes("本地模板草稿计划"));
  assert(create.includes("用本地模板起草"));
  assert(create.includes("定时创建本地模板草稿"));
  assert(!create.includes("生成本地歌词与提示词 →"));
});
test("Tencent UI states client connection separately from external Chrome control", () => {
  const html = renderTmeStudio();
  assert(html.includes("旧浏览器连接诊断"));
  assert(html.includes("外部工具能操作 Chrome"));
  assert(html.includes("不代表本客户端已连接"));
  assert(html.includes("真实页面"));
});
