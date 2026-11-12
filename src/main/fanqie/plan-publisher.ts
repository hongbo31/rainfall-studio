type Upload={status:()=>{busy:boolean};publishScheduled:(input:unknown,check?:()=>Promise<void>)=>Promise<any>};
type Options={rpc:(method:string,input?:unknown)=>Promise<any>;available:()=>boolean;generation:()=>number;upload:Upload;forAccount?:(accountId:string)=>Promise<Upload>};
/** Main owns browser writes; Core owns durable per-plan intents. No automatic replay after interruption. */
export function createPlanFanqiePublisher(o:Options){
 let busy=false;
 const rpc=async(action:string,input:unknown={})=>{const r=await o.rpc('internal.planFanqie.'+action,input);if(!r.ok)throw Error(r.error?.code??'FANQIE_PLAN_RPC');return r.value;};
 return {async pump(){
  if(busy||!o.available()||o.upload.status().busy)return;busy=true;
  const generation=o.generation();
  try{
   const jobs=await rpc('list');
   for(const next of jobs.filter((j:any)=>j.state==='ready')){
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
  }finally{busy=false;}
 }};
}
