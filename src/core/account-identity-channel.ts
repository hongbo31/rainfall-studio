import {randomUUID,createHash} from 'node:crypto';
import type {AccountIdentityAdapter} from './account-identity';
/** Private utility-process lane: replies/invalidation must be consumed before the RPC chain. */
export function createAccountIdentityBridge(port:{postMessage:(message:unknown)=>void},options:{invalidated:()=>void;timeoutMs?:number}){
 const pending=new Map<string,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:NodeJS.Timeout;session:boolean}>();
 const request=(message:Record<string,unknown>)=>new Promise<any>((resolve,reject)=>{const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('IDENTITY_RESPONSE_TIMEOUT'))},options.timeoutMs??45000);pending.set(id,{resolve,reject,timer,session:message.action==='session'});try{port.postMessage({kind:'account-identity-request',id,...message})}catch{clearTimeout(timer);pending.delete(id);reject(Error('IDENTITY_CHANNEL_UNAVAILABLE'))}});
 const cancel=()=>{options.invalidated();for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('IDENTITY_SESSION_CHANGED'))}pending.clear();};
 const adapter:AccountIdentityAdapter={provider:'tme',source:'official',contractVersion:'tme-getUserInfo-calibrated-20261019',evidenceHash:createHash('sha256').update('official-page-own-response|https://y.tencentmusic.com|GET|/v2/v2/user/getUserInfo|tme-musician|singerInfo.accountId|singerInfo.id').digest('hex'),read:scope=>request({action:'read',scope}),checkSession:sessionRef=>request({action:'session',sessionRef})};
 return{adapter,close:cancel,accept(message:any){
  if(message?.kind==='account-identity-invalidated'){cancel();return true;}
  if(message?.kind!=='account-identity-result')return false;
  const p=pending.get(message.id);if(!p)return false;clearTimeout(p.timer);pending.delete(message.id);
  if(message.ok===true)p.resolve(p.session?message.value===true:message.value);else{const code=typeof message.error?.code==='string'&&/^[A-Z0-9_]{1,100}$/.test(message.error.code)?message.error.code:'IDENTITY_READ_FAILED';p.reject(Error(code));}return true;
 }};
}
