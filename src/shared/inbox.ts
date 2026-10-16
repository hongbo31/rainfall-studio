import { z } from "zod";
import { CreativeDraftSchema } from "./creation";
export const InboxId = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/)
  .refine(
    (v) => !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(v),
    "WINDOWS_RESERVED_ID",
  );
const reference = z.string().trim().min(1).max(80);
const at = z.iso.datetime({ offset: true });
export const InboxItemSchema = z
  .strictObject({
    externalItemId: InboxId,
    revision: z.number().int().positive().max(1000000),
    parentRevision: z.number().int().positive().nullable(),
    artistRef: reference,
    seriesRef: reference.nullable(),
    draft: CreativeDraftSchema,
    provenance: z.strictObject({
      producer: z.string().min(1).max(100),
      model: z.string().max(200).nullable(),
      promptVersion: z.string().max(200).nullable(),
      generatedAt: at,
    }),
  })
  .refine(
    (i) => i.parentRevision === null || i.parentRevision < i.revision,
    "PARENT_REVISION_INVALID",
  );
export const InboxPackageSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    batchId: InboxId,
    createdAt: at,
    targetWorkspaceRef: reference,
    items: z.array(InboxItemSchema).min(1).max(20),
  })
  .superRefine((p, ctx) => {
    const keys = p.items.map((i) => `${i.externalItemId}:${i.revision}`);
    if (new Set(keys).size !== keys.length)
      ctx.addIssue({ code: "custom", message: "DUPLICATE_ITEM" });
  });
export const InboxChannelSchema = z.strictObject({
  id: InboxId,
  workspaceId: reference,
  workspaceRef: reference,
  artistRefs: z.record(reference, z.uuid()),
  seriesRefs: z.record(reference, z.uuid()),
});
export type InboxChannel = z.infer<typeof InboxChannelSchema>;
export type InboxPackage = z.infer<typeof InboxPackageSchema>;
export type InboxReceipt = {
  receiptVersion: 1;
  batchId: string;
  packageHash: string;
  workspaceId: string;
  importedAt: string;
  status: "imported";
  items: {
    externalItemId: string;
    revision: number;
    draftId: string;
    candidateId: string;
    status: "imported" | "existing";
    evaluationState: "model_pending";
  }[];
};
export const InboxSetupSchema = z
  .strictObject({
    workspaceRef: InboxId,
    artistId: z.uuid(),
    artistRef: InboxId,
    seriesId: z.uuid().nullable(),
    seriesRef: InboxId.nullable(),
    expectedRevision: z.number().int().nonnegative(),
  })
  .refine(
    (p) => (p.seriesId === null) === (p.seriesRef === null),
    "SERIES_MAPPING_REQUIRED",
  );
