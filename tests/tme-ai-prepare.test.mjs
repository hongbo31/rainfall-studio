import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
const w=createRequire(import.meta.url)(process.env.RAINFALL_TME_AI_PREPARE_BUNDLE),sha='a'.repeat(64),uploadSha='b'.repeat(64),coverSha='c'.repeat(64),lyricsHash='d'.repeat(64);
function setup(t){
 assert.equal(typeof w.TmeAiPrepareService,'function');
 const repo=new w.Repository(path.resolve('output/test-runs/tme-ai-prepare-'+randomUUID(),'library.sqlite'));t.after(()=>repo.close());
 let now=new Date('2026-10-16T10:00:00Z'),valid=true;
 const binding={pid:1234,handle:'5678',started:'2026-10-16T09:00:00Z',documentId:'official-editor-tab'};
 const identity={subjectType:'official_visible_binding_fingerprint',kugouId:'123456789012',qqDisplayName:'test-qq',artistName:'test-artist',observedAt:now.toISOString(),evidenceHash:'e'.repeat(64)};
 identity.subjectHash=w.tmeAiSubjectHash(identity);
 const metadata={title:'示例作品A',albumTitle:'示例作品A',albumDescription:'Original single',artistName:'test-artist',lyricist:'test-artist',composer:'test-artist',ownLyrics:true,ownComposition:true,aiTool:'fixture tool',generatedOn:'2026-10-16',allowCover:false,genre:'pop',language:'Chinese',version:'studio',releaseMode:'single'};
 const grant={id:randomUUID(),workId:randomUUID(),identity,binding,sourceAudio:{assetId:randomUUID(),sha256:sha,variant:'A'},upload:{path:'C:/OFFLINE_FIXTURE/upload-pcm.wav',sha256:uploadSha,format:'pcm_wav',derivedFromSha256:sha},cover:{assetId:randomUUID(),sha256:coverSha},lyricsHash,metadata,consent:true};
 const options={now:()=>now,verifyAssets:()=>{if(!valid)throw Error('FIXTURE_ASSETS_CHANGED')}};
 const service=new w.TmeAiPrepareService(repo,options);
 const snapshot=(extra={})=>({identity,binding,observedAt:now.toISOString(),evidenceHash:'f'.repeat(64),mode:'editor',modeText:'Official AI editor',visibleSubmitButton:false,verified:{sourceAudioSha:sha,uploadSha,coverSha,lyricsHash,metadataHash:w.hash(metadata),albumSaved:true},...extra});
 const start=()=>{const g=service.registerGrant(grant);return service.start({grantId:g.id,expectedRevision:g.revision,identity,binding});};
 return{repo,service,grant,identity,binding,options,snapshot,start,clock:v=>now=new Date(v),invalidate:()=>valid=false};
}
function interruptedCover(x){
 let j=x.start();
 for(const step of ['locate_intake','upload_audio','fill_metadata']){const c=x.service.claim({id:j.id,expectedRevision:j.revision,step,before:x.snapshot()});j=x.service.record({id:j.id,operationId:c.operation.id,result:{status:'applied',snapshot:x.snapshot()}})}
 const c=x.service.claim({id:j.id,expectedRevision:j.revision,step:'set_cover',before:x.snapshot()});
 const result={status:'unknown',reason:'FILE_NAME_CONTROL_REQUIRED',snapshot:x.snapshot()};
 j=x.service.record({id:j.id,operationId:c.operation.id,result});
 const input={id:j.id,operationId:c.operation.id,reason:'FILE_NAME_CONTROL_REQUIRED',snapshot:x.snapshot(),coverState:{manualSelected:false,generatorBanner:true},dialog:{handle:'9012',owner:x.binding.handle,pid:x.binding.pid,name:'打开',actualDirectory:'C:/OFFLINE_FIXTURE',selectedFileName:null}};
 return{j,c,result,input};
}
test('one exact untouched owned cover picker can continue the same operation while preserving its original unknown history',t=>{
 const x=setup(t),p=interruptedCover(x);x.options.verifyResumePicker=()=>true;
 p.input.dialog.pid=9988; // An owned Chrome dialog may run in a separate Chrome process.
 const original=x.repo.get('operations',p.c.operation.id),r=x.service.resumeInterruptedPicker(p.input);
 assert.equal(r.operation.id,original.id);assert.equal(r.job.state,'dispatching');assert.deepEqual(r.operation.pickerResume.original,original);
 assert.equal(x.repo.all('operations').length,4);
 assert.throws(()=>x.service.resumeInterruptedPicker(p.input),/PICKER_RESUME_ALREADY_USED/);
 assert.throws(()=>x.service.record({id:p.j.id,operationId:original.id,result:p.result}),/ACK_CONFLICT/);
 const ack={id:p.j.id,operationId:original.id,result:{status:'applied',snapshot:x.snapshot()}},done=x.service.record(ack);
 assert.equal(done.step,'save_album');assert.deepEqual(x.service.record(ack),done);
 assert.deepEqual(x.repo.get('operations',original.id).pickerResume.original,original);
 assert.equal(JSON.stringify(x.service.contextPublic(p.j.id)).includes('OFFLINE_FIXTURE'),false);
});
test('picker recovery refuses changed dialog, selected file, cover, identity, stale evidence, missing verifier and ordinary unknowns',t=>{
 const x=setup(t),p=interruptedCover(x);
 assert.throws(()=>x.service.resumeInterruptedPicker(p.input),/PICKER_VERIFIER_REQUIRED/);
 x.options.verifyResumePicker=()=>false;assert.throws(()=>x.service.resumeInterruptedPicker(p.input),/PICKER_DIRECTORY_SCOPE/);
 x.options.verifyResumePicker=()=>true;
 for(const dialog of [{...p.input.dialog,owner:'other'},{...p.input.dialog,pid:0},{...p.input.dialog,handle:x.binding.handle},{...p.input.dialog,selectedFileName:'cover.png'}])assert.throws(()=>x.service.resumeInterruptedPicker({...p.input,dialog}));
 assert.throws(()=>x.service.resumeInterruptedPicker({...p.input,coverState:{manualSelected:true,generatorBanner:false}}));
 assert.throws(()=>x.service.resumeInterruptedPicker({...p.input,snapshot:x.snapshot({binding:{...x.binding,documentId:'other'}})}),/BINDING/);
 assert.throws(()=>x.service.resumeInterruptedPicker({...p.input,snapshot:x.snapshot({mode:'ai_authorization'})}),/PICKER_RESUME_PAGE_SCOPE/);
 assert.throws(()=>x.service.resumeInterruptedPicker({...p.input,reason:'NATIVE_OUTCOME_UNKNOWN'}));
 x.clock('2026-10-16T10:06:00Z');assert.throws(()=>x.service.resumeInterruptedPicker(p.input),/STALE/);
 assert.equal(x.repo.get('operations',p.c.operation.id).state,'unknown');
});
test('a picker continuation interrupted by restart cannot be resumed or claimed again',t=>{
 const x=setup(t),p=interruptedCover(x);x.options.verifyResumePicker=()=>true;x.service.resumeInterruptedPicker(p.input);
 const restarted=new w.TmeAiPrepareService(x.repo,x.options),j=restarted.context(p.j.id).job;
 assert.equal(j.state,'reconcile_required');assert.throws(()=>restarted.resumeInterruptedPicker(p.input),/PICKER_RESUME_ALREADY_USED/);
 assert.throws(()=>restarted.claim({id:j.id,expectedRevision:j.revision,step:'set_cover',before:x.snapshot()}),/RECONCILIATION_REQUIRED/);
 assert.equal(restarted.context(j.id).operations.at(-1).pickerResume.original.result.reason,'FILE_NAME_CONTROL_REQUIRED');
});
function interruptedCrop(x){
 const p=interruptedCover(x);x.options.verifyResumePicker=()=>true;x.service.resumeInterruptedPicker(p.input);
 x.service.interrupt({id:p.j.id,operationId:p.c.operation.id,reason:'CROP_DIALOG_SCOPE_REQUIRED'});
 const input={id:p.j.id,operationId:p.c.operation.id,snapshot:x.snapshot(),crop:{groupId:'42.1.2.3',heading:'调整图片',confirmName:'确认',imageCount:1},selection:{path:'C:/OFFLINE_FIXTURE/cover.png',sha256:coverSha,dialogHandle:p.input.dialog.handle,phase:'file_selected_crop_pending',provenance:'phase_contract_reconstruction',hostSourceHash:'7'.repeat(64),remoteContentShaVerified:false}};
 input.snapshot=w.TmeAiPrepareSnapshotSchema.parse(input.snapshot);
 input.selection.evidenceHash=w.hash({crop:input.crop,snapshot:input.snapshot,pickerResume:x.repo.get('operations',p.c.operation.id).pickerResume,path:input.selection.path,sha256:input.selection.sha256,hostSourceHash:input.selection.hostSourceHash});
 return{...p,input};
}
test('only the existing crop after the same resumed cover selection can continue and retains both unknown histories',t=>{
 const x=setup(t),p=interruptedCrop(x);x.options.verifyResumeCrop=()=>true;
 const original=x.repo.get('operations',p.c.operation.id),r=x.service.resumeInterruptedCrop(p.input);
 assert.equal(r.operation.id,original.id);assert.equal(r.job.state,'dispatching');assert.deepEqual(r.operation.cropResume.original,original);
 assert.equal(r.operation.cropResume.original.pickerResume.original.result.reason,'FILE_NAME_CONTROL_REQUIRED');
 assert.throws(()=>x.service.resumeInterruptedCrop(p.input),/CROP_RESUME_ALREADY_USED/);
 assert.throws(()=>x.service.resumeInterruptedPicker(p.input));
 const done=x.service.record({id:p.j.id,operationId:original.id,result:{status:'applied',snapshot:x.snapshot()}});assert.equal(done.step,'save_album');
 assert.equal(x.repo.all('operations').length,4);assert(!JSON.stringify(x.service.contextPublic(p.j.id)).includes('OFFLINE_FIXTURE'));
});
test('crop continuation fails closed for missing verifier, wrong selection, group contract, stale document, and restart',t=>{
 const x=setup(t),p=interruptedCrop(x);
 assert.throws(()=>x.service.resumeInterruptedCrop(p.input),/CROP_VERIFIER_REQUIRED/);
 x.options.verifyResumeCrop=()=>false;assert.throws(()=>x.service.resumeInterruptedCrop(p.input),/CROP_SELECTION_SCOPE/);
 x.options.verifyResumeCrop=()=>true;
 for(const selection of [{...p.input.selection,sha256:sha},{...p.input.selection,dialogHandle:'other'},{...p.input.selection,phase:'upload_requested'},{...p.input.selection,remoteContentShaVerified:true},{...p.input.selection,evidenceHash:sha},{...p.input.selection,provenance:'native_returned_receipt'}])assert.throws(()=>x.service.resumeInterruptedCrop({...p.input,selection}));
 for(const crop of [{...p.input.crop,groupId:''},{...p.input.crop,heading:'授权'},{...p.input.crop,confirmName:'提交'},{...p.input.crop,imageCount:0}])assert.throws(()=>x.service.resumeInterruptedCrop({...p.input,crop}));
 assert.throws(()=>x.service.resumeInterruptedCrop({...p.input,snapshot:x.snapshot({binding:{...x.binding,documentId:'other'}})}),/BINDING/);
 x.service.resumeInterruptedCrop(p.input);const restarted=new w.TmeAiPrepareService(x.repo,x.options);
 assert.throws(()=>restarted.resumeInterruptedCrop(p.input),/CROP_RESUME_ALREADY_USED/);assert.equal(restarted.context(p.j.id).job.state,'reconcile_required');
});
function appliedCoverAfterLostReadback(x,reason='NATIVE_CONTROL_CONTRACT_FAILED'){
 const p=interruptedCrop(x);x.options.verifyResumeCrop=()=>true;x.service.resumeInterruptedCrop(p.input);
 x.service.interrupt({id:p.j.id,operationId:p.c.operation.id,reason});
 return{...p,input:{id:p.j.id,operationId:p.c.operation.id,snapshot:x.snapshot(),coverState:{manualSelected:true,generatorBanner:false},cropAbsent:true}};
}
test('fresh read-only cover reconciliation advances without any new claim and preserves all interrupted history',t=>{
 const x=setup(t),p=appliedCoverAfterLostReadback(x),original=x.repo.get('operations',p.c.operation.id),count=x.repo.all('operations').length;
 const j=x.service.reconcileAppliedCover(p.input);assert.equal(j.state,'ready');assert.equal(j.step,'save_album');assert.deepEqual(x.service.reconcileAppliedCover(p.input),j);
 const op=x.repo.get('operations',p.c.operation.id);assert.equal(op.state,'complete');assert.equal(op.result.status,'verified_existing');assert.deepEqual(op.readOnlyCoverReconciliation.original,original);
 assert.equal(op.readOnlyCoverReconciliation.original.cropResume.original.pickerResume.original.result.reason,'FILE_NAME_CONTROL_REQUIRED');assert.equal(x.repo.all('operations').length,count);
 assert.throws(()=>x.service.reconcileAppliedCover({...p.input,snapshot:x.snapshot({evidenceHash:'1'.repeat(64)})}),/RECONCILIATION_CONFLICT/);
});
test('read-only cover reconciliation refuses unproven material, active crop, changed document and jobs without the crop continuation',t=>{
 const x=setup(t),p=appliedCoverAfterLostReadback(x);
 for(const input of [{...p.input,cropAbsent:false},{...p.input,coverState:{manualSelected:false,generatorBanner:true}},{...p.input,snapshot:x.snapshot({verified:{}})},{...p.input,snapshot:x.snapshot({binding:{...x.binding,documentId:'other'}})},{...p.input,snapshot:x.snapshot({mode:'ai_authorization'})}])assert.throws(()=>x.service.reconcileAppliedCover(input));
 x.invalidate();assert.throws(()=>x.service.reconcileAppliedCover(p.input),/FIXTURE_ASSETS_CHANGED/);assert.equal(x.repo.get('operations',p.c.operation.id).state,'unknown');
 const y=setup(t),q=interruptedCover(y);assert.throws(()=>y.service.reconcileAppliedCover({...p.input,id:q.j.id,operationId:q.c.operation.id,snapshot:y.snapshot()}),/COVER_RECONCILIATION_SCOPE/);
});
function interruptedAlbum(x,reason='NATIVE_CONTROL_CONTRACT_FAILED'){
 let j=x.start();
 for(const step of ['locate_intake','upload_audio','fill_metadata','set_cover']){const c=x.service.claim({id:j.id,expectedRevision:j.revision,step,before:x.snapshot()});j=x.service.record({id:j.id,operationId:c.operation.id,result:{status:'applied',snapshot:x.snapshot()}})}
 const c=x.service.claim({id:j.id,expectedRevision:j.revision,step:'save_album',before:x.snapshot()});x.service.interrupt({id:j.id,operationId:c.operation.id,reason});
 const snapshot=x.snapshot();delete snapshot.verified.albumSaved;
 return{j,c,input:{id:j.id,operationId:c.operation.id,snapshot,coverState:{manualSelected:true,generatorBanner:false},cropAbsent:true}};
}
test('unknown optional remote album save remains unknown while a read-only local snapshot unlocks only terms preflight',t=>{
 const x=setup(t),p=interruptedAlbum(x),original=x.repo.get('operations',p.c.operation.id),count=x.repo.all('operations').length;
 const j=x.service.reconcileAlbumSnapshot(p.input);assert.equal(j.state,'ready');assert.equal(j.step,'advance_to_terms');assert.equal(j.localAlbumSnapshot.localVerified,true);assert.equal(j.localAlbumSnapshot.externalSaveOutcome,'unknown');assert.equal(j.localAlbumSnapshot.noRetry,true);
 assert.deepEqual(x.repo.get('operations',p.c.operation.id),original);assert.equal(x.repo.all('operations').length,count);assert.deepEqual(x.service.reconcileAlbumSnapshot(p.input),j);
 const pub=x.service.contextPublic(j.id).job;assert.equal(pub.remoteAlbumSaveVerified,false);assert.equal(pub.localAlbumSnapshot.localVerified,true);
 assert.throws(()=>x.service.claim({id:j.id,expectedRevision:j.revision,step:'save_album',before:x.snapshot()}),/PREPARE_STEP_SCOPE/);
 const claim=x.service.claim({id:j.id,expectedRevision:j.revision,step:'advance_to_terms',before:x.snapshot()}),terms=x.snapshot({mode:'ai_authorization',termsText:'Three year terms',termsHash:w.hash('Three year terms'),visibleSubmitButton:true});
 const final=x.service.record({id:j.id,operationId:claim.operation.id,result:{status:'applied',snapshot:terms}});assert.equal(final.state,'awaiting_terms_review');assert.equal(final.submissionByClient,false);assert.deepEqual(x.repo.get('operations',p.c.operation.id),original);
});
test('local album reconciliation requires exact interrupted save, unchanged assets and full fresh native materials',t=>{
 const x=setup(t),p=interruptedAlbum(x);
 for(const input of [{...p.input,cropAbsent:false},{...p.input,coverState:{manualSelected:false,generatorBanner:true}},{...p.input,snapshot:x.snapshot({verified:{albumSaved:true}})},{...p.input,snapshot:x.snapshot({binding:{...x.binding,documentId:'other'}})}])assert.throws(()=>x.service.reconcileAlbumSnapshot(input));
 x.invalidate();assert.throws(()=>x.service.reconcileAlbumSnapshot(p.input),/FIXTURE_ASSETS_CHANGED/);assert.equal(x.repo.get('operations',p.c.operation.id).state,'unknown');
 const y=setup(t),q=interruptedCover(y);assert.throws(()=>y.service.reconcileAlbumSnapshot({...p.input,id:q.j.id,operationId:q.c.operation.id,snapshot:y.snapshot()}),/ALBUM_RECONCILIATION_SCOPE/);
});
function existingTermsAfterLostReadback(x){
 const p=interruptedAlbum(x),j=x.service.reconcileAlbumSnapshot(p.input),c=x.service.claim({id:j.id,expectedRevision:j.revision,step:'advance_to_terms',before:x.snapshot()});
 x.service.interrupt({id:j.id,operationId:c.operation.id,reason:'TERMS_PREVIEW_REQUIRED'});
 return{j,c,input:{id:j.id,operationId:c.operation.id,snapshot:x.snapshot({mode:'ai_authorization',modeText:'Non-exclusive three year authorization',termsText:'Three year terms',termsHash:w.hash('Three year terms'),visibleSubmitButton:true})}};
}
test('read-only existing terms reconciliation ends preparation without another next or any acceptance action',t=>{
 const x=setup(t),p=existingTermsAfterLostReadback(x),original=x.repo.get('operations',p.c.operation.id),count=x.repo.all('operations').length;
 const j=x.service.reconcileTermsPreview(p.input);assert.equal(j.state,'awaiting_terms_review');assert.equal(j.remoteId,null);assert.equal(j.submissionByClient,false);assert.equal(j.formalSubmission,false);assert.deepEqual(x.service.reconcileTermsPreview(p.input),j);
 const op=x.repo.get('operations',p.c.operation.id);assert.deepEqual(op.readOnlyTermsReconciliation.original,original);assert.equal(op.result.status,'verified_existing');assert.equal(x.repo.all('operations').length,count);
 assert.throws(()=>x.service.claim({id:j.id,expectedRevision:j.revision,step:'advance_to_terms',before:x.snapshot()}),/PREPARE_STEP_SCOPE/);
 assert.throws(()=>x.service.reconcileTermsPreview({...p.input,snapshot:{...p.input.snapshot,evidenceHash:'1'.repeat(64)}}),/TERMS_RECONCILIATION_CONFLICT/);
});
test('existing terms reconciliation requires complete terms, all material proof, unchanged assets and the exact pending final operation',t=>{
 const x=setup(t),p=existingTermsAfterLostReadback(x);
 for(const snapshot of [{...p.input.snapshot,mode:'editor'},{...p.input.snapshot,visibleSubmitButton:false},{...p.input.snapshot,termsHash:sha},{...p.input.snapshot,verified:{}},{...p.input.snapshot,binding:{...x.binding,documentId:'other'}}])assert.throws(()=>x.service.reconcileTermsPreview({...p.input,snapshot}));
 x.invalidate();assert.throws(()=>x.service.reconcileTermsPreview(p.input),/FIXTURE_ASSETS_CHANGED/);assert.equal(x.repo.get('operations',p.c.operation.id).state,'unknown');
 const y=setup(t),q=interruptedAlbum(y);assert.throws(()=>y.service.reconcileTermsPreview({...p.input,id:q.j.id,operationId:q.c.operation.id,snapshot:y.snapshot()}),/TERMS_RECONCILIATION_SCOPE/);
});
test('approved A preparation is durable, idempotent and ends only at observed terms review',t=>{
 const x=setup(t);let job=x.start();assert.equal(x.start().id,job.id);
 for(const step of w.tmeAiPrepareSteps){
  const c=x.service.claim({id:job.id,expectedRevision:job.revision,step,before:x.snapshot()});
  assert.equal(x.repo.get('operations',c.operation.id).state,'dispatching');
  const snapshot=step==='advance_to_terms'?x.snapshot({mode:'ai_authorization',modeText:'AI authorization',termsText:'New three year terms',termsHash:w.hash('New three year terms'),visibleSubmitButton:true}):x.snapshot();
  const input={id:job.id,operationId:c.operation.id,result:{status:step==='upload_audio'?'verified_existing':'applied',snapshot}};
  job=x.service.record(input);assert.deepEqual(x.service.record(input),job);
 }
 assert.equal(job.state,'awaiting_terms_review');assert.equal(job.remoteId,null);assert.equal(job.submissionByClient,false);assert.equal(job.audioDisposition,'verified_existing');
 assert.equal(job.localAlbumSnapshot.externalSaveOutcome,'not_attempted');assert.equal(x.service.contextPublic(job.id).job.remoteAlbumSaveVerified,false);
 assert.throws(()=>x.service.claim({id:job.id,expectedRevision:job.revision,step:'submit',before:x.snapshot()}));
 assert.throws(()=>x.service.claim({id:job.id,expectedRevision:job.revision,step:'accept_terms',before:x.snapshot()}));
});
test('claims survive restart as reconciliation required and cannot replay or overwrite an uncertain acknowledgement',t=>{
 const x=setup(t),job=x.start(),c=x.service.claim({id:job.id,expectedRevision:job.revision,step:'locate_intake',before:x.snapshot()});
 const restarted=new w.TmeAiPrepareService(x.repo,x.options),r=restarted.context(job.id).job;
 assert.equal(r.state,'reconcile_required');assert.equal(x.repo.get('operations',c.operation.id).state,'unknown');
 assert.throws(()=>restarted.claim({id:r.id,expectedRevision:r.revision,step:'locate_intake',before:x.snapshot()}),/RECONCILIATION_REQUIRED/);
 assert.equal(restarted.reconcile({id:r.id}).job.state,'reconcile_required');
});
test('family lock forbids new grants and changed PCM while register replay cannot mutate approved scope',t=>{
 const x=setup(t);x.start();
 assert.throws(()=>x.service.registerGrant({...x.grant,metadata:{...x.grant.metadata,title:'changed'}}),/GRANT_CONFLICT/);
 assert.throws(()=>x.service.registerGrant({...x.grant,id:randomUUID(),upload:{...x.grant.upload,sha256:'9'.repeat(64)}}),/FAMILY_ALREADY_REGISTERED/);
 assert.throws(()=>x.service.registerGrant({...x.grant,id:randomUUID()}),/FAMILY_ALREADY_REGISTERED/);
 assert.throws(()=>x.service.registerGrant({...x.grant,id:randomUUID(),sourceAudio:{...x.grant.sourceAudio,variant:'B'}}));
 assert.throws(()=>x.service.registerGrant({...x.grant,id:randomUUID(),sourceAudio:{...x.grant.sourceAudio,sha256:'7'.repeat(64)},upload:{...x.grant.upload,derivedFromSha256:'7'.repeat(64)}}),/WORK_ALREADY_REGISTERED/);
});
test('fresh official composite identity and exact bound document are required at start and every claim',t=>{
 const x=setup(t),g=x.service.registerGrant(x.grant);
 assert.throws(()=>x.service.start({grantId:g.id,expectedRevision:1,identity:{...x.identity,qqDisplayName:'other'},binding:x.binding}),/IDENTITY/);
 assert.throws(()=>x.service.start({grantId:g.id,expectedRevision:1,identity:x.identity,binding:{...x.binding,documentId:'other'}}),/BINDING/);
 let j=x.start();x.clock('2026-10-16T10:06:00Z');
 assert.throws(()=>x.service.claim({id:j.id,expectedRevision:j.revision,step:'locate_intake',before:x.snapshot()}),/STALE/);
});
test('asset verification is fail closed before any operation and stale acknowledgements do not advance',t=>{
 const x=setup(t),j=x.start();x.invalidate();
 assert.throws(()=>x.service.claim({id:j.id,expectedRevision:j.revision,step:'locate_intake',before:x.snapshot()}),/FIXTURE_ASSETS_CHANGED/);
 assert.equal(x.repo.all('operations').length,0);
});
test('renderer projections and schemas exclude filesystem paths, identity evidence, records and receipts',t=>{
 const x=setup(t),j=x.start(),pub=JSON.stringify([x.service.listPublic(),x.service.contextPublic(j.id)]);
 for(const secret of [x.grant.upload.path,x.identity.kugouId,x.identity.evidenceHash])assert(!pub.includes(secret));
 assert.equal(x.service.contextPublic(j.id).grant.identity.qqDisplayName,x.identity.qqDisplayName);
 assert.equal(w.TmeAiPreparePublicSchemas.record,undefined);assert.equal(w.TmeAiPreparePublicSchemas.accept,undefined);assert.equal(w.TmeAiPreparePublicSchemas.submit,undefined);
 assert.throws(()=>w.TmeAiPreparePublicSchemas.start.parse({grantId:x.grant.id,expectedRevision:1,consent:true,identity:x.identity}));
});
test('public grants and jobs expose only their trusted exact task/account scope and legacy stays unscoped',t=>{
 const x=setup(t),publicationTaskId=randomUUID(),accountId=randomUUID();Object.assign(x.grant,{publicationTaskId,accountId});
 const job=x.start(),stored=x.repo.get('settings','tme-ai-prepare:job:'+job.id);
 x.repo.save('settings',{...stored,value:{...stored.value,publicationTaskId:randomUUID(),accountId:randomUUID()}});
 for(const dto of [x.service.listPublic().grants[0],x.service.listPublic().jobs[0],x.service.contextPublic(job.id).grant,x.service.contextPublic(job.id).job]){
  assert.equal(dto.publicationTaskId,publicationTaskId);assert.equal(dto.accountId,accountId);assert.equal(dto.input,undefined);assert.equal(dto.upload,undefined);
 }
 const old=setup(t),legacy=old.start();for(const dto of [old.service.contextPublic(legacy.id).grant,old.service.contextPublic(legacy.id).job]){assert.equal(dto.publicationTaskId,undefined);assert.equal(dto.accountId,undefined)}
});
test('a forged terminal terms snapshot and changed material proof cannot become successful records',t=>{
 const x=setup(t);let j=x.start();
 for(const step of w.tmeAiPrepareSteps){const c=x.service.claim({id:j.id,expectedRevision:j.revision,step,before:x.snapshot()});
  if(step==='upload_audio')assert.throws(()=>x.service.record({id:j.id,operationId:c.operation.id,result:{status:'applied',snapshot:x.snapshot({verified:{uploadSha:'9'.repeat(64)}})}}),/MATERIAL/);
  if(step==='advance_to_terms'){
   assert.throws(()=>x.service.record({id:j.id,operationId:c.operation.id,result:{status:'applied',snapshot:x.snapshot()}}),/TERMS/);
   assert.throws(()=>x.service.record({id:j.id,operationId:c.operation.id,result:{status:'applied',snapshot:x.snapshot({mode:'ai_authorization',termsText:'x',termsHash:'9'.repeat(64),visibleSubmitButton:true})}}),/TERMS/);break;
  }
  j=x.service.record({id:j.id,operationId:c.operation.id,result:{status:'applied',snapshot:x.snapshot()}});
 }
});
test('unknown native outcomes never release the original job for another upload',t=>{
 const x=setup(t),j=x.start(),c=x.service.claim({id:j.id,expectedRevision:j.revision,step:'locate_intake',before:x.snapshot()});
 const input={id:j.id,operationId:c.operation.id,result:{status:'unknown',reason:'NATIVE_OUTCOME_UNKNOWN',snapshot:x.snapshot()}};
 const saved=x.service.record(input);assert.equal(saved.state,'reconcile_required');assert.deepEqual(x.service.record(input),saved);
 assert.throws(()=>x.service.record({...input,result:{status:'applied',snapshot:x.snapshot()}}),/ACK_CONFLICT/);
});
test('non-numeric or ambiguous short visible IDs cannot be registered as official composite identities',t=>{
 const x=setup(t);
 for(const kugouId of ['abc','1234']){const identity={...x.identity,kugouId};identity.subjectHash=w.tmeAiSubjectHash(identity);assert.throws(()=>x.service.registerGrant({...x.grant,identity}));}
});
test('asset verifier is mandatory and rejects false or asynchronous unchecked results',t=>{
 const x=setup(t);
 for(const verifyAssets of [undefined,()=>false,()=>Promise.resolve(true)])assert.throws(()=>new w.TmeAiPrepareService(x.repo,{now:x.options.now,verifyAssets}).registerGrant(x.grant),/VERIFIER|VERIFICATION/);
 assert.equal(x.repo.all('operations').length,0);
});
test('out of sequence claims, stale revisions and cross-job records are refused',t=>{
 const x=setup(t),j=x.start();
 assert.throws(()=>x.service.claim({id:j.id,expectedRevision:j.revision,step:'upload_audio',before:x.snapshot()}),/STEP_SCOPE/);
 assert.throws(()=>x.service.claim({id:j.id,expectedRevision:99,step:'locate_intake',before:x.snapshot()}),/REVISION/);
 const c=x.service.claim({id:j.id,expectedRevision:j.revision,step:'locate_intake',before:x.snapshot()});
 const other={...x.grant,id:randomUUID(),workId:randomUUID(),sourceAudio:{...x.grant.sourceAudio,sha256:'1'.repeat(64)},upload:{...x.grant.upload,derivedFromSha256:'1'.repeat(64)}};
 const g=x.service.registerGrant(other),second=x.service.start({grantId:g.id,expectedRevision:g.revision,identity:x.identity,binding:x.binding});
 assert.throws(()=>x.service.record({id:second.id,operationId:c.operation.id,result:{status:'applied',snapshot:x.snapshot()}}),/OPERATION_SCOPE/);
});
test('an old before-action snapshot cannot certify the action completed',t=>{
 const x=setup(t),j=x.start(),before=x.snapshot();x.clock('2026-10-16T10:00:10Z');
 const c=x.service.claim({id:j.id,expectedRevision:j.revision,step:'locate_intake',before});
 assert.throws(()=>x.service.record({id:j.id,operationId:c.operation.id,result:{status:'applied',snapshot:before}}),/RESULT_PRECEDES_CLAIM/);
});
test('lost native windows can interrupt only the current operation without invented observations or a replay',t=>{
 const x=setup(t),j=x.start(),c=x.service.claim({id:j.id,expectedRevision:j.revision,step:'locate_intake',before:x.snapshot()});
 assert.equal(typeof x.service.interrupt,'function');
 assert.throws(()=>x.service.interrupt({id:j.id,operationId:randomUUID(),reason:'WINDOW_CLOSED'}));
 const request={id:j.id,operationId:c.operation.id,reason:'WINDOW_CLOSED'},saved=x.service.interrupt(request);
 assert.equal(saved.state,'reconcile_required');assert.equal(x.repo.get('operations',c.operation.id).state,'unknown');assert.equal(x.repo.get('operations',c.operation.id).result,undefined);
 assert.deepEqual(x.service.interrupt(request),saved);assert.throws(()=>x.service.interrupt({...request,reason:'OTHER_REASON'}),/INTERRUPT_CONFLICT/);
 assert.throws(()=>x.service.record({id:j.id,operationId:c.operation.id,result:{status:'applied',snapshot:x.snapshot()}}),/RECONCILIATION_REQUIRED/);
 assert.equal(w.TmeAiPreparePublicSchemas.interrupt,undefined);assert.equal(x.repo.all('operations').length,1);
});

test('scoped crop and album timeouts reconcile read-only while unrelated unknown outcomes remain blocked',t=>{
 for(const [prepare,method,next] of [[appliedCoverAfterLostReadback,'reconcileAppliedCover','save_album'],[interruptedAlbum,'reconcileAlbumSnapshot','advance_to_terms']]){
  const x=setup(t),p=prepare(x,'MANUAL_COVER_ACCEPTANCE_REQUIRED'),before=x.repo.all('operations').length;
  const result=x.service[method](p.input);assert.equal(result.state,'ready');assert.equal(result.step,next);assert.equal(x.repo.all('operations').length,before);
  const y=setup(t),q=prepare(y,'NATIVE_OUTCOME_UNKNOWN');assert.throws(()=>y.service[method](q.input),/RECONCILIATION_SCOPE/);
 }
});
