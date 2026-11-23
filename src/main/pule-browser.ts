import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import type { Download, Page } from "playwright-core";
import { reserveSongDownloadFolder, songDownloadCollisionStem } from "../core/download-filenames";
import { COVER_IMAGE_POLICY, coverResolutionSchema, recordingCoverPrompt } from "../shared/cover-handoff";
import type { ImageChoice, ImageSelection } from "../shared/platform-image";
import {
  canRetrySunoCovers, puleAudioExtensions, puleAudioMaxBytes, puleBrowserSchemas, puleDownloadTimeoutMs, puleStartSchema,
  sunoCnBrowserSchemas, sunoCnPreflightBlocked, type PuleAudioChoice, type PuleFile, type PuleJob, type PulePublication, type PuleScope,
  type PuleVersion, type SunoCoverScope,
} from "../shared/pule-browser";
import { safeWorkFilenameStem } from "../shared/work-analysis";
import { planPuleAudioLimit } from "../shared/plan-pule";
import { scopedDirectory } from "./browser-accounts";
import { runPuleBrowser, withPuleDownloadRetry, type PulePageHooks, type PulePagePhase } from "./pule-browser-page";
import { runSunoCnBrowser } from "./suno-cn-browser-page";
import type { ApiCredentials } from "./api-credentials";

type Journal = {
  requestHash: string;
  job: PuleJob;
  coverPlan?: { prompts: Record<PuleVersion, string>; resolution?: number; image?: ImageChoice };
};
type Audio = { file: string; identity: string; expires: number; guard: () => void };
type Active = {
  record: Journal;
  abort: AbortController;
  guard: () => void;
  confirm?: () => void;
  execution?: Promise<void>;
};
type Ports = {
  root: string;
  provider?: "suno_cn";
  captureWorkspace: () => () => void;
  chooseAudio: () => Promise<string | null>;
  scope: (accountId: string, artistId: string, publication?: PulePublication, coverImage?: ImageSelection) => Promise<PuleScope>;
  coverScope?: (folders?: Record<PuleVersion, string>, coverImage?: ImageChoice) => Promise<SunoCoverScope>;
  credentials: Pick<ApiCredentials, "apiCredentialStatus" | "generatePlanCover">;
  withPage: (accountId: string, signal: AbortSignal, run: (page: Page) => Promise<void>) => Promise<void>;
  run?: typeof runPuleBrowser;
};
const confirmationTime = 5 * 60_000;
const sunoDownloadTime = 5 * 60_000;
const taskErrorCode = /^(?:PULE_[A-Z_0-9]+|SUNO_CN_[A-Z_0-9]+|DOWNLOAD_ROOT_[A-Z_]+|WORKSPACE_CHANGED|STOP_REQUESTED|WORKFLOW_PULE_ACCOUNT_REQUIRED)$/u;
const pending = (job: PuleJob) => job.status === "running" || job.status === "awaiting_confirmation";

function identity(file: string, directory = false) {
  const info = fs.lstatSync(file, { bigint: true });
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile())) throw Error("PULE_PATH_INVALID");
  if (directory) return [info.dev, info.ino].join(":");
  if (info.size < 1n || info.size > BigInt(puleAudioMaxBytes)) throw Error("PULE_AUDIO_SIZE");
  return [info.dev, info.ino, info.size, info.mtimeNs].join(":");
}

async function withDownloadedFile<T>(download: Download, directory: string, save: (temporary: string) => Promise<T>,
  deadline?: number, transferFailure = "PULE_WAV_TRANSFER_FAILED") {
  const transferTime = deadline === undefined ? puleDownloadTimeoutMs : Math.ceil(deadline - performance.now());
  const cancel = () => { void Promise.resolve().then(() => download.cancel()).catch(() => undefined); };
  if (transferTime <= 0) {
    cancel();
    throw Error("PULE_DOWNLOAD_TIMEOUT");
  }
  const temporary = path.join(directory, "." + randomUUID() + ".part");
  let expired = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const transfer = Promise.resolve().then(() => download.saveAs(temporary)).catch(error => {
    if (error instanceof Error && taskErrorCode.test(error.message)) throw error;
    throw Error(transferFailure, { cause: error });
  });
  const timeLimit = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      expired = true;
      reject(Error("PULE_DOWNLOAD_TIMEOUT"));
      cancel();
    }, transferTime);
  });
  try {
    await Promise.race([transfer, timeLimit]);
    clearTimeout(timeout);
    if (deadline !== undefined && performance.now() >= deadline) throw Error("PULE_DOWNLOAD_TIMEOUT");
    return await save(temporary);
  } catch (error) {
    if (error instanceof Error && taskErrorCode.test(error.message)) throw error;
    throw Error("PULE_DOWNLOAD_FAILED", { cause: error });
  } finally {
    clearTimeout(timeout);
    const removeTemporary = () => fsp.rm(temporary, { force: true }).catch(() => undefined);
    // A stalled transfer may finish after cancellation was requested.
    if (expired) void transfer.then(removeTemporary, removeTemporary);
    await removeTemporary();
  }
}

async function waveSize(temporary: string) {
  const file = await fsp.open(temporary, "r");
  try {
    const header = Buffer.alloc(12);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    const { size } = await file.stat();
    if (bytesRead !== header.length || size <= 44 ||
        !["RIFF", "RF64", "BW64"].includes(header.toString("ascii", 0, 4)) ||
        header.toString("ascii", 8, 12) !== "WAVE") throw Error("PULE_WAV_INVALID");
    return size;
  } finally {
    await file.close();
  }
}

export function readPlanPuleWave(download: Download, directory: string, guard: () => Promise<void>, deadline?: number) {
  return withDownloadedFile(download, directory, async temporary => {
    if (await waveSize(temporary) > planPuleAudioLimit) throw Error("PULE_AUDIO_SIZE");
    await guard();
    return fsp.readFile(temporary);
  }, deadline);
}

function saveWave(download: Download, directory: string, stem: string, guard: () => void, deadline?: number, transferFailure?: string) {
  return withDownloadedFile(download, directory, async temporary => {
    await waveSize(temporary);
    guard();
    const reserved = reserveSongDownloadFolder(directory, stem);
    try {
      const folderIdentity = identity(reserved.directory, true);
      const name = stem + ".wav";
      const destination = path.join(reserved.directory, name);
      await fsp.copyFile(temporary, destination, fs.constants.COPYFILE_EXCL);
      return { wav: { name, path: destination }, folderIdentity };
    } finally {
      reserved.release();
    }
  }, deadline, transferFailure);
}

async function saveCompanion(directory: string, name: string, contents: string | Buffer, guard: () => void,
  failureCode: string) {
  const temporary = path.join(directory, "." + randomUUID() + ".part");
  const destination = path.join(directory, name);
  try {
    guard();
    await fsp.writeFile(temporary, contents, { flag: "wx" });
    guard();
    await fsp.copyFile(temporary, destination, fs.constants.COPYFILE_EXCL);
    return { name, path: destination };
  } catch (error) {
    if (error instanceof Error && taskErrorCode.test(error.message)) throw error;
    throw Error(failureCode);
  } finally {
    await fsp.rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function saveArtwork(bytes: Buffer, wavPath: string, guard: () => void, resolution?: number) {
  let png: Buffer;
  try {
    if (!bytes.length || bytes.length > COVER_IMAGE_POLICY.maxBytes) throw Error("PULE_COVER_INVALID");
    const image = sharp(bytes, { limitInputPixels: COVER_IMAGE_POLICY.maxPixels, failOn: "warning" });
    const { format, width, height, pages } = await image.metadata();
    if (!format || !COVER_IMAGE_POLICY.formats.includes(format) || !width || width !== height ||
        width < COVER_IMAGE_POLICY.minEdge || width > COVER_IMAGE_POLICY.maxEdge || (pages ?? 1) > 1)
      throw Error("PULE_COVER_INVALID");
    image.autoOrient();
    if (resolution && width !== resolution) image.resize(resolution, resolution);
    png = await image.png().toBuffer();
  } catch {
    throw Error("PULE_COVER_INVALID");
  }
  const { dir, name } = path.parse(wavPath);
  return saveCompanion(dir, name + ".png", png, guard, "PULE_COVER_SAVE_FAILED");
}

function recordedArchiveFolder(recording: PuleFile) {
  const { dir, name } = path.parse(recording.path);
  const folder = path.basename(dir);
  return songDownloadCollisionStem(folder) === name ? path.basename(path.dirname(dir)) : folder;
}

function coverSource(archiveRoot: string, recording: PuleFile) {
  const { dir, base, name, ext } = path.parse(recording.path);
  const relative = path.relative(archiveRoot, dir);
  const [folder, collision, ...extra] = relative.split(path.sep);
  const unavailable = "PULE_COVER_SOURCE_UNAVAILABLE";
  if (!path.isAbsolute(recording.path) || !folder || folder === ".." || path.isAbsolute(relative) || extra.length ||
      collision && songDownloadCollisionStem(collision) !== name || ext.toLowerCase() !== ".wav" || recording.name !== base)
    throw Error(unavailable);
  const destination = path.join(dir, name + ".png");
  try {
    const rootIdentity = identity(archiveRoot, true);
    const folderIdentity = identity(dir, true);
    const waveIdentity = identity(recording.path);
    const guard = () => {
      try {
        if (identity(archiveRoot, true) !== rootIdentity || identity(dir, true) !== folderIdentity ||
            path.relative(dir, fs.realpathSync.native(dir)) || identity(recording.path) !== waveIdentity)
          throw Error(unavailable);
        if (fs.lstatSync(destination, { throwIfNoEntry: false })) throw Error("PULE_COVER_ALREADY_EXISTS");
      } catch (error) {
        if (error instanceof Error && error.message === "PULE_COVER_ALREADY_EXISTS") throw error;
        throw Error(unavailable);
      }
    };
    guard();
    const text = recording.lyrics;
    if (!text) return { guard, lyrics: "" };
    const expected = path.join(dir, name + ".txt");
    if (text.name !== path.basename(expected) || !path.isAbsolute(text.path) || path.relative(expected, text.path))
      throw Error(unavailable);
    const info = fs.lstatSync(expected);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 32 * 1024) throw Error(unavailable);
    return { guard, lyrics: fs.readFileSync(expected, "utf8") };
  } catch (error) {
    if (error instanceof Error && error.message === "PULE_COVER_ALREADY_EXISTS") throw error;
    throw Error(unavailable);
  }
}

export function createPuleBrowserJobs(port: Ports) {
  const suno = port.provider === "suno_cn";
  const run: typeof runPuleBrowser = port.run ?? (suno ? runSunoCnBrowser : runPuleBrowser);
  const active = new Map<string, Active>();
  const audioChoices = new Map<string, Audio>();
  const directory = () => scopedDirectory(port.root, "runtime", suno ? "suno-cn-browser-jobs" : "pule-browser-jobs");
  const journalFile = (id: string) => scopedDirectory(directory(), id + ".json");
  const read = (id: string): Journal | undefined => {
    const file = journalFile(id);
    if (!fs.existsSync(file)) return;
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as Journal;
    if (data.job.id !== id || typeof data.requestHash !== "string") throw Error("PULE_JOURNAL_INVALID");
    return data;
  };
  const persist = (record: Journal) => {
    const folder = directory();
    fs.mkdirSync(folder, { recursive: true });
    const file = journalFile(record.job.id);
    const temporary = path.join(folder, randomUUID() + ".tmp");
    try {
      fs.writeFileSync(temporary, JSON.stringify(record), { flag: "wx", flush: true });
      fs.renameSync(temporary, file);
    } catch {
      throw Error("PULE_JOURNAL_UNAVAILABLE");
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  };
  const update = (task: Active, changes: Partial<PuleJob>) => {
    const next = { ...task.record, job: { ...task.record.job, ...changes, updatedAt: new Date().toISOString() } };
    persist(next);
    task.record = next;
  };
  const recordFailure = (task: Active, error: unknown) => {
    const signal = task.abort.signal;
    const cause = signal.aborted ? signal.reason : error;
    const code = cause instanceof Error && taskErrorCode.test(cause.message) ? cause.message : "PULE_BROWSER_INTERRUPTED";
    const detail = cause instanceof Error ? cause.cause : undefined;
    const coverErrorCode = code === "PULE_COVER_HTTP_400" && typeof detail === "string" && /^\d{4}$/u.test(detail) ? detail : undefined;
    const preflight = suno && !task.record.job.songIds?.length && sunoCnPreflightBlocked(code);
    const status = task.record.job.possibleCharge && !preflight ? "needs_review" : signal.aborted ? "stopped" : "failed";
    try { update(task, { status, code, coverErrorCode, quote: undefined, ...(preflight ? { possibleCharge: undefined } : {}) }); }
    catch { task.record.job = { ...task.record.job, status, code: "PULE_JOURNAL_UNAVAILABLE", quote: undefined }; }
  };
  const view = (record: Journal) => {
    const job = record.job;
    if (active.has(job.id) || !pending(job)) return job;
    return { ...job, status: job.possibleCharge ? "needs_review" : "stopped",
      quote: undefined, code: "PULE_BROWSER_INTERRUPTED" } satisfies PuleJob;
  };
  const listJobs = (limit: number) => {
    const folder = directory();
    if (!fs.existsSync(folder)) return [];
    const jobs = fs.readdirSync(folder, { withFileTypes: true })
      .filter(entry => entry.isFile() && /^[a-f0-9-]{36}\.json$/iu.test(entry.name))
      .map(entry => ({ id: entry.name.slice(0, -5), modified: fs.statSync(path.join(folder, entry.name)).mtimeMs }))
      .sort((a, b) => b.modified - a.modified)
      .slice(0, limit)
      .flatMap(({ id }) => {
        const live = active.get(id);
        if (live) return [live.record.job];
        const record = read(id);
        return record ? [view(record)] : [];
      });
    const recent = new Set(jobs.map(job => job.id));
    return [...jobs, ...Array.from(active.values()).map(task => task.record.job).filter(job => !recent.has(job.id))];
  };

  const chooseAudio = async (): Promise<PuleAudioChoice | null> => {
    const guard = port.captureWorkspace();
    guard();
    const selected = await port.chooseAudio();
    guard();
    if (!selected) return null;
    if (!puleAudioExtensions.includes(path.extname(selected).slice(1).toLowerCase())) throw Error("PULE_AUDIO_FORMAT");
    const file = fs.realpathSync.native(selected);
    const token = randomUUID();
    const now = Date.now();
    for (const [key, value] of audioChoices) if (value.expires <= now) audioChoices.delete(key);
    audioChoices.set(token, { file, identity: identity(file), expires: now + 30 * 60_000, guard });
    return { token, name: path.basename(selected) };
  };
  const validateAudio = (audio: Audio) => {
    audio.guard();
    if (audio.expires <= Date.now()) throw Error("PULE_AUDIO_REQUIRED");
    try {
      if (identity(audio.file) !== audio.identity) throw Error("PULE_AUDIO_CHANGED");
    } catch {
      throw Error("PULE_AUDIO_CHANGED");
    }
  };

  const approveCover = async (task: Active, credits: number) => {
    task.guard();
    const quote = { id: randomUUID(), kind: "processing" as const, credits };
    update(task, { status: "awaiting_confirmation", quote });
    const signal = task.abort.signal;
    let abort!: () => void;
    let timer!: NodeJS.Timeout;
    try {
      await new Promise<void>((resolve, reject) => {
        task.confirm = resolve;
        abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        timer = setTimeout(() => reject(Error("PULE_CONFIRMATION_EXPIRED")), confirmationTime);
      });
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      task.confirm = undefined;
    }
  };

  const requireCoverProfile = async (profile: PuleScope["coverProfile"], guard: () => void) => {
    if (!profile) throw Error("PULE_COVER_PROFILE_REQUIRED");
    const credential = await port.credentials.apiCredentialStatus({ profileId: profile.profileId }).catch(() => {
      guard();
      throw Error("PULE_COVER_PROFILE_REQUIRED");
    });
    guard();
    if (!credential.configured) throw Error("PULE_COVER_CREDENTIAL_REQUIRED");
    return profile;
  };

  const generateRecordingCover = async (task: Active, recording: PuleFile, prompt: string,
    profile: NonNullable<PuleScope["coverProfile"]>, resolution: number | undefined, guardRecording: () => void) => {
    const guard = () => { task.guard(); guardRecording(); };
    let dispatched = false, bytes: Buffer;
    guard();
    try {
      // Request the provider's square output and use the artist's export size locally.
      bytes = await port.credentials.generatePlanCover(profile, prompt, async () => {
        guard();
        update(task, { coverAttempts: [...(task.record.job.coverAttempts ?? []), recording.version] });
        dispatched = true;
      }, guard);
    } catch (error) {
      task.guard();
      if (error instanceof Error) {
        if (taskErrorCode.test(error.message)) throw error;
        if (error.message === "REVISION_CONFLICT") throw Error("PULE_COVER_PROFILE_CHANGED");
        const status = /^IMAGE_HTTP_(4\d\d)$/u.exec(error.message)?.[1];
        if (status) throw Error("PULE_COVER_HTTP_" + status, { cause: error.cause });
      }
      throw Error(dispatched ? "PULE_COVER_GENERATION_UNCONFIRMED" : "PULE_COVER_GENERATION_FAILED");
    }
    guard();
    const cover = await saveArtwork(bytes, recording.path, guard, resolution);
    update(task, { files: task.record.job.files.map(file => file === recording ? { ...file, cover } : file) });
  };

  const start = async (raw: unknown) => {
    const input = puleStartSchema.parse(raw);
    if (suno && input.mode !== "custom") throw Error("SUNO_CN_MODE_UNAVAILABLE");
    const workspace = port.captureWorkspace();
    workspace();
    const id = input.requestId;
    const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const existing = () => {
      const record = active.get(id)?.record ?? read(id);
      if (!record) return;
      if (record.requestHash !== requestHash) throw Error("PULE_REQUEST_CONFLICT");
      return view(record);
    };
    const old = existing();
    if (old) return old;
    const scope = await port.scope(input.accountId, input.artistId, input.publication, input.coverImage);
    workspace();
    if (suno && input.instrumental !== (scope.songType === "instrumental")) throw Error("SUNO_CN_ARTIST_CHANGED");
    // Validate and pin the configured folder before creating a job or opening its browser page.
    const archiveRoot = scope.archiveRoot;
    if (!archiveRoot) throw Error("DOWNLOAD_ROOT_REQUIRED");
    const readArchiveIdentity = () => {
      try { return identity(archiveRoot, true); }
      catch { throw Error("DOWNLOAD_ROOT_UNAVAILABLE"); }
    };
    const archiveIdentity = readArchiveIdentity();
    const coverProfile = await requireCoverProfile(scope.coverProfile, workspace);
    const concurrent = existing();
    if (concurrent) return concurrent;
    if (Array.from(active.values()).some(task => task.record.job.accountId === input.accountId)) throw Error("PULE_ACCOUNT_BUSY");

    const audio = input.mode === "cover" && input.uploadToken ? audioChoices.get(input.uploadToken) : undefined;
    if (input.mode === "cover") {
      if (!audio) throw Error("PULE_AUDIO_REQUIRED");
      validateAudio(audio);
    }
    const abort = new AbortController();
    const image = input.coverImage && {
      profileId: input.coverImage.profileId, providerId: input.coverImage.providerId, modelId: input.coverImage.modelId,
    };
    const job: PuleJob = { id, accountId: input.accountId, accountName: scope.accountName, title: input.title, status: "running",
      step: "opening", updatedAt: new Date().toISOString(), files: [],
      ...(image && { coverImage: { providerId: image.providerId, modelId: image.modelId } }) };
    const lyricsText = input.instrumental ? suno ? "" : undefined : input.lyrics.replace(/\r\n?/gu, "\n");
    const promptFor = (version: PuleVersion, title: string) => recordingCoverPrompt({
      title, artist: scope.singers[version], lyrics: lyricsText,
      genre: input.style, mood: scope.mood, coverStyle: scope.coverStyle,
    }, version);
    const coverPlan = suno ? { resolution: scope.coverResolution, image, prompts: {
      A: promptFor("A", input.title), B: promptFor("B", input.alternateTitle ?? input.title),
    } } : undefined;
    const task: Active = { record: { requestHash, job, coverPlan }, abort, guard: () => {
      workspace();
      abort.signal.throwIfAborted();
    } };
    persist(task.record);
    active.set(id, task);
    if (input.mode === "cover" && input.uploadToken) audioChoices.delete(input.uploadToken);

    const execute = async () => {
      const destinationIdentities = new Map<string, string>();
      const recordingFolders = new Map<string, string>();
      const output = (version: PuleVersion) => {
        if (readArchiveIdentity() !== archiveIdentity) throw Error("DOWNLOAD_ROOT_CHANGED");
        try {
          const name = scope.archiveFolderNames[version];
          if (name === "." || name === ".." || !name || path.basename(name) !== name) throw Error("PULE_OUTPUT_UNAVAILABLE");
          const folder = scopedDirectory(archiveRoot, name);
          const key = process.platform === "win32" ? folder.toLowerCase() : folder;
          const previousIdentity = destinationIdentities.get(key);
          if (!previousIdentity && !fs.lstatSync(folder, { throwIfNoEntry: false })) {
            try { fs.mkdirSync(folder); }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
          }
          const currentIdentity = identity(folder, true);
          if (previousIdentity && currentIdentity !== previousIdentity) throw Error("PULE_OUTPUT_UNAVAILABLE");
          if (!previousIdentity) {
            fs.accessSync(folder, fs.constants.W_OK);
            destinationIdentities.set(key, currentIdentity);
          }
          return folder;
        } catch {
          throw Error("PULE_OUTPUT_UNAVAILABLE");
        }
      };
      const guardOutput = (version: PuleVersion) => { task.guard(); output(version); };
      const guardRecording = (version: PuleVersion, wav: string) => {
        guardOutput(version);
        try {
          if (identity(path.dirname(wav), true) === recordingFolders.get(wav)) return;
        } catch {
          // The recording folder may have been removed during a provider request.
        }
        throw Error("PULE_OUTPUT_UNAVAILABLE");
      };
      try {
        const runPage = (
          phase?: PulePagePhase, useDownloadRetry?: PulePageHooks["useDownloadRetry"],
        ) => port.withPage(input.accountId, abort.signal, async page => {
          const windowClosed = () => abort.abort(Error("PULE_WINDOW_CLOSED"));
          page.once("close", windowClosed);
          try {
            if (page.isClosed()) windowClosed();
            task.guard();
            await run(page, { ...input, gender: scope.gender, timbre: scope.timbre,
              timbreWeight: scope.timbreWeight, styleWeight: scope.styleWeight, audioPath: audio?.file }, {
              guard: task.guard,
              validateAudio: () => { if (audio) validateAudio(audio); },
              step: step => { task.guard(); update(task, { step }); },
              approveCover: credits => approveCover(task, credits),
              beforeCharge: (kind, credits) => {
                task.guard();
                if (phase?.kind === "download") throw Error("PULE_GENERATION_NOT_AUTHORIZED");
                const outputDirectories = { A: output("A"), B: output("B") };
                const attempt = credits === undefined ? { kind } : { kind, credits };
                update(task, { possibleCharge: kind, outputDirectories,
                  chargeAttempts: [...(task.record.job.chargeAttempts ?? []), attempt] });
              },
              identify: songIds => {
                if (phase?.kind === "download") throw Error("PULE_RESULT_UNCLEAR");
                update(task, { songIds });
              },
              useDownloadRetry,
              saveWave: async (version, songId, download, title, deadline) => {
                task.guard();
                const files = task.record.job.files;
                if (task.record.job.songIds?.[version === "B" ? 1 : 0] !== songId || files.some(file => file.version === version))
                  throw Error("PULE_RESULT_UNCLEAR");
                const folder = output(version);
                const stem = safeWorkFilenameStem(title);
                const { wav, folderIdentity } = await saveWave(download, folder, stem, () => guardOutput(version),
                  suno ? performance.now() + sunoDownloadTime : deadline, suno ? "PULE_DOWNLOAD_FAILED" : undefined);
                const recordingFolder = path.dirname(wav.path);
                recordingFolders.set(wav.path, folderIdentity);
                const recording = { version, songId, ...wav };
                // Keep the confirmed recording in the journal even if a companion file fails.
                const outputDirectories = task.record.job.outputDirectories;
                update(task, { files: [...files, recording],
                  ...(outputDirectories && { outputDirectories: { ...outputDirectories, [version]: recordingFolder } }) });
                if (lyricsText !== undefined) {
                  const guard = () => guardRecording(version, wav.path);
                  const lyrics = await saveCompanion(recordingFolder, stem + ".txt", lyricsText, guard, "PULE_LYRICS_SAVE_FAILED");
                  update(task, { files: [...files, { ...recording, lyrics }] });
                }
              },
              generateCover: async (version, songId, title) => {
                task.guard();
                const recording = task.record.job.files.find(file => file.version === version && file.songId === songId);
                if (!recording) throw Error("PULE_RESULT_UNCLEAR");
                await generateRecordingCover(task, recording, promptFor(version, title), coverProfile, scope.coverResolution,
                  () => guardRecording(version, recording.path));
              },
            }, {}, phase);
          } finally {
            page.off("close", windowClosed);
          }
        });
        if (suno) await runPage();
        else await withPuleDownloadRetry(runPage, undefined, () => {
          const { files, songIds } = task.record.job;
          if (songIds?.length !== 2) return;
          const versions = (["A", "B"] as const).filter(version => !files.some(file => file.version === version));
          return { kind: "download", songIds, versions, includeCovers: true };
        }, task.guard);
        const files = task.record.job.files;
        if (files.length !== 2) throw Error("PULE_DOWNLOAD_FAILED");
        if (files.some(file => !file.cover)) throw Error("PULE_COVER_SAVE_FAILED");
        if (lyricsText !== undefined && files.some(file => !file.lyrics)) throw Error("PULE_LYRICS_SAVE_FAILED");
        update(task, { status: "completed", quote: undefined });
      } catch (error) {
        recordFailure(task, error);
      } finally {
        active.delete(id);
      }
    };
    task.execution = execute();
    return job;
  };

  const retryCovers = async (raw: unknown) => {
    if (!suno || !port.coverScope) throw Error("PULE_COVER_RETRY_UNAVAILABLE");
    const { id } = sunoCnBrowserSchemas["sunoCnBrowser.retryCovers"].parse(raw);
    const workspace = port.captureWorkspace();
    workspace();
    const running = active.get(id);
    if (running) return running.record.job;
    const record = read(id);
    if (record?.job.status === "completed") return record.job;
    if (!record || !canRetrySunoCovers(view(record))) throw Error("PULE_COVER_RETRY_UNAVAILABLE");
    const [a, b] = (["A", "B"] as const).map(version => record.job.files.find(file => file.version === version)!);
    if (path.relative(a.path, b.path) === "") throw Error("PULE_COVER_SOURCE_UNAVAILABLE");
    const folders = record.coverPlan ? undefined : { A: recordedArchiveFolder(a), B: recordedArchiveFolder(b) };
    const scope = await port.coverScope(folders, record.coverPlan?.image);
    workspace();
    const archiveRoot = scope.archiveRoot;
    if (!archiveRoot) throw Error("DOWNLOAD_ROOT_REQUIRED");
    const coverProfile = await requireCoverProfile(scope.coverProfile, workspace);
    const concurrent = active.get(id);
    if (concurrent) return concurrent.record.job;
    const current = read(id);
    if (!current) throw Error("PULE_COVER_RETRY_UNAVAILABLE");
    if (current.job.updatedAt !== record.job.updatedAt) return view(current);
    if (Array.from(active.values()).some(task => task.record.job.accountId === current.job.accountId)) throw Error("PULE_ACCOUNT_BUSY");
    const resolution = coverResolutionSchema.optional().parse(record.coverPlan ? record.coverPlan.resolution : scope.coverResolution);
    const inputs = [a, b].filter(file => !file.cover).map(file => {
      const source = coverSource(archiveRoot, file);
      const title = file.version === "A" ? record.job.title : path.parse(file.name).name;
      const saved = record.coverPlan?.prompts?.[file.version];
      const prompt = typeof saved === "string" && saved.trim() && Buffer.byteLength(saved) <= 900 ? saved : recordingCoverPrompt({
        title, lyrics: source.lyrics, artist: scope.singers?.[file.version], genre: scope.genre,
        mood: scope.mood, coverStyle: scope.coverStyle,
      }, file.version);
      return { file, guard: source.guard, prompt };
    });
    const abort = new AbortController();
    const task: Active = { record, abort, guard: () => { workspace(); abort.signal.throwIfAborted(); } };
    update(task, { status: "running", code: undefined, coverErrorCode: undefined });
    active.set(id, task);
    task.execution = (async () => {
      try {
        for (const { file, guard, prompt } of inputs) await generateRecordingCover(task, file, prompt, coverProfile, resolution, guard);
        update(task, { status: "completed" });
      } catch (error) { recordFailure(task, error); }
      finally { active.delete(id); }
    })();
    return task.record.job;
  };

  const confirm = (raw: unknown) => {
    const { id, quoteId } = puleBrowserSchemas["puleBrowser.confirm"].parse(raw);
    const task = active.get(id);
    if (!task?.confirm || task.record.job.quote?.id !== quoteId) throw Error("PULE_QUOTE_EXPIRED");
    task.guard();
    const finish = task.confirm;
    update(task, { status: "running", quote: undefined });
    task.confirm = undefined;
    finish();
    return task.record.job;
  };
  const stop = (raw: unknown) => {
    const { id } = puleBrowserSchemas["puleBrowser.stop"].parse(raw);
    const task = active.get(id);
    if (!task) return null;
    task.abort.abort(Error("PULE_STOPPED"));
    return task.record.job;
  };

  const invalidate = (code = "WORKSPACE_CHANGED") => {
    for (const task of active.values()) task.abort.abort(Error(code));
  };
  return { status: () => listJobs(20), history: () => listJobs(Infinity), chooseAudio, start, retryCovers, confirm, stop, invalidate, async close() {
    const tasks = [...active.values()];
    invalidate("PULE_STOPPED");
    await Promise.allSettled(tasks.map(task => task.execution));
  } };
}
