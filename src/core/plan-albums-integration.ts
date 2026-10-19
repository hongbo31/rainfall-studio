import {z} from 'zod';
import type {Studio} from './studio';
import {PlanAlbumService,type PlanAlbumOptions} from './plan-albums';
import {validate} from '../shared/schemas';
import {PlanAlbumOperationIdSchema,PlanAlbumTargetSchema} from '../shared/plan-albums';
import {planPublicationMaterialFingerprint,planPublicationStatus,syncPlanPublications,planPublicationBindingEvidence} from './plan-center-publication';
import {unifiedPublicationService} from './unified-publication-integration';
import {digest} from './plan-center/storage';

export function createPlanAlbumService(s:Studio,options:PlanAlbumOptions={}){
 return new PlanAlbumService(s.repo,{now:s.now,...options,materialFingerprint:(runId,itemId)=>{
  const rows=s.planCenterService().list(),run=rows.runs.find(r=>r.id===runId),item=rows.items.find(i=>i.id===itemId&&i.runId===runId);
  if(!run||!item)throw Error('ALBUM_ITEM_SCOPE');return planPublicationMaterialFingerprint(s,run,item);
 }});
}
function publicOperation<T extends {receipt?:unknown;authorizationHash?:unknown}>(operation:T){const {receipt,authorizationHash,...safe}=operation;return safe}
export function executePlanAlbums(s:Studio,action:string,input:unknown={}){
 if(s.mode!=='production')throw Error('PRODUCTION_REQUIRED');
 const p=validate('planAlbums.'+action,input) as any,service=s.planAlbumService();
 if(action==='status'){const status=service.status();return{...status,operations:status.operations.map(publicOperation)}}
 if(action==='catalog'){try{return service.catalog(p)}catch(error){if(error instanceof Error&&error.message==='ALBUM_ACCOUNT_IDENTITY_REQUIRED')return null;throw error}}
 if(action==='select')return service.selectBinding(p);
 if(action==='prepareCreate')return publicOperation(service.prepareCreate(p));
 if(action==='preview'){const result=service.preview(p);return{...result,operation:publicOperation(result.operation)}}
 if(action==='prepareAppend'){
  const rows=s.planCenterService().list(),run=rows.runs.find(r=>r.id===p.runId),item=rows.items.find(i=>i.id===p.itemId&&i.runId===p.runId);
  if(!run||!item)throw Error('ALBUM_ITEM_SCOPE');
  const materialFingerprint=planPublicationMaterialFingerprint(s,run,item);
  syncPlanPublications(s);
  const links=planPublicationStatus(s).filter(l=>l.runId===p.runId&&l.itemId===p.itemId&&l.platform===p.platform&&l.accountId===p.accountId);
  if(links.length!==1||!links[0].publicationTaskId)throw Error('ALBUM_PUBLICATION_TASK_REQUIRED');
  const task=unifiedPublicationService(s).byId(links[0].publicationTaskId);
  if(task.workId!==item.workId||task.accountId!==p.accountId||!task.targets.includes(p.platform))throw Error('ALBUM_PUBLICATION_TASK_SCOPE');
  return publicOperation(service.prepareAppend({...p,materialFingerprint,publicationTaskId:task.id,...(task.prepareJobId?{prepareJobId:task.prepareJobId}:{})}));
 }
 throw Error('METHOD_NOT_ALLOWED');
}
/** This dispatcher is reached only by the trusted Main/Core channel, never renderer RPC. */
export function executeInternalPlanAlbums(s:Studio,action:string,input:unknown={}){
 if(s.mode!=='production')throw Error('PRODUCTION_REQUIRED');
 const service=s.planAlbumService();
 if(action==='scope')return service.scope(PlanAlbumTargetSchema.parse(input));
 if(action==='context'){
  const p=PlanAlbumOperationIdSchema.parse(input),operation=service.status().operations.find(o=>o.id===p.operationId);if(!operation)throw Error('ALBUM_OPERATION_NOT_FOUND');
  const run=s.planCenterService().list().runs.find(r=>r.id===operation.runId);if(!run)throw Error('ALBUM_RUN_NOT_FOUND');
  const artist=s.repo.maybe('artists',run.snapshot.artistId);return{operation,run,artist:artist??null,artistName:String(artist?.name??''),binding:service.bindingForRun({runId:run.id,platform:operation.scope.platform,accountId:operation.scope.accountId})};
 }
 if(action==='recordCatalog')return service.recordCatalog(input as any);
 if(action==='authorize')return service.authorize(input as any);
 if(action==='claim')return service.claim(input as any);
 if(action==='record')return service.record(input as any);
 if(action==='reconcile')return service.reconcile(input as any);
 if(action==='activateAppend'||action==='appendResult'){
  const {operationId}=PlanAlbumOperationIdSchema.parse(input),operation=service.status().operations.find(o=>o.id===operationId);if(!operation||operation.kind!=='append'||!operation.publicationTaskId||!operation.itemId)throw Error('ALBUM_APPEND_OPERATION_REQUIRED');
  if(action==='activateAppend'&&operation.state!=='dispatching')throw Error('ALBUM_APPEND_NOT_CLAIMED');
  if(action==='appendResult'&&!['dispatching','unknown','succeeded','failed'].includes(operation.state))throw Error('ALBUM_APPEND_NOT_CLAIMED');
  const rows=s.planCenterService().list(),run=rows.runs.find(r=>r.id===operation.runId),item=rows.items.find(i=>i.id===operation.itemId&&i.runId===operation.runId);
  if(!run||!item||!item.workId)throw Error('ALBUM_ITEM_SCOPE');
  if(action==='activateAppend'){
   if(run.stopRequested||['stopping','stopped','failed','completed'].includes(run.state))throw Error('STOP_REQUESTED');
   const plan=rows.plans.find(p=>p.id===run.planId);if(!plan||plan.revision!==run.planRevision)throw Error('PLAN_REVISION_CHANGED');
   if(planPublicationMaterialFingerprint(s,run,item)!==operation.materialFingerprint)throw Error('ALBUM_MATERIALS_CHANGED');
  }
  const currentScope=service.scope(operation.scope);if(currentScope.accountFingerprint!==operation.scope.accountFingerprint)throw Error('ACCOUNT_SCOPE_CHANGED');
  let binding=service.bindingForRun({runId:run.id,platform:operation.scope.platform,accountId:operation.scope.accountId});
  // Expired catalog consent prevents new writes, but cannot discard an already claimed original receipt.
  if(!binding&&action==='appendResult'){
   const original=service.status().bindings.find(b=>b.planId===operation.planId&&b.familyKey===operation.familyKey&&b.selectionHash===operation.selectionHash&&b.albumId===operation.albumId&&b.scope.accountFingerprint===operation.scope.accountFingerprint);
   if(original)binding={...original,id:operation.bindingId!,scope:operation.scope};
  }
  const link=planPublicationStatus(s).find(l=>l.runId===run.id&&l.itemId===item.id&&l.accountId===operation.scope.accountId&&l.platform===operation.scope.platform&&l.publicationTaskId===operation.publicationTaskId&&l.workId===item.workId);if(!link||link.albumBindingId!==operation.bindingId)throw Error('ALBUM_PUBLICATION_TASK_SCOPE');
  if(action==='appendResult'&&link){const original=planPublicationBindingEvidence(s,link);if(original)binding={...binding!,...original} as typeof binding;}
  if(!binding||binding.id!==operation.bindingId||binding.albumId!==operation.albumId||binding.scope.accountFingerprint!==operation.scope.accountFingerprint)throw Error('ALBUM_APPEND_BINDING_SCOPE');
  const task=unifiedPublicationService(s).byId(operation.publicationTaskId);if(task.workId!==item.workId||task.accountId!==operation.scope.accountId||!task.targets.includes(operation.scope.platform))throw Error('ALBUM_PUBLICATION_TASK_SCOPE');
  if(action==='activateAppend'){syncPlanPublications(s);return{operationId,publicationTaskId:task.id,prepareJobId:task.prepareJobId??null}}
  const receipt=task.receipt,source=binding.source==='offline-fixture'||operation.source==='offline-fixture'||receipt?.source==='offline-fixture'||receipt?.fixture===true||task.source==='offline-fixture'?'offline-fixture' as const:'official' as const;
  if(['reviewing','published','rejected'].includes(task.state)){
   if(!receipt||typeof(receipt.songId??receipt.externalId)!=='string'||!(receipt.songId??receipt.externalId))throw Error('ALBUM_SONG_RECEIPT_REQUIRED');
   if(receipt.subjectHash!==operation.scope.accountFingerprint)throw Error('ALBUM_RECEIPT_ACCOUNT_SCOPE');if(receipt.albumId!==operation.albumId)throw Error('ALBUM_RECEIPT_ID_MISMATCH');
   const exactReceipt={...receipt,publicationTaskId:task.id,...(task.prepareJobId?{prepareJobId:task.prepareJobId}:{})};return{status:task.state==='rejected'?'failed' as const:'succeeded' as const,source,albumId:operation.albumId,evidenceHash:digest(exactReceipt),receipt:exactReceipt,reason:task.reason??undefined};
  }
  if(task.state==='reconcile_required')return{status:'unknown' as const,source,reason:task.reason??'ALBUM_APPEND_RECONCILE_REQUIRED'};
  return{status:'pending' as const,source,reason:task.reason??undefined};
 }
 if(action==='status'){z.strictObject({}).parse(input);return service.status()}
 throw Error('METHOD_NOT_ALLOWED');
}
