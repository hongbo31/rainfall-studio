import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {TmeAiSubmissionActions,type TmeAiSubmissionCapability} from '../../shared/tme-ai-submission';
type Executor={capability:()=>TmeAiSubmissionCapability;accept:(context:any)=>Promise<any>;submit:(context:any)=>Promise<any>;readReceipt:(context:any)=>Promise<any>};
type Options={root:string;rpc:(method:string,input?:any)=>Promise<any>;available:()=>boolean;generation:()=>number;observe:(context:any)=>Promise<any>;executor?:Executor};
/** The executor is Main-owned. No renderer flag, guessed selector or local receipt can enable it. */
export function createTmeAiSubmissionBroker(o:Options){
 const sessionId=randomUUID();let busy=false;
 const capability=():TmeAiSubmissionCapability=>o.executor?.capability()??{available:false,reasons:['NATIVE_AI_SUBMIT_CONTRACT_UNVERIFIED','OFFICIAL_RECEIPT_CONTRACT_UNVERIFIED'],transport:'windows-uia'};
 const rpc=async(action:string,input:any={})=>{const r=await o.rpc('internal.tmeAiSubmission.'+action,input);if(!r.ok)throw Error(r.error.code);return r.value};
 const code=(e:unknown)=>e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'SUBMISSION_OUTCOME_UNKNOWN';
 const intentPath=(row:any)=>{if(!/^[a-f0-9]{64}$/.test(row.familyKey))throw Error('SUBMISSION_SCOPE_CHANGED');return path.join(o.root,'production','tme-ai-submission-intents',row.familyKey+'.json')};
 return{async ui(action:string,input:unknown={}){
  if(!o.available())throw Error('PRODUCTION_REQUIRED');
  const schema=(TmeAiSubmissionActions as Record<string,any>)[action];if(!schema)throw Error('ACTION_NOT_ALLOWED');const i=schema.parse(input);
  if(busy)throw Error('SUBMISSION_BUSY');busy=true;const generation=o.generation(),guard=()=>{if(!o.available()||o.generation()!==generation)throw Error('WORKSPACE_CHANGED')};
  try{
   if(action==='status')return{capability:capability(),jobs:await rpc('listPublic',i)};
   if(action==='preflight'){
    const material=await rpc('inspectWork',i);guard();const contract=capability();
    if(!material.readyForNative)return{...material,ready:false,capability:contract};
    try{
     const context=await rpc('preparedContext',{id:material.prepareJobId});guard();
     const snapshot=await o.observe(context);guard();
     const row=await rpc('review',{prepareJobId:material.prepareJobId,snapshot,contract,sessionId});guard();
     if(fs.existsSync(intentPath(row)))return{workId:i.workId,title:material.title,ready:false,reasons:['SUBMISSION_ALREADY_DISPATCHED'],capability:contract,job:await rpc('publicJob',{id:row.id})};
     return{workId:i.workId,title:material.title,ready:contract.available,reasons:contract.reasons,capability:contract,job:await rpc('publicJob',{id:row.id})};
    }catch(e){return{workId:i.workId,title:material.title,ready:false,reasons:[code(e),...contract.reasons],capability:contract}}
   }
   if(action==='reconcile'){
    if(!o.executor)throw Error('OFFICIAL_RECEIPT_CONTRACT_UNVERIFIED');
    const context=await rpc('receiptContext',i);guard();const receipt=await o.executor.readReceipt(context);guard();
    await rpc('reconcile',{id:i.id,receipt});guard();return rpc('publicJob',i);
   }
   if(!o.executor||!capability().available)throw Error('EXECUTOR_UNAVAILABLE');
   const prior=await rpc('context',{id:i.id});guard();if(fs.existsSync(intentPath(prior.job)))throw Error('SUBMISSION_ALREADY_DISPATCHED');
   let row=await rpc('authorize',{...i,sessionId});guard();
   for(const phase of ['accept','submit'] as const){
    let context=await rpc('context',{id:row.id});guard();
    if(!capability().available)throw Error('EXECUTOR_UNAVAILABLE');
    const snapshot=await o.observe(context.prepared);guard();
    const claim=await rpc('claim',{id:row.id,expectedRevision:row.revision,phase,snapshot,sessionId});
    try{
     guard();context={...context,job:claim.job,operation:claim.operation};
     if(phase==='submit'){
      const dir=path.join(o.root,'production','tme-ai-submission-intents');fs.mkdirSync(dir,{recursive:true});
      // Survives SQLite restore; existence never authorizes a retry.
      fs.writeFileSync(intentPath(context.job),JSON.stringify({operationId:claim.operation.id,scopeHash:row.scopeHash,createdAt:claim.operation.createdAt}),{flag:'wx'});
     }
     guard();const result=await o.executor[phase](context);guard();
     row=await rpc('record',{id:row.id,operationId:claim.operation.id,result});guard();
     if(row.state==='reconcile_required')break;
    }catch(e){
     // A workspace switch leaves the existing claim for Core startup recovery; never write into another workspace.
     guard();await rpc('interrupt',{id:row.id,operationId:claim.operation.id,reason:code(e)});throw e;
    }
   }
   return rpc('publicJob',{id:row.id});
  }finally{busy=false}
 }};
}
