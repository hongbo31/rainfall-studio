import type {FanqieCatalogReport} from '../../shared/fanqie-catalog';
import {defaultFanqieAccountId} from '../../shared/platform-accounts';

type Upload={status:()=>{busy:boolean};publishScheduled:(input:unknown,check?:()=>Promise<void>)=>Promise<any>;
 publishScheduledBatch?:(input:unknown,check:(workId?:string)=>Promise<void>)=>Promise<any>};
type Options={rpc:(method:string,input?:unknown)=>Promise<any>;available:()=>boolean;generation:()=>number;upload:Upload;
 forAccount?:(accountId:string)=>Promise<Upload>;
 readAuthorization?:(accountId?:string)=>Promise<FanqieCatalogReport|undefined>};
/** Each occurrence reaches the shared batch uploader after all its materials are ready. */
export function createPlanFanqiePublisher(o:Options){
 let busy=false;
 const authorizationChecks=new Map<string|undefined,number>();
 const rpc=async(action:string,input:unknown={})=>{const r=await o.rpc('internal.planFanqie.'+action,input);if(!r.ok)throw Error(r.error?.code??'FANQIE_PLAN_RPC');return r.value;};
 return {async pump(){
  if(busy||!o.available())return;busy=true;
  const generation=o.generation();
  try{
   const jobs=await rpc('list');
   const current=()=>o.available()&&generation===o.generation();
   const groups=new Map<string,any[]>();
   for(const job of jobs.filter((job:any)=>job.batchSize)){
    const group=groups.get(job.runId)??[];group.push(job);groups.set(job.runId,group);
   }
   const accountGroups=new Map<string,[string,any[]][]>();
   for(const entry of groups){
    const accountId=entry[1][0].accountId??defaultFanqieAccountId;
    const queue=accountGroups.get(accountId)??[];
    queue.push(entry);accountGroups.set(accountId,queue);
   }
   await Promise.allSettled([...accountGroups].map(async ([accountId,queue])=>{
    const upload=accountId===defaultFanqieAccountId
      ?o.upload:await o.forAccount?.(accountId);
    for(const [runId,group] of queue){
     if(!current())return;
     if(group.length!==group[0].batchSize||!group.every(job=>job.state==='ready'))continue;
     if(!upload?.publishScheduledBatch||upload.status().busy)continue;
     const claimed=await rpc('claimBatch',{runId});
     try{
      const batch=await upload.publishScheduledBatch({
       runId,accountKey:claimed.accountKey,configurationHash:claimed.configurationHash,items:claimed.items,
      },async workId=>{
       if(!current())throw Error('WORKSPACE_CHANGED');
       await rpc('currentBatch',{runId,workId});
      });
      if(!current())return;
      const receipts=batch.batch.items.flatMap((item:any)=>{
       const record=item.result?.result?.officialRecord;
       return record?[{workId:item.workId,record,authorization:batch.batch.authorization?.find((entry:any)=>entry.id===record.id)?.phase}]:[];
      });
      await rpc('recordBatch',{runId,receipts,reason:batch.batch.state==='complete'?undefined:
        batch.batch.authorizationError??batch.batch.items.find((item:any)=>item.error)?.error??'FANQIE_PLAN_UPLOAD_UNKNOWN'});
     }catch(error){
      if(!current())return;
      const reason=error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'FANQIE_PLAN_UPLOAD_UNKNOWN';
      await rpc('recordBatch',{runId,receipts:[],reason});
     }
    }
   }));
   for(const next of jobs.filter((j:any)=>j.state==='ready'&&!j.batchSize)){
    if(jobs.some((j:any)=>j.runId===next.runId&&['unknown','blocked','dispatching'].includes(j.state)))continue;
    if(!o.available()||generation!==o.generation())break;
    const upload=next.accountId
      ? await o.forAccount?.(next.accountId)
      : o.upload;
    if(!upload||upload.status().busy)continue;
    if(!o.available()||generation!==o.generation())break;
    const job=await rpc('claim',{id:next.id});
    try{
     if(job.accountId!==next.accountId)throw Error('FANQIE_BATCH_SCOPE_CHANGED');
     const state=await upload.publishScheduled({workId:job.workId,variant:job.variant,accountKey:job.accountKey,configurationHash:job.configurationHash,fingerprint:job.fingerprint},async()=>{await rpc('current',{id:job.id});});
     if(!o.available()||generation!==o.generation())return;
     const result=state.result,record=result?.uploaded?result.officialRecord:result?.matches?.length===1?result.matches[0]:null;
     if(!record?.id)throw Error('FANQIE_SAVED_WORK_READBACK_REQUIRED');
     await rpc('record',{id:job.id,state:result.uploaded?'uploaded':'existing',record});
    }catch(e){
     if(!o.available()||generation!==o.generation())return;
     const reason=e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'FANQIE_PLAN_UPLOAD_UNKNOWN';
     await rpc('record',{id:job.id,state:'unknown',reason});break;
    }
   }
   if(o.readAuthorization&&current()){
    const awaiting=jobs.filter((job:any)=>job.state==='uploaded'&&job.authorization==='awaiting_signature'&&job.record?.id);
    for(const accountId of new Set<string|undefined>(awaiting.map((job:any)=>job.accountId))){
     if(!current())return;
     if(Date.now()<(authorizationChecks.get(accountId)??0))continue;
     authorizationChecks.set(accountId,Date.now()+60000);
     const report=await o.readAuthorization(accountId).catch(()=>undefined);
     if(!current()||!report?.complete||report.source!=='browser')continue;
     const ids=new Set(awaiting.filter((job:any)=>job.accountId===accountId&&job.accountKey===report.accountKey).map((job:any)=>job.record.id));
     const records=report.rows.filter(record=>ids.has(record.id)&&record.stage!=='contract_pending');
     if(records.length)await rpc('observeAuthorization',{accountId,accountKey:report.accountKey,records});
    }
   }
  }finally{busy=false;}
 }};
}
