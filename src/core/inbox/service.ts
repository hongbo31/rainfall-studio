import { createHash, randomUUID } from "node:crypto";
import { Repository } from "../database";
import {
  InboxPackageSchema,
  InboxChannelSchema,
  type InboxChannel,
  type InboxReceipt,
} from "../../shared/inbox";
import { checkHardRules } from "../quality/rules";
// No coercion or Unicode normalization. Array order and all text values are significant.
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value))
    return "[" + value.map(canonicalJson).join(",") + "]";
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map(
          (k) =>
            JSON.stringify(k) +
            ":" +
            canonicalJson((value as Record<string, unknown>)[k]),
        )
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export const inboxHash = (v: unknown) =>
  createHash("sha256").update(canonicalJson(v)).digest("hex");
export class InboxService {
  readonly channel: InboxChannel;
  constructor(
    readonly repo: Repository,
    channel: InboxChannel,
  ) {
    this.channel = InboxChannelSchema.parse(channel);
  }
  importPackage(raw: unknown): InboxReceipt {
    if (Buffer.byteLength(canonicalJson(raw), "utf8") > 1024 * 1024)
      throw Error("INBOX_LIMIT");
    const p = InboxPackageSchema.parse(raw),
      channel = this.channel;
    if (p.targetWorkspaceRef !== channel.workspaceRef)
      throw Error("INBOX_WORKSPACE_MISMATCH");
    const packageHash = inboxHash(raw),
      // Windows acknowledgement filenames are case-insensitive. Logical identity must agree.
      batchKey = inboxHash([channel.id, p.batchId.toLowerCase()]);
    return this.repo.transaction(() => {
      const old = this.repo.maybe("inboxBatches", batchKey);
      if (old) {
        if (old.packageHash !== packageHash)
          throw Error("INBOX_IDEMPOTENCY_CONFLICT");
        return this.repo.get("inboxReceipts", batchKey).receipt;
      }
      const importedAt = new Date().toISOString(),
        items: InboxReceipt["items"] = [];
      for (const [itemIndex, item] of p.items.entries()) {
        const artistId = Object.hasOwn(channel.artistRefs, item.artistRef)
          ? channel.artistRefs[item.artistRef]
          : undefined;
        const seriesId =
          item.seriesRef === null
            ? null
            : Object.hasOwn(channel.seriesRefs, item.seriesRef)
              ? channel.seriesRefs[item.seriesRef]
              : undefined;
        if (!artistId || seriesId === undefined)
          throw Error("INBOX_SCOPE_REJECTED");
        this.repo.get("artists", artistId);
        if (seriesId && this.repo.get("series", seriesId).artistId !== artistId)
          throw Error("INBOX_SCOPE_REJECTED");
        const itemKey = inboxHash([
          channel.id,
          item.externalItemId,
          item.revision,
        ]);
        const itemHash = inboxHash(
          (raw as { items: unknown[] }).items[itemIndex],
        );
        const existing = this.repo
          .all("textCandidates")
          .find((c) => c.itemKey === itemKey);
        if (existing) {
          if (existing.itemHash !== itemHash)
            throw Error("INBOX_IDEMPOTENCY_CONFLICT");
          items.push({
            externalItemId: item.externalItemId,
            revision: item.revision,
            draftId: existing.draftId,
            candidateId: existing.id,
            status: "existing",
            evaluationState: "model_pending",
          });
          continue;
        }
        const d = item.draft,
          draftId = randomUUID(),
          id = randomUUID();
        const siblings = this.repo
          .all("textCandidates")
          .filter(
            (c) =>
              c.source.channelId === channel.id &&
              c.externalItemId === item.externalItemId,
          );
        if (
          siblings.some(
            (c) => c.artistId !== artistId || c.seriesId !== seriesId,
          )
        )
          throw Error("INBOX_SCOPE_REJECTED");
        const parent = siblings.find(
          (c) => c.externalRevision === item.parentRevision,
        );
        const latest = Math.max(
          item.revision,
          ...siblings.map((c) => c.externalRevision),
        );
        for (const c of siblings)
          this.repo.save("textCandidates", {
            ...c,
            isCurrent: c.externalRevision === latest,
          });
        const localCheck = checkHardRules(
          {
            attemptId: id,
            revisionId: draftId,
            parentRevisionId: parent?.draftId ?? null,
            lyrics: d.sections.flatMap((s) => s.lines).join("\n"),
            musicPrompt: d.musicPrompts.yourmusic.positiveStyle,
            intent: d.storyBeat,
            language: d.language,
            style: d.style,
            generator: {
              modelId: item.provenance.model ?? "external-unspecified",
              modelVersion: "declared-unverified",
              promptVersion: item.provenance.promptVersion ?? "unspecified",
            },
            lockedSpans: [],
            capability: {
              version: "unverified-import-v1",
              verified: false,
              lengthUnit: null,
              limits: {},
              requiredFields: d.instrumental
                ? ["musicPrompt"]
                : ["lyrics", "musicPrompt"],
            },
          },
          [],
        );
        this.repo.save("drafts", {
          id: draftId,
          artistId,
          seriesId,
          draft: d,
          parentDraftId: parent?.draftId ?? null,
          importedAt,
          source: "local-inbox",
          externalRevision: item.revision,
        });
        this.repo.save("textCandidates", {
          id,
          itemKey,
          itemHash,
          externalItemId: item.externalItemId,
          externalRevision: item.revision,
          parentRevision: item.parentRevision,
          artistId,
          seriesId,
          draftId,
          isCurrent: item.revision === latest,
          lineageState:
            item.parentRevision !== null && !parent
              ? "lineage_pending"
              : "complete",
          source: {
            channelId: channel.id,
            verification: "local_channel",
            producerClaim: item.provenance.producer,
            receivedAt: importedAt,
            provenance: item.provenance,
          },
          state: "imported",
          evaluationState: "model_pending",
          localCheck,
          importedAt,
        });
        for (const c of siblings.filter(
          (c) => c.parentRevision === item.revision,
        )) {
          this.repo.save("textCandidates", {
            ...this.repo.get("textCandidates", c.id),
            lineageState: "complete",
          });
          const child = this.repo.get("drafts", c.draftId);
          this.repo.save("drafts", { ...child, parentDraftId: draftId });
        }
        items.push({
          externalItemId: item.externalItemId,
          revision: item.revision,
          draftId,
          candidateId: id,
          status: "imported",
          evaluationState: "model_pending",
        });
      }
      const receipt: InboxReceipt = {
        receiptVersion: 1,
        batchId: p.batchId,
        packageHash,
        workspaceId: channel.workspaceId,
        importedAt,
        status: "imported",
        items,
      };
      this.repo.save("inboxBatches", {
        id: batchKey,
        batchKey,
        channelId: channel.id,
        batchId: p.batchId,
        packageHash,
        importedAt,
      });
      this.repo.save("inboxReceipts", {
        id: batchKey,
        receiptKey: batchKey,
        receipt,
        channelId: channel.id,
      });
      return receipt;
    });
  }
}
