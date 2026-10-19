import {randomUUID} from 'node:crypto';
import type {Repository} from './database';
import {
 AccountIdentityPublicActions,AccountIdentitySelectionSchema,AccountIdentityObservationSchema,AccountIdentityExpiredSchema,
 AccountIdentityBindingSchema,AccountIdentityPublishScopeSchema,
 type AccountIdentityBinding,type AccountIdentitySelection,type AccountIdentityObservation,type AccountIdentityLoginState,
 type AccountIdentityPublicBinding,type AccountIdentityPublishScope,
} from '../shared/account-identity';

/** Main-owned dependency, never supplied through renderer/Studio public arguments.
 * Fixture implementations live in tests and are rejected in production. */
export type AccountIdentityAdapter={
 provider:string;source:'official'|'offline-fixture';contractVersion:string;evidenceHash:string;
 read:(scope:Readonly<AccountIdentitySelection>)=>Promise<unknown>;
 checkSession?:(sessionRef:string)=>Promise<boolean>;
};
type Options={environment?:'production'|'test';now?:()=>Date;adapters?:readonly AccountIdentityAdapter[]};
type Login={state:AccountIdentityLoginState;observedAt?:string;sessionRef?:string};
const kind='account-identity-v1',prefix=kind+':',freshFor=300_000;
const subjectKeys=['provider','namespace','remoteAccountId','remoteArtistId'] as const;
const sameSubject=(a:AccountIdentityBinding,b:AccountIdentityObservation)=>subjectKeys.every(key=>a[key]===b[key]);

/** Isolated settings namespace. Does not mutate legacy accounts/bindings or publication intent keys. */
export class AccountIdentityService{
 private readonly logins=new Map<string,Login>();
 private readonly busy=new Set<string>();
 private readonly adapters:readonly AccountIdentityAdapter[];
 private epoch=0;
 constructor(private readonly repo:Repository,private readonly options:Options={}){this.adapters=[...(options.adapters??[])];}
 invalidateSessions(){this.epoch++;this.logins.clear();}
 private now(){return this.options.now?.()??new Date();}
 private stamp(){return this.now().toISOString();}
 private rows():AccountIdentityBinding[]{return this.repo.all('settings').filter(r=>r.kind===kind&&r.id===prefix+r.value?.id).map(r=>AccountIdentityBindingSchema.parse(r.value));}
 private get(id:string){const row=this.repo.maybe('settings',prefix+id);if(!row||row.kind!==kind)throw Error('IDENTITY_BINDING_NOT_FOUND');const value=AccountIdentityBindingSchema.parse(row.value);if(value.id!==id)throw Error('IDENTITY_BINDING_SCOPE');return value;}
 private put(binding:AccountIdentityBinding){const value=AccountIdentityBindingSchema.parse(binding);this.repo.save('settings',{id:prefix+value.id,kind,value});return value;}
 private current(selection:AccountIdentitySelection){return this.rows().find(b=>b.artistId===selection.artistId&&b.accountId===selection.accountId&&b.provider===selection.provider);}
 private assertLocal(selection:AccountIdentitySelection){this.repo.get('artists',selection.artistId);const account=this.repo.get('accounts',selection.accountId);if(account.provider!==selection.provider)throw Error('IDENTITY_ACCOUNT_PROVIDER_SCOPE');}
 private fresh(time:string){const age=this.now().getTime()-Date.parse(time);return Number.isFinite(age)&&age>=-5000&&age<=freshFor;}
 private login(binding:AccountIdentityBinding):Login{
  const value=this.logins.get(binding.id);
  if(!value||value.state==='valid'&&(!value.observedAt||!this.fresh(value.observedAt)))return{state:'unchecked'};
  return value;
 }
 private public(binding:AccountIdentityBinding,reason?:string):AccountIdentityPublicBinding{
  const login=this.login(binding);return{...binding,loginState:login.state,...(login.observedAt?{checkedAt:login.observedAt}:{}),...(reason?{reason}:{})};
 }
 private adapter(provider:string){
  const matches=this.adapters.filter(a=>a.provider===provider&&a.contractVersion.trim()&&/^[a-f0-9]{64}$/.test(a.evidenceHash)&&(a.source==='official'||a.source==='offline-fixture'&&this.options.environment==='test'));
  return matches.length===1?matches[0]:undefined;
 }
 private unavailable(selection:AccountIdentitySelection,binding?:AccountIdentityBinding,missing=['remoteAccountId','remoteArtistId','officialIdentityContract']){
  if(binding)this.logins.set(binding.id,{state:'unchecked'});
  return{...(binding?this.public(binding):{...selection,bindingState:'unsupported' as const,loginState:'unchecked' as const}),reason:'IDENTITY_ADAPTER_UNVERIFIED',missing};
 }
 private async observe(raw:unknown){
  const selection=AccountIdentitySelectionSchema.parse(raw);this.assertLocal(selection);
  let binding=this.current(selection);if(binding?.bindingState==='revoked')throw Error('BINDING_REVOKED');
  const adapter=this.adapter(selection.provider);if(!adapter)return this.unavailable(selection,binding);
  const key=selection.provider+':'+selection.accountId;if(this.busy.has(key))throw Error('IDENTITY_CHECK_BUSY');
  this.busy.add(key);
  for(const prior of this.rows().filter(b=>b.accountId===selection.accountId&&b.provider===selection.provider))this.logins.set(prior.id,{state:'unchecked'});
  try{
   const epoch=this.epoch,rawObservation=await adapter.read(Object.freeze({...selection}));
   if(epoch!==this.epoch)throw Error('IDENTITY_SESSION_CHANGED');
   // Re-read after await: revocation or mapping changes must not be overwritten.
   binding=this.current(selection);if(binding?.bindingState==='revoked')throw Error('BINDING_REVOKED');
   if(AccountIdentityExpiredSchema.safeParse(rawObservation).success){if(!binding)return{...selection,bindingState:'unbound' as const,loginState:'expired' as const,reason:'LOGIN_EXPIRED'};this.logins.set(binding.id,{state:'expired'});return this.public(binding,'LOGIN_EXPIRED');}
   const partial=rawObservation as Record<string,unknown>|null;
   const missing=['remoteAccountId','remoteArtistId'].filter(k=>typeof partial?.[k]!=='string'||!(partial[k] as string).trim());
   if(missing.length)return this.unavailable(selection,binding,missing);
   const observation=AccountIdentityObservationSchema.parse(rawObservation);
   if(observation.provider!==selection.provider)throw Error('IDENTITY_ADAPTER_PROVIDER_SCOPE');
   if(!this.fresh(observation.observedAt))throw Error('IDENTITY_OBSERVATION_STALE');
   for(const [id,login] of this.logins)if(login.sessionRef===observation.sessionRef)this.logins.set(id,{state:'unchecked'});
   if(binding&&!sameSubject(binding,observation)){this.logins.set(binding.id,{state:'identity_mismatch',observedAt:observation.observedAt});return this.public(binding,'LOGIN_IDENTITY_MISMATCH');}
   if(this.rows().some(b=>b.id!==binding?.id&&b.bindingState!=='revoked'&&sameSubject(b,observation)&&(b.artistId!==selection.artistId||b.accountId!==selection.accountId)))throw Error('IDENTITY_MAPPING_CONFLICT');
   if(!binding){const {status:_,sessionRef:__,...evidence}=observation;binding=this.put({...selection,...evidence,id:randomUUID(),revision:1,bindingState:'pending_verification',createdAt:this.stamp(),updatedAt:this.stamp()});}
   this.logins.set(binding.id,{state:'valid',observedAt:observation.observedAt,sessionRef:observation.sessionRef});
   return this.public(binding);
  }finally{this.busy.delete(key);}
 }
 private requireLogin(binding:AccountIdentityBinding){
  const state=this.login(binding).state;
  if(state!=='valid')throw Error(state==='expired'?'LOGIN_EXPIRED':state==='identity_mismatch'?'LOGIN_IDENTITY_MISMATCH':'LOGIN_CHECK_REQUIRED');
 }
 private async confirm(raw:unknown){
  const input=AccountIdentityPublicActions.confirm.parse(raw);let binding=this.get(input.id);
  if(binding.bindingState==='revoked')throw Error('BINDING_REVOKED');
  if(binding.revision!==input.expectedRevision)throw Error('REVISION_CONFLICT');
  this.assertLocal(binding);this.requireLogin(binding);
  const adapter=this.adapter(binding.provider),login=this.login(binding),epoch=this.epoch;
  if(adapter?.checkSession){
   let valid=false;try{valid=!!login.sessionRef&&(await adapter.checkSession(login.sessionRef))===true}catch{this.logins.set(binding.id,{state:'unchecked'});throw Error('LOGIN_CHECK_REQUIRED');}
   if(!valid||epoch!==this.epoch){this.logins.set(binding.id,{state:'unchecked'});throw Error('LOGIN_CHECK_REQUIRED');}
   binding=this.get(input.id);if(binding.bindingState==='revoked')throw Error('BINDING_REVOKED');if(binding.revision!==input.expectedRevision)throw Error('REVISION_CONFLICT');this.requireLogin(binding);
  }
  if(binding.bindingState==='bound')return this.public(binding);
  return this.public(this.put({...binding,bindingState:'bound',revision:binding.revision+1,confirmedAt:this.stamp(),updatedAt:this.stamp()}));
 }
 private async revoke(raw:unknown){
  const input=AccountIdentityPublicActions.revoke.parse(raw),binding=this.get(input.id);
  if(binding.revision!==input.expectedRevision)throw Error('REVISION_CONFLICT');
  if(binding.bindingState==='revoked')return this.public(binding);
  this.logins.delete(binding.id);return this.public(this.put({...binding,bindingState:'revoked',revision:binding.revision+1,revokedAt:this.stamp(),updatedAt:this.stamp()}));
 }
 /** Only this narrow facade is suitable for Studio public RPC. It has no observation or adapter operation. */
 execute(action:string,input:unknown={}):any{
  switch(action){
   case 'list':AccountIdentityPublicActions.list.parse(input);return this.rows().map(b=>this.public(b));
   case 'get':return this.public(this.get(AccountIdentityPublicActions.get.parse(input).id));
   case 'start':case 'check':return this.observe(input);
   case 'confirm':return this.confirm(input);
   case 'revoke':return this.revoke(input);
   default:return Promise.reject(Error('ACTION_NOT_ALLOWED'));
  }
 }
 /** Internal write gate. Build its arguments from the frozen task, never a renderer payload.
  * Existing intent-based read-only reconciliation remains outside this write gate. */
 assertPublishScope(raw:AccountIdentityPublishScope):AccountIdentityPublicBinding{
  const scope=AccountIdentityPublishScopeSchema.parse(raw),binding=this.get(scope.bindingId);
  if(binding.bindingState==='revoked')throw Error('BINDING_REVOKED');
  if(binding.bindingState!=='bound')throw Error('BINDING_NOT_VERIFIED');
  if(binding.revision!==scope.bindingRevision||binding.artistId!==scope.artistId||binding.accountId!==scope.accountId||subjectKeys.some(k=>binding[k]!==scope[k]))throw Error('IDENTITY_PUBLISH_SCOPE');
  this.assertLocal(binding);
  if(scope.externalState!=='not_started')throw Error('RECONCILIATION_REQUIRED');
  this.requireLogin(binding);return this.public(binding);
 }
}
