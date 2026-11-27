import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { hash } from "./database";
import {
  downloadAccountPart, downloadFolderName, downloadPromptFromFolder, downloadSingerPart, resolveDownloadArchiveRoot,
} from "./download-archive";
import { downloadSupportFolders, songDownloadCollisionStem } from "./download-filenames";
import type { Studio } from "./studio";
import { PlatformAccountIdSchema } from "../shared/platform-accounts";
import { artistMusicTypeSchema, artistSongAttributeSchema, artistSongType, type ArtistProfile } from "../shared/local-artist";
import { defaultFanqieDirectoryRelease, fanqieOriginalSingerSchema, fanqieOriginalWorkIdSchema,
  type FanqieDirectoryRelease, type FanqieDownloadSong } from "../shared/fanqie-downloads";
import type { FanqieInput } from "../shared/fanqie";
import { fanqieTitleKey } from "../shared/fanqie-catalog";

export type FanqieDownloadFile = { file: string; bytes: number; identity: string };
export type FanqieDownloadTrack = FanqieDownloadSong & {
  artistId?: string;
  credits?: FanqieInput["authors"];
  instrumental?: true;
  formTitle?: string;
  originalTitle?: string;
  relatedFiles?: string[];
  source?: { audio: FanqieDownloadFile; cover: FanqieDownloadFile; lyrics?: FanqieDownloadFile; proof?: FanqieDownloadFile };
};
export type FanqieDownloadScanCounts = {
  configuredArtistCount?: number;
  rootEntryCount?: number;
  accountDirectoryCount?: number;
  matchedArtistDirectoryCount?: number;
  scannedArtistDirectoryCount?: number;
  audioCandidateCount?: number;
  candidateCount?: number;
  readyCount?: number;
  issueCounts?: Record<string, number>;
};
export type FanqieDownloadScanStage = {
  step: "account-settings" | "download-root" | "root-enumeration" | "account-folders" |
    "artist-folders" | "audio-files" | "material-validation" | "result";
  phase: "begin" | "ok" | "error";
  counts?: FanqieDownloadScanCounts;
  code?: string;
};
export type FanqieDownloadScanDiagnostics = { stages: FanqieDownloadScanStage[]; failureCode?: string };
export type FanqieDownloadArchive = {
  fingerprint: string; items: FanqieDownloadTrack[]; root?: string;
  promptEngines?: Record<string, string>;
  scanDiagnostics?: FanqieDownloadScanDiagnostics;
};
const ScopeSchema = z.strictObject({ folder: z.string().min(1).max(255), id: z.string().regex(/^[a-f0-9]{64}$/u) });
export type FanqieDownloadScope = z.infer<typeof ScopeSchema>;
const ArchiveRequest = PlatformAccountIdSchema.extend({ scope: ScopeSchema.optional() });

const key = (name: string) => {
  const normalized = name.normalize("NFC");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
};
const byName = (left: string, right: string) => left.localeCompare(right, "zh-CN", { numeric: true });
const samePath = (a: string, b: string) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
// Accept common, unencrypted audio sources. Fanqie uploads only WAV/MP3, so
// the preparation stage transcodes other supported sources to a validated WAV.
const audioExtensions = new Set([".wav", ".mp3", ".flac", ".m4a", ".m4b", ".aac", ".ogg", ".opus", ".wma",
  ".aiff", ".aif", ".ape", ".mp2", ".mka", ".ac3", ".amr", ".caf", ".dts", ".wv", ".tta",
  ".tak", ".au", ".snd", ".voc", ".3gp", ".3g2"]);
const encryptedAudioExtensions = new Set([".ncm", ".qmc0", ".qmc3", ".qmcflac", ".kgm", ".kwm"]);
const coverExtensions = [".png", ".jpg", ".jpeg"];
const proofExtensions = [".pdf", ...coverExtensions, ".zip", ".bmp"];
const readFingerprint = (info: fs.BigIntStats) =>
  [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].map(String).join(":");

function snapshotFile(file: string): FanqieDownloadFile {
  const info = fs.lstatSync(file, { bigint: true });
  if (!info.isFile() || info.isSymbolicLink() || !samePath(fs.realpathSync.native(file), file))
    throw Error("FANQIE_DOWNLOAD_FILE_INVALID");
  return { file, bytes: Number(info.size), identity: readFingerprint(info) };
}

export function assertFanqieDownloadFile(expected: FanqieDownloadFile) {
  try {
    if (snapshotFile(expected.file).identity === expected.identity) return;
  } catch { /* Missing or replaced files use the same scope error. */ }
  throw Error("FANQIE_DOWNLOADS_CHANGED");
}

export function assertFanqieDownloadTrack(track: FanqieDownloadTrack) {
  const source = track.source;
  if (!source) throw Error("FANQIE_DOWNLOAD_FILE_INVALID");
  for (const expected of Object.values(source)) if (expected) assertFanqieDownloadFile(expected);
}

type Singer = { name: string; part: string; artistId: string; profile?: ArtistProfile; instrumental: boolean; folder: string; promptEngine?: string; release: FanqieDirectoryRelease };

function singerForFolder(folder: string, rest: string, singers: Singer[]) {
  // The archive folder contract is `<account>_<singer>_<prompt>`. Prompt names
  // may themselves contain underscores, so match the longest configured singer
  // prefix and require a non-empty prompt suffix instead of splitting by `_`.
  const matching = singers.filter(singer => key(rest).startsWith(key(singer.part) + "_") &&
    rest.slice(singer.part.length + 1).trim());
  const longest = Math.max(0, ...matching.map(singer => singer.part.length));
  const possible = matching.filter(singer => singer.part.length === longest);
  const exact = possible.filter(singer => key(folder) === key(singer.folder) || key(folder) === key(singer.folder + "_B"));
  const candidates = exact.length ? exact : possible;
  const identities = new Set(candidates.map(singer => singer.name));
  if (identities.size > 1) return { name: candidates[0].part, issue: "FANQIE_DOWNLOAD_SINGER_AMBIGUOUS" };
  const saved = candidates[0];
  if (saved) {
    // Multiple configurations may share a singer. Use defaults only when their relevant values agree.
    const sameDetails = candidates.every(candidate =>
      candidate.instrumental === saved.instrumental && candidate.profile?.lyricist === saved.profile?.lyricist &&
      candidate.profile?.composer === saved.profile?.composer && hash(candidate.release) === hash(saved.release));
    if (!sameDetails) return { name: saved.name, issue: "FANQIE_DOWNLOAD_SINGER_AMBIGUOUS" };
    return { name: saved.name, saved };
  }
  return undefined;
}

function readArchiveDirectory(directory: string) {
  try {
    const info = fs.lstatSync(directory, { throwIfNoEntry: false });
    if (!info?.isDirectory() || info.isSymbolicLink() || !samePath(fs.realpathSync.native(directory), directory)) return [];
    return fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    throw Error("DOWNLOAD_FOLDER_UNAVAILABLE");
  }
}

function scanFolder(root: string, folder: string, singer: NonNullable<ReturnType<typeof singerForFolder>>) {
  const directory = path.join(root, folder);
  const entries = readArchiveDirectory(directory);
  const tracks = scanRecordings(directory, entries, folder, singer);
  for (const entry of entries.sort((a, b) => byName(a.name, b.name))) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const stem = songDownloadCollisionStem(entry.name);
    if (!stem) continue;
    const child = path.join(directory, entry.name);
    tracks.push(...scanRecordings(child, readArchiveDirectory(child), folder, singer, stem));
  }
  return tracks;
}

function scanRecordings(directory: string, entries: fs.Dirent[], folder: string,
  singer: NonNullable<ReturnType<typeof singerForFolder>>, expectedStem?: string) {
  const names = entries
    .filter(entry => entry.isFile() && !entry.isSymbolicLink()).map(entry => entry.name)
    .sort(byName);
  const records = names.map(name => {
    const { name: stem, ext } = path.parse(name);
    return { name, stem, ext: ext.toLowerCase() };
  });
  const byStem = new Map<string, typeof records>();
  for (const record of records) {
    const stem = key(record.stem);
    const group = byStem.get(stem);
    if (group) group.push(record);
    else byStem.set(stem, [record]);
  }
  const match = (stem: string, extensions: string[], label?: string) => {
    const exact = byStem.get(key(stem)) ?? [];
    for (const ext of extensions) {
      const files = exact.filter(file => file.ext === ext);
      if (files.length > 1) throw Error("FANQIE_DOWNLOAD_MATERIALS_AMBIGUOUS");
      if (files.length) return files[0].name;
    }
    if (!label) return;
    const scope = key(stem + "_" + label + "_");
    for (const ext of extensions) {
      const files = records.filter(file => file.ext === ext && key(file.stem).startsWith(scope) &&
        /^[a-f0-9]{12}$/iu.test(file.stem.slice(scope.length)));
      if (files.length > 1) throw Error("FANQIE_DOWNLOAD_MATERIALS_AMBIGUOUS");
      if (files.length) return files[0].name;
    }
  };
  const recordings = records.filter(record => (audioExtensions.has(record.ext) || encryptedAudioExtensions.has(record.ext)) &&
      (expectedStem === undefined || key(record.stem) === key(expectedStem)))
    .sort((a, b) => byName(a.stem, b.stem) || Number(b.ext === ".wav") - Number(a.ext === ".wav"));
  const savedProofs = singer.saved?.release.proofRequired && recordings.length
    ? readArchiveDirectory(path.join(directory, downloadSupportFolders.rights)).filter(entry => entry.isFile() && !entry.isSymbolicLink()) : [];
  const savedProof = (stem: string) => {
    for (const ext of proofExtensions) {
      const files = savedProofs.filter(entry => path.extname(entry.name).toLowerCase() === ext && key(path.parse(entry.name).name) === key(stem));
      if (files.length > 1) throw Error("FANQIE_DOWNLOAD_MATERIALS_AMBIGUOUS");
      if (files.length) return path.join(downloadSupportFolders.rights, files[0].name);
    }
  };
  return recordings.map(({ name: audioName, stem }): FanqieDownloadTrack => {
    const exactCover = byStem.get(key(stem))?.some(file => coverExtensions.includes(file.ext));
    const archived = expectedStem === undefined && !exactCover
      ? /^(.*)_([AB])_([a-f0-9]{12})$/iu.exec(stem) : null;
    const titleStem = archived ? archived[1] + " - " + archived[2].toUpperCase() : stem;
    const formTitle = (/《([^》]+)》/u.exec(titleStem)?.[1] ?? titleStem).trim();
    const baseTitle = (archived?.[1] ?? /^(.*) - [AB](?: \(\d+\))?$/u.exec(formTitle)?.[1])?.trim();
    const profile = singer.saved?.profile;
    const release = singer.saved?.release ?? defaultFanqieDirectoryRelease;
    // The creator site appends the original singer to the catalog name for a cover.
    const catalogTitle = (name: string) => release.originalSinger
      ? name.replace(/\(Cover[^)]*\)/gi, "").trim() + `(Cover ${release.originalSinger})` : name;
    const title = catalogTitle(formTitle);
    const originalTitle = baseTitle && catalogTitle(baseTitle);
    const track: FanqieDownloadTrack = {
      id: hash([directory, audioName]), folder, audioName, title, singer: singer.name, release,
      ...(formTitle !== title ? { formTitle } : {}),
      ...(originalTitle && originalTitle !== title ? { originalTitle } : {}),
      ...(singer.saved ? { artistId: singer.saved.artistId } : {}),
      ...(profile ? { credits: { lyricist: profile.lyricist, composer: profile.composer, singer: singer.name } } : {}),
      ...(singer.saved?.instrumental ? { instrumental: true as const } : {}),
    };
    try {
      const coverName = match(stem, coverExtensions) ?? (archived &&
        (archived[2].toUpperCase() === "B" ? match(archived[1], coverExtensions, "封面 B") : undefined)) ??
        (archived ? match(archived[1], coverExtensions, "封面") : undefined);
      // Whether a lyric attachment exists is determined by the matching TXT file, not the artist's local song-type default.
      const lyricsName = match(stem, [".txt"]) ?? (archived ? match(archived[1], [".txt"], "歌词") : undefined);
      const proofName = release.proofRequired ?
        savedProof(stem) ?? match(stem + "_版权证明", proofExtensions) ?? match(stem + " - 版权证明", proofExtensions) ??
        match(stem + "_授权附件", proofExtensions) ?? match(stem, [".pdf"]) ??
        (archived ? match(archived[1], proofExtensions, "授权附件") : undefined) : undefined;
      track.relatedFiles = [audioName, coverName, lyricsName, proofName]
        .filter((file): file is string => typeof file === "string").map(file => path.join(directory, file));
      if (singer.issue) throw Error(singer.issue);
      if (encryptedAudioExtensions.has(path.extname(audioName).toLowerCase())) throw Error("FANQIE_AUDIO_ENCRYPTED_SOURCE");
      if (!formTitle || formTitle.length > 40) throw Error("FANQIE_TITLE_INVALID");
      if (typeof coverName !== "string") throw Error("FANQIE_DOWNLOAD_COVER_REQUIRED");
      if (release.proofRequired && !proofName) throw Error("FANQIE_DOWNLOAD_PROOF_REQUIRED");
      if (release.musicType === "cover" && !release.originalSinger) throw Error("FANQIE_DOWNLOAD_ORIGINAL_SINGER_REQUIRED");
      if (release.songAttribute === "multi_version" && !release.originalWorkId) throw Error("FANQIE_DOWNLOAD_ORIGINAL_WORK_REQUIRED");
      const audio = snapshotFile(path.join(directory, audioName));
      const cover = snapshotFile(path.join(directory, coverName));
      const lyrics = lyricsName ? snapshotFile(path.join(directory, lyricsName)) : undefined;
      const proof = proofName ? snapshotFile(path.join(directory, proofName)) : undefined;
      if (audio.bytes < 1 || audio.bytes > 200 * 1024 * 1024) throw Error("FANQIE_AUDIO_FORMAT");
      if (cover.bytes < 1 || cover.bytes > 10 * 1024 * 1024) throw Error("FANQIE_COVER_FORMAT");
      if (lyrics && lyrics.bytes > 1024 * 1024) throw Error("FANQIE_LYRICS_INVALID");
      if (proof && (proof.bytes < 1 || proof.bytes > 200 * 1024 * 1024)) throw Error("FANQIE_DOWNLOAD_PROOF_INVALID");
      return { ...track, source: { audio, cover, lyrics, proof } };
    } catch (error) {
      const issue = error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message) ? error.message : "FANQIE_DOWNLOAD_FILE_INVALID";
      return { ...track, issue };
    }
  });
}

export function readFanqieDownloadArchive(studio: Pick<Studio, "repo" | "mode">, raw: unknown): FanqieDownloadArchive {
  if (studio.mode !== "production") throw Error("PRODUCTION_REQUIRED");
  const { accountId, scope } = ArchiveRequest.parse(raw);
  const items: FanqieDownloadTrack[] = [];
  const diagnostics: FanqieDownloadScanDiagnostics = { stages: [] };
  const counts: FanqieDownloadScanCounts = {};
  let root: string | undefined;
  let activeStep: FanqieDownloadScanStage["step"] = "account-settings";
  const record = (step: FanqieDownloadScanStage["step"], phase: FanqieDownloadScanStage["phase"], code?: string) => {
    activeStep = step;
    diagnostics.stages.push({ step, phase, counts: { ...counts,
      ...(counts.issueCounts ? { issueCounts: { ...counts.issueCounts } } : {}) }, ...(code ? { code } : {}) });
  };
  const summarizeIssues = (rows: FanqieDownloadTrack[]) => rows.reduce<Record<string, number>>((result, item) => {
    if (item.issue) result[item.issue] = (result[item.issue] ?? 0) + 1;
    return result;
  }, {});
  try {
    record("account-settings", "begin");
    const account = studio.repo.maybe("accounts", accountId);
    if (!account || account.provider !== "fanqie" || !account.name?.trim()) throw Error("FANQIE_DOWNLOAD_ACCOUNT_REQUIRED");
    const prefix = downloadAccountPart(account.name) + "_";
    const accounts = studio.repo.all("accounts").filter(row => row.id !== accountId && row.name?.trim());
    const otherPrefixes = accounts.map(row => ({ prefix: key(downloadAccountPart(row.name)) + "_", fanqie: row.provider === "fanqie" }));
    if (otherPrefixes.some(row => row.fanqie && row.prefix === key(prefix))) throw Error("FANQIE_DOWNLOAD_ACCOUNT_AMBIGUOUS");
    const singers: Singer[] = studio.repo.all("accountLocalArtists").filter(row => row.accountId === accountId).flatMap(row => {
      const profile: ArtistProfile | undefined = row.profile;
      const prompt = row.promptTemplateId ? studio.repo.maybe("promptTemplates", row.promptTemplateId)?.name : undefined;
      const originalSinger = row.musicType === "cover" ? fanqieOriginalSingerSchema.safeParse(row.originalSinger).data : undefined;
      const originalWorkId = row.songAttribute === "multi_version" ? fanqieOriginalWorkIdSchema.safeParse(row.originalWorkId).data : undefined;
      const release: FanqieDirectoryRelease = {
        musicType: artistMusicTypeSchema.safeParse(row.musicType).data ?? defaultFanqieDirectoryRelease.musicType,
        songAttribute: artistSongAttributeSchema.safeParse(row.songAttribute).data ?? defaultFanqieDirectoryRelease.songAttribute,
        ai: typeof row.isAiWork === "boolean" ? row.isAiWork : defaultFanqieDirectoryRelease.ai,
        proofRequired: row.hasCopyrightProof === true,
        ...(originalSinger ? { originalSinger } : {}),
        ...(originalWorkId ? { originalWorkId } : {}),
        ...(profile?.contractMode ? { contractMode: profile.contractMode === "non_exclusive" ? "nonexclusive" as const : "exclusive" as const } : {}),
      };
      const names: string[] = [profile?.singer ?? row.name, row.secondSinger?.name].filter(name => typeof name === "string" && name.trim());
      return [...new Set(names)].map(name => ({
        name: name.trim(), part: downloadSingerPart(name), artistId: row.id, profile,
        instrumental: artistSongType(row.defaults) === "instrumental", folder: downloadFolderName(account.name, name, prompt),
        promptEngine: prompt, release,
      }));
    });
    counts.configuredArtistCount = singers.length;
    record("account-settings", "ok");

    record("download-root", "begin");
    root = resolveDownloadArchiveRoot(studio.repo) ?? undefined;
    if (!root) throw Error("DOWNLOAD_ROOT_REQUIRED");
    record("download-root", "ok");

    record("root-enumeration", "begin");
    let directories: fs.Dirent[];
    try { directories = fs.readdirSync(root, { withFileTypes: true }); }
    catch { throw Error("DOWNLOAD_ROOT_UNAVAILABLE"); }
    counts.rootEntryCount = directories.length;
    record("root-enumeration", "ok");

    record("account-folders", "begin");
    const accountDirectories = directories.filter(entry => entry.isDirectory() && !entry.isSymbolicLink() &&
      key(entry.name).startsWith(key(prefix)) &&
      !otherPrefixes.some(row => row.prefix.length > prefix.length && key(entry.name).startsWith(row.prefix)));
    counts.accountDirectoryCount = accountDirectories.length;
    if (!accountDirectories.length) throw Error("FANQIE_DOWNLOAD_ACCOUNT_FOLDER_NOT_FOUND");
    record("account-folders", "ok");

    const seenTitles = new Set<string>();
    record("artist-folders", "begin");
    const recognizedFolders: { entry: fs.Dirent; singer: NonNullable<ReturnType<typeof singerForFolder>> }[] = [];
    for (const entry of accountDirectories.sort((a, b) => byName(a.name, b.name))) {
      if (scope && entry.name !== scope.folder) continue;
      const singer = singerForFolder(entry.name, entry.name.normalize("NFC").slice(prefix.length), singers);
      if (!singer) continue;
      recognizedFolders.push({ entry, singer });
    }
    counts.matchedArtistDirectoryCount = recognizedFolders.length;
    if (!recognizedFolders.length) throw Error("FANQIE_DOWNLOAD_ARTIST_FOLDER_NOT_RECOGNIZED");
    record("artist-folders", "ok");

    record("audio-files", "begin");
    const prompts = new Map<string, string>();
    for (const { entry, singer } of recognizedFolders) {
      const configured = singer.saved;
      const isConfiguredFolder = configured &&
        [configured.folder, configured.folder + "_B"].some(name => key(name) === key(entry.name));
      const promptEngine = isConfiguredFolder ? configured.promptEngine :
        downloadPromptFromFolder(entry.name, account.name, singer.name);
      for (const track of scanFolder(root, entry.name, singer)) {
        if (promptEngine) prompts.set(track.id, promptEngine);
        counts.audioCandidateCount = (counts.audioCandidateCount ?? 0) + 1;
        const title = fanqieTitleKey(track.title);
        if (!track.issue && seenTitles.has(title)) {
          items.push({ ...track, source: undefined, issue: "FANQIE_DOWNLOAD_SAME_TITLE" });
          continue;
        }
        if (!track.issue) seenTitles.add(title);
        items.push(track);
      }
      counts.scannedArtistDirectoryCount = (counts.scannedArtistDirectoryCount ?? 0) + 1;
    }
    counts.candidateCount = items.length;
    const selected = scope ? items.filter(item => item.id === scope.id) : items;
    if (scope && !selected.length) throw Error("FANQIE_DOWNLOADS_CHANGED");
    if (!selected.length) throw Error("FANQIE_DOWNLOAD_AUDIO_NOT_FOUND");
    record("audio-files", "ok");

    record("material-validation", "begin");
    counts.readyCount = selected.filter(item => !item.issue && !!item.source).length;
    counts.issueCounts = summarizeIssues(selected);
    record("material-validation", "ok");
    record("result", "ok");
    // The display metadata does not change existing material fingerprints or recovery checks.
    const promptEngines = Object.fromEntries(selected.flatMap(item => {
      const name = prompts.get(item.id);
      return name ? [[item.id, name]] : [];
    }));
    return { root, items: selected, fingerprint: hash({ accountId, root, items: selected }), promptEngines, scanDiagnostics: diagnostics };
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_]{1,100}$/u.test(error.message) ? error.message : "FANQIE_DOWNLOAD_SCAN_FAILED";
    diagnostics.failureCode = code;
    counts.candidateCount = items.length;
    counts.readyCount = items.filter(item => !item.issue && !!item.source).length;
    counts.issueCounts = summarizeIssues(items);
    record(activeStep, "error", code);
    return { root, items, fingerprint: hash({ accountId, scope, failure: code, items }), scanDiagnostics: diagnostics };
  }
}
