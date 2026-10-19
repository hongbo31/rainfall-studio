import {z} from 'zod';
const id=z.uuid();
const text=z.string().min(1).max(500).refine(v=>v===v.trim()&&!/[\u0000-\u001f]/.test(v));
const provider=z.string().regex(/^[a-z][a-z0-9_-]{0,49}$/);
const revision=z.number().int().positive();
export const AccountIdentitySelectionSchema=z.strictObject({artistId:id,accountId:id,provider});
export const AccountIdentityPublicActions={
 list:z.strictObject({}),get:z.strictObject({id}),
 start:AccountIdentitySelectionSchema,check:AccountIdentitySelectionSchema,
 confirm:z.strictObject({id,expectedRevision:revision,confirmed:z.literal(true)}),
 revoke:z.strictObject({id,expectedRevision:revision}),
};
export const AccountIdentitySubjectSchema=z.strictObject({provider,namespace:text,remoteAccountId:text,remoteArtistId:text});
/** Internal adapter output only. Never accept this schema on public RPC. */
export const AccountIdentityObservationSchema=AccountIdentitySubjectSchema.extend({
 status:z.literal('observed'),accountDisplayName:text,artistDisplayName:text,
 observedAt:z.iso.datetime({offset:true}),evidenceRef:text,evidenceHash:z.string().regex(/^[a-f0-9]{64}$/),sessionRef:text,
});
export const AccountIdentityExpiredSchema=z.strictObject({status:z.literal('expired')});
export const AccountIdentityBindingSchema=AccountIdentitySubjectSchema.extend({
 id,artistId:id,accountId:id,revision,bindingState:z.enum(['pending_verification','bound','revoked']),
 accountDisplayName:text,artistDisplayName:text,evidenceRef:text,evidenceHash:z.string().regex(/^[a-f0-9]{64}$/),
 observedAt:z.iso.datetime({offset:true}),createdAt:z.iso.datetime({offset:true}),updatedAt:z.iso.datetime({offset:true}),
 confirmedAt:z.iso.datetime({offset:true}).optional(),revokedAt:z.iso.datetime({offset:true}).optional(),
 // Stored state is deliberately stripped of any historical loginState/sessionRef.
}).strip();
export const AccountIdentityPublishScopeSchema=z.strictObject({
 bindingId:id,bindingRevision:revision,artistId:id,accountId:id,provider,namespace:text,remoteAccountId:text,remoteArtistId:text,
 externalState:z.enum(['not_started','unknown','dispatching','submitted','reviewing','published','rejected']),
});
export type AccountIdentitySelection=z.infer<typeof AccountIdentitySelectionSchema>;
export type AccountIdentityObservation=z.infer<typeof AccountIdentityObservationSchema>;
export type AccountIdentityBinding=z.infer<typeof AccountIdentityBindingSchema>;
export type AccountIdentityLoginState='valid'|'unchecked'|'expired'|'identity_mismatch';
export type AccountIdentityPublishScope=z.infer<typeof AccountIdentityPublishScopeSchema>;
export type AccountIdentityPublicBinding=AccountIdentityBinding&{loginState:AccountIdentityLoginState;checkedAt?:string;reason?:string};
