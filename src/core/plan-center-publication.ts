import {assertPlanIdentity} from './plan-identity';
import {hasPlanAlbumAdapter} from '../shared/plan-albums';
import type {Studio} from './studio';
import type {PlanCenterItem,PlanCenterRun} from '../shared/plan-center';
import {PlanPublicationLinkSchema,PlanPublicationAlbumBindingSchema,type PlanPublicationLink,type PlanPublicationCapabilities} from '../shared/plan-publication';
import {platformTargets,type PlatformTarget} from '../shared/platform-config';
import {listPlatformConfigurations} from './platform-config';
import {publishSimple,checkSimplePublication} from './simple-publication';
import {unifiedPublicationService} from './unified-publication-integration';
import {externalTmeReceipt} from './external-tme-receipt';
import {digest} from './plan-center/storage';

const prefix='plan-publication:v1:';
const online=new Set(['reviewing','published','rejected']);
/** Queue plumbing exists. No installed production directory/create/append contract is verified. */
export function planPublicationCapabilities(_s:Studio):PlanPublicationCapabilities{return{
 publication:{available:true,reason:'LOCAL_UNIFIED_PUBLICATION_QUEUE'},
 albumCatalog:{available:false,reason:'OFFICIAL_ALBUM_CATALOG_UNAVAILABLE'},
 albumCreate:{available:false,reason:'ALBUM_CREATE_UNAVAILABLE'},
 albumAppend:{available:false,reason:'ALBUM_APPEND_UNAVAILABLE'},
}}
export function planPublicationStatus(s:Studio,runId?:string):PlanPublicationLink[]{
 return s.repo.settingsByPrefix(prefix,runId ? {path:'$.value.runId',values:[runId]} : undefined)
  .map(row=>PlanPublicationLinkSchema.parse(row.value));
}
/** Original receipt provenance only. This historical evidence never authorizes another write. */
export function planPublicationBindingEvidence(s:Studio,link:PlanPublicationLink){
 if(!link.albumBindingId)return null;
 const original=link.albumBindingSnapshot??(typeof s.planAlbumService==='function'?s.planAlbumService().status().bindings?.find(b=>b.id===link.albumBindingId):undefined);
 if(!original||original.id!==link.albumBindingId||original.scope.platform!==link.platform||original.scope.accountId!==link.accountId)return null;
 return original;
}
/** Verifies actual original bytes and the selected recording already bound by PlanCenter. */
export function planPublicationMaterialFingerprint(s:Studio,run:PlanCenterRun,item:PlanCenterItem){
 if(!item.workId)throw Error('PLAN_WORK_BINDING_REQUIRED');
 if(!item.materials)throw Error('PLAN_MATERIALS_REQUIRED');
 const work=s.get('works',item.workId),m=item.materials;
 if(work.artistId!==run.snapshot.artistId)throw Error('PLAN_WORK_ARTIST_SCOPE');
 const selected=work.selectedAudioVariant==='B'?'B':'A';
 if(selected!==m.selectedVersion||work.title!==m.title||work.lyrics!==m.lyrics||work.assets?.[selected==='B'?'audio_B':'audio_A']!==m.audioAssetId||work.assets?.cover!==m.coverAssetId)throw Error('PLAN_WORK_MATERIAL_SCOPE');
 const version=item.versions.find(v=>v.version===m.selectedVersion);
 if(version?.assetId&&version.assetId!==m.audioAssetId)throw Error('PLAN_AUDIO_VERSION_SCOPE');
 const audio=s.get('assets',m.audioAssetId),cover=s.get('assets',m.coverAssetId);
 if(audio.kind!=='audio'||cover.kind!=='image'||version?.sha256&&version.sha256!==audio.sha256)throw Error('PLAN_ASSET_SCOPE');
 s.locate(audio.id);s.locate(cover.id);
 return digest({workId:work.id,artistId:work.artistId,materials:m,audio:{id:audio.id,sha256:audio.sha256},cover:{id:cover.id,sha256:cover.sha256},rights:work.rights,ai:work.ai,isCover:work.isCover,coverAuthorization:work.coverAuthorization,metadata:work.publicationMetadata??work.metadata??{},config:work.config??{}});
}
function project(s:Studio,link:PlanPublicationLink):PlanPublicationLink{
 if(!link.publicationTaskId)return link;
 const task=unifiedPublicationService(s).byId(link.publicationTaskId);
 if(task.workId!==link.workId||task.accountId!==link.accountId||!task.targets.includes(link.platform))return{...link,state:'blocked',onlineVerified:false,reason:'PLAN_PUBLICATION_TASK_SCOPE',receipt:undefined};
 const account=s.repo.maybe('accounts',link.accountId),receipt=task.receipt;
 const albums=typeof s.planAlbumService==='function'?s.planAlbumService():null;
 const bound=planPublicationBindingEvidence(s,link)??(link.albumBindingId?albums?.bindingForRun({runId:link.runId,platform:link.platform,accountId:link.accountId}):null);
 if(online.has(task.state)&&receipt&&(bound?.source==='offline-fixture'||receipt.source==='offline-fixture'||receipt.fixture===true||task.source==='offline-fixture'))return{...link,state:task.state,sourceState:task.state,onlineVerified:false,receipt,reason:'OFFLINE_FIXTURE_ONLY'};
 if(online.has(task.state)&&receipt&&link.albumBindingId&&(!bound||bound.id!==link.albumBindingId||bound.scope.accountFingerprint!==account?.remoteSubject||receipt.albumId!==bound.albumId))return{...link,state:'blocked',sourceState:task.state,onlineVerified:false,receipt:undefined,reason:'PLAN_ALBUM_RECEIPT_SCOPE'};
 let verified=online.has(task.state)&&!!receipt&&!!account?.remoteSubject&&receipt.subjectHash===account.remoteSubject;
 // Legacy official records still prevent duplicate writes. Attribute them to an account only with identity evidence.
 if(task.reason==='OFFICIAL_RECORD_ALREADY_EXISTS'){
  const original=externalTmeReceipt(s.repo,task.workId,task.audioSha);
  verified=online.has(task.state)&&!!receipt&&!!original?.subjectHash&&original.subjectHash===account?.remoteSubject;
 }
 if(verified)return{...link,state:task.state,sourceState:task.state,onlineVerified:true,receipt,reason:task.reason??undefined};
 if(online.has(task.state))return{...link,state:'blocked',sourceState:task.state,onlineVerified:false,receipt:undefined,reason:'OFFICIAL_RECEIPT_ACCOUNT_UNVERIFIED'};
 const state:PlanPublicationLink['state']=task.state==='reconcile_required'?'unknown':task.state==='queued'?'local_queue':task.state==='preparing'?'preparing':task.state==='awaiting_authorization'?'awaiting_authorization':task.state==='awaiting_confirmation'?'awaiting_confirmation':'blocked';
 const job=task.prepareJobId?s.repo.maybe('settings','tme-ai-prepare:job:'+task.prepareJobId)?.value:null;
 return{...link,state:job?.state==='awaiting_terms_review'&&state!=='unknown'&&state!=='awaiting_confirmation'?'prepared':state,sourceState:task.state,onlineVerified:false,receipt:undefined,reason:task.reason??undefined};
}
/** Only freezes local intent and reads the original services. It never invokes upload/terms/submit. */
export function syncPlanPublications(s:Studio):PlanPublicationLink[]{
 if(s.mode!=='production')return planPublicationStatus(s);
 // Construct once before this local sync transaction, so restart recovery is never rolled back by a queue gate.
 const albums=typeof s.planAlbumService==='function'?s.planAlbumService():null;
 return s.repo.transaction(()=>{
  const rows=s.planCenterService().list(),stamp=s.now().toISOString();
  for(const run of rows.runs)for(const item of rows.items.filter(i=>i.runId===run.id))for(const target of run.snapshot.publishTargets.filter(t=>t.enabled)){
   const id=digest([run.id,item.id,target.platform,target.accountId]),key=prefix+id;
   const old=s.repo.maybe('settings',key)?.value as PlanPublicationLink|undefined;
   const stopped=run.stopRequested||['stopped','stopping','failed'].includes(run.state);
   if(!old&&(stopped||!item.materials))continue;
   let link:PlanPublicationLink=old??{id,runId:run.id,itemId:item.id,workId:item.workId,platform:target.platform,accountId:target.accountId,albumIntent:target.album,state:'blocked',onlineVerified:false,createdAt:stamp,updatedAt:stamp};
   try{
    if(old?.publicationTaskId)link=project(s,link);
    if(link.onlineVerified){s.save('settings',{id:key,value:PlanPublicationLinkSchema.parse({...link,updatedAt:stamp})});continue;}
    const fingerprint=planPublicationMaterialFingerprint(s,run,item);
    if(link.workId&&link.workId!==item.workId||link.materialFingerprint&&link.materialFingerprint!==fingerprint||item.materialFingerprint&&item.materialFingerprint!==fingerprint)throw Error('PLAN_PUBLICATION_MATERIALS_CHANGED');
    if(!link.materialFingerprint)link={...link,workId:item.workId,materialFingerprint:fingerprint};
    if(target.platform==='fanqie')throw Error('FANQIE_BROWSER_RUNTIME_UNAVAILABLE');
    if(!hasPlanAlbumAdapter(target.platform))throw Error('PLATFORM_ALBUM_ADAPTER_NOT_IMPLEMENTED');
    const binding=albums?.bindingForRun({runId:run.id,platform:target.platform,accountId:target.accountId})??null;
    const albumOps=albums?.status().operations??[],append=albumOps.find(o=>o.kind==='append'&&o.runId===run.id&&o.itemId===item.id&&o.scope.accountId===target.accountId&&(['qqmusic','kugou'].includes(target.platform)?['qqmusic','kugou'].includes(o.scope.platform):o.scope.platform===target.platform)&&o.selectionHash===digest(target.album)&&o.materialFingerprint===fingerprint);
    const create=albumOps.find(o=>o.kind==='create'&&o.planId===run.planId&&o.scope.accountId===target.accountId&&o.selectionHash===digest(target.album));
    const originalBinding=link.albumBindingSnapshot??(binding?PlanPublicationAlbumBindingSchema.parse({id:binding.id,albumId:binding.albumId,title:binding.title,scope:binding.scope,source:binding.source,onlineVerified:binding.onlineVerified}):undefined);
    link={...link,albumBindingId:link.albumBindingId??binding?.id,albumBindingSnapshot:originalBinding,albumOperationId:append?.id??link.albumOperationId??create?.id};
    if(!stopped&&!link.publicationTaskId){
     assertPlanIdentity(s,run,target);
     if(!platformTargets.includes(target.platform as PlatformTarget))throw Error('PLATFORM_EXECUTOR_UNAVAILABLE');
     // Tencent's existing service groups QQ/Kugou into one recording family. Enqueue that
     // complete account family together so a later target cannot replace its sibling.
     const family=run.snapshot.publishTargets.filter(t=>t.enabled&&t.accountId===target.accountId&&platformTargets.includes(t.platform as PlatformTarget)&&(['qqmusic','kugou'].includes(target.platform)?['qqmusic','kugou'].includes(t.platform):t.platform===target.platform));
     const result=publishSimple(s,{workIds:[item.workId!],targets:family.map(t=>t.platform as PlatformTarget),accountOverrides:Object.fromEntries(family.map(t=>[t.platform,t.accountId]))});
     const task=result.pipeline.find(t=>t.accountId===target.accountId&&t.workId===item.workId&&t.targets.includes(target.platform));
     if(!task)throw Error('PLAN_PUBLICATION_TASK_SCOPE');link={...link,publicationTaskId:task.id};
    }
    if(link.publicationTaskId){
     const service=unifiedPublicationService(s),task=service.byId(link.publicationTaskId);
     if(!task.dispatchedAt&&!online.has(task.state)&&task.state!=='reconcile_required'){
      const reason=stopped?'PLAN_STOP_REQUESTED':!run.snapshot.authorization.publish?'PLAN_PUBLICATION_AUTHORIZATION_REQUIRED':!binding?(target.album.mode==='existing'?'ALBUM_CATALOG_REQUIRED':create?.state==='unknown'?'ALBUM_CREATE_RECONCILE_REQUIRED':'ALBUM_CREATE_CONFIRMATION_REQUIRED'):append?.state==='unknown'?'ALBUM_APPEND_RECONCILE_REQUIRED':!append||!['dispatching','succeeded'].includes(append.state)||append.publicationTaskId!==task.id||append.albumId!==binding.albumId?'ALBUM_APPEND_AUTHORIZATION_REQUIRED':null;
      const protectedReason=['PROTECTED_PUBLISHED_WORK','OFFICIAL_RECORD_ALREADY_EXISTS','AI_PREPARATION_NOT_APPLICABLE'].includes(task.reason);
      if(reason&&!protectedReason&&(task.state!=='blocked'||task.reason!==reason))service.update({id:task.id,expectedRevision:task.revision,patch:{state:'blocked',reason}});
      else if(!reason&&!protectedReason&&task.state==='blocked'&&/^(ALBUM_|PLAN_STOP_REQUESTED|PLAN_PUBLICATION_AUTHORIZATION_REQUIRED)/.test(task.reason??'')){
       const configs=listPlatformConfigurations(s.repo),checks=task.targets.map((platform:PlatformTarget)=>{const config=configs.find(c=>c.target===platform);if(!config)throw Error('PLATFORM_CONFIGURATION_REQUIRED');return checkSimplePublication(s,s.get('works',item.workId!),platform,config,target.accountId)});
       const state=checks.some((c:any)=>c.state==='needs_configuration')?'needs_configuration':checks.some((c:any)=>c.state==='needs_materials')?'needs_materials':'queued';
       service.update({id:task.id,expectedRevision:task.revision,patch:{state,reason:state==='queued'?null:state==='needs_configuration'?'PLAN_PUBLICATION_CONFIGURATION_REQUIRED':'PLAN_PUBLICATION_MATERIALS_REQUIRED'}});
      }
     }
     link=project(s,link);
    }
    if(stopped&&link.state!=='unknown'&&!online.has(link.state)&&link.sourceState!=='preparing')link={...link,state:'stopped',reason:'PLAN_STOP_REQUESTED'};
   }catch(e){
    const reason=e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'PLAN_PUBLICATION_MATERIALS_INVALID';
    // An in-flight unknown stays unknown; changed local bytes never authorize another queue family.
    link={...link,state:link.state==='unknown'?'unknown':'blocked',reason};
    if(link.publicationTaskId){const service=unifiedPublicationService(s),task=service.list().find(t=>t.id===link.publicationTaskId);if(task&&!task.dispatchedAt&&!online.has(task.state)&&task.state!=='reconcile_required'&&(task.state!=='blocked'||task.reason!==reason))service.update({id:task.id,expectedRevision:task.revision,patch:{state:'blocked',reason}});}
   }
   s.save('settings',{id:key,value:PlanPublicationLinkSchema.parse({...link,updatedAt:stamp})});
  }
  return planPublicationStatus(s);
 });
}
