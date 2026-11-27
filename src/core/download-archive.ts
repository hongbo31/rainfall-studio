import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  DownloadArchiveAccountSchema, DownloadArchiveDirectorySchema, DownloadArchiveFolderSchema,
  type DownloadArchiveFolder, type DownloadArchiveSettings,
} from "../shared/download-archive";
import type { PlanCenterPlan, PlanCenterRun } from "../shared/plan-center";
import { defaultFanqieAccountId } from "../shared/platform-accounts";
import { safeWorkFilenameStem } from "../shared/work-analysis";
import { workVersionTitle } from "../shared/work-versions";
import { digest as fileDigest } from "./assets";
import type { Repository, Row } from "./database";
import { downloadSupportFolders, ensureDownloadSubfolder } from "./download-filenames";
import { listPlatformConfigurations } from "./platform-config";
import { CenterStore } from "./plan-center/storage";
import type { Studio } from "./studio";

const configurationKey = "download-archive:configuration";
const workKey = (id: string) => "download-archive:work:" + id;
type Configuration = DownloadArchiveSettings & { rootIdentity: string | null };
type Placement = { subfolder: string; contents: Record<string, string> };
type WorkArchive = {
  folders: DownloadArchiveFolder[];
  fingerprint: string;
  files: string[];
  placements?: Record<string, Placement>;
  legacyFolders?: string[];
};
const initial: Configuration = { revision: 0, root: null, rootIdentity: null, accountId: null };
const archiveRoles = {
  audio_A: "A", audio_B: "B", cover: "封面", cover_B: "封面 B", ...downloadSupportFolders, lyrics: "歌词",
} as const;
type ArchiveRole = keyof typeof archiveRoles;
type ArchiveFile = { ext: string; sha256: string; write: (target: string) => void };
const digest = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const config = (repo: Repository): Configuration => repo.maybe("settings", configurationKey)?.value ?? initial;
const comparePath = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;

function archiveTitleForMaterials(directory: string, baseTitle: string,
  materials: { role: ArchiveRole; file: ArchiveFile }[]) {
  for (let suffix = 1; suffix < 10_000; suffix++) {
    const title = suffix === 1 ? baseTitle : `${baseTitle} (${suffix})`;
    const conflict = materials.some(({ role, file }) => {
      const support = downloadSupportFolders[role as keyof typeof downloadSupportFolders];
      const target = path.join(support ? path.join(directory, support) : directory, `${title}.${file.ext}`);
      return fs.existsSync(target) && fileDigest(target) !== file.sha256;
    });
    if (!conflict) return title;
  }
  throw Error("DOWNLOAD_FILENAME_COLLISION_LIMIT");
}

function safeName(value: string, fallback: string, limit = 55) {
  const cleaned = value.normalize("NFC").trim().replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "-");
  return cleaned.slice(0, limit).replace(/[\uD800-\uDBFF]$/u, "").replace(/[. ]+$/u, "") || fallback;
}

export const downloadAccountPart = (account: string) => safeName(account, "音乐人账号");
export const downloadSingerPart = (musician: string) => safeName(musician, "本地音乐人");

export function downloadFolderName(account: string, musician: string, prompt?: string) {
  return [
    downloadAccountPart(account),
    downloadSingerPart(musician),
    safeName(prompt ?? "", "未关联提示词"),
  ].join("_");
}

export function downloadPromptFromFolder(folder: string, account: string, singer: string) {
  const prefix = downloadAccountPart(account) + "_" + downloadSingerPart(singer) + "_";
  const normalized = folder.normalize("NFC");
  if (!comparePath(normalized).startsWith(comparePath(prefix))) return;
  const prompt = normalized.slice(prefix.length).trim();
  if (prompt && !["未关联提示词", "未关联提示词_B"].includes(prompt)) return prompt;
}

export function workArchivePromptEngine(repo: Repository, workId: string, accountId: string, account: string, singer: string) {
  const archive: WorkArchive | undefined = repo.maybe("settings", workKey(workId))?.value;
  const folders = (archive?.folders ?? []).filter(folder => folder.accountId === accountId);
  const first = folders.find(folder => folder.audioVersion === "A");
  const prompts = new Set(folders.flatMap(folder => {
    const name = folder.audioVersion === "B" && first && comparePath(folder.name) === comparePath(first.name + "_B")
      ? first.name : folder.name;
    const prompt = downloadPromptFromFolder(name, account, singer);
    return prompt ? [prompt] : [];
  }));
  if (prompts.size === 1) return [...prompts][0];
}

function secondFolderName(first: string, second: string) {
  return comparePath(first) === comparePath(second) ? second + "_B" : second;
}

function checkRoot(input: string, expected?: string) {
  if (!path.isAbsolute(input) || input.startsWith("\\\\")) throw Error("DOWNLOAD_ROOT_INVALID");
  const root = path.resolve(input);
  try {
    const info = fs.lstatSync(root, { bigint: true });
    if (!info.isDirectory() || info.isSymbolicLink() || comparePath(fs.realpathSync.native(root)) !== comparePath(root))
      throw Error("DOWNLOAD_ROOT_INVALID");
    const identity = String(info.dev) + ":" + String(info.ino);
    if (expected && identity !== expected) throw Error("DOWNLOAD_ROOT_CHANGED");
    return { root, identity };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("DOWNLOAD_")) throw error;
    throw Error("DOWNLOAD_ROOT_UNAVAILABLE");
  }
}

export function readDownloadArchive(repo: Repository): DownloadArchiveSettings {
  const { revision, root, accountId } = config(repo);
  return { revision, root, accountId };
}

export function resolveDownloadArchiveRoot(repo: Repository) {
  const settings = config(repo);
  if (!settings.root) return null;
  const folder = configuredRoot(settings);
  return checkRoot(folder.root, folder.rootIdentity).root;
}

export async function saveConfiguredDownload<T extends object>(repo: Repository, filename: string, prepare: (file: string) => T | Promise<T>, folderName?: string) {
  const requireRoot = () => {
    const root = resolveDownloadArchiveRoot(repo);
    if (!root) throw Error("DOWNLOAD_ROOT_REQUIRED");
    return root;
  };
  const root = requireRoot();
  let staging: string;
  try { staging = fs.mkdtempSync(path.join(root, ".rainfall-download-")); }
  catch { throw Error("DOWNLOAD_WRITE_FAILED"); }
  const temporary = path.join(staging, filename);
  const { name, ext } = path.parse(filename);
  try {
    const result = await prepare(temporary);
    const destinationRoot = requireRoot();
    const outputRoot = folderName ? ensureDownloadSubfolder(destinationRoot, folderName) : destinationRoot;
    let target = path.join(outputRoot, filename);
    try { fs.copyFileSync(temporary, target, fs.constants.COPYFILE_EXCL); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw Error("DOWNLOAD_WRITE_FAILED");
      const hash = fileDigest(temporary);
      if (hash === fileDigest(target)) return { ...result, path: target };
      target = path.join(outputRoot, `${name} ${hash.slice(0, 8)}${ext}`);
      try { fs.copyFileSync(temporary, target, fs.constants.COPYFILE_EXCL); }
      catch (suffixError) {
        if ((suffixError as NodeJS.ErrnoException).code !== "EEXIST" || fileDigest(target) !== hash)
          throw Error("DOWNLOAD_FILE_CONFLICT");
      }
    }
    return { ...result, path: target };
  } finally {
    fs.rmSync(temporary, { force: true });
    if (fs.existsSync(staging)) fs.rmdirSync(staging);
  }
}

export function setDownloadDirectory(repo: Repository, raw: unknown) {
  const input = DownloadArchiveDirectorySchema.parse(raw);
  const folder = input.root ? checkRoot(input.root) : null;
  return repo.transaction(() => {
    const old = config(repo);
    if (old.revision !== input.expectedRevision) throw Error("REVISION_CONFLICT");
    repo.save("settings", { id: configurationKey, value: {
      ...old, revision: old.revision + 1, root: folder?.root ?? null, rootIdentity: folder?.identity ?? null,
    } });
    return readDownloadArchive(repo);
  });
}

export function setDownloadAccount(repo: Repository, raw: unknown) {
  const input = DownloadArchiveAccountSchema.parse(raw);
  return repo.transaction(() => {
    const old = config(repo);
    if (old.revision !== input.expectedRevision) throw Error("REVISION_CONFLICT");
    if (input.accountId && !repo.maybe("accounts", input.accountId)) throw Error("DOWNLOAD_ACCOUNT_REQUIRED");
    repo.save("settings", { id: configurationKey, value: {
      ...old, revision: old.revision + 1, accountId: input.accountId,
    } });
    return readDownloadArchive(repo);
  });
}

function accountFallback(repo: Repository, settings: Configuration) {
  if (settings.accountId && repo.maybe("accounts", settings.accountId)) return settings.accountId;
  const candidates = [...new Set(listPlatformConfigurations(repo).flatMap(platform =>
    platform.accountId && repo.maybe("accounts", platform.accountId) ? [platform.accountId] : [],
  ))];
  return candidates.length === 1 ? candidates[0] : undefined;
}

const primarySinger = (artist: Row) => (artist.profile?.singer?.trim() || artist.name || "").normalize("NFC").trim();

function puleArchiveArtist(repo: Repository, accountId: string, selectedArtist: Row) {
  if (selectedArtist.accountId === accountId) return selectedArtist;
  const singer = primarySinger(selectedArtist);
  if (!singer) return selectedArtist;
  // The archive account can have its own B singer and prompt engine for the same performer.
  const matches = repo.all("accountLocalArtists").filter(artist =>
    artist.accountId === accountId && primarySinger(artist) === singer);
  if (matches.length < 2) return matches[0] ?? selectedArtist;
  const sameEngine = selectedArtist.promptTemplateId
    ? matches.filter(artist => artist.promptTemplateId === selectedArtist.promptTemplateId) : [];
  const candidates = sameEngine.length ? sameEngine : matches;
  if (candidates.length === 1) return candidates[0];
  const sameName = candidates.filter(artist => artist.name === selectedArtist.name);
  return sameName.length === 1 ? sameName[0] : selectedArtist;
}

function recordingArchiveFolders(repo: Repository, accountName: string, artist: Row) {
  const template = artist.promptTemplateId ? repo.maybe("promptTemplates", artist.promptTemplateId) : undefined;
  const firstSinger = primarySinger(artist);
  const secondSinger = artist.secondSinger?.name?.trim() || firstSinger;
  return {
    A: downloadFolderName(accountName, firstSinger, template?.name),
    B: secondFolderName(downloadFolderName(accountName, firstSinger, template?.name), downloadFolderName(accountName, secondSinger, template?.name)),
  };
}

function recordingFolders(repo: Repository, settings: Configuration, accountId: string, artist: Row): DownloadArchiveFolder[] {
  const account = repo.maybe("accounts", accountId);
  if (!account?.name?.trim()) throw Error("DOWNLOAD_ACCOUNT_REQUIRED");
  const names = recordingArchiveFolders(repo, account.name, artist);
  const base = { accountId, ...configuredRoot(settings) };
  return [
    { ...base, name: names.A, audioVersion: "A" },
    { ...base, name: names.B, audioVersion: "B" },
  ];
}

export function resolveWorkDownloadFolder(repo: Repository, workId: string, version: "A" | "B" = "A") {
  const settings = config(repo);
  if (!settings.root) return undefined;
  const work = repo.maybe("works", workId);
  if (!work) return undefined;
  const artist = repo.maybe("accountLocalArtists", work.artistId) ?? repo.maybe("artists", work.artistId);
  if (!artist) return undefined;
  const accountId = artist.accountId && repo.maybe("accounts", artist.accountId)
    ? artist.accountId : accountFallback(repo, settings);
  if (!accountId) return undefined;
  return recordingFolders(repo, settings, accountId, artist).find(folder => folder.audioVersion === version)?.name;
}

export function resolveNamedDownloadFolder(repo: Repository, musicianName: string | null, templateName: string | null) {
  if (!musicianName?.trim()) return undefined;
  const settings = config(repo);
  if (!settings.root) return undefined;
  const accountId = accountFallback(repo, settings);
  if (!accountId) return undefined;
  const matches = repo.all("accountLocalArtists").filter(artist => {
    const singer = primarySinger(artist);
    const template = artist.promptTemplateId ? repo.maybe("promptTemplates", artist.promptTemplateId) : undefined;
    return artist.accountId === accountId && singer === musicianName.trim().normalize("NFC") && (template?.name ?? null) === templateName;
  });
  if (matches.length !== 1) return undefined;
  const artist = matches[0];
  return recordingFolders(repo, settings, accountId, artist)[0]?.name;
}

export function findRecordingArchiveArtist(repo: Repository, folders: { A: string; B: string }) {
  const matches = repo.all("accountLocalArtists").filter(artist => {
    const account = typeof artist.accountId === "string" ? repo.maybe("accounts", artist.accountId) : undefined;
    if (!account?.name?.trim()) return false;
    const names = recordingArchiveFolders(repo, account.name, artist);
    return comparePath(names.A) === comparePath(folders.A) && comparePath(names.B) === comparePath(folders.B);
  });
  return matches.length === 1 ? matches[0] : undefined;
}

export function resolvePuleDownloadArchive(repo: Repository, puleAccount: Row, selectedArtist: Row, publishingAccount?: Row) {
  let account = publishingAccount;
  let artist = selectedArtist;
  if (!account) {
    const accountId = accountFallback(repo, config(repo))
      ?? listPlatformConfigurations(repo).find(platform => platform.target === "fanqie")?.accountId;
    account = (accountId ? repo.maybe("accounts", accountId) : undefined) ?? puleAccount;
    artist = puleArchiveArtist(repo, account.id, selectedArtist);
  }
  const accountName = account.name?.trim() || puleAccount.name;
  return {
    archiveRoot: resolveDownloadArchiveRoot(repo),
    archiveFolderNames: recordingArchiveFolders(repo, accountName, artist),
  };
}

function configuredRoot(settings: Configuration) {
  if (!settings.root || !settings.rootIdentity) throw Error("DOWNLOAD_ROOT_UNAVAILABLE");
  return { root: settings.root, rootIdentity: settings.rootIdentity };
}

function workflowFolders(settings: Configuration, accountId: string, snapshot: PlanCenterPlan["workflowSnapshot"]): DownloadArchiveFolder[] {
  if (!snapshot) throw Error("DOWNLOAD_ARTIST_REQUIRED");
  const { accountName, artist, secondSinger, template } = snapshot;
  const primaryName = downloadFolderName(accountName, artist.singer, template?.name);
  const primary = { accountId, ...configuredRoot(settings), name: primaryName };
  if (!secondSinger) return [primary];
  const secondaryName = secondFolderName(primaryName, downloadFolderName(accountName, secondSinger.name, template?.name));
  return [
    { ...primary, audioVersion: "A" },
    { ...primary, audioVersion: "B", name: secondFolderName(primary.name, secondaryName) },
  ];
}

function ensureFolder(raw: DownloadArchiveFolder) {
  const folder = DownloadArchiveFolderSchema.parse(raw);
  const { root } = checkRoot(folder.root, folder.rootIdentity);
  if (folder.name === "." || folder.name === ".." || /[<>:"/\\|?*\u0000-\u001f]/u.test(folder.name))
    throw Error("DOWNLOAD_FOLDER_INVALID");
  try {
    const info = fs.lstatSync(root);
    if (!info.isDirectory() || info.isSymbolicLink() || comparePath(fs.realpathSync.native(root)) !== comparePath(root))
      throw Error("DOWNLOAD_FOLDER_INVALID");
    fs.accessSync(root, fs.constants.W_OK);
    return root;
  } catch (error) {
    if (error instanceof Error && error.message === "DOWNLOAD_FOLDER_INVALID") throw error;
    throw Error("DOWNLOAD_FOLDER_UNAVAILABLE");
  }
}

export function preparePlanDownloads(repo: Repository, plan: PlanCenterPlan): DownloadArchiveFolder[] {
  const settings = config(repo);
  if (!settings.root) {
    if (plan.workflow?.graph || plan.material.source === "pule_prompt" ||
        (plan.material.source === "creation" && (plan.outputs.music || plan.outputs.cover)))
      throw Error("DOWNLOAD_ROOT_REQUIRED");
    return [];
  }
  if (plan.workflow?.graph) {
    const folders = workflowFolders(settings, plan.workflow.accountId, plan.workflowSnapshot);
    for (const folder of folders) ensureFolder(folder);
    return folders;
  }
  const accountIds = new Set(plan.publishTargets.filter(target => target.enabled).map(target => target.accountId));
  if (plan.workflow) accountIds.add(plan.workflow.accountId);
  if (plan.fanqie) accountIds.add(plan.fanqie.accountId ?? defaultFanqieAccountId);
  if (!accountIds.size) {
    const artistAccountId = repo.maybe("accountLocalArtists", plan.artistId)?.accountId;
    const fallback = accountFallback(repo, settings) ??
      (artistAccountId && repo.maybe("accounts", artistAccountId) ? artistAccountId : undefined);
    if (!fallback) throw Error("DOWNLOAD_ACCOUNT_REQUIRED");
    accountIds.add(fallback);
  }
  const folders = [...accountIds].flatMap(accountId => {
    const artist = repo.maybe("accountLocalArtists", plan.artistId) ?? repo.maybe("artists", plan.artistId);
    if (!artist) throw Error("DOWNLOAD_ARTIST_REQUIRED");
    return recordingFolders(repo, settings, accountId, artist);
  });
  for (const folder of folders) ensureFolder(folder);
  return folders;
}

function writeOnce(file: string, sha256: string, write: () => void) {
  try { write(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw Error("DOWNLOAD_WRITE_FAILED"); }
  const info = fs.lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || fileDigest(file) !== sha256) throw Error("DOWNLOAD_FILE_CONFLICT");
}

function archiveFiles(s: Studio, work: Row) {
  const files = new Map<ArchiveRole, ArchiveFile>();
  for (const role of Object.keys(archiveRoles) as ArchiveRole[]) {
    const id = role === "lyrics" ? undefined : work.assets?.[role];
    if (!id) continue;
    const asset = s.get("assets", id);
    if (!/^[a-z0-9]{1,10}$/u.test(asset.ext) || !/^[a-f0-9]{64}$/u.test(asset.sha256)) throw Error("DOWNLOAD_ASSET_INVALID");
    files.set(role, { ext: asset.ext, sha256: asset.sha256,
      write: target => fs.copyFileSync(s.locate(id).file, target, fs.constants.COPYFILE_EXCL) });
  }
  const companionText = work.parameters?.voice === "instrumental" ? work.prompt : work.lyrics;
  if (typeof companionText === "string" && companionText.trim()) {
    const text = Buffer.from("\uFEFF" + companionText.replace(/\r\n?|\n/gu, "\r\n"), "utf8");
    files.set("lyrics", { ext: "txt", sha256: digest(text),
      write: target => fs.writeFileSync(target, text, { flag: "wx" }) });
  }
  return files;
}

const archiveFolderKey = (folder: DownloadArchiveFolder) => digest([
  comparePath(folder.root), folder.rootIdentity, folder.accountId, folder.audioVersion ?? "",
].join("\0"));

function archiveVersions(work: Row, specific: DownloadArchiveFolder["audioVersion"]): ("A" | "B")[] {
  if (specific) {
    const audio = work.assets?.["audio_" + specific];
    const cover = specific === "B" ? work.assets?.cover_B : work.assets?.cover;
    return audio || cover ? [specific] : [];
  }
  const versions = (["A", "B"] as const).filter(version => work.assets?.["audio_" + version]
    || (version === "B" ? work.assets?.cover_B : work.assets?.cover && !work.assets?.audio_B));
  return versions.length ? versions : ["A"];
}

function currentFolders(settings: Configuration, folders: DownloadArchiveFolder[]) {
  if (!folders.length) return [];
  if (!settings.root) throw Error("DOWNLOAD_ROOT_REQUIRED");
  const location = configuredRoot(settings);
  return [...new Map(folders.map(folder => [
    comparePath(folder.name) + "\0" + folder.accountId, { ...folder, ...location },
  ])).values()];
}

export function archivePlanWorkDownloads(s: Studio, run: PlanCenterRun, workId: string, verifyExisting = false) {
  if (s.mode !== "production") return [];
  const settings = config(s.repo);
  const folders = run.downloadFolders?.length
    ? currentFolders(settings, run.downloadFolders)
    : preparePlanDownloads(s.repo, run.snapshot);
  if (!folders.length) return [];
  const files = archiveWorkDownloads(s, workId, folders, verifyExisting);
  if (!run.downloadFolders?.length || run.downloadFolders.some(folder => !usesConfiguredRoot(folder, settings))) {
    const store = new CenterStore(s.repo);
    const current = store.get("run", run.id);
    if (current) store.put("run", { ...current, downloadFolders: folders });
  }
  return files;
}

export function archiveWorkDownloads(s: Studio, workId: string, folders: DownloadArchiveFolder[] = [], verifyExisting = false) {
  if (s.mode !== "production") return [];
  const previous: WorkArchive | undefined = s.repo.maybe("settings", workKey(workId))?.value;
  const destinations = currentFolders(config(s.repo), folders.length ? folders : previous?.folders ?? []);
  if (!destinations.length) return [];
  const associated = [...new Map(
    [...(previous?.folders ?? []), ...destinations].map(folder => [comparePath(path.join(folder.root, folder.name)) + "\0" + folder.accountId, folder]),
  ).values()];
  const work = s.get("works", workId);
  const assets = archiveFiles(s, work);
  const fingerprint = digest(JSON.stringify([destinations, work.title, work.alternateTitle,
    [...assets].map(([role, { ext, sha256 }]) => [role, ext, sha256])]));
  const directories = [...new Map(destinations.map(folder => {
    const directory = ensureDownloadSubfolder(ensureFolder(folder), folder.name);
    return [comparePath(directory) + "\0" + (folder.audioVersion ?? ""), { directory, folder }];
  })).values()];
  if (!verifyExisting && previous?.fingerprint === fingerprint && previous.files.every(file => fs.existsSync(file)))
    return previous.files;
  const legacyFolders = new Set(previous?.legacyFolders ?? (previous?.placements ? [] : previous?.folders.map(archiveFolderKey) ?? []));
  const placements = { ...previous?.placements };
  const files: string[] = [];
  const persist = (mark = "") => s.repo.save("settings", { id: workKey(workId),
    value: { folders: associated, fingerprint: mark, files, placements, legacyFolders: [...legacyFolders] } satisfies WorkArchive });
  const save = (file: ArchiveFile, target: string) => {
    writeOnce(target, file.sha256, () => file.write(target));
    files.push(target);
  };
  const saveFlatOrReuse = (file: ArchiveFile, target: string) => {
    if (fs.existsSync(target) && fileDigest(target) === file.sha256) {
      files.push(target);
      return;
    }
    // A/B singer folders each need their own companion files, even when the content hash matches.
    const targetDirectory = comparePath(path.resolve(path.dirname(target)));
    const old = previous?.files.find(candidate =>
      comparePath(path.resolve(path.dirname(candidate))) === targetDirectory &&
      path.extname(candidate).slice(1).toLowerCase() === file.ext &&
      fs.existsSync(candidate) && fileDigest(candidate) === file.sha256);
    if (old) {
      files.push(old);
      return;
    }
    if (fs.existsSync(target)) {
      const parsed = path.parse(target);
      target = path.join(parsed.dir, `${parsed.name} ${file.sha256.slice(0, 8)}${parsed.ext}`);
    }
    save(file, target);
  };
  persist();
  for (const { directory, folder } of directories) {
    const folderKey = archiveFolderKey(folder);
    if (legacyFolders.has(folderKey)) {
      const title = safeName(work.title, "作品", 100);
      const targets: { role: ArchiveRole; file: ArchiveFile; target: string }[] = [];
      for (const [role, file] of assets) {
        if (folder.audioVersion && (role === "audio_A" || role === "audio_B") && role !== "audio_" + folder.audioVersion) continue;
        const target = path.join(directory, title + "_" + archiveRoles[role] + "_" + file.sha256.slice(0, 12) + "." + file.ext);
        targets.push({ role, file, target });
      }
      const recordings = targets.filter(({ role }) => role === "audio_A" || role === "audio_B");
      const hasLegacyFiles = recordings.length ? recordings.every(({ target }) => fs.existsSync(target))
        : targets.some(({ target }) => fs.existsSync(target));
      // Reuse the paths referenced by existing recordings. Restored downloads use their own song titles.
      if (hasLegacyFiles) {
        for (const { file, target } of targets) save(file, target);
        continue;
      }
      legacyFolders.delete(folderKey);
    }
    for (const version of archiveVersions(work, folder.audioVersion)) {
      const audio: ArchiveRole = version === "A" ? "audio_A" : "audio_B";
      const cover: ArchiveRole = version === "B" && assets.has("cover_B") ? "cover_B" : "cover";
      const roles: ArchiveRole[] = [audio, cover, "certificate", "rights", "video", "lyrics"];
      const materials = roles.flatMap(role => {
        const file = assets.get(role);
        return file ? [{ role, file }] : [];
      });
      if (!materials.length) continue;
      const baseTitle = safeWorkFilenameStem(workVersionTitle({ title: work.title, alternateTitle: work.alternateTitle }, audio));
      const title = archiveTitleForMaterials(directory, baseTitle, materials);
      const key = digest(JSON.stringify([folderKey, version, title]));
      const existing = placements[key];
      const contents = Object.fromEntries(materials.map(({ role, file }) => [role === cover ? "cover" : role, file.ext + ":" + file.sha256]));
      // Each recording version and its companions share the account/singer/template directory.
      // writeOnce reuses identical content and fails closed on an unexpected conflict.
      const output = directory;
      placements[key] = { subfolder: "", contents };
      persist();
      for (const { role, file } of materials) {
        const support = downloadSupportFolders[role as keyof typeof downloadSupportFolders];
        const target = support ? ensureDownloadSubfolder(output, support) : output;
        saveFlatOrReuse(file, path.join(target, title + "." + file.ext));
      }
    }
  }
  persist(fingerprint);
  return files;
}

function usesConfiguredRoot(folder: DownloadArchiveFolder, settings: Configuration) {
  return settings.root && comparePath(folder.root) === comparePath(settings.root) && folder.rootIdentity === settings.rootIdentity;
}

export function archivePublicationDownloads(s: Studio, selections: { workId: string; accountId: string | null }[]) {
  const settings = config(s.repo);
  if (s.mode !== "production" || !settings.root) return;
  for (const { workId, accountId } of selections) {
    if (!accountId) continue;
    const work = s.get("works", workId);
    const previous: WorkArchive | undefined = s.repo.maybe("settings", workKey(workId))?.value;
    const known = previous?.folders.filter(folder => folder.accountId === accountId) ?? [];
    const current = known.filter(folder => usesConfiguredRoot(folder, settings));
    // Retain the singer names from the plan when the download directory changes.
    const singers = new Map([...known, ...current].flatMap(folder => folder.audioVersion ? [[folder.audioVersion, folder] as const] : []));
    let folders: DownloadArchiveFolder[];
    if (singers.size) folders = [...singers.values()].map(folder => ({ ...folder, ...configuredRoot(settings) }));
    else {
      const artist = s.repo.maybe("accountLocalArtists", work.artistId) ?? s.repo.maybe("artists", work.artistId);
      if (!artist) continue;
      folders = recordingFolders(s.repo, settings, accountId, artist);
    }
    archiveWorkDownloads(s, workId, folders);
  }
}

export function archiveFanqieDownloads(s: Studio, raw: unknown) {
  const { accountId, workIds } = z.strictObject({ accountId: z.uuid(), workIds: z.array(z.uuid()).min(1).max(50) }).parse(raw);
  archivePublicationDownloads(s, workIds.map(workId => ({ workId, accountId })));
  return true;
}

export function archiveImportedCertificate(s: Studio, workId: string) {
  if (s.mode !== "production") return [];
  const settings = config(s.repo);
  if (!settings.root) return [];
  const previous: WorkArchive | undefined = s.repo.maybe("settings", workKey(workId))?.value;
  const savedVersionFolders = previous?.folders.filter(folder => folder.audioVersion) ?? [];
  if (savedVersionFolders.length) return archiveWorkDownloads(s, workId, savedVersionFolders.map(folder => ({ ...folder, ...configuredRoot(settings) })));
  const accountId = previous?.folders[0]?.accountId ?? accountFallback(s.repo, settings);
  if (!accountId) return [];
  const { artistId } = s.get("works", workId);
  const artist = s.repo.maybe("accountLocalArtists", artistId) ?? s.repo.maybe("artists", artistId);
  if (!artist) throw Error("DOWNLOAD_ARTIST_REQUIRED");
  return archiveWorkDownloads(s, workId, recordingFolders(s.repo, settings, accountId, artist));
}
