import path from "node:path";
import { InboxPackageSchema } from "../../shared/inbox";
import {
  DeliveryReadySchema,
  DeliveryManifestSchema,
} from "../../shared/dot-delivery";
import { read, json, sha } from "./dot-delivery-files";
import { verifyDeliveryImage } from "./dot-delivery-image";
export function readDeliveryReady(folder: string, id: string) {
  const bytes = read(path.join(folder, "READY.json"), 4096);
  try {
    const ready = DeliveryReadySchema.parse(json(bytes));
    if (ready.deliveryId !== id) throw Error("DELIVERY_ID_MISMATCH");
    return { ready, bytes };
  } catch {
    throw Error("DELIVERY_SYNC_PENDING");
  }
}
/** One immutable, bounded snapshot; neither READY nor filenames alone proves completeness. */
export async function readDeliveryPackage(
  folder: string,
  id: string,
  workspaceRef: string,
) {
  const { ready, bytes: readyBytes } = readDeliveryReady(folder, id);
  const manifestBytes = read(path.join(folder, "manifest.json"), 65536);
  if (sha(manifestBytes) !== ready.manifestSha256)
    throw Error("DELIVERY_SYNC_PENDING");
  const manifest = DeliveryManifestSchema.parse(json(manifestBytes));
  if (manifest.deliveryId !== id) throw Error("DELIVERY_ID_MISMATCH");
  if (manifest.targetWorkspaceRef !== workspaceRef)
    throw Error("INBOX_WORKSPACE_MISMATCH");
  const textBytes = read(path.join(folder, manifest.text.file), 1024 * 1024);
  if (sha(textBytes) !== manifest.text.sha256)
    throw Error("DELIVERY_SYNC_PENDING");
  const textPackage = InboxPackageSchema.parse(json(textBytes));
  if (textPackage.targetWorkspaceRef !== workspaceRef)
    throw Error("INBOX_WORKSPACE_MISMATCH");
  const expected = new Set(
    textPackage.items.map((item) => item.externalItemId + ":" + item.revision),
  );
  if (manifest.deliveryVersion === 2 && textPackage.schemaVersion !== 2)
    throw Error("DELIVERY_REQUEST_ECHO_REQUIRED");
  // A v1 wrapper must not broaden the scope of a request-aware text v2 item.
  if (textPackage.schemaVersion === 2) {
    expected.clear();
    for (const item of textPackage.items) {
      const outputs = item.requestEcho.outputs;
      if (manifest.deliveryVersion === 2 && (!outputs.lyrics || outputs.music))
        throw Error("DELIVERY_OUTPUTS_UNSUPPORTED");
      if (outputs.cover)
        expected.add(item.externalItemId + ":" + item.revision);
    }
  }
  if (
    manifest.images.length !== expected.size ||
    manifest.images.some(
      (i) => !expected.has(i.externalItemId + ":" + i.revision),
    )
  )
    throw Error("DELIVERY_COVER_SCOPE");
  const images = [];
  for (const descriptor of manifest.images) {
    const bytes = read(path.join(folder, descriptor.file), 20 * 1024 * 1024);
    if (bytes.length !== descriptor.bytes || sha(bytes) !== descriptor.sha256)
      throw Error("DELIVERY_SYNC_PENDING");
    images.push({
      descriptor,
      bytes,
      verified: await verifyDeliveryImage(bytes, descriptor),
    });
  }
  return {
    ready,
    readyBytes,
    manifest,
    manifestBytes,
    textPackage,
    textBytes,
    images,
  };
}

export function deliveryFailure(error: any) {
  const reason =
    error?.name === "ZodError"
      ? "DELIVERY_SCHEMA_REJECTED"
      : /^[A-Z][A-Z0-9_]+$/.test(error?.message ?? "")
        ? error.message
        : /^[A-Z][A-Z0-9_]+$/.test(error?.code ?? "")
          ? error.code
          : "DELIVERY_IO_FAILED";
  const retryable =
    [
      "DELIVERY_SYNC_PENDING",
      "DELIVERY_FILE_CHANGED",
      "DELIVERY_IO_FAILED",
      "DELIVERY_VOLUME_FACTS_UNAVAILABLE",
    ].includes(reason) || !/^(DELIVERY_|DOT_DELIVERY_|INBOX_)/.test(reason);
  return { reason, retryable };
}
