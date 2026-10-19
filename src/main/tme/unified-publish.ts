import {createTmeAiBrowserPreparePort} from './ai-prepare-browser';
import {createTmeAiBrowserSubmissionExecutor} from './ai-submission-browser';
import {createTmeExistingAlbumPreparePort,createTmeExistingAlbumSubmissionExecutor} from './ai-existing-album-browser';
import type {TmeAiSubmissionCapability} from '../../shared/tme-ai-submission';
type Broker = {ui(action:string,input?:any):Promise<any>};
type Options = {
 rpc:(method:string,input?:any)=>Promise<any>;
 available:()=>boolean;
 generation:()=>number;
 nativeAvailable?:()=>boolean;
 publicationBarrier?:(task:any)=>{reason:string}|null|Promise<{reason:string}|null>;
 preparationCapability?:()=>{available:boolean;reason?:string};
 prepare:Broker;
 submission:Broker;
};
/** Coordinates persisted intent only. Existing brokers retain all native safety and consent gates. */
export function createUnifiedPublishBroker(o:Options){
 let busy=false;
 const rpc=async(action:string,input:any={})=>{
  const result=await o.rpc('internal.unifiedPublish.'+action,input);
  if(!result.ok)throw Error(result.error.code);
  return result.value;
 };
 const reason=(e:unknown)=>e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'PREPARATION_OUTCOME_UNKNOWN';
 const grantScope=(task:any,grant:any)=>{
  if(!grant?.publicationTaskId&&!grant?.accountId){if(grant?.scopeKind==='task')throw Error('PREPARATION_ACCOUNT_SCOPE');return{};}
  if(grant.scopeKind==='legacy'||grant.publicationTaskId!==task.id||grant.accountId!==task.accountId)throw Error('PREPARATION_ACCOUNT_SCOPE');
  return{publicationTaskId:grant.publicationTaskId,accountId:grant.accountId};
 };
 async function processTask(initial:any,guard:()=>void){
  let task=initial,dispatched=false;
  const update=async(patch:any)=>{guard();task=await rpc('update',{id:task.id,expectedRevision:task.revision,patch});guard()};
  try{
   guard();
   const barrier=await o.publicationBarrier?.(task);if(barrier){await update({state:'blocked',reason:barrier.reason});return}
   const preparation=o.preparationCapability?.()??{available:o.nativeAvailable?.()===true,reason:'WINDOWS_REQUIRED'};
   if(!preparation.available){await update({state:'blocked',reason:preparation.reason??'PREPARATION_EXECUTOR_UNAVAILABLE'});return}
   // Core resolves the exact current work/audio/account/material scope. Never guess a grant by title or work alone.
   const context=await rpc('prepareContext',{id:task.id});guard();
   if(context.task.id!==task.id||context.task.workId!==task.workId||context.task.revision!==task.revision)throw Error('REVISION_CONFLICT');
   const grant=context.grant;
   if(!grant){
    if(task.state!=='awaiting_authorization')await update({state:'awaiting_authorization',reason:'PREPARATION_AUTHORIZATION_REQUIRED'});
    return;
   }
   if(grant.workId!==task.workId||grant.suspended)throw Error('PREPARE_WORK_SCOPE');
   const scope=grantScope(task,grant);
   task=await rpc('claim',{id:task.id,expectedRevision:task.revision});guard();
   let job=context.job;
   const assertJob=()=>{if(!job||job.workId!==task.workId||job.grantId!==grant.id)throw Error('PREPARE_WORK_SCOPE')};
   if(!job){
    // Persisted preparing is a recovery barrier even if the process dies before the job ID is linked.
    dispatched=true;
    const started=await o.prepare.ui('start',{grantId:grant.id,expectedRevision:grant.revision,consent:true,...scope});guard();job=started.job;
   }
   assertJob();
   await update({state:'preparing',prepareJobId:job.id,reason:null});
   if(job.state==='ready'){
    dispatched=true;
    const prepared=await o.prepare.ui('run',{id:job.id,expectedRevision:job.revision,consent:true,...scope});guard();job=prepared.job;assertJob();
   }
   if(job.state!=='awaiting_terms_review'){
    await update({state:'reconcile_required',reason:job.reason??'PREPARATION_REVIEW_REQUIRED'});return;
   }
   // This call only observes/reviews. Terms acceptance and submission stay in their explicit-confirmation workspace.
   const review=await o.submission.ui('preflight',{workId:task.workId,...scope});guard();
   if(review.workId!==task.workId)throw Error('SUBMISSION_WORK_SCOPE');
   await update({state:review.job?'awaiting_confirmation':'reconcile_required',...(review.job?{submissionJobId:review.job.id}:{}),reason:review.reasons?.[0]??'TERMS_CONFIRMATION_REQUIRED'});
  }catch(e){
   // Do not write old task IDs to a replacement Core. Its startup recovery owns in-flight intents.
   guard();
   await update({state:dispatched||task.dispatchedAt?'reconcile_required':'blocked',reason:reason(e)});
  }
 }
 return{async reconcile(id:string){
  if(busy)throw Error('PUBLICATION_BUSY');if(!o.available())throw Error('PRODUCTION_REQUIRED');
  busy=true;const generation=o.generation(),guard=()=>{if(!o.available()||o.generation()!==generation)throw Error('WORKSPACE_CHANGED')};
  try{
   let task=(await rpc('list')).find((t:any)=>t.id===id);guard();if(!task)throw Error('NOT_FOUND');
   if(task.reason==='PROTECTED_PUBLISHED_WORK')throw Error('PROTECTED_PUBLISHED_WORK');
   if(task.reason==='OFFICIAL_RECORD_ALREADY_EXISTS'&&task.receipt){await o.submission.ui('reconcile',{id:task.workId});guard();return(await rpc('list')).find((t:any)=>t.id===id)}
   if(task.submissionJobId){await o.submission.ui('reconcile',{id:task.submissionJobId});guard();return(await rpc('list')).find((t:any)=>t.id===id)}
   const context=await rpc('prepareContext',{id});guard();
   if(!context.job)throw Error('PREPARATION_REQUIRED');
   const prepared=await o.prepare.ui('reconcile',{id:context.job.id});guard();
   if(prepared.job?.state!=='awaiting_terms_review')throw Error('PREPARATION_RECONCILIATION_REQUIRED');
   const review=await o.submission.ui('preflight',{workId:task.workId,...grantScope(task,context.grant)});guard();
   if(!review.job||review.workId!==task.workId)throw Error('SUBMISSION_REVIEW_REQUIRED');
   task=(await rpc('list')).find((t:any)=>t.id===id);guard();
   return rpc('linkReviewed',{id,expectedRevision:task.revision,prepareJobId:prepared.job.id,submissionJobId:review.job.id});
  }finally{busy=false}
 },async pump(){
  if(busy||!o.available())return;
  busy=true;const generation=o.generation();
  const guard=()=>{if(!o.available()||o.generation()!==generation)throw Error('WORKSPACE_CHANGED')};
  try{
   const tasks=await rpc('list');guard();
   for(const task of tasks){
    guard();
    if(task.state==='queued'||task.state==='awaiting_authorization'||(task.state==='blocked'&&!task.dispatchedAt&&['CLOUD_PREPARE_CONTRACT_UNVERIFIED','BROWSER_AI_PREPARE_CONTRACT_UNVERIFIED','CLOUD_BROWSER_SESSION_REQUIRED'].includes(task.reason)&&o.preparationCapability?.().available))await processTask(task,guard);
   }
  }catch{
   // Core unavailable/revision conflicts leave durable rows for a subsequent safe scan or startup recovery.
  }finally{busy=false}
 }};
}

/** Main-only session seam. No renderer RPC can bind a Page, calibrate a contract, or enable writes. */
export function createTmeAiTransportProvider(o:{
 platform:NodeJS.Platform;
 native:{request(action:string,input:any):Promise<any>};
 nativeObserve:(context:any)=>Promise<any>;
 cloudExistingAlbumSession?:()=>Parameters<typeof createTmeExistingAlbumPreparePort>[0]|undefined;
 readExternalReceipt?:(context:any)=>Promise<any>;
 cloudSession?:()=>Parameters<typeof createTmeAiBrowserSubmissionExecutor>[0]|undefined;
 cloudPreparationSession?:()=>Parameters<typeof createTmeAiBrowserPreparePort>[0]|undefined;
 cloudPrepare?:{request(action:string,input:any):Promise<any>;capability():{available:boolean;reason?:string}};
}){
 let existingSession:Parameters<typeof createTmeExistingAlbumPreparePort>[0]|undefined,existingPrepare:ReturnType<typeof createTmeExistingAlbumPreparePort>|undefined,existingSubmit:ReturnType<typeof createTmeExistingAlbumSubmissionExecutor>|undefined;
 const resolveExisting=()=>{const current=o.cloudExistingAlbumSession?.();if(current!==existingSession){existingSession=current;existingPrepare=current?createTmeExistingAlbumPreparePort(current):undefined;existingSubmit=current?createTmeExistingAlbumSubmissionExecutor(current):undefined}return{prepare:existingPrepare,submit:existingSubmit}};
 let session:Parameters<typeof createTmeAiBrowserSubmissionExecutor>[0]|undefined;
 let browser:ReturnType<typeof createTmeAiBrowserSubmissionExecutor>|undefined;
 const resolve=()=>{
  const current=o.cloudSession?.();
  if(current!==session){session=current;browser=current?createTmeAiBrowserSubmissionExecutor(current):undefined}
  return browser;
 };
 let prepSession:Parameters<typeof createTmeAiBrowserPreparePort>[0]|undefined,prepBrowser:ReturnType<typeof createTmeAiBrowserPreparePort>|undefined;
 const resolvePrepare=()=>{const current=o.cloudPreparationSession?.();if(current!==prepSession){prepSession=current;prepBrowser=current?createTmeAiBrowserPreparePort(current):undefined}return prepBrowser};
 const required=()=>{const port=resolveExisting().submit??resolve();if(!port)throw Error('CLOUD_BROWSER_SESSION_REQUIRED');return port};
 const preparationCapability=()=>{if(o.cloudExistingAlbumSession){const port=resolveExisting().prepare;if(!port)return{available:false,reason:'CLOUD_BROWSER_SESSION_REQUIRED'};const c=port.capability();return{available:c.available,reason:c.reasons[0]}}const browser=resolvePrepare();if(browser){const c=browser.capability();return{available:c.available,reason:c.reasons[0]}}return o.cloudPrepare?.capability()??(o.platform==='win32'?{available:true}:{available:false,reason:'CLOUD_PREPARE_CONTRACT_UNVERIFIED'});};
 return{
  preparationCapability,
  prepare:{async request(action:string,input:any){
   const cap=preparationCapability();if(!cap.available)throw Error(cap.reason??'PREPARATION_EXECUTOR_UNAVAILABLE');
   return(resolveExisting().prepare??resolvePrepare()??o.cloudPrepare??o.native).request(action,input);
  }},
  observe:async(context:any)=>{
   const port=resolveExisting().submit??resolve();if(port)return port.observe(context);
   if(o.platform==='win32')return o.nativeObserve(context);
   throw Error('CLOUD_BROWSER_SESSION_REQUIRED');
  },
  executor:{
   capability:():TmeAiSubmissionCapability=>({...((resolveExisting().submit??resolve())?.capability()??{
    available:false,transport:o.platform==='win32'?'windows-uia':'cloud-playwright',
    reasons:o.platform==='win32'?['NATIVE_AI_SUBMIT_CONTRACT_UNVERIFIED','OFFICIAL_RECEIPT_CONTRACT_UNVERIFIED']:['CLOUD_BROWSER_SESSION_REQUIRED','BROWSER_AI_SUBMIT_CONTRACT_UNVERIFIED','OFFICIAL_RECEIPT_CONTRACT_UNVERIFIED'],
   }),readOnlyReceiptAvailable:!!o.readExternalReceipt&&!!o.cloudExistingAlbumSession?.()}),
   readExternalReceipt:async(context:any)=>{if(!o.readExternalReceipt)throw Error('OFFICIAL_RECEIPT_CONTRACT_UNVERIFIED');return o.readExternalReceipt(context)},
   accept:async(context:any)=>required().accept(context),
   submit:async(context:any)=>required().submit(context),
   readReceipt:async(context:any)=>required().readReceipt(context),
  },
 };
}
