import {z} from 'zod';
import {PlanCenterAlbumSelectionSchema} from './plan-center';
import {PlanAlbumScopeSchema,PlanAlbumSourceSchema} from './plan-albums';
const id=z.string().min(1).max(500),sha=z.string().regex(/^[a-f0-9]{64}$/);
export const PlanPublicationAlbumBindingSchema=z.strictObject({id,albumId:id,title:z.string(),scope:PlanAlbumScopeSchema,source:PlanAlbumSourceSchema,onlineVerified:z.boolean()});
/** Local queue/preparation and remotely verified song states are deliberately separate. */
export const PlanPublicationLinkSchema=z.strictObject({
 id,runId:id,itemId:id,workId:id.optional(),platform:id,accountId:id,
 publicationTaskId:z.uuid().optional(),materialFingerprint:sha.optional(),albumIntent:PlanCenterAlbumSelectionSchema,
 albumBindingId:id.optional(),albumOperationId:id.optional(),
 albumBindingSnapshot:PlanPublicationAlbumBindingSchema.optional(),
 state:z.enum(['local_queue','preparing','prepared','awaiting_authorization','awaiting_confirmation','unknown','blocked','reviewing','published','rejected','stopped']),
 sourceState:z.string().optional(),onlineVerified:z.boolean(),reason:z.string().optional(),
 receipt:z.record(z.string(),z.unknown()).optional(),createdAt:z.iso.datetime({offset:true}),updatedAt:z.iso.datetime({offset:true}),
});
export type PlanPublicationLink=z.infer<typeof PlanPublicationLinkSchema>;
export type PlanPublicationCapability={available:boolean;reason?:string};
export type PlanPublicationCapabilities=Record<'publication'|'albumCatalog'|'albumCreate'|'albumAppend',PlanPublicationCapability>;
export type PlanPublicationTaskScope={workId:string;publicationTaskId:string;accountId:string};
