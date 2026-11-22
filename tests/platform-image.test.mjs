import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { compileFunction } from "node:vm";
import test from "node:test";
import { buildSync } from "esbuild";
import sharp from "sharp";

const { outputFiles } = buildSync({ stdin: { resolveDir: import.meta.dirname + "/..", contents: `
  export { Repository } from './src/core/database';
  export { listApiProfiles, saveApiProfile } from './src/core/api-profiles';
  export { readGenerationConfig } from './src/core/generation-config';
  export { prepareImageCredentialProfile, resolvePlatformImage, setDefaultImageProfile } from './src/core/platform-image';
  export { ApiCredentials } from './src/main/api-credentials';
  export { createPlatformImageGenerator } from './src/main/platform-image';
` }, bundle: true, write: false, platform: "node", format: "cjs", packages: "external" });
const module = { exports: {} };
compileFunction(outputFiles[0].text, ["module", "exports", "require", "__dirname"])(
  module, module.exports, createRequire(import.meta.url), import.meta.dirname,
);
const { Repository, listApiProfiles, saveApiProfile, readGenerationConfig, prepareImageCredentialProfile,
  resolvePlatformImage, setDefaultImageProfile, ApiCredentials, createPlatformImageGenerator } = module.exports;
const identity = profile => ({ profileId: profile.id, expectedRevision: profile.revision, providerId: profile.providerId, modelId: profile.modelId });

test("each image provider reuses its own profile and default initialization preserves an existing workflow choice", t => {
  const repo = new Repository(":memory:");
  t.after(() => repo.close());
  const prior = saveApiProfile(repo, { profile: { id: randomUUID(), providerId: "zhipu_image", kind: "image",
    label: "已有智谱配置", modelId: "glm-image", executionEnabled: false }, expectedRevision: null });
  assert.deepEqual(prepareImageCredentialProfile(repo, { providerId: "zhipu_image" }), prior);
  const openai = prepareImageCredentialProfile(repo, { providerId: "openai_image" });
  assert.deepEqual(prepareImageCredentialProfile(repo, { providerId: "openai_image" }), openai);
  assert.notEqual(openai.id, prior.id);
  assert.equal(listApiProfiles(repo).length, 2);
  setDefaultImageProfile(repo, { ...identity(prior), onlyIfUnset: true });
  setDefaultImageProfile(repo, { ...identity(openai), onlyIfUnset: true });
  assert.equal(readGenerationConfig(repo).roles.image, prior.id);
  assert.equal(listApiProfiles(repo).find(profile => profile.id === prior.id)?.revision, 1);
  setDefaultImageProfile(repo, { ...identity(openai), modelId: "gpt-image-2.6-sunburst" });
  assert.equal(readGenerationConfig(repo).roles.image, openai.id);
  assert.equal(listApiProfiles(repo).find(profile => profile.id === openai.id)?.modelId, "gpt-image-2.6-sunburst");
});

test("platform image generation uses the selected model and artist resolution without changing the saved workflow model", async t => {
  const repo = new Repository(":memory:");
  t.after(() => repo.close());
  const profile = prepareImageCredentialProfile(repo, { providerId: "openai_image" });
  const accountId = randomUUID(), artistId = randomUUID();
  repo.save("accounts", { id: accountId, name: "发行账号", provider: "tme" });
  const artist = { id: artistId, accountId, name: "测试艺人", defaults: { coverResolution: 1440 } };
  repo.save("accountLocalArtists", artist);
  const providerImage = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "navy" } }).jpeg().toBuffer();
  const requests = [];
  let changeArtistBeforeDispatch = false;
  const credentials = new ApiCredentials({ context: () => ({ mode: "production", generation: 1 }),
    getProfile: async id => listApiProfiles(repo).find(profile => profile.id === id),
    vault: { get: binding => {
      assert.deepEqual([binding.accountId, binding.providerId], [profile.id, "openai_image"]);
      return "fixture-only";
    } },
    connectionRequest: async request => {
      if (changeArtistBeforeDispatch) repo.save("accountLocalArtists", { ...artist, defaults: { coverResolution: 1536 } });
      await request.assertDispatch();
      requests.push(request);
      return { status: 200, body: { data: [{ b64_json: providerImage.toString("base64") }] } };
    } });
  const generate = createPlatformImageGenerator({ credentials, captureWorkspace: () => () => {},
    rpc: async (method, input) => {
      assert.equal(method, "internal.platformImage.scope");
      try { return { ok: true, value: resolvePlatformImage(repo, input) }; }
      catch (error) { return { ok: false, error: { code: error.message } }; }
    } });
  const request = { ...identity(profile), modelId: "gpt-image-2.6-sunburst", platform: "qqmusic", artistId, resolution: 1440,
    prompt: "雨夜玻璃上的霓虹倒影" };
  await assert.rejects(generate({ ...request, platform: "fanqie" }), /IMAGE_ARTIST_PLATFORM_MISMATCH/u);
  await assert.rejects(generate({ ...request, modelId: "glm-image" }), /IMAGE_MODEL_REQUIRED/u);
  assert.equal(requests.length, 0);
  const result = await generate(request);
  assert.deepEqual(requests.map(({ body }) => [body.model, body.prompt]), [[request.modelId, request.prompt]]);
  const decoded = await sharp(Buffer.from(result.base64, "base64")).metadata();
  assert.deepEqual([decoded.width, decoded.height, decoded.format], [1440,1440,"jpeg"]);
  assert.equal(listApiProfiles(repo)[0].modelId, "gpt-image-2.6-flare");
  changeArtistBeforeDispatch = true;
  await assert.rejects(generate(request), /IMAGE_RESOLUTION_CHANGED/u);
  assert.equal(requests.length, 1);
});
