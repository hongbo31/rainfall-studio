import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const batchIdPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
const queueFilePattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}-[1-9]\d*\.json$/u;
const retryIntervalMs = 15_000;

type RoundSnapshot = { id: string; active?: { number: number } };
type CleanupJob<T> = { snapshot: T; files: string[]; retryAt: number; legacy?: true };

function queueDirectory(account: string) {
  return path.join(account, "download-cleanup");
}

function assertOwned(target: string) {
  if (path.relative(target, fs.realpathSync.native(target)) !== "") throw Error("FANQIE_BATCH_SCOPE_CHANGED");
}

function queueFiles(account: string) {
  const folder = queueDirectory(account);
  const stat = fs.lstatSync(folder, { throwIfNoEntry: false });
  if (!stat) return [];
  if (!stat.isDirectory()) throw Error("FANQIE_BATCH_SCOPE_CHANGED");
  assertOwned(folder);
  return fs.readdirSync(folder, { withFileTypes: true }).filter(entry => entry.isFile() && queueFilePattern.test(entry.name));
}

export function hasPendingFanqieCleanup(account: string, id?: string) {
  return queueFiles(account).some(entry => !id || entry.name.startsWith(id + "-"));
}

function jobName(snapshot: RoundSnapshot) {
  const number = snapshot.active?.number;
  if (!batchIdPattern.test(snapshot.id) || number === undefined || !Number.isSafeInteger(number) || number < 1)
    throw Error("FANQIE_BATCH_SCOPE_CHANGED");
  return snapshot.id + "-" + number + ".json";
}

function saveJob<T>(file: string, job: CleanupJob<T>) {
  const temporary = file + "." + randomUUID() + ".tmp";
  fs.writeFileSync(temporary, JSON.stringify(job), { flag: "wx" });
  try { fs.renameSync(temporary, file); }
  finally { fs.rmSync(temporary, { force: true }); }
}

function readJob<T extends RoundSnapshot>(file: string): CleanupJob<T> {
  assertOwned(file);
  const job = JSON.parse(fs.readFileSync(file, "utf8")) as CleanupJob<T>;
  if (!job.snapshot || jobName(job.snapshot) !== path.basename(file) || !Number.isFinite(job.retryAt) ||
      !Array.isArray(job.files) || !job.files.length || !job.files.every(file => typeof file === "string" && path.isAbsolute(file)))
    throw Error("FANQIE_BATCH_SCOPE_CHANGED");
  return job;
}

/** Each job retains the original verified round even after the uploader moves to the next round. */
export class FanqieDownloadCleanupQueue<T extends RoundSnapshot> {
  constructor(private readonly account: string) {}

  defer(snapshot: T, files: readonly string[], legacy = false) {
    assertOwned(this.account);
    const folder = queueDirectory(this.account);
    fs.mkdirSync(folder, { recursive: true });
    assertOwned(folder);
    const file = path.join(folder, jobName(snapshot));
    const previous = fs.lstatSync(file, { throwIfNoEntry: false });
    const old = previous ? readJob<T>(file) : undefined;
    saveJob(file, { snapshot, files: [...new Set([...(old?.files ?? []), ...files])],
      retryAt: old?.retryAt ?? Date.now() + retryIntervalMs, ...(legacy || old?.legacy ? { legacy: true } : {}) });
  }

  async pump(now: number, guard: () => void, process: (job: CleanupJob<T>) => Promise<string[]>) {
    const folder = queueDirectory(this.account);
    let next: { file: string; job: CleanupJob<T> } | undefined;
    for (const entry of queueFiles(this.account)) {
      guard();
      const file = path.join(folder, entry.name);
      let job: CleanupJob<T>;
      try { job = readJob<T>(file); }
      catch { continue; }
      if (job.retryAt <= now && (!next || job.retryAt < next.job.retryAt)) next = { file, job };
    }
    if (!next) return;
    const { file, job } = next;
    let files: string[];
    try { files = await process(job); }
    catch { files = job.files; }
    guard();
    if (files.length) saveJob(file, { ...job, files, retryAt: now + retryIntervalMs });
    else fs.unlinkSync(file);
  }
}
