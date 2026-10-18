const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const { Studio } = require(
  process.env.RAINFALL_CORE_BUNDLE || "../../build/core.cjs",
);
async function fixture() {
  const root = path.resolve(
      "output/test-runs/publish-feedback-" + randomUUID(),
    ),
    s = new Studio(root, "production");
  const artist = await s.call("artist.save", {
    name: "保存的艺名",
    defaults: s.all("artists")[0].defaults,
  });
  const work = s.saveWork({
    title: "门口的新歌",
    artistId: artist.id,
    story: "相约明天",
    lyrics: "[Verse 1]\n慢慢走回家\n\n[Chorus]\n示例作品B",
    prompt: "warm acoustic pop",
    parameters: { genre: "温柔流行", language: "中文" },
    rights: "AI生成来源已记录，商业权利待核实",
    ai: "generated",
  });
  const account = await s.call("account.save", {
    provider: "tme",
    name: "我的QQ账号",
    dailyLimit: 10,
  });
  const c = (await s.call("platformConfig.list")).find(
      (c) => c.target === "qqmusic",
    ),
    { version, revision, ...config } = c;
  await s.call("platformConfig.save", {
    config: {
      ...config,
      accountId: account.id,
      artistId: artist.id,
      lyricist: "保存的词作者",
      composer: "保存的曲作者",
      album: "保存的专辑",
    },
    expectedRevision: revision,
  });
  const input = {
    workIds: [work.id],
    targets: ["qqmusic"],
    accountOverrides: {},
  };
  const asset = (slot, ext = "wav", extra = {}) => {
    const bytes = Buffer.from(randomUUID()),
      sha256 = createHash("sha256").update(bytes).digest("hex"),
      id = randomUUID(),
      dir = path.join(root, "media/sha256", sha256.slice(0, 2));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, sha256 + "." + ext), bytes);
    const a = {
      id,
      sha256,
      ext,
      kind: slot === "cover" ? "image" : "audio",
      mime:
        slot === "cover"
          ? "image/png"
          : ext === "wav"
            ? "audio/wav"
            : "audio/mp4",
      bytes: bytes.length,
      label: "已保存的" + slot + "." + ext,
      source: "import",
      metadata: {
        width: 1254,
        height: 1254,
        format: { duration: "174.813515" },
        streams: [
          {
            codec_type: "audio",
            codec_name: "pcm_s16le",
            sample_rate: "44100",
            channels: 2,
          },
        ],
      },
      ...extra,
    };
    s.save("assets", a);
    if (slot) {
      const w = s.get("works", work.id);
      s.save("works", {
        ...w,
        assets: { ...w.assets, [slot]: id },
        assetHistory: [...(w.assetHistory || []), id],
      });
    }
    return a;
  };
  return {
    s,
    root,
    work,
    artist,
    account,
    input,
    asset,
    publish: () => s.call("publish.simple", input),
  };
}
test("saved author defaults flow into a new work snapshot while explicit work credits take precedence", async () => {
  const f = await fixture();
  try {
    f.asset("audio_A");
    f.asset("cover");
    const c = (await f.s.call("platformConfig.list")).find(
      (c) => c.target === "qqmusic",
    );
    const { version, revision, ...config } = c;
    await f.s.call("platformConfig.save", {
      config: { ...config, lyricist: "云端测试艺人", composer: "云端测试艺人" },
      expectedRevision: revision,
    });
    const first = await f.publish(),
      m = first.requests[0].materialSnapshot;
    assert.equal(m.metadata.lyricist, "云端测试艺人");
    assert.equal(m.metadata.composer, "云端测试艺人");
    assert.equal(m.lyrics.alignmentConfirmed, false);
    const w = f.s.get("works", f.work.id);
    f.s.save("works", {
      ...w,
      publicationMetadata: { lyricist: "单曲词作者", composer: "单曲曲作者" },
    });
    const changed = await f.publish();
    assert.equal(
      changed.requests[0].materialSnapshot.metadata.lyricist,
      "单曲词作者",
    );
    assert.equal(
      changed.requests[0].materialSnapshot.metadata.composer,
      "单曲曲作者",
    );
    assert.notEqual(changed.requests[0].id, first.requests[0].id);
    assert.equal(
      first.requests[0].materialSnapshot.metadata.lyricist,
      "云端测试艺人",
    );
    assert.equal(f.s.externalRequests, 0);
  } finally {
    f.s.close();
  }
});
test("official account identity changes invalidate prior evidence even when local fields stay fixed", async () => {
  const f = await fixture();
  try {
    f.asset("audio_A");
    f.asset("cover");
    f.s.save("accounts", { ...f.account, remoteSubject: "subject-A" });
    const first = await f.publish();
    f.s.save("accounts", { ...f.account, remoteSubject: "subject-B" });
    assert.equal(
      f.s
        .snapshot()
        .publicationRequests.find((r) => r.id === first.requests[0].id).stale,
      true,
    );
    const second = await f.publish();
    assert.equal(second.reused, false);
    assert.notEqual(
      second.requests[0].materialSnapshot.account.identityHash,
      first.requests[0].materialSnapshot.account.identityHash,
    );
    assert.ok(!JSON.stringify(second.requests[0]).includes("subject-B"));
  } finally {
    f.s.close();
  }
});

test("history shares integrity verification per snapshot and rechecks corruption on the next snapshot", async () => {
  const f = await fixture();
  try {
    const a = f.asset("audio_A");
    f.asset("cover");
    const file = f.s.locate(a.id).file;
    for (let n = 0; n < 20; n++) {
      f.s.save("works", {
        ...f.s.get("works", f.work.id),
        title: "history-" + n,
      });
      await f.publish();
    }
    const originalLocate = f.s.locate.bind(f.s),
      counts = new Map();
    f.s.locate = (id) => {
      counts.set(id, (counts.get(id) || 0) + 1);
      return originalLocate(id);
    };
    const snapshot = f.s.snapshot();
    assert.equal(snapshot.publicationRequests.length, 20);
    assert.ok(
      counts.get(a.id) <= 3,
      "historical requests must not multiply full audio hashing: " +
        counts.get(a.id),
    );
    fs.writeFileSync(file, "corrupt");
    assert.ok(f.s.snapshot().publicationRequests.every((r) => r.stale));
  } finally {
    f.s.close();
  }
});
test("publish freezes saved materials, clean lyrics, artist/defaults and AI provenance with explicit unavailable transport", async () => {
  const f = await fixture();
  try {
    const a = f.asset("audio_A"),
      cover = f.asset("cover");
    f.s.save("works", {
      ...f.s.get("works", f.work.id),
      provider: "yourmusic",
      providerSongIds: ["clip-new-a", "clip-new-b"],
      model: "chirp-v6",
    });
    const {
        requests: [r],
      } = await f.publish(),
      m = r.materialSnapshot;
    assert.equal(m.audio.assetId, a.id);
    assert.equal(m.audio.label, a.label);
    assert.equal(m.audio.durationSeconds, 174.813515);
    assert.equal(m.cover.assetId, cover.id);
    assert.equal(m.lyrics.plainText, "慢慢走回家\n\n示例作品B");
    assert.equal(m.lyrics.alignmentConfirmed, false);
    assert.equal(m.metadata.artistName, "保存的艺名");
    assert.equal(m.metadata.lyricist, "保存的词作者");
    assert.equal(m.metadata.composer, "保存的曲作者");
    assert.equal(m.metadata.album, "保存的专辑");
    assert.equal(m.provenance.provider, "yourmusic");
    assert.deepEqual(m.provenance.providerSongIds, [
      "clip-new-a",
      "clip-new-b",
    ]);
    assert.equal(m.provenance.statement, f.work.rights);
    assert.equal(m.account.name, "我的QQ账号");
    assert.equal(r.submission.available, false);
    assert.match(r.submission.reason, /QQ音乐上传未接通/);
    assert.equal(r.formalSubmission, false);
    assert.equal(f.s.externalRequests, 0);
    assert.equal(f.s.all("operations").length, 0);
  } finally {
    f.s.close();
  }
});
test("reusing an existing fingerprint rechecks obsolete status rather than returning it silently", async () => {
  const f = await fixture();
  try {
    f.asset("audio_A");
    f.asset("cover");
    const first = await f.publish();
    const row = f.s
      .all("settings")
      .find((x) => x.value?.id === first.requests[0].id);
    f.s.save("settings", {
      ...row,
      value: {
        ...row.value,
        state: "ready",
        summary: "旧检查已过期",
        issues: [],
      },
    });
    const again = await f.publish();
    assert.equal(again.reused, true);
    assert.equal(again.rechecked, true);
    assert.equal(again.requests[0].id, first.requests[0].id);
    assert.equal(again.requests[0].state, "needs_materials");
    assert.ok(again.requests[0].issues.includes("歌词匹配待确认"));
    assert.notEqual(again.requests[0].summary, "旧检查已过期");
  } finally {
    f.s.close();
  }
});
test("a changed saved artist or account state invalidates prior material evidence without a duplicate submission", async () => {
  const f = await fixture();
  try {
    f.asset("audio_A");
    f.asset("cover");
    const first = await f.publish();
    f.s.save("artists", { ...f.artist, name: "改后的艺名" });
    const second = await f.publish();
    assert.equal(second.reused, false);
    assert.equal(
      second.requests[0].materialSnapshot.metadata.artistName,
      "改后的艺名",
    );
    f.s.save("accounts", {
      ...f.s.get("accounts", f.account.id),
      authStatus: "expired",
    });
    const third = await f.publish();
    assert.equal(third.reused, false);
    assert.equal(
      third.requests[0].materialSnapshot.account.authStatus,
      "expired",
    );
    assert.equal(f.s.all("units").length, 0);
    assert.equal(f.s.all("operations").length, 0);
    assert.equal(f.s.externalRequests, 0);
  } finally {
    f.s.close();
  }
});
test("only a verified WAV explicitly derived from bound A can be preferred; unrelated B is never substituted", async () => {
  const f = await fixture();
  try {
    const a = f.asset("audio_A", "m4a");
    f.asset("audio_B");
    f.asset("cover");
    assert.equal(
      (await f.publish()).requests[0].materialSnapshot.audio.assetId,
      a.id,
    );
    const wav = f.asset(null, "wav", { derivedFromSha256: a.sha256 });
    const w = f.s.get("works", f.work.id);
    f.s.save("works", { ...w, assetHistory: [...w.assetHistory, wav.id] });
    const m = (await f.publish()).requests[0].materialSnapshot;
    assert.equal(m.audio.assetId, wav.id);
    assert.equal(m.audio.boundAssetId, a.id);
    assert.equal(m.lyrics.audioHash, wav.sha256);
    assert.equal(m.lyrics.alignmentConfirmed, false);
    fs.writeFileSync(f.s.locate(wav.id).file, "broken");
    assert.equal(
      (await f.publish()).requests[0].materialSnapshot.audio.assetId,
      a.id,
    );
  } finally {
    f.s.close();
  }
});
test("missing lyrics/cover and returning to an older fingerprint report the matching current task", async () => {
  const f = await fixture();
  try {
    f.asset("audio_A");
    const first = await f.publish();
    assert.ok(first.requests[0].issues.includes("缺少封面"));
    const w = f.s.get("works", f.work.id);
    f.s.save("works", { ...w, lyrics: "" });
    const missing = await f.publish();
    assert.ok(missing.requests[0].issues.includes("缺少歌词"));
    assert.notEqual(missing.requests[0].id, first.requests[0].id);
    f.s.save("works", w);
    const back = await f.publish();
    assert.equal(back.requests[0].id, first.requests[0].id);
    assert.equal(back.rechecked, true);
  } finally {
    f.s.close();
  }
});
