import {z} from 'zod';
import type {Studio} from './studio';
import {PlanCenterService} from './plan-center';
import {planCatalog} from './plan-center-catalog';
import {PlanCenterSaveSchema,PlanCenterToggleSchema,PlanCenterIdSchema,PlanCenterRunSchema,PlanCenterStopSchema,PlanCenterRetrySchema} from '../shared/plan-center';
import type {PlanCenterStageAttempt} from '../shared/plan-center';
const isAttempt=(value:unknown):value is PlanCenterStageAttempt=>!!value&&typeof (value as any).id==='string';

export function createPlanCenterService(s:Studio){
 const service=new PlanCenterService(s.repo,{now:s.now,capabilities:{
   text:{available:s.mode==='production',reason:s.mode==='production'?undefined:'PRODUCTION_REQUIRED'},
   cover:{available:true},
   dot:{available:false,reason:'DOT_EXTERNAL_TRIGGER_UNAVAILABLE'},
   music:{available:false,reason:'LIVE_MODEL_CATALOG_REQUIRED'},
   publication:{available:false,reason:'PUBLICATION_EXECUTOR_UNAVAILABLE'},
   albumCatalog:{available:false,reason:'ALBUM_CATALOG_INTEGRATION_UNAVAILABLE'},
   albumCreate:{available:false,reason:'ALBUM_CREATE_INTEGRATION_UNAVAILABLE'},
   albumAppend:{available:false,reason:'ALBUM_APPEND_INTEGRATION_UNVERIFIED'},
 }});
 if(!service.list().migration)service.migrateLegacy();
 return service;
}

const empty=z.strictObject({});
export function executePlanCenter(s:Studio,method:string,raw:unknown){
 const service=s.planCenterService();
 switch(method){
  case 'planCenter.list':empty.parse(raw);return service.list();
  case 'planCenter.catalog':empty.parse(raw);return planCatalog(s.repo);
  case 'planCenter.save':return service.save(PlanCenterSaveSchema.parse(raw));
  case 'planCenter.toggle':return service.toggle(PlanCenterToggleSchema.parse(raw));
  case 'planCenter.preview':return service.preview(PlanCenterIdSchema.parse(raw));
  case 'planCenter.run':return service.run(PlanCenterRunSchema.parse(raw));
  case 'planCenter.stop':{
   const input=PlanCenterStopSchema.parse(raw),result=service.stop(input);
   for(const a of service.list().stageAttempts.filter(a=>a.runId===input.runId&&a.stage==='text_score'))
    s.productionFlowService().stopManagedInboxEvaluation(a.id);
   return result;
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
 const service=s.planCenterService();service.tick();
 const rows=service.list();
 for(const run of rows.runs.filter(r=>!['completed','failed','stopped'].includes(r.state))){
  const items=rows.items.filter(i=>i.runId===run.id);
  for(const item of items){
   if(run.stopRequested){
    for(const a of rows.stageAttempts.filter(a=>a.itemId===item.id&&a.stage==='text_score'))
      s.productionFlowService().stopManagedInboxEvaluation(a.id);
   }
   const boundItem=service.list().items.find(i=>i.id===item.id)!;
   const boundId=boundItem.material?.candidateId;
   const imported=typeof boundId==='string'?s.repo.maybe('textCandidates',boundId)
     :s.repo.all('textCandidates').find(c=>c.externalItemId===item.expectedExternalItemId&&c.artistId===run.snapshot.artistId&&c.isCurrent);
   if(imported&&!boundId&&!run.stopRequested){try{service.attachDot({itemId:item.id,candidateId:imported.id})}catch{/* A mismatched/changed delivery remains visible and never becomes an execution input. */}}
   const outstandingScore=rows.stageAttempts.filter(a=>a.itemId===item.id&&a.stage==='text_score'&&['dispatching','waiting','unknown'].includes(a.state)).at(-1);
   const next=service.next({runId:run.id,itemId:item.id})??(run.stopRequested&&outstandingScore?{stage:'text_score' as const,state:outstandingScore.state}:null);
   if(!next)continue;
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
   }else if(next.stage==='cover'&&next.state==='ready'&&imported){
    const score=service.list().stageAttempts.filter(a=>a.itemId===item.id&&a.stage==='text_score'&&a.state==='succeeded').at(-1);
    const attempt=service.claim({runId:run.id,itemId:item.id,stage:'cover'});
    if(!isAttempt(attempt))continue;
    const asset=imported.cover?.assetId?s.repo.maybe('assets',imported.cover.assetId):null;
    if(score?.result?.rewriteCount)service.record({attemptId:attempt.id,status:'failed',reason:'COVER_REFRESH_REQUIRED'});
    else if(asset&&asset.sha256===imported.cover?.sha256)service.record({attemptId:attempt.id,status:'succeeded',evidenceId:asset.id,result:{assetId:asset.id,sha256:asset.sha256,source:'verified-local-inbox'}});
    else service.record({attemptId:attempt.id,status:'failed',reason:'COVER_REQUIRED'});
   }else if(next.stage==='materials'&&next.state==='ready'){
    const attempt=service.claim({runId:run.id,itemId:item.id,stage:'materials'});
    if(isAttempt(attempt))service.record({attemptId:attempt.id,status:'succeeded',evidenceId:'local-materials:'+attempt.id,result:{prepared:true,submitted:false}});
   }else if(!run.stopRequested&&next.state!=='dispatching'&&next.state!=='unknown'){
    // Persist a capability/configuration blocker, rather than an unexplained perpetual pending state.
    service.claim({runId:run.id,itemId:item.id,stage:next.stage});
   }
  }
 }
}
