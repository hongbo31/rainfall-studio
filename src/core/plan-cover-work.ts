import {z} from 'zod';
import type {Studio} from './studio';
import {hash} from './database';
import {pairHash} from './quality/scoring';
import {PlanCenterPrepareCoverWorkSchema} from '../shared/plan-center';
import {providerPlanFinal} from './provider-plan-text';

const bindingSchema=z.strictObject({runId:z.string(),itemId:z.string(),artistId:z.string(),workId:z.uuid(),finalDraftId:z.string(),finalPairHash:z.string(),rawLyricsHash:z.string(),titleHash:z.string(),scoreAttemptId:z.string(),sourceCandidateId:z.string(),sourceCoverSha256:z.string().optional(),createdAt:z.string(),source:z.literal('plan-final-cover')});
const key=(itemId:string)=>'plan-cover-work:'+itemId;
function finalScope(s:Studio,itemId:string){
 const rows=s.planCenterService().list(),item=rows.items.find(i=>i.id===itemId),run=rows.runs.find(r=>r.id===item?.runId);
 if(!item||!run)throw Error('NOT_FOUND');
 if(run.stopRequested)throw Error('STOP_REQUESTED');
 if(['completed','failed','stopped'].includes(run.state))throw Error('RUN_TERMINAL');
 if(!run.snapshot.outputs.cover||run.snapshot.outputs.music)throw Error('LYRICS_COVER_ROUTE_REQUIRED');
 const score=rows.stageAttempts.filter(a=>a.itemId===item.id&&a.stage==='text_score').at(-1),final=item.material?.finalRevision as any;
 if(run.snapshot.material.source==='provider'){
  const proof=providerPlanFinal(s.repo,run,item);
  if(!score||score.id!==proof.scoreAttempt.id)throw Error('FINAL_MATERIAL_CHANGED');
  return{run,item,score,final,sourceCandidateId:'provider:'+proof.job.id};
 }
 const evaluation=final?.evaluationRunId?s.repo.maybe('settings','production-flow:run:'+final.evaluationRunId)?.value:null;
 const draft=final?.draftId?s.repo.maybe('drafts',final.draftId):null;
 if(!score||score.state!=='succeeded'||!final||!evaluation||!draft||evaluation.state!=='completed'||evaluation.artistId!==run.snapshot.artistId||evaluation.inboxCandidateId!==item.material?.candidateId||evaluation.plan?.managedOwnerKey!==score.id||!evaluation.plan?.managedByPlanCenter||draft.artistId!==run.snapshot.artistId||draft.evaluationRunId!==evaluation.id||draft.source!=='inbox-evaluation'||evaluation.candidate?.id!==final.draftId||score.result?.evaluationRunId!==evaluation.id||score.result?.evaluatedDraftId!==final.draftId||hash(evaluation.score)!==hash(final.assessment)||hash(score.result?.assessment)!==hash(final.assessment)||hash(draft.pair)!==hash(evaluation.candidate.pair)||hash(draft.draft)!==hash(evaluation.candidate.draft)||pairHash(draft.pair)!==final.pairHash||draft.pair.lyrics!==final.lyrics||draft.draft.title!==final.title||item.material?.lyrics!==final.lyrics||item.material?.title!==final.title)throw Error('FINAL_MATERIAL_CHANGED');
 return{run,item,score,final,sourceCandidateId:String(item.material!.candidateId)};
}
/** Narrow guard: ordinary works are unaffected. Plan-owned recovery works remain frozen to final lyrics. */
export function assertPlanCoverWork(s:Studio,workId:string){
 const row=s.repo.all('settings').find(r=>r.id.startsWith('plan-cover-work:')&&r.value?.workId===workId);
 if(!row)return null;
 const binding=bindingSchema.parse(row.value),scope=finalScope(s,binding.itemId),{run,item,score,final}=scope,work=s.get('works',workId);
 if(work.artistId!==run.snapshot.artistId)throw Error('ARTIST_MISMATCH');
 if(binding.runId!==run.id||binding.artistId!==run.snapshot.artistId||item.workId!==work.id||binding.finalDraftId!==final.draftId||binding.finalPairHash!==final.pairHash||binding.scoreAttemptId!==score.id||binding.sourceCandidateId!==scope.sourceCandidateId||binding.rawLyricsHash!==hash(final.lyrics)||binding.titleHash!==hash(final.title)||hash(work.lyrics)!==binding.rawLyricsHash||hash(work.title)!==binding.titleHash)throw Error('FINAL_MATERIAL_CHANGED');
 return binding;
}
export function preparePlanCoverWork(s:Studio,raw:unknown){
 const input=PlanCenterPrepareCoverWorkSchema.parse(raw);
 return s.repo.transaction(()=>{
  const {run,item,score,final,sourceCandidateId}=finalScope(s,input.itemId);
  if(input.expectedFinalDraftId!==final.draftId||input.expectedFinalPairHash!==final.pairHash)throw Error('FINAL_MATERIAL_CHANGED');
  const rows=s.planCenterService().list();
  if(rows.stageAttempts.some(a=>a.itemId===item.id&&['cover','materials'].includes(a.stage)&&a.state==='succeeded'))throw Error('COVER_ALREADY_COMPLETED');
  if(s.planCenterService().next({runId:run.id,itemId:item.id})?.stage!=='cover')throw Error('COVER_RECOVERY_NOT_READY');
  const previous=s.repo.maybe('settings',key(item.id));
  if(previous){assertPlanCoverWork(s,previous.value.workId);return{workId:previous.value.workId};}
  if(item.workId)throw Error('WORK_ALREADY_BOUND');
  const work=s.saveWork({artistId:run.snapshot.artistId,title:final.title,lyrics:final.lyrics,story:'',prompt:final.musicPrompt,parameters:{},rights:'待人工确认授权',ai:'unknown'},{kind:'generation_input'});
  const sourceCover=s.repo.maybe('textCandidates',sourceCandidateId)?.cover;
  const binding=bindingSchema.parse({runId:run.id,itemId:item.id,artistId:run.snapshot.artistId,workId:work.id,finalDraftId:final.draftId,finalPairHash:final.pairHash,rawLyricsHash:hash(final.lyrics),titleHash:hash(final.title),scoreAttemptId:score.id,sourceCandidateId,...(sourceCover?.sha256?{sourceCoverSha256:sourceCover.sha256}:{}),createdAt:s.now().toISOString(),source:'plan-final-cover'});
  s.planCenterService().bindWork({itemId:item.id,workId:work.id,versions:[]});
  s.save('settings',{id:key(item.id),value:binding});
  s.repo.audit('planCenter.coverWork.prepared',item.id,{workId:work.id,finalDraftId:final.draftId,finalPairHash:final.pairHash,newGeneration:false});
  return{workId:work.id};
 });
}
