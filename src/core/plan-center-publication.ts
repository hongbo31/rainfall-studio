import type {Studio} from './studio';
import type {PlanCenterItem,PlanCenterRun} from '../shared/plan-center';
import {PlanPublicationLinkSchema,type PlanPublicationLink,type PlanPublicationCapabilities} from '../shared/plan-publication';
import {platformTargets,type PlatformTarget} from '../shared/platform-config';
import {publishSimple} from './simple-publication';
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
export function planPublicationStatus(s:Studio):PlanPublicationLink[]{return s.repo.all('settings').filter(r=>r.id.startsWith(prefix)).map(r=>PlanPublicationLinkSchema.parse(r.value));}
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
    if(!stopped&&!link.publicationTaskId){
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
      const reason=stopped?'PLAN_STOP_REQUESTED':!run.snapshot.authorization.publish?'PLAN_PUBLICATION_AUTHORIZATION_REQUIRED':target.album.mode==='existing'?'ALBUM_APPEND_UNAVAILABLE':'ALBUM_CREATE_UNAVAILABLE';
      if(task.state!=='blocked'||task.reason!==reason)service.update({id:task.id,expectedRevision:task.revision,patch:{state:'blocked',reason}});
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
