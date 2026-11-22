import {z} from 'zod';
import {pendingFanqieContractId,type FanqieCatalogRow} from '../shared/fanqie-catalog';
import type {Studio} from './studio';
import {resolveFanqieWork} from './fanqie-work';
import {syncPlanMaterials} from './plan-center-assets';
import {publicationOwnerActive} from './publication-tasks';
import {readWorkflowPublication,workflowFanqieAccountAction} from './plan-workflow-publication';
const prefix='plan-fanqie:';
export function planFanqieJobs(s:Studio,runId?:string){
 return s.repo.settingsByPrefix(prefix,runId ? {path:'$.value.runId',values:[runId]} : undefined).map(row=>row.value);
}

export function planFanqieJobsForRun(s:Studio,runId:string,dispatchIds:readonly string[]=[]){
 const jobs=new Map(planFanqieJobs(s,runId).map(job=>[job.id,job]));
 for(const id of dispatchIds){
  const job=s.repo.maybe('settings',prefix+id)?.value;
  if(job)jobs.set(id,job);
 }
 return [...jobs.values()];
}

type BatchReceiptJob = {
  batchSize?: number;
  state: string;
  prepareContract?: boolean;
  record?: FanqieCatalogRow;
};

export function planFanqieBatchSettled(jobs:readonly BatchReceiptJob[],continueAfterContract:boolean) {
  const size=jobs[0]?.batchSize;
  if(!size||jobs.length!==size)return false;
  const pendingContracts=new Set<string>();
  return jobs.every(job=>{
    if(job.batchSize!==size||!['uploaded','existing'].includes(job.state))return false;
    const stage=job.record?.stage;
    if(stage==='reviewing'||stage==='published')return true;
    if(job.state!=='uploaded'||stage!=='contract_pending')return false;
    if(job.prepareContract===false)return true;
    const contractId=continueAfterContract?pendingFanqieContractId(job.record):undefined;
    if(!contractId)return false;
    pendingContracts.add(contractId);
    return pendingContracts.size===1;
  });
}

function previousBatchSettled(all:ReturnType<typeof planFanqieJobs>,job:any) {
  if(!job.previousBatchId)return true;
  const previous=all.filter(row=>row.runId===job.previousBatchId&&row.publicationRunId===job.publicationRunId&&
    row.accountId===job.accountId&&row.accountKey===job.accountKey&&row.configurationHash===job.configurationHash);
  return planFanqieBatchSettled(previous,job.continueAfterContract===true);
}
export function syncPlanFanqie(s:Studio){
 if(s.mode!=='production')return;
 const rows=s.planCenterService().list();
 for(const run of rows.runs){
  if(!run.snapshot.fanqie||!run.snapshot.authorization.publish)continue;
  for(const item of rows.items.filter(i=>i.runId===run.id)){
   const id=prefix+item.id,old=s.repo.maybe('settings',id)?.value;
   if(old){if(run.stopRequested&&old.state==='ready')s.save('settings',{id,value:{...old,state:'stopped'}});continue;}
   if(run.stopRequested||!item.workId||!item.materials||!rows.stageAttempts.some(a=>a.itemId===item.id&&a.stage==='materials'&&a.state==='succeeded'))continue;
   try {
    const source=resolveFanqieWork(s,{workId:item.workId,variant:item.materials.selectedVersion});
    s.save('settings',{id,value:{id:item.id,runId:run.id,workId:item.workId,variant:source.variant,fingerprint:source.fingerprint,
      batchSize:run.snapshot.count,ordinal:item.ordinal,...run.snapshot.fanqie,prepareContract:run.prepareContract,state:'ready',createdAt:s.now().toISOString()}});
   } catch {
    s.save('settings',{id,value:{id:item.id,runId:run.id,workId:item.workId,state:'blocked',reason:'FANQIE_MATERIALS_CHANGED',createdAt:s.now().toISOString()}});
   }
  }
  s.planCenterService().refreshPublication(run.id);
 }
}
const batchScope=z.strictObject({runId:z.uuid(),workId:z.uuid().optional()});
const batchReceipt=z.strictObject({
  workId:z.uuid(),record:z.record(z.string(),z.unknown()),
  authorization:z.enum(['awaiting_signature','already_processed']).optional(),
});
const observedAuthorization=z.strictObject({
  accountId:z.uuid().optional(),accountKey:z.string().regex(/^[a-f0-9]{64}$/),
  records:z.array(z.strictObject({
    id:z.string().regex(/^[1-9]\d{4,24}$/),title:z.string().min(1),
    stage:z.enum(['contract_pending','reviewing','published','rejected','withdrawn']),
    officialStatus:z.string().min(1),createdAtText:z.string(),publishedAtText:z.string(),
    contract:z.strictObject({state:z.literal('awaiting_signature'),id:z.string().regex(/^[1-9]\d{4,24}$/u)}).optional(),
  }).refine(row=>row.stage==='contract_pending'?!!row.contract:!row.contract)),
});
function batchJobs(s:Studio,runId:string){
  const run=s.planCenterService().list().runs.find(row=>row.id===runId);
  const all=planFanqieJobs(s);
  const jobs=all.filter(job=>job.runId===runId&&job.batchSize).sort((a,b)=>a.ordinal-b.ordinal);
  const owner=jobs[0]?.publicationRunId;
  const prepareContract=run?.prepareContract??jobs[0]?.prepareContract;
  const scope=owner?{accountKey:jobs[0].accountKey,configurationHash:jobs[0].configurationHash,accountId:jobs[0].accountId,materialsConsent:true}:run?.snapshot.fanqie;
  if(!scope||(!owner&&(!run?.snapshot.authorization.publish||jobs.length!==run.snapshot.count))||
     jobs.some(job=>job.batchSize!==jobs.length||job.accountKey!==scope.accountKey||job.publicationRunId!==owner||
       job.configurationHash!==scope.configurationHash||job.accountId!==scope.accountId||
       job.previousBatchId!==jobs[0].previousBatchId||job.continueAfterContract!==jobs[0].continueAfterContract||
       (job.prepareContract??true)!==(prepareContract??true))||
     new Set(jobs.map(job=>job.workId)).size!==jobs.length)
    throw Error('FANQIE_BATCH_SCOPE_CHANGED');
  return {run,jobs,scope,prepareContract,previousSettled:!jobs.length||previousBatchSettled(all,jobs[0]),
    stopped:owner?!publicationOwnerActive(s.repo,owner):run!.stopRequested};
}
function saveBatchJob(s:Studio,job:Record<string,unknown>,patch:Record<string,unknown>){
  s.save('settings',{id:prefix+job.id,value:{...job,...patch,updatedAt:s.now().toISOString()}});
}
export function retryPlanFanqieBatch(s:Studio,input:unknown){
  const {runId}=batchScope.omit({workId:true}).parse(input);
  return s.repo.transaction(()=>{
    const {run,jobs,stopped}=batchJobs(s,runId);
    const owner=jobs[0]?.publicationRunId;
    const graph=owner?readWorkflowPublication(s.repo,owner):undefined;
    if((!run&&!jobs.every(job=>graph?.dispatch?.fanqieIds.includes(job.id)))||stopped||!jobs.every(job=>job.state==='unknown'))
      throw Error('FANQIE_PLAN_NOT_READY');
    for(const job of jobs)saveBatchJob(s,job,{state:'ready',reason:undefined});
    if(run)s.planCenterService().refreshPublication(runId);
    return {runId};
  });
}
export function planFanqieAction(s:Studio,action:string,input:unknown){
 if(s.mode!=='production')throw Error('PRODUCTION_REQUIRED');
 if(action==='listWorkflowAccounts')return workflowFanqieAccountAction(s,'list',input);
 if(action==='recordWorkflowAccount')return workflowFanqieAccountAction(s,'record',input);
 if(action==='list'){
  z.strictObject({}).parse(input);
  syncPlanFanqie(s);
  const jobs=planFanqieJobs(s);
  return jobs.filter(job=>job.state!=='ready'||publicationOwnerActive(s.repo,job.publicationRunId)&&previousBatchSettled(jobs,job));
 }
 if(action==='observeAuthorization'){
  const observed=observedAuthorization.parse(input);
  const byId=new Map(observed.records.map(record=>[record.id,record]));
  if(byId.size!==observed.records.length)throw Error('FANQIE_CATALOG_DUPLICATE_ID');
  return s.repo.transaction(()=>{
   let updated=0;
   for(const job of planFanqieJobs(s)){
    if(job.state!=='uploaded'||(job.authorization!=='awaiting_signature'&&!(job.publicationRunId&&job.record?.stage==='contract_pending'))||
       job.accountId!==observed.accountId||job.accountKey!==observed.accountKey)continue;
    const record=byId.get(job.record?.id);
    if(record&&record.title===job.record?.title){
     const authorization=record.stage==='contract_pending'?'awaiting_signature':'already_processed';
     if(job.authorization===authorization&&JSON.stringify(job.record)===JSON.stringify(record))continue;
     saveBatchJob(s,job,{authorization,record});updated++;
    }
   }
   return {updated};
  });
 }
 if(action==='claimBatch'||action==='currentBatch'){
  const value=batchScope.parse(input);
  return s.repo.transaction(()=>{
   const {run,jobs,scope,stopped,prepareContract,previousSettled}=batchJobs(s,value.runId);
   if(stopped)throw Error('STOP_REQUESTED');
   const expected=action==='claimBatch'?'ready':'dispatching';
   if(!previousSettled||!jobs.every(job=>job.state===expected))throw Error('FANQIE_PLAN_NOT_READY');
   const selected=value.workId?jobs.filter(job=>job.workId===value.workId):jobs;
   if(!selected.length||action==='claimBatch'&&value.workId)throw Error('FANQIE_BATCH_SCOPE_CHANGED');
   for(const job of selected){
    if(run&&(run.snapshot.distinctLyrics||run.snapshot.songType==='instrumental')){
     const item=s.planCenterService().list().items.find(row=>row.id===job.id);
     if(!item||!syncPlanMaterials(s,run,item).ready)throw Error('FANQIE_MATERIALS_CHANGED');
    }
    const source=resolveFanqieWork(s,{workId:job.workId,variant:job.variant,
      ...(job.useVersionMetadata?{useVersionMetadata:true}:{})});
    if(source.fingerprint!==job.fingerprint)throw Error('FANQIE_WORK_CHANGED');
   }
   if(action==='claimBatch')for(const job of jobs)saveBatchJob(s,job,{state:'dispatching'});
   return {runId:value.runId,...scope,...(prepareContract===undefined?{}:{prepareContract}),items:jobs.map(job=>({workId:job.workId,variant:job.variant,fingerprint:job.fingerprint,
     ...(job.useVersionMetadata?{useVersionMetadata:true}:{})}))};
  });
 }
 if(action==='recordBatch'){
  const value=batchScope.omit({workId:true}).extend({receipts:z.array(batchReceipt).max(20),reason:z.string().max(200).optional()}).parse(input);
  return s.repo.transaction(()=>{
   const {run,jobs,prepareContract}=batchJobs(s,value.runId);
   if(!jobs.every(job=>job.state==='dispatching'))throw Error('FANQIE_PLAN_SCOPE');
   const workIds=value.receipts.map(receipt=>receipt.workId),ids=value.receipts.map(receipt=>receipt.record.id);
   if(workIds.some(id=>!jobs.some(job=>job.workId===id))||new Set(workIds).size!==workIds.length||
      ids.some(id=>typeof id!=='string'||!/^[1-9]\d{4,24}$/.test(id))||new Set(ids).size!==ids.length||
      !value.reason&&(workIds.length!==jobs.length||value.receipts.some(receipt=>prepareContract===false
        ? !['contract_pending','reviewing','published','rejected','withdrawn'].includes(String(receipt.record.stage))
        : !receipt.authorization)))
     throw Error('FANQIE_SAVED_WORK_READBACK_REQUIRED');
   for(const job of jobs){
    const receipt=value.receipts.find(receipt=>receipt.workId===job.workId);
    saveBatchJob(s,job,{state:value.reason?'unknown':'uploaded',reason:value.reason,record:receipt?.record??job.record,
      authorization:receipt?.authorization});
   }
   if(run)s.planCenterService().refreshPublication(value.runId);
   return {runId:value.runId};
  });
 }
 const value=z.strictObject({id:z.string().min(1).max(500),state:z.enum(['uploaded','existing','unknown','blocked']).optional(),reason:z.string().max(200).optional(),record:z.record(z.string(),z.unknown()).optional()}).parse(input);
 const row=s.repo.get('settings',prefix+value.id),job=row.value;
 if(action==='claim'||action==='current'){
  if(job.state!==(action==='claim'?'ready':'dispatching'))throw Error('FANQIE_PLAN_NOT_READY');
  const run=s.planCenterService().list().runs.find(r=>r.id===job.runId);
  if(!run||run.stopRequested||!run.snapshot.authorization.publish||!run.snapshot.fanqie)throw Error('STOP_REQUESTED');
  const source=resolveFanqieWork(s,{workId:job.workId,variant:job.variant});
  if(source.fingerprint!==job.fingerprint)throw Error('FANQIE_WORK_CHANGED');
  if(action==='current')return job;
  const claimed={...job,state:'dispatching',dispatchedAt:s.now().toISOString()};s.save('settings',{...row,value:claimed});return claimed;
 }
 if(action==='record'){
  if(job.state!=='dispatching'||!value.state)throw Error('FANQIE_PLAN_SCOPE');
  if(['uploaded','existing'].includes(value.state)&&!value.record?.id)throw Error('FANQIE_SAVED_WORK_READBACK_REQUIRED');
  const saved={...job,state:value.state,reason:value.reason,record:value.record,updatedAt:s.now().toISOString()};
  s.save('settings',{...row,value:saved});s.planCenterService().refreshPublication(job.runId);return saved;
 }
 throw Error('METHOD_NOT_ALLOWED');
}
export function recoverPlanFanqie(s:Studio){
 for(const job of planFanqieJobs(s).filter(j=>j.state==='dispatching'))s.save('settings',{id:prefix+job.id,value:{...job,state:'unknown',reason:'RESTART_RECONCILE_REQUIRED'}});
}
