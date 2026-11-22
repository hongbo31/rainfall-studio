const { Studio } = require("../../build/core.cjs");
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("local artist credit defaults persist, support optional creative details, and survive legacy edits", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rainfall-local-artists-"));
  const studio = new Studio(root, "production");
  t.after(() => studio.close());

  const first = studio.all("artists")[0];
  assert.equal(first.profile, undefined);
  const profile = {
    lyricist: "词作者甲",
    composer: "曲作者乙",
    singer: "歌手丙",
    contractMode: "non_exclusive",
  };
  const created = await studio.call("artist.save", {
    name: "雨夜艺人",
    defaults: { ...first.defaults, genre: "" },
    profile,
  });
  assert.deepEqual(created.profile, profile);
  assert.equal(created.defaults.genre, "");
  const detailed = await studio.call("artist.save", {
    name: "第二位艺人",
    defaults: { ...created.defaults, genre: "流行民谣" },
    profile: { ...profile, gender: "female", voicePersona: "轻声叙事" },
  });
  assert.notEqual(created.id, detailed.id);
  assert.equal(studio.all("artists").at(-1).id, detailed.id);
  const edited = await studio.call("artist.save", {
    id: detailed.id, expected: detailed.revision, name: detailed.name,
    defaults: { ...detailed.defaults, mood: "平静" },
  });
  assert.deepEqual(edited.profile, detailed.profile);
  assert.deepEqual(studio.get("artists", edited.id).profile, detailed.profile);
  await assert.rejects(async () => studio.call("artist.save", {
    name: "无效署名",
    defaults: first.defaults,
    profile: { ...profile, singer: " " },
  }));
});
