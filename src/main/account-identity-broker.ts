import {z} from 'zod';
import {AccountIdentityPublicActions,AccountIdentitySelectionSchema,AccountIdentityObservationSchema} from '../shared/account-identity';
import type {OfficialStableIdentity} from './tme/official-stable-identity';
type Session={readStableIdentity:()=>Promise<OfficialStableIdentity&{sessionRef:string}>;stableIdentitySessionValid:(ref:string)=>boolean|Promise<boolean>};
const request=z.discriminatedUnion('action',[
 z.strictObject({kind:z.literal('account-identity-request'),id:z.uuid(),action:z.literal('read'),scope:AccountIdentitySelectionSchema}),
 z.strictObject({kind:z.literal('account-identity-request'),id:z.uuid(),action:z.literal('session'),sessionRef:z.string().min(1).max(500)}),
]);
/** Main owns official reads. Provider handlers never call RPC back into blocked Core. */
export function createAccountIdentityBroker(o:{session:Session;available:()=>boolean;generation:()=>number;rpc:(method:string,input:unknown)=>Promise<any>}){
 let selectionEpoch=0,selectionKey:string|undefined,reading=false;
 const key=(scope:{artistId:string;accountId:string;provider:string})=>JSON.stringify([scope.artistId,scope.accountId,scope.provider]);
 const guard=(generation:number)=>{if(!o.available())throw Error('PRODUCTION_REQUIRED');if(o.generation()!==generation)throw Error('WORKSPACE_CHANGED');};
 return{
  async ui(action:string,input:unknown={}){
   const schema=AccountIdentityPublicActions[action as keyof typeof AccountIdentityPublicActions];if(!schema)throw Error('ACTION_NOT_ALLOWED');
   const value=schema.parse(input),generation=o.generation();guard(generation);
   const isRead=action==='start'||action==='check',epoch=isRead?++selectionEpoch:selectionEpoch;
   if(isRead)selectionKey=key(AccountIdentitySelectionSchema.parse(value));
   const result=await o.rpc('internal.accountIdentity.'+action,value);guard(generation);
   if(isRead&&epoch!==selectionEpoch)throw Error('IDENTITY_SELECTION_CHANGED');
   if(!result.ok)throw Error(result.error.code);return result.value;
  },
  async provider(raw:unknown,assertCurrent:()=>void){
   const message=request.parse(raw),generation=o.generation();guard(generation);assertCurrent();
   if(message.action==='session'){const valid=await o.session.stableIdentitySessionValid(message.sessionRef);guard(generation);assertCurrent();return valid===true;}
   if(message.scope.provider!=='tme')throw Error('IDENTITY_ADAPTER_UNVERIFIED');
   const epoch=selectionEpoch;if(key(message.scope)!==selectionKey)throw Error('IDENTITY_SELECTION_CHANGED');
   if(reading)throw Error('IDENTITY_CHECK_BUSY');reading=true;
   try{
   const observed=await o.session.readStableIdentity();guard(generation);assertCurrent();
   if(epoch!==selectionEpoch||key(message.scope)!==selectionKey)throw Error('IDENTITY_SELECTION_CHANGED');
   if(await o.session.stableIdentitySessionValid(observed.sessionRef)!==true)throw Error('CLOUD_BROWSER_SESSION_REQUIRED');guard(generation);assertCurrent();
   if(epoch!==selectionEpoch||key(message.scope)!==selectionKey)throw Error('IDENTITY_SELECTION_CHANGED');
   if(observed.provider!=='tme'||observed.namespace!=='tme-musician'||observed.source.kind!=='official-page-own-response'||observed.source.origin!=='https://y.tencentmusic.com'||observed.source.path!=='/v2/v2/user/getUserInfo'||observed.source.method!=='GET')throw Error('IDENTITY_ADAPTER_UNVERIFIED');
   return AccountIdentityObservationSchema.parse({status:'observed',provider:'tme',namespace:'tme-musician',remoteAccountId:observed.remoteAccountId,remoteArtistId:observed.remoteArtistId,accountDisplayName:observed.accountDisplayName,artistDisplayName:observed.artistDisplayName,observedAt:observed.observedAt,evidenceRef:'official-stable-identity:'+observed.evidenceHash,evidenceHash:observed.evidenceHash,sessionRef:observed.sessionRef});
   }finally{reading=false;}
  },
 };
}
