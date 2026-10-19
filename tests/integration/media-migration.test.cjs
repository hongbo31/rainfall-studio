const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto"),
  sharp = require("sharp"),
  { execFileSync } = require("node:child_process");
const { ffmpeg, Studio, importLegacy } = require("../../build/core.cjs");
function setup() {
  const root = path.resolve("output/test-runs", randomUUID());
  return { root, s: new Studio(root, "simulation") };
}
test("legacy import is idempotent and never pretends blob audio was saved", async () => {
  const { s, root } = setup(),
    file = path.join(root, "old.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      works: [
        {
          title: "原型原创",
          story: "自己的故事",
          lyrics: "自己的歌词",
          audio: "blob:expired",
          cover: "data:text/html;base64,PHNjcmlwdD4=",
        },
      ],
    }),
  );
  const before = s.all("works").length;
  const r = await importLegacy(s, file);
  assert.equal(r.missingAudio, 1);
  assert.equal(s.all("works").length, before + 1);
  await importLegacy(s, file);
  assert.equal(s.all("works").length, before + 1);
  assert.deepEqual(s.all("works").at(-1).assets, {});
  s.close();
});
test("invalid second legacy record cannot leave the first partially imported", async () => {
  const { s, root } = setup(),
    file = path.join(root, "bad.json");
  fs.writeFileSync(
    file,
    JSON.stringify({ works: [{ title: "合法首项" }, {}] }),
  );
  const before = s.all("works").length;
  await assert.rejects(importLegacy(s, file));
  assert.equal(s.all("works").length, before);
  s.close();
});
test("local MP4 has actual video/audio, vertical work preset and full source duration", async () => {
  const { s, root } = setup();
  const w = await s.call("work.save", {
    title: "QA本地视频",
    artistId: s.all("artists")[0].id,
    story: "原创测试",
    lyrics: "测试文字",
    prompt: "本地",
    parameters: {},
    rights: "QA原创素材",
    ai: "none",
  });
  const audio = path.join(root, "video-audio.wav"),
    cover = path.join(root, "video-cover.png");
  execFileSync(
    ffmpeg,
    [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=1.2",
      "-y",
      audio,
    ],
    { windowsHide: true },
  );
  await sharp({
    create: { width: 512, height: 512, channels: 4, background: "#755783" },
  })
    .png()
    .toFile(cover);
  await s.importFile(audio, "audio_A", w.id);
  await s.importFile(cover, "cover", w.id);
  const video = await s.call("video.prepare", { workId: w.id });
  const p = video.metadata,
    vs = p.streams.find((x) => x.codec_type === "video"),
    as = p.streams.find((x) => x.codec_type === "audio");
  assert.equal(vs.width, 1080);
  assert.equal(vs.height, 1920);
  assert.equal(vs.codec_name, "h264");
  assert.equal(vs.pix_fmt, "yuv420p");
  assert.equal(as.codec_name, "aac");
  assert.ok(Math.abs(Number(p.format.duration) - 1.2) <= 0.1);
  const again = await s.call("video.prepare", { workId: w.id });
  assert.equal(again.id, video.id);
  fs.writeFileSync(
    path.join("output", "video-probe.json"),
    JSON.stringify({ sha256: video.sha256, metadata: p }, null, 2),
  );
  s.close();
});
