import {z} from 'zod';
import {TmeAiPrepareSnapshotSchema} from './tme-ai-prepare';
const id=z.uuid(),revision=z.number().int().positive(),sha=z.string().regex(/^[a-f0-9]{64}$/);
export const TmeAiSubmissionActions={
 preflight:z.strictObject({workId:id}),
 status:z.strictObject({workId:id}),
 authorizeAndSubmit:z.strictObject({id,expectedRevision:revision,termsHash:sha,consent:z.literal(true),rightsConfirmed:z.literal(true)}),
 reconcile:z.strictObject({id}),
};
export const TmeAiSubmissionCapabilitySchema=z.strictObject({available:z.boolean(),reasons:z.array(z.string().regex(/^[A-Z0-9_]+$/)).max(20),transport:z.string().min(1).max(100),readOnlyReceiptAvailable:z.boolean().optional()});
export type TmeAiSubmissionCapability=z.infer<typeof TmeAiSubmissionCapabilitySchema>;
export const TmeAiSubmissionReviewSchema=z.strictObject({prepareJobId:id,snapshot:TmeAiPrepareSnapshotSchema,contract:TmeAiSubmissionCapabilitySchema,sessionId:id});
export const TmeAiSubmissionAuthorizeSchema=TmeAiSubmissionActions.authorizeAndSubmit.extend({sessionId:id});
export const TmeAiSubmissionClaimSchema=z.strictObject({id,expectedRevision:revision,phase:z.enum(['accept','submit']),snapshot:TmeAiPrepareSnapshotSchema,sessionId:id});
export const TmeAiSubmissionReceiptSchema=z.strictObject({source:z.literal('official-tencent-review-record'),entityType:z.literal('song'),remoteId:z.string().regex(/^[a-zA-Z0-9_-]{5,100}$/),title:z.string().trim().min(1).max(1000),artistName:z.string().trim().min(1).max(1000),status:z.enum(['reviewing','rejected','published']),subjectHash:sha,scopeHash:sha,submittedAt:z.iso.datetime({offset:true}),submittedAtSource:z.enum(['official','dispatch-intent']).optional(),observedAt:z.iso.datetime({offset:true}),evidenceHash:sha,url:z.string().url().refine(v=>{const u=new URL(v);return u.protocol==='https:'&&u.hostname==='y.tencentmusic.com'&&u.port===''&&u.username===''&&u.password===''},'OFFICIAL_RECEIPT_URL_REQUIRED')});
export const TmeAiSubmissionResultSchema=z.discriminatedUnion('status',[
 z.strictObject({status:z.literal('accepted'),snapshot:TmeAiPrepareSnapshotSchema,scopeHash:sha}),
 z.strictObject({status:z.literal('reviewing'),receipt:TmeAiSubmissionReceiptSchema}),
 z.strictObject({status:z.literal('unknown'),reason:z.string().regex(/^[A-Z0-9_]+$/).max(120)}),
]);
export const TmeAiSubmissionRecordSchema=z.strictObject({id,operationId:id,result:TmeAiSubmissionResultSchema});
export const TmeAiSubmissionReconcileSchema=z.strictObject({id,receipt:TmeAiSubmissionReceiptSchema});
export type TmeAiSubmissionReceipt=z.infer<typeof TmeAiSubmissionReceiptSchema>;
