import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import type { Studio } from "./studio";
// Fixed, trusted installation locations only: never search PATH or download tools.
export function mediaToolPath(tool: "ffmpeg" | "ffprobe", platform = process.platform,
  bundledRoot = path.resolve(__dirname, '..', 'tools', 'media'), exists = fs.existsSync) {
  if (tool !== "ffmpeg" && tool !== "ffprobe") throw Error("MEDIA_TOOL_UNSUPPORTED");
  const bundled = path.join(bundledRoot, platform === 'win32' ? `${tool}.exe` : tool);
  if (exists(bundled)) return bundled;
  if (platform === "linux") return `/usr/bin/${tool}`;
  if (platform === "win32")
    return `C:\\ffmpeg\\ffmpeg-8.1-essentials_build\\bin\\${tool}.exe`;
  throw Error("MEDIA_TOOL_PLATFORM_UNSUPPORTED");
}
export const ffmpeg = mediaToolPath("ffmpeg");
export const ffprobe = mediaToolPath("ffprobe");
export function digest(file: string) {
  const h = createHash("sha256");
  const fd = fs.openSync(file, "r");
  try {
    const b = Buffer.alloc(1024 * 1024);
    let n;
    while ((n = fs.readSync(fd, b, 0, b.length, null)) > 0)
      h.update(b.subarray(0, n));
    return h.digest("hex");
  } finally {
    fs.closeSync(fd);
  }
}
export function assetPath(s: Studio, a: any) {
  if (!/^[a-f0-9]{64}$/.test(a.sha256) || !/^[a-z0-9]+$/.test(a.ext))
    throw Error("PATH_INVALID");
  const media = path.join(s.root, "media");
  const parent = path.join(media, "sha256", a.sha256.slice(0, 2));
  for (const folder of [media, path.join(media, "sha256"), parent]) {
    if (fs.existsSync(folder) && fs.lstatSync(folder).isSymbolicLink())
      throw Error("ASSET_PATH_REJECTED");
  }
  return path.join(parent, `${a.sha256}.${a.ext}`);
}
export function probe(file: string) {
  if (!fs.existsSync(ffprobe)) throw Error("FFPROBE_MISSING");
  return JSON.parse(
    execFileSync(
      ffprobe,
      [
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-format_whitelist",
        "wav,mp3,flac,ogg,mov,matroska,webm",
        "-show_format",
        "-show_streams",
        "-of",
        "json",
        file,
      ],
      {
        encoding: "utf8",
        timeout: 15000,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
      },
    ),
  );
}
export async function importFile(
  s: Studio,
  source: string,
  role: string,
  workId?: string,
  beforePersist?:()=>void,
) {
  if (
    source.startsWith("\\\\") ||
    !path.isAbsolute(source) ||
    fs.lstatSync(source).isSymbolicLink()
  )
    throw Error("SOURCE_REJECTED");
  const real = fs.realpathSync(source);
  if (!fs.statSync(real).isFile()) throw Error("FILE_REQUIRED");
  const kind = role.startsWith("audio")
    ? "audio"
    : role === "cover"
      ? "image"
      : role === "video"
        ? "video"
        : "document";
  const max =
    kind === "audio"
      ? 2 * 1024 ** 3
      : kind === "image"
        ? 50 * 1024 ** 2
        : kind === "video"
          ? 4 * 1024 ** 3
          : 50 * 1024 ** 2;
  const size = fs.statSync(real).size;
  if (!size || size > max) throw Error("FILE_SIZE_LIMIT");
  let metadata: any = {},
    ext = "bin",
    mime = "application/octet-stream";
  if (kind === "image") {
    metadata = await sharp(real, { limitInputPixels: 100000000 }).metadata();
    if (!["png", "jpeg", "webp"].includes(metadata.format))
      throw Error("IMAGE_FORMAT");
    ext = metadata.format === "jpeg" ? "jpg" : metadata.format;
    mime = "image/" + metadata.format;
  } else if (kind === "audio" || kind === "video") {
    metadata = probe(real);
    const audio = metadata.streams?.find((x: any) => x.codec_type === "audio");
    const video = metadata.streams?.find(
      (x: any) => x.codec_type === "video" && !x.disposition?.attached_pic,
    );
    if (!audio || !Number.isFinite(Number(metadata.format?.duration)))
      throw Error("AUDIO_INVALID");
    if (kind === "video" && !video) throw Error("VIDEO_INVALID");
    const format = metadata.format.format_name;
    ext =
      kind === "video"
        ? "mp4"
        : format.includes("wav")
          ? "wav"
          : format.includes("mp3")
            ? "mp3"
            : format.includes("flac")
              ? "flac"
              : format.includes("ogg")
                ? "ogg"
                : format.includes("mp4")
                  ? "m4a"
                  : "";
    if (!ext) throw Error("UNSUPPORTED_AUDIO");
    mime =
      kind === "video"
        ? "video/mp4"
        : ext === "m4a"
          ? "audio/mp4"
          : "audio/" + ext;
  }
  const persist=()=>{
  const sha256 = digest(real);
  let asset = s.all("assets").find((a) => a.sha256 === sha256);
  if (!asset) {
    asset = {
      id: randomUUID(),
      sha256,
      kind,
      ext,
      mime,
      bytes: size,
      metadata,
      createdAt: s.now().toISOString(),
      source: "import",
      label: path.basename(real),
    };
    const dest = assetPath(s, asset);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const space = fs.statfsSync(s.root);
    if (Number(space.bavail) * Number(space.bsize) < size + 50 * 1024 ** 2)
      throw Error("DISK_SPACE");
    const stage = path.join(s.root, "staging", randomUUID());
    fs.mkdirSync(path.dirname(stage), { recursive: true });
    try {
      fs.copyFileSync(real, stage);
      if (digest(stage) !== sha256) throw Error("SOURCE_CHANGED");
      const fd = fs.openSync(stage, "r+");
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      if (!fs.existsSync(dest)) fs.renameSync(stage, dest);
      else fs.unlinkSync(stage);
      s.save("assets", asset);
    } finally {
      if (fs.existsSync(stage)) fs.unlinkSync(stage);
    }
  }
  if (workId) {
    const w = s.get("works", workId);
    w.assets = { ...w.assets, [role]: asset.id };
    if (role === 'audio_A') w.lyricsConfirmation = null;
    w.assetHistory = [...new Set([...(w.assetHistory || []), asset.id])];
    s.save("works", w);
    s.repo.audit("asset.import", workId, { assetId: asset.id, role });
    s.refreshRunForWork(workId);
  }
  return asset;
  };
  // Guarded plan-cover imports recheck under the write lock after all image awaits.
  return beforePersist?s.repo.transaction(()=>{beforePersist();return persist();}):persist();
}
export function locate(s: Studio, id: string) {
  const a = s.get("assets", id);
  const file = assetPath(s, a);
  if (
    !fs.existsSync(file) ||
    fs.lstatSync(file).isSymbolicLink() ||
    fs.statSync(file).size !== a.bytes ||
    digest(file) !== a.sha256
  )
    throw Error("ASSET_MISSING_OR_CORRUPT");
  return { file, mime: a.mime, bytes: a.bytes };
}
export async function prepareVideo(s: Studio, workId: string, recordingSlot: 'audio_A'|'audio_B' = 'audio_A') {
  const w = s.get("works", workId);
  if (!w.assets[recordingSlot] || !w.assets.cover) throw Error("AUDIO_COVER_REQUIRED");
  if (!fs.existsSync(ffmpeg)) throw Error("FFMPEG_MISSING");
  const audio = locate(s, w.assets[recordingSlot]),
    cover = locate(s, w.assets.cover);
  const key = `${w.assets[recordingSlot]}:${w.assets.cover}:vertical-v1`;
  const found = s.all("assets").find((a) => a.derivedKey === key);
  if (found) {
    w.assets.video = found.id;
    s.save("works", w);
    return found;
  }
  const dest = path.join(s.root, "staging", randomUUID() + ".mp4");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    execFileSync(
      ffmpeg,
      [
        "-nostdin",
        "-v",
        "error",
        "-y",
        "-protocol_whitelist",
        "file,pipe",
        "-format_whitelist",
        "image2,image2pipe,png_pipe,jpeg_pipe,webp_pipe",
        "-loop",
        "1",
        "-i",
        cover.file,
        "-protocol_whitelist",
        "file,pipe",
        "-format_whitelist",
        "wav,mp3,flac,ogg,mov,matroska,webm",
        "-i",
        audio.file,
        "-vf",
        "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=0x211b2b,setsar=1",
        "-r",
        "30",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-tune",
        "stillimage",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-shortest",
        "-movflags",
        "+faststart",
        dest,
      ],
      { timeout: 150000, maxBuffer: 1024 * 1024, windowsHide: true },
    );
    const a = await importFile(s, dest, "video", workId);
    a.derivedKey = key;
    s.save("assets", a);
    return a;
  } finally {
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
  }
}
const escape = (v: string) =>
  v.replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
export async function exportCover(
  s: Studio,
  workId: string,
  dest: string,
  options: any,
) {
  const w = s.get("works", workId);
  if (!w.assets.cover) throw Error("COVER_REQUIRED");
  const a = locate(s, w.assets.cover);
  const artist = s.get("artists", w.artistId);
  const size = [1400, 3000].includes(options?.size) ? options.size : 3000;
  const characters = Array.from(w.title);
  const lines =
    characters.length <= 16
      ? [w.title]
      : Array.from({ length: characters.length <= 40 ? 2 : 3 }, (_, i) => {
          const count = characters.length <= 40 ? 2 : 3;
          const per = Math.ceil(characters.length / count);
          return characters.slice(i * per, (i + 1) * per).join("");
        });
  const font = Math.min(
    size * 0.055,
    (size * 0.84) /
      (Math.max(...lines.map((x) => Array.from(x).length)) * 1.05),
  );
  const artistFont = Math.min(
    size * 0.025,
    (size * 0.84) / Math.max(1, Array.from(artist.name).length * 1.05),
  );
  const text = lines
    .map(
      (line, i) =>
        '<text x="' +
        size * 0.08 +
        '" y="' +
        (size * 0.79 + i * font * 1.25) +
        '" font-family="Microsoft YaHei" font-size="' +
        font +
        '" fill="white">' +
        escape(line) +
        "</text>",
    )
    .join("");
  const svg = `<svg width="${size}" height="${size}"><rect y="${size * 0.7}" width="${size}" height="${size * 0.3}" fill="#15101a" fill-opacity=".65"/>${text}<text x="${size * 0.08}" y="${size * 0.94}" font-family="Microsoft YaHei" font-size="${artistFont}" fill="#d8c6e4">${escape(artist.name)}</text></svg>`;
  const bytes = await sharp(a.file)
    .resize(size, size, { fit: "cover" })
    .composite(options?.noText ? [] : [{ input: Buffer.from(svg) }])
    .png()
    .toBuffer();
  fs.writeFileSync(dest, bytes);
  const result = await importFile(s, dest, "cover");
  result.parentId = w.assets.cover;
  result.derivedKey = `cover:${w.id}:${w.revision}:${size}:${!!options?.noText}`;
  s.save("assets", result);
  w.assetHistory = [...new Set([...(w.assetHistory || []), result.id])];
  s.save("works", w);
  return {
    path: dest,
    assetId: result.id,
    width: size,
    height: size,
    notice: "本地工作预设，平台规则待核实",
  };
}
