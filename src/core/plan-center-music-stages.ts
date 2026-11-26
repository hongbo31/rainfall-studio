import type {Studio} from './studio';
import type {PlanCenterRun,PlanCenterItem,PlanCenterStageAttempt} from '../shared/plan-center';
import {startPlanMusic,syncPlanMusic,stopPlanMusic} from './plan-center-music';
import {adoptPlanMusicWork} from './plan-center-assets';

const reason=(e:unknown)=>e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'MUSIC_STAGE_FAILED';
export function tickPlanMusic(s:Studio,run:PlanCenterRun,item:PlanCenterItem){
 const service=s.planCenterService();
 // Cancellation must persist before validating mutable work/assets.
 let state=run.stopRequested?stopPlanMusic(s,run,item):syncPlanMusic(s,run,item);
 let stages=service.list().stageAttempts.filter(a=>a.itemId===item.id);
 const record=(a:PlanCenterStageAttempt,status:'succeeded'|'failed'|'unknown'|'waiting',result:Record<string,unknown>,why?:string)=>{
  if(['succeeded','failed','not_found'].includes(a.state))return;
  const input={attemptId:a.id,status,evidenceId:state?.operationId??state?.childRunId??'existing-work:'+item.workId,result,...(why?{reason:why}:{})};
  if(a.state==='unknown'&&status!=='unknown'&&status!=='waiting')service.reconcile({...input,status,evidenceId:input.evidenceId,source:'provider',actor:'music-provider'});else if(a.state!=='unknown')service.record(input);
 };
 if(!run.stopRequested){
  const next=service.next({runId:run.id,itemId:item.id});
  if(!next||!['music_submit','music_assets'].includes(next.stage))return false;
  if(run.snapshot.music.route==='manual'){
   if(!item.workId)return false;
   const work=s.get('works',item.workId),versions=item.versions;
   if(work.artistId!==run.snapshot.artistId||!versions.length)throw Error('AUDIO_BINDING_REQUIRED');
   for(const v of versions){const a=s.get('assets',v.assetId!);s.locate(a.id);if(a.sha256!==v.sha256||work.assets?.['audio_'+v.version]!==a.id)throw Error('AUDIO_BINDING_CHANGED');}
   if(next.state==='ready'){
    const claimed=service.claim({runId:run.id,itemId:item.id,stage:next.stage});
    if('id'in claimed)record(claimed,'succeeded',{source:'existing-work',workId:work.id,newGeneration:false,...(next.stage==='music_assets'?{versions}:{})});
   }
   return true;
  }
  if(!state&&next.stage==='music_submit'&&next.state==='ready'){
   const claimed=service.claim({runId:run.id,itemId:item.id,stage:'music_submit'});
   if(!('id'in claimed))return true;
   try{state=startPlanMusic(s,run,item,claimed);record(claimed,'waiting',{childRunId:state.childRunId,workId:state.workId,ownerKey:state.ownerKey});}
   catch(e){record(claimed,'failed',{},reason(e));return true;}
  }
 }
 if(!state)return false;
 if(state.workId&&!('artifactError'in state))adoptPlanMusicWork(s,run,item,state.workId);
 stages=service.list().stageAttempts.filter(a=>a.itemId===item.id);
 const submit=stages.filter(a=>a.stage==='music_submit').at(-1),proof={childRunId:state.childRunId,workId:state.workId,ownerKey:state.ownerKey,operationId:state.operationId,songIds:state.songIds,costUnknown:state.costUnknown};
 if(submit&&!['succeeded','failed','not_found'].includes(submit.state)){
  if(state.songIds.length===2)record(submit,'succeeded',proof);
  else if(state.stopped&&!state.operationId)record(submit,'failed',proof,'STOPPED_BEFORE_MUSIC_DISPATCH');
  else if(state.state==='unknown')record(submit,'unknown',proof,'MUSIC_OUTCOME_UNKNOWN');
  else if(['failed','blocked'].includes(state.state))record(submit,'failed',proof,state.reasons[0]??'MUSIC_BLOCKED');
 }
 let assets=service.list().stageAttempts.filter(a=>a.itemId===item.id&&a.stage==='music_assets').at(-1);
 const next=service.next({runId:run.id,itemId:item.id});
 if(!assets&&!run.stopRequested&&next?.stage==='music_assets'&&next.state==='ready'){
  const claimed=service.claim({runId:run.id,itemId:item.id,stage:'music_assets'});if('id'in claimed)assets=claimed;
 }
 if(assets){
  if(state.versions.length===2){
   const versions=state.versions.map((v:any)=>({version:v.version,assetId:v.assetId,externalId:v.providerSongId,sha256:v.sha256}));
   record(assets,'succeeded',{...proof,versions});
  }else if(state.state==='unknown')record(assets,'unknown',proof,'ORIGINAL_AUDIO_RECONCILIATION_REQUIRED');
  else if(['failed','blocked'].includes(state.state))record(assets,'failed',proof,state.reasons[0]??'ORIGINAL_DOWNLOAD_FAILED');
 }
 return true;
}
