import {z} from 'zod';
import {createTmeAiPrepareBroker} from './ai-prepare';
import {createTmeAiSubmissionBroker} from './ai-submission';
import type {PlanPublicationTaskScope} from '../../shared/plan-publication';

type Broker={ui(action:string,input?:any):Promise<any>};
type PrepareOptions=Parameters<typeof createTmeAiPrepareBroker>[0];
type SubmissionOptions=Parameters<typeof createTmeAiSubmissionBroker>[0];
const scopeSchema=z.strictObject({workId:z.uuid(),publicationTaskId:z.uuid(),accountId:z.uuid()});
/** Main only. Each task keeps its own existing nonce/session broker; native operations share one lock. */
export function createPlanPublicationBrokers(o:{prepare:PrepareOptions;submission:SubmissionOptions}){
 let busy=false,generation=o.prepare.generation();
 // A broker may time out while its original native read is still restoring a tab.
 // Keep that exact transport promise locked until it settles, across every task/broker.
 const pendingNative=new Set<Promise<unknown>>();
 const native=async<T>(invoke:()=>Promise<T>):Promise<T>=>{
  if(pendingNative.size)throw Error('PUBLICATION_BUSY');
  const pending=Promise.resolve(invoke());pendingNative.add(pending);
  try{return await pending;}finally{pendingNative.delete(pending);}
 };
 const prepareOptions:PrepareOptions={...o.prepare,port:{request:(action,input)=>native(()=>o.prepare.port.request(action,input))}};
 const executor=o.submission.executor;
 const submissionOptions:SubmissionOptions={...o.submission,observe:context=>native(()=>o.submission.observe(context)),...(executor?{executor:{
  capability:()=>executor.capability(),accept:context=>native(()=>executor.accept(context)),submit:context=>native(()=>executor.submit(context)),readReceipt:context=>native(()=>executor.readReceipt(context)),
  ...(executor.readExternalReceipt?{readExternalReceipt:(context:any)=>native(()=>executor.readExternalReceipt!(context))}:{}),
 }}:{})};
 const legacyPrepare=createTmeAiPrepareBroker(prepareOptions),legacySubmission=createTmeAiSubmissionBroker(submissionOptions);
 const pairs=new Map<string,{prepare:Broker;submission:Broker}>();
 const raw=async(method:string,input:any)=>{const result=await o.prepare.rpc(method,input);if(!result.ok)throw Error(result.error.code);return result.value};
 const scopeFromGrant=(grant:any):PlanPublicationTaskScope|null=>{
  const g=grant?.input;if(!g)throw Error('PREPARATION_ACCOUNT_SCOPE');
  if(!g.publicationTaskId&&!g.accountId)return null;
  const parsed=scopeSchema.safeParse({workId:g.workId,publicationTaskId:g.publicationTaskId,accountId:g.accountId});
  if(!parsed.success)throw Error('PREPARATION_ACCOUNT_SCOPE');return parsed.data;
 };
 const sameScope=(a:PlanPublicationTaskScope|null,b:PlanPublicationTaskScope)=>!!a&&a.workId===b.workId&&a.publicationTaskId===b.publicationTaskId&&a.accountId===b.accountId;
 const checkPrepared=(context:any,id:string)=>{
  if(context?.job?.id!==id||context.job.workId!==context.grant?.input?.workId||context.job.grantId!==context.grant?.id)throw Error('PREPARATION_ACCOUNT_SCOPE');
  return scopeFromGrant(context.grant);
 };
 const checkSubmission=(context:any,id:string)=>{
  if(context?.job?.id!==id||context.job.workId!==context.prepared?.job?.workId||context.job.prepareJobId!==context.prepared?.job?.id)throw Error('SUBMISSION_ACCOUNT_SCOPE');
  try{return checkPrepared(context.prepared,context.job.prepareJobId);}catch{throw Error('SUBMISSION_ACCOUNT_SCOPE');}
 };
 const pair=(scope:PlanPublicationTaskScope)=>{
  if(generation!==o.prepare.generation()){pairs.clear();generation=o.prepare.generation();}
  const key=scope.publicationTaskId+':'+scope.accountId,prior=pairs.get(key);if(prior)return prior;
  const scopedRpc:PrepareOptions['rpc']=async(method,input={})=>{
   // A caller-supplied task/account never authorizes another grant, job, or operation.
   if(method.startsWith('internal.tmeAiPrepare.')&&method!=='internal.tmeAiPrepare.grantContext'&&input.id){const actual=checkPrepared(await raw('internal.tmeAiPrepare.context',{id:input.id}),input.id);if(!sameScope(actual,scope))throw Error('PREPARATION_ACCOUNT_SCOPE');}
   if(method==='internal.tmeAiPrepare.start'||method==='internal.tmeAiPrepare.grantContext'){
    const id=input.grantId??input.id,grant=await raw('internal.tmeAiPrepare.grantContext',{id});if(grant.id!==id||!sameScope(scopeFromGrant(grant),scope))throw Error('PREPARATION_ACCOUNT_SCOPE');
   }
   if(method==='internal.tmeAiSubmission.review'){const actual=checkPrepared(await raw('internal.tmeAiPrepare.context',{id:input.prepareJobId}),input.prepareJobId);if(!sameScope(actual,scope))throw Error('SUBMISSION_ACCOUNT_SCOPE');}
   if(method==='internal.tmeAiSubmission.preparedContext'){
    const actual=checkPrepared(await raw('internal.tmeAiPrepare.context',{id:input.id}),input.id);if(!sameScope(actual,scope))throw Error('SUBMISSION_ACCOUNT_SCOPE');
   }else if(method.startsWith('internal.tmeAiSubmission.')&&input.id){const actual=checkSubmission(await raw('internal.tmeAiSubmission.context',{id:input.id}),input.id);if(!sameScope(actual,scope))throw Error('SUBMISSION_ACCOUNT_SCOPE');}
   if(method==='internal.tmeAiPrepare.registerScopedGrant')input={...input,publicationTaskId:scope.publicationTaskId,accountId:scope.accountId,grant:{...input.grant,publicationTaskId:scope.publicationTaskId,accountId:scope.accountId}};
   if(method==='internal.tmeAiSubmission.inspectWork'||method==='internal.tmeAiSubmission.listPublic')input={...input,publicationTaskId:scope.publicationTaskId,accountId:scope.accountId};
   const result=await o.prepare.rpc(method,input);
   if(result.ok&&method==='internal.tmeAiPrepare.listPublic'){
    const grants=result.value.grants.filter((g:any)=>g.workId===scope.workId&&g.publicationTaskId===scope.publicationTaskId&&g.accountId===scope.accountId),ids=new Set(grants.map((g:any)=>g.id));
    return{...result,value:{...result.value,grants,jobs:result.value.jobs.filter((job:any)=>ids.has(job.grantId))}};
   }
   return result;
  };
  const prepare=createTmeAiPrepareBroker({...prepareOptions,rpc:scopedRpc,resolveScope:async(workId,createDerivative)=>{
   if(workId&&workId!==scope.workId)throw Error('PREPARATION_ACCOUNT_SCOPE');
   return raw('internal.tmeAiPrepare.resolveScope',{...scope,createDerivative});
  }});
  const submission=createTmeAiSubmissionBroker({...submissionOptions,rpc:scopedRpc});
  const value={prepare,submission};pairs.set(key,value);return value;
 };
 const selected=async(kind:'prepare'|'submission',action:string,input:any):Promise<PlanPublicationTaskScope|null>=>{
  let actual:PlanPublicationTaskScope|null=null,workId=input.workId,hasStoredScope=false;
  const error=kind==='prepare'?'PREPARATION_ACCOUNT_SCOPE':'SUBMISSION_ACCOUNT_SCOPE';
  if(kind==='prepare'&&action==='start'){
   const grant=await raw('internal.tmeAiPrepare.grantContext',{id:input.grantId});if(grant?.id!==input.grantId)throw Error(error);
   actual=scopeFromGrant(grant);workId=grant.input.workId;hasStoredScope=true;
  }else if(kind==='prepare'&&input.id){
   const context=await raw('internal.tmeAiPrepare.context',{id:input.id});actual=checkPrepared(context,input.id);workId=context.job.workId;hasStoredScope=true;
  }else if(kind==='submission'&&input.id){
   // Historical external receipts have a work ID rather than a submission job.
   if(action==='reconcile'&&!input.publicationTaskId&&!input.accountId&&await raw('internal.tmeAiSubmission.externalContext',{id:input.id}))return null;
   const context=await raw('internal.tmeAiSubmission.context',{id:input.id});actual=checkSubmission(context,input.id);workId=context.job.workId;hasStoredScope=true;
  }
  if(input.workId&&input.workId!==workId)throw Error(error);
  if(input.publicationTaskId||input.accountId){const parsed=scopeSchema.safeParse({workId,publicationTaskId:input.publicationTaskId,accountId:input.accountId});if(!parsed.success||hasStoredScope&&!sameScope(actual,parsed.data))throw Error(error);return parsed.data;}
  return actual;
 };
 const broker=(kind:'prepare'|'submission'):Broker=>({async ui(action,input={}){
  const mutating=!['list','context','status'].includes(action);
  if(mutating&&(busy||pendingNative.size))throw Error('PUBLICATION_BUSY');if(mutating)busy=true;
  try{
   const scope=await selected(kind,action,input),{publicationTaskId,accountId,...legacyInput}=input;
   if(input.id||input.grantId)delete legacyInput.workId;
   return await (scope?pair(scope)[kind]:kind==='prepare'?legacyPrepare:legacySubmission).ui(action,legacyInput);
  }finally{if(mutating)busy=false;}
 }});
 return{prepare:broker('prepare'),submission:broker('submission'),albums:createPlanPublicationAlbumProvider()};
}

type AlbumScope={platform:string;accountId:string;accountFingerprint:string};
type AlbumCatalog={platform:string;accountId:string;accountFingerprint:string;source:'offline-fixture';observedAt:string;evidenceId:string;albums:Array<{id:string;title:string}>};
type FixtureAlbumTransport={environment:'offline-fixture';catalog(scope:AlbumScope):Promise<AlbumCatalog>};
/** Installed production transport intentionally has no catalog/create/append implementation. */
export function createPlanPublicationAlbumProvider(fixture?:FixtureAlbumTransport){
 const capabilities=()=>({albumCatalog:{available:fixture?.environment==='offline-fixture',reason:fixture?.environment==='offline-fixture'?'OFFLINE_FIXTURE_ONLY':'OFFICIAL_ALBUM_CATALOG_UNAVAILABLE'},albumCreate:{available:false,reason:'ALBUM_CREATE_UNAVAILABLE'},albumAppend:{available:false,reason:'ALBUM_APPEND_UNAVAILABLE'}});
 return{capabilities,async catalog(scope:AlbumScope){
  if(!fixture||fixture.environment!=='offline-fixture')throw Error('OFFICIAL_ALBUM_CATALOG_UNAVAILABLE');
  const result=await fixture.catalog(scope);
  if(result.platform!==scope.platform||result.accountId!==scope.accountId||result.accountFingerprint!==scope.accountFingerprint||result.source!=='offline-fixture'||!result.evidenceId||!Number.isFinite(Date.parse(result.observedAt)))throw Error('ALBUM_CATALOG_ACCOUNT_SCOPE');
  return result;
 }};
}
