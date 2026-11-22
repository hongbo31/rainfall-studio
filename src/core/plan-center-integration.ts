import {z} from 'zod';
import type {Studio} from './studio';
import {PlanCenterService} from './plan-center';
import {CenterStore} from './plan-center/storage';
import {preparePlanCoverWork,assertPlanCoverWork} from './plan-cover-work';
import {planCatalog} from './plan-center-catalog';
import {readPlanDashboard,readPlanHistory,readPlanRunDetail,readPlanExecutionStatus} from './plan-center-reads';
import {syncPlanDot,planDotStatus,exportPlanDotRequests,exportPlanDotBridge} from './plan-center-dot';
import {syncPlanPublications,planPublicationStatus,planPublicationCapabilities} from './plan-center-publication';
import {bindPlanWork,selectPlanVersion,confirmPlanMaterials,planAssetsCatalog,planMaterialPreview,syncPlanMaterials,adoptPlanIncomingCover} from './plan-center-assets';
import {syncPlanMusic,stopPlanMusic,planMusicExternalOutcome} from './plan-center-music';
import {tickPlanMusic} from './plan-center-music-stages';
import {syncPlanFanqie,planFanqieJobs,retryPlanFanqieBatch} from './plan-fanqie';
import {planFanqieDirectoryAction} from './plan-fanqie-directory';
import {coverInboxStatus,preparePlanCoverInbox,versionBCoverRequired} from './cover-inbox';
import type {CoverVariant} from '../shared/cover-handoff';
import {tickProviderPlanText,stopProviderPlanText,materializeProviderTextFinal} from './provider-plan-text';
import {materializeCreationTaskWork} from './creation-tasks';
import {tickPlanLyrics} from './plan-workflow';
import {syncWorkflowPublications} from './plan-workflow-publication';
import {requestPlanPuleRecovery} from './plan-pule';
import {archivePlanWorkDownloads,preparePlanDownloads} from './download-archive';
import {PlanCenterCatalogSchema,PlanCenterSaveSchema,PlanCenterDeleteSchema,PlanCenterIdSchema,PlanCenterRunSchema,PlanCenterStopSchema,PlanCenterRetrySchema} from '../shared/plan-center';
import type {PlanCenterRun,PlanCenterStageAttempt} from '../shared/plan-center';
import {isLocalPublicationWorkflow} from '../shared/plan-workflow-graph';
const isAttempt=(value:unknown):value is PlanCenterStageAttempt=>!!value&&typeof (value as any).id==='string';
function localAttempt(s:Studio,runId:string,itemId:string,stage:'cover'|'materials',next:{state:string;attemptId?:string},execute:(attempt:PlanCenterStageAttempt)=>void){
 return s.repo.transaction(()=>{
  const service=s.planCenterService(),rows=service.list(),run=rows.runs.find(r=>r.id===runId),item=rows.items.find(i=>i.id===itemId);
  if(!run||!item||item.runId!==run.id||run.stopRequested||['completed','stopped','failed'].includes(run.state))return null;
  const current=service.next({runId,itemId});if(!current||current.stage!==stage||current.state!==next.state)return null;
  const attempt=next.state==='ready'?service.claim({runId,itemId,stage}):rows.stageAttempts.filter(a=>a.itemId===itemId&&a.stage===stage).at(-1);
  if(!isAttempt(attempt)||!['dispatching',...(stage==='cover'?['waiting']:[])].includes(attempt.state)||attempt.runId!==runId||attempt.itemId!==itemId||attempt.stage!==stage||(next.state!=='ready'&&(attempt.id!==next.attemptId||current.attemptId!==attempt.id)))return null;
  try{execute(attempt);}catch(error){service.record({attemptId:attempt.id,status:'failed',reason:error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'LOCAL_STAGE_FAILED'});}
  return attempt;
 });
}

export function createPlanCenterService(s:Studio){
 const service=new PlanCenterService(s.repo,{now:s.now,
  prepareDownloads:s.mode==='production'?plan=>preparePlanDownloads(s.repo,plan):undefined,capabilities:{
   text:{available:s.mode==='production',reason:s.mode==='production'?undefined:'PRODUCTION_REQUIRED'},
   cover:{available:true},
   dot:{available:false,reason:'DOT_EXTERNAL_TRIGGER_UNAVAILABLE'},
   music:{available:s.mode==='production',reason:s.mode==='production'?undefined:'PRODUCTION_REQUIRED'},
   publication:planPublicationCapabilities(s).publication,
   albumCatalog:{available:false,reason:'ALBUM_CATALOG_INTEGRATION_UNAVAILABLE'},
   albumCreate:{available:false,reason:'ALBUM_CREATE_INTEGRATION_UNAVAILABLE'},
   albumAppend:{available:false,reason:'ALBUM_APPEND_INTEGRATION_UNVERIFIED'},
 }});
 if(!new CenterStore(s.repo).all('migration').length)service.migrateLegacy();
 return service;
}

const empty=z.strictObject({});
function stopPlanWork(s:Studio,run:PlanCenterRun){
 const service=s.planCenterService();
 stopProviderPlanText(s,run.id);
 const rows=service.list();
 for(const item of rows.items.filter(i=>i.runId===run.id)){
  const attempt=rows.stageAttempts.find(a=>a.itemId===item.id&&a.stage==='lyric_write'&&['dispatching','waiting','unknown'].includes(a.state));
  if(attempt)tickPlanLyrics(s,run,item,{state:attempt.state,attemptId:attempt.id});
 }
 for(const item of service.list().items.filter(i=>i.runId===run.id))stopPlanMusic(s,run,item);
 for(const attempt of service.list().stageAttempts.filter(a=>a.runId===run.id&&a.stage==='text_score'))
  s.productionFlowService().stopManagedInboxEvaluation(attempt.id);
}

export function stopPlanExecution(s:Studio,runId:string){
 const result=s.planCenterService().stop({runId});
 if(result.stopRequested&&result.state==='stopped')stopPlanWork(s,result);
 return new CenterStore(s.repo).get('run',runId)??result;
}

export function executePlanCenter(s:Studio,method:string,raw:unknown){
 const service=s.planCenterService();
 switch(method){
  case 'planCenter.list':empty.parse(raw);return service.list();
  case 'planCenter.dashboard':empty.parse(raw);return readPlanDashboard(new CenterStore(s.repo));
  case 'planCenter.history':return readPlanHistory(new CenterStore(s.repo),PlanCenterIdSchema.parse(raw).id);
  case 'planCenter.runDetail':return readPlanRunDetail(s,new CenterStore(s.repo),PlanCenterStopSchema.parse(raw).runId);
  case 'planCenter.read':return service.read(PlanCenterIdSchema.parse(raw));
  case 'planCenter.catalog':{
   const {includeWorks}=PlanCenterCatalogSchema.parse(raw);
   return{...planCatalog(s.repo),works:includeWorks?planAssetsCatalog(s):[]};
  }
  case 'planCenter.status':{
   empty.parse(raw);const rows=service.list();
   return readPlanExecutionStatus(s,rows.runs,rows.items);
  }
  case 'planCenter.fanqieStatus':empty.parse(raw);return planFanqieJobs(s);
  case 'planCenter.retryFanqie':return retryPlanFanqieBatch(s,raw);
  case 'planCenter.retryFanqieDirectory':return planFanqieDirectoryAction(s,'retry',raw);
  case 'planCenter.dotStatus':empty.parse(raw);return planDotStatus(s);
  case 'planCenter.exportDotRequests':empty.parse(raw);return exportPlanDotRequests(s);
  case 'planCenter.publicationStatus':empty.parse(raw);return planPublicationStatus(s);
  case 'planCenter.bindWork':return bindPlanWork(s,raw);
  case 'planCenter.prepareCoverWork':return preparePlanCoverWork(s,raw);
  case 'planCenter.selectVersion':return selectPlanVersion(s,raw);
  case 'planCenter.confirmMaterials':return confirmPlanMaterials(s,raw);
  case 'planCenter.materialPreview':return planMaterialPreview(s,PlanCenterIdSchema.parse(raw).id);
  case 'planCenter.musicStatus':{const rows=service.list();return rows.items.flatMap<Record<string,unknown>>(item=>{const run=rows.runs.find(r=>r.id===item.runId)!;const state=syncPlanMusic(s,run,item);return state?[{itemId:item.id,...state}]:[]});}
  case 'planCenter.save':{
   const {plan,expectedRevision}=PlanCenterSaveSchema.parse(raw);
   return service.save({plan:{...plan,enabled:false},expectedRevision});
  }
  case 'planCenter.delete':return service.delete(PlanCenterDeleteSchema.parse(raw),run=>stopPlanWork(s,run));
  case 'planCenter.preview':return service.preview(PlanCenterIdSchema.parse(raw));
  case 'planCenter.run':{
   const input=PlanCenterRunSchema.parse(raw);
   if(s.mode!=='production'&&isLocalPublicationWorkflow(service.read({id:input.id}).workflow?.graph))throw Error('PRODUCTION_REQUIRED');
   return service.run(input);
  }
  case 'planCenter.checkMusicReceipt':return requestPlanPuleRecovery(s,PlanCenterRetrySchema.parse(raw).attemptId,'graph');
  case 'planCenter.stop':{
   const {runId}=PlanCenterStopSchema.parse(raw);
   if(new CenterStore(s.repo).get('run',runId)?.source==='publication_task')throw Error('PLAN_TASK_OWNED_RUN');
   return stopPlanExecution(s,runId);
  }
  case 'planCenter.retry':{
   const input=PlanCenterRetrySchema.parse(raw);
   return s.repo.transaction(()=>{
    const rows=service.list(),attempt=rows.stageAttempts.find(a=>a.id===input.attemptId);
    if(attempt?.stage==='text_score'&&typeof attempt.result?.evaluationRunId==='string'){
     const owner=rows.runs.find(r=>r.id===attempt.runId);
     if(owner?.stopRequested)throw Error('STOP_REQUESTED');
     if(!['failed','not_found'].includes(attempt.state))throw Error('RECONCILE_REQUIRED');
     const flow=s.productionFlowService(),child=flow.context(attempt.result.evaluationRunId).run;
     if(!child.plan.managedByPlanCenter||child.plan.managedOwnerKey!==attempt.id)throw Error('MANAGED_SCORE_SCOPE');
     flow.retry({id:child.id,expectedRevision:child.revision});
    }
    if(attempt&&['music_submit','music_assets'].includes(attempt.stage)&&typeof attempt.result?.childRunId==='string'){const flow=s.productionFlowService(),child=flow.context(attempt.result.childRunId).run;if(child.state==='unknown')throw Error('RECONCILE_REQUIRED');if(['blocked','failed'].includes(child.state))flow.retry({id:child.id,expectedRevision:child.revision});}
    return service.retry(input);
   });
  }
  case 'planCenter.rollbackMigration':empty.parse(raw);return service.rollbackMigration();
  case 'planCenter.legacyHistory':{
   const {id}=PlanCenterIdSchema.parse(raw);return service.list().migration?.entries.find(e=>e.planId===id)?.history??{};
  }
  default:throw Error('METHOD_NOT_ALLOWED');
 }
}

/** Local orchestration only. Real text HTTP is still exclusively owned by Main's existing broker. */
export function tickPlanCenter(s:Studio){
 const service=s.planCenterService();syncPlanDot(s);exportPlanDotBridge(s);
 const rows=service.list();
 for(const run of rows.runs.filter(r=>!['completed','failed'].includes(r.state))){
  const creation=run.snapshot.material.source==='creation',customCreation=creation||!!run.snapshot.workflow;
  const items=rows.items.filter(i=>i.runId===run.id);
  for(const item of items){
   try{
   if(run.stopRequested){
    stopProviderPlanText(s,run.id);
    const lyrics=rows.stageAttempts.find(a=>a.itemId===item.id&&a.stage==='lyric_write'&&['dispatching','waiting','unknown'].includes(a.state));
    if(lyrics)tickPlanLyrics(s,run,item,{state:lyrics.state,attemptId:lyrics.id});
    for(const a of rows.stageAttempts.filter(a=>a.itemId===item.id&&a.stage==='text_score'))
      s.productionFlowService().stopManagedInboxEvaluation(a.id);
   }
   const boundItem=service.list().items.find(i=>i.id===item.id)!;
   const imported=typeof boundItem.material?.candidateId==='string'?s.repo.maybe('textCandidates',boundItem.material.candidateId):undefined;
   if(run.snapshot.material.source==='provider'&&tickProviderPlanText(s,run,boundItem)&&!run.stopRequested)continue;
   if(run.stopRequested){try{tickPlanMusic(s,run,boundItem);}catch{/* Existing receipt remains persisted for reconciliation. */}}
   if(!customCreation&&!run.stopRequested&&boundItem.workId&&(run.snapshot.outputs.music||run.snapshot.authorization.publish)){try{syncPlanMaterials(s,run,boundItem);}catch{/* Stale material never becomes a submission. */}}
   const outstandingScore=rows.stageAttempts.filter(a=>a.itemId===item.id&&a.stage==='text_score'&&['dispatching','waiting','unknown'].includes(a.state)).at(-1);
   const next=service.next({runId:run.id,itemId:item.id})??(run.stopRequested&&outstandingScore?{stage:'text_score' as const,state:outstandingScore.state}:null);
   if(!next)continue;
   // Audio and lyrics are already available while the cover is still in progress.
   if(!run.stopRequested&&boundItem.workId&&next.stage!=='materials'&&
      (next.stage==='cover'||!run.snapshot.workflow?.graph)){
    try{archivePlanWorkDownloads(s,run,boundItem.workId);}catch{/* The materials stage records archive failures. */}
   }
   if(['music_submit','music_assets'].includes(next.stage)){
    if(!customCreation&&run.snapshot.material.source!=='pule_prompt'&&run.snapshot.songType!=='instrumental')tickPlanMusic(s,run,boundItem);
    continue;
   }
   if(next.stage==='lyric_write'&&next.state!=='blocked'){
    tickPlanLyrics(s,run,boundItem,next);
    continue;
   }
   if(next.stage==='text_score'){
    const existing=service.list().stageAttempts.filter(a=>a.itemId===item.id&&a.stage==='text_score').at(-1);
    if(run.stopRequested&&!existing)continue;
    const attempt=existing??service.claim({runId:run.id,itemId:item.id,stage:'text_score'});
    if(!isAttempt(attempt)||!imported)continue;
    // Only this exact trusted imported candidate can be scored. Never generate replacement Work content.
    try{
     const evaluation=s.productionFlowService().startManagedInboxEvaluation({
       ownerKey:attempt.id,budgetScope:'unified-plan:'+run.planId,candidateId:imported.id,artistId:run.snapshot.artistId,
       text:{profileId:run.snapshot.text.profileId,profileRevision:run.snapshot.text.profileRevision,
         modelId:run.snapshot.text.modelId,maxOutputTokens:run.snapshot.text.maxOutputTokens??2048,
         budgetMicros:run.snapshot.text.budgetMicros,consent:run.snapshot.authorization.text&&run.snapshot.text.consent},
       threshold:run.snapshot.text.threshold,maxRevisions:run.snapshot.text.maxRewrites,maxScoreRetries:run.snapshot.text.maxScoreRetries,
     });
     if(run.stopRequested)s.productionFlowService().stopManagedInboxEvaluation(attempt.id);
     const result={evaluationRunId:evaluation.id,candidateId:imported.id};
     if(evaluation.state==='completed'&&evaluation.score?.source==='model-scored'&&evaluation.score.passed){
       const proof={...result,source:'model',score:evaluation.score.overall,assessment:evaluation.score,
         evaluatedDraftId:evaluation.candidate.id,rewriteCount:evaluation.revisionCount,
         evaluatedMaterial:{draftId:evaluation.candidate.id,title:evaluation.candidate.draft.title,
           lyrics:evaluation.candidate.pair.lyrics,musicPrompt:evaluation.candidate.pair.musicPrompt,pairHash:evaluation.candidate.pairHash}};
       const record={attemptId:attempt.id,status:'succeeded' as const,evidenceId:evaluation.score.operationId??evaluation.id,result:proof};
       if(attempt.state==='unknown')service.reconcile({...record,status:'succeeded'});else service.record(record);
     }else if(evaluation.state==='unknown'){
       if(attempt.state!=='unknown')service.record({attemptId:attempt.id,status:'unknown',externalTaskId:evaluation.operationId??evaluation.id,reason:'TEXT_OUTCOME_UNKNOWN',result});
     }else if(evaluation.state==='failed'||evaluation.state==='blocked'){
       if(attempt.state==='dispatching'||attempt.state==='waiting')service.record({attemptId:attempt.id,status:'failed',evidenceId:evaluation.id,reason:evaluation.reasons.join(','),result});
     }
    }catch(e:any){if(attempt.state==='dispatching')service.record({attemptId:attempt.id,status:'failed',reason:/^[A-Z0-9_]+$/.test(e.message)?e.message:'TEXT_CONFIGURATION_REQUIRED'});}
   }else if(next.stage==='cover'&&['ready','dispatching','waiting'].includes(next.state)&&(customCreation||imported||boundItem.workId||run.snapshot.material.source==='provider')){
    if(run.snapshot.material.source==='provider'&&!boundItem.workId&&!run.snapshot.outputs.music){
     const final=boundItem.material?.finalRevision as any;
     if(!final)throw Error('PROVIDER_FINAL_REQUIRED');
     preparePlanCoverWork(s,{itemId:item.id,expectedFinalDraftId:final.draftId,expectedFinalPairHash:final.pairHash});
    }
    const score=service.list().stageAttempts.filter(a=>a.itemId===item.id&&a.stage==='text_score'&&a.state==='succeeded').at(-1);
    localAttempt(s,run.id,item.id,'cover',next,attempt=>{
    if(creation)materializeCreationTaskWork(s,run,boundItem);
    const latestItem=service.list().items.find(i=>i.id===item.id)!;
    const boundWork=latestItem.workId?s.repo.maybe('works',latestItem.workId):null;
    const boundCover=boundWork?.assets?.cover?s.repo.maybe('assets',boundWork.assets.cover):null;
    if(boundWork&&versionBCoverRequired(run.snapshot,boundWork)){
     const needsPrimary=!!boundWork.assets.audio_A;
     const alternate=boundWork.assets.cover_B?s.repo.maybe('assets',boundWork.assets.cover_B):null;
     if(needsPrimary&&!boundCover)preparePlanCoverInbox(s,latestItem.id,boundWork.id,true);
     if(!alternate)preparePlanCoverInbox(s,latestItem.id,boundWork.id,true,'B');
     if((needsPrimary&&!boundCover)||!alternate||(needsPrimary&&boundCover?.sha256===alternate.sha256)){
      if(attempt.state!=='waiting'||attempt.reason!=='COVER_REQUIRED')service.record({attemptId:attempt.id,status:'waiting',reason:'COVER_REQUIRED'});
      return;
     }
     const inbox=coverInboxStatus(s,boundWork.id);
     const evidence=(asset:NonNullable<typeof boundCover>,variant?:CoverVariant)=>{
      if(asset.kind!=='image')throw Error('ASSET_ROLE');
      s.locate(asset.id);
      const result={assetId:asset.id,sha256:asset.sha256};
      if(!inbox.some(entry=>entry.planItemId===latestItem.id&&entry.variant===variant&&entry.assetId===asset.id))
       return {...result,source:'user-import-final-cover',generationVerified:false};
      const {receipt,request}=s.coverHandoff().verifiedSelectedReceipt(boundWork.id,asset.id,variant);
      return {...result,receiptId:receipt.id,requestId:request.id,contextHash:request.contextHash,
       source:receipt.generationVerified?'image-api':'user-import-final-cover',generationVerified:receipt.generationVerified};
     };
     const a=needsPrimary&&boundCover?evidence(boundCover):null,b=evidence(alternate,'B');
     const primary=a??b;
     service.record({attemptId:attempt.id,status:'succeeded',evidenceId:primary.assetId,
      result:{...primary,generationVerified:primary.generationVerified&&b.generationVerified,covers:{...(a?{A:a}:{}),B:b}}});
     return;
    }
    if(boundWork&&!boundCover)preparePlanCoverInbox(s,latestItem.id,boundWork.id,customCreation||['provider','pule_prompt'].includes(run.snapshot.material.source));
    if(latestItem.workId&&s.repo.maybe('settings','plan-cover-work:'+latestItem.id)){
     const binding=assertPlanCoverWork(s,latestItem.workId)!;
     let proof;
     try{proof=s.coverHandoff().verifiedSelectedReceipt(latestItem.workId);}catch(error){
      if(run.snapshot.material.source==='provider'&&!boundWork?.assets?.cover){service.record({attemptId:attempt.id,status:'waiting',reason:'COVER_REQUIRED'});return;}
      throw error;
     }
     service.record({attemptId:attempt.id,status:'succeeded',evidenceId:proof.receipt.id,result:{assetId:proof.asset.id,sha256:proof.asset.sha256,requestId:proof.request.id,receiptId:proof.receipt.id,contextHash:proof.request.contextHash,finalPairHash:binding.finalPairHash,source:proof.receipt.generationVerified?'image-api':'user-import-final-cover',generationVerified:proof.receipt.generationVerified}});return;
    }
    if(boundCover){
     s.locate(boundCover.id);
     let source='user-bound-existing-work',generationVerified=false;
     if(customCreation||run.snapshot.material.source==='pule_prompt'||run.snapshot.songType==='instrumental'||run.snapshot.distinctLyrics){
      source=typeof boundWork?.coverSource==='string'?boundWork.coverSource:'user-import-final-cover';
      const inbox=coverInboxStatus(s,latestItem.workId).find(entry=>entry.planItemId===latestItem.id&&entry.assetId===boundCover.id);
      if(inbox||run.snapshot.songType==='instrumental'||run.snapshot.distinctLyrics){
       const proof=s.coverHandoff().verifiedSelectedReceipt(latestItem.workId!);
       generationVerified=proof.receipt.generationVerified;
       source=generationVerified?'image-api':'user-import-final-cover';
      }
     }
     service.record({attemptId:attempt.id,status:'succeeded',evidenceId:boundCover.id,result:{assetId:boundCover.id,sha256:boundCover.sha256,source,generationVerified}});return;
    }
    const asset=imported?.cover?.assetId?s.repo.maybe('assets',imported.cover.assetId):null;
    if(score?.result?.rewriteCount)service.record({attemptId:attempt.id,status:'failed',reason:'COVER_REFRESH_REQUIRED'});
    else if(asset&&asset.sha256===imported?.cover?.sha256){
     try{if(boundItem.workId)adoptPlanIncomingCover(s,run,boundItem,Number(score?.result?.rewriteCount??0));else s.locate(asset.id);service.record({attemptId:attempt.id,status:'succeeded',evidenceId:asset.id,result:{assetId:asset.id,sha256:asset.sha256,source:'verified-local-inbox'}});}
     catch(e){service.record({attemptId:attempt.id,status:'failed',reason:e instanceof Error?e.message:'COVER_REQUIRED'});}
    }
    else if(attempt.state!=='waiting'||attempt.reason!=='COVER_REQUIRED')
     service.record({attemptId:attempt.id,status:customCreation||['provider','pule_prompt'].includes(run.snapshot.material.source)?'waiting':'failed',reason:'COVER_REQUIRED'});
    });
   }else if(next.stage==='materials'&&['ready','dispatching'].includes(next.state)){
    materializeProviderTextFinal(s,run,service.list().items.find(i=>i.id===item.id)!);
    if(!customCreation&&(run.snapshot.outputs.music||run.snapshot.authorization.publish)){const material=syncPlanMaterials(s,run,service.list().items.find(i=>i.id===item.id)!);if(!material.ready)continue;}
    localAttempt(s,run.id,item.id,'materials',next,attempt=>{
     if(creation)materializeCreationTaskWork(s,run,boundItem);
     const current=service.list().items.find(i=>i.id===item.id)!;
     if(current.workId&&s.repo.maybe('settings','plan-cover-work:'+current.id)){
      const binding=assertPlanCoverWork(s,current.workId)!,proof=s.coverHandoff().verifiedSelectedReceipt(current.workId);
      const cover=service.list().stageAttempts.filter(a=>a.itemId===item.id&&a.stage==='cover'&&a.state==='succeeded').at(-1);
      const completed=cover?.result;
      if(!completed||completed.assetId!==proof.asset.id||completed.sha256!==proof.asset.sha256||completed.receiptId!==proof.receipt.id||completed.contextHash!==proof.request.contextHash||completed.finalPairHash!==binding.finalPairHash)throw Error('COVER_MATERIAL_CHANGED');
     }
     if(run.snapshot.workflow?.graph){
      const work=current.workId?s.repo.maybe('works',current.workId):undefined;
      const expected=run.snapshot.workflowSnapshot?.secondSinger?2:1;
      const recordings=['A','B'].filter(version=>work?.assets?.['audio_'+version]);
      if(recordings.length!==expected||current.versions.length!==expected||
       current.versions.some(version=>work?.assets?.['audio_'+version.version]!==version.assetId))
       throw Error('WORKFLOW_ARCHIVE_RECORDINGS_CHANGED');
     }
     if(current.workId)archivePlanWorkDownloads(s,run,current.workId,!!run.snapshot.workflow?.graph);
     service.record({attemptId:attempt.id,status:'succeeded',evidenceId:'local-materials:'+attempt.id,result:{prepared:true,submitted:false}});
    });
   }else if(!run.stopRequested&&next.state!=='dispatching'&&next.state!=='unknown'){
    // Persist a capability/configuration blocker, rather than an unexplained perpetual pending state.
    service.claim({runId:run.id,itemId:item.id,stage:next.stage});
   }
   }catch(error){
    // A damaged or edited item must never starve unrelated plans or receipt collection.
    // Unknown external outcomes remain unknown, and retries retain their child owner.
    const reason=error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'PLAN_ITEM_INTEGRATION_FAILED';
    const attempt=service.list().stageAttempts.filter(a=>a.itemId===item.id&&['dispatching','waiting'].includes(a.state)).at(-1);
    if(attempt&&!run.stopRequested){
     let unknown=false,operationId:string|null=null;
     if(['music_submit','music_assets'].includes(attempt.stage)&&typeof attempt.result?.childRunId==='string'){
      try{const outcome=planMusicExternalOutcome(s,run,item);unknown=!outcome||outcome.childRunId!==attempt.result.childRunId||outcome.unknown;if(outcome?.childRunId===attempt.result.childRunId)operationId=outcome.operationId;}catch{unknown=true;}
     }
     service.record({attemptId:attempt.id,status:unknown?'unknown':'failed',reason:unknown?'MUSIC_OUTCOME_UNKNOWN':reason,...(operationId?{externalTaskId:operationId}:{}),result:{...attempt.result,...(operationId?{operationId}:{}),integrationError:reason}});
    }
   }
  }
 }
 syncPlanPublications(s);
 syncPlanFanqie(s);
 syncWorkflowPublications(s);
}
