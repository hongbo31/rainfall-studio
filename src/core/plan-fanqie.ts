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
    s.save('settings',{id,value:{id:item.id,runId:run.id,workId:item.workId,variant:source.variant,fingerprint:source.fingerprint,...run.snapshot.fanqie,state:'ready',createdAt:s.now().toISOString()}});
   } catch {
    s.save('settings',{id,value:{id:item.id,runId:run.id,workId:item.workId,state:'blocked',reason:'FANQIE_MATERIALS_CHANGED',createdAt:s.now().toISOString()}});
   }
  }
  s.planCenterService().refreshPublication(run.id);
 }
}
export function planFanqieAction(s:Studio,action:string,input:unknown){
 if(s.mode!=='production')throw Error('PRODUCTION_REQUIRED');
 if(action==='list'){z.strictObject({}).parse(input);syncPlanFanqie(s);return planFanqieJobs(s);}
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
