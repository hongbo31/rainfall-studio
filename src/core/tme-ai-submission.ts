import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {hash,type Repository,type Row} from './database';
import {TmeAiPrepareGrantSchema,tmeAiSubjectHash} from '../shared/tme-ai-prepare';
import {TmeAiSubmissionReviewSchema,TmeAiSubmissionAuthorizeSchema,TmeAiSubmissionClaimSchema,TmeAiSubmissionRecordSchema,TmeAiSubmissionReconcileSchema} from '../shared/tme-ai-submission';
const prefix='tme-ai-submission:';
type Options={now?:()=>Date;resolvePrepared:(id:string)=>Row;verifyAssets:(grant:any)=>void|boolean};
/** Private Core journal. Ordinary renderer RPC cannot provide evidence or register consent. */
export class TmeAiSubmissionService{
 constructor(readonly repo:Repository,readonly options:Options){
  repo.transaction(()=>{for(const op of repo.all('operations').filter(o=>o.kind==='tme_ai_submission'&&o.state==='dispatching')){
   repo.save('operations',{...op,state:'unknown',reason:'INTERRUPTED_SUBMISSION_ACTION'});
   const job=this.maybe(op.jobId);if(job&&job.operationId===op.id)this.patch(job,{state:'reconcile_required',reason:'INTERRUPTED_SUBMISSION_ACTION'});
  }});
 }
 private now(){return this.options.now?.()??new Date()}
 private stamp(){return this.now().toISOString()}
 private maybe(id:string):Row|undefined{return this.repo.maybe('settings',prefix+id)?.value}
 private get(id:string){const row=this.maybe(id);if(!row)throw Error('NOT_FOUND');return row}
 private rows(){return this.repo.all('settings').filter(r=>r.id.startsWith(prefix)).map(r=>r.value)}
 private put(row:Row){this.repo.save('settings',{id:prefix+row.id,value:row});return row}
 private patch(row:Row,change:Row){return this.put({...row,...change,revision:row.revision+1,updatedAt:this.stamp()})}
 private fresh(stamp:string){const age=this.now().getTime()-Date.parse(stamp);if(!Number.isFinite(age)||age< -5000||age>300000)throw Error('SUBMISSION_REVIEW_STALE')}
 private material(prepareJobId:string){
  const context=this.options.resolvePrepared(prepareJobId),{job,grant}=context;
  if(!job||!grant||grant.suspended||job.state!=='awaiting_terms_review'||!job.localAlbumSnapshot?.localVerified||!job.terms?.termsHash)throw Error('PREPARATION_REQUIRED');
  const input=TmeAiPrepareGrantSchema.parse(grant.input);
  if(job.workId!==input.workId||job.id!==prepareJobId)throw Error('PREPARATION_SCOPE');
  const valid=this.options.verifyAssets(input);if(valid===false)throw Error('ASSET_VERIFICATION_FAILED');
  if(valid&&typeof (valid as any).then==='function')throw Error('SYNCHRONOUS_ASSET_VERIFIER_REQUIRED');
  return{job,input};
 }
 private observe(snapshot:Row,input:Row,termsHash:string,termsDocumentSha256?:string){
  this.fresh(snapshot.observedAt);this.fresh(snapshot.identity.observedAt);
  if(tmeAiSubjectHash(snapshot.identity)!==snapshot.identity.subjectHash||snapshot.identity.subjectHash!==input.identity.subjectHash)throw Error('IDENTITY_SCOPE');
  if(hash(snapshot.binding)!==hash(input.binding))throw Error('WINDOW_BINDING_CHANGED');
  if(snapshot.mode!=='ai_authorization'||!snapshot.visibleSubmitButton||!snapshot.termsText||hash(snapshot.termsText)!==snapshot.termsHash||snapshot.termsHash!==termsHash)throw Error('TERMS_CHANGED');
  if(snapshot.termsDocumentSha256!==termsDocumentSha256)throw Error('TERMS_DOCUMENT_CHANGED');
 }
 private consentScope(job:Row,input:Row){
  const baseline=job.localAlbumSnapshot?.receiptBaseline??job.localAlbumSnapshot?.snapshot?.verified?.receiptBaseline;
  return{prepareJobId:job.id,input,termsHash:job.terms.termsHash,...(job.terms.termsDocumentSha256?{termsDocumentSha256:job.terms.termsDocumentSha256}:{}),...(baseline?{receiptBaseline:baseline}:{})};
 }
 private current(row:Row,snapshot?:Row){
  const {job,input}=this.material(row.prepareJobId);
  if(hash(this.consentScope(job,input))!==row.scopeHash)throw Error('SUBMISSION_SCOPE_CHANGED');
  this.fresh(row.reviewedAt);this.observe(snapshot??row.snapshot,input,row.termsHash,job.terms.termsDocumentSha256);return input;
 }
 private noDispatch(familyKey:string){if(this.repo.all('operations').some(o=>o.kind==='tme_ai_submission'&&o.familyKey===familyKey&&o.phase==='submit'))throw Error('SUBMISSION_ALREADY_DISPATCHED')}
 review(raw:unknown){
  const i=TmeAiSubmissionReviewSchema.parse(raw);
  return this.repo.transaction(()=>{
   const {job,input}=this.material(i.prepareJobId);this.observe(i.snapshot,input,job.terms.termsHash,job.terms.termsDocumentSha256);
   const familyKey=hash([input.identity.subjectHash,input.sourceAudio.sha256]);this.noDispatch(familyKey);
   const scopeHash=hash(this.consentScope(job,input));
   const prior=this.rows().find(r=>r.familyKey===familyKey);
   if(prior&&this.repo.all('operations').some(o=>o.kind==='tme_ai_submission'&&o.jobId===prior.id))throw Error('SUBMISSION_RECONCILIATION_REQUIRED');
   const row={id:prior?.id??randomUUID(),revision:(prior?.revision??0)+1,workId:input.workId,prepareJobId:job.id,title:input.metadata.title,artistName:input.metadata.artistName,familyKey,scopeHash,sessionId:i.sessionId,state:'reviewed',snapshot:i.snapshot,termsHash:i.snapshot.termsHash,...(i.snapshot.termsDocumentSha256?{termsDocumentSha256:i.snapshot.termsDocumentSha256}:{}),termsText:i.snapshot.termsText,modeText:i.snapshot.modeText,contract:i.contract,reviewedAt:this.stamp(),termsAccepted:false,submissionByClient:false,remoteId:null,reason:null,operationId:null,createdAt:prior?.createdAt??this.stamp(),updatedAt:this.stamp()};
   return this.put(row);
  });
 }
 authorize(raw:unknown){
  const i=TmeAiSubmissionAuthorizeSchema.parse(raw);
  return this.repo.transaction(()=>{const row=this.get(i.id);
   if(row.revision!==i.expectedRevision)throw Error('REVISION_CONFLICT');
   if(row.sessionId!==i.sessionId)throw Error('AUTHORIZATION_SESSION_CHANGED');
   if(!row.contract.available)throw Error('EXECUTOR_UNAVAILABLE');
   if(row.state!=='reviewed'||row.termsHash!==i.termsHash)throw Error('TERMS_APPROVAL_SCOPE');
   this.current(row);this.noDispatch(row.familyKey);
   this.repo.audit('tmeAiSubmission.authorize',row.id,{scopeHash:row.scopeHash,termsHash:row.termsHash,...(row.termsDocumentSha256?{termsDocumentSha256:row.termsDocumentSha256}:{}),rightsConfirmed:true});
   return this.patch(row,{state:'authorized',authorizedAt:this.stamp(),rightsConfirmed:true});
  });
 }
 claim(raw:unknown){
  const i=TmeAiSubmissionClaimSchema.parse(raw);
  return this.repo.transaction(()=>{const row=this.get(i.id);
   if(row.revision!==i.expectedRevision)throw Error('REVISION_CONFLICT');
   if(row.sessionId!==i.sessionId)throw Error('AUTHORIZATION_SESSION_CHANGED');
   if(!row.contract.available)throw Error('EXECUTOR_UNAVAILABLE');
   if(row.state!==(i.phase==='accept'?'authorized':'accepted'))throw Error('SUBMISSION_PHASE_SCOPE');
   const input=this.current(row,i.snapshot);this.noDispatch(row.familyKey);
   if(this.repo.all('operations').some(o=>o.kind==='tme_ai_submission'&&o.jobId===row.id&&o.phase===i.phase))throw Error('SUBMISSION_ALREADY_DISPATCHED');
   const prepared=this.material(row.prepareJobId).job,baseline=prepared.localAlbumSnapshot.receiptBaseline??prepared.localAlbumSnapshot.snapshot?.verified?.receiptBaseline;
   const operation={id:randomUUID(),kind:'tme_ai_submission',jobId:row.id,workId:row.workId,familyKey:row.familyKey,scopeHash:row.scopeHash,phase:i.phase,state:'dispatching',createdAt:this.stamp(),...(i.phase==='submit'?{receiptScope:{workId:row.workId,title:row.title,albumTitle:input.metadata.albumTitle,artistName:row.artistName,subjectHash:input.identity.subjectHash,binding:input.binding,sourceAudioSha:input.sourceAudio.sha256,scopeHash:row.scopeHash,...(baseline?{baselineSongIds:[...baseline.songIds]}:{}),...(prepared.terms.termsDocumentSha256?{termsDocumentSha256:prepared.terms.termsDocumentSha256}:{})}}:{})};
   this.repo.save('operations',operation);return{job:this.patch(row,{state:'dispatching',operationId:operation.id,reason:null}),operation};
  });
 }
 private receipt(row:Row,receipt:Row,operation:Row){
  // The external effect belongs to the immutable dispatch intent, even if local files or grants later change.
  const scope=operation.receiptScope;this.fresh(receipt.observedAt);
  if(!scope||operation.kind!=='tme_ai_submission'||operation.phase!=='submit'||operation.jobId!==row.id||scope.workId!==row.workId||scope.scopeHash!==row.scopeHash||operation.scopeHash!==row.scopeHash)throw Error('SUBMISSION_RECEIPT_SCOPE_REQUIRED');
  if(scope.baselineSongIds?.includes(receipt.remoteId))throw Error('OFFICIAL_RECEIPT_ALREADY_IN_BASELINE');
  if(receipt.submittedAtSource==='dispatch-intent'&&receipt.submittedAt!==operation.createdAt)throw Error('DISPATCH_INTENT_TIMESTAMP_SCOPE');
  if(receipt.scopeHash!==scope.scopeHash||receipt.subjectHash!==scope.subjectHash||receipt.title!==scope.title||receipt.artistName!==scope.artistName||Date.parse(receipt.submittedAt)<Date.parse(operation.createdAt)-5000||Date.parse(receipt.submittedAt)>Date.parse(receipt.observedAt)+5000)throw Error('OFFICIAL_RECEIPT_SCOPE');
 }
 record(raw:unknown){
  const i=TmeAiSubmissionRecordSchema.parse(raw);
  return this.repo.transaction(()=>{const row=this.get(i.id),op=this.repo.get('operations',i.operationId),ackHash=hash(i.result);
   if(op.kind!=='tme_ai_submission'||op.jobId!==row.id||op.scopeHash!==row.scopeHash)throw Error('OPERATION_SCOPE');
   if(op.ackHash){if(op.ackHash!==ackHash)throw Error('ACK_CONFLICT');return row}
   if(op.state!=='dispatching'||row.operationId!==op.id||row.state!=='dispatching')throw Error('SUBMISSION_RECONCILIATION_REQUIRED');
   if(i.result.status==='unknown'){
    this.repo.save('operations',{...op,state:'unknown',ackHash,result:i.result});return this.patch(row,{state:'reconcile_required',reason:i.result.reason});
   }
   if(i.result.status==='accepted'){
    if(op.phase!=='accept'||i.result.scopeHash!==row.scopeHash)throw Error('ACCEPTANCE_SCOPE');this.current(row,i.result.snapshot);
    if(Date.parse(i.result.snapshot.observedAt)<Date.parse(op.createdAt))throw Error('RESULT_PRECEDES_CLAIM');
    this.repo.save('operations',{...op,state:'complete',ackHash,result:i.result,completedAt:this.stamp()});
    return this.patch(row,{state:'accepted',termsAccepted:true,reason:null});
   }
   if(op.phase!=='submit')throw Error('SUBMISSION_PHASE_SCOPE');this.receipt(row,i.result.receipt,op);
   this.repo.save('operations',{...op,state:'complete',ackHash,result:i.result,completedAt:this.stamp()});
   return this.patch(row,{state:i.result.receipt.status,remoteId:i.result.receipt.remoteId,receipt:i.result.receipt,submissionByClient:true,reason:null});
  });
 }
 interrupt(raw:unknown){
  const i=z.strictObject({id:z.uuid(),operationId:z.uuid(),reason:z.string().regex(/^[A-Z0-9_]+$/)}).parse(raw);
  return this.repo.transaction(()=>{const row=this.get(i.id),op=this.repo.get('operations',i.operationId);
   if(op.kind!=='tme_ai_submission'||op.jobId!==row.id||row.operationId!==op.id)throw Error('OPERATION_SCOPE');
   if(op.state==='unknown')return row;if(op.state!=='dispatching')throw Error('SUBMISSION_RECONCILIATION_REQUIRED');
   this.repo.save('operations',{...op,state:'unknown',reason:i.reason});return this.patch(row,{state:'reconcile_required',reason:i.reason});
  });
 }
 reconcile(raw:unknown){
  const i=TmeAiSubmissionReconcileSchema.parse(raw);
  return this.repo.transaction(()=>{const row=this.get(i.id),op=this.repo.all('operations').find(o=>o.kind==='tme_ai_submission'&&o.jobId===row.id&&o.phase==='submit');
   if(!op||!['unknown','dispatching','complete'].includes(op.state))throw Error('SUBMISSION_INTENT_REQUIRED');this.receipt(row,i.receipt,op);
   this.repo.save('operations',{...op,state:'complete',reconciledReceipt:i.receipt,reconciledAt:this.stamp()});
   return this.patch(row,{state:i.receipt.status,remoteId:i.receipt.remoteId,receipt:i.receipt,submissionByClient:true,reason:null});
  });
 }
 context(id:string){const job=this.get(z.uuid().parse(id));return{job,prepared:this.options.resolvePrepared(job.prepareJobId),operations:this.repo.all('operations').filter(o=>o.kind==='tme_ai_submission'&&o.jobId===job.id)}}
 receiptContext(id:string){const job=this.get(z.uuid().parse(id)),operations=this.repo.all('operations').filter(o=>o.kind==='tme_ai_submission'&&o.jobId===job.id),intent=operations.find(o=>o.phase==='submit');if(!intent?.receiptScope)throw Error('SUBMISSION_INTENT_REQUIRED');return{job,operations,receiptScope:intent.receiptScope}}
 publicById(id:string){return this.publicJob(this.get(z.uuid().parse(id)))}
 publicJob(row:Row){const {sessionId,snapshot,familyKey,...value}=row;return value}
 listPublic(workId:string){return this.rows().filter(r=>r.workId===z.uuid().parse(workId)).map(r=>this.publicJob(r))}
}
