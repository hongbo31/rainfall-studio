import { z } from "zod";
import { Repository, type Row } from "../database";
import {
  InboxChannelSchema,
  InboxId,
  InboxPackageSchema,
  type InboxChannel,
} from "../../shared/inbox";
import {
  DeliveryManifestSchema,
  type DeliveryManifest,
} from "../../shared/dot-delivery";
import { InboxService, inboxHash } from "./service";

const receiptPrefix = "dot-delivery-receipt:";
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const assetSchema = z.strictObject({
  id: z.string().min(1).max(200),
  sha256,
  kind: z.literal("image"),
  ext: z.enum(["png", "jpg", "webp"]),
  mime: z.enum(["image/png", "image/jpeg", "image/webp"]),
  bytes: z.number().int().positive(),
  metadata: z.strictObject({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  createdAt: z.iso.datetime({ offset: true }),
  source: z.string().min(1).max(200),
  label: z.string().min(1).max(300),
});
export type VerifiedDeliveryImage = {
  externalItemId: string;
  revision: number;
  asset: {
    id: string;
    sha256: string;
    kind: "image";
    ext: string;
    mime: string;
    bytes: number;
    metadata: { width: number; height: number };
    createdAt: string;
    source: string;
    label: string;
  };
};
export type DotDeliveryReceipt = {
  receiptVersion: 1;
  deliveryId: string;
  manifestSha256: string;
  batchId: string;
  workspaceId: string;
  importedAt: string;
  status: "imported";
  items: {
    externalItemId: string;
    revision: number;
    candidateId: string;
    draftId: string;
    coverAssetId: string;
    coverSha256: string;
    evaluationState: "model_pending";
  }[];
};

// This store accepts descriptors from the Main-side verifier, never filesystem paths
// or renderer claims. The receiver has already hashed/decoded and installed bytes.
export class DotDeliveryStore {
  readonly channel: InboxChannel;
  constructor(
    readonly repo: Repository,
    channel: InboxChannel,
    readonly now = () => new Date(),
  ) {
    this.channel = InboxChannelSchema.parse(channel);
  }
  private receiptKey(deliveryId: string) {
    InboxId.parse(deliveryId);
    return (
      receiptPrefix + inboxHash([this.channel.id, deliveryId.toLowerCase()])
    );
  }
  lookup(deliveryId: string): DotDeliveryReceipt | null {
    const row = this.repo.maybe("settings", this.receiptKey(deliveryId));
    if (
      !row ||
      row.channelId !== this.channel.id ||
      row.workspaceId !== this.channel.workspaceId
    )
      return null;
    return row.receipt;
  }
  receipts(): DotDeliveryReceipt[] {
    return this.repo
      .all("settings")
      .filter(
        (row) =>
          row.id.startsWith(receiptPrefix) &&
          row.channelId === this.channel.id &&
          row.workspaceId === this.channel.workspaceId &&
          row.receipt &&
          row.id === this.receiptKey(row.receipt.deliveryId),
      )
      .map((row) => row.receipt);
  }
  commit(input: {
    manifest: DeliveryManifest;
    manifestSha256: string;
    textPackage: unknown;
    images: VerifiedDeliveryImage[];
  }): DotDeliveryReceipt {
    const manifest = DeliveryManifestSchema.parse(input.manifest);
    sha256.parse(input.manifestSha256);
    const text = InboxPackageSchema.parse(input.textPackage);
    if (
      manifest.targetWorkspaceRef !== this.channel.workspaceRef ||
      text.targetWorkspaceRef !== this.channel.workspaceRef
    )
      throw Error("DOT_DELIVERY_WORKSPACE_MISMATCH");
    const key = (id: string, revision: number) => inboxHash([id, revision]);
    const textKeys = new Set(
      text.items.map((item) => key(item.externalItemId, item.revision)),
    );
    const imageKeys = new Set(
      manifest.images.map((image) => key(image.externalItemId, image.revision)),
    );
    if (
      manifest.images.length !== textKeys.size ||
      imageKeys.size !== textKeys.size ||
      [...imageKeys].some((id) => !textKeys.has(id))
    )
      throw Error("DOT_DELIVERY_COVER_REQUIRED");
    if (
      !Array.isArray(input.images) ||
      input.images.length !== manifest.images.length
    )
      throw Error("DOT_DELIVERY_VERIFIED_IMAGES_REQUIRED");
    const descriptors = new Map<string, VerifiedDeliveryImage>();
    for (const image of input.images) {
      const imageKey = key(image.externalItemId, image.revision);
      if (!imageKeys.has(imageKey) || descriptors.has(imageKey))
        throw Error("DOT_DELIVERY_IMAGE_IDENTITY_CONFLICT");
      descriptors.set(imageKey, image);
    }
    return this.repo.transaction(() => {
      const previous = this.lookup(manifest.deliveryId);
      if (previous) {
        if (previous.manifestSha256 !== input.manifestSha256)
          throw Error("DOT_DELIVERY_IDEMPOTENCY_CONFLICT");
        return previous;
      }
      // InboxService nests a SQLite savepoint here. Any later cover/receipt failure
      // still rolls its drafts, candidates, batches and receipts back with this transaction.
      const imported = new InboxService(this.repo, this.channel).importPackage(
        input.textPackage,
      );
      const items: DotDeliveryReceipt["items"] = [];
      for (const image of manifest.images) {
        const descriptor = descriptors.get(
          key(image.externalItemId, image.revision),
        )!;
        const asset = assetSchema.parse(descriptor.asset);
        const expectedExt =
          image.mimeType === "image/jpeg" ? "jpg" : image.mimeType.slice(6);
        if (
          asset.sha256 !== image.sha256 ||
          asset.bytes !== image.bytes ||
          asset.mime !== image.mimeType ||
          asset.ext !== expectedExt ||
          asset.metadata.width !== image.width ||
          asset.metadata.height !== image.height
        )
          throw Error("DOT_DELIVERY_ASSET_MISMATCH");
        const matches = this.repo
          .all("assets")
          .filter((row) => row.sha256 === asset.sha256);
        const idMatch = this.repo.maybe("assets", asset.id);
        if (
          (idMatch && idMatch.sha256 !== asset.sha256) ||
          matches.some((row) => !this.sameAsset(row, asset))
        )
          throw Error("DOT_DELIVERY_ASSET_CONFLICT");
        const acceptedAsset = matches[0] ?? asset;
        const importedItem = imported.items.find(
          (item) =>
            item.externalItemId === image.externalItemId &&
            item.revision === image.revision,
        );
        if (!importedItem) throw Error("DOT_DELIVERY_ITEM_MISSING");
        const candidate = this.repo.get(
          "textCandidates",
          importedItem.candidateId,
        );
        const draft = this.repo.get("drafts", importedItem.draftId);
        for (const row of [candidate, draft]) {
          if (
            row.cover &&
            (row.cover.sha256 !== asset.sha256 ||
              row.cover.revision !== image.revision)
          )
            throw Error("DOT_DELIVERY_COVER_REVISION_CONFLICT");
        }
        const cover = {
          assetId: acceptedAsset.id,
          sha256: asset.sha256,
          revision: image.revision,
          source: "dot-delivery" as const,
        };
        if (!matches.length) this.repo.save("assets", asset);
        for (const [table, row] of [
          ["textCandidates", candidate],
          ["drafts", draft],
        ] as const) {
          const history = Array.isArray(row.coverHistory)
            ? row.coverHistory
            : [];
          this.repo.save(table, {
            ...row,
            cover,
            coverHistory: history.some(
              (entry: any) =>
                entry.sha256 === cover.sha256 &&
                entry.revision === cover.revision,
            )
              ? history
              : [...history, cover],
          });
        }
        items.push({
          externalItemId: image.externalItemId,
          revision: image.revision,
          candidateId: importedItem.candidateId,
          draftId: importedItem.draftId,
          coverAssetId: acceptedAsset.id,
          coverSha256: asset.sha256,
          evaluationState: "model_pending",
        });
      }
      const receipt: DotDeliveryReceipt = {
        receiptVersion: 1,
        deliveryId: manifest.deliveryId,
        manifestSha256: input.manifestSha256,
        batchId: text.batchId,
        workspaceId: this.channel.workspaceId,
        importedAt: this.now().toISOString(),
        status: "imported",
        items,
      };
      this.repo.save("settings", {
        id: this.receiptKey(manifest.deliveryId),
        channelId: this.channel.id,
        workspaceId: this.channel.workspaceId,
        receipt,
      });
      return receipt;
    });
  }
  private sameAsset(existing: Row, asset: z.infer<typeof assetSchema>) {
    return (
      existing.kind === "image" &&
      existing.mime === asset.mime &&
      existing.ext === asset.ext &&
      existing.bytes === asset.bytes &&
      existing.metadata?.width === asset.metadata.width &&
      existing.metadata?.height === asset.metadata.height
    );
  }
}
