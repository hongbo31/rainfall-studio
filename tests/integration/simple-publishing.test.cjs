const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  { randomUUID, createHash } = require("node:crypto");
const { Studio } = require(
  process.env.RAINFALL_SIMPLE_CORE_BUNDLE ||
    process.env.RAINFALL_CORE_BUNDLE ||
    "../../build/core.cjs",
);
function setup(mode = "production") {
  const root = path.resolve("output/test-runs", "simple-" + randomUUID()),
    s = new Studio(root, mode),
    artist = s.all("artists")[0];
  const work = s.saveWork({
    title: "本地歌曲",
    artistId: artist.id,
    story: "",
    lyrics: "雨落在窗前",
    prompt: "",
    parameters: {},
    rights: "原创及商用授权已核验",
    ai: "none",
  });
  return { s, root, artist, work };
}
function asset(f, role, kind = role === "cover" ? "image" : "audio") {
  const bytes = Buffer.from("local fixture " + randomUUID()),
    sha256 = createHash("sha256").update(bytes).digest("hex"),
    ext = kind === "image" ? "png" : "wav";
  const dir = path.join(f.root, "media", "sha256", sha256.slice(0, 2));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, sha256 + "." + ext), bytes);
  const a = {
    id: randomUUID(),
    sha256,
    ext,
    kind,
    mime: kind === "image" ? "image/png" : "audio/wav",
    bytes: bytes.length,
    metadata: { width: 640, height: 640 },
    source: "local",
  };
  f.s.save("assets", a);
  const w = f.s.get("works", f.work.id);
  f.s.save("works", { ...w, assets: { ...w.assets, [role]: a.id } });
  return a;
}
async function configured(f, target = "netease", provider = target) {
  const account = await f.s.call("account.save", {
    provider,
    name: "本地账号",
    dailyLimit: 10,
  });
  const c = (await f.s.call("platformConfig.list")).find(
    (c) => c.target === target,
  );
  const { version, revision, ...config } = c;
  await f.s.call("platformConfig.save", {
    config: { ...config, accountId: account.id, artistId: f.artist.id },
    expectedRevision: revision,
  });
  return account;
}
const input = (f, targets = ["netease"]) => ({
  workIds: [f.work.id],
  targets,
  accountOverrides: {},
});
test("versioned migration is additive, preserves old bytes/schema3 and is idempotent", async () => {
  const f = setup();
  let next;
  try {
    const account = await f.s.call("account.save", {
      provider: "tme",
      name: "旧账号",
      dailyLimit: 2,
    });
    await f.s.call("binding.save", {
      artistId: f.artist.id,
      accountId: account.id,
      targets: ["qqmusic", "kugou"],
    });
    // Recreate first-use migration on a fixture containing legacy data.
    f.s.db
      .prepare("DELETE FROM settings WHERE id LIKE 'simple-publishing:%'")
      .run();
    f.s.save("settings", {
      id: "legacy-opaque",
      value: { terms: false, tokenRef: "opaque-reference" },
    });
    const old = {};
    for (const table of [
      "artists",
      "accounts",
      "bindings",
      "works",
      "settings",
    ])
      old[table] = f.s.db
        .prepare(`SELECT * FROM ${table} ORDER BY rowid`)
        .all();
    f.s.close();
    next = new Studio(f.root, "production");
    const configs = await next.call("platformConfig.list");
    assert.equal(configs.length, 6);
    assert(configs.some(config=>config.target==='fanqie'));
    assert.equal(
      configs.find((c) => c.target === "qqmusic").accountId,
      account.id,
    );
    assert.equal(
      configs.find((c) => c.target === "kugou").artistId,
      f.artist.id,
    );
    for (const table of Object.keys(old)) {
      const rows = next.db
        .prepare(`SELECT * FROM ${table} ORDER BY rowid`)
        .all();
      for (const row of old[table])
        assert.deepEqual(
          rows.find((r) => r.id === row.id),
          row,
        );
    }
    const added = next
      .all("settings")
      .filter((r) => r.id.startsWith("simple-publishing:"));
    assert.equal(next.db.pragma("user_version", { simple: true }), 3);
    next.close();
    next = new Studio(f.root, "production");
    assert.deepEqual(
      next.all("settings").filter((r) => r.id.startsWith("simple-publishing:")),
      added,
    );
  } finally {
    next ? next.close() : f.s.close();
  }
});
test("ambiguous migration refs remain null; no account authority is inferred", async () => {
  const f = setup();
  let next;
  try {
    await f.s.call("account.save", {
      provider: "netease",
      name: "一",
      dailyLimit: 1,
    });
    await f.s.call("account.save", {
      provider: "netease",
      name: "二",
      dailyLimit: 1,
    });
    f.s.db
      .prepare("DELETE FROM settings WHERE id LIKE 'simple-publishing:%'")
      .run();
    f.s.close();
    next = new Studio(f.root, "production");
    const c = (await next.call("platformConfig.list")).find(
      (c) => c.target === "netease",
    );
    assert.equal(c.accountId, null);
    assert.ok(
      next.all("accounts").every((a) => a.authStatus === "not_connected"),
    );
  } finally {
    next ? next.close() : f.s.close();
  }
});
test("strict configs enforce CAS, platform account refs and known artists without changing authority", async () => {
  const f = setup();
  try {
    const account = await configured(f);
    const c = (await f.s.call("platformConfig.list"))[0],
      { version, revision, ...config } = c;
    await assert.rejects(
      f.s.call("platformConfig.save", {
        config,
        expectedRevision: revision - 1,
      }),
      /REVISION_CONFLICT/,
    );
    for (const extra of [
      { acceptedTerms: true },
      { authStatus: "connected" },
      { revision: 99 },
      { version: 1 },
      { consent: true },
    ])
      await assert.rejects(
        f.s.call("platformConfig.save", {
          config: { ...config, ...extra },
          expectedRevision: revision,
        }),
      );
    await assert.rejects(
      f.s.call("platformConfig.save", {
        config: { ...config, target: "douyin", accountId: account.id },
        expectedRevision: 1,
      }),
      /TARGET_ACCOUNT_MISMATCH/,
    );
    await assert.rejects(
      f.s.call("platformConfig.save", {
        config: { ...config, artistId: randomUUID() },
        expectedRevision: revision,
      }),
      /ARTIST_NOT_FOUND/,
    );
    await assert.rejects(
      f.s.call("platformConfig.save", {
        config: { ...config, accountId: randomUUID() },
        expectedRevision: revision,
      }),
      /ACCOUNT_NOT_FOUND/,
    );
    const unset = await f.s.call("platformConfig.setAccount", {
      target: c.target,
      accountId: null,
      expectedRevision: revision,
    });
    assert.deepEqual(unset, { ...c, accountId: null, revision: revision + 1 });
    await assert.rejects(
      f.s.call("platformConfig.setAccount", {
        target: c.target,
        accountId: account.id,
        expectedRevision: revision,
      }),
      /REVISION_CONFLICT/,
    );
    const restored = await f.s.call("platformConfig.setAccount", {
      target: c.target,
      accountId: account.id,
      expectedRevision: unset.revision,
    });
    assert.deepEqual(restored, { ...c, accountId: account.id, revision: revision + 2 });
    assert.equal(f.s.get("accounts", account.id).authStatus, "not_connected");
  } finally {
    f.s.close();
  }
});
test("empty/unknown selections reject before writes; drafts may be empty and survive restart", async () => {
  const f = setup();
  let next;
  try {
    const count = f.s.all("settings").length;
    for (const v of [
      { workIds: [], targets: ["netease"], accountOverrides: {} },
      { ...input(f), targets: [] },
      { ...input(f), workIds: [randomUUID()] },
      { ...input(f), accountOverrides: { netease: randomUUID() } },
    ])
      await assert.rejects(f.s.call("publish.simple", v));
    assert.equal(f.s.all("settings").length, count);
    const saved = await f.s.call("publish.selection.save", {
      workIds: [],
      targets: [],
      accountOverrides: {},
    });
    assert.deepEqual(saved, { workIds: [], targets: [], accountOverrides: {} });
    f.s.close();
    next = new Studio(f.root, "production");
    assert.deepEqual(next.snapshot().publishSelection, saved);
    assert.deepEqual(next.snapshot().publicationRequests, []);
  } finally {
    next ? next.close() : f.s.close();
  }
});
test("multi-song/platform local checks freeze A and defaults, retain legal checks and dedupe reorder/restart", async () => {
  const f = setup();
  let next;
  try {
    await configured(f);
    await configured(f, "qishui");
    const a = asset(f, "audio_A");
    asset(f, "audio_B");
    const cover = asset(f, "cover");
    const second = f.s.saveWork({ ...f.work, id: undefined, title: "第二首" });
    const v = {
      workIds: [f.work.id, second.id, f.work.id],
      targets: ["qishui", "netease", "qishui"],
      accountOverrides: {},
    };
    const r = await f.s.call("publish.simple", v);
    assert.equal(r.requests.length, 4);
    assert.equal(r.reused, false);
    const req = r.requests.find(
      (r) => r.workId === f.work.id && r.target === "netease",
    );
    assert.equal(req.materialSnapshot.audio.assetId, a.id);
    assert.equal(req.materialSnapshot.cover.assetId, cover.id);
    assert.equal(req.formalSubmission, false);
    assert.equal(req.source, "local");
    assert.equal(req.state, "needs_materials");
    assert.ok(req.issues.some((x) => x.includes("歌词匹配")));
    assert.ok(
      !JSON.stringify(req.materialSnapshot).includes(
        f.s.get("works", f.work.id).assets.audio_B,
      ),
    );
    const again = await f.s.call("publish.simple", {
      ...v,
      workIds: [second.id, f.work.id],
      targets: ["netease", "qishui"],
    });
    assert.equal(again.reused, true);
    assert.deepEqual(again.requests, r.requests);
    f.s.close();
    next = new Studio(f.root, "production");
    assert.deepEqual(
      (await next.call("publish.simple", v)).requests,
      r.requests,
    );
    assert.equal(next.snapshot().publicationRequests.length, 4);
    assert.equal(next.externalRequests, 0);
    assert.equal(next.all("batches").length, 0);
    assert.equal(next.all("operations").length, 0);
  } finally {
    next ? next.close() : f.s.close();
  }
});
test("missing settings/audio and complete real materials have truthful short statuses; defaults never settle legal facts", async () => {
  const f = setup();
  try {
    assert.equal(
      (await f.s.call("publish.simple", input(f))).requests[0].state,
      "needs_configuration",
    );
    await configured(f);
    asset(f, "audio_B");
    assert.equal(
      (await f.s.call("publish.simple", input(f))).requests[0].summary,
      "缺少音频",
    );
    asset(f, "audio_A");
    asset(f, "cover");
    const l = await f.s.call("lyrics.preview", { workId: f.work.id });
    await f.s.call("lyrics.confirm", {
      workId: f.work.id,
      versionId: l.versionId,
      plainHash: l.plainHash,
      audioHash: l.audioHash,
      confirmed: true,
    });
    const r = (await f.s.call("publish.simple", input(f))).requests[0];
    assert.equal(r.state, "unavailable");
    assert.equal(r.summary, "未接通");
    assert.equal(r.formalSubmission, false);
    f.s.save("works", {
      ...f.s.get("works", f.work.id),
      rights: "商业授权待确认",
      ai: "unknown",
      isCover: true,
    });
    const c = (await f.s.call("platformConfig.list"))[0],
      { version, revision, ...config } = c;
    await f.s.call("platformConfig.save", {
      config: { ...config, aiDisclosure: "none", isCover: false },
      expectedRevision: revision,
    });
    const bad = (await f.s.call("publish.simple", input(f))).requests[0];
    assert.equal(bad.state, "needs_materials");
    assert.ok(bad.issues.some((x) => x.includes("权益")));
    assert.ok(bad.issues.some((x) => x.includes("AI")));
    assert.ok(bad.issues.some((x) => x.includes("翻唱")));
  } finally {
    f.s.close();
  }
});
test("TME pending terms require exact work/A/account proof and never mutate existing preparation", async () => {
  const f = setup();
  try {
    const account = await configured(f, "qqmusic", "tme");
    await configured(f, "kugou", "tme");
    const a = asset(f, "audio_A");
    asset(f, "cover");
    const subject = "a".repeat(64);
    f.s.save("accounts", { ...account, remoteSubject: subject });
    const grant = {
      id: randomUUID(),
      input: {
        workId: f.work.id,
        sourceAudio: { assetId: a.id, sha256: a.sha256, variant: "A" },
        identity: { subjectHash: subject },
      },
    };
    const termsText = "三年非独家授权限制";
    const job = {
      id: randomUUID(),
      workId: f.work.id,
      grantId: grant.id,
      state: "awaiting_terms_review",
      terms: {
        termsText,
        termsHash: createHash("sha256").update(termsText).digest("hex"),
      },
      submissionByClient: false,
    };
    f.s.save("settings", {
      id: "tme-ai-prepare:grant:" + grant.id,
      value: grant,
    });
    f.s.save("settings", { id: "tme-ai-prepare:job:" + job.id, value: job });
    const before = f.s.db
      .prepare(
        "SELECT * FROM settings WHERE id LIKE 'tme-ai-prepare:%' ORDER BY rowid",
      )
      .all();
    const count = f.s.all("settings").length;
    const projected = f.s.snapshot().publicationRequests;
    assert.equal(projected.length, 1);
    assert.equal(projected[0].state, "awaiting_terms_review");
    assert.equal(f.s.all("settings").length, count);
    const r = await f.s.call("publish.simple", input(f, ["qqmusic", "kugou"]));
    assert.equal(
      r.requests.find((r) => r.target === "qqmusic").state,
      "awaiting_terms_review",
    );
    assert.equal(
      r.requests.find((r) => r.target === "kugou").state,
      "needs_materials",
    );
    assert.equal(
      f.s
        .snapshot()
        .publicationRequests.filter((r) => r.state === "awaiting_terms_review")
        .length,
      1,
    );
    const q = r.requests.find((r) => r.target === "qqmusic");
    assert.ok(q.issues.includes("三年非独家授权限制"));
    assert.equal(q.materialSnapshot.terms.accepted, false);
    assert.equal(q.formalSubmission, false);
    assert.deepEqual(
      f.s.db
        .prepare(
          "SELECT * FROM settings WHERE id LIKE 'tme-ai-prepare:%' ORDER BY rowid",
        )
        .all(),
      before,
    );
    asset(f, "audio_A");
    assert.notEqual(
      (await f.s.call("publish.simple", input(f, ["qqmusic"]))).requests[0]
        .state,
      "awaiting_terms_review",
    );
  } finally {
    f.s.close();
  }
});

function preparedTerms(f, variant, audio, subject) {
  const termsText = `Offline fixture terms ${variant}`;
  const grant = {
    id: randomUUID(),
    input: {
      workId: f.work.id,
      sourceAudio: { assetId: audio.id, sha256: audio.sha256, variant },
      identity: { subjectHash: subject },
    },
  };
  const job = {
    id: randomUUID(), workId: f.work.id, grantId: grant.id,
    state: "awaiting_terms_review", submissionByClient: false,
    terms: { termsText, termsHash: createHash("sha256").update(termsText).digest("hex") },
  };
  f.s.save("settings", { id: "tme-ai-prepare:grant:" + grant.id, value: grant });
  f.s.save("settings", { id: "tme-ai-prepare:job:" + job.id, value: job });
  return job;
}

test("selected B publication checks expose its exact terms and never reuse old A terms", async () => {
  const f = setup();
  try {
    const account = await configured(f, "qqmusic", "tme"),
      a = asset(f, "audio_A"), b = asset(f, "audio_B"), subject = "e".repeat(64);
    asset(f, "cover");
    f.s.save("accounts", { ...account, remoteSubject: subject });
    const jobA = preparedTerms(f, "A", a, subject), jobB = preparedTerms(f, "B", b, subject),
      original = f.s.get("works", f.work.id);
    f.s.save("works", { ...original, selectedAudioVariant: "B" });
    const requestB = (await f.s.call("publish.simple", input(f, ["qqmusic"]))).requests[0];
    assert.equal(requestB.state, "awaiting_terms_review");
    assert.equal(requestB.materialSnapshot.audio.assetId, b.id);
    assert.equal(requestB.materialSnapshot.terms.jobId, jobB.id);
    assert.equal(requestB.materialSnapshot.terms.termsText, jobB.terms.termsText);
    f.s.save("works", { ...original, selectedAudioVariant: "A" });
    const requestA = (await f.s.call("publish.simple", input(f, ["qqmusic"]))).requests[0];
    assert.equal(requestA.materialSnapshot.terms.jobId, jobA.id);
    assert.equal(requestA.materialSnapshot.audio.assetId, a.id);
    assert.deepEqual(f.s.get("works", f.work.id).assets, original.assets);
    assert.equal(f.s.all("operations").length, 0);
  } finally { f.s.close(); }
});

test("pending terms listing follows selected A/B with exact source hash and leaves jobs untouched", async () => {
  const f = setup();
  try {
    const a = asset(f, "audio_A"), b = asset(f, "audio_B"),
      jobA = preparedTerms(f, "A", a, "f".repeat(64)),
      jobB = preparedTerms(f, "B", b, "f".repeat(64)),
      original = f.s.get("works", f.work.id),
      journal = f.s.all("settings").filter(r => r.id.startsWith("tme-ai-prepare:"));
    f.s.save("works", { ...original, selectedAudioVariant: "B" });
    assert.deepEqual(f.s.snapshot().publicationPendingTerms.map(row => row.id), [jobB.id]);
    f.s.save("works", { ...original, selectedAudioVariant: "A" });
    assert.deepEqual(f.s.snapshot().publicationPendingTerms.map(row => row.id), [jobA.id]);
    f.s.save("works", { ...original, selectedAudioVariant: "B" });
    const grantRow = f.s.get("settings", "tme-ai-prepare:grant:" + jobB.grantId);
    f.s.save("settings", { ...grantRow, value: { ...grantRow.value, input: { ...grantRow.value.input,
      sourceAudio: { ...grantRow.value.input.sourceAudio, sha256: "0".repeat(64) } } } });
    assert.deepEqual(f.s.snapshot().publicationPendingTerms, []);
    f.s.save("settings", grantRow);
    assert.deepEqual(f.s.all("settings").filter(r => r.id.startsWith("tme-ai-prepare:")), journal);
    assert.equal(f.s.all("operations").length, 0);
  } finally { f.s.close(); }
});
test("unknown history is not retried and simulation never fabricates a remote receipt", async () => {
  const f = setup("simulation");
  try {
    await configured(f);
    asset(f, "audio_A");
    asset(f, "cover");
    const l = await f.s.call("lyrics.preview", { workId: f.work.id });
    await f.s.call("lyrics.confirm", {
      workId: f.work.id,
      versionId: l.versionId,
      plainHash: l.plainHash,
      audioHash: l.audioHash,
      confirmed: true,
    });
    const r = await f.s.call("publish.simple", input(f));
    assert.equal(r.requests[0].source, "simulation");
    assert.equal(r.requests[0].state, "ready");
    assert.equal(r.requests[0].remoteId, undefined);
    assert.equal(r.requests[0].formalSubmission, false);
    f.s.save("units", {
      id: randomUUID(),
      fingerprint: randomUUID(),
      workId: f.work.id,
      accountId: r.requests[0].accountId,
      destinations: [{ target: "netease" }],
      state: "SUBMISSION_UNKNOWN",
    });
    const again = await f.s.call("publish.simple", input(f));
    assert.equal(again.reused, true);
    assert.equal(f.s.all("units")[0].state, "SUBMISSION_UNKNOWN");
    assert.equal(f.s.all("operations").length, 0);
  } finally {
    f.s.close();
  }
});
test("official pending terms survive absent OAuth mapping without inventing an account or destination", async () => {
  const f = setup();
  try {
    const account = await configured(f, "qqmusic", "tme"),
      a = asset(f, "audio_A"),
      termsText = "非独家授权期限三年，期间不可向第三方另授独家";
    const grant = {
      id: randomUUID(),
      input: {
        workId: f.work.id,
        sourceAudio: { assetId: a.id, sha256: a.sha256, variant: "A" },
        identity: { subjectHash: "c".repeat(64) },
      },
    };
    const job = {
      id: randomUUID(),
      grantId: grant.id,
      workId: f.work.id,
      state: "awaiting_terms_review",
      createdAt: new Date().toISOString(),
      terms: {
        termsText,
        termsHash: createHash("sha256").update(termsText).digest("hex"),
      },
      submissionByClient: false,
    };
    f.s.save("settings", {
      id: "tme-ai-prepare:grant:" + grant.id,
      value: grant,
    });
    f.s.save("settings", { id: "tme-ai-prepare:job:" + job.id, value: job });
    assert.equal(f.s.get("accounts", account.id).remoteSubject, null);
    const count = f.s.all("settings").length,
      snap = f.s.snapshot();
    assert.equal(snap.publicationPendingTerms.length, 1);
    assert.equal(snap.publicationPendingTerms[0].platformLabel, "腾讯音乐");
    assert.equal(snap.publicationPendingTerms[0].termsText, termsText);
    assert.equal(snap.publicationPendingTerms[0].accountId, undefined);
    assert.equal(snap.publicationPendingTerms[0].target, undefined);
    assert.equal(snap.publicationRequests.length, 0);
    assert.equal(f.s.all("settings").length, count);
    assert.notEqual(
      (await f.s.call("publish.simple", input(f, ["qqmusic"]))).requests[0]
        .state,
      "awaiting_terms_review",
    );
    const before = f.s.snapshot().publicationPendingTerms;
    f.s.save("settings", {
      id: "tme-ai-prepare:job:" + job.id,
      value: { ...job, terms: { ...job.terms, termsHash: "0".repeat(64) } },
    });
    assert.equal(f.s.snapshot().publicationPendingTerms.length, 0);
    assert.equal(before.length, 1);
  } finally {
    f.s.close();
  }
});
test("actual work artist wins across mixed artists; saving unchanged defaults remains content-idempotent", async () => {
  const f = setup();
  try {
    await configured(f);
    const other = await f.s.call("artist.save", {
      name: "另一艺人",
      defaults: f.artist.defaults,
    });
    const w = f.s.saveWork({
      ...f.work,
      id: undefined,
      title: "不同艺人的歌",
      artistId: other.id,
    });
    const v = {
      workIds: [w.id, f.work.id],
      targets: ["netease"],
      accountOverrides: {},
    };
    const first = await f.s.call("publish.simple", v);
    assert.equal(
      first.requests.find((r) => r.workId === w.id).materialSnapshot.metadata
        .artistId,
      other.id,
    );
    assert.ok(
      first.requests.every((r) => !r.issues.some((i) => i.includes("艺人"))),
    );
    const c = (await f.s.call("platformConfig.list"))[0],
      { version, revision, ...config } = c;
    await f.s.call("platformConfig.save", {
      config,
      expectedRevision: revision,
    });
    const again = await f.s.call("publish.simple", v);
    assert.equal(again.reused, true);
    assert.deepEqual(again.requests, first.requests);
  } finally {
    f.s.close();
  }
});
async function readyFixture(target = "netease") {
  const f = setup("simulation");
  await configured(f, target);
  asset(f, "audio_A");
  asset(f, "cover");
  const lyric = await f.s.call("lyrics.preview", { workId: f.work.id });
  await f.s.call("lyrics.confirm", {
    workId: f.work.id,
    versionId: lyric.versionId,
    plainHash: lyric.plainHash,
    audioHash: lyric.audioHash,
    confirmed: true,
  });
  return f;
}
function derivedVideo(f) {
  const w = f.s.get("works", f.work.id),
    bytes = Buffer.from("video fixture " + randomUUID()),
    sha256 = createHash("sha256").update(bytes).digest("hex");
  const dir = path.join(f.root, "media", "sha256", sha256.slice(0, 2));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, sha256 + ".mp4"), bytes);
  const value = {
    id: randomUUID(),
    sha256,
    bytes: bytes.length,
    ext: "mp4",
    kind: "video",
    mime: "video/mp4",
    metadata: {},
    derivedKey: `${w.assets.audio_A}:${w.assets.cover}:vertical-v1`,
  };
  f.s.save("assets", value);
  return value;
}
test("default cover intent requires real authorization and never treats defaults as rights", async () => {
  const f = await readyFixture();
  try {
    const c = (await f.s.call("platformConfig.list"))[0],
      { version, revision, ...config } = c;
    await f.s.call("platformConfig.save", {
      config: { ...config, isCover: true },
      expectedRevision: revision,
    });
    const req = (await f.s.call("publish.simple", input(f))).requests[0];
    assert.equal(req.materialSnapshot.metadata.isCover, true);
    assert.equal(req.state, "needs_materials");
    assert.ok(req.issues.includes("翻唱授权待确认"));
    assert.equal(req.materialSnapshot.coverAuthorization, null);
    const w = f.s.get("works", f.work.id);
    f.s.save("works", { ...w, isCover: false });
    assert.equal(
      (await f.s.call("publish.simple", input(f))).requests[0].state,
      "ready",
    );
  } finally {
    f.s.close();
  }
});
test("blank legacy language and genre use platform defaults while nonblank facts win", async () => {
  const f = await readyFixture();
  try {
    const c = (await f.s.call("platformConfig.list"))[0],
      { version, revision, ...config } = c;
    await f.s.call("platformConfig.save", {
      config: { ...config, language: "配置语言", genre: "配置曲风" },
      expectedRevision: revision,
    });
    const w = f.s.get("works", f.work.id);
    f.s.save("works", {
      ...w,
      config: { ...w.config, language: "   ", genre: "" },
    });
    let m = (await f.s.call("publish.simple", input(f))).requests[0]
      .materialSnapshot;
    assert.equal(m.metadata.language, "配置语言");
    assert.equal(m.metadata.genre, "配置曲风");
    f.s.save("works", {
      ...w,
      config: { ...w.config, language: "实际语言", genre: "实际曲风" },
    });
    m = (await f.s.call("publish.simple", input(f))).requests[0]
      .materialSnapshot;
    assert.equal(m.metadata.language, "实际语言");
    assert.equal(m.metadata.genre, "实际曲风");
  } finally {
    f.s.close();
  }
});
test("applicable derived video content invalidates missing-video result and freezes exact file identity", async () => {
  const f = await readyFixture("douyin");
  try {
    const first = await f.s.call("publish.simple", input(f, ["douyin"]));
    assert.equal(first.requests[0].summary, "缺少视频");
    const video = derivedVideo(f),
      second = await f.s.call("publish.simple", input(f, ["douyin"]));
    assert.equal(second.reused, false);
    assert.equal(second.requests[0].state, "ready");
    assert.equal(second.requests[0].materialSnapshot.video.assetId, video.id);
    assert.equal(
      second.requests[0].materialSnapshot.video.sha256,
      video.sha256,
    );
    assert.equal(
      (await f.s.call("publish.simple", input(f, ["douyin"]))).reused,
      true,
    );
    fs.writeFileSync(f.s.locate(video.id).file, "corrupt");
    const corrupt = await f.s.call("publish.simple", input(f, ["douyin"]));
    assert.equal(corrupt.requests[0].summary, "缺少视频");
    assert.equal(corrupt.requests[0].materialSnapshot.video, null);
    assert.equal(f.s.externalRequests, 0);
  } finally {
    f.s.close();
  }
});
test("revision-only work saves reuse content request and preserve original audit snapshot revision", async () => {
  const f = await readyFixture();
  try {
    const first = await f.s.call("publish.simple", input(f)),
      w = f.s.get("works", f.work.id);
    f.s.saveWork({ ...w, expected: w.revision });
    assert.equal(f.s.get("works", w.id).revision, w.revision + 1);
    const second = await f.s.call("publish.simple", input(f));
    assert.equal(second.reused, true);
    assert.equal(second.requests[0].id, first.requests[0].id);
    assert.equal(second.requests[0].materialSnapshot.workRevision, w.revision);
    const now = f.s.get("works", w.id);
    f.s.saveWork({ ...now, expected: now.revision, title: "实际更名" });
    assert.equal((await f.s.call("publish.simple", input(f))).reused, false);
  } finally {
    f.s.close();
  }
});
test("terms summaries stay neutral and preserve exact original evidence", async (t) => {
  const f = await readyFixture("qqmusic");
  try {
    const c = (await f.s.call("platformConfig.list")).find(
        (c) => c.target === "qqmusic",
      ),
      account = f.s.get("accounts", c.accountId),
      w = f.s.get("works", f.work.id),
      audio = f.s.get("assets", w.assets.audio_A),
      subject = "d".repeat(64);
    f.s.save("accounts", { ...account, remoteSubject: subject });
    const grant = {
      id: randomUUID(),
      input: {
        workId: w.id,
        sourceAudio: { assetId: audio.id, sha256: audio.sha256, variant: "A" },
        identity: { subjectHash: subject },
      },
    };
    f.s.save("settings", {
      id: "tme-ai-prepare:grant:" + grant.id,
      value: grant,
    });
    const job = {
      id: randomUUID(),
      grantId: grant.id,
      workId: w.id,
      state: "awaiting_terms_review",
      submissionByClient: false,
    };
    for (const termsText of [
      "授权期限一年，独家发行",
      "请阅读以下一般约定",
      "不得授予独家权利，违约追偿期三年",
      "本协议不提供非独家授权，仅提供独家授权，授权期限为一年。",
      "此前非独家授权已经终止。本次独家授权，授权期限为一年。",
    ]) {
      await t.test(termsText, async () => {
        f.s.save("settings", {
          id: "tme-ai-prepare:job:" + job.id,
          value: {
            ...job,
            terms: {
              termsText,
              termsHash: createHash("sha256").update(termsText).digest("hex"),
            },
          },
        });
        const r = (await f.s.call("publish.simple", input(f, ["qqmusic"])))
          .requests[0];
        assert.equal(r.state, "awaiting_terms_review");
        assert.deepEqual(r.issues, ["请查看条款", termsText]);
        assert.equal(r.materialSnapshot.terms.termsText, termsText);
        assert.equal(
          r.materialSnapshot.terms.termsHash,
          createHash("sha256").update(termsText).digest("hex"),
        );
        assert.equal(r.materialSnapshot.terms.accepted, false);
      });
    }
  } finally {
    f.s.close();
  }
});
test('unified production entry persists a task visible in snapshot and reuses it on repeated click', async () => {
 const f=setup();try {
  await configured(f,'qqmusic','tme');
  const first=await f.s.call('publish.simple',input(f,['qqmusic']));
  assert.equal(first.pipeline.length,1);assert.equal(first.pipeline[0].state,'needs_materials');
  const second=await f.s.call('publish.simple',input(f,['qqmusic']));
  assert.equal(second.pipeline[0].id,first.pipeline[0].id);
  assert.equal(f.s.snapshot().publicationPipelineJobs[0].id,first.pipeline[0].id);
  assert.equal(f.s.all('operations').filter(o=>o.kind==='tme_ai_prepare').length,0);
 }finally{f.s.close()}
});
test('publication metadata save is local, revision checked and cannot change dispatched material',async()=>{
 const f=setup();try{
  await configured(f,'qqmusic','tme');const result=await f.s.call('publish.simple',input(f,['qqmusic']));
  const metadata={albumTitle:'Local album',albumDescription:'Verified description',artistName:'Artist',lyricist:'Writer',composer:'Composer',ownLyrics:false,ownComposition:false,allowCover:false,aiTool:'Actual tool',generatedOn:'2026-10-15',genre:'流行',language:'国语',version:'完整版',releaseMode:'审核通过即发布'};
  const revision=f.s.get('works',f.work.id).revision;
  const saved=await f.s.call('publish.metadata.save',{workId:f.work.id,expectedRevision:revision,metadata});assert.equal(saved.publicationMetadata.aiTool,'Actual tool');
  await assert.rejects(f.s.call('publish.metadata.save',{workId:f.work.id,expectedRevision:revision,metadata}),/REVISION_CONFLICT/);
  const task=f.s.all('settings').find(r=>r.id.startsWith('unified-publication:v1:'));f.s.save('settings',{...task,value:{...task.value,dispatchedAt:'2026-10-18T10:00:00Z'}});
  await assert.rejects(f.s.call('publish.metadata.save',{workId:f.work.id,expectedRevision:saved.revision,metadata}),/PUBLICATION_MATERIALS_LOCKED/);
  assert.equal(f.s.all('operations').filter(o=>o.kind==='tme_ai_prepare').length,0);
 }finally{f.s.close()}
});
