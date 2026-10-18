import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import path from "node:path";
const out = path.resolve("output/publication-metadata-form/test.cjs");
await build({
  stdin: {
    contents: `import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Form,{publicationMetadataDefaults,savePublicationMetadata,metadataLocked} from './src/renderer/components/PublicationMetadataForm';export {publicationMetadataDefaults,savePublicationMetadata,metadataLocked};export const render=(props)=>renderToStaticMarkup(<Form {...props}/>);`,
    loader: "tsx",
    resolveDir: process.cwd(),
  },
  outfile: out,
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
});
const {
  render,
  publicationMetadataDefaults: defaults,
  savePublicationMetadata: save,
  metadataLocked: locked,
} = createRequire(import.meta.url)(out);
const work = {
  id: "work-1",
  title: "测试歌曲",
  revision: 3,
  artistId: "artist",
  config: { genre: "流行", language: "国语" },
};
const data = {
  works: [work],
  artists: [{ id: "artist", name: "歌手甲" }],
  accounts: [{ id: "account", name: "测试账号", provider: "tme" }],
  platformConfigurations: [
    {
      target: "qqmusic",
      album: "测试专辑",
      lyricist: "词作者",
      composer: "曲作者",
    },
  ],
};
const job = {
  workId: work.id,
  accountId: "account",
  targets: ["qqmusic", "kugou"],
  state: "blocked",
};
const full = {
  albumTitle: "测试专辑",
  albumDescription: "专辑介绍",
  artistName: "歌手甲",
  lyricist: "词作者",
  composer: "曲作者",
  ownLyrics: "false",
  ownComposition: "true",
  allowCover: "false",
  aiTool: "实际工具",
  generatedOn: "2026-01-01",
  genre: "流行",
  language: "国语",
  version: "完整版",
  releaseMode: "审核通过即发布",
};
test("defaults use stored facts while unknown rights, AI tool and date stay blank", () => {
  const v = defaults(work, data);
  assert.equal(v.artistName, "歌手甲");
  assert.equal(v.albumTitle, "测试专辑");
  for (const k of [
    "ownLyrics",
    "ownComposition",
    "allowCover",
    "aiTool",
    "generatedOn",
    "albumDescription",
  ])
    assert.equal(v[k], "");
  assert.equal(
    defaults(
      { ...work, publicationMetadata: { ownLyrics: false, allowCover: true } },
      data,
    ).ownLyrics,
    "false",
  );
});
test("compact form exposes missing fields and exact work/account context", () => {
  const html = render({ work, data, job });
  assert.match(html, /<summary>投稿资料<\/summary>/);
  assert.doesNotMatch(html, /<details[^>]*open/);
  assert.match(html, /测试歌曲/);
  assert.match(html, /测试账号/);
  assert.match(html, /account/);
  for (const label of [
    "专辑介绍",
    "AI 工具",
    "生成日期",
    "拥有词版权",
    "拥有曲版权",
    "允许翻唱",
  ])
    assert.ok(html.includes(label));
  assert.match(html, /<option value="" selected="">请选择/);
});
test("save validates facts, binds revision and converts explicit booleans before refreshing", async () => {
  const calls = [];
  await assert.rejects(
    save({
      work,
      job,
      metadata: defaults(work, data),
      expectedRevision: 3,
      call: async () => calls.push("unexpected"),
      refresh: async () => {},
    }),
    /请补齐/,
  );
  assert.deepEqual(calls, []);
  await save({
    work,
    job,
    metadata: full,
    expectedRevision: 3,
    call: async (method, input) => calls.push({ method, input }),
    refresh: async () => calls.push("refresh"),
  });
  assert.equal(calls[0].method, "publish.metadata.save");
  assert.equal(calls[0].input.workId, "work-1");
  assert.equal(calls[0].input.expectedRevision, 3);
  assert.equal(calls[0].input.metadata.ownLyrics, false);
  assert.equal(calls[0].input.metadata.ownComposition, true);
  assert.equal(calls[1], "refresh");
});
test("stale revisions and dispatched or mutating tasks cannot save", async () => {
  for (const state of [
    "preparing",
    "awaiting_confirmation",
    "reconcile_required",
    "reviewing",
    "published",
    "rejected",
  ])
    assert.equal(locked({ ...job, state }), true);
  assert.equal(locked({ ...job, dispatchedAt: "now" }), true);
  for (const override of [
    { work: { ...work, revision: 4 } },
    { job: { ...job, dispatchedAt: "now" } },
  ])
    await assert.rejects(
      save({
        work,
        job,
        metadata: full,
        expectedRevision: 3,
        call: async () => assert.fail("must not write"),
        refresh: async () => {},
        ...override,
      }),
    );
});
test("invalid or future generation dates never reach the bridge", async () => {
  for (const generatedOn of ["2026-02-30", "9999-01-01"])
    await assert.rejects(
      save({
        work,
        job,
        metadata: { ...full, generatedOn },
        expectedRevision: 3,
        call: async () => assert.fail("must not write"),
        refresh: async () => {},
      }),
      /真实生成日期/,
    );
});
test("save errors propagate without refreshing or replaying the write", async () => {
  let writes = 0;
  await assert.rejects(
    save({
      work,
      job,
      metadata: full,
      expectedRevision: 3,
      call: async () => {
        writes++;
        throw Error("REVISION_CONFLICT");
      },
      refresh: async () => assert.fail("must not refresh"),
    }),
    /REVISION_CONFLICT/,
  );
  assert.equal(writes, 1);
});
