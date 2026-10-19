import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { build } from "esbuild";
await build({
  entryPoints: ["tests/fixtures/simple-publishing-ui.tsx"],
  outfile: "build/simple-publishing-ui.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
});
const { renderPublish, renderPageHead } = createRequire(import.meta.url)(
  "../build/simple-publishing-ui.cjs",
);

test("main page offers exactly song selection, five targets and a local check action, with no legacy execution tools", () => {
  const { html, actions } = renderPublish();
  for (const text of [
    "发布中心",
    "选择歌曲：原版歌曲",
    "发布到 网易云音乐",
    "发布到 汽水音乐",
    "发布到 QQ 音乐",
    "发布到 酷狗音乐",
    "发布到 抖音视频",
    "配置 网易云音乐",
    "平台说明",
  ])
    assert.ok(html.includes(text), text);
  assert.equal((html.match(/type="checkbox"/g) || []).length, 6);
  for (const text of [
    "请选择 A、B 或两版",
    "批次记录",
    "TME",
    "指纹",
    "开始已确认任务",
    "快照",
    "修订",
    "AI 页面准备",
    "高级设置",
  ])
    assert.ok(!html.includes(text), text);
  assert.match(html, />发布<\/button>/);
  assert.equal(actions.length, 0);
});
test("pending terms retain original text and neutral visible state without inventing an account, target or consent", () => {
  const terms = "这是尚未接受的原始协议；协议可能包含不同条件。";
  const { html } = renderPublish({
    publicationPendingTerms: [
      {
        id: "job-a",
        workId: "song-a",
        title: "原版歌曲",
        summary: "待条款确认",
        termsText: terms,
        termsHash: "hash-secret",
        platformLabel: "腾讯音乐",
      },
    ],
  });
  for (const text of [
    "原版歌曲",
    "腾讯音乐",
    "待条款确认 · 未接受条款",
    "查看条款",
    terms,
  ])
    assert.ok(html.includes(text), text);
  for (const text of ["hash-secret", "同意条款", "接受并提交", "非独家·3年"])
    assert.ok(!html.includes(text), text);
  assert.ok(!html.includes("<details open"));
});
test("production results stay unavailable and simulation is explicitly labelled", () => {
  const request = {
    id: "r-a",
    workId: "song-a",
    title: "原版歌曲",
    target: "netease",
    accountId: null,
    state: "unavailable",
    summary: "未接通",
    issues: ["缺少官方接口"],
    source: "local",
    configurationTarget: "netease",
    materialSnapshot: {},
  };
  const { html } = renderPublish({ publicationRequests: [request] });
  assert.ok(html.includes('aria-label="发布任务"'));
  assert.ok(html.includes("未接通"));
  assert.ok(html.includes("查看问题"));
  assert.ok(!html.includes("发布成功"));
  assert.ok(!html.includes("已提交"));
  assert.ok(
    renderPublish({ mode: "simulation" }).html.includes("发布（模拟）"),
  );
});
test("PageHead explanatory text is associated with keyboard accessible tooltip rather than a persistent paragraph", () => {
  const html = renderPageHead();
  assert.ok(html.includes('role="tooltip"'));
  assert.ok(html.includes("aria-describedby"));
  assert.ok(!html.includes("<p>仅在帮助中阅读的说明</p>"));
});
test("one original terms job is rendered once even when verified request scopes cover QQ and Kugou", () => {
  const terms = "同一份待确认原始协议";
  const requests = ["qqmusic", "kugou"].map((target) => ({
    id: "request-" + target,
    workId: "song-a",
    title: "原版歌曲",
    target,
    accountId: "verified",
    state: "awaiting_terms_review",
    summary: "待条款确认",
    issues: [],
    source: "local",
    configurationTarget: target,
    materialSnapshot: {
      terms: {
        jobId: "same-job",
        termsText: terms,
        termsHash: "hash",
        accepted: false,
      },
    },
  }));
  const { html } = renderPublish({
    publicationRequests: requests,
    publicationPendingTerms: [
      {
        id: "same-job",
        workId: "song-a",
        title: "原版歌曲",
        summary: "待条款确认",
        termsText: terms,
        termsHash: "hash",
        platformLabel: "腾讯音乐",
      },
    ],
  });
  assert.equal((html.match(/同一份待确认原始协议/g) || []).length, 1);
  assert.equal((html.match(/待条款确认 · 未接受条款/g) || []).length, 1);
  assert.ok(html.includes("腾讯音乐"));
});
