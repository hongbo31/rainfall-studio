import fs from 'node:fs';
import path from 'node:path';
import {z} from 'zod';
import {LiveMusicInput} from '../shared/live-music';
import type {ApiCredentials} from './api-credentials';
type Options={root:string;credentials:ApiCredentials;rpc:(method:string,input?:unknown)=>Promise<any>;available:()=>boolean};
export function createLiveMusicBroker(o:Options){
 const approvedAudio=new Map<string,Set<string>>();
 const rpc=async(method:string,input:unknown={})=>{const r=await o.rpc(method,input);if(!r.ok)throw Error(r.error.code);return r.value};
 const assertAvailable=()=>{if(!o.available())throw Error('PRODUCTION_REQUIRED')};
 const identity=(c:any)=>({profileId:c.grant.profileId,expectedRevision:c.grant.expectedRevision});
 return{
  async ui(action:string,raw:unknown){
   assertAvailable();
   if(action==='stage'){
    const input=LiveMusicInput.parse(raw);
    const status=await o.credentials.apiCredentialStatus({profileId:input.profileId});if(!status.configured)throw Error('CREDENTIAL_REQUIRED');
    return o.credentials.runExclusive(()=>rpc('internal.liveMusic.stage',input));
   }
   if(action==='status'){z.strictObject({}).parse(raw);return rpc('internal.liveMusic.status')}
   if(action==='submit'){
    const input=z.strictObject({requestId:z.uuid(),consent:z.literal(true)}).parse(raw);
    const c=await rpc('internal.liveMusic.context');if(!c||c.grant.requestId!==input.requestId)throw Error('LIVE_SCOPE_MISMATCH');
    return o.credentials.runExclusive(()=>rpc('internal.liveMusic.start',{requestId:input.requestId}));
   }
   if(action==='import'){z.strictObject({}).parse(raw);return rpc('internal.liveMusic.materialize')}
   if(action==='retryDownloads'){z.strictObject({}).parse(raw);return rpc('internal.liveMusic.retryDownloads')}
   if(action==='recover'){
    z.strictObject({}).parse(raw);const c=await rpc('internal.liveMusic.context');if(!c||c.operation.state!=='unknown')throw Error('RECOVERY_SCOPE_REJECTED');
    const receipts=path.join(o.root,'production','music-receipts',c.operation.id),file=path.join(receipts,'submit-result.json');
    let result=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;
    if(result?.state!=='accepted'){
     const dispatchFile=path.join(receipts,'dispatch.json');if(!fs.existsSync(dispatchFile))return{state:'not_established',reason:'NO_DURABLE_DISPATCH_MARKER'};
     const dispatch=JSON.parse(fs.readFileSync(dispatchFile,'utf8'));if(dispatch.operationId!==c.operation.id||dispatch.requestId!==c.grant.requestId||!Number.isFinite(Date.parse(dispatch.at)))throw Error('DISPATCH_IDENTITY_MISMATCH');
     result=await o.credentials.withMusicAdapter(identity(c),a=>a.recoverRecent({draft:c.draft.draft,createdAt:dispatch.at}));
    }
    fs.mkdirSync(receipts,{recursive:true});fs.writeFileSync(path.join(receipts,'recovery-check.json'),JSON.stringify(result,null,2));
    return result?.state==='accepted'?rpc('internal.liveMusic.recover',{id:c.operation.id,result}):result;
   }
   throw Error('METHOD_NOT_ALLOWED');
  },
  async provider(message:any,assertCurrent:()=>void=()=>{}){
   const guard=()=>{assertCurrent();assertAvailable()};guard();
   const input=z.strictObject({kind:z.literal('music-provider'),id:z.uuid(),action:z.enum(['submit','query','download']),operationId:z.uuid(),url:z.string().max(5000).optional()}).parse(message);
   const c=await rpc('internal.liveMusic.context',{id:input.operationId});if(!c||c.grant.creditCap!==385||c.grant.consent!==true)throw Error('LIVE_SCOPE_MISMATCH');
   guard();
   const receipts=path.join(o.root,'production','music-receipts',c.operation.id);fs.mkdirSync(receipts,{recursive:true});
   if(input.action==='submit'){
    if(c.operation.state!=='dispatching'||c.operation.modelId!=='chirp-v6'||c.grant.balanceBefore!==385)throw Error('LIVE_DISPATCH_REJECTED');
    // Exclusive durable marker BEFORE the single paid POST. A restart never deletes it.
    fs.writeFileSync(path.join(receipts,'dispatch.json'),JSON.stringify({operationId:c.operation.id,requestId:c.grant.requestId,at:new Date().toISOString(),maxCredits:385,isMaxMode:false,automaticTopUp:false}),{flag:'wx'});
    return o.credentials.withMusicAdapter(identity(c),async a=>{const result=await a.submit({draft:c.draft.draft,modelId:'chirp-v6',operationId:c.operation.id});fs.writeFileSync(path.join(receipts,'submit-result.json'),JSON.stringify(result,null,2));return result},guard);
   }
   if(!['accepted','polling','download_failed','assets_verified'].includes(c.operation.state))throw Error('LIVE_QUERY_SCOPE_REJECTED');
   if(input.action==='query'){
    const result=await o.credentials.withMusicAdapter(identity(c),a=>a.query(c.operation.songIds),guard);
    approvedAudio.set(c.operation.id,new Set((result.songs??[]).map((s:any)=>s.audio_url).filter(Boolean)));
    fs.writeFileSync(path.join(receipts,'latest-query.json'),JSON.stringify(result,null,2));return result;
   }
   if(!input.url||!approvedAudio.get(c.operation.id)?.has(input.url))throw Error('UNVERIFIED_AUDIO_URL');
   return o.credentials.withMusicAdapter(identity(c),a=>a.download(input.url!),guard);
  },
 };
}
