import {TmeAiPrepareMetadataSchema} from './tme-ai-metadata';
import {z} from 'zod';
import {createHash} from 'node:crypto';
const sha=z.string().regex(/^[a-f0-9]{64}$/),id=z.uuid(),revision=z.number().int().positive();
const text=z.string().trim().min(1).max(1000);
export const tmeAiPrepareSteps=['locate_intake','upload_audio','fill_metadata','set_cover','save_album','advance_to_terms'] as const;
export const TmeAiPrepareStepSchema=z.enum(tmeAiPrepareSteps);
export const TmeAiPrepareBindingSchema=z.union([z.strictObject({pid:z.number().int().positive(),handle:text,started:text,documentId:text.optional()}),z.strictObject({transport:z.literal('cloud-playwright'),sessionId:id,pageId:id,started:z.iso.datetime({offset:true})})]);
export const TmeAiPrepareIdentitySchema=z.strictObject({subjectType:z.literal('official_visible_binding_fingerprint'),subjectHash:sha,kugouId:z.string().regex(/^\d{5,30}$/),qqDisplayName:text,artistName:text,observedAt:z.iso.datetime({offset:true}),evidenceHash:sha});
export function tmeAiSubjectHash(identity:{kugouId:string;qqDisplayName:string;artistName:string}){
 return createHash('sha256').update(JSON.stringify({subjectType:'official_visible_binding_fingerprint',kugouId:identity.kugouId.trim(),qqDisplayName:identity.qqDisplayName.trim(),artistName:identity.artistName.trim()})).digest('hex');
}
export {TmeAiPrepareMetadataSchema} from './tme-ai-metadata';
export const TmeAiPrepareGrantSchema=z.strictObject({id,workId:id,identity:TmeAiPrepareIdentitySchema,binding:TmeAiPrepareBindingSchema,sourceAudio:z.strictObject({assetId:id,sha256:sha,variant:z.literal('A')}),upload:z.strictObject({path:z.string().min(1).max(32768),sha256:sha,format:z.literal('pcm_wav'),derivedFromSha256:sha}),cover:z.strictObject({assetId:id,sha256:sha}),lyricsHash:sha,metadata:TmeAiPrepareMetadataSchema,consent:z.literal(true)});
export type TmeAiPrepareGrant=z.infer<typeof TmeAiPrepareGrantSchema>;
export const TmeAiPrepareSnapshotSchema=z.strictObject({identity:TmeAiPrepareIdentitySchema,binding:TmeAiPrepareBindingSchema,observedAt:z.iso.datetime({offset:true}),evidenceHash:sha,mode:z.enum(['intake','editor','ai_authorization','unknown']),modeText:z.string().max(10000),visibleSubmitButton:z.boolean(),termsText:z.string().max(200000).optional(),termsHash:sha.optional(),verified:z.strictObject({sourceAudioSha:sha.optional(),uploadSha:sha.optional(),coverSha:sha.optional(),lyricsHash:sha.optional(),metadataHash:sha.optional(),albumSaved:z.boolean().optional()}).default({})});
export type TmeAiPrepareSnapshot=z.infer<typeof TmeAiPrepareSnapshotSchema>;
export const TmeAiPrepareStartSchema=z.strictObject({grantId:id,expectedRevision:revision,identity:TmeAiPrepareIdentitySchema,binding:TmeAiPrepareBindingSchema});
export const TmeAiPrepareClaimSchema=z.strictObject({id,expectedRevision:revision,step:TmeAiPrepareStepSchema,before:TmeAiPrepareSnapshotSchema});
export const TmeAiPrepareResultSchema=z.strictObject({status:z.enum(['applied','verified_existing','unknown','blocked']),snapshot:TmeAiPrepareSnapshotSchema,reason:z.string().regex(/^[A-Z0-9_]+$/).max(120).optional()});
export const TmeAiPrepareRecordSchema=z.strictObject({id,operationId:id,result:TmeAiPrepareResultSchema});
export const TmeAiPreparePublicSchemas={
 list:z.strictObject({}),context:z.strictObject({id}),
 start:z.strictObject({grantId:id,expectedRevision:revision,consent:z.literal(true)}),
 run:z.strictObject({id,expectedRevision:revision,consent:z.literal(true)}),
};
