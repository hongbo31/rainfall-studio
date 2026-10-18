import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const ui = createRequire(import.meta.url)(
  process.env.RAINFALL_TME_AI_PREPARE_UI_BUNDLE,
);
const button = (html, text) =>
  [...html.matchAll(/<button\b([^>]*)>(.*?)<\/button>/gs)].find(
    (m) => m[2].replace(/<[^>]*>/g, "") === text,
  );
test("preparation UI is production only and SSR never invokes the browser bridge", () => {
  assert.equal(ui.renderAiPrepareDefault("simulation"), "");
  const html = ui.renderAiPrepareDefault();
  assert.match(html, /真实页面准备/);
  assert.match(html, /尚未核对当前账户/);
  assert.match(html, /正式提交：0/);
  assert.match(html, /未正式发布/);
  assert.ok(!html.includes("未授权作品"));
  assert.ok(!html.includes('value="audio_B"'));
  assert.match(button(html, "登记本次授权")[1], /disabled/);
});
test("identity is labeled as a masked official binding fingerprint rather than a provider UID", () => {
  const html = ui.renderAiPrepare();
  assert.ok(html.includes("***1234"));
  assert.ok(html.includes("原QQ账户"));
  assert.ok(html.includes("云端测试艺人"));
  assert.match(html, /绑定指纹.*非 UID/);
  assert.match(html, /不是 OAuth/);
  assert.ok(html.includes("43208"));
  assert.ok(html.includes("920456"));
  assert.ok(!button(html, "接受条款"));
  assert.ok(!button(html, "提交审核"));
});
test("unknown and interrupted preparation expose read-only reconciliation and forbid repeat writes", () => {
  for (const state of ["unknown", "reconcile_required", "dispatching"]) {
    const html = ui.renderAiPrepare({
      state,
      reason: "INTERRUPTED_NATIVE_ACTION",
    });
    assert.match(html, /禁止重复/);
    assert.ok(html.includes("INTERRUPTED_NATIVE_ACTION"));
    assert.match(button(html, "继续准备到条款预览")[1], /disabled/);
    assert.match(button(html, "开始准备")[1], /disabled/);
    assert.ok(button(html, "只读核对"));
  }
});
test("terms view preserves the three-year restriction and stays at an unaccepted endpoint", () => {
  const html = ui.renderAiPrepare({
    state: "awaiting_terms_review",
    terms: {
      termsText: "非独家授权3年，期间歌曲不可独家授权其他平台",
      modeText: "非独家授权",
      termsHash: "a".repeat(64),
      observedAt: "2026-10-16T20:01:00Z",
    },
  });
  assert.match(html, /授权3年，期间歌曲不可独家授权其他平台/);
  assert.match(html, /待条款确认/);
  assert.match(html, /未接受条款/);
  assert.match(button(html, "继续准备到条款预览")[1], /disabled/);
  assert.ok(!button(html, "提交审核"));
});
test("busy, missing account inspection and missing consent disable preparation writes", () => {
  for (const options of [
    { busy: true },
    { inspection: null },
    { consent: false },
  ]) {
    const html = ui.renderAiPrepare(options);
    assert.match(button(html, "继续准备到条款预览")[1], /disabled/);
    assert.match(button(html, "开始准备")[1], /disabled/);
  }
  const ready = ui.renderAiPrepare();
  assert.ok(!/disabled/.test(button(ready, "继续准备到条款预览")[1]));
});

test("only the original unselected cover picker can expose one constrained resume action", () => {
  const pending = {
    state: "reconcile_required",
    reason: "FILE_NAME_CONTROL_REQUIRED",
  };
  const html = ui.renderAiPrepare(pending);
  assert.ok(button(html, "续接原封面文件选择器"));
  assert.ok(!/disabled/.test(button(html, "续接原封面文件选择器")[1]));
  assert.match(html, /原生.*尚未选文件/);
  assert.match(html, /账号.*窗口.*目录.*重新核对/);
  assert.match(html, /一次续接/);
  assert.match(html, /不会重开上传/);
  for (const options of [
    { busy: true },
    { consent: false },
    { inspection: null },
  ]) {
    assert.match(
      button(
        ui.renderAiPrepare({ ...pending, ...options }),
        "续接原封面文件选择器",
      )[1],
      /disabled/,
    );
  }
  for (const options of [
    { state: "unknown", reason: "FILE_NAME_CONTROL_REQUIRED" },
    { state: "dispatching", reason: "FILE_NAME_CONTROL_REQUIRED" },
    { state: "ready", reason: "FILE_NAME_CONTROL_REQUIRED" },
    { state: "reconcile_required", reason: "INTERRUPTED_NATIVE_ACTION" },
  ])
    assert.ok(!button(ui.renderAiPrepare(options), "续接原封面文件选择器"));
});

test("only the existing cover crop group exposes a consent-bound one-time confirmation", () => {
  const pending = {
    state: "reconcile_required",
    reason: "CROP_DIALOG_SCOPE_REQUIRED",
  };
  const html = ui.renderAiPrepare(pending);
  assert.ok(button(html, "续接原封面裁剪"));
  assert.ok(!/disabled/.test(button(html, "续接原封面裁剪")[1]));
  assert.match(html, /现有.*调整图片.*分组/);
  assert.match(html, /不重选.*不重传/);
  assert.match(html, /一次/);
  assert.ok(!button(html, "续接原封面文件选择器"));
  for (const options of [
    { busy: true },
    { consent: false },
    { inspection: null },
  ]) {
    assert.match(
      button(
        ui.renderAiPrepare({ ...pending, ...options }),
        "续接原封面裁剪",
      )[1],
      /disabled/,
    );
  }
  for (const options of [
    { state: "unknown", reason: "CROP_DIALOG_SCOPE_REQUIRED" },
    { state: "dispatching", reason: "CROP_DIALOG_SCOPE_REQUIRED" },
    { state: "ready", reason: "CROP_DIALOG_SCOPE_REQUIRED" },
    { state: "reconcile_required", reason: "FILE_NAME_CONTROL_REQUIRED" },
    { state: "reconcile_required", reason: "INTERRUPTED_NATIVE_ACTION" },
  ])
    assert.ok(!button(ui.renderAiPrepare(options), "续接原封面裁剪"));
});

test("album preparation labels local snapshots honestly and preserves an unknown optional website save", () => {
  const html = ui.renderAiPrepare({
    step: "save_album",
    localAlbumSnapshot: { externalSaveOutcome: "unknown", localVerified: true },
  });
  assert.match(html, /核对并留存专辑材料快照/);
  assert.match(
    html,
    /专辑快照为本地核对记录；不代表官网保存、正式提交或上架回执/,
  );
  assert.match(
    html,
    /可选官网保存结果未知，未重试；已核对本地材料快照，继续仅投稿前预检/,
  );
  assert.ok(!html.includes("保存专辑资料"));
  assert.ok(!html.includes("官网保存成功"));
});
