import { _electron as electron } from "@playwright/test";
import { openCreationWork } from "./lib/open-creation-work.mjs";
import electronPath from "electron";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { randomUUID, createHash } from "node:crypto";
import sharp from "sharp";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url),
  { Studio } = require("../build/core.cjs");
const run = path.resolve("output/playwright/cover-lyrics-" + randomUUID()),
  root = path.join(run, "data");
fs.mkdirSync(run, { recursive: true });
const digest = (p) =>
  createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const supplied = !!process.env.RAINFALL_QA_AUDIO;
let audio = process.env.RAINFALL_QA_AUDIO,
  cover = process.env.RAINFALL_QA_COVER;
if (!supplied) {
  audio = path.join(run, "fixture.wav");
  fs.writeFileSync(audio, require("../build/workflow.cjs").fixtureTone());
  cover = path.join(run, "fixture.png");
  await sharp({
    create: { width: 640, height: 640, channels: 3, background: "#685074" },
  })
    .png()
    .toFile(cover);
}
assert(audio && cover);
const originalHashes = { audio: digest(audio), cover: digest(cover) };
const raw = supplied
  ? fs.readFileSync(process.env.RAINFALL_QA_LYRICS, "utf8")
  : "[Verse 1 - Male]\n这只是本地隔离歌词\n[Female]\n所以今天 算什么关系\n[Chorus - Duet]\n我们一起走\n我们一起走";
const s = new Studio(root, "production"),
  artist = s.all("artists")[0];
const work = s.saveWork({
  title: supplied ? "从今天起" : "封面歌词隔离验收",
  artistId: artist.id,
  story: "晚餐后牵手走进暮色",
  lyrics: raw,
  prompt: "",
  parameters: {},
  rights: "",
  ai: "unknown",
});
s.close();
let app;
const errors = [],
  checks = [];
try {
  app = await electron.launch({
    executablePath: electronPath,
    args: [path.resolve(".")],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined,
      RAINFALL_DATA_ROOT: root,
      RAINFALL_MODE: "production",
    },
    timeout: 30000,
  });
  await app.evaluate(({ session, BrowserWindow }) => {
    globalThis.__coverRequests = [];
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ["http://*/*", "https://*/*"] },
      (d, cb) => {
        globalThis.__coverRequests.push(d.url);
        cb({ cancel: true });
      },
    );
  });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1440, 1000),
  );
  page.setDefaultTimeout(12000);
  page.on("pageerror", (e) => errors.push(e.message));
  const choose = async (file) =>
    app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      });
    }, file);
  const rpc = async (method, input) =>
    page.evaluate(
      async ({ method, input }) => {
        const r = await window.rainfall.call(method, input);
        if (!r.ok) throw Error(r.error.code);
        return r.value;
      },
      { method, input },
    );
  await page.getByRole("button", { name: "封面工作室", exact: true }).click();
  await page.getByText(/图片接口未配置/).waitFor();
  await page
    .getByRole("button", { name: "创建封面生成请求", exact: true })
    .click();
  await page
    .getByRole("button", { name: "导出 dot 请求 JSON", exact: true })
    .waitFor();
  const requestId = await page.getByLabel("当前封面请求").inputValue();
  assert(requestId);
  const destination = path.join(run, "cover-request.json");
  await app.evaluate(({ dialog }, destination) => {
    dialog.showSaveDialog = async () => ({
      canceled: false,
      filePath: destination,
    });
  }, destination);
  await page
    .getByRole("button", { name: "导出 dot 请求 JSON", exact: true })
    .click();
  await page.waitForTimeout(150);
  const request = JSON.parse(fs.readFileSync(destination, "utf8"));
  assert.equal(request.workId, work.id);
  assert.equal(request.id, requestId);
  checks.push(
    "UI creates and exports a song/context-bound awaiting-result request",
  );
  await choose(cover);
  await page
    .getByRole("button", { name: "接收当前请求的真实图片", exact: true })
    .click();
  await page
    .getByRole("button", { name: "选为歌曲封面", exact: true })
    .waitFor();
  let list = await rpc("cover.list", { workId: work.id });
  assert.equal(list.receipts.length, 1);
  assert.equal(list.receipts[0].generationVerified, false);
  assert.equal((await rpc("snapshot", {})).works[0].assets.cover, undefined);
  await page.getByRole("button", { name: "选为歌曲封面", exact: true }).click();
  await page
    .getByRole("button", { name: "已选为歌曲封面", exact: true })
    .waitFor();
  const selected = (await rpc("snapshot", {})).works[0].assets.cover;
  assert(selected);
  checks.push(
    "Real image file passes Main/preload/Core ingress and selection is explicit",
  );
  await choose(cover);
  await page
    .getByRole("button", { name: "接收当前请求的真实图片", exact: true })
    .click();
  assert.equal(
    (await rpc("cover.list", { workId: work.id })).receipts.length,
    1,
  );
  await page
    .getByRole("button", { name: "创建封面生成请求", exact: true })
    .click();
  assert.equal((await rpc("snapshot", {})).works[0].assets.cover, selected);
  checks.push(
    "Duplicate receive is idempotent and regeneration request preserves chosen cover",
  );
  await page.getByTestId("cover-handoff").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(run, "cover-handoff.png") });
  await openCreationWork(page, work.id);
  await choose(audio);
  await page.getByRole("button", { name: "导入音频 A", exact: true }).click();
  await page.getByText("本地音频已受管", { exact: true }).waitFor();
  await page.getByTestId("lyrics-publication").scrollIntoViewIfNeeded();
  await page.getByLabel("发布纯文本歌词", { exact: true }).waitFor();
  const plain = await page
    .getByLabel("发布纯文本歌词", { exact: true })
    .inputValue();
  assert(!plain.includes("[Verse"));
  assert(plain.includes("所以今天 算什么关系"));
  assert.equal(
    await page.getByLabel("发布歌词原稿", { exact: true }).inputValue(),
    raw,
  );
  assert.equal(
    await page
      .getByRole("checkbox", {
        name: "已试听选定音频，确认当前纯文本歌词逐行匹配",
        exact: true,
      })
      .isChecked(),
    false,
  );
  assert(
    await page
      .getByRole("button", { name: "保存本次匹配确认", exact: true })
      .isDisabled(),
  );
  checks.push(
    "Original dialogue and repeated lines retained; actual-audio lyric match is not falsely confirmed",
  );
  const txt = path.join(run, "same-original-lyrics.txt");
  fs.writeFileSync(txt, raw);
  await choose(txt);
  await page.getByRole("button", { name: "导入歌词 TXT", exact: true }).click();
  assert.equal((await rpc("lyrics.preview", { workId: work.id })).raw, raw);
  const payload = await rpc("publication.payload", { workId: work.id });
  assert.equal(payload.cover.assetId, selected);
  assert.equal(payload.audio.sha256, originalHashes.audio);
  assert.equal(payload.lyrics.plainText, plain);
  assert.equal(payload.lyrics.alignmentConfirmed, false);
  fs.writeFileSync(
    path.join(run, "publication-payload.json"),
    JSON.stringify(payload, null, 2),
  );
  checks.push(
    "Unified payload carries selected real cover, actual managed audio and plain lyrics with pending match",
  );
  await page.screenshot({ path: path.join(run, "lyrics-preview.png") });
  // Exercise the real Main handler across a completed restore, without user dialogs/data.
  const backup = path.join(run, "dialog-scope.rainfall-backup.zip");
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, backup);
  const exported = await page.evaluate(() =>
    window.rainfall.exportFile("backup", {}),
  );
  assert.equal(exported.ok, true);
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = () =>
      new Promise((resolve) => {
        globalThis.__pendingCoverDialog = resolve;
      });
  });
  await page.evaluate(
    ({ workId }) => {
      window.__pendingLyricImport = window.rainfall.pickImport(
        "lyrics",
        workId,
      );
    },
    { workId: work.id },
  );
  await app.evaluate(async () => {
    if (!globalThis.__pendingCoverDialog) throw Error("DIALOG_NOT_PENDING");
  });
  await choose(backup);
  const restored = await page.evaluate(() =>
    window.rainfall.pickImport("backup"),
  );
  assert.equal(restored.ok, true);
  const stale = path.join(run, "stale-dialog.txt");
  fs.writeFileSync(stale, "stale dialog must not overwrite restored lyrics");
  await app.evaluate(
    (_e, file) =>
      globalThis.__pendingCoverDialog({ canceled: false, filePaths: [file] }),
    stale,
  );
  const staleResult = await page.evaluate(() => window.__pendingLyricImport);
  assert.equal(
    staleResult.ok,
    false,
    "restoration must invalidate earlier native file dialogs",
  );
  assert.equal(staleResult.error.code, "WORKSPACE_CHANGED");
  assert.equal((await rpc("lyrics.preview", { workId: work.id })).raw, raw);
  checks.push(
    "Pending native lyrics dialog is rejected after completed backup restore",
  );
  assert.deepEqual(errors, []);
  const requests = await app.evaluate(() => globalThis.__coverRequests);
  assert.deepEqual(requests, []);
  await app.close();
  app = undefined;
  const reopened = new Studio(root, "production");
  try {
    assert.equal(reopened.get("works", work.id).assets.cover, selected);
    assert.equal(reopened.lyricService().preview(work.id).raw, raw);
    assert.equal(reopened.coverHandoff().list(work.id).requests.length, 2);
  } finally {
    reopened.close();
  }
  assert.deepEqual(
    { audio: digest(audio), cover: digest(cover) },
    originalHashes,
  );
  checks.push("Restart persistence verified; supplied originals unchanged");
  fs.writeFileSync(
    path.join(run, "report.json"),
    JSON.stringify(
      {
        passed: true,
        checks,
        materialSource: supplied
          ? "user-supplied-real-files"
          : "isolated-fixture",
        realProviderCalls: 0,
        realPlatformUploads: 0,
        reviewSubmissions: 0,
        lyricAudioMatchConfirmed: false,
        rendererErrors: errors,
        observedElectronRequests: requests,
        root,
        workId: work.id,
        originalHashes,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, run, checks }, null, 2));
} finally {
  if (app) await app.close();
}
