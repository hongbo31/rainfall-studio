import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { TextDecoder } from "node:util";
import { InboxId, InboxPackageSchema } from "../../shared/inbox";
import {
  DeliveryManifestSchema,
  DeliveryReadySchema,
} from "../../shared/dot-delivery";
import { verifyDeliveryImage } from "./dot-delivery-image";
import { DotDeliveryStore } from "./dot-delivery-store";
import { assertInboxPath } from "./receiver";
import { inboxHash } from "./service";

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const statePrefix = "dot-delivery-state:";
type Options = {
  store: DotDeliveryStore;
  deliveriesRoot: string;
  receiptsRoot: string;
  mediaRoot: string;
  now?: () => Date;
  afterCommit?: () => void;
};
function directory(folder: string) {
  assertInboxPath(folder);
  fs.mkdirSync(folder, { recursive: true });
  assertInboxPath(folder);
  if (!fs.lstatSync(folder).isDirectory())
    throw Error("DELIVERY_DIRECTORY_REQUIRED");
}
/** Pin and bound every read. Hashes, not the arrival of READY, establish that sync completed. */
function read(file: string, max: number) {
  assertInboxPath(file);
  const before = fs.lstatSync(file);
  if (!before.isFile() || before.nlink !== 1)
    throw Error("DELIVERY_FILE_REJECTED");
  if (before.size > max) throw Error("DELIVERY_FILE_LIMIT");
  const fd = fs.openSync(
    file,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
  );
  try {
    const pinned = fs.fstatSync(fd);
    if (
      !pinned.isFile() ||
      pinned.nlink !== 1 ||
      pinned.ino !== before.ino ||
      pinned.dev !== before.dev ||
      pinned.size !== before.size
    )
      throw Error("DELIVERY_FILE_CHANGED");
    const bytes = Buffer.alloc(pinned.size + 1),
      length = fs.readSync(fd, bytes, 0, bytes.length, 0),
      after = fs.fstatSync(fd);
    if (
      length !== pinned.size ||
      after.size !== pinned.size ||
      after.mtimeMs !== pinned.mtimeMs ||
      after.ctimeMs !== pinned.ctimeMs
    )
      throw Error("DELIVERY_FILE_CHANGED");
    assertInboxPath(file);
    return bytes.subarray(0, length);
  } finally {
    fs.closeSync(fd);
  }
}
function json(bytes: Buffer) {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw Error("DELIVERY_JSON_INVALID");
  }
}
function writeJson(root: string, name: string, value: unknown) {
  directory(root);
  const dest = path.join(root, name);
  assertInboxPath(dest);
  if (fs.existsSync(dest)) {
    const stat = fs.lstatSync(dest);
    if (!stat.isFile() || stat.nlink !== 1)
      throw Error("DELIVERY_FILE_REJECTED");
  }
  const temporary = path.join(root, randomUUID() + ".partial"),
    fd = fs.openSync(temporary, "wx");
  try {
    fs.writeFileSync(fd, JSON.stringify(value, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    assertInboxPath(dest);
    fs.renameSync(temporary, dest);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
function materialize(root: string, bytes: Buffer, hash: string, ext: string) {
  const parent = path.join(root, "sha256", hash.slice(0, 2));
  directory(parent);
  const dest = path.join(parent, hash + "." + ext);
  if (fs.existsSync(dest)) {
    if (sha(read(dest, 20 * 1024 * 1024)) !== hash)
      throw Error("DELIVERY_MEDIA_CONFLICT");
    return;
  }
  const temporary = path.join(parent, randomUUID() + ".partial"),
    fd = fs.openSync(temporary, "wx");
  try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    assertInboxPath(dest);
    if (fs.existsSync(dest)) {
      if (sha(read(dest, 20 * 1024 * 1024)) !== hash)
        throw Error("DELIVERY_MEDIA_CONFLICT");
    } else fs.renameSync(temporary, dest);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

/** Fixed local polling only: no HTTP, model, account, music or publication adapter. */
export class DotDeliveryReceiver {
  private stopped = false;
  private running = false;
  lastScanAt: string | null = null;
  lastError: string | null = null;
  constructor(readonly options: Options) {}
  private now() {
    return this.options.now?.() ?? new Date();
  }
  private key(id: string) {
    return (
      statePrefix + inboxHash([this.options.store.channel.id, id.toLowerCase()])
    );
  }
  private state(id: string) {
    return this.options.store.repo.maybe("settings", this.key(id));
  }
  private saveState(id: string, value: Record<string, unknown>) {
    return this.options.store.repo.save("settings", {
      ...value,
      id: this.key(id),
      deliveryId: id,
      channelId: this.options.store.channel.id,
      updatedAt: this.now().toISOString(),
    });
  }
  status() {
    return {
      root: this.options.deliveriesRoot,
      receiptsRoot: this.options.receiptsRoot,
      lastScanAt: this.lastScanAt,
      lastError: this.lastError,
      transport: "local-files-only",
      cloudTransportVerified: false,
      states: this.options.store.repo
        .all("settings")
        .filter(
          (r) =>
            r.id.startsWith(statePrefix) &&
            r.channelId === this.options.store.channel.id,
        )
        .map(
          ({
            deliveryId,
            state,
            reason,
            attempts,
            nextAttemptAt,
            updatedAt,
          }) => ({
            deliveryId,
            state,
            reason,
            attempts,
            nextAttemptAt,
            updatedAt,
          }),
        ),
    };
  }
  stop() {
    this.stopped = true;
  }
  private async receive(id: string, folder: string) {
    const readyBytes = read(path.join(folder, "READY.json"), 4096);
    // READY has no prior content hash: a stable partial/older sync is still incomplete.
    let ready;
    try {
      ready = DeliveryReadySchema.parse(json(readyBytes));
      if (ready.deliveryId !== id) throw Error("DELIVERY_ID_MISMATCH");
    } catch {
      throw Error("DELIVERY_SYNC_PENDING");
    }
    const manifestBytes = read(path.join(folder, "manifest.json"), 65536);
    if (sha(manifestBytes) !== ready.manifestSha256)
      throw Error("DELIVERY_SYNC_PENDING");
    const manifest = DeliveryManifestSchema.parse(json(manifestBytes));
    if (manifest.deliveryId !== id) throw Error("DELIVERY_ID_MISMATCH");
    if (manifest.targetWorkspaceRef !== this.options.store.channel.workspaceRef)
      throw Error("INBOX_WORKSPACE_MISMATCH");
    const textBytes = read(path.join(folder, manifest.text.file), 1024 * 1024);
    if (sha(textBytes) !== manifest.text.sha256)
      throw Error("DELIVERY_SYNC_PENDING");
    const textPackage = InboxPackageSchema.parse(json(textBytes));
    const expected = new Set(
      textPackage.items.map(
        (item) => item.externalItemId + ":" + item.revision,
      ),
    );
    if (
      manifest.images.length !== expected.size ||
      manifest.images.some(
        (image) => !expected.has(image.externalItemId + ":" + image.revision),
      )
    )
      throw Error("DELIVERY_COVER_SCOPE");
    const images = [];
    for (const image of manifest.images) {
      const bytes = read(path.join(folder, image.file), 20 * 1024 * 1024);
      // A synchronized final filename may temporarily refer to older bytes. Wait instead of importing early.
      if (bytes.length !== image.bytes || sha(bytes) !== image.sha256)
        throw Error("DELIVERY_SYNC_PENDING");
      const verified = await verifyDeliveryImage(bytes, image);
      const { width, height, ...fileFacts } = verified;
      images.push({
        externalItemId: image.externalItemId,
        revision: image.revision,
        asset: {
          id: randomUUID(),
          kind: "image" as const,
          ...fileFacts,
          metadata: { width, height },
          createdAt: this.now().toISOString(),
          source: "dot-delivery",
          label: image.file,
        },
        bytes,
      });
    }
    if (this.stopped) return;
    // Immutable media may exist without a DB row after a crash; that is safe to reuse on the next scan.
    for (const image of images)
      materialize(
        this.options.mediaRoot,
        image.bytes,
        image.asset.sha256,
        image.asset.ext,
      );
    const receipt = this.options.store.commit({
      manifest,
      manifestSha256: ready.manifestSha256,
      textPackage,
      images: images.map(({ bytes, ...image }) => image),
    });
    this.options.afterCommit?.();
    writeJson(
      this.options.receiptsRoot,
      InboxId.parse(receipt.deliveryId) + ".json",
      receipt,
    );
    this.saveState(id, {
      state: "imported",
      attempts: 0,
      reason: null,
      nextAttemptAt: null,
    });
  }
  async scanOnce() {
    if (this.stopped || this.running) return;
    this.running = true;
    try {
      directory(this.options.deliveriesRoot);
      directory(this.options.receiptsRoot);
      // Commit precedes receipt: recover acknowledgements even if READY or the original package disappeared.
      for (const receipt of this.options.store.receipts()) {
        writeJson(
          this.options.receiptsRoot,
          InboxId.parse(receipt.deliveryId) + ".json",
          receipt,
        );
        const saved = this.state(receipt.deliveryId);
        if (!saved || saved.state === "waiting")
          this.saveState(receipt.deliveryId, {
            state: "imported",
            attempts: 0,
            reason: null,
            nextAttemptAt: null,
          });
      }
      const scan = fs.opendirSync(this.options.deliveriesRoot);
      let count = 0;
      try {
        let entry;
        while (!this.stopped && (entry = scan.readSync()) && count < 100) {
          if (!entry.isDirectory() || !InboxId.safeParse(entry.name).success)
            continue;
          const id = entry.name,
            folder = path.join(this.options.deliveriesRoot, id),
            old = this.state(id);
          if (old?.state === "rejected") continue;
          if (
            old?.nextAttemptAt &&
            Date.parse(old.nextAttemptAt) > this.now().getTime()
          )
            continue;
          if (!fs.existsSync(path.join(folder, "READY.json"))) continue;
          const known = this.options.store.lookup(id);
          if (old?.state === "imported" && known) {
            try {
              const head = DeliveryReadySchema.parse(
                json(read(path.join(folder, "READY.json"), 4096)),
              );
              if (
                head.deliveryId === id &&
                head.manifestSha256 === known.manifestSha256
              )
                continue;
            } catch {
              /* Re-read through the normal failure path. */
            }
          }
          count++;
          try {
            await this.receive(id, folder);
            this.lastError = null;
          } catch (e: any) {
            const reason =
              e?.name === "ZodError"
                ? "DELIVERY_SCHEMA_REJECTED"
                : /^[A-Z][A-Z0-9_]+$/.test(e?.message ?? "")
                  ? e.message
                  : /^[A-Z][A-Z0-9_]+$/.test(e?.code ?? "")
                    ? e.code
                    : "DELIVERY_IO_FAILED";
            const attempts = (old?.attempts ?? 0) + 1;
            const transient =
              [
                "ENOENT",
                "EBUSY",
                "EACCES",
                "EPERM",
                "EIO",
                "ENOSPC",
                "EDQUOT",
                "EMFILE",
                "ENFILE",
                "ETIMEDOUT",
                "EAGAIN",
                "SQLITE_BUSY",
                "SQLITE_LOCKED",
                "SQLITE_FULL",
                "SQLITE_IOERR",
                "DELIVERY_SYNC_PENDING",
                "DELIVERY_FILE_CHANGED",
                "DELIVERY_IO_FAILED",
              ].includes(reason) ||
              reason.startsWith("SQLITE_IOERR_") ||
              reason.startsWith("SQLITE_BUSY_");
            const waiting = transient;
            this.saveState(id, {
              state: waiting ? "waiting" : "rejected",
              reason,
              attempts,
              nextAttemptAt: waiting
                ? new Date(
                    this.now().getTime() +
                      [30000, 60000, 300000, 900000][Math.min(attempts - 1, 3)],
                  ).toISOString()
                : null,
            });
            this.lastError = reason;
            if (!waiting)
              writeJson(this.options.receiptsRoot, id + ".error.json", {
                status: "rejected",
                deliveryId: id,
                reason,
                attempts,
              });
          }
        }
      } finally {
        scan.closeSync();
      }
      this.lastScanAt = this.now().toISOString();
    } catch (e: any) {
      this.lastError = /^[A-Z][A-Z0-9_]+$/.test(e?.message ?? "")
        ? e.message
        : "DELIVERY_IO_FAILED";
    } finally {
      this.running = false;
    }
  }
}
