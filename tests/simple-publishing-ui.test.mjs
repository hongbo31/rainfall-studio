import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { compileFunction } from "node:vm";
import { build } from "esbuild";
const bundle = await build({
  entryPoints: ["tests/fixtures/simple-publishing-ui.tsx"],
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  loader: { ".css": "empty" },
  write: false,
});
const mod = { exports: {} };
compileFunction(bundle.outputFiles[0].text, ["module", "exports", "require"])(mod, mod.exports, createRequire(import.meta.url));
const { renderPublish, renderPageHead, renderPublicationTaskEditor } = mod.exports;

test("the main page lists publication tasks in the requested column order", () => {
  const { html, actions } = renderPublish();
  for (const text of ["任务中心", "新建任务", "查询任务"]) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /发布中心|在浏览器打开/);
  assert.deepEqual([...html.matchAll(/<th scope="col">([^<]*)<\/th>/g)].map(match => match[1]),
    ["任务名称", "执行结果", "执行方式", "关联计划", "操作"]);
  assert.doesNotMatch(html, /选择歌曲|汽水音乐自动填表上传|发布所选作品/);
  assert.equal(actions.length, 0);
});
test("the task editor shows recurrence and linked plans without a separate upload step", () => {
  const html = renderPublicationTaskEditor();
  for (const text of ["编辑任务", "任务名称", "执行方式", "按小时", "按天", "按周", "按月", "月底执行",
    "关联计划甲", "关联计划乙", "同意按顺序执行关联计划及其发布步骤", "平台条款需本人确认", "保存任务"]) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /上传并发布|发布账号|腾讯账号|汽水音乐自动填表上传/);
});
test("pending platform terms and acceptance actions stay out of the task list", () => {
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
  for (const text of ["原版歌曲", "待条款确认", terms, "hash-secret", "同意条款", "接受并提交", "非独家·3年"])
    assert.ok(!html.includes(text), text);
});
test("material checks stay out of the task list and simulation disables task creation", () => {
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
  assert.ok(html.includes('aria-label="任务列表"'));
  assert.doesNotMatch(html, /未接通|材料检查记录|原版歌曲/);
  assert.ok(!html.includes("发布成功"));
  assert.ok(!html.includes("已提交"));
  assert.match(renderPublish({ mode: "simulation" }).html, /<button[^>]*disabled=""[^>]*>＋ 新建任务/);
});
test("PageHead explanatory text is associated with keyboard accessible tooltip rather than a persistent paragraph", () => {
  const html = renderPageHead();
  assert.ok(html.includes('role="tooltip"'));
  assert.ok(html.includes("aria-describedby"));
  assert.ok(!html.includes("<p>仅在帮助中阅读的说明</p>"));
});
test("linked records for QQ and Kugou do not put platform terms on the task page", () => {
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
  assert.doesNotMatch(html, /同一份待确认原始协议|待条款确认|腾讯音乐/);
});
