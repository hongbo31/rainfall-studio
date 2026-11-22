import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { compileFunction } from "node:vm";
import test from "node:test";
import { buildSync } from "esbuild";
import sharp from "sharp";

const source = buildSync({
  stdin: { contents: `
    export { ApiCredentials } from './src/main/api-credentials';
    export { nodeHttpsTransport } from './src/core/workflow/yourmusic';
    export { planCoverImage } from './src/core/cover-inbox';
    export { Repository } from './src/core/database';
  `, resolveDir: process.cwd() }, bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
});
const module = { exports: {} };
const require = createRequire(import.meta.url);
const memoryFiles = { ...fs, existsSync: () => false, mkdirSync: () => {} };
const stubs = new Map([
  ["node:fs", memoryFiles],
  ["node:dns", { promises: { lookup: async () => [{ address: "93.184.216.34", family: 4 }] } }],
]);
compileFunction(source.outputFiles[0].text, ["module", "exports", "require", "__dirname"])(
  module, module.exports, name => stubs.get(name) ?? require(name), process.cwd(),
);
const { ApiCredentials, nodeHttpsTransport, planCoverImage, Repository } = module.exports;
const imageHost = "maas-watermark-prod-new.cn-wlcb.ufileos.com";

test("Zhipu's current image CDN is accepted for anonymous binary GET only", async () => {
  const profile = { id: randomUUID(), kind: "image", providerId: "zhipu_image", modelId: "cogview-3-flash",
    executionEnabled: false, revision: 1, label: "智谱" };
  const url = "https://" + imageHost + "/fixture.png?expires=123&signature=fixture";
  const bytes = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "purple" } }).png().toBuffer();
  const methods = [];
  const sizes = [];
  const api = new ApiCredentials({
    context: () => ({ mode: "production", generation: 1 }),
    getProfile: async () => profile, vault: { get: () => "fixture" },
    connectionRequest: async request => {
      methods.push(request.method);
      if (request.method === "POST") {
        assert.equal(new URL(request.url).hostname, "open.bigmodel.cn");
        sizes.push(request.body.size);
        await request.assertDispatch();
        return { status: 200, body: { data: [{ url }] } };
      }
      assert.equal(request.url, url);
      assert.equal(request.headers, undefined);
      assert.equal(request.binary, true);
      return { status: 200, body: bytes };
    },
  });
  for (const size of [undefined, 1440, 1600]) {
    assert.deepEqual(await api.generatePlanCover({ profileId: profile.id, expectedRevision: 1 }, "雨夜",
      async () => {}, () => {}, size), bytes);
  }
  assert.deepEqual(methods, ["POST", "GET", "POST", "GET", "POST", "GET"]);
  assert.deepEqual(sizes, ["1024x1024", "1440x1440", "1024x1024"]);
  await assert.rejects(nodeHttpsTransport({ method: "GET", url, binary: true, headers: { Authorization: "fixture" } }), /DOWNLOAD_AUTH_REJECTED/);
  await assert.rejects(nodeHttpsTransport({ method: "POST", url, binary: true }), /HTTP_HOST_REJECTED/);
  await assert.rejects(nodeHttpsTransport({ method: "GET", url: "https://unrelated.cn-wlcb.ufileos.com/fixture.png", binary: true }), /HTTP_HOST_REJECTED/);
});

test("Zhipu image HTTP 400 keeps its numeric error code without the provider's message", async () => {
  const profile = { id: randomUUID(), kind: "image", providerId: "zhipu_image", modelId: "cogview-3-flash",
    executionEnabled: false, revision: 1, label: "智谱" };
  let code = "1261";
  const api = new ApiCredentials({ context: () => ({ mode: "production", generation: 1 }),
    getProfile: async () => profile, vault: { get: () => "fixture" },
    connectionRequest: async request => {
      assert.equal(request.method, "POST");
      await request.assertDispatch();
      return { status: 400, body: { error: { code, message: "provider-private-body" } } };
    } });
  const request = () => api.generatePlanCover({ profileId: profile.id, expectedRevision: 1 }, "雨夜", async () => {}, () => {});
  await assert.rejects(request, { message: "IMAGE_HTTP_400", cause: "1261" });
  code = "provider-private-body";
  await assert.rejects(request, error => error.message === "IMAGE_HTTP_400" && error.cause === undefined);
});

test("OpenAI cover generation sends the selected GPT Image 2.6 version", async () => {
  const profile = { id: randomUUID(), kind: "image", providerId: "openai_image", modelId: "gpt-image-2.6-sunburst",
    executionEnabled: false, revision: 1, label: "OpenAI" };
  const bytes = await sharp({ create: { width: 512, height: 512, channels: 3, background: "blue" } }).jpeg().toBuffer();
  const api = new ApiCredentials({
    context: () => ({ mode: "production", generation: 1 }),
    getProfile: async () => profile, vault: { get: () => "fixture" },
    connectionRequest: async request => {
      assert.equal(request.url, "https://api.openai.com/v1/images/generations");
      assert.deepEqual(request.body, { model: profile.modelId, prompt: "晚风", size: "2048x2048",
        quality: "medium", n: 1, output_format: "jpeg" });
      await request.assertDispatch();
      return { status: 200, body: { data: [{ b64_json: bytes.toString("base64") }] } };
    },
  });
  assert.deepEqual(await api.generatePlanCover({ profileId: profile.id, expectedRevision: 1 }, "晚风", async () => {}, () => {}), bytes);
});

test("the Ark image route is scoped to the fixed single-image HTTPS endpoint", async () => {
  const url = "https://ark.cn-beijing.volces.com/api/v3/images/generations";
  const assertDispatch = async () => { throw Error("STOP_BEFORE_SOCKET"); };
  const request = { method: "POST", url, purpose: "doubao_image", assertDispatch };
  await assert.rejects(nodeHttpsTransport(request), /STOP_BEFORE_SOCKET/);
  for (const input of [
    { ...request, purpose: undefined },
    { ...request, method: "GET" },
    { ...request, url: url + "?override=1" },
    { ...request, url: "https://ark.cn-beijing.volces.com/api/v3/chat/completions" },
    { ...request, url: "https://api.openai.com/v1/images/generations" },
  ]) await assert.rejects(nodeHttpsTransport(input), /HTTP_HOST_REJECTED/);
});

test("image Key checks can only reach the documented read-only endpoints", async () => {
  for (const url of [
    "https://api.openai.com/v1/models",
    "https://open.bigmodel.cn/api/paas/v4/files?purpose=batch&limit=1",
    "https://ark.cn-beijing.volces.com/api/v3/models",
  ]) {
    const assertDispatch = async () => { throw Error("STOP_BEFORE_SOCKET"); };
    const request = { method: "GET", url, purpose: "image_credential_check", assertDispatch };
    await assert.rejects(nodeHttpsTransport(request), /STOP_BEFORE_SOCKET/);
    for (const invalid of [
      { ...request, purpose: undefined },
      { ...request, method: "POST" },
      { ...request, body: {} },
      { ...request, binary: true },
      { ...request, url: url + (url.includes("?") ? "&" : "?") + "limit=50" },
      { ...request, url: "https://api.openai.com/v1/images/generations" },
    ]) await assert.rejects(nodeHttpsTransport(invalid), /HTTP_HOST_REJECTED/);
  }
});

for (const [provider, modelId] of [
  ["zhipu_image", "cogview-3-flash"], ["zhipu_image", "glm-image"],
  ["doubao_image", "doubao-seedream-5-0-pro-260628"],
]) test(`a waiting plan can explicitly retry its unfinished ${modelId} cover`, t => {
  const repo = new Repository(":memory:");
  t.after(() => repo.close());
  const ids = Object.fromEntries(["workId", "requestId", "profileId", "itemId", "runId"].map(key => [key, randomUUID()]));
  repo.save("works", { id: ids.workId, assets: {} });
  repo.save("settings", { id: "api-profile:" + ids.profileId, kind: "image", providerId: provider,
    revision: 1, modelId });
  const entry = { requestId: ids.requestId, workId: ids.workId, planItemId: ids.itemId, state: "waiting",
    generation: { state: "unknown", reason: "IMAGE_DOWNLOAD_URL_REJECTED" } };
  const key = "cover-inbox:" + ids.requestId;
  repo.save("settings", { id: key, value: entry });
  const route = { capability: "image_api", providerId: provider, profileId: ids.profileId, profileRevision: 1, modelId };
  const request = { workId: ids.workId, provider, generationRoute: route, prompt: "雨夜" };
  let active = true;
  const center = {
    list: () => ({ items: [{ id: ids.itemId, workId: ids.workId, runId: ids.runId }],
      runs: [{ id: ids.runId, snapshot: { routeSnapshot: { image: route } } }] }),
    next: () => active ? { stage: "cover", state: "waiting", reason: "COVER_REQUIRED" } : null,
  };
  const studio = { repo, root: path.resolve("fixture-covers"), mode: "production", save: repo.save.bind(repo),
    planCenterService: () => center, coverHandoff: () => ({ get: () => request, exportRequest: () => request }) };
  const run = (action, input = {}) => repo.transaction(() => planCoverImage(studio, action, input));
  const required = { requestId: ids.requestId, workId: ids.workId };
  const paid = modelId !== "cogview-3-flash";
  const input = paid ? { ...required, confirmedModelId: modelId } : required;
  const action = provider === "zhipu_image" ? "retryZhipu" : "retryImage";
  assert.deepEqual(run("list"), []);
  if (paid) assert.throws(() => run(action, required), /IMAGE_MODEL_CONFIRMATION_REQUIRED/);
  assert.throws(() => run(action, { ...input, workId: randomUUID() }), /COVER_SCOPE_MISMATCH/);
  assert.equal(run(action, input).generation, undefined);
  assert.equal(run("list")[0].model, modelId);
  run("dispatch", { requestId: ids.requestId });
  assert.throws(() => run(action, input), /COVER_GENERATION_PENDING/);
  repo.save("settings", { id: key, value: entry });
  active = false;
  assert.throws(() => run(action, input), /COVER_SCOPE_MISMATCH/);
});
