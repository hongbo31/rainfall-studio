import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { InboxId } from "../../shared/inbox";
import { DeliveryReadySchema } from "../../shared/dot-delivery";
import { readDeliveryPackage } from "./dot-delivery-package";
import { directory, read, json, writeJson, sha } from "./dot-delivery-files";
import { DotDeliveryStore } from "./dot-delivery-store";
import { assertInboxPath } from "./receiver";
import { inboxHash } from "./service";

const statePrefix = "dot-delivery-state:";
type Options = {
  store: DotDeliveryStore;
  deliveriesRoot: string;
  receiptsRoot: string;
  mediaRoot: string;
  now?: () => Date;
  afterCommit?: () => void;
};
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
    const {
      ready,
      manifest,
      textPackage,
      images: verifiedImages,
    } = await readDeliveryPackage(
      folder,
      id,
      this.options.store.channel.workspaceRef,
    );
    const images = verifiedImages.map(({ descriptor, verified, bytes }) => {
      const { width, height, ...facts } = verified;
      return {
        externalItemId: descriptor.externalItemId,
        revision: descriptor.revision,
        asset: {
          id: randomUUID(),
          kind: "image" as const,
          ...facts,
          metadata: { width, height },
          createdAt: this.now().toISOString(),
          source: "dot-delivery",
          label: descriptor.file,
        },
        bytes,
      };
    });
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
                "DELIVERY_VOLUME_FACTS_UNAVAILABLE",
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
