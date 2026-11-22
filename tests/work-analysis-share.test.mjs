import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { compileFunction } from "node:vm";
import test from "node:test";
import { build } from "esbuild";
import sharp from "sharp";

const { outputFiles } = await build({
  stdin: {
    contents: `export { workAnalysisText, shareableRecordings } from "./src/shared/work-analysis";
      export { workAudioExportInfo, exportWorkAudio } from "./src/core/work-audio-share";
      export { workCertificateExportInfo, exportWorkCertificate } from "./src/core/work-certificate";
      export { downloadArtifact } from "./src/core/download-artifact";
      export { setDownloadDirectory } from "./src/core/download-archive";
      export { Repository } from "./src/core/database";
      export { LyricWritingService } from "./src/core/lyric-writing";
      export { assetPath, locate } from "./src/core/assets";
      export { fixtureTone } from "./src/core/workflow/fixture-audio";`,
    resolveDir: process.cwd(),
  },
  write: false,
  bundle: true,
  platform: "node",
  packages: "external",
  format: "cjs",
});
const mod = { exports: {} };
compileFunction(outputFiles[0].text, ["require", "module", "exports", "__dirname"])(
  createRequire(import.meta.url), mod, mod.exports, path.resolve("build"),
);
const { workAnalysisText, shareableRecordings, workAudioExportInfo, exportWorkAudio, assetPath, locate, fixtureTone } = mod.exports;
const { workCertificateExportInfo, exportWorkCertificate } = mod.exports;

test("the analysis context describes the audio, distinguishes loudness and pitch, and selects only useful fields", () => {
  const work = {
    id: randomUUID(),
    title: "夜路",
    assets: { audio_B: randomUUID() },
    lyrics: "[副歌]\n沿着灯走",
    prompt: "低音女声，克制叙事",
    model: "chirp-v6",
    provider: "yourmusic",
    config: { voice: "female", bpmMin: 60, bpmMax: 72 },
    rights: "private-rights",
    providerTaskId: "private-task",
    apiKey: "private-key",
    audioVersions: [
      { assetId: randomUUID(), actualLyrics: { text: "不再绑定的歌词" } },
    ],
  };
  work.audioVersions.push({ assetId: work.assets.audio_B, actualLyrics: { text: "沿着灯火走" } });
  const recordings = shareableRecordings(work, [
    { id: work.assets.audio_B, kind: "audio", ext: "mp3", metadata: { duration: "120", filename: "private-path" } },
  ]);
  assert.deepEqual(recordings.map(recording => recording.version), ["B"]);
  const text = workAnalysisText(work, recordings);
  for (const expected of ["音量", "音高", "时间点", "夜路.mp3", "沿着灯走", "沿着灯火走", "低音女声，克制叙事", "chirp-v6"]) {
    assert.ok(text.includes(expected), expected);
  }
  assert.doesNotMatch(text, /private-|不再绑定的歌词/);
  assert.ok(!text.includes(work.assets.audio_B));
});

test("desktop export keeps original audio bytes, pins the selected binding, and protects the library", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "rainfall-audio-share-"));
  const root = path.join(temp, "library");
  fs.mkdirSync(root);
  const work = { id: randomUUID(), title: "雨:夜/走", alternateTitle: "等:雨/停", assets: { audio_A: randomUUID(), audio_B: randomUUID() } };
  const bytes = fixtureTone();
  const asset = {
    id: work.assets.audio_B, ext: "wav", mime: "audio/wav", kind: "audio", bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  const studio = {
    root,
    get(table, id) {
      if (table === "works" && id === work.id) return work;
      if (table === "assets" && id === asset.id) return asset;
      throw Error("NOT_FOUND");
    },
    locate(id) { return locate(this, id); },
  };
  const file = assetPath(studio, asset);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  const input = { workId: work.id, version: "B", assetId: asset.id };
  const info = workAudioExportInfo(studio, input);
  assert.equal(info.filename, "等_雨_停.wav");
  assert.equal(shareableRecordings({ ...work, title: "CON.demo", alternateTitle: null }, [asset])[0].filename, "_CON.demo.wav");
  const destination = path.join(temp, info.filename);
  await exportWorkAudio(studio, input, destination);
  assert.deepEqual(fs.readFileSync(destination), bytes);
  await assert.rejects(exportWorkAudio(studio, { ...input, version: "A" }, destination), /SHARE_AUDIO_CHANGED/);
  await assert.rejects(exportWorkAudio(studio, input, path.join(root, "export.wav")), /SHARE_DESTINATION_IN_LIBRARY/);
  fs.writeFileSync(file, Buffer.from("tampered"));
  await assert.rejects(exportWorkAudio(studio, input, destination), /ASSET_MISSING_OR_CORRUPT/);
  assert.deepEqual(fs.readFileSync(destination), bytes);
});

test("an imported certificate exports its original bytes and must still be attached to the selected work", async t => {
  const parent = fs.realpathSync.native(os.tmpdir());
  const temp = fs.mkdtempSync(path.join(parent, "rainfall-certificate-"));
  t.after(() => {
    if (path.dirname(temp) === parent && path.basename(temp).startsWith("rainfall-certificate-"))
      fs.rmSync(temp, { recursive: true, force: true });
  });
  const root = path.join(temp, "library");
  const bytes = Buffer.from("%PDF-1.4\n% imported certificate test fixture\n");
  const asset = {
    id: randomUUID(), ext: "pdf", mime: "application/pdf", kind: "document", bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  const work = { id: randomUUID(), title: "雨:夜", assets: { certificate: asset.id } };
  const studio = {
    root,
    get(table, id) {
      if (table === "works" && id === work.id) return work;
      if (table === "assets" && id === asset.id) return asset;
      throw Error("NOT_FOUND");
    },
    locate(id) { return locate(this, id); },
  };
  const file = assetPath(studio, asset);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  const input = { workId: work.id, assetId: asset.id };
  const info = workCertificateExportInfo(studio, input);
  assert.deepEqual(info, { filename: "雨_夜.pdf", extension: "pdf" });
  const destination = path.join(temp, info.filename);
  await exportWorkCertificate(studio, input, destination);
  assert.deepEqual(fs.readFileSync(destination), bytes);
  await assert.rejects(exportWorkCertificate(studio, input, path.join(root, "copy.pdf")), /SHARE_DESTINATION_IN_LIBRARY/);
  work.assets.certificate = randomUUID();
  await assert.rejects(exportWorkCertificate(studio, input, destination), /WORK_CERTIFICATE_CHANGED/);
});

test("app downloads save audio, the adopted lyric, cover and publication materials to the configured directory", async t => {
  const { downloadArtifact, setDownloadDirectory, Repository, LyricWritingService } = mod.exports;
  const parent = fs.realpathSync.native(os.tmpdir());
  const temp = fs.mkdtempSync(path.join(parent, "rainfall-configured-download-"));
  t.after(() => {
    if (path.dirname(temp) === parent && path.basename(temp).startsWith("rainfall-configured-download-"))
      fs.rmSync(temp, { recursive: true, force: true });
  });
  const root = path.join(temp, "library");
  const firstRoot = path.join(temp, "first"), secondRoot = path.join(temp, "second");
  for (const directory of [root, firstRoot, secondRoot]) fs.mkdirSync(directory);
  const repo = new Repository(":memory:");
  t.after(() => repo.close());
  const studio = {
    root, repo, mode: "production", now: () => new Date("2026-11-20T08:00:00Z"),
    get: (table, id) => repo.get(table, id), all: table => repo.all(table), save: (table, value) => repo.save(table, value),
    locate(id) { return locate(this, id); },
    lyricWritingService: () => new LyricWritingService(repo),
  };
  const asset = (ext, kind, mime, bytes) => {
    const saved = repo.save("assets", {
      id: randomUUID(), ext, kind, mime, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    const file = assetPath(studio, saved);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
    return saved.id;
  };
  const audioBytes = fixtureTone();
  const coverBytes = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#333" } }).png().toBuffer();
  const certificateBytes = Buffer.from("%PDF-1.4\n% fixture\n");
  const assets = {
    audio_B: asset("wav", "audio", "audio/wav", audioBytes),
    cover: asset("png", "image", "image/png", coverBytes),
    certificate: asset("pdf", "document", "application/pdf", certificateBytes),
  };
  const artist = repo.save("artists", { id: randomUUID(), name: "歌手" });
  const work = repo.save("works", { id: randomUUID(), artistId: artist.id, revision: 1, assets,
    title: "雨夜", alternateTitle: "等雨停", lyrics: "作品歌词", assetHistory: [] });
  const adopted = { id: randomUUID(), title: work.title, alternateTitle: work.alternateTitle, style: "民谣", lyrics: "采用的歌词" };
  const later = { ...adopted, id: randomUUID(), lyrics: "低分的歌词" };
  const job = repo.save("lyricJobs", { id: randomUUID(), state: "complete", resultVersionId: adopted.id, versions: [adopted, later] });

  const selection = { workId: work.id, version: "B", assetId: assets.audio_B };
  await assert.rejects(downloadArtifact(studio, "workAudio", selection), /DOWNLOAD_ROOT_REQUIRED/);
  setDownloadDirectory(repo, { root: firstRoot, expectedRevision: 0 });
  const initial = path.join(firstRoot, "等雨停.wav");
  fs.writeFileSync(initial, "existing download");
  const audio = await downloadArtifact(studio, "workAudio", selection);
  assert.equal(audio.path, path.join(firstRoot, "等雨停 (2)", "等雨停.wav"));
  assert.deepEqual(fs.readFileSync(audio.path), audioBytes);
  assert.equal(fs.readFileSync(initial, "utf8"), "existing download");

  setDownloadDirectory(repo, { root: secondRoot, expectedRevision: 1 });
  const txt = await downloadArtifact(studio, "lyricResult", { jobId: job.id, versionId: adopted.id });
  assert.equal(txt.path, path.join(secondRoot, "雨夜.txt"));
  assert.equal(fs.readFileSync(txt.path, "utf8"), "\uFEFF雨夜、等雨停\r\n民谣\r\n采用的歌词");
  assert.throws(() => downloadArtifact(studio, "lyricResult", { jobId: job.id, versionId: later.id }), /LYRIC_DOWNLOAD_CHANGED/);

  const cover = await downloadArtifact(studio, "cover", { workId: work.id, size: 1400, noText: true });
  assert.equal(cover.path, path.join(secondRoot, "雨夜.png"));
  assert.equal((await sharp(cover.path).metadata()).width, 1400);
  const certificate = await downloadArtifact(studio, "workCertificate", { workId: work.id, assetId: assets.certificate });
  assert.equal(certificate.path, path.join(secondRoot, "雨夜.pdf"));
  assert.deepEqual(fs.readFileSync(certificate.path), certificateBytes);

  const batch = repo.save("batches", { id: randomUUID(), mode: "production", snapshotHash: "fixture" });
  repo.save("units", { id: randomUUID(), batchId: batch.id, workId: work.id, snapshot: work,
    payload: { lyrics: { plainText: work.lyrics } }, destinations: [] });
  const materials = await downloadArtifact(studio, "materials", { batchId: batch.id });
  assert.equal(path.dirname(materials.path), secondRoot);
  assert.equal(fs.readFileSync(materials.path).subarray(0, 2).toString(), "PK");
  assert.equal(fs.readdirSync(firstRoot).length, 2);
  assert.equal(fs.readdirSync(secondRoot).length, 4);
});
