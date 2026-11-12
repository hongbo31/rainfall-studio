const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const sharp = require("sharp");
const core = require("../../build/core.cjs");
const sha = (file) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");
function setup() {
  const root = path.resolve("output/test-runs", "cover-lyrics-" + randomUUID());
  const s = new core.Studio(root, "production"),
    artist = s.all("artists")[0];
  const create = (title) =>
    s.saveWork({
      title,
      artistId: artist.id,
      story: "本地隔离测试故事",
      lyrics:
        "[Verse 1 - Male]\r\n门口的你问今天往哪走\r\n[Chorus - Duet]\n从今天起明天也有你",
      prompt: "This is a music prompt, never actual lyrics",
      parameters: {},
      rights: "本地测试",
      ai: "unknown",
    });
  const work = create("本地封面验收"),
    other = create("另一首本地作品");
  return { s, root, work, other, close: () => s.close() };
}
async function image(x, name = "fixture.png", width = 640, height = 640) {
  const file = path.join(x.root, name);
  await sharp({ create: { width, height, channels: 3, background: "#786186" } })
    .png()
    .toFile(file);
  return file;
}
function manifest(x, request, file, changes = {}) {
  const value = {
    schemaVersion: 1,
    kind: "cover-result",
    workspaceRef: request.workspaceRef,
    workId: x.work.id,
    requestId: request.id,
    contextHash: request.contextHash,
    resultId: randomUUID(),
    image: {
      fileName: path.basename(file),
      sha256: sha(file),
      mime: "image/png",
      width: 640,
      height: 640,
    },
    provenance: {
      producer: "local-fixture-not-dot",
      model: null,
      generatedAt: null,
    },
    ...changes,
  };
  const source = path.join(x.root, "result-" + randomUUID() + ".json");
  fs.writeFileSync(source, JSON.stringify(value));
  return { value, source };
}
test("cover handoff binds immutable requests and awaits real files without image provider execution", async () => {
  const x = setup();
  try {
    const input = {
      workId: x.work.id,
      requestId: randomUUID(),
      brief: "仅本地验收",
    };
    const r = await x.s.call("cover.request", input);
    assert.equal(r.state, "awaiting_result");
    assert.equal(r.workId, x.work.id);
    assert(r.prompt.includes(x.work.lyrics));
    assert.equal((await x.s.call("cover.request", input)).id, r.id);
    await assert.rejects(
      x.s.call("cover.request", { ...input, brief: "changed" }),
      /IDEMPOTENCY_CONFLICT/,
    );
    const list = await x.s.call("cover.list", { workId: x.work.id });
    assert.equal(list.provider.state, "unconfigured");
    assert.equal(list.requests.length, 1);
    assert.equal(list.receipts.length, 0);
    assert.equal(x.s.externalRequests, 0);
  } finally {
    x.close();
  }
});
test("cover actual manifest receipt is validated and idempotent but never silently selects a cover", async () => {
  const x = setup();
  try {
    const r = await x.s.call("cover.request", {
        workId: x.work.id,
        requestId: randomUUID(),
        brief: "",
      }),
      f = await image(x),
      m = manifest(x, r, f);
    const a = await x.s
      .coverHandoff()
      .receiveFile(m.source, x.work.id, r.id, "manifest");
    const b = await x.s
      .coverHandoff()
      .receiveFile(m.source, x.work.id, r.id, "manifest");
    assert.equal(a.id, b.id);
    assert.equal(a.state, "received");
    assert.equal(a.generationVerified, false);
    assert.equal(x.s.get("works", x.work.id).assets.cover, undefined);
    await x.s.call("work.selectAsset", {
      workId: x.work.id,
      assetId: a.assetId,
      role: "cover",
    });
    assert.equal(x.s.get("works", x.work.id).assets.cover, a.assetId);
    const newer = await x.s.call("cover.request", {
      workId: x.work.id,
      requestId: randomUUID(),
      brief: "新方向",
    });
    const next = await x.s
      .coverHandoff()
      .receiveFile(f, x.work.id, newer.id, "image");
    assert.notEqual(a.id, next.id);
    assert.equal(x.s.get("works", x.work.id).assets.cover, a.assetId);
    fs.writeFileSync(
      m.source,
      JSON.stringify({
        ...m.value,
        provenance: { ...m.value.provenance, producer: "changed" },
      }),
    );
    await assert.rejects(
      x.s.coverHandoff().receiveFile(m.source, x.work.id, r.id, "manifest"),
      /IDEMPOTENCY_CONFLICT/,
    );
  } finally {
    x.close();
  }
});
test("cover receipt rejects cross-song/request/workspace and basename traversal", async () => {
  const x = setup();
  try {
    const r = await x.s.call("cover.request", {
        workId: x.work.id,
        requestId: randomUUID(),
        brief: "",
      }),
      f = await image(x);
    for (const change of [
      { workId: x.other.id },
      { workspaceRef: randomUUID() },
      { requestId: randomUUID() },
      {
        image: {
          fileName: "../fixture.png",
          sha256: sha(f),
          mime: "image/png",
          width: 640,
          height: 640,
        },
      },
    ]) {
      const m = manifest(x, r, f, change);
      await assert.rejects(
        x.s.coverHandoff().receiveFile(m.source, x.work.id, r.id, "manifest"),
      );
    }
    assert.equal(x.s.coverHandoff().list(x.work.id).receipts.length, 0);
    assert.equal(x.s.get("works", x.other.id).assetHistory.length, 0);
  } finally {
    x.close();
  }
});
test("cover ingress rejects missing corrupt mismatched and non-square images, stale context and corrupt replays", async () => {
  const x = setup();
  try {
    const r = await x.s.call("cover.request", {
      workId: x.work.id,
      requestId: randomUUID(),
      brief: "",
    });
    await assert.rejects(
      x.s
        .coverHandoff()
        .receiveFile(
          path.join(x.root, "missing.png"),
          x.work.id,
          r.id,
          "image",
        ),
    );
    const bad = path.join(x.root, "bad.png");
    fs.writeFileSync(bad, "not an image");
    await assert.rejects(
      x.s.coverHandoff().receiveFile(bad, x.work.id, r.id, "image"),
    );
    const wide = await image(x, "wide.png", 640, 400);
    await assert.rejects(
      x.s.coverHandoff().receiveFile(wide, x.work.id, r.id, "image"),
      /IMAGE_DIMENSIONS/,
    );
    const f = await image(x),
      m = manifest(x, r, f);
    m.value.image.width = 641;
    fs.writeFileSync(m.source, JSON.stringify(m.value));
    await assert.rejects(
      x.s.coverHandoff().receiveFile(m.source, x.work.id, r.id, "manifest"),
      /IMAGE_RECEIPT_MISMATCH/,
    );
    const receipt = await x.s
      .coverHandoff()
      .receiveFile(f, x.work.id, r.id, "image");
    const managed = x.s.locate(receipt.assetId).file;
    fs.writeFileSync(managed, "corrupt");
    await assert.rejects(
      x.s.coverHandoff().receiveFile(f, x.work.id, r.id, "image"),
      /ASSET_MISSING_OR_CORRUPT/,
    );
    await assert.rejects(
      x.s.call("work.selectAsset", {
        workId: x.work.id,
        assetId: receipt.assetId,
        role: "cover",
      }),
      /ASSET_MISSING_OR_CORRUPT/,
    );
    const w = x.s.get("works", x.work.id);
    x.s.saveWork({
      ...w,
      expected: w.revision,
      lyrics: w.lyrics + "\nchanged",
    });
    await assert.rejects(
      x.s.coverHandoff().receiveFile(f, x.work.id, r.id, "image"),
      /COVER_CONTEXT_CHANGED/,
    );
  } finally {
    x.close();
  }
});
test("cover receipts and selected version persist across a restart", async () => {
  const x = setup();
  let reopened;
  try {
    const r = await x.s.call("cover.request", {
        workId: x.work.id,
        requestId: randomUUID(),
        brief: "",
      }),
      f = await image(x),
      a = await x.s.coverHandoff().receiveFile(f, x.work.id, r.id, "image");
    await x.s.call("work.selectAsset", {
      workId: x.work.id,
      assetId: a.assetId,
      role: "cover",
    });
    x.close();
    reopened = new core.Studio(x.root, "production");
    assert.equal(
      reopened.coverHandoff().list(x.work.id).receipts[0].assetId,
      a.assetId,
    );
    assert.equal(reopened.get("works", x.work.id).assets.cover, a.assetId);
  } finally {
    if (reopened) reopened.close();
    else x.close();
  }
});
test("replayed cover manifest validates its current adjacent image", async () => {
  const x = setup();
  try {
    const r = await x.s.call("cover.request", {
      workId: x.work.id,
      requestId: randomUUID(),
      brief: "",
    });
    const f = await image(x),
      m = manifest(x, r, f);
    await x.s.coverHandoff().receiveFile(m.source, x.work.id, r.id, "manifest");
    fs.writeFileSync(f, "not an image");
    await assert.rejects(
      x.s.coverHandoff().receiveFile(m.source, x.work.id, r.id, "manifest"),
    );
    await image(x, "fixture.png", 800, 800);
    await assert.rejects(
      x.s.coverHandoff().receiveFile(m.source, x.work.id, r.id, "manifest"),
      /IMAGE_RECEIPT_MISMATCH/,
    );
  } finally {
    x.close();
  }
});
function audio(x, label = "audio") {
  const bytes = Buffer.from("isolated hashing fixture " + label),
    hash = createHash("sha256").update(bytes).digest("hex"),
    folder = path.join(x.root, "media", "sha256", hash.slice(0, 2));
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, hash + ".wav"), bytes);
  const a = x.s.save("assets", {
    id: randomUUID(),
    sha256: hash,
    ext: "wav",
    mime: "audio/wav",
    bytes: bytes.length,
    kind: "audio",
    metadata: {},
  });
  const w = x.s.get("works", x.work.id);
  x.s.save("works", {
    ...w,
    assets: { ...w.assets, audio_A: a.id },
    assetHistory: [...w.assetHistory, a.id],
  });
  return a;
}
test("lyrics cleaner removes only known structure and vocal directions, retaining dialogue repeats and unknown brackets", () => {
  const raw =
    "[Verse 1 - Male]\r\n六点二十 你站在门口\r\n[Bridge - Piano Only, Call and Response]\n[Female]\n所以今天 算什么关系\n[Male]\n我想做你男朋友 可以不可以\n[Brief Instrumental Pause]\n[Final Chorus - Duet, Soaring, Full Band]\n从今天起\n从今天起\n[Outro - Soft Duet]\n[Duet]\n我们一起走\n[雨声]\n唱着[Chorus]也保留\n[副歌]";
  const result = core.cleanTmeLyrics(raw);
  assert.equal(result.raw, raw);
  assert.equal(
    result.cleaned,
    "六点二十 你站在门口\n所以今天 算什么关系\n我想做你男朋友 可以不可以\n从今天起\n从今天起\n我们一起走\n[雨声]\n唱着[Chorus]也保留",
  );
  assert.equal(result.removed.length, 9);
  assert(result.warnings.length);
});
test("lyrics raw versions and audio-bound explicit confirmation survive restart and invalidate on audio/text changes", async () => {
  const x = setup();
  let reopened;
  try {
    const a = audio(x),
      p = await x.s.call("lyrics.preview", { workId: x.work.id });
    assert.equal(p.raw, x.work.lyrics);
    assert.equal(p.source.kind, "manual");
    assert.equal(p.alignmentConfirmed, false);
    assert(p.removed.length);
    await x.s.call("lyrics.confirm", {
      workId: x.work.id,
      versionId: p.versionId,
      plainHash: p.plainHash,
      audioHash: a.sha256,
      confirmed: true,
    });
    assert.equal(
      (await x.s.call("lyrics.preview", { workId: x.work.id }))
        .alignmentConfirmed,
      true,
    );
    audio(x, "different recording");
    assert.equal(
      (await x.s.call("lyrics.preview", { workId: x.work.id }))
        .alignmentConfirmed,
      false,
    );
    const w = x.s.get("works", x.work.id);
    x.s.saveWork({
      ...w,
      expected: w.revision,
      lyrics: "[副歌]\n新的正式歌词保留原文",
    });
    const next = await x.s.call("lyrics.preview", { workId: w.id });
    assert.notEqual(next.versionId, p.versionId);
    assert.equal(next.versions.find((v) => v.id === p.versionId).raw, p.raw);
    assert.equal(next.alignmentConfirmed, false);
    await assert.rejects(
      x.s.call("lyrics.confirm", {
        workId: w.id,
        versionId: p.versionId,
        plainHash: p.plainHash,
        audioHash: a.sha256,
        confirmed: true,
      }),
      /LYRICS_CONFIRMATION_STALE/,
    );
    x.close();
    reopened = new core.Studio(x.root, "production");
    assert.equal(
      (await reopened.call("lyrics.preview", { workId: w.id })).versions.length,
      2,
    );
  } finally {
    if (reopened) reopened.close();
    else x.close();
  }
});
test("lyrics UTF8 file import preserves original, rejects invalid encoding and never substitutes prompt", async () => {
  const x = setup();
  try {
    const file = path.join(x.root, "lyrics.txt"),
      raw = "[副歌]\r\n我们一起走\r\n\r\n我们一起走";
    fs.writeFileSync(file, raw);
    await x.s.lyricService().importText(file, x.work.id);
    const p = await x.s.call("lyrics.preview", { workId: x.work.id });
    assert.equal(p.raw, raw);
    assert.equal(p.cleaned, "我们一起走\n\n我们一起走");
    assert.equal(x.s.get("works", x.work.id).prompt, x.work.prompt);
    fs.writeFileSync(file, Buffer.from([0xff, 0xfe, 0xab]));
    await assert.rejects(x.s.lyricService().importText(file, x.work.id));
  } finally {
    x.close();
  }
});
test("every primary audio selection clears alignment, including same audio and A-B-A", async () => {
  const x = setup();
  try {
    const a = audio(x, "A"),
      b = audio(x, "B");
    const select = (assetId) =>
      x.s.call("work.selectAsset", {
        workId: x.work.id,
        assetId,
        role: "audio_A",
      });
    const preview = () => x.s.call("lyrics.preview", { workId: x.work.id });
    const confirm = async () => {
      const p = await preview();
      await x.s.call("lyrics.confirm", {
        workId: x.work.id,
        versionId: p.versionId,
        plainHash: p.plainHash,
        audioHash: p.audioHash,
        confirmed: true,
      });
    };
    await select(a.id);
    await confirm();
    await select(a.id);
    assert.equal(
      (await preview()).alignmentConfirmed,
      false,
      "same audio must need fresh confirmation",
    );
    await confirm();
    await select(b.id);
    await select(a.id);
    assert.equal(
      (await preview()).alignmentConfirmed,
      false,
      "returning to A must not revive confirmation",
    );
  } finally {
    x.close();
  }
});
test("edited TME lyrics have an immutable manual submission version and consistent final warnings", async () => {
  const x = setup();
  try {
    audio(x);
    await x.s.importFile(await image(x), "cover", x.work.id);
    const w = x.s.get("works", x.work.id);
    x.s
      .lyricService()
      .record(w, {
        kind: "provider_actual",
        provider: "fixture",
        version: "v1",
      });
    x.s.save("works", w);
    const original = await x.s.call("publication.payload", { workId: w.id });
    const account = await x.s.call("account.save", {
      provider: "tme",
      name: "本地测试",
      dailyLimit: 1,
    });
    const input = {
      workId: w.id,
      accountId: account.id,
      metadata: {
        lyricist: "",
        composer: "",
        ownLyricist: null,
        ownComposer: null,
        aiMusic: "unknown",
        aiTool: "",
        generatedOn: "",
        lyrics: "Entirely edited manual lyrics",
        statement: "",
        proofAssetId: "",
        existingRemoteId: "",
        authorizationMode: "",
      },
      confirmations: {},
    };
    const preview = await x.s.call("tme.preview", input);
    input.confirmations = {
      lyricsHash: preview.lyricsHash,
      recordingHash: preview.audio.sha256,
      reviewHash: preview.reviewHash,
    };
    const d = await x.s.call("tme.prepare", input),
      p = d.publicationPayload;
    assert.equal(p.lyrics.source.kind, "manual");
    assert.notEqual(p.lyrics.versionId, original.lyrics.versionId);
    assert.equal(p.lyrics.raw, input.metadata.lyrics);
    assert.equal(p.lyrics.plainText, input.metadata.lyrics);
    assert.equal(p.lyrics.alignmentConfirmed, true);
    assert(!p.warnings.includes("LYRICS_AUDIO_MATCH_UNCONFIRMED"));
    assert.equal(p.originalLyrics.versionId, original.lyrics.versionId);
    assert.equal(p.originalLyrics.source.kind, "provider_actual");
    assert.equal(x.s.get("works", w.id).lyrics, w.lyrics);
    const version = x.s.get(
      "settings",
      "lyrics-version:" + p.lyrics.versionId,
    ).version;
    assert.equal(version.raw, input.metadata.lyrics);
    assert.equal(
      (await x.s.call("tme.prepare", input)).publicationPayload.lyrics
        .versionId,
      version.id,
    );
  } finally {
    x.close();
  }
});
test("primary audio import clears prior confirmation even for the identical managed file", async () => {
  const x = setup();
  try {
    const bytes = Buffer.alloc(44 + 96000);
    bytes.write("RIFF");
    bytes.writeUInt32LE(bytes.length - 8, 4);
    bytes.write("WAVEfmt ", 8);
    bytes.writeUInt32LE(16, 16);
    bytes.writeUInt16LE(1, 20);
    bytes.writeUInt16LE(1, 22);
    bytes.writeUInt32LE(48000, 24);
    bytes.writeUInt32LE(96000, 28);
    bytes.writeUInt16LE(2, 32);
    bytes.writeUInt16LE(16, 34);
    bytes.write("data", 36);
    bytes.writeUInt32LE(96000, 40);
    const f = path.join(x.root, "fixture-silent.wav");
    fs.writeFileSync(f, bytes);
    const a = await x.s.importFile(f, "audio_A", x.work.id),
      p = await x.s.call("lyrics.preview", { workId: x.work.id });
    await x.s.call("lyrics.confirm", {
      workId: x.work.id,
      versionId: p.versionId,
      plainHash: p.plainHash,
      audioHash: a.sha256,
      confirmed: true,
    });
    await x.s.importFile(f, "audio_A", x.work.id);
    assert.equal(
      (await x.s.call("lyrics.preview", { workId: x.work.id }))
        .alignmentConfirmed,
      false,
    );
  } finally {
    x.close();
  }
});
test("unified publication freezes selected cover, original/plain lyrics and missing alignment warnings into materials and TME", async () => {
  const x = setup();
  try {
    audio(x);
    const file = await image(x),
      cover = await x.s.importFile(file, "cover", x.work.id);
    const payload = await x.s.call("publication.payload", {
      workId: x.work.id,
    });
    assert.equal(payload.cover.assetId, cover.id);
    assert.equal(payload.lyrics.raw, x.work.lyrics);
    assert(!payload.lyrics.plainText.includes("[Verse"));
    assert.equal(payload.lyrics.alignmentConfirmed, false);
    assert(payload.warnings.includes("LYRICS_AUDIO_MATCH_UNCONFIRMED"));
    const account = await x.s.call("account.save", {
        provider: "tme",
        name: "本地测试",
        dailyLimit: 1,
      }),
      binding = await x.s.call("binding.save", {
        artistId: x.work.artistId,
        accountId: account.id,
        targets: ["qqmusic"],
      });
    const batch = await x.s.call("publish.plan", {
      workIds: [x.work.id],
      destinations: [
        {
          target: "qqmusic",
          accountId: account.id,
          bindingId: binding.id,
          kind: "audio_distribution",
        },
      ],
    });
    const unit = x.s.all("units").find((u) => u.batchId === batch.id);
    assert.equal(unit.payload.cover.assetId, cover.id);
    assert.equal(unit.payload.lyrics.raw, x.work.lyrics);
    const files = core.materialEntries(x.s, batch.id);
    assert.equal(
      files.find((f) => f.name.endsWith("/lyrics-original.txt")).text,
      x.work.lyrics,
    );
    assert.equal(
      files.find((f) => f.name.endsWith("/lyrics.txt")).text,
      payload.lyrics.plainText,
    );
    assert.equal(
      JSON.parse(
        files.find((f) => f.name.endsWith("/publication-payload.json")).text,
      ).cover.assetId,
      cover.id,
    );
    const input = {
      workId: x.work.id,
      accountId: account.id,
      metadata: {
        lyricist: "",
        composer: "",
        ownLyricist: null,
        ownComposer: null,
        aiMusic: "unknown",
        aiTool: "",
        generatedOn: "",
        lyrics: payload.lyrics.plainText,
        statement: "",
        proofAssetId: "",
        existingRemoteId: "",
        authorizationMode: "",
      },
      confirmations: {},
    };
    const tme = await x.s.call("tme.prepare", input);
    assert.equal(tme.publicationPayload.cover.assetId, cover.id);
    assert.equal(
      tme.publicationPayload.lyrics.plainText,
      payload.lyrics.plainText,
    );
    assert.equal(tme.state, "BLOCKED");
    fs.unlinkSync(x.s.locate(cover.id).file);
    assert(
      (
        await x.s.call("publication.payload", { workId: x.work.id })
      ).warnings.includes("COVER_MISSING_OR_CORRUPT"),
    );
  } finally {
    x.close();
  }
});

test('cover inbox matches by immutable request, rejects multiple images and never guesses by title', async () => {
  const x=setup();
  try {
    const request=await x.s.call('cover.request',{workId:x.work.id,requestId:randomUUID(),brief:'自动收图测试'});
    const inbox=await x.s.call('cover.watch',{requestId:request.id});
    assert.ok(fs.existsSync(path.join(inbox.directory,'保存图片说明.txt')));
    const original=await image(x);
    const target=path.join(inbox.directory,'cover.png');
    fs.copyFileSync(original,target);fs.copyFileSync(original,path.join(inbox.directory,'cover.jpg'));
    await x.s.tick();
    let state=(await x.s.call('cover.inboxStatus',{workId:x.work.id}))[0];
    assert.equal(state.reason,'COVER_INBOX_MULTIPLE_IMAGES');
    assert.equal(x.s.get('works',x.work.id).assets.cover,undefined);
    fs.unlinkSync(path.join(inbox.directory,'cover.jpg'));
    fs.utimesSync(target,new Date(0),new Date(0));
    x.s.inboxTickAt=0;await x.s.tick();
    state=(await x.s.call('cover.inboxStatus',{workId:x.work.id}))[0];
    assert.equal(state.state,'received');
    assert.equal(x.s.get('works',x.work.id).assets.cover,state.assetId);
    assert.equal(x.s.get('works',x.other.id).assets.cover,undefined);
    assert.ok(fs.existsSync(target));
    const count=x.s.all('assets').length;x.s.inboxTickAt=0;await x.s.tick();
    assert.equal(x.s.all('assets').length,count);
  } finally { x.close(); }
});
