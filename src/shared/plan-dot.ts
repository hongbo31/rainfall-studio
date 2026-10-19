import { z } from 'zod';

const id = z.string().min(1).max(500);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const stamp = z.iso.datetime({offset:true});
const externalId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/).refine(v=>!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(v));
/** Immutable request snapshot. The hash covers every field except requestHash itself. */
export const PlanDotRequestSchema = z.strictObject({
 requestVersion:z.literal(2), requestId:externalId, requestHash:hash,
 planId:id, planRevision:z.number().int().positive(), runId:id, itemId:id, ordinal:z.number().int().positive(),
 profileIdentity:id, channelId:id, workspaceId:id, workspaceRef:id, artistId:id, artistRef:id,
 expectedExternalItemId:externalId, revision:z.number().int().positive().max(1000000),
 outputs:z.strictObject({lyrics:z.boolean(),cover:z.boolean(),music:z.boolean()}),
 brief:z.strictObject({title:z.string().max(200),theme:z.string().max(2000),styleTemplate:z.string().max(4000)}),
 createdAt:stamp, expiresAt:stamp,
}).refine(r=>Date.parse(r.expiresAt)>Date.parse(r.createdAt),'DOT_REQUEST_EXPIRY_INVALID');
export const PlanDotEchoSchema = PlanDotRequestSchema;
export type PlanDotRequest = z.infer<typeof PlanDotRequestSchema>;
export const PlanDotAssociationSchema = z.strictObject({
 requestId:externalId,requestHash:hash,planId:id,runId:id,itemId:id,candidateId:id,draftId:id,
 externalItemId:externalId,revision:z.number().int().positive(),channelId:id,artistRef:id,
 protocolVersion:z.union([z.literal(1),z.literal(2)]),
 status:z.enum(['received','attached','stopped','expired','late']),late:z.boolean(),
 coverAssetId:id.optional(),coverSha256:hash.optional(),reason:z.string().max(500).optional(),receivedAt:stamp,
});
export type PlanDotAssociation = z.infer<typeof PlanDotAssociationSchema>;
export const planDotRequestPrefix='plan-dot:request:';
export const planDotAssociationPrefix='plan-dot:association:';
