import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { parseOfficialStableIdentity } = require(
  process.env.RAINFALL_STABLE_IDENTITY_BUNDLE,
);
const visible = () => ({
  artistNames: ["原创测试艺人"],
  loadedAccountId: 610001,
  loadedArtistId: 720002,
  loadedArtistName: "原创测试艺人",
  loadedHeadAccountId: 610001,
  loadedHeadArtistId: 720002,
});
const fixture = () => ({
  code: "0",
  success: true,
  data: {
    singerInfo: {
      accountId: 610001,
      id: 720002,
      name: "原创测试艺人",
      nickname: "local-display",
      qyinSingerMid: "fixtureSingerMid001",
      platformInfos: [
        { platformName: "QQ音乐", platformType: 0, platformId: 830003 },
        { platformName: "酷狗", platformType: 1, platformId: 940004 },
        { platformName: "5Sing", platformType: 3, platformId: 0 },
      ],
    },
    platformIds: { qyin: 830003, kugou: 940004 },
    qqUserInfo: { nickName: "not-a-stable-id" },
  },
});
const parse = (payload = fixture(), v = visible()) =>
  parseOfficialStableIdentity(payload, v, "2026-10-19T10:10:00.000Z");
test("official response uses separate TME account/artist and exact per-platform artist namespaces", () => {
  const r = parse();
  assert.equal(r.provider, "tme");
  assert.equal(r.namespace, "tme-musician");
  assert.equal(r.remoteAccountId, "610001");
  assert.equal(r.remoteArtistId, "720002");
  assert.equal(r.artistDisplayName, "原创测试艺人");
  assert.deepEqual(
    r.platformArtists.map((p) => [p.platform, p.namespace, p.remoteArtistId]),
    [
      ["qqmusic", "qqmusic-singer", "830003"],
      ["kugou", "kugou-singer", "940004"],
    ],
  );
  assert.equal(r.platformArtists[0].mid, "fixtureSingerMid001");
  assert.match(r.evidenceHash, /^[a-f0-9]{64}$/);
});
test("name equality never substitutes for either positive stable identity", () => {
  for (const key of ["accountId", "id"])
    for (const value of [
      undefined,
      null,
      0,
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
      "01",
      " 610001",
      "1e6",
    ]) {
      const p = fixture();
      p.data.singerInfo[key] = value;
      assert.throws(() => parse(p), /BROWSER_STABLE_IDENTITY/);
    }
});
test("loaded DOM state and visible header must agree with both response IDs", () => {
  for (const change of [
    { loadedAccountId: 610009 },
    { loadedArtistId: 720009 },
    { loadedHeadAccountId: 610009 },
    { loadedHeadArtistId: 720009 },
    { artistNames: ["同名别的页面"] },
    { artistNames: ["原创测试艺人", "另一个"] },
    { loadedArtistName: "另一个" },
  ])
    assert.throws(
      () => parse(fixture(), { ...visible(), ...change }),
      /BROWSER_STABLE_IDENTITY/,
    );
});
test("official success, schema and namespace references fail closed", () => {
  for (const change of [
    { code: 0 },
    { code: "401" },
    { success: false },
    { data: null },
  ])
    assert.throws(
      () => parse({ ...fixture(), ...change }),
      /BROWSER_STABLE_IDENTITY/,
    );
  const p = fixture();
  p.data.platformIds.qyin = 830099;
  assert.throws(() => parse(p), /BROWSER_PLATFORM_ARTIST/);
  const q = fixture();
  q.data.singerInfo.platformInfos.push({
    ...q.data.singerInfo.platformInfos[0],
  });
  assert.throws(() => parse(q), /BROWSER_PLATFORM_ARTIST/);
});
test("unknown numeric platformType cannot become a guessed QQ or Kugou identity", () => {
  const p = fixture();
  p.data.singerInfo.platformInfos[0].platformName = "Unknown platform";
  const r = parse(p);
  assert.equal(
    r.platformArtists.some((p) => p.platform === "qqmusic"),
    false,
  );
  assert.equal(
    r.platformArtists.some((p) => p.platform === "kugou"),
    true,
  );
});
test("private fields and platform login names are not copied into calibrated evidence", () => {
  const p = fixture();
  p.data.token = "never-copy";
  p.data.cookie = "never-copy";
  p.data.personInfo = { name: "private-person", id: 1 };
  p.data.qqUserInfo.nickName = "only-a-login-name";
  const r = parse(p),
    json = JSON.stringify(r);
  for (const word of [
    "never-copy",
    "private-person",
    "only-a-login-name",
    "personInfo",
    "cookie",
    "token",
  ])
    assert.equal(json.includes(word), false);
  assert.notEqual(
    r.remoteAccountId,
    String(p.data.singerInfo.platformInfos[1].platformId),
  );
});

const { readFreshOfficialStableIdentity } = require(
  process.env.RAINFALL_STABLE_FAKE_PAGE_BUNDLE,
);
function fakePages(first = visible(), last = first, temporaryView = visible()) {
  let opens = 0,
    closed = 0,
    reads = 0,
    tempUrl = "about:blank";
  const pages = [];
  const context = { pages: () => pages };
  const primary = {
    url: () => "https://y.tencentmusic.com/#/user/musician/index",
    context: () => context,
    evaluate: async () => structuredClone(reads++ === 0 ? first : last),
    __offline: {
      open: async () => {
        opens++;
        pages.push(temporary);
        return temporary;
      },
    },
  };
  const response = {
    url: () => "https://y.tencentmusic.com/v2/v2/user/getUserInfo",
    request: () => ({ method: () => "GET" }),
    status: () => 200,
    frame: () => ({ page: () => temporary, url: () => tempUrl }),
    headerValue: async (key) =>
      key === "content-type" ? "application/json" : null,
    body: async () => Buffer.from(JSON.stringify(fixture())),
  };
  const temporary = {
    url: () => tempUrl,
    context: () => context,
    goto: async (url) => {
      tempUrl = url;
    },
    waitForResponse: async (predicate) => {
      assert.equal(predicate(response), true);
      return response;
    },
    waitForFunction: async () => undefined,
    evaluate: async () => structuredClone(temporaryView),
    close: async () => {
      closed++;
      pages.splice(pages.indexOf(temporary), 1);
    },
  };
  pages.push(primary);
  return { primary, counts: () => ({ opens, closed, pages: pages.length }) };
}
test("initial contradictory loaded primary identity is refused before a background page is opened", async () => {
  for (const patch of [
    { loadedHeadAccountId: 610009 },
    { loadedHeadArtistId: 720009 },
    { loadedArtistName: "另一位艺人" },
  ]) {
    const x = fakePages({ ...visible(), ...patch });
    await assert.rejects(
      () => readFreshOfficialStableIdentity(x.primary),
      /BROWSER_STABLE_IDENTITY_SCOPE/,
    );
    assert.equal(x.counts().opens, 0);
  }
});
test("final primary head identity or loaded-name drift is refused and only owned background page closes", async () => {
  for (const patch of [
    { loadedHeadAccountId: 610009 },
    { loadedHeadArtistId: 720009 },
    { loadedArtistName: "另一位艺人" },
  ]) {
    const x = fakePages(visible(), { ...visible(), ...patch });
    await assert.rejects(
      () => readFreshOfficialStableIdentity(x.primary),
      /BROWSER_STABLE_IDENTITY_SCOPE|ACCOUNT_CHANGED/,
    );
    assert.deepEqual(x.counts(), { opens: 1, closed: 1, pages: 1 });
  }
});
test("unchanged primary and fresh matching response complete with no binding or context mutation", async () => {
  const x = fakePages();
  const r = await readFreshOfficialStableIdentity(x.primary);
  assert.equal(r.remoteAccountId, "610001");
  assert.equal(r.remoteArtistId, "720002");
  assert.deepEqual(x.counts(), { opens: 1, closed: 1, pages: 1 });
});
test("contradictory temporary response/view is rejected and its page is cleaned up", async () => {
  const x = fakePages(visible(), visible(), {
    ...visible(),
    loadedHeadArtistId: 720009,
  });
  await assert.rejects(
    () => readFreshOfficialStableIdentity(x.primary),
    /BROWSER_STABLE_IDENTITY_SCOPE/,
  );
  assert.deepEqual(x.counts(), { opens: 1, closed: 1, pages: 1 });
});
