import {z} from 'zod';
import type {Studio} from './studio';
import {resolveFanqieWork} from './fanqie-work';
const prefix='plan-fanqie:';
export function planFanqieJobs(s:Studio){return s.repo.all('settings').filter(r=>r.id.startsWith(prefix)).map(r=>r.value);}
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
      batchSize:run.snapshot.count,ordinal:item.ordinal,...run.snapshot.fanqie,state:'ready',createdAt:s.now().toISOString()}});
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
    stage:z.enum(['reviewing','published','rejected','withdrawn']),
    officialStatus:z.string().min(1),createdAtText:z.string(),publishedAtText:z.string(),
  })),
});
function batchJobs(s:Studio,runId:string){
  const run=s.planCenterService().list().runs.find(row=>row.id===runId);
  const jobs=planFanqieJobs(s).filter(job=>job.runId===runId&&job.batchSize).sort((a,b)=>a.ordinal-b.ordinal);
  if(!run?.snapshot.fanqie||!run.snapshot.authorization.publish||jobs.length!==run.snapshot.count||
     jobs.some(job=>job.batchSize!==jobs.length||job.accountKey!==run.snapshot.fanqie!.accountKey||
       job.configurationHash!==run.snapshot.fanqie!.configurationHash||job.accountId!==run.snapshot.fanqie!.accountId)||
     new Set(jobs.map(job=>job.workId)).size!==jobs.length)
    throw Error('FANQIE_BATCH_SCOPE_CHANGED');
  return {run,jobs};
}
function saveBatchJob(s:Studio,job:Record<string,unknown>,patch:Record<string,unknown>){
  s.save('settings',{id:prefix+job.id,value:{...job,...patch,updatedAt:s.now().toISOString()}});
}
export function retryPlanFanqieBatch(s:Studio,input:unknown){
  const {runId}=batchScope.omit({workId:true}).parse(input);
  return s.repo.transaction(()=>{
    const {run,jobs}=batchJobs(s,runId);
    if(run.stopRequested||!jobs.every(job=>job.state==='unknown'))throw Error('FANQIE_PLAN_NOT_READY');
    for(const job of jobs)saveBatchJob(s,job,{state:'ready',reason:undefined});
    s.planCenterService().refreshPublication(runId);
    return {runId};
  });
}
export function planFanqieAction(s:Studio,action:string,input:unknown){
 if(s.mode!=='production')throw Error('PRODUCTION_REQUIRED');
 if(action==='list'){z.strictObject({}).parse(input);syncPlanFanqie(s);return planFanqieJobs(s);}
 if(action==='observeAuthorization'){
  const observed=observedAuthorization.parse(input);
  const byId=new Map(observed.records.map(record=>[record.id,record]));
  if(byId.size!==observed.records.length)throw Error('FANQIE_CATALOG_DUPLICATE_ID');
  return s.repo.transaction(()=>{
   let updated=0;
   for(const job of planFanqieJobs(s)){
    if(job.state!=='uploaded'||job.authorization!=='awaiting_signature'||
       job.accountId!==observed.accountId||job.accountKey!==observed.accountKey)continue;
    const record=byId.get(job.record?.id);
    if(record&&record.title===job.record?.title){
     saveBatchJob(s,job,{authorization:'already_processed',record});updated++;
    }
   }
   return {updated};
  });
 }
 if(action==='claimBatch'||action==='currentBatch'){
  const value=batchScope.parse(input);
  return s.repo.transaction(()=>{
   const {run,jobs}=batchJobs(s,value.runId);
   if(run.stopRequested)throw Error('STOP_REQUESTED');
   const expected=action==='claimBatch'?'ready':'dispatching';
   if(!jobs.every(job=>job.state===expected))throw Error('FANQIE_PLAN_NOT_READY');
   const selected=value.workId?jobs.filter(job=>job.workId===value.workId):jobs;
   if(!selected.length||action==='claimBatch'&&value.workId)throw Error('FANQIE_BATCH_SCOPE_CHANGED');
   for(const job of selected){
    const source=resolveFanqieWork(s,{workId:job.workId,variant:job.variant});
    if(source.fingerprint!==job.fingerprint)throw Error('FANQIE_WORK_CHANGED');
   }
   if(action==='claimBatch')for(const job of jobs)saveBatchJob(s,job,{state:'dispatching'});
   return {runId:run.id,...run.snapshot.fanqie,items:jobs.map(job=>({workId:job.workId,variant:job.variant,fingerprint:job.fingerprint}))};
  });
 }
 if(action==='recordBatch'){
  const value=batchScope.omit({workId:true}).extend({receipts:z.array(batchReceipt).max(20),reason:z.string().max(200).optional()}).parse(input);
  return s.repo.transaction(()=>{
   const {jobs}=batchJobs(s,value.runId);
   if(!jobs.every(job=>job.state==='dispatching'))throw Error('FANQIE_PLAN_SCOPE');
   const workIds=value.receipts.map(receipt=>receipt.workId),ids=value.receipts.map(receipt=>receipt.record.id);
   if(workIds.some(id=>!jobs.some(job=>job.workId===id))||new Set(workIds).size!==workIds.length||
      ids.some(id=>typeof id!=='string'||!/^[1-9]\d{4,24}$/.test(id))||new Set(ids).size!==ids.length||
      !value.reason&&(workIds.length!==jobs.length||value.receipts.some(receipt=>!receipt.authorization)))
     throw Error('FANQIE_SAVED_WORK_READBACK_REQUIRED');
   for(const job of jobs){
    const receipt=value.receipts.find(receipt=>receipt.workId===job.workId);
    saveBatchJob(s,job,{state:value.reason?'unknown':'uploaded',reason:value.reason,record:receipt?.record??job.record,
      authorization:receipt?.authorization});
   }
   s.planCenterService().refreshPublication(value.runId);
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
