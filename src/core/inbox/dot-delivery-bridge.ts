import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { InboxId } from "../../shared/inbox";
import { DotDeliveryStore } from "./dot-delivery-store";
import { assertInboxPath } from "./receiver";
import { inboxHash } from "./service";
import { directory, read, json, sha, writeJson } from "./dot-delivery-files";
import {
  readDeliveryPackage,
  readDeliveryReady,
  deliveryFailure,
} from "./dot-delivery-package";
const prefix = "dot-bridge-state:";
const normalized = (p: string) => path.resolve(p).toLowerCase();
const overlaps = (a: string, b: string) =>
  a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep);
function existingDirectory(folder: string) {
  assertInboxPath(folder);
  if (!fs.lstatSync(folder).isDirectory())
    throw Error("BRIDGE_DIRECTORY_REQUIRED");
}
/** The native chooser establishes trust. Recheck roots on every scan before touching files. */
export function validateBridgeProject(raw: string, inboxRoot: string) {
  if (typeof raw !== "string" || !path.isAbsolute(raw) || raw.length > 4096)
    throw Error("BRIDGE_DIRECTORY_REQUIRED");
  const projectRoot = path.resolve(raw),
    dataRoot = path.dirname(path.dirname(inboxRoot));
  assertInboxPath(inboxRoot);
  if (projectRoot === path.parse(projectRoot).root)
    throw Error("BRIDGE_BROAD_ROOT_REJECTED");
  if (overlaps(normalized(projectRoot), normalized(dataRoot)))
    throw Error("BRIDGE_ROOT_OVERLAP");
  const incomingRoot = path.join(projectRoot, "incoming"),
    receiptsRoot = path.join(projectRoot, "receipts");
  for (const folder of [projectRoot, incomingRoot, receiptsRoot])
    existingDirectory(folder);
  return { projectRoot, incomingRoot, receiptsRoot };
}
type Options = {
  store: DotDeliveryStore;
  projectRoot: string;
  inboxRoot: string;
  now?: () => Date;
};
export class DotDeliveryBridge {
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
      prefix +
      inboxHash([
        this.options.store.channel.id,
        this.options.projectRoot.toLowerCase(),
        id.toLowerCase(),
      ])
    );
  }
  private state(id: string) {
    return this.options.store.repo.maybe("settings", this.key(id));
  }
  private save(id: string, values: Record<string, unknown>) {
    this.options.store.repo.save("settings", {
      ...values,
      id: this.key(id),
      channelId: this.options.store.channel.id,
      projectRoot: this.options.projectRoot,
      deliveryId: id,
      updatedAt: this.now().toISOString(),
      filePolicyVersion: 2,
    });
  }
  status() {
    return {
      projectRoot: this.options.projectRoot,
      incomingRoot: path.join(this.options.projectRoot, "incoming"),
      receiptsRoot: path.join(this.options.projectRoot, "receipts"),
      lastScanAt: this.lastScanAt,
      lastError: this.lastError,
      cloudTransportVerified: false,
      states: this.options.store.repo
        .all("settings")
        .filter(
          (s) =>
            s.id.startsWith(prefix) &&
            s.channelId === this.options.store.channel.id &&
            s.projectRoot === this.options.projectRoot,
        )
        .map(({ deliveryId, state, reason, nextAttemptAt, updatedAt }) => ({
          deliveryId,
          state,
          reason,
          nextAttemptAt,
          updatedAt,
        })),
    };
  }
  stop() {
    this.stopped = true;
  }
  private stageFile(folder: string, name: string, bytes: Buffer) {
    const dest = path.join(folder, name);
    assertInboxPath(dest);
    const fd = fs.openSync(dest, "wx");
    try {
      fs.writeFileSync(fd, bytes);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }
  private async stage(id: string, source: string) {
    const { ready } = readDeliveryReady(source, id),
      known = this.options.store.lookup(id);
    if (known) {
      if (known.manifestSha256 !== ready.manifestSha256)
        throw Error("DELIVERY_BRIDGE_PRIVATE_CONFLICT");
      return;
    }
    const deliveries = path.join(this.options.inboxRoot, "deliveries"),
      dest = path.join(deliveries, id);
    if (fs.existsSync(dest)) {
      assertInboxPath(dest);
      const previous = readDeliveryReady(dest, id).ready;
      if (previous.manifestSha256 !== ready.manifestSha256)
        throw Error("DELIVERY_BRIDGE_PRIVATE_CONFLICT");
      return;
    }
    const snapshot = await readDeliveryPackage(
      source,
      id,
      this.options.store.channel.workspaceRef,
    );
    this.options.store.validatePackage(snapshot.manifest, snapshot.textPackage);
    if (this.stopped) return;
    directory(deliveries);
    const stagingRoot = path.join(this.options.inboxRoot, "bridge-staging");
    directory(stagingRoot);
    const temporary = path.join(stagingRoot, randomUUID());
    directory(temporary);
    // A crash leaves only an unobserved staging directory, never a half-ready private delivery.
    this.stageFile(temporary, "text.json", snapshot.textBytes);
    for (const image of snapshot.images)
      this.stageFile(temporary, image.descriptor.file, image.bytes);
    this.stageFile(temporary, "manifest.json", snapshot.manifestBytes);
    this.stageFile(temporary, "READY.json", snapshot.readyBytes);
    assertInboxPath(dest);
    assertInboxPath(temporary);
    fs.renameSync(temporary, dest);
  }
  async scanOnce() {
    if (this.stopped || this.running) return;
    this.running = true;
    try {
      const { incomingRoot } = validateBridgeProject(
        this.options.projectRoot,
        this.options.inboxRoot,
      );
      const scan = fs.opendirSync(incomingRoot);
      let count = 0;
      try {
        let entry;
        while (!this.stopped && (entry = scan.readSync()) && count < 100) {
          if (!entry.isDirectory() || !InboxId.safeParse(entry.name).success)
            continue;
          const id = entry.name,
            old = this.state(id),
            source = path.join(incomingRoot, id);
          if (
            old?.state === "rejected" &&
            !(
              old.reason === "DELIVERY_FILE_REJECTED" &&
              (old.filePolicyVersion ?? 1) < 2
            )
          )
            continue;
          if (
            old?.nextAttemptAt &&
            Date.parse(old.nextAttemptAt) > this.now().getTime()
          )
            continue;
          if (!fs.existsSync(path.join(source, "READY.json"))) continue;
          // Acknowledged/staged entries must not starve later backlog; only changed heads consume a slot.
          if (old?.manifestSha256) {
            try {
              const head = readDeliveryReady(source, id).ready;
              if (head.manifestSha256 === old.manifestSha256) {
                const dest = path.join(
                  this.options.inboxRoot,
                  "deliveries",
                  id,
                );
                if (
                  this.options.store.lookup(id) ||
                  fs.existsSync(path.join(dest, "READY.json"))
                )
                  continue;
              }
            } catch {}
          }
          count++;
          try {
            const head = readDeliveryReady(source, id).ready;
            await this.stage(id, source);
            if (!this.stopped)
              this.save(id, {
                state: "staged",
                manifestSha256: head.manifestSha256,
                attempts: 0,
                reason: null,
                nextAttemptAt: null,
              });
            this.lastError = null;
          } catch (e) {
            const { reason, retryable } = deliveryFailure(e),
              attempts = (old?.attempts ?? 0) + 1;
            this.save(id, {
              state: retryable ? "waiting" : "rejected",
              reason,
              attempts,
              nextAttemptAt: retryable
                ? new Date(
                    this.now().getTime() +
                      [30000, 60000, 300000, 900000][Math.min(attempts - 1, 3)],
                  ).toISOString()
                : null,
            });
            this.lastError = reason;
          }
        }
      } finally {
        scan.closeSync();
      }
      this.lastScanAt = this.now().toISOString();
    } catch (e) {
      this.lastError = deliveryFailure(e).reason;
    } finally {
      this.running = false;
    }
  }
  async flushReceipts() {
    if (this.stopped) return;
    this.lastError = null;
    try {
      const { receiptsRoot } = validateBridgeProject(
        this.options.projectRoot,
        this.options.inboxRoot,
      );
      for (const receipt of this.options.store.receipts()) {
        if (this.stopped) return;
        const id = InboxId.parse(receipt.deliveryId),
          dest = path.join(receiptsRoot, id + ".json");
        try {
          if (fs.existsSync(dest)) {
            const previous = json(read(dest, 1024 * 1024));
            if (inboxHash(previous) !== inboxHash(receipt))
              throw Error("DELIVERY_BRIDGE_RECEIPT_CONFLICT");
          } else writeJson(receiptsRoot, id + ".json", receipt, true);
          const saved = this.state(id);
          if (saved?.state !== "rejected" && saved?.state !== "acknowledged")
            this.save(id, {
              ...saved,
              state: "acknowledged",
              reason: null,
              nextAttemptAt: null,
              manifestSha256: receipt.manifestSha256,
            });
        } catch (e) {
          const reason = deliveryFailure(e).reason;
          this.lastError ??= reason;
          const saved = this.state(id);
          if (saved?.state !== "rejected")
            this.save(id, {
              ...saved,
              state: "receipt_waiting",
              reason,
              nextAttemptAt: null,
              manifestSha256: receipt.manifestSha256,
            });
        }
      }
    } catch (e) {
      this.lastError = deliveryFailure(e).reason;
    }
  }
}
