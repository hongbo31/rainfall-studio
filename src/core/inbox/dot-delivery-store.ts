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
import {
  PlanDotRequestSchema,
  planDotRequestPrefix,
} from "../../shared/plan-dot";

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
type ReceiptItem = {
  externalItemId: string;
  revision: number;
  candidateId: string;
  draftId: string;
  evaluationState: "model_pending";
};
export type DotDeliveryReceipt = {
  deliveryId: string;
  manifestSha256: string;
  batchId: string;
  workspaceId: string;
  importedAt: string;
  status: "imported";
} & (
  | {
      receiptVersion: 1;
      items: (ReceiptItem & { coverAssetId: string; coverSha256: string })[];
    }
  | {
      receiptVersion: 2;
      items: (ReceiptItem & { coverAssetId?: string; coverSha256?: string })[];
    }
);

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
  /** Call before installing media, and again inside commit. Incoming claims never grant output scope. */
  validatePackage(manifest: DeliveryManifest, raw: unknown) {
    const text = InboxPackageSchema.parse(raw);
    if (text.schemaVersion !== 2) {
      if (manifest.deliveryVersion === 2)
        throw Error("DOT_DELIVERY_REQUEST_ECHO_REQUIRED");
    }
    if (
      manifest.targetWorkspaceRef !== this.channel.workspaceRef ||
      text.targetWorkspaceRef !== this.channel.workspaceRef
    )
      throw Error("DOT_DELIVERY_WORKSPACE_MISMATCH");
    const covers = new Set<string>();
    for (const item of text.items) {
      let echo = "requestEcho" in item ? item.requestEcho : undefined;
      if (!echo) {
        // Match the existing legacy association rule: a revision alone cannot
        // disambiguate an identity reused across historical requests.
        const owners = this.repo
          .all("settings")
          .filter((row) => row.id.startsWith(planDotRequestPrefix))
          .map((row) => row.request)
          .filter(
            (r) =>
              r?.channelId === this.channel.id &&
              r.workspaceId === this.channel.workspaceId &&
              r.workspaceRef === this.channel.workspaceRef &&
              r.artistRef === item.artistRef &&
              r.artistId === this.channel.artistRefs[item.artistRef] &&
              r.expectedExternalItemId === item.externalItemId,
          );
        if (!owners.some((r) => r.revision === item.revision)) {
          // Ordinary legacy deliveries with no matching request retain v1 semantics.
          covers.add(inboxHash([item.externalItemId, item.revision]));
          continue;
        }
        if (owners.length !== 1)
          throw Error("DOT_DELIVERY_LEGACY_REQUEST_AMBIGUOUS");
        echo = PlanDotRequestSchema.parse(owners[0]);
      }
      const saved = this.repo.maybe(
        "settings",
        planDotRequestPrefix + echo.requestId,
      )?.request;
      if (
        !saved ||
        !PlanDotRequestSchema.safeParse(saved).success ||
        inboxHash(saved) !== inboxHash(echo)
      )
        throw Error("DOT_REQUEST_ECHO_MISMATCH");
      const { requestHash, ...body } = echo;
      if (inboxHash(body) !== requestHash)
        throw Error("DOT_REQUEST_HASH_MISMATCH");
      if (
        echo.channelId !== this.channel.id ||
        echo.workspaceId !== this.channel.workspaceId ||
        echo.workspaceRef !== this.channel.workspaceRef ||
        echo.artistRef !== item.artistRef ||
        echo.artistId !== this.channel.artistRefs[item.artistRef] ||
        echo.expectedExternalItemId !== item.externalItemId ||
        echo.revision !== item.revision
      )
        throw Error("DOT_REQUEST_SCOPE_MISMATCH");
      if (
        manifest.deliveryVersion === 2 &&
        (!echo.outputs.lyrics || echo.outputs.music)
      )
        throw Error("DOT_DELIVERY_OUTPUTS_UNSUPPORTED");
      if (echo.outputs.cover)
        covers.add(inboxHash([item.externalItemId, item.revision]));
    }
    if (
      covers.size !== manifest.images.length ||
      manifest.images.some(
        (i) => !covers.has(inboxHash([i.externalItemId, i.revision])),
      )
    )
      throw Error("DOT_DELIVERY_OUTPUTS_MISMATCH");
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
    this.validatePackage(manifest, input.textPackage);
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
      manifest.deliveryVersion === 1 &&
      (manifest.images.length !== textKeys.size ||
        imageKeys.size !== textKeys.size ||
        [...imageKeys].some((id) => !textKeys.has(id)))
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
      this.validatePackage(manifest, input.textPackage);
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
      const items: (ReceiptItem & {
        coverAssetId?: string;
        coverSha256?: string;
      })[] = [];
      if (manifest.deliveryVersion === 2)
        for (const item of imported.items)
          if (!imageKeys.has(key(item.externalItemId, item.revision)))
            items.push({
              externalItemId: item.externalItemId,
              revision: item.revision,
              candidateId: item.candidateId,
              draftId: item.draftId,
              evaluationState: "model_pending",
            });
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
      const receipt = {
        receiptVersion: manifest.deliveryVersion,
        deliveryId: manifest.deliveryId,
        manifestSha256: input.manifestSha256,
        batchId: text.batchId,
        workspaceId: this.channel.workspaceId,
        importedAt: this.now().toISOString(),
        status: "imported" as const,
        items,
      } as DotDeliveryReceipt;
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
