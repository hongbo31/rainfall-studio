import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { compileFunction } from "node:vm";
import test from "node:test";
import { build } from "esbuild";
import sharp from "sharp";

const { outputFiles } = await build({
  stdin: { contents: `export { Studio } from './src/core/studio';
    export { preparePlanCoverInbox, planCoverImage, scanCoverInbox } from './src/core/cover-inbox';
    export { PlanCenterService } from './src/core/plan-center';
    export { tickPlanCenter } from './src/core/plan-center-integration';
    export { listApiProfiles } from './src/core/api-profiles';
    export { saveGenerationConfig } from './src/core/generation-config';
    export { startCreationTask } from './src/core/creation-tasks';
    export { ApiCredentials } from './src/main/api-credentials';
    export { createPlanCoverImageRunner } from './src/main/plan-cover-image';`,
    resolveDir: process.cwd() }, bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
});
const compiled = { exports: {} };
compileFunction(outputFiles[0].text, ["module", "exports", "require", "__dirname"])(
  compiled, compiled.exports, createRequire(import.meta.url), process.cwd(),
);
const { Studio, preparePlanCoverInbox, planCoverImage, scanCoverInbox, PlanCenterService,
  tickPlanCenter, listApiProfiles, saveGenerationConfig, startCreationTask, ApiCredentials, createPlanCoverImageRunner } = compiled.exports;

function fixture(t) {
  const parent = fs.realpathSync.native(os.tmpdir());
  const root = fs.mkdtempSync(path.join(parent, "rainfall-version-covers-"));
  const studio = new Studio(root, "production");
  t.after(async () => {
    studio.close();
    assert.equal(path.dirname(fs.realpathSync.native(root)), parent);
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3 });
  });
  const work = studio.saveWork({ artistId: studio.all("artists")[0].id,
    title: "窗灯", alternateTitle: "夜归", lyrics: "雨停在窗边", story: "", prompt: "民谣" });
  work.assets = { audio_A: randomUUID(), audio_B: randomUUID() };
  studio.save("works", work);
  return { studio, work };
}

async function putImage(file, color) {
  await sharp({ create: { width: 512, height: 512, channels: 3, background: color } }).png().toFile(file);
  const before = new Date(Date.now() - 5000);
  fs.utimesSync(file, before, before);
}

test("version B has its own title, inbox, receipt and selected cover", async t => {
  const { studio, work } = fixture(t);
  const makeRequest = extra => studio.call("cover.request", { workId: work.id, requestId: randomUUID(), brief: "", ...extra });
  const primary = await makeRequest();
  const alternate = await makeRequest({ variant: "B" });
  assert.equal(primary.context.title, "窗灯");
  assert.equal(alternate.context.title, "夜归");
  assert.match(alternate.prompt, /夜归/);
  const a = await studio.call("cover.watch", { requestId: primary.id });
  const b = await studio.call("cover.watch", { requestId: alternate.id });
  assert.equal(b.variant, "B");
  const aImage = path.join(a.directory, "cover.png");
  const bImage = path.join(b.directory, "cover.png");
  await putImage(aImage, "red");
  fs.copyFileSync(aImage, bImage);
  const before = new Date(Date.now() - 5000);
  fs.utimesSync(bImage, before, before);
  await scanCoverInbox(studio);
  assert.equal(studio.get("works", work.id).assets.cover_B, undefined);
  assert.equal((await studio.call("cover.inboxStatus", { workId: work.id })).find(entry => entry.variant === "B").reason, "COVER_VERSION_DUPLICATE_IMAGE");
  await putImage(bImage, "blue");
  await scanCoverInbox(studio);
  const { cover, cover_B } = studio.get("works", work.id).assets;
  const receipts = studio.coverHandoff().list(work.id).receipts;
  assert.equal(receipts.find(receipt => receipt.requestId === primary.id).assetId, cover);
  assert.equal(receipts.find(receipt => receipt.requestId === alternate.id && receipt.variant === "B").assetId, cover_B);
  assert.notEqual(cover, cover_B);
  assert.equal(studio.coverHandoff().verifiedSelectedReceipt(work.id).request.id, primary.id);
  await assert.rejects(studio.importFile(aImage, "cover_B", work.id), /COVER_VERSION_DUPLICATE_IMAGE/);
});

test("only frozen version-aware creation work can dispatch a B plan cover", async t => {
  const { studio, work } = fixture(t);
  const profileId = randomUUID(), itemId = randomUUID(), runId = randomUUID();
  const route = { capability: "image_api", providerId: "zhipu_image", profileId, profileRevision: 1, modelId: "cogview-3-flash" };
  studio.save("settings", { id: "api-profile:" + profileId, kind: "image", providerId: route.providerId,
    revision: route.profileRevision, modelId: route.modelId });
  const snapshot = { artistId: work.artistId, material: { source: "creation" }, routeSnapshot: { image: route }, creationDraft: {} };
  const rows = { items: [{ id: itemId, workId: work.id, runId }], runs: [{ id: runId, snapshot }] };
  studio.planCenterService = () => ({ list: () => rows, next: () => ({ stage: "cover", state: "waiting", reason: "COVER_REQUIRED" }) });
  const a = preparePlanCoverInbox(studio, itemId, work.id, true);
  const b = preparePlanCoverInbox(studio, itemId, work.id, true, "B");
  const pending = () => planCoverImage(studio, "list", {}).map(task => task.requestId);
  assert.notEqual(a.requestId, b.requestId);
  assert.deepEqual(pending(), [a.requestId]);
  snapshot.creationDraft.separateVersionCovers = true;
  assert.deepEqual(pending().sort(), [a.requestId, b.requestId].sort());
  assert.match(planCoverImage(studio, "prepare", { requestId: b.requestId }).prompt, /夜归/);
  planCoverImage(studio, "dispatch", { requestId: b.requestId });
  const manual = await studio.call("cover.request", { workId: work.id, requestId: randomUUID(), brief: "", variant: "B" });
  await studio.call("cover.watch", { requestId: manual.id });
  const ongoing = (await studio.call("cover.inboxStatus", { workId: work.id })).find(entry => entry.requestId === b.requestId);
  assert.equal(ongoing.state, "waiting");
  assert.equal(ongoing.generation.state, "dispatching");
  studio.save("works", { ...work, alternateTitle: "夜归人" });
  const stale = preparePlanCoverInbox(studio, itemId, work.id, true, "B");
  assert.equal(stale.requestId, b.requestId);
  assert.equal(stale.reason, "COVER_CONTEXT_CHANGED");
  studio.save("works", { ...work, assets: { audio_A: work.assets.audio_A } });
  assert.deepEqual(pending(), [a.requestId]);
});

test("browser music sends its selected cover model and each recording's title and singer to the image API", async t => {
  const { studio, work } = fixture(t);
  const profileId = randomUUID(), itemId = randomUUID(), runId = randomUUID();
  const defaultModel = "doubao-seedream-5-5-261028", selectedModel = "doubao-seedream-5-0-pro-260628";
  const providerId = "doubao_image";
  studio.save("settings", { id: "api-profile:" + profileId, kind: "image", providerId,
    revision: 1, modelId: defaultModel, label: "方舟封面", executionEnabled: false });
  const route = { role: "image", source: "override", capability: "image_api", providerId,
    profileId, profileRevision: 1, modelId: selectedModel, modelOverride: true };
  const snapshot = { artistId: work.artistId, material: { source: "workflow" }, routeSnapshot: { image: route },
    workflow: { browserMusic: { provider: "suno_cn" } },
    workflowSnapshot: { artist: { singer: "甲歌手" }, secondSinger: { name: "乙歌手" } } };
  const rows = { items: [{ id: itemId, workId: work.id, runId }], runs: [{ id: runId, snapshot }] };
  studio.planCenterService = () => ({ list: () => rows, next: () => ({ stage: "cover", state: "waiting", reason: "COVER_REQUIRED" }) });
  const a = preparePlanCoverInbox(studio, itemId, work.id, true);
  const b = preparePlanCoverInbox(studio, itemId, work.id, true, "B");
  const images = await Promise.all(["navy", "orange"].map(background =>
    sharp({ create: { width: 1536, height: 1536, channels: 3, background } }).jpeg().toBuffer()));
  const sent = [];
  const credentials = new ApiCredentials({
    context: () => ({ mode: "production", generation: 1 }),
    getProfile: async id => listApiProfiles(studio.repo).find(profile => profile.id === id),
    vault: { isAvailable: () => true, has: () => true, get: binding => {
      assert.equal(binding.accountId, profileId);
      assert.equal(binding.providerId, providerId);
      return "fixture-only";
    } },
    connectionRequest: async request => {
      request.assertActive();
      await request.assertDispatch();
      const image = images[sent.length];
      sent.push(request.body);
      return { status: 200, body: { model: request.body.model,
        data: [{ size: "1536x1536", b64_json: image.toString("base64") }] } };
    },
  });
  const runner = createPlanCoverImageRunner({ credentials, available: () => true, generation: () => 1,
    rpc: async (method, input) => {
      assert.ok(method.startsWith("internal.planCoverImage."));
      return { ok: true, value: planCoverImage(studio, method.split(".").at(-1), input) };
    } });
  await runner.pump();
  await runner.pump();
  await runner.pump();
  assert.deepEqual(sent.map(({ model }) => model), [selectedModel, selectedModel]);
  assert.match(sent[0].prompt, /《窗灯》.*艺人 甲歌手.*歌词意象 雨停在窗边/u);
  assert.match(sent[1].prompt, /《夜归》.*艺人 乙歌手.*歌词意象 雨停在窗边/u);
  assert.equal(listApiProfiles(studio.repo)[0].modelId, defaultModel);
  const before = new Date(Date.now() - 5000);
  for (const entry of [a, b]) fs.utimesSync(path.join(entry.directory, "generated.jpg"), before, before);
  await scanCoverInbox(studio);
  const { cover, cover_B } = studio.get("works", work.id).assets;
  assert.ok(cover && cover_B);
  assert.notEqual(cover, cover_B);
});

function creationCoverFixture(t, onlyB = false) {
  const { studio, work } = fixture(t);
  if (onlyB) {
    delete work.assets.audio_A;
    studio.save("works", work);
  }
  const center = new PlanCenterService(studio.repo, {
    capabilities: { cover: { available: true }, music: { available: true } }, prepareDownloads: () => [],
  });
  studio.planCenterService = () => center;
  studio.save("accountLocalArtists", studio.get("artists", work.artistId));
  const profileId = randomUUID(), modelId = "chirp-v6";
  const imageProfileId = randomUUID();
  studio.save("settings", { id: "api-profile:" + profileId, kind: "music", providerId: "yourmusic", revision: 1, modelId, label: "音乐", executionEnabled: false });
  studio.save("settings", { id: "api-profile:" + imageProfileId, kind: "image", providerId: "zhipu_image", revision: 1, modelId: "cogview-3-flash", label: "封面", executionEnabled: false });
  saveGenerationConfig(studio.repo, { role: "music", profileId, expectedRevision: 0 });
  saveGenerationConfig(studio.repo, { role: "image", profileId: imageProfileId, expectedRevision: 1 });
  const { run } = startCreationTask(studio, { requestId: randomUUID(), artistId: work.artistId, songType: "vocal",
    draft: { title: work.title, alternateTitle: work.alternateTitle, lyrics: work.lyrics, style: work.prompt, separateVersionCovers: true },
    outputs: { cover: true, music: true }, music: { consent: true, profileId, profileRevision: 1, modelId } });
  const item = center.list().items[0];
  const versions = [...(onlyB ? [] : [{ version: "A", assetId: work.assets.audio_A }]), { version: "B", assetId: work.assets.audio_B }];
  center.bindWork({ itemId: item.id, workId: work.id, versions });
  for (const stage of ["music_submit", "music_assets"]) {
    const attempt = center.claim({ runId: run.id, itemId: item.id, stage });
    center.record({ attemptId: attempt.id, status: "succeeded", evidenceId: "fixture-receipt", result: { versions } });
  }
  return { studio, work, center, run };
}

test("a creation cover stage waits until both version covers are linked", async t => {
  const { studio, work, center, run } = creationCoverFixture(t);
  const main = path.join(studio.root, "a.png"), alternate = path.join(studio.root, "b.png");
  await putImage(main, "red");
  await putImage(alternate, "blue");
  const a = await studio.importFile(main, "cover", work.id);
  tickPlanCenter(studio);
  assert.equal(center.next({ runId: run.id }).stage, "cover");
  assert.deepEqual(studio.coverHandoff().list(work.id).requests.map(request => request.variant), ["B"]);
  const b = await studio.importFile(alternate, "cover_B", work.id);
  tickPlanCenter(studio);
  const coverStage = center.list().stageAttempts.find(attempt => attempt.stage === "cover");
  assert.equal(coverStage.state, "succeeded");
  assert.equal(coverStage.result.covers.A.assetId, a.id);
  assert.equal(coverStage.result.covers.B.assetId, b.id);
  assert.equal(studio.externalRequests, 0);
});

test("if only B audio arrives, the single cover request uses the B title and slot", async t => {
  const { studio, work, center, run } = creationCoverFixture(t, true);
  tickPlanCenter(studio);
  const requests = studio.coverHandoff().list(work.id).requests;
  assert.equal(requests.length, 1);
  assert.equal(requests[0].variant, "B");
  assert.equal(requests[0].context.title, "夜归");
  assert.deepEqual(planCoverImage(studio, "list", {}).map(task => task.requestId), [requests[0].id]);
  const image = path.join(studio.root, "b-only.png");
  await putImage(image, "blue");
  const asset = await studio.importFile(image, "cover_B", work.id);
  tickPlanCenter(studio);
  const coverStage = center.list().stageAttempts.find(attempt => attempt.runId === run.id && attempt.stage === "cover");
  assert.equal(coverStage.state, "succeeded");
  assert.equal(coverStage.result.covers.B.assetId, asset.id);
  assert.equal(coverStage.result.covers.A, undefined);
});
