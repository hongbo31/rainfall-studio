import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { defaultFanqieAccountId } from "../shared/platform-accounts";
import { publicationHistoryStatuses } from "../shared/publication-history";
import { downloadPromptFromFolder } from "./download-archive";
import type { Repository } from "./database";

const fingerprint = z.string().regex(/^[a-f0-9]{64}$/u);
const uploadFileName = /^[a-f0-9]{64}(?:-[a-f0-9-]{36})?\.json$/u;
export const fanqieHistoryRecordSchema = z.object({
  id: z.string().regex(/^[1-9]\d{4,24}$/u),
  title: z.string().trim().min(1),
  stage: z.enum(publicationHistoryStatuses),
  createdAtText: z.string().optional(),
});
const jobSchema = z.object({
  id: fingerprint,
  accountKey: fingerprint,
  title: z.string().trim().min(1),
  officialRecord: fanqieHistoryRecordSchema,
  updatedAt: z.string(),
  uploadedAt: z.string().optional(),
  archiveObservedAt: z.string().optional(),
  input: z.object({ workId: z.string(), authors: z.object({ singer: z.string() }) }),
  download: z.object({ id: fingerprint, batchId: z.uuid(), promptEngine: z.string().optional() }).optional(),
}).refine(job => job.title === job.officialRecord.title);
const batchSchema = z.object({
  id: z.uuid(),
  accountKey: fingerprint,
  tracks: z.array(z.object({ id: fingerprint, folder: z.string(), singer: z.string() })).optional(),
  items: z.array(z.object({ id: fingerprint, folder: z.string(), singer: z.string() })).optional(),
});

function ownedEntries(directory: string) {
  try {
    if (path.relative(directory, fs.realpathSync.native(directory)) !== "") return [];
    return fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

type ParsedFile<T> = { version: string; value: T | undefined };
class ReceiptFiles {
  private jobs = new Map<string, ParsedFile<z.infer<typeof jobSchema>>>();
  private batches = new Map<string, ParsedFile<z.infer<typeof batchSchema>>>();
  private used = new Set<string>();

  private read<T>(file: string, schema: z.ZodType<T>, cache: Map<string, ParsedFile<T>>) {
    try {
      const stats = fs.lstatSync(file, { bigint: true });
      if (!stats.isFile()) return;
      this.used.add(file);
      const version = [stats.ino, stats.size, stats.mtimeNs, stats.ctimeNs].join(":");
      const previous = cache.get(file);
      if (previous?.version === version) return previous.value;
      if (path.relative(file, fs.realpathSync.native(file)) !== "") return;
      const result = schema.safeParse(JSON.parse(fs.readFileSync(file, "utf8")));
      const value = result.success ? result.data : undefined;
      cache.set(file, { version, value });
      return value;
    } catch {
      // The publisher may be replacing a journal, or one legacy journal may be unreadable.
      return;
    }
  }

  private promptEngine(directory: string, accountName: string | undefined, job: z.infer<typeof jobSchema>) {
    const download = job.download;
    if (!download || !accountName || download.promptEngine) return download?.promptEngine;
    const paths = [
      path.join(directory, "download-runs", download.batchId, "batch.json"),
      path.join(directory, "download-batch.json"),
      path.join(directory, "download-history", download.batchId + ".json"),
    ];
    for (const file of paths) {
      const batch = this.read(file, batchSchema, this.batches);
      if (batch?.id !== download.batchId || batch.accountKey !== job.accountKey) continue;
      const track = (batch.tracks ?? batch.items)?.find(item => item.id === download.id && item.singer === job.input.authors.singer);
      if (track) return downloadPromptFromFolder(track.folder, accountName, track.singer);
    }
  }

  *readUploads(root: string, accountNames: ReadonlyMap<string, string>) {
    this.used.clear();
    const fanqie = path.join(root, "production", "fanqie");
    const accounts = path.join(fanqie, "accounts");
    const accountIds = [defaultFanqieAccountId, ...ownedEntries(accounts)
      .filter(entry => entry.isDirectory() && entry.name !== defaultFanqieAccountId && z.uuid().safeParse(entry.name).success)
      .map(entry => entry.name)];
    for (const accountId of accountIds) {
      const directory = accountId === defaultFanqieAccountId ? fanqie : path.join(accounts, accountId);
      const uploads = path.join(directory, "uploads");
      for (const folder of [uploads, path.join(uploads, "opening-history")]) {
        for (const entry of ownedEntries(folder)) {
          if (!entry.isFile() || !uploadFileName.test(entry.name)) continue;
          const job = this.read(path.join(folder, entry.name), jobSchema, this.jobs);
          if (!job || entry.name.slice(0, 64) !== job.id) continue;
          yield { accountId, job, promptEngine: this.promptEngine(directory, accountNames.get(accountId), job) };
        }
      }
    }
    for (const cache of [this.jobs, this.batches]) {
      for (const file of cache.keys()) if (!this.used.has(file)) cache.delete(file);
    }
  }
}

const files = new WeakMap<Repository, ReceiptFiles>();
export function fanqieUploadHistory(repo: Repository, root: string, accountNames: ReadonlyMap<string, string>) {
  const reader = files.get(repo) ?? new ReceiptFiles();
  files.set(repo, reader);
  return reader.readUploads(fs.realpathSync.native(root), accountNames);
}
