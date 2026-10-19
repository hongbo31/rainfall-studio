import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import type {Repository} from './database';
import {CenterStore,digest} from './plan-center/storage';
import type {PlanCenterRun,PlanCenterPublishTarget} from '../shared/plan-center';
import {PlanAlbumTargetSchema,PlanAlbumCatalogRecordSchema,PlanAlbumCatalogSchema,PlanAlbumScopeSchema,PlanAlbumSelectSchema,PlanAlbumCreateSchema,PlanAlbumAppendSchema,PlanAlbumBindingSchema,PlanAlbumOperationSchema,PlanAlbumOperationIdSchema,PlanAlbumAuthorizeSchema,PlanAlbumClaimSchema,PlanAlbumResultSchema,PlanAlbumRunTargetSchema} from '../shared/plan-albums';
import type {PlanAlbumScope,PlanAlbumCatalog,PlanAlbumBinding,PlanAlbumOperation,PlanAlbumRunTarget,PlanAlbumResult} from '../shared/plan-albums';

export type PlanAlbumOptions={now?:()=>Date|string;allowFixture?:boolean;recoverDispatching?:boolean;materialFingerprint?:(runId:string,itemId:string)=>string};
const prefix='plan-albums:v1:';
const tme=new Set(['qqmusic','kugou']);
const terminal=new Set(['succeeded','failed','not_found']);
type Entity={catalog:PlanAlbumCatalog;binding:PlanAlbumBinding;operation:PlanAlbumOperation};
const schemas={catalog:PlanAlbumCatalogSchema,binding:PlanAlbumBindingSchema,operation:PlanAlbumOperationSchema};
/** Account-scoped durable intent. All remote IO belongs to the Main broker, outside transactions. */
export class PlanAlbumService {
 private center:CenterStore;
 get allowsFixture(){return this.options.allowFixture===true}
 constructor(readonly repo:Repository,readonly options:PlanAlbumOptions={}){
  this.center=new CenterStore(repo);
  if(options.recoverDispatching!==false)this.repo.transaction(()=>{
   for(const op of this.all('operation'))if(op.state==='dispatching')this.put('operation',{...op,state:'unknown',reason:'RESTART_RECONCILE_REQUIRED',updatedAt:this.now()});
  });
 }
 private now(){return new Date(this.options.now?.()??new Date()).toISOString()}
 private all<K extends keyof Entity>(kind:K):Entity[K][]{return this.repo.all('settings').filter(r=>r.id.startsWith(prefix+kind+':')).map(r=>schemas[kind].parse(r.value) as Entity[K])}
 private put<K extends keyof Entity>(kind:K,value:Entity[K]):Entity[K]{const parsed=schemas[kind].parse(value) as Entity[K];this.repo.save('settings',{id:prefix+kind+':'+parsed.id,value:parsed});return parsed}
 private get<K extends keyof Entity>(kind:K,id:string):Entity[K]|undefined{const value=this.repo.maybe('settings',prefix+kind+':'+id)?.value;return value===undefined?undefined:schemas[kind].parse(value) as Entity[K]}
 scope(input:{platform:string;accountId:string}):PlanAlbumScope{
  const p=PlanAlbumTargetSchema.parse({platform:input.platform,accountId:input.accountId}),a=this.repo.maybe('accounts',p.accountId);
  if(!a||typeof a.remoteSubject!=='string'||!a.remoteSubject.trim())throw Error('ALBUM_ACCOUNT_IDENTITY_REQUIRED');
  if(tme.has(p.platform)&&!['tme','qqmusic','kugou'].includes(a.provider)||!tme.has(p.platform)&&a.provider!==p.platform)throw Error('ALBUM_ACCOUNT_PLATFORM_MISMATCH');
  return{...p,accountFingerprint:a.remoteSubject};
 }
 private sameScope(a:PlanAlbumScope,b:PlanAlbumScope){return digest(a)===digest(b)}
 private verifyScope(scope:PlanAlbumScope){if(!this.sameScope(scope,this.scope(scope)))throw Error('ACCOUNT_SCOPE_CHANGED')}
 private family(scope:PlanAlbumScope){return digest([tme.has(scope.platform)?'tme':scope.platform,scope.accountFingerprint])}
 private sourceAllowed(source:string){if(source!=='official'&&this.options.allowFixture!==true)throw Error('ALBUM_OFFICIAL_EVIDENCE_REQUIRED')}
 status(){return{catalogs:this.all('catalog'),bindings:this.all('binding'),operations:this.all('operation')}}
 catalog(input:{platform:string;accountId:string}):PlanAlbumCatalog|null{
  const scope=this.scope(input);return this.all('catalog').filter(c=>this.sameScope(c.scope,scope)).at(-1)??null;
 }
 recordCatalog(input:z.input<typeof PlanAlbumCatalogRecordSchema>):PlanAlbumCatalog{
  const c=PlanAlbumCatalogRecordSchema.parse(input);this.verifyScope(c.scope);
  if(Date.parse(c.observedAt)>Date.parse(this.now()))throw Error('ALBUM_CATALOG_FUTURE');
  return this.repo.transaction(()=>this.put('catalog',{...c,id:randomUUID(),onlineVerified:c.source==='official'}));
 }
 private fresh(c:PlanAlbumCatalog){if(Date.parse(c.expiresAt)<=Date.parse(this.now()))throw Error('ALBUM_CATALOG_EXPIRED')}
 private target(p:PlanAlbumRunTarget):{run:PlanCenterRun;target:PlanCenterPublishTarget;scope:PlanAlbumScope;familyKey:string}{
  const run=this.center.get('run',p.runId);if(!run)throw Error('ALBUM_RUN_NOT_FOUND');
  const target=run.snapshot.publishTargets.find(t=>t.enabled&&t.platform===p.platform&&t.accountId===p.accountId);if(!target)throw Error('ALBUM_TARGET_NOT_CONFIGURED');
  const scope=this.scope(p),familyKey=this.family(scope);
  // Compare all enabled sibling targets before any write, including separate account rows for the same subject.
  for(const sibling of run.snapshot.publishTargets.filter(t=>t.enabled)){
   const otherScope=this.scope(sibling);
   if(this.family(otherScope)===familyKey&&digest(sibling.album)!==digest(target.album))throw Error('ALBUM_FAMILY_INTENT_CONFLICT');
  }
  return{run,target,scope,familyKey};
 }
 private active(run:PlanCenterRun){if(run.stopRequested||['stopped','stopping'].includes(run.state))throw Error('STOP_REQUESTED');if(['failed','completed'].includes(run.state))throw Error('RUN_TERMINAL')}
 selectBinding(input:z.input<typeof PlanAlbumSelectSchema>):PlanAlbumBinding{
  const p=PlanAlbumSelectSchema.parse(input);
  return this.repo.transaction(()=>{
   const {run,target,scope,familyKey}=this.target(p);this.active(run);
   const c=this.get('catalog',p.catalogId);if(!c||!this.sameScope(c.scope,scope))throw Error('ALBUM_CATALOG_SCOPE');
   if(this.catalog(p)?.id!==c.id)throw Error('ALBUM_CATALOG_CHANGED');this.fresh(c);this.sourceAllowed(c.source);
   const entry=c.entries.find(e=>e.key===p.entryKey);if(!entry)throw Error('ALBUM_CATALOG_ENTRY_NOT_FOUND');if(!entry.id)throw Error('ALBUM_REMOTE_ID_REQUIRED');
   if(target.album.mode!=='existing'||target.album.albumId!==entry.id)throw Error('ALBUM_INTENT_MISMATCH');
   const selectionHash=digest(target.album),id=digest([run.planId,scope,selectionHash]),old=this.get('binding',id),now=this.now();
   return this.put('binding',{id,planId:run.planId,createdByRunId:run.id,scope,familyKey,selection:target.album,selectionHash,albumId:entry.id,title:entry.title,source:c.source,onlineVerified:c.source==='official',evidenceHash:c.evidenceHash,catalogId:c.id,createdAt:old?.createdAt??now,updatedAt:now});
  });
 }
 bindingForRun(input:z.input<typeof PlanAlbumRunTargetSchema>):PlanAlbumBinding|null{
  const p=PlanAlbumRunTargetSchema.parse(input),{run,target,scope,familyKey}=this.target(p),selectionHash=digest(target.album);
  const plan=this.center.get('plan',run.planId);if(!plan||plan.revision!==run.planRevision)return null;
  const binding=this.all('binding').filter(b=>b.planId===run.planId&&b.selectionHash===selectionHash&&b.familyKey===familyKey&&(b.scope.accountId===scope.accountId||target.album.mode==='new')).at(-1);
  if(!binding)return null;
  if(binding.source!=='official'&&this.options.allowFixture!==true)return null;
  if(binding.catalogId){const c=this.get('catalog',binding.catalogId);if(!c||Date.parse(c.expiresAt)<=Date.parse(this.now()))return null;}
  // The TME family shares one remote album, while every returned binding retains the exact requested scope.
  return{...binding,id:digest([run.planId,scope,selectionHash]),scope};
 }
 bindingForTask(input:z.input<typeof PlanAlbumRunTargetSchema>){return this.bindingForRun(input)}
 private context(op:PlanAlbumOperation){
  this.verifyScope(op.scope);const {run}=this.target({runId:op.runId,...op.scope}),plan=this.center.get('plan',run.planId);
  if(!plan||plan.revision!==run.planRevision)throw Error('PLAN_REVISION_CHANGED');
  if(op.kind==='append'&&op.itemId&&this.options.materialFingerprint&&this.options.materialFingerprint(op.runId,op.itemId)!==op.materialFingerprint)throw Error('ALBUM_MATERIALS_CHANGED');
  const catalog=this.catalog(op.scope);if(catalog)this.fresh(catalog);
  const binding=op.kind==='append'?this.bindingForRun({runId:op.runId,platform:op.scope.platform,accountId:op.scope.accountId}):null;
  if(op.kind==='append'&&(!binding||binding.id!==op.bindingId||binding.albumId!==op.albumId))throw Error('ALBUM_NOT_BOUND');
  return digest({scope:op.scope,runId:run.id,runSummaryHash:run.summaryHash,snapshot:run.snapshot,planRevision:plan.revision,catalog:catalog?.id??null,binding,materialFingerprint:op.materialFingerprint,publicationTaskId:op.publicationTaskId,prepareJobId:op.prepareJobId});
 }
 private prepare(p:z.infer<typeof PlanAlbumCreateSchema>|z.infer<typeof PlanAlbumAppendSchema>,kind:'create'|'append'):PlanAlbumOperation{
  return this.repo.transaction(()=>{
   const {run,target,scope,familyKey}=this.target(p);this.active(run);
   if(!run.snapshot.authorization.publish)throw Error('ALBUM_PUBLICATION_AUTHORIZATION_REQUIRED');
   if(kind==='create'&&target.album.mode!=='new')throw Error('ALBUM_INTENT_MISMATCH');
   const extra='itemId' in p?p:undefined,selectionHash=digest(target.album),id=digest([kind,run.planId,familyKey,selectionHash,extra?.itemId??null]);
   const old=this.get('operation',id);if(old){
    if(extra&&(old.materialFingerprint!==extra.materialFingerprint||old.publicationTaskId!==extra.publicationTaskId||old.prepareJobId!==extra.prepareJobId))throw Error('ALBUM_REQUEST_CHANGED');
    if(['prepared','authorized'].includes(old.state)){
     // Explicit reprepare obtains fresh consent without replacing an idempotency key that has never dispatched.
     const rebased={...old,runId:run.id,state:'prepared' as const,authorizationHash:undefined,authorizedAt:undefined,reason:undefined,updatedAt:this.now()};
     return this.put('operation',{...rebased,contextHash:this.context(rebased)});
    }
    return old;
   }
   const binding=kind==='append'?this.bindingForRun({runId:p.runId,platform:p.platform,accountId:p.accountId}):null;
   if(kind==='append'&&!binding)throw Error('ALBUM_NOT_BOUND');
   if(extra){const item=this.center.get('item',extra.itemId);if(!item||item.runId!==run.id)throw Error('ALBUM_ITEM_SCOPE');if(this.options.materialFingerprint&&this.options.materialFingerprint(run.id,item.id)!==extra.materialFingerprint)throw Error('ALBUM_MATERIALS_CHANGED');}
   const now=this.now(),base:PlanAlbumOperation={id,operationId:id,idempotencyKey:'plan-album:'+id,kind,runId:run.id,planId:run.planId,scope,familyKey,selection:target.album,selectionHash,requestHash:digest({kind,planId:run.planId,selection:target.album,scopeFamily:familyKey,itemId:extra?.itemId,materialFingerprint:extra?.materialFingerprint,albumId:binding?.albumId,publicationTaskId:extra?.publicationTaskId,prepareJobId:extra?.prepareJobId}),contextHash:'0'.repeat(64),state:'prepared',source:binding?.source??'official',onlineVerified:false,...(extra?{itemId:extra.itemId,materialFingerprint:extra.materialFingerprint,publicationTaskId:extra.publicationTaskId,prepareJobId:extra.prepareJobId}:{}),...(binding?{bindingId:binding.id,albumId:binding.albumId}:{}),createdAt:now,updatedAt:now};
   return this.put('operation',{...base,contextHash:this.context(base)});
  });
 }
 prepareCreate(input:z.input<typeof PlanAlbumCreateSchema>){return this.prepare(PlanAlbumCreateSchema.parse(input),'create')}
 prepareAppend(input:z.input<typeof PlanAlbumAppendSchema>){return this.prepare(PlanAlbumAppendSchema.parse(input),'append')}
 private operation(input:{operationId:string}){const p=PlanAlbumOperationIdSchema.parse(input),op=this.get('operation',p.operationId);if(!op)throw Error('ALBUM_OPERATION_NOT_FOUND');return op}
 preview(input:z.input<typeof PlanAlbumOperationIdSchema>){const operation=this.operation(input);const contextHash=this.context(operation);return{operation,summaryHash:digest({requestHash:operation.requestHash,contextHash})}}
 authorize(input:z.input<typeof PlanAlbumAuthorizeSchema>){
  const p=PlanAlbumAuthorizeSchema.parse(input);
  return this.repo.transaction(()=>{
   const op=this.operation({operationId:p.operationId});if(op.state==='unknown'||op.state==='dispatching')throw Error('ALBUM_RECONCILE_REQUIRED');if(terminal.has(op.state))throw Error('ALBUM_OPERATION_TERMINAL');
   const {run}=this.target({runId:op.runId,...op.scope});this.active(run);const preview=this.preview({operationId:op.id});
   if(preview.summaryHash!==p.summaryHash||this.context(op)!==op.contextHash)throw Error('ALBUM_AUTHORIZATION_STALE');
   return this.put('operation',{...op,state:'authorized',authorizationHash:p.summaryHash,authorizedAt:this.now(),updatedAt:this.now()});
  });
 }
 claim(input:z.input<typeof PlanAlbumClaimSchema>):PlanAlbumOperation{
  const p=PlanAlbumClaimSchema.parse(input);
  if(this.repo.db.inTransaction)throw Error('ALBUM_CLAIM_REQUIRES_STANDALONE_TRANSACTION');
  return this.repo.transaction(()=>{
   const op=this.operation({operationId:p.operationId});if(['unknown','dispatching'].includes(op.state))throw Error('ALBUM_RECONCILE_REQUIRED');if(terminal.has(op.state))throw Error('ALBUM_OPERATION_TERMINAL');
   const {run}=this.target({runId:op.runId,...op.scope});this.active(run);
   const preview=this.preview({operationId:op.id});if(op.state!=='authorized'||op.authorizationHash!==p.summaryHash||preview.summaryHash!==p.summaryHash||this.context(op)!==op.contextHash)throw Error('ALBUM_AUTHORIZATION_STALE');
   return this.put('operation',{...op,state:'dispatching',updatedAt:this.now()});
  });
 }
 record(input:z.input<typeof PlanAlbumResultSchema>){return this.result(PlanAlbumResultSchema.parse(input),false)}
 reconcile(input:z.input<typeof PlanAlbumResultSchema>){return this.result(PlanAlbumResultSchema.parse(input),true)}
 private result(p:PlanAlbumResult,reconciling:boolean):PlanAlbumOperation{
  return this.repo.transaction(()=>{
   const op=this.operation({operationId:p.operationId});this.verifyScope(op.scope);if(!this.sameScope(p.scope,op.scope))throw Error('ALBUM_RESULT_SCOPE');this.sourceAllowed(p.source);
   const state=p.status==='pending'?'unknown':p.status;
   if(terminal.has(op.state)){if(op.state===state&&op.evidenceHash===p.evidenceHash&&op.albumId===(p.albumId??op.albumId)&&digest(op.receipt??{})===digest(p.receipt??{}))return op;throw Error('ALBUM_OPERATION_TERMINAL');}
   if(!['dispatching','unknown'].includes(op.state))throw Error('ALBUM_OPERATION_NOT_CLAIMED');
   if(op.state==='unknown'&&!reconciling&&state!=='unknown')throw Error('ALBUM_RECONCILE_REQUIRED');
   if(state==='succeeded'){
    if(!p.albumId)throw Error('ALBUM_REMOTE_ID_REQUIRED');if(!p.evidenceHash)throw Error('ALBUM_EVIDENCE_REQUIRED');
    if(op.kind==='append'){
     if(p.albumId!==op.albumId)throw Error('ALBUM_RECEIPT_ID_MISMATCH');
     const receipt=p.receipt;if(!receipt||typeof(receipt.songId??receipt.externalId)!=='string'||!(receipt.songId??receipt.externalId))throw Error('ALBUM_SONG_RECEIPT_REQUIRED');
     if(receipt.subjectHash!==op.scope.accountFingerprint)throw Error('ALBUM_RECEIPT_ACCOUNT_SCOPE');
     if(op.publicationTaskId&&receipt.publicationTaskId!==op.publicationTaskId||op.prepareJobId&&receipt.prepareJobId!==op.prepareJobId)throw Error('ALBUM_RECEIPT_TASK_SCOPE');
     if(receipt.albumId!==p.albumId)throw Error('ALBUM_RECEIPT_ID_MISMATCH');
    }
   }
   const now=this.now(),updated=this.put('operation',{...op,state,source:p.source,onlineVerified:state==='succeeded'&&p.source==='official',albumId:p.albumId??op.albumId,evidenceHash:p.evidenceHash??op.evidenceHash,receipt:p.receipt??op.receipt,reason:p.reason,updatedAt:now});
   if(state==='succeeded'&&op.kind==='create'){
    const id=digest([op.planId,op.scope,op.selectionHash]);this.put('binding',{id,planId:op.planId,createdByRunId:op.runId,scope:op.scope,familyKey:op.familyKey,selection:op.selection,selectionHash:op.selectionHash,albumId:p.albumId!,title:op.selection.mode==='new'?op.selection.title:'',source:p.source,onlineVerified:p.source==='official',evidenceHash:p.evidenceHash!,operationId:op.id,createdAt:now,updatedAt:now});
   }
   return updated;
  });
 }
}
