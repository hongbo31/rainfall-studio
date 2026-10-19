import {tmeAiSubjectHash} from '../shared/tme-ai-prepare';
import {hasPlanAlbumAdapter,PlanAlbumTargetSchema,PlanAlbumOperationIdSchema,PlanAlbumAuthorizeSchema,type PlanAlbumScope,type PlanAlbumOperation,type PlanAlbumResult} from '../shared/plan-albums';
import type {createTmeAlbumBrowserTransport,TmeAlbumBrowserAccount,TmeAlbumCreateClaim,TmeAlbumCreateResult} from './tme/album-browser';

type Transport=ReturnType<typeof createTmeAlbumBrowserTransport>;
type Session={transport:Transport;account:()=>Promise<TmeAlbumBrowserAccount>};
type Options={rpc:(method:string,input?:any)=>Promise<any>;available:()=>boolean;generation:()=>number;getSession:(scope:PlanAlbumScope)=>Session|undefined;now?:()=>Date;onAppend?:(taskId:string)=>Promise<unknown>|void;reconcileAppend?:(taskId:string)=>Promise<unknown>};
const supported=hasPlanAlbumAdapter;
const code=(e:unknown)=>e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'ALBUM_TRANSPORT_OUTCOME_UNKNOWN';
/** Main owns the calibrated transport. Renderer inputs never supply evidence, selectors,
 * account fingerprints or result receipts. The durable Core claim precedes every create. */
export function createPlanAlbumBroker(o:Options){
 let busy=false;
 const raw=async(method:string,input:any={})=>{const r=await o.rpc(method,input);if(!r.ok)throw Error(r.error?.code??'ALBUM_CORE_REJECTED');return r.value;};
 const available=()=>{if(!o.available())throw Error('PRODUCTION_REQUIRED');};
 const current=(generation:number)=>{available();if(o.generation()!==generation)throw Error('WORKSPACE_CHANGED');};
 const scope=async(input:unknown)=>raw('internal.planAlbums.scope',PlanAlbumTargetSchema.parse(input));
 const context=async(input:unknown)=>raw('internal.planAlbums.context',PlanAlbumOperationIdSchema.parse(input));
 function capabilities(s:PlanAlbumScope,identityReason?:string){
  const implemented=supported(s.platform),session=implemented&&!identityReason?o.getSession(s):undefined,c=session?.transport.capability();
  const connection=[...(identityReason?[identityReason]:[]),...(session?[]:['CLOUD_BROWSER_SESSION_REQUIRED'])],unsupported=['PLATFORM_ALBUM_ADAPTER_NOT_IMPLEMENTED'];
  const part=(kind:'query'|'select'|'create'|'append'|'reconcile')=>({implemented,available:implemented&&!!session&&c?.[kind]?.available===true,reasons:implemented?[...new Set([...(c?.[kind]?.reasons??(kind==='create'||kind==='reconcile'?['ALBUM_CREATE_CONTRACT_UNCALIBRATED']:kind==='append'?['EXISTING_ALBUM_WRITE_INTEGRATION_UNVERIFIED']:[])),...connection])]:unsupported});
  return{...s,...(identityReason?{accountFingerprint:undefined}:{}),sessionConnected:!!session,source:c?.source??'official',query:{...part('query'),paginationImplemented:true,coverage:'published-and-unpublished-albums',completeness:'reported-by-query-result'},select:{...part('select'),bindingRequiresRemoteId:true},create:{...part('create'),missing:c?.create?.missing??['create route and required controls','remote album ID and original-operation result','production calibration evidence']},append:{...part('append'),requiresExistingPreparation:true,requiresRightsAndTerms:true},reconcile:part('reconcile')};
 }
 function sessionFor(s:PlanAlbumScope,kind:'query'|'create'|'append'|'reconcile'){
  const c=capabilities(s),part=c[kind];if(!part.available)throw Error(part.reasons[0]??'ALBUM_TRANSPORT_UNAVAILABLE');return o.getSession(s)!;
 }
 async function observed(session:Session,s:PlanAlbumScope,artistName?:string){
  const a=await session.account(),subject=tmeAiSubjectHash(a.identity);
  if(subject!==s.accountFingerprint||artistName!==undefined&&a.identity.artistName!==artistName)throw Error('ACCOUNT_SCOPE_CHANGED');
  return a;
 }
 const resultBase=(op:PlanAlbumOperation,source:PlanAlbumResult['source'])=>({operationId:op.id,scope:op.scope,source});
 function createResult(op:PlanAlbumOperation,r:TmeAlbumCreateResult):PlanAlbumResult{
  if(r.status==='succeeded'){
   if(r.operationId!==op.id||r.idempotencyKey!==op.idempotencyKey||r.subjectHash!==op.scope.accountFingerprint||op.selection.mode!=='new'||r.title!==op.selection.title||!r.remoteAlbumId||!r.evidenceHash)throw Error('ALBUM_RESULT_SCOPE');
   return{...resultBase(op,r.source),status:'succeeded',albumId:r.remoteAlbumId,evidenceHash:r.evidenceHash,receipt:{operationId:r.operationId,idempotencyKey:r.idempotencyKey,subjectHash:r.subjectHash,title:r.title,observedAt:r.observedAt}};
  }
  return{...resultBase(op,r.source),status:'unknown',reason:r.reason??'ALBUM_CREATE_OUTCOME_UNKNOWN'};
 }
 async function appendResult(op:PlanAlbumOperation,reconciling:boolean){
  const r=await raw('internal.planAlbums.appendResult',{operationId:op.id});
  // Waiting for the original rights/terms flow is ordinary pending work, not a remote success.
  if(r.status==='pending')return{...op,reason:r.reason??'AWAITING_ORIGINAL_PUBLICATION'};
  return raw(reconciling?'internal.planAlbums.reconcile':'internal.planAlbums.record',{...r,...resultBase(op,r.source??'official')});
 }
 async function confirm(input:unknown,generation:number){
  const p=PlanAlbumAuthorizeSchema.parse(input),c=await context({operationId:p.operationId}),op=c.operation as PlanAlbumOperation;
  if(['unknown','dispatching'].includes(op.state))throw Error('ALBUM_RECONCILE_REQUIRED');
  if(['succeeded','failed','not_found'].includes(op.state))throw Error('ALBUM_OPERATION_TERMINAL');
  const preview=await raw('planAlbums.preview',{operationId:op.id});if(preview.summaryHash!==p.summaryHash)throw Error('ALBUM_AUTHORIZATION_STALE');
  const session=sessionFor(op.scope,op.kind==='create'?'create':'append'),account=await observed(session,op.scope,c.artistName);
  current(generation);await raw('internal.planAlbums.authorize',p);current(generation);
  const claimed=await raw('internal.planAlbums.claim',{operationId:op.id,summaryHash:p.summaryHash}) as PlanAlbumOperation;
  try{
   current(generation);
   if(op.kind==='append'){
    const activation=await raw('internal.planAlbums.activateAppend',{operationId:op.id});current(generation);
    if(activation.publicationTaskId!==op.publicationTaskId)throw Error('ALBUM_RECEIPT_TASK_SCOPE');
    await o.onAppend?.(activation.publicationTaskId);current(generation);return await appendResult(claimed,false);
   }
   const claim:TmeAlbumCreateClaim={operationId:op.id,idempotencyKey:op.idempotencyKey,requestHash:op.requestHash,state:'dispatching',title:op.selection.mode==='new'?op.selection.title:'',description:op.selection.mode==='new'?op.selection.description:undefined,artistName:c.artistName,subjectHash:op.scope.accountFingerprint,binding:account.binding,createdAt:claimed.authorizedAt??claimed.createdAt};
   const r=await session.transport.create(claim);current(generation);
   return await raw('internal.planAlbums.record',createResult(op,r));
  }catch(e){
   current(generation);
   return raw('internal.planAlbums.record',{...resultBase(op,session.transport.capability().source),status:'unknown',reason:code(e)});
  }
 }
 async function reconcile(input:unknown,generation:number){
  const c=await context(input),op=c.operation as PlanAlbumOperation;
  if(op.state==='succeeded')return op;
  if(!['unknown','dispatching'].includes(op.state))throw Error('ALBUM_OPERATION_NOT_CLAIMED');
  if(op.kind==='append'){
   if(op.publicationTaskId)await o.reconcileAppend?.(op.publicationTaskId);current(generation);return appendResult(op,true);
  }
  const session=sessionFor(op.scope,'reconcile'),account=await observed(session,op.scope,c.artistName);current(generation);
  const claim:TmeAlbumCreateClaim={operationId:op.id,idempotencyKey:op.idempotencyKey,requestHash:op.requestHash,state:'unknown',title:op.selection.mode==='new'?op.selection.title:'',description:op.selection.mode==='new'?op.selection.description:undefined,artistName:c.artistName,subjectHash:op.scope.accountFingerprint,binding:account.binding,createdAt:op.authorizedAt??op.createdAt};
  const r=await session.transport.reconcile(claim);current(generation);return raw('internal.planAlbums.reconcile',createResult(op,r));
 }
 return{async ui(action:string,input:unknown={}){
  available();const generation=o.generation();
  if(!['capabilities','refresh','confirm','reconcile'].includes(action))throw Error('METHOD_NOT_ALLOWED');
  if(action==='capabilities'){
   const target=PlanAlbumTargetSchema.parse(input);
   try{const s=await scope(target);current(generation);return capabilities(s);}
   catch(e){current(generation);if(code(e)!=='ALBUM_ACCOUNT_IDENTITY_REQUIRED')throw e;return capabilities({...target,accountFingerprint:''},'ALBUM_ACCOUNT_IDENTITY_REQUIRED');}
  }
  if(busy)throw Error('ALBUM_OPERATION_BUSY');busy=true;
  try{
   if(action==='refresh'){
    const s=await scope(input),session=sessionFor(s,'query');await observed(session,s);current(generation);
    const c=await session.transport.catalog({includeOfficialReferences:true,includeOfficialDirectory:true});current(generation);
    if(c.scope.subjectHash!==s.accountFingerprint)throw Error('ALBUM_CATALOG_ACCOUNT_SCOPE');
    const observedAt=Date.parse(c.observedAt),now=(o.now?.()??new Date()).getTime();if(!Number.isFinite(observedAt)||observedAt>now+5000||now-observedAt>120000)throw Error('ALBUM_CATALOG_STALE');
    return raw('internal.planAlbums.recordCatalog',{scope:s,source:c.source,completeness:c.completeness,...(c.coverage?{coverage:c.coverage}:{}),observedAt:c.observedAt,expiresAt:new Date(observedAt+15*60*1000).toISOString(),evidenceHash:c.evidenceHash,entries:c.entries.map(e=>({key:e.candidateKey,id:e.remoteAlbumId??null,title:e.title}))});
   }
   return action==='confirm'?await confirm(input,generation):await reconcile(input,generation);
  }finally{busy=false;}
 }};
}
