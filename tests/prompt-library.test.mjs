import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { compileFunction } from "node:vm";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";

const { outputFiles } = await build({
  stdin: {
    contents: `export { Repository } from './src/core/database';
      export { Studio, baseDefaults } from './src/core/studio';
      export { freezeArtist } from './src/core/generation-config';
      export { publicationMetadataDefaults } from './src/renderer/components/PublicationMetadataForm';
      export { createPlanCoverImageRunner } from './src/main/plan-cover-image';
      export { coverResolutionInputSchema } from './src/shared/cover-handoff';
      export { Context } from './src/renderer/context';
      export { LocalArtistForm } from './src/renderer/components/LocalArtistCreator';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  packages: "external",
  format: "cjs",
  write: false,
});
const compiled = { exports: {} };
compileFunction(outputFiles[0].text, ["module", "exports", "require", "__dirname"])(
  compiled, compiled.exports, createRequire(import.meta.url), path.resolve("build"),
);
const { Repository, Studio, baseDefaults } = compiled.exports;

test("artist copies are independent and stay with the selected account", async t => {
  const studio = Object.create(Studio.prototype);
  studio.repo = new Repository(":memory:");
  t.after(() => studio.repo.close());
  const call = studio.call.bind(studio);
  const account = await call("account.save", { name: "素素", provider: "fanqie", dailyLimit: 3 });
  const other = await call("account.save", { name: "另一账号", provider: "fanqie", dailyLimit: 3 });
  const profile = { lyricist: "词作者", composer: "曲作者", singer: "歌手甲", contractMode: "non_exclusive",
    gender: "female", voicePersona: "清亮", timbreWeight: 0, styleWeight: 64.5 };
  const secondSinger = { name: "歌手乙" };
  const previousSecondSinger = { ...secondSinger, gender: "male", voicePersona: "温暖低音" };
  const fields = { defaults: baseDefaults, profile, promptTemplateId: null };
  for (const weights of [{ timbreWeight: -1 }, { styleWeight: 101 }]) {
    await assert.rejects(call("accountLocalArtist.save", { ...fields, profile: { ...profile, ...weights } }));
  }
  const saved = await call("accountLocalArtist.save", { ...fields, accountId: account.id, secondSinger: previousSecondSinger });
  assert.deepEqual(saved.secondSinger, secondSinger);
  const original = { ...saved, secondSinger: previousSecondSinger };
  studio.repo.save("accountLocalArtists", original);
  studio.repo.save("artists", { ...studio.get("artists", saved.id), secondSinger: previousSecondSinger });
  const legacy = await call("accountLocalArtist.save", fields);
  assert.deepEqual(await call("accountLocalArtist.list", { accountId: account.id }), [original]);
  assert.deepEqual(await call("accountLocalArtist.list", { accountId: other.id }), []);
  const source = { id: original.id, expected: original.revision, accountId: account.id, requestId: randomUUID() };
  const copied = await call("accountLocalArtist.copy", source);
  assert.notEqual(copied.id, original.id);
  assert.equal(copied.accountId, account.id);
  assert.equal(copied.name, "歌手甲（副本）");
  assert.deepEqual(copied.profile, profile);
  assert.deepEqual(copied.secondSinger, secondSinger);
  assert.deepEqual(await call("accountLocalArtist.copy", source), copied);
  await assert.rejects(call("accountLocalArtist.copy", { ...source, expected: source.expected + 1 }), /IDEMPOTENCY_CONFLICT/);
  await assert.rejects(call("accountLocalArtist.copy", { ...source, accountId: other.id, requestId: randomUUID() }), /ARTIST_ACCOUNT_MISMATCH/);
  const secondCopy = await call("accountLocalArtist.copy", { ...source, requestId: randomUUID() });
  assert.equal(secondCopy.name, "歌手甲（副本 2）");
  const updatedCopy = await call("accountLocalArtist.save", {
    ...fields, id: copied.id, expected: copied.revision, accountId: account.id, secondSinger: null,
  });
  assert.equal(updatedCopy.secondSinger, undefined);
  assert.deepEqual(studio.get("artists", original.id).secondSinger, previousSecondSinger);
  const linked = await call("accountLocalArtist.assign", { id: legacy.id, expected: legacy.revision, accountId: other.id });
  assert.equal(linked.id, legacy.id);
  assert.deepEqual(await call("accountLocalArtist.list", { accountId: other.id }), [linked]);
  await assert.rejects(call("accountLocalArtist.save", {
    ...fields, id: original.id, expected: original.revision, accountId: other.id,
  }), /ARTIST_ACCOUNT_MISMATCH/);
  const edited = await call("accountLocalArtist.save", {
    ...fields, id: original.id, expected: original.revision, accountId: account.id,
  });
  assert.deepEqual(edited.secondSinger, secondSinger);
  assert.deepEqual(edited.profile, profile);
});

test("A and B use their own singer in local release preparation", async t => {
  const { freezeArtist, publicationMetadataDefaults } = compiled.exports;
  const studio = Object.create(Studio.prototype);
  studio.repo = new Repository(":memory:");
  t.after(() => studio.repo.close());
  const fields = {
    defaults: baseDefaults,
    profile: { lyricist: "词作者", composer: "曲作者", singer: "原歌手甲", contractMode: "exclusive" },
    promptTemplateId: null,
  };
  const saved = await studio.call("accountLocalArtist.save", fields);
  const work = { artistId: saved.id, title: "双版本作品" };
  const metadata = (work, variant) => publicationMetadataDefaults({ ...work, selectedAudioVariant: variant }, {
    artists: studio.all("artists"),
  });
  assert.equal(metadata(work, "B").artistName, "原歌手甲");
  const paired = await studio.call("accountLocalArtist.save", {
    ...fields, id: saved.id, expected: saved.revision, secondSinger: { name: "歌手乙" },
  });
  const { artistSnapshot } = freezeArtist(studio.repo, { artistId: paired.id, routing: {} });
  const generated = { ...work, artistSnapshot };
  await studio.call("accountLocalArtist.save", {
    ...fields, id: paired.id, expected: paired.revision, secondSinger: { name: "下一轮歌手" },
  });
  assert.equal(metadata(generated, "A").artistName, "原歌手甲");
  assert.equal(metadata(generated, "B").artistName, "歌手乙");
  assert.equal(metadata({ ...generated, publicationMetadata: { artistName: "手动署名" } }, "B").artistName, "手动署名");
});

test("only new musicians on Fanqie receive the editable 1440 × 1440 preset", () => {
  const { Context, LocalArtistForm, coverResolutionInputSchema } = compiled.exports;
  const renderForm = (provider, artist) => renderToStaticMarkup(
    React.createElement(Context.Provider, { value: { data: {} } },
      React.createElement(LocalArtistForm, { provider, artist, onClose: () => {} })),
  );
  assert.match(renderForm("fanqie"), /value="1440 × 1440"/);
  assert.doesNotMatch(renderForm("netease"), /value="1440 × 1440"/);
  assert.match(renderForm("fanqie", { name: "已有艺人", defaults: { ...baseDefaults, coverResolution: 1600 } }), /value="1600 × 1600"/);
  assert.doesNotMatch(renderForm("fanqie", { name: "未设置尺寸", defaults: baseDefaults }), /value="1440 × 1440"/);
  for (const text of ["1440*1440", "1440 × 1440", "1440"]) assert.equal(coverResolutionInputSchema.parse(text), 1440);
  assert.equal(coverResolutionInputSchema.parse(""), undefined);
  assert.equal(coverResolutionInputSchema.safeParse("1440 × 1024").success, false);
});

test("a local musician's cover resolution is saved, frozen into works, and used by the cover request", async t => {
  const studio = Object.create(Studio.prototype);
  studio.repo = new Repository(":memory:");
  studio.now = () => new Date("2026-11-19T08:00:00Z");
  t.after(() => studio.repo.close());
  const profile = { lyricist: "词", composer: "曲", singer: "本地歌手", contractMode: "exclusive" };
  const input = { defaults: { ...baseDefaults, coverResolution: 2048 }, profile, promptTemplateId: null };
  const artist = await studio.call("accountLocalArtist.save", input);
  assert.equal((await studio.call("accountLocalArtist.list", {}))[0].defaults.coverResolution, 2048);
  assert.equal(studio.repo.get("artists", artist.id).defaults.coverResolution, 2048);
  await assert.rejects(studio.call("accountLocalArtist.save", { ...input, defaults: { ...input.defaults, coverResolution: 500 } }));
  const work = studio.saveWork({ artistId: artist.id, title: "雨夜", lyrics: "雨下了一夜", parameters: {} });
  const requestId = randomUUID();
  const request = studio.coverHandoff().request({ workId: work.id, requestId, brief: "" });
  assert.equal(request.imagePolicy.targetEdge, 2048);
  await studio.call("accountLocalArtist.save", {
    ...input, id: artist.id, expected: artist.revision, defaults: { ...baseDefaults, coverResolution: 3000 },
  });
  const exported = studio.coverHandoff().exportRequest(requestId);
  assert.equal(exported.resultTemplate.image.width, 2048);
  assert.equal(exported.resultTemplate.image.height, 2048);
  assert.equal(studio.saveWork({ artistId: artist.id, title: "下一首", lyrics: "", parameters: {} }).config.coverResolution, 3000);
});

test("configured cover resolution is applied to generated images before receipt", async () => {
  const source = await sharp({ create: { width: 512, height: 512, channels: 3, background: "purple" } }).png().toBuffer();
  const task = { requestId: randomUUID(), profileId: randomUUID(), expectedRevision: 1 };
  const received = [];
  let coverResolution = 1440;
  const runner = compiled.exports.createPlanCoverImageRunner({
    available: () => true, generation: () => 1,
    credentials: {
      apiCredentialStatus: async () => ({ configured: true }),
      generatePlanCover: async (_, __, beforeSend, _guard, size) => {
        assert.equal(size, coverResolution);
        await beforeSend();
        return source;
      },
    },
    rpc: async (method, input) => {
      switch (method.split(".").at(-1)) {
        case "list": return { ok: true, value: [task] };
        case "prepare": return { ok: true, value: { prompt: "红伞", coverResolution } };
        case "dispatch": return { ok: true };
        case "receive": received.push(input.bytes); return { ok: true };
        default: throw Error("unexpected action");
      }
    },
  });
  await runner.pump();
  assert.equal(received.length, 1);
  const image = await sharp(Buffer.from(received[0])).metadata();
  assert.deepEqual([image.width, image.height], [1440, 1440]);
  coverResolution = 1600;
  await runner.pump();
  const custom = await sharp(Buffer.from(received[1])).metadata();
  assert.deepEqual([custom.width, custom.height], [1600, 1600]);
  coverResolution = undefined;
  await runner.pump();
  assert.deepEqual(Buffer.from(received[2]), source);
});

test("account local musicians can be edited and deleted independently of legacy artists and their publication data", async t => {
  const studio = Object.create(Studio.prototype);
  studio.repo = new Repository(":memory:");
  studio.now = () => new Date("2026-11-19T08:00:00Z");
  t.after(() => studio.repo.close());
  const call = studio.call.bind(studio);
  const prompt = { id: randomUUID(), name: "夜雨", content: "画一张夜雨封面" };
  await call("promptLibrary.save", { ...prompt, expectedRevision: null });
  const profile = { lyricist: "词作者", composer: "曲作者", singer: "原歌手", contractMode: "non_exclusive" };
  await call("artist.save", { name: "我的艺人", defaults: baseDefaults });
  const original = await call("artist.save", { defaults: baseDefaults, profile, promptTemplateId: prompt.id });
  const account = await call("account.save", { name: "账号", provider: "fanqie", dailyLimit: 3 });
  const binding = await call("binding.save", { artistId: original.id, accountId: account.id, targets: ["fanqie"] });
  const work = studio.repo.save("works", { id: randomUUID(), artistId: original.id, title: "原作品" });
  const [local] = await call("accountLocalArtist.list");
  assert.notEqual(local.id, original.id);
  assert.deepEqual(local.profile, profile);
  assert.equal(local.promptTemplateId, prompt.id);
  assert.deepEqual(await call("accountLocalArtist.list"), [local]);

  const fields = { defaults: local.defaults, profile: { ...profile, singer: "修订歌手" }, promptTemplateId: prompt.id };
  const edited = await call("accountLocalArtist.save", { ...fields, id: local.id, expected: local.revision });
  assert.equal(edited.name, "修订歌手");
  assert.equal(edited.revision, 2);
  await assert.rejects(call("accountLocalArtist.save", { ...fields, id: local.id, expected: local.revision }), /REVISION_CONFLICT/);
  await assert.rejects(call("accountLocalArtist.delete", { id: edited.id, expected: 1, confirmed: true }), /REVISION_CONFLICT/);
  await assert.rejects(call("accountLocalArtist.delete", { id: edited.id, expected: 2, confirmed: false }));
  await call("accountLocalArtist.delete", { id: edited.id, expected: 2, confirmed: true });
  assert.deepEqual(await call("accountLocalArtist.list"), []);
  assert.deepEqual(studio.repo.get("artists", original.id), original);
  assert.deepEqual(studio.repo.get("bindings", binding.id), binding);
  assert.deepEqual(studio.repo.get("works", work.id), work);
  const standalone = await call("accountLocalArtist.save", fields);
  assert.equal(standalone.name, "修订歌手");
  assert.deepEqual(studio.get("artists", standalone.id).profile, fields.profile);
  const newWork = await call("work.save", {
    artistId: standalone.id, title: "本地音乐人作品", story: "", lyrics: "", prompt: "", parameters: {}, rights: "待确认", ai: "unknown",
  });
  assert.equal(newWork.artistId, standalone.id);
  await call("promptLibrary.delete", { id: prompt.id, expectedRevision: 1 });
  const [cleared] = await call("accountLocalArtist.list");
  assert.equal(cleared.promptTemplateId, null);
  assert.equal(studio.get("artists", standalone.id).promptTemplateId, null);
  await call("accountLocalArtist.delete", { id: standalone.id, expected: cleared.revision, confirmed: true });
  assert.deepEqual(await call("accountLocalArtist.list"), []);
  assert.deepEqual(studio.get("works", newWork.id), newWork);
  assert.equal(studio.get("artists", standalone.id).name, "修订歌手");
});

test("a saved local musician resolves a publication account directly while account authorization still applies", async t => {
  const studio = Object.create(Studio.prototype);
  studio.repo = new Repository(":memory:");
  studio.mode = "production";
  studio.now = () => new Date("2026-11-19T08:00:00Z");
  t.after(() => studio.repo.close());
  const call = studio.call.bind(studio);
  const saved = {
    id: randomUUID(), revision: 1, name: "原本地歌手", defaults: baseDefaults,
    profile: { lyricist: "词作者", composer: "曲作者", singer: "原本地歌手", contractMode: "exclusive" },
    promptTemplateId: null,
  };
  studio.repo.save("accountLocalArtists", saved);
  studio.repo.save("settings", { id: "account-local-artists:imported-v1", complete: true });
  assert.deepEqual(await call("accountLocalArtist.list"), [saved]);
  const work = await call("work.save", {
    artistId: saved.id, title: "本地作品", story: "", lyrics: "", prompt: "", parameters: {}, rights: "待确认", ai: "unknown",
  });
  const account = await call("account.save", { name: "发布账号", provider: "netease", dailyLimit: 3 });
  const input = { workIds: [work.id], targets: ["netease"], recordings: [], accountOverrides: {} };
  await assert.rejects(call("publish.quick", input), /缺少已核实授权的账号/);
  assert.deepEqual(studio.repo.all("bindings"), []);
  studio.repo.save("accounts", { ...account, authStatus: "connected", remoteSubject: "offline-fixture" });
  const result = await call("publish.quick", input);
  assert.equal(result.started, false);
  const [binding] = studio.repo.all("bindings");
  assert.equal(binding.artistId, saved.id);
  assert.equal(binding.accountId, account.id);
  assert.deepEqual(binding.operations, ["prepare"]);
  assert.equal((await call("publish.quick", input)).batch.id, result.batch.id);
  assert.equal(studio.repo.all("bindings").length, 1);
  await call("binding.revoke", { id: binding.id });
  await assert.rejects(call("publish.quick", input), /缺少已核实授权的账号/);
});

test("prompt management persists and searches prompts, enforces 50,000 characters and protects edits and deletes", async (t) => {
  const studio = Object.create(Studio.prototype);
  studio.repo = new Repository(":memory:");
  studio.now = () => new Date("2026-11-19T08:00:00Z");
  t.after(() => studio.repo.close());
  const call = studio.call.bind(studio);
  const fields = { id: randomUUID(), name: " 雨夜封面 ", content: "  Moonlight\n" + "雨".repeat(49_987) + "🌧" };
  assert.equal([...fields.content].length, 50_000);
  assert.deepEqual(await call("promptLibrary.list"), []);
  const created = await call("promptLibrary.save", { ...fields, expectedRevision: null });
  assert.equal(created.name, "雨夜封面");
  assert.equal(created.content, fields.content);
  assert.equal(created.revision, 1);
  assert.deepEqual(await call("promptLibrary.get", { id: created.id }), created);
  for (const query of ["雨夜", "moonlight"]) {
    const [match] = await call("promptLibrary.list", { query });
    assert.equal(match.id, created.id);
    assert.equal(match.content, undefined);
  }
  assert.deepEqual(await call("promptLibrary.list", { query: "找不到" }), []);
  await assert.rejects(call("promptLibrary.save", { ...fields, content: fields.content + "雨", expectedRevision: 1 }));
  await assert.rejects(call("promptLibrary.save", { ...fields, content: " \n ", expectedRevision: 1 }));
  await assert.rejects(call("promptLibrary.save", { ...fields, name: " ", expectedRevision: 1 }));
  const update = { id: created.id, name: "新封面", content: "  夜雨\n", expectedRevision: 1 };
  const edited = await call("promptLibrary.save", update);
  assert.equal(edited.revision, 2);
  assert.equal(edited.content, update.content);
  await assert.rejects(call("promptLibrary.save", update), /REVISION_CONFLICT/);
  await assert.rejects(call("promptLibrary.delete", { id: edited.id, expectedRevision: 1 }), /REVISION_CONFLICT/);
  await call("promptLibrary.delete", { id: edited.id, expectedRevision: 2 });
  assert.deepEqual(await call("promptLibrary.list"), []);
  await assert.rejects(call("promptLibrary.get", { id: edited.id }), /NOT_FOUND/);
  await assert.rejects(call("promptLibrary.save", { ...update, expectedRevision: 2 }), /REVISION_CONFLICT/);
});

test("local artist creation uses the default singer and keeps a live prompt association", async (t) => {
  const studio = Object.create(Studio.prototype);
  studio.repo = new Repository(":memory:");
  studio.now = () => new Date("2026-11-19T08:00:00Z");
  t.after(() => studio.repo.close());
  const call = studio.call.bind(studio);
  const prompt = { id: randomUUID(), name: "雨夜", content: "写一首雨夜民谣" };
  await call("promptLibrary.save", { ...prompt, expectedRevision: null });
  const credit = { lyricist: "词作者", composer: "曲作者", singer: "默认歌手甲", contractMode: "non_exclusive" };
  const artist = await call("artist.save", { defaults: baseDefaults, profile: credit, promptTemplateId: prompt.id });
  assert.equal(artist.name, credit.singer);
  assert.equal(artist.promptTemplateId, prompt.id);
  assert.deepEqual(artist.profile, credit);

  const existing = await call("artist.save", { name: "原有艺名", defaults: baseDefaults });
  const updated = await call("artist.save", { id: existing.id, expected: existing.revision, defaults: baseDefaults, promptTemplateId: prompt.id });
  assert.equal(updated.name, "原有艺名");
  assert.equal(updated.profile, undefined);
  await assert.rejects(call("artist.save", { defaults: baseDefaults, profile: credit, promptTemplateId: randomUUID() }), /ARTIST_PROMPT_NOT_FOUND/);
  assert.equal(studio.repo.all("artists").length, 2);

  await call("promptLibrary.save", { ...prompt, name: "雨夜（新版）", expectedRevision: 1 });
  assert.equal(studio.get("artists", artist.id).promptTemplateId, prompt.id);
  assert.equal((await call("promptLibrary.get", { id: artist.promptTemplateId })).name, "雨夜（新版）");
  const unlinked = await call("artist.save", { id: updated.id, expected: updated.revision, defaults: baseDefaults, promptTemplateId: null });
  assert.equal(unlinked.promptTemplateId, null);

  await call("promptLibrary.delete", { id: prompt.id, expectedRevision: 2 });
  assert.equal(studio.get("artists", artist.id).promptTemplateId, null);
  assert.equal(studio.get("artists", artist.id).revision, artist.revision + 1);
  assert.deepEqual(studio.get("artists", artist.id).profile, credit);
  assert.deepEqual(studio.get("artists", updated.id), unlinked);

  const longSinger = "歌".repeat(98) + "🎤乐队";
  const longName = await call("artist.save", { defaults: baseDefaults, profile: { ...credit, singer: longSinger } });
  assert.equal(longName.name, "歌".repeat(98) + "…");
  assert.equal(longName.profile.singer, longSinger);
});

test("deleting a local artist clears unused account links and defaults but protects dependent records", async (t) => {
  const studio = Object.create(Studio.prototype);
  studio.repo = new Repository(":memory:");
  t.after(() => studio.repo.close());
  const call = studio.call.bind(studio);
  const artist = await call("artist.save", { name: "独立艺人", defaults: baseDefaults });
  const account = await call("account.save", { name: "本地账号", provider: "netease", dailyLimit: 5 });
  const binding = await call("binding.save", { artistId: artist.id, accountId: account.id, targets: ["netease"] });
  const platform = await call("platformConfig.save", { config: {
    target: "netease", accountId: account.id, artistId: artist.id,
    lyricist: "", composer: "", album: "", language: "", genre: "", aiDisclosure: "unknown", isCover: null,
  }, expectedRevision: 0 });
  const input = { id: artist.id, expected: artist.revision, confirmed: true };
  await assert.rejects(call("artist.delete", { ...input, expected: 2 }), /REVISION_CONFLICT/);
  await assert.rejects(call("artist.delete", { ...input, confirmed: false }));

  const work = studio.repo.save("works", { id: randomUUID(), artistId: artist.id, title: "保留的作品" });
  await assert.rejects(call("artist.delete", input), /ARTIST_IN_USE/);
  assert.deepEqual(studio.repo.get("works", work.id), work);
  assert.deepEqual(studio.repo.get("bindings", binding.id), binding);
  assert.deepEqual((await call("platformConfig.list")).find(row => row.target === "netease"), platform);
  studio.repo.db.prepare("DELETE FROM works WHERE id = ?").run(work.id);

  const plan = studio.repo.save("settings", { id: "plan-center:plan:" + randomUUID(), value: { artistId: artist.id } });
  await assert.rejects(call("artist.delete", input), /ARTIST_IN_USE/);
  studio.repo.db.prepare("DELETE FROM settings WHERE id = ?").run(plan.id);
  const release = studio.repo.save("units", { id: randomUUID(), bindingId: binding.id, state: "SUBMITTED" });
  await assert.rejects(call("artist.delete", input), /ARTIST_IN_USE/);
  assert.deepEqual(studio.repo.get("units", release.id), release);
  studio.repo.db.prepare("DELETE FROM units WHERE id = ?").run(release.id);

  await call("artist.delete", input);
  assert.equal(studio.repo.maybe("artists", artist.id), undefined);
  assert.equal(studio.repo.maybe("bindings", binding.id), undefined);
  assert.deepEqual(studio.repo.get("accounts", account.id), account);
  assert.deepEqual((await call("platformConfig.list")).find(row => row.target === "netease"), {
    ...platform, artistId: null, revision: platform.revision + 1,
  });
});
