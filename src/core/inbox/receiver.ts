import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { TextDecoder } from "node:util";
import { InboxId, InboxPackageSchema } from "../../shared/inbox";
import { InboxService } from "./service";

export function assertInboxPath(target: string) {
  const absolute = path.resolve(target),
    parsed = path.parse(absolute);
  let current = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep)) {
    if (!part) continue;
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink())
        throw Error("INBOX_LINK_REJECTED");
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
    }
  }
}
function ensureDir(folder: string) {
  assertInboxPath(folder);
  fs.mkdirSync(folder, { recursive: true });
  assertInboxPath(folder);
  if (!fs.lstatSync(folder).isDirectory())
    throw Error("INBOX_DIRECTORY_REJECTED");
}
function readFile(file: string) {
  assertInboxPath(file);
  const before = fs.lstatSync(file);
  if (!before.isFile() || before.nlink !== 1 || before.size > 1024 * 1024)
    throw Error("INBOX_FILE_REJECTED");
  const fd = fs.openSync(
    file,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
  );
  try {
    const pinned = fs.fstatSync(fd);
    if (
      !pinned.isFile() ||
      pinned.ino !== before.ino ||
      pinned.dev !== before.dev ||
      pinned.size !== before.size ||
      pinned.nlink !== 1
    )
      throw Error("INBOX_FILE_CHANGED");
    const bytes = Buffer.alloc(pinned.size + 1),
      length = fs.readSync(fd, bytes, 0, bytes.length, 0);
    if (length !== pinned.size) throw Error("INBOX_FILE_CHANGED");
    const after = fs.fstatSync(fd);
    if (after.mtimeMs !== pinned.mtimeMs || after.size !== pinned.size)
      throw Error("INBOX_FILE_CHANGED");
    return bytes.subarray(0, length);
  } finally {
    fs.closeSync(fd);
  }
}
export class InboxReceiver {
  private stopped = false;
  private running = false;
  lastError: string | null = null;
  lastScanAt: string | null = null;
  constructor(
    readonly service: InboxService,
    readonly root: string,
  ) {}
  stop() {
    this.stopped = true;
  }
  private writeJson(folder: string, name: string, value: unknown) {
    ensureDir(folder);
    const dest = path.join(folder, name);
    assertInboxPath(dest);
    if (fs.existsSync(dest)) {
      const stat = fs.lstatSync(dest);
      if (!stat.isFile() || stat.nlink !== 1)
        throw Error("INBOX_FILE_REJECTED");
    }
    const temporary = path.join(folder, randomUUID() + ".partial");
    const fd = fs.openSync(temporary, "wx", 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(value, null, 2));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    assertInboxPath(dest);
    fs.renameSync(temporary, dest);
  }
  private archive(file: string, folder: string, digest: string) {
    ensureDir(folder);
    assertInboxPath(file);
    const dest = path.join(folder, digest + "-" + path.basename(file));
    assertInboxPath(dest);
    if (fs.existsSync(dest)) {
      if (!readFile(dest).equals(readFile(file)))
        throw Error("INBOX_ARCHIVE_CONFLICT");
      fs.unlinkSync(file);
    } else fs.renameSync(file, dest);
  }
  async scanOnce() {
    if (this.stopped || this.running) return;
    this.running = true;
    try {
      ensureDir(this.root);
      const incoming = path.join(this.root, "incoming"),
        receipts = path.join(this.root, "receipts");
      for (const name of ["incoming", "processed", "rejected", "receipts"])
        ensureDir(path.join(this.root, name));
      // Rebuild committed acknowledgements independently of whether incoming was archived.
      for (const row of this.service.repo
        .all("inboxReceipts")
        .filter((r) => r.channelId === this.service.channel.id))
        this.writeJson(
          receipts,
          InboxId.parse(row.receipt.batchId) + ".json",
          row.receipt,
        );
      const directory = fs.opendirSync(incoming);
      let count = 0;
      try {
        let entry;
        while (!this.stopped && (entry = directory.readSync()) && count < 100) {
          if (!entry.name.endsWith(".json") || entry.isDirectory()) continue;
          count++;
          const file = path.join(incoming, entry.name);
          let bytes: Buffer;
          try {
            bytes = readFile(file);
          } catch (e: any) {
            this.lastError = e.message;
            // Oversized / hard-linked regular files are moved by directory entry only.
            // Never read their contents; leave changed-in-flight files for a later scan.
            if (["INBOX_FILE_REJECTED", "INBOX_LINK_REJECTED"].includes(e.message)) {
              // Check ancestors, but never follow a rejected leaf junction/symlink.
              assertInboxPath(path.dirname(file));
              const rejectedEntry = fs.lstatSync(file);
              if (rejectedEntry.isFile() || rejectedEntry.isSymbolicLink()) {
                const rejected = path.join(this.root, "rejected"),
                  id = randomUUID();
                ensureDir(rejected);
                fs.renameSync(file, path.join(rejected, id + "-" + entry.name));
                this.writeJson(rejected, id + ".error.json", {
                  status: "rejected",
                  code: e.message,
                });
              }
            }
            continue;
          }
          const digest = createHash("sha256").update(bytes).digest("hex");
          let receipt;
          try {
            const raw = JSON.parse(
              new TextDecoder("utf-8", { fatal: true }).decode(bytes),
            );
            const p = InboxPackageSchema.parse(raw);
            if (entry.name !== p.batchId + ".json")
              throw Error("INBOX_FILENAME_MISMATCH");
            receipt = this.service.importPackage(raw);
          } catch (e: any) {
            // Conflict diagnostics are digest-addressed. Never overwrite a successful receipt.
            const code = /^[A-Z][A-Z0-9_]+$/.test(e.message)
              ? e.message
              : "INBOX_SCHEMA_REJECTED";
            this.writeJson(
              path.join(this.root, "rejected"),
              digest + ".error.json",
              { status: "rejected", fileHash: digest, code },
            );
            this.archive(file, path.join(this.root, "rejected"), digest);
            this.lastError = code;
            continue;
          }
          // IO failures after commit leave incoming intact; next scan returns the persisted IDs.
          this.writeJson(receipts, receipt.batchId + ".json", receipt);
          this.archive(file, path.join(this.root, "processed"), digest);
        }
      } finally {
        directory.closeSync();
      }
      this.lastScanAt = new Date().toISOString();
    } catch (e: any) {
      this.lastError = /^[A-Z][A-Z0-9_]+$/.test(e.message)
        ? e.message
        : "INBOX_IO_FAILED";
    } finally {
      this.running = false;
    }
  }
}
