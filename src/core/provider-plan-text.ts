import {planCreativeContext} from './generation-config';
import type {Repository} from './database';
import type {Studio} from './studio';
import type {PlanCenterRun,PlanCenterItem,PlanCenterStageAttempt} from '../shared/plan-center';
import {ProviderTextService,verifyProviderTextGeneration,verifyProviderTextProof} from './provider-text';
import {digest} from './plan-center/storage';
import {PlanCenterRunRecordSchema,PlanCenterItemSchema} from '../shared/plan-center';

const bindingKey=(itemId:string)=>'provider-plan:binding:'+itemId;
export function providerTextService(s:Pick<Studio,'repo'|'now'>){return new ProviderTextService(s.repo,{now:()=>s.now().toISOString(),recover:false});}

/** Resolves only the locally bound generation owner. A stage result is never a proof. */
export function providerPlanProof(repo:Repository,run:PlanCenterRun,item:PlanCenterItem,jobId:string,complete=true){
 const binding=repo.maybe('settings',bindingKey(item.id))?.value;
 const generation=typeof binding?.ownerKey==='string'?repo.maybe('settings','plan-center:stage:'+binding.ownerKey)?.value:null;
 if(run.snapshot.material.source!=='provider'||!binding||binding.jobId!==jobId||binding.runId!==run.id||binding.itemId!==item.id||binding.artistId!==run.snapshot.artistId||!generation||generation.runId!==run.id||generation.itemId!==item.id||generation.stage!=='text_generate')throw Error('PROVIDER_PLAN_SCOPE');
 const text=run.snapshot.text;
 if(!text.profileId||!text.profileRevision||!text.modelId)throw Error('PROVIDER_PLAN_PROFILE_REQUIRED');
 const expected={ownerKey:generation.id,runId:run.id,itemId:item.id,artistId:run.snapshot.artistId,profileId:text.profileId,profileRevision:text.profileRevision};
 const proof=(complete?verifyProviderTextProof:verifyProviderTextGeneration)(repo,jobId,expected);
 const job=proof.job;
 const brief=planCreativeContext(run.snapshot,item.ordinal);
 if(job.planId!==run.planId||job.planRevision!==run.planRevision||job.theme!==brief.theme||job.styleTemplate!==brief.styleTemplate||job.modelId!==text.modelId||job.threshold!==text.threshold||job.maxRewrites!==text.maxRewrites||job.maxScoreRetries!==text.maxScoreRetries||job.maxOutputTokens!==(text.maxOutputTokens??2048)||job.budgetMicros!==text.budgetMicros||!text.consent||!run.snapshot.authorization.text)throw Error('PROVIDER_PLAN_GRANT_MISMATCH');
 return proof;
}

export function providerPlanFinal(repo:Repository,run:PlanCenterRun,item:PlanCenterItem){
 const final=item.material?.finalRevision as Record<string,any>|undefined;
 if(!final||typeof final.providerJobId!=='string')throw Error('PROVIDER_FINAL_REQUIRED');
 const proof=providerPlanProof(repo,run,item,final.providerJobId),v=proof.version;
 if(final.draftId!==v.id||final.pairHash!==v.pairHash||final.proofHash!==proof.proofHash||final.lyrics!==v.pair.lyrics||final.musicPrompt!==v.pair.musicPrompt||final.title!==v.draft.title||digest(final.assessment)!==digest(v.score)||item.material?.finalDraftId!==v.id||item.material?.title!==v.draft.title||item.material?.lyrics!==v.pair.lyrics||item.material?.musicPrompt!==v.pair.musicPrompt)throw Error('PROVIDER_FINAL_CHANGED');
 const score=repo.all('settings').filter(r=>r.id.startsWith('plan-center:stage:')).map(r=>r.value).find(a=>a.itemId===item.id&&a.runId===run.id&&a.stage==='text_score'&&a.state==='succeeded');
 if(!score||score.result?.providerJobId!==proof.job.id||score.result?.evaluatedDraftId!==v.id||score.evidenceId!==proof.scoreOperation?.id||score.result?.proofHash!==proof.proofHash)throw Error('PROVIDER_SCORE_BINDING_CHANGED');
 return{...proof,scoreAttempt:score};
}

/** Provider proof is resolved from durable plan ownership, never a caller-supplied candidate. */
export function providerMusicSource(repo:Repository,parentRunId:string,itemId:string,providerJobId:string){
 const run=PlanCenterRunRecordSchema.parse(repo.maybe('settings','plan-center:run:'+parentRunId)?.value);
 const item=PlanCenterItemSchema.parse(repo.maybe('settings','plan-center:item:'+itemId)?.value);
 if(item.runId!==run.id||item.planId!==run.planId)throw Error('PROVIDER_MUSIC_PLAN_SCOPE');
 const proof=providerPlanFinal(repo,run,item),v=proof.version;
 if(proof.job.id!==providerJobId)throw Error('PROVIDER_MUSIC_JOB_SCOPE');
 const candidate={id:v.id,source:proof.job.providerId+'-api',method:'model',revision:proof.job.rewrites,parentCandidateId:v.pair.parentRevisionId,draft:v.draft,pair:v.pair,pairHash:v.pairHash,provenance:{providerJobId:proof.job.id,generationOperationId:proof.generationOperation.id,scoreOperationId:proof.scoreOperation!.id,providerModel:proof.job.modelId}};
 return{run,item,proof,candidate,score:{...v.score!,method:proof.job.providerId,operationId:proof.scoreOperation!.id},fingerprint:proof.proofHash};
}

export function stopProviderPlanText(s:Studio,runId:string){
 const service=providerTextService(s);
 for(const a of s.planCenterService().list().stageAttempts.filter(a=>a.runId===runId&&a.stage==='text_generate'))service.stop(a.id);
}

/** Local orchestration only. Main owns all provider credentials and network execution. */
export function tickProviderPlanText(s:Studio,run:PlanCenterRun,item:PlanCenterItem){
 if(run.snapshot.material.source!=='provider')return false;
 const center=s.planCenterService(),service=providerTextService(s);
 const attempts=()=>center.list().stageAttempts.filter(a=>a.runId===run.id&&a.itemId===item.id);
 const record=(a:PlanCenterStageAttempt,status:'succeeded'|'failed'|'unknown'|'waiting',result:Record<string,unknown>,evidenceId?:string,reason?:string)=>{
  if(['succeeded','failed','not_found'].includes(a.state))return;
  const input={attemptId:a.id,status,result,...(evidenceId?{evidenceId}:{}),...(reason?{reason}:{})};
  if(a.state==='unknown'&&(status==='succeeded'||status==='failed'))center.reconcile({...input,status,evidenceId:evidenceId??'provider-job:'+String(result.providerJobId)});else center.record(input);
 };
 let generation=attempts().find(a=>a.stage==='text_generate');
 if(run.stopRequested){
  if(!generation)return true;
  service.stop(generation.id);
  const binding=s.repo.maybe('settings',bindingKey(item.id))?.value;
  const job=binding?service.context(binding.jobId).job:null;
  for(const a of attempts().filter(a=>['text_generate','text_score'].includes(a.stage)&&['dispatching','waiting','unknown'].includes(a.state))){
   const unknown=job?.state==='unknown'||job?.state==='dispatching';
   record(a,unknown?'unknown':'failed',{providerJobId:job?.id??null},job?.operationId??undefined,unknown?'PROVIDER_OUTCOME_UNKNOWN':'PLAN_CENTER_STOPPED');
  }
  return true;
 }
 const next=center.next({runId:run.id,itemId:item.id});
 if(!next||!['text_generate','text_score'].includes(next.stage))return false;
 if(!generation){
  if(next.stage!=='text_generate')throw Error('PROVIDER_GENERATION_OWNER_REQUIRED');
  const claimed=center.claim({runId:run.id,itemId:item.id,stage:'text_generate'});if(!('id'in claimed))return true;generation=claimed;
 }
 if(['failed','not_found'].includes(generation.state))return true;
 const text=run.snapshot.text;
 let binding=s.repo.maybe('settings',bindingKey(item.id))?.value;
 if(!binding){
  if(generation.state==='unknown')generation=center.resumeUnsentProviderGeneration(generation.id);
  if(!run.snapshot.authorization.text||!text.consent)throw Error('TEXT_GRANT_REQUIRED');
  const ownerKey=generation.id;
  binding=s.repo.transaction(()=>{
   const job=service.prepare({ownerKey,runId:run.id,itemId:item.id,artistId:run.snapshot.artistId,profileId:text.profileId!,profileRevision:text.profileRevision!,modelId:text.modelId!,budgetMicros:text.budgetMicros!,maxOutputTokens:text.maxOutputTokens??2048,...planCreativeContext(run.snapshot,item.ordinal),threshold:text.threshold,maxRewrites:text.maxRewrites,maxScoreRetries:text.maxScoreRetries,consent:true});
   const value={jobId:job.id,ownerKey,runId:run.id,itemId:item.id,artistId:run.snapshot.artistId};
   s.repo.save('settings',{id:bindingKey(item.id),value});return value;
  });
 }
 const job=service.context(binding.jobId).job;
 if(generation.state==='unknown'&&job.state==='ready'&&job.phase==='generate'&&!job.operations.length)generation=center.resumeUnsentProviderGeneration(generation.id);
 if(job.draft&&job.versions.length){
  const proof=providerPlanProof(s.repo,run,item,job.id,false);
  if(generation.state!=='succeeded')record(generation,'succeeded',{source:'provider',providerJobId:job.id,draftId:proof.version.id,pairHash:proof.version.pairHash},proof.generationOperation.id);
 }
 let score=attempts().find(a=>a.stage==='text_score');
 if(!score&&center.next({runId:run.id,itemId:item.id})?.stage==='text_score'){
  const claimed=center.claim({runId:run.id,itemId:item.id,stage:'text_score'});if('id'in claimed)score=claimed;
 }
 const current=score??generation;
 if(job.state==='complete'){
  if(!score)throw Error('PROVIDER_SCORE_OWNER_REQUIRED');
  const proof=providerPlanProof(s.repo,run,item,job.id),v=proof.version;
  record(score,'succeeded',{source:'model',providerJobId:job.id,evaluatedDraftId:v.id,score:v.score!.overall,assessment:v.score,proofHash:proof.proofHash,rewriteCount:job.versions.length-1},proof.scoreOperation!.id);
 }else if(job.state==='unknown')record(current,'unknown',{providerJobId:job.id},job.operationId??undefined,'PROVIDER_OUTCOME_UNKNOWN');
 else if(['blocked','rejected','stopped'].includes(job.state))record(current,'failed',{providerJobId:job.id},job.operationId??undefined,job.reason??'PROVIDER_TEXT_BLOCKED');
 return true;
}

/** Preserve the verified lyrics-only result as a library draft; no audio is implied. */
export function materializeProviderTextFinal(s:Studio,run:PlanCenterRun,item:PlanCenterItem){
 if(!run.snapshot.routing||run.snapshot.material.source!=='provider'||run.snapshot.outputs.cover||run.snapshot.outputs.music)return item.workId;
 return s.repo.transaction(()=>{const current=s.planCenterService().list().items.find(i=>i.id===item.id);if(!current||current.runId!==run.id)throw Error('PROVIDER_PLAN_SCOPE');if(current.workId)return current.workId;if(run.stopRequested)throw Error('STOP_REQUESTED');const proof=providerPlanFinal(s.repo,run,current),v=proof.version;const work=s.saveWork({artistId:run.snapshot.artistId,title:v.draft.title,lyrics:v.pair.lyrics,prompt:v.pair.musicPrompt,story:run.snapshot.storyContext?.storyBeat??run.snapshot.theme,parameters:run.snapshot.artistSnapshot?.defaults??{},rights:'待人工确认授权',ai:'generated'},{kind:'generation_input'});s.save('works',{...work,artistSnapshot:run.snapshot.artistSnapshot,storyContext:run.snapshot.storyContext,routeSnapshot:run.snapshot.routeSnapshot});s.planCenterService().bindWork({itemId:item.id,workId:work.id,versions:[]});s.repo.audit('providerPlan.textWork.created',work.id,{providerJobId:proof.job.id,finalDraftId:v.id,runId:run.id,itemId:item.id,audioGenerated:false});return work.id;});
}
