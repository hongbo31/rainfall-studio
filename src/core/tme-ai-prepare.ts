import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {hash,type Repository,type Row} from './database';
import {TmeAiPrepareGrantSchema,TmeAiPrepareStartSchema,TmeAiPrepareClaimSchema,TmeAiPrepareRecordSchema,TmeAiPrepareIdentitySchema,TmeAiPrepareSnapshotSchema,tmeAiSubjectHash,tmeAiPrepareSteps,type TmeAiPrepareGrant,type TmeAiPrepareSnapshot} from '../shared/tme-ai-prepare';

const prefix='tme-ai-prepare:';
const IdSchema=z.strictObject({id:z.uuid()});
const PickerDialogSchema=z.strictObject({handle:z.string().regex(/^[1-9]\d*$/),owner:z.string().min(1),pid:z.number().int().positive(),name:z.literal('打开'),actualDirectory:z.string().min(1).max(32768),selectedFileName:z.null()});
type PickerDialog=z.infer<typeof PickerDialogSchema>;
const CropSelectionSchema=z.strictObject({path:z.string().min(1).max(32768),sha256:z.string().regex(/^[a-f0-9]{64}$/),dialogHandle:z.string().regex(/^[1-9]\d*$/),phase:z.literal('file_selected_crop_pending'),provenance:z.literal('phase_contract_reconstruction'),hostSourceHash:z.string().regex(/^[a-f0-9]{64}$/),evidenceHash:z.string().regex(/^[a-f0-9]{64}$/),remoteContentShaVerified:z.literal(false)});
type CropSelection=z.infer<typeof CropSelectionSchema>;
type Options={now?:()=>Date;verifyAssets?:(grant:TmeAiPrepareGrant)=>void|boolean;verifyResumePicker?:(grant:TmeAiPrepareGrant,dialog:PickerDialog)=>void|boolean;verifyResumeCrop?:(grant:TmeAiPrepareGrant,selection:CropSelection)=>void|boolean};
/** Private Core journal. Only Main may supply native evidence or register grants. */
export class TmeAiPrepareService {
 constructor(readonly repo:Repository,readonly options:Options={}){
  repo.transaction(()=>{
   for(const op of repo.all('operations').filter(o=>o.kind==='tme_ai_prepare'&&o.state==='dispatching')){
    repo.save('operations',{...op,state:'unknown',reason:'INTERRUPTED_NATIVE_ACTION'});
    const job=this.maybe('job',op.jobId);
    if(job&&job.operationId===op.id)this.patch(job,{state:'reconcile_required',reason:'INTERRUPTED_NATIVE_ACTION'});
   }
  });
 }
 private now(){return this.options.now?.()??new Date()}
 private stamp(){return this.now().toISOString()}
 private maybe(kind:string,id:string):Row|undefined{return this.repo.maybe('settings',prefix+kind+':'+id)?.value}
 private get(kind:string,id:string):Row{const value=this.maybe(kind,id);if(!value)throw Error('NOT_FOUND');return value}
 private put(kind:string,value:Row){this.repo.save('settings',{id:prefix+kind+':'+value.id,value});return value}
 private rows(kind:string){return this.repo.all('settings').filter(r=>r.id.startsWith(prefix+kind+':')).map(r=>r.value)}
 private patch(job:Row,change:Row){return this.put('job',{...job,...change,revision:job.revision+1,updatedAt:this.stamp()})}
 private fresh(stamp:string){const age=this.now().getTime()-new Date(stamp).getTime();if(!Number.isFinite(age)||age< -5000||age>5*60*1000)throw Error('IDENTITY_OR_SNAPSHOT_STALE')}
 private identity(identity:unknown,expected?:Row){
  const i=TmeAiPrepareIdentitySchema.parse(identity);this.fresh(i.observedAt);
  if(tmeAiSubjectHash(i)!==i.subjectHash||expected&&i.subjectHash!==expected.subjectHash)throw Error('IDENTITY_SCOPE');return i;
 }
 private binding(actual:Row,expected:Row){if(hash(actual)!==hash(expected))throw Error('WINDOW_BINDING_CHANGED')}
 private assets(grant:Row){
  if(!this.options.verifyAssets)throw Error('ASSET_VERIFIER_REQUIRED');
  const result=this.options.verifyAssets(TmeAiPrepareGrantSchema.parse(grant.input));
  if(result===false)throw Error('ASSET_VERIFICATION_FAILED');
  if(result&&typeof (result as any).then==='function')throw Error('SYNCHRONOUS_ASSET_VERIFIER_REQUIRED');
 }
 private snapshot(s:TmeAiPrepareSnapshot,grant:Row){this.fresh(s.observedAt);this.identity(s.identity,grant.input.identity);this.binding(s.binding,grant.input.binding)}
 registerGrant(raw:unknown){
  const input=TmeAiPrepareGrantSchema.parse(raw);
  return this.repo.transaction(()=>{
   this.identity(input.identity);
   if(input.upload.derivedFromSha256!==input.sourceAudio.sha256)throw Error('SOURCE_AUDIO_SCOPE');
   if(input.metadata.artistName!==input.identity.artistName)throw Error('ARTIST_IDENTITY_SCOPE');
   const inputHash=hash(input),old=this.maybe('grant',input.id);
   if(old){if(old.inputHash!==inputHash)throw Error('GRANT_CONFLICT');return old}
   const familyKey=hash([input.identity.subjectHash,input.sourceAudio.sha256]);
   if(this.rows('grant').some(g=>g.familyKey===familyKey))throw Error('FAMILY_ALREADY_REGISTERED');
   if(this.rows('grant').some(g=>g.input.workId===input.workId&&g.input.identity.subjectHash===input.identity.subjectHash))throw Error('WORK_ALREADY_REGISTERED');
   const grant={id:input.id,revision:1,input,inputHash,familyKey,createdAt:this.stamp()};
   this.assets(grant);this.put('grant',grant);
   this.repo.audit('tmeAiPrepare.grant',grant.id,{familyKey,scope:'prepare_only',variant:'A'});return grant;
  });
 }
 start(raw:unknown){
  const i=TmeAiPrepareStartSchema.parse(raw);
  return this.repo.transaction(()=>{
   const grant=this.get('grant',i.grantId);
   if(grant.suspended)throw Error('RESTORED_REQUIRES_REVIEW');
   if(grant.revision!==i.expectedRevision)throw Error('REVISION_CONFLICT');
   this.identity(i.identity,grant.input.identity);this.binding(i.binding,grant.input.binding);this.assets(grant);
   const prior=this.rows('job').find(j=>j.grantId===grant.id);
   if(prior)return prior;
   if(this.rows('job').some(j=>j.familyKey===grant.familyKey))throw Error('FAMILY_ALREADY_STARTED');
   const job={id:randomUUID(),grantId:grant.id,familyKey:grant.familyKey,workId:grant.input.workId,revision:1,state:'ready',step:tmeAiPrepareSteps[0],stepIndex:0,operationId:null,audioDisposition:null,remoteId:null,submissionByClient:false,terms:null,reason:null,createdAt:this.stamp(),updatedAt:this.stamp()};
   this.put('job',job);this.repo.audit('tmeAiPrepare.start',job.id,{grantId:grant.id});return job;
  });
 }
 claim(raw:unknown){
  const i=TmeAiPrepareClaimSchema.parse(raw);
  return this.repo.transaction(()=>{
   const job=this.get('job',i.id),grant=this.get('grant',job.grantId);
   if(grant.suspended||job.reason==='RESTORED_REQUIRES_REVIEW')throw Error('RESTORED_REQUIRES_REVIEW');
   if(job.revision!==i.expectedRevision)throw Error('REVISION_CONFLICT');
   if(job.state==='reconcile_required')throw Error('RECONCILIATION_REQUIRED');
   if(job.state!=='ready'||job.step!==i.step)throw Error('PREPARE_STEP_SCOPE');
   if(i.step==='advance_to_terms'&&!job.localAlbumSnapshot?.localVerified)throw Error('LOCAL_ALBUM_SNAPSHOT_REQUIRED');
   this.snapshot(i.before,grant);this.assets(grant);
   if(i.before.mode==='unknown'||i.before.mode==='ai_authorization')throw Error('PREPARE_PAGE_SCOPE');
   const operation={id:randomUUID(),operationKey:prefix+job.id+':'+i.step,kind:'tme_ai_prepare',jobId:job.id,grantId:grant.id,familyKey:grant.familyKey,step:i.step,state:'dispatching',before:i.before,createdAt:this.stamp()};
   if(this.repo.all('operations').some(o=>o.operationKey===operation.operationKey))throw Error('STEP_ALREADY_CLAIMED');
   this.repo.save('operations',operation);
   return {job:this.patch(job,{state:'dispatching',operationId:operation.id}),grant,operation};
  });
 }
 private verifyStep(step:string,s:TmeAiPrepareSnapshot,grant:Row){
  const a=grant.input,v=s.verified,index=tmeAiPrepareSteps.indexOf(step as any);
  if(index>=1&&(v.sourceAudioSha!==a.sourceAudio.sha256||v.uploadSha!==a.upload.sha256))throw Error('MATERIAL_AUDIO_PROOF_REQUIRED');
  if(index>=2&&(v.metadataHash!==hash(a.metadata)||v.lyricsHash!==a.lyricsHash))throw Error('MATERIAL_METADATA_PROOF_REQUIRED');
  if(index>=3&&v.coverSha!==a.cover.sha256)throw Error('MATERIAL_COVER_PROOF_REQUIRED');
  if(index>=4&&v.albumSaved!==true)throw Error('MATERIAL_ALBUM_SAVE_PROOF_REQUIRED');
  if(index===5&&!(s.mode==='ai_authorization'&&s.modeText.trim()&&s.termsText?.trim()&&s.termsHash===hash(s.termsText)&&s.visibleSubmitButton))throw Error('TERMS_REVIEW_EVIDENCE_REQUIRED');
  if(index<5&&(s.mode==='unknown'||s.mode==='ai_authorization'))throw Error('PREPARE_PAGE_SCOPE');
 }
 record(raw:unknown){
  const i=TmeAiPrepareRecordSchema.parse(raw);
  return this.repo.transaction(()=>{
   const job=this.get('job',i.id),op=this.repo.get('operations',i.operationId),grant=this.get('grant',job.grantId),ackHash=hash(i.result);
   if(op.kind!=='tme_ai_prepare'||op.jobId!==job.id||op.grantId!==grant.id)throw Error('OPERATION_SCOPE');
   if(op.pickerResume?.original.ackHash===ackHash||op.cropResume?.original.ackHash===ackHash||op.readOnlyCoverReconciliation?.original.ackHash===ackHash||op.readOnlyTermsReconciliation?.original.ackHash===ackHash)throw Error('ACK_CONFLICT');
   if(op.ackHash){if(op.ackHash!==ackHash)throw Error('ACK_CONFLICT');return job}
   if(job.operationId!==op.id||op.state!=='dispatching'||job.state!=='dispatching')throw Error('RECONCILIATION_REQUIRED');
   this.snapshot(i.result.snapshot,grant);
   if(new Date(i.result.snapshot.observedAt).getTime()<new Date(op.cropResume?.createdAt??op.pickerResume?.createdAt??op.createdAt).getTime())throw Error('RESULT_PRECEDES_CLAIM');
   if(['unknown','blocked'].includes(i.result.status)){
    this.repo.save('operations',{...op,state:'unknown',result:i.result,ackHash,completedAt:this.stamp()});
    return this.patch(job,{state:'reconcile_required',reason:i.result.reason??'NATIVE_OUTCOME_UNKNOWN'});
   }
   this.assets(grant);this.verifyStep(op.step,i.result.snapshot,grant);
   if(op.step==='advance_to_terms'&&!job.localAlbumSnapshot?.localVerified)throw Error('LOCAL_ALBUM_SNAPSHOT_REQUIRED');
   this.repo.save('operations',{...op,state:'complete',result:i.result,ackHash,completedAt:this.stamp()});
   const final=op.step==='advance_to_terms',s=i.result.snapshot;
   return this.patch(job,{state:final?'awaiting_terms_review':'ready',stepIndex:job.stepIndex+1,step:final?null:tmeAiPrepareSteps[job.stepIndex+1],reason:null,...(op.step==='upload_audio'?{audioDisposition:i.result.status==='verified_existing'?'verified_existing':'client_uploaded'}:{}),...(op.step==='save_album'?{localAlbumSnapshot:{operationId:op.id,localVerified:true,externalSaveOutcome:'not_attempted',remoteAlbumSaveVerified:false,noRetry:true,snapshot:s,observedAt:s.observedAt,evidenceHash:s.evidenceHash}}:{}),...(final?{terms:{termsText:s.termsText,termsHash:s.termsHash,modeText:s.modeText,evidenceHash:s.evidenceHash,observedAt:s.observedAt,visibleSubmitButton:true}}:{}),remoteId:null,submissionByClient:false});
  });
 }
 block(raw:unknown){
  const i=z.strictObject({id:z.uuid(),expectedRevision:z.number().int().positive(),reason:z.string().regex(/^[A-Z0-9_]+$/).max(120)}).parse(raw);
  return this.repo.transaction(()=>{const job=this.get('job',i.id);if(job.revision!==i.expectedRevision)throw Error('REVISION_CONFLICT');if(job.state!=='ready')throw Error('BLOCK_SCOPE');return this.patch(job,{state:'blocked',reason:i.reason})});
 }
 interrupt(raw:unknown){
  const i=z.strictObject({id:z.uuid(),operationId:z.uuid(),reason:z.string().regex(/^[A-Z0-9_]+$/).max(120)}).parse(raw);
  return this.repo.transaction(()=>{
   const job=this.get('job',i.id),op=this.repo.get('operations',i.operationId),interruptHash=hash(i);
   if(op.kind!=='tme_ai_prepare'||op.jobId!==job.id||op.grantId!==job.grantId||job.operationId!==op.id)throw Error('OPERATION_SCOPE');
   if(op.interruptHash){if(op.interruptHash!==interruptHash)throw Error('INTERRUPT_CONFLICT');return job}
   if(op.state!=='dispatching'||job.state!=='dispatching')throw Error('RECONCILIATION_REQUIRED');
   this.repo.save('operations',{...op,state:'unknown',interruptHash,reason:i.reason,interruptedAt:this.stamp()});
   return this.patch(job,{state:'reconcile_required',reason:i.reason});
  });
 }
 /** One continuation of an untouched, still-owned cover picker. Never a generic retry. */
 resumeInterruptedPicker(raw:unknown){
  const i=z.strictObject({id:z.uuid(),operationId:z.uuid(),reason:z.literal('FILE_NAME_CONTROL_REQUIRED'),snapshot:TmeAiPrepareSnapshotSchema,coverState:z.strictObject({manualSelected:z.literal(false),generatorBanner:z.literal(true)}),dialog:PickerDialogSchema}).parse(raw);
  return this.repo.transaction(()=>{
   const job=this.get('job',i.id),op=this.repo.get('operations',i.operationId),grant=this.get('grant',job.grantId);
   if(op.kind!=='tme_ai_prepare'||op.jobId!==job.id||op.grantId!==grant.id||job.operationId!==op.id)throw Error('OPERATION_SCOPE');
   if(op.pickerResume)throw Error('PICKER_RESUME_ALREADY_USED');
   if(grant.suspended||job.reason==='RESTORED_REQUIRES_REVIEW')throw Error('RESTORED_REQUIRES_REVIEW');
   if(job.state!=='reconcile_required'||op.state!=='unknown'||job.step!=='set_cover'||op.step!=='set_cover'||job.reason!==i.reason)throw Error('PICKER_RESUME_SCOPE');
   const knownUntouched=(op.result?.status==='unknown'&&op.result.reason===i.reason)||(op.interruptHash&&op.reason===i.reason);
   if(!knownUntouched)throw Error('PICKER_RESUME_SCOPE');
   this.snapshot(i.snapshot,grant);this.assets(grant);
   if(i.snapshot.mode!=='editor'||i.snapshot.visibleSubmitButton)throw Error('PICKER_RESUME_PAGE_SCOPE');
   if(new Date(i.snapshot.observedAt).getTime()<new Date(op.completedAt??op.interruptedAt??op.createdAt).getTime())throw Error('PICKER_RESUME_STALE');
   // Chromium may host its owned native dialog in a different browser process.
   // Main proves that process is Chrome/Edge; the stable ownership boundary is GW_OWNER.
   if(i.dialog.owner!==grant.input.binding.handle||i.dialog.handle===i.dialog.owner)throw Error('PICKER_OWNER_SCOPE');
   if(!this.options.verifyResumePicker)throw Error('PICKER_VERIFIER_REQUIRED');
   const checked=this.options.verifyResumePicker(TmeAiPrepareGrantSchema.parse(grant.input),i.dialog);
   if(checked===false)throw Error('PICKER_DIRECTORY_SCOPE');
   if(checked&&typeof (checked as any).then==='function')throw Error('SYNCHRONOUS_PICKER_VERIFIER_REQUIRED');
   const pickerResume={nonce:randomUUID(),createdAt:this.stamp(),snapshot:i.snapshot,coverState:i.coverState,dialog:i.dialog,original:op};
   const operation={...op,state:'dispatching',result:null,ackHash:null,completedAt:null,interruptHash:null,interruptedAt:null,reason:null,pickerResume};
   this.repo.save('operations',operation);
   this.repo.audit('tmeAiPrepare.resumeUntouchedCoverPicker',job.id,{operationId:op.id,nonce:pickerResume.nonce});
   return{job:this.patch(job,{state:'dispatching',reason:null}),grant,operation};
  });
 }
 /** Continue only the existing crop group after a proven selection by the one resumed picker. */
 resumeInterruptedCrop(raw:unknown){
  const i=z.strictObject({id:z.uuid(),operationId:z.uuid(),snapshot:TmeAiPrepareSnapshotSchema,crop:z.strictObject({groupId:z.string().regex(/^\d+(?:\.\d+)+$/).max(200),heading:z.literal('调整图片'),confirmName:z.literal('确认'),imageCount:z.number().int().positive().max(20)}),selection:CropSelectionSchema}).parse(raw);
  return this.repo.transaction(()=>{
   const job=this.get('job',i.id),op=this.repo.get('operations',i.operationId),grant=this.get('grant',job.grantId),reason='CROP_DIALOG_SCOPE_REQUIRED';
   if(op.kind!=='tme_ai_prepare'||op.jobId!==job.id||op.grantId!==grant.id||job.operationId!==op.id)throw Error('OPERATION_SCOPE');
   if(op.cropResume)throw Error('CROP_RESUME_ALREADY_USED');
   if(grant.suspended||job.reason==='RESTORED_REQUIRES_REVIEW')throw Error('RESTORED_REQUIRES_REVIEW');
   if(!op.pickerResume||job.state!=='reconcile_required'||op.state!=='unknown'||job.step!=='set_cover'||op.step!=='set_cover'||job.reason!==reason)throw Error('CROP_RESUME_SCOPE');
   if(!((op.result?.status==='unknown'&&op.result.reason===reason)||(op.interruptHash&&op.reason===reason)))throw Error('CROP_RESUME_SCOPE');
   this.snapshot(i.snapshot,grant);this.assets(grant);
   if(i.snapshot.mode!=='editor'||i.snapshot.visibleSubmitButton)throw Error('CROP_RESUME_PAGE_SCOPE');
   if(new Date(i.snapshot.observedAt).getTime()<new Date(op.completedAt??op.interruptedAt??op.createdAt).getTime())throw Error('CROP_RESUME_STALE');
   if(i.selection.sha256!==grant.input.cover.sha256||i.selection.dialogHandle!==op.pickerResume.dialog.handle)throw Error('CROP_SELECTION_SCOPE');
   // This is an explicitly reconstructed phase association, not a returned picker receipt or remote byte proof.
   const evidenceHash=hash({crop:i.crop,snapshot:i.snapshot,pickerResume:op.pickerResume,path:i.selection.path,sha256:i.selection.sha256,hostSourceHash:i.selection.hostSourceHash});
   if(i.selection.evidenceHash!==evidenceHash)throw Error('CROP_RECONSTRUCTION_EVIDENCE_SCOPE');
   if(!this.options.verifyResumePicker||!this.options.verifyResumeCrop)throw Error('CROP_VERIFIER_REQUIRED');
   const g=TmeAiPrepareGrantSchema.parse(grant.input),directory=this.options.verifyResumePicker(g,op.pickerResume.dialog),selection=this.options.verifyResumeCrop(g,i.selection);
   if(directory===false||selection===false)throw Error('CROP_SELECTION_SCOPE');
   if([directory,selection].some(v=>v&&typeof (v as any).then==='function'))throw Error('SYNCHRONOUS_CROP_VERIFIER_REQUIRED');
   const cropResume={nonce:randomUUID(),createdAt:this.stamp(),snapshot:i.snapshot,crop:i.crop,selection:i.selection,original:op};
   const operation={...op,state:'dispatching',result:null,ackHash:null,completedAt:null,interruptHash:null,interruptedAt:null,reason:null,cropResume};
   this.repo.save('operations',operation);this.repo.audit('tmeAiPrepare.resumeExistingCoverCrop',job.id,{operationId:op.id,nonce:cropResume.nonce});
   return{job:this.patch(job,{state:'dispatching',reason:null}),grant,operation};
  });
 }
 /** Read-only evidence reconciliation after the specific existing crop lost its first readback. */
 reconcileAppliedCover(raw:unknown){
  const i=z.strictObject({id:z.uuid(),operationId:z.uuid(),snapshot:TmeAiPrepareSnapshotSchema,coverState:z.strictObject({manualSelected:z.literal(true),generatorBanner:z.literal(false)}),cropAbsent:z.literal(true)}).parse(raw);
  return this.repo.transaction(()=>{
   const job=this.get('job',i.id),op=this.repo.get('operations',i.operationId),grant=this.get('grant',job.grantId),reason='NATIVE_CONTROL_CONTRACT_FAILED',reconciliationHash=hash(i);
   if(op.kind!=='tme_ai_prepare'||op.jobId!==job.id||op.grantId!==grant.id)throw Error('OPERATION_SCOPE');
   if(op.readOnlyCoverReconciliation){if(op.readOnlyCoverReconciliation.reconciliationHash!==reconciliationHash)throw Error('READ_ONLY_COVER_RECONCILIATION_CONFLICT');return job}
   if(grant.suspended||job.reason==='RESTORED_REQUIRES_REVIEW')throw Error('RESTORED_REQUIRES_REVIEW');
   if(!op.cropResume||!op.pickerResume||job.operationId!==op.id||job.state!=='reconcile_required'||op.state!=='unknown'||job.step!=='set_cover'||op.step!=='set_cover'||job.reason!==reason)throw Error('COVER_RECONCILIATION_SCOPE');
   if(!((op.result?.status==='unknown'&&op.result.reason===reason)||(op.interruptHash&&op.reason===reason)))throw Error('COVER_RECONCILIATION_SCOPE');
   this.snapshot(i.snapshot,grant);this.assets(grant);
   if(i.snapshot.mode!=='editor'||i.snapshot.visibleSubmitButton)throw Error('COVER_RECONCILIATION_PAGE_SCOPE');
   if(new Date(i.snapshot.observedAt).getTime()<new Date(op.completedAt??op.interruptedAt??op.cropResume.createdAt).getTime())throw Error('COVER_RECONCILIATION_STALE');
   this.verifyStep('set_cover',i.snapshot,grant);
   const readOnlyCoverReconciliation={createdAt:this.stamp(),reconciliationHash,snapshot:i.snapshot,coverState:i.coverState,cropAbsent:true,original:op};
   const result={status:'verified_existing',snapshot:i.snapshot};
   this.repo.save('operations',{...op,state:'complete',result,ackHash:hash(result),completedAt:this.stamp(),readOnlyCoverReconciliation});
   this.repo.audit('tmeAiPrepare.reconcileAppliedCover',job.id,{operationId:op.id,reconciliationHash,externalAction:false});
   return this.patch(job,{state:'ready',step:'save_album',stepIndex:4,reason:null,remoteId:null,submissionByClient:false});
  });
 }
 /** Optional external draft save is never retried or certified by this local material snapshot. */
 reconcileAlbumSnapshot(raw:unknown){
  const i=z.strictObject({id:z.uuid(),operationId:z.uuid(),snapshot:TmeAiPrepareSnapshotSchema,coverState:z.strictObject({manualSelected:z.literal(true),generatorBanner:z.literal(false)}),cropAbsent:z.literal(true)}).parse(raw);
  return this.repo.transaction(()=>{
   const job=this.get('job',i.id),op=this.repo.get('operations',i.operationId),grant=this.get('grant',job.grantId),reason='NATIVE_CONTROL_CONTRACT_FAILED',reconciliationHash=hash(i);
   if(op.kind!=='tme_ai_prepare'||op.jobId!==job.id||op.grantId!==grant.id)throw Error('OPERATION_SCOPE');
   if(job.localAlbumSnapshot){if(job.localAlbumSnapshot.operationId!==op.id||job.localAlbumSnapshot.reconciliationHash!==reconciliationHash)throw Error('ALBUM_RECONCILIATION_CONFLICT');return job}
   if(grant.suspended||job.reason==='RESTORED_REQUIRES_REVIEW')throw Error('RESTORED_REQUIRES_REVIEW');
   if(job.operationId!==op.id||job.state!=='reconcile_required'||op.state!=='unknown'||job.step!=='save_album'||op.step!=='save_album'||job.reason!==reason)throw Error('ALBUM_RECONCILIATION_SCOPE');
   if(!((op.result?.status==='unknown'&&op.result.reason===reason)||(op.interruptHash&&op.reason===reason)))throw Error('ALBUM_RECONCILIATION_SCOPE');
   this.snapshot(i.snapshot,grant);this.assets(grant);
   if(i.snapshot.mode!=='editor'||i.snapshot.visibleSubmitButton)throw Error('ALBUM_RECONCILIATION_PAGE_SCOPE');
   if(new Date(i.snapshot.observedAt).getTime()<new Date(op.completedAt??op.interruptedAt??op.createdAt).getTime())throw Error('ALBUM_RECONCILIATION_STALE');
   // Compatibility field albumSaved means only that local album materials were journaled.
   const snapshot={...i.snapshot,verified:{...i.snapshot.verified,albumSaved:true}};this.verifyStep('save_album',snapshot,grant);
   const localAlbumSnapshot={operationId:op.id,reconciliationHash,localVerified:true,externalSaveOutcome:'unknown',remoteAlbumSaveVerified:false,noRetry:true,snapshot,coverState:i.coverState,cropAbsent:true,observedAt:snapshot.observedAt,evidenceHash:snapshot.evidenceHash};
   this.repo.audit('tmeAiPrepare.reconcileLocalAlbumSnapshot',job.id,{operationId:op.id,reconciliationHash,externalAction:false,externalSaveOutcome:'unknown'});
   // Deliberately retain the original operation byte-for-byte as unknown.
   return this.patch(job,{state:'ready',step:'advance_to_terms',stepIndex:5,reason:null,localAlbumSnapshot,remoteId:null,submissionByClient:false});
  });
 }
 /** Verify an already-visible authorization page. This method performs no Next, accept or submit action. */
 reconcileTermsPreview(raw:unknown){
  const i=z.strictObject({id:z.uuid(),operationId:z.uuid(),snapshot:TmeAiPrepareSnapshotSchema}).parse(raw);
  return this.repo.transaction(()=>{
   const job=this.get('job',i.id),op=this.repo.get('operations',i.operationId),grant=this.get('grant',job.grantId),reason='TERMS_PREVIEW_REQUIRED',reconciliationHash=hash(i);
   if(op.kind!=='tme_ai_prepare'||op.jobId!==job.id||op.grantId!==grant.id)throw Error('OPERATION_SCOPE');
   if(op.readOnlyTermsReconciliation){if(op.readOnlyTermsReconciliation.reconciliationHash!==reconciliationHash)throw Error('TERMS_RECONCILIATION_CONFLICT');return job}
   if(grant.suspended||job.reason==='RESTORED_REQUIRES_REVIEW')throw Error('RESTORED_REQUIRES_REVIEW');
   if(job.operationId!==op.id||job.state!=='reconcile_required'||op.state!=='unknown'||job.step!=='advance_to_terms'||op.step!=='advance_to_terms'||job.reason!==reason||!job.localAlbumSnapshot?.localVerified)throw Error('TERMS_RECONCILIATION_SCOPE');
   if(!((op.result?.status==='unknown'&&op.result.reason===reason)||(op.interruptHash&&op.reason===reason)))throw Error('TERMS_RECONCILIATION_SCOPE');
   this.snapshot(i.snapshot,grant);this.assets(grant);this.verifyStep('advance_to_terms',i.snapshot,grant);
   if(new Date(i.snapshot.observedAt).getTime()<new Date(op.completedAt??op.interruptedAt??op.createdAt).getTime())throw Error('TERMS_RECONCILIATION_STALE');
   const s=i.snapshot,result={status:'verified_existing',snapshot:s},readOnlyTermsReconciliation={createdAt:this.stamp(),reconciliationHash,snapshot:s,original:op};
   this.repo.save('operations',{...op,state:'complete',result,ackHash:hash(result),completedAt:this.stamp(),readOnlyTermsReconciliation});
   this.repo.audit('tmeAiPrepare.reconcileExistingTermsPreview',job.id,{operationId:op.id,reconciliationHash,externalAction:false});
   return this.patch(job,{state:'awaiting_terms_review',step:null,stepIndex:6,reason:null,terms:{termsText:s.termsText,termsHash:s.termsHash,modeText:s.modeText,evidenceHash:s.evidenceHash,observedAt:s.observedAt,visibleSubmitButton:true},remoteId:null,submissionByClient:false,formalSubmission:false});
  });
 }
 context(id:string){const job=this.get('job',IdSchema.parse({id}).id);return{job,grant:this.get('grant',job.grantId),operations:this.repo.all('operations').filter(o=>o.kind==='tme_ai_prepare'&&o.jobId===job.id)}}
 /** Inspection only. No retry, reconciliation acknowledgement or external mutation. */
 reconcile(raw:unknown){return this.context(IdSchema.parse(raw).id)}
 private publicGrant(grant:Row){const g=grant.input;return{id:grant.id,revision:grant.revision,suspended:!!grant.suspended,workId:g.workId,title:g.metadata.title,variant:g.sourceAudio.variant,identity:{subjectType:g.identity.subjectType,maskedKugouId:'***'+g.identity.kugouId.slice(-4),qqDisplayName:g.identity.qqDisplayName,artistName:g.identity.artistName},scope:'prepare_only'}}
 private publicJob(job:Row){return{id:job.id,grantId:job.grantId,workId:job.workId,revision:job.revision,state:job.state,step:job.step,reason:job.reason,audioDisposition:job.audioDisposition,remoteId:null,submissionByClient:false,remoteAlbumSaveVerified:false,localAlbumSnapshot:job.localAlbumSnapshot?{localVerified:job.localAlbumSnapshot.localVerified,externalSaveOutcome:job.localAlbumSnapshot.externalSaveOutcome,noRetry:true,observedAt:job.localAlbumSnapshot.observedAt}:null,terms:job.terms?{termsText:job.terms.termsText,termsHash:job.terms.termsHash,modeText:job.terms.modeText,observedAt:job.terms.observedAt,visibleSubmitButton:true}:null,createdAt:job.createdAt,updatedAt:job.updatedAt}}
 listPublic(){return{grants:this.rows('grant').map(g=>this.publicGrant(g)),jobs:this.rows('job').map(j=>this.publicJob(j))}}
 contextPublic(id:string){const {job,grant}=this.context(id);return{job:this.publicJob(job),grant:this.publicGrant(grant)}}
}
