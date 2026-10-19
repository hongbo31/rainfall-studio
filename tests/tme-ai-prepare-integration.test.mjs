import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
const w=createRequire(import.meta.url)(process.env.RAINFALL_TME_AI_PREPARE_BUNDLE);
function wav(){const b=Buffer.alloc(48);b.write('RIFF');b.writeUInt32LE(40,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(44100,24);b.writeUInt32LE(88200,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(4,40);return b;}
function setup(t){
 assert.equal(typeof w.executeTmeAiPrepare,'function');
 const root=path.resolve('output/test-runs/tme-ai-integration-'+randomUUID());let now=new Date('2026-10-16T10:00:00Z');const s=new w.Studio(root,'production',{now:()=>now});t.after(()=>s.close());
 const artist=s.all('artists')[0],work=s.saveWork({artistId:artist.id,title:'示例作品A',lyrics:'These approved original lyrics remain fixed.',prompt:'warm original song',parameters:{},rights:'fixture',ai:'assisted'});
 const asset=(bytes,kind,ext)=>{const sha256=w.hash(bytes),id=randomUUID(),file=path.join(s.root,'media','sha256',sha256.slice(0,2),sha256+'.'+ext);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);s.save('assets',{id,sha256,kind,ext,bytes:bytes.length,mime:kind==='audio'?'audio/wav':'image/png'});return{id,sha256,file}};
 const audio=asset(Buffer.from('ORIGINAL_A_UNMODIFIED'),'audio','wav'),cover=asset(Buffer.from('APPROVED_COVER_BYTES'),'image','png');s.save('works',{...work,assets:{audio_A:audio.id,cover:cover.id}});
 const uploadPath=path.join(root,'approved-pcm.wav');fs.writeFileSync(uploadPath,wav());
 const identity={subjectType:'official_visible_binding_fingerprint',kugouId:'123456789012',qqDisplayName:'test account',artistName:artist.name,observedAt:now.toISOString(),evidenceHash:'e'.repeat(64)};identity.subjectHash=w.tmeAiSubjectHash(identity);
 const binding={pid:123,handle:'456',started:'2026-10-16T09:00:00Z',documentId:'test-document'};
 const grant={id:randomUUID(),workId:work.id,identity,binding,sourceAudio:{assetId:audio.id,sha256:audio.sha256,variant:'A'},upload:{path:uploadPath,sha256:w.hash(wav()),format:'pcm_wav',derivedFromSha256:audio.sha256},cover:{assetId:cover.id,sha256:cover.sha256},lyricsHash:w.hash(w.cleanLyricText(work.lyrics).cleaned),metadata:{title:work.title,albumTitle:work.title,albumDescription:'single',artistName:artist.name,lyricist:artist.name,composer:artist.name,ownLyrics:true,ownComposition:true,aiTool:'approved tool',generatedOn:'2026-10-16',allowCover:false,genre:'pop',language:'Chinese',version:'studio',releaseMode:'single'},consent:true};
 const call=(action,input={})=>w.executeTmeAiPrepare(s,action,input);
 return{s,grant,audio,cover,call,root,work,identity,binding};
}
test('private Core routing validates canonical A, cover, derived PCM and cleaned lyrics without modifying original assets',t=>{
 const x=setup(t),g=x.call('registerGrant',x.grant);assert.equal(g.id,x.grant.id);assert.equal(x.s.tmeAiPrepareService(),x.s.tmeAiPrepareService());
 const j=x.call('start',{grantId:g.id,expectedRevision:g.revision,identity:x.identity,binding:x.binding});
 const privateContext=x.call('context',{id:j.id});
 assert.equal(privateContext.lyricsText,w.cleanLyricText(x.work.lyrics).cleaned);assert.equal(privateContext.coverPath,x.cover.file);assert.equal(privateContext.sourceAudioPath,x.audio.file);assert.equal(w.hash(fs.readFileSync(x.audio.file)),x.audio.sha256);
 assert(!JSON.stringify(x.call('contextPublic',{id:j.id})).includes(x.root));
 assert.throws(()=>x.call('accept',{}),/METHOD_NOT_ALLOWED/);assert.throws(()=>x.call('submit',{}),/METHOD_NOT_ALLOWED/);assert.throws(()=>x.call('listPublic',{extra:1}));
 const mode=x.s.mode;x.s.mode='simulation';assert.throws(()=>x.call('listPublic'),/PRODUCTION_REQUIRED/);x.s.mode=mode;
});
test('changed canonical A, mutated cover/PCM/lyrics and malformed upload format all fail before registration',t=>{
 const x=setup(t),original=x.s.get('works',x.work.id);
 x.s.save('works',{...original,assets:{...original.assets,audio_A:randomUUID()}});assert.throws(()=>x.call('registerGrant',x.grant),/SOURCE_AUDIO_SCOPE/);x.s.save('works',original);
 fs.writeFileSync(x.cover.file,'tampered');assert.throws(()=>x.call('registerGrant',x.grant),/CORRUPT/);fs.writeFileSync(x.cover.file,'APPROVED_COVER_BYTES');
 fs.writeFileSync(x.grant.upload.path,'tampered');assert.throws(()=>x.call('registerGrant',x.grant),/UPLOAD/);
 const invalid={...x.grant,upload:{...x.grant.upload,sha256:w.hash('tampered')}};assert.throws(()=>x.call('registerGrant',invalid),/PCM/);fs.writeFileSync(x.grant.upload.path,wav());
 x.s.save('works',{...original,lyrics:'different words'});assert.throws(()=>x.call('registerGrant',x.grant),/LYRICS/);
 assert.equal(x.s.all('operations').length,0);
});
test('an explicitly approved official artist name does not overwrite or depend on a legacy placeholder artist row',t=>{
 const x=setup(t),artist=x.s.get('artists',x.work.artistId),identity={...x.identity,artistName:'Approved official stage name'};identity.subjectHash=w.tmeAiSubjectHash(identity);
 const grant={...x.grant,identity,metadata:{...x.grant.metadata,artistName:identity.artistName,lyricist:identity.artistName,composer:identity.artistName}};
 assert.equal(x.call('registerGrant',grant).input.metadata.artistName,identity.artistName);assert.deepEqual(x.s.get('artists',artist.id),artist);
});
test('private picker continuation verifies the actual canonical cover directory before unlocking the original operation',t=>{
 const x=setup(t),g=x.call('registerGrant',x.grant);let j=x.call('start',{grantId:g.id,expectedRevision:1,identity:x.identity,binding:x.binding});
 const snapshot={identity:x.identity,binding:x.binding,observedAt:'2026-10-16T10:00:00Z',evidenceHash:'f'.repeat(64),mode:'editor',modeText:'AI editor',visibleSubmitButton:false,verified:{sourceAudioSha:x.audio.sha256,uploadSha:x.grant.upload.sha256,metadataHash:w.hash(x.grant.metadata),lyricsHash:x.grant.lyricsHash}};
 for(const step of ['locate_intake','upload_audio','fill_metadata']){const c=x.call('claim',{id:j.id,expectedRevision:j.revision,step,before:snapshot});j=x.call('record',{id:j.id,operationId:c.operation.id,result:{status:'applied',snapshot}})}
 const c=x.call('claim',{id:j.id,expectedRevision:j.revision,step:'set_cover',before:snapshot});j=x.call('record',{id:j.id,operationId:c.operation.id,result:{status:'unknown',reason:'FILE_NAME_CONTROL_REQUIRED',snapshot}});
 const input={id:j.id,operationId:c.operation.id,reason:'FILE_NAME_CONTROL_REQUIRED',snapshot,coverState:{manualSelected:false,generatorBanner:true},dialog:{handle:'789',owner:x.binding.handle,pid:x.binding.pid,name:'打开',actualDirectory:x.root,selectedFileName:null}};
 assert.throws(()=>x.call('resumeInterruptedPicker',input),/PICKER_DIRECTORY_SCOPE/);
 assert.equal(x.call('context',{id:j.id}).job.state,'reconcile_required');
 const resumed=x.call('resumeInterruptedPicker',{...input,dialog:{...input.dialog,actualDirectory:path.dirname(x.cover.file)}});
 assert.equal(resumed.operation.id,c.operation.id);assert.equal(resumed.operation.pickerResume.original.result.reason,'FILE_NAME_CONTROL_REQUIRED');assert.equal(resumed.job.state,'dispatching');
 x.call('interrupt',{id:j.id,operationId:c.operation.id,reason:'CROP_DIALOG_SCOPE_REQUIRED'});
 const crop={groupId:'42.1.2.3',heading:'调整图片',confirmName:'确认',imageCount:1},parsed=w.TmeAiPrepareSnapshotSchema.parse(snapshot),selection={path:x.audio.file,sha256:x.cover.sha256,dialogHandle:resumed.operation.pickerResume.dialog.handle,phase:'file_selected_crop_pending',provenance:'phase_contract_reconstruction',hostSourceHash:'7'.repeat(64),remoteContentShaVerified:false};
 const evidence=()=>w.hash({crop,snapshot:parsed,pickerResume:resumed.operation.pickerResume,path:selection.path,sha256:selection.sha256,hostSourceHash:selection.hostSourceHash});
 selection.evidenceHash=evidence();assert.throws(()=>x.call('resumeInterruptedCrop',{id:j.id,operationId:c.operation.id,snapshot:parsed,crop,selection}),/CROP_SELECTION_SCOPE/);
 selection.path=x.cover.file;selection.evidenceHash=evidence();const cropped=x.call('resumeInterruptedCrop',{id:j.id,operationId:c.operation.id,snapshot:parsed,crop,selection});
 assert.equal(cropped.operation.cropResume.original.reason,'CROP_DIALOG_SCOPE_REQUIRED');assert.equal(cropped.job.state,'dispatching');
 x.call('interrupt',{id:j.id,operationId:c.operation.id,reason:'NATIVE_CONTROL_CONTRACT_FAILED'});
 const reconciled=x.call('reconcileAppliedCover',{id:j.id,operationId:c.operation.id,snapshot:{...parsed,verified:{...parsed.verified,coverSha:x.cover.sha256}},coverState:{manualSelected:true,generatorBanner:false},cropAbsent:true});
 assert.equal(reconciled.step,'save_album');assert.equal(x.s.get('operations',c.operation.id).readOnlyCoverReconciliation.original.reason,'NATIVE_CONTROL_CONTRACT_FAILED');
 const album=x.call('claim',{id:j.id,expectedRevision:reconciled.revision,step:'save_album',before:parsed});x.call('interrupt',{id:j.id,operationId:album.operation.id,reason:'NATIVE_CONTROL_CONTRACT_FAILED'});
 const unknown=x.s.get('operations',album.operation.id),local=x.call('reconcileAlbumSnapshot',{id:j.id,operationId:album.operation.id,snapshot:{...parsed,verified:{...parsed.verified,coverSha:x.cover.sha256}},coverState:{manualSelected:true,generatorBanner:false},cropAbsent:true});
 assert.equal(local.step,'advance_to_terms');assert.equal(local.localAlbumSnapshot.externalSaveOutcome,'unknown');assert.deepEqual(x.s.get('operations',album.operation.id),unknown);
 const advance=x.call('claim',{id:j.id,expectedRevision:local.revision,step:'advance_to_terms',before:parsed});x.call('interrupt',{id:j.id,operationId:advance.operation.id,reason:'TERMS_PREVIEW_REQUIRED'});
 const final=x.call('reconcileTermsPreview',{id:j.id,operationId:advance.operation.id,snapshot:{...parsed,mode:'ai_authorization',modeText:'Three year terms',termsText:'Three year terms',termsHash:w.hash('Three year terms'),visibleSubmitButton:true,verified:{...parsed.verified,coverSha:x.cover.sha256,albumSaved:true}}});
 assert.equal(final.state,'awaiting_terms_review');assert.equal(final.formalSubmission,false);assert.equal(final.remoteId,null);assert.equal(x.s.get('operations',advance.operation.id).readOnlyTermsReconciliation.original.reason,'TERMS_PREVIEW_REQUIRED');
});
test('backup cannot erase prepare grants or completed operations and restore suspends retained authorization',async t=>{
 const x=setup(t),before=path.join(x.root,'before.zip');await x.s.backup(before);
 const g=x.call('registerGrant',x.grant),j=x.call('start',{grantId:g.id,expectedRevision:g.revision,identity:x.identity,binding:x.binding});
 await assert.rejects(x.s.restore(before),/RESTORE_POST_SNAPSHOT_TME_AI_PREPARE/);
 const current=path.join(x.root,'current.zip');await x.s.backup(current);
 const snapshot={identity:x.identity,binding:x.binding,observedAt:'2026-10-16T10:00:00Z',evidenceHash:'f'.repeat(64),mode:'editor',modeText:'AI editor',visibleSubmitButton:false};
 const c=x.call('claim',{id:j.id,expectedRevision:j.revision,step:'locate_intake',before:snapshot});x.call('record',{id:j.id,operationId:c.operation.id,result:{status:'applied',snapshot}});
 await assert.rejects(x.s.restore(current),/RESTORE_POST_SNAPSHOT_TME_AI_PREPARE/);
 const after=path.join(x.root,'after.zip');await x.s.backup(after);await x.s.restore(after);
 const restored=x.call('context',{id:j.id});assert.equal(restored.job.state,'blocked');assert.equal(restored.job.reason,'RESTORED_REQUIRES_REVIEW');assert.equal(restored.operations.length,1);
 assert.throws(()=>x.call('start',{grantId:g.id,expectedRevision:g.revision,identity:x.identity,binding:x.binding}),/RESTORED_REQUIRES_REVIEW/);
 assert.throws(()=>x.call('claim',{id:j.id,expectedRevision:restored.job.revision,step:'upload_audio',before:snapshot}),/RESTORED_REQUIRES_REVIEW/);
 assert.equal(x.call('listPublic').grants[0].suspended,true);
});
