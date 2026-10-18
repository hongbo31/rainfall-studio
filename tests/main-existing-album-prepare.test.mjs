import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const w=createRequire(import.meta.url)(process.env.RAINFALL_TME_AI_BROKER_BUNDLE??path.resolve('output/tme-ai-broker-tests/broker.cjs'));
function fixture(t,options={}){
 const root=path.resolve('output/test-runs/main-existing-album-'+randomUUID());fs.mkdirSync(root,{recursive:true});
 const repo=new w.Repository(path.join(root,'db.sqlite'));t.after(()=>repo.close());
 const pcm=path.join(root,'approved-A.wav'),cover=path.join(root,'cover.png'),header=Buffer.alloc(44),bytes=16000;
 header.write('RIFF');header.writeUInt32LE(bytes+36,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(8000,24);header.writeUInt32LE(16000,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(bytes,40);
 fs.writeFileSync(pcm,Buffer.concat([header,Buffer.alloc(bytes)]));fs.writeFileSync(cover,'offline local image');
 const lyrics='Offline original lyrics';
 const metadata={title:'New offline song',albumMode:options.albumMode??'existing',albumTitle:'Existing official album',albumDescription:'Local note only',artistName:'Offline artist',lyricist:'Offline writer',composer:'Offline composer',ownLyrics:false,ownComposition:false,aiTool:'Offline tool',generatedOn:'2026-10-17',allowCover:true,genre:'Pop',language:'Mandarin',version:'完整版',releaseMode:'审核通过即发布'};
 const scope={workId:randomUUID(),accountId:randomUUID(),variant:'A',prepareOnly:true,consent:true,sourceAudio:{assetId:randomUUID(),sha256:'a'.repeat(64),variant:'A'},upload:{path:pcm,sha256:w.hash(fs.readFileSync(pcm)),format:'pcm_wav',derivedFromSha256:'a'.repeat(64)},cover:{assetId:randomUUID(),sha256:w.hash(fs.readFileSync(cover))},lyricsHash:w.hash(lyrics),metadata,...(metadata.albumMode==='existing'?{existingAlbum:{title:metadata.albumTitle}}:{})};
 const dir=path.join(root,'authorizations','tme-ai');fs.mkdirSync(dir,{recursive:true});const write=()=>fs.writeFileSync(path.join(dir,scope.workId+'.json'),JSON.stringify(scope));write();
 const baseline={songIds:['song_old_123'],source:'official-list'},documentHash='d'.repeat(64),calls=[],rpcCalls=[];
 let mode='editor';
 const raw=()=>({identity:{kugouId:'1234567890',qqDisplayName:'Offline account',artistName:metadata.artistName},binding:{pid:123,handle:'456',started:'2026-10-17T08:00:00Z',documentId:'offline-only'},observedAt:new Date().toISOString(),mode,modeText:mode==='editor'?'Offline editor':'Offline official agreement',visibleSubmitButton:mode==='ai_authorization',...(mode==='ai_authorization'?{termsText:'Offline official terms',termsDocumentSha256:documentHash}:{}),existingAlbum:{title:metadata.albumTitle,coverInherited:true,coverReadOnly:true},form:{...metadata,lyrics,version:true,releaseMode:true,albumLanguage:metadata.albumMode==='existing'?'Old language':metadata.language,albumGenre:metadata.albumMode==='existing'?'Old genre':metadata.genre,albumType:metadata.albumMode==='existing'?'Old album type':'录音室专辑',albumDescription:metadata.albumMode==='existing'?'Old published description':metadata.albumDescription,text:`${path.basename(pcm)} 00:01\n歌手名\n${metadata.artistName}\n曲风\n作词\n${metadata.lyricist}\n作曲\n${metadata.composer}\nAI制作信息\n${metadata.albumMode==='existing'?'':'专辑歌手\n'+metadata.artistName+'\n专辑类型'}`},coverState:{manualSelected:metadata.albumMode!=='existing',generatorBanner:false},saveEvidence:{source:'local_material_snapshot',remoteSavedVerified:false}});
 const service=new w.TmeAiPrepareService(repo,{verifyAssets:()=>true});
 const rpc=async(method,input={})=>{
  const action=method.replace('internal.tmeAiPrepare.','');rpcCalls.push({action,input:structuredClone(input)});
  try{
   let value;
   if(action==='context')value={...service.context(input.id),lyricsText:lyrics,coverPath:cover};
   else if(action==='contextPublic')value=service.contextPublic(input.id);
   else if(action==='listPublic')value=service.listPublic();
   else if(action==='grantContext')value=repo.get('settings','tme-ai-prepare:grant:'+input.id).value;
   else if(action==='registerScopedGrant')value=service.registerGrant(input.grant);
   else value=service[action](input);
   return{ok:true,value};
  }catch(e){return{ok:false,error:{code:e.message}}}
 };
 const port={async request(action,input){
  calls.push({action,input:structuredClone(input)});
  if(input.step==='advance_to_terms')mode='ai_authorization';
  const snapshot=raw();
  if(['save_album','advance_to_terms'].includes(input.step))snapshot.receiptBaseline=structuredClone(baseline);
  options.changeRead?.(snapshot,input.step,action);
  return{snapshot,status:input.step==='set_cover'&&metadata.albumMode==='existing'?'verified_existing':'applied',receipt:{selectedPath:input.step==='upload_audio'?pcm:cover}};
 }};
 const broker=w.createTmeAiPrepareBroker({root,rpc,port,available:()=>true,generation:()=>1,...(options.publicationBarrier?{publicationBarrier:options.publicationBarrier}:{}),...(options.resolveScope?{resolveScope:async()=>structuredClone(scope)}:{})});
 const register=async()=>{
  const inspection=options.resolveScope?await broker.ui('inspect',{workId:scope.workId}):null;
  return broker.ui('register',{workId:scope.workId,consent:true,...(inspection?{authorizationNonce:inspection.authorizationNonce}:{})});
 };
 const start=async()=>{const grant=await register();return broker.ui('start',{grantId:grant.id,expectedRevision:grant.revision,consent:true})};
 const run=async()=>{const c=await start();return broker.ui('run',{id:c.job.id,expectedRevision:c.job.revision,consent:true})};
 return{broker,service,repo,scope,raw,calls,rpcCalls,baseline,documentHash,write,register,start,run};
}
test('Main existing-album preparation preserves inherited cover, official baseline and PDF hash without local cover actions',async t=>{
 const x=fixture(t),result=await x.run(),context=x.service.context(result.job.id);
 assert.equal(result.job.state,'awaiting_terms_review');
 assert.deepEqual(context.grant.input.existingAlbum,x.scope.existingAlbum);
 assert.deepEqual(context.job.localAlbumSnapshot.existingAlbum,{title:x.scope.metadata.albumTitle,coverInherited:true,coverReadOnly:true});
 assert.deepEqual(context.job.localAlbumSnapshot.receiptBaseline,x.baseline);
 assert.equal(context.job.terms.termsDocumentSha256,x.documentHash);
 for(const operation of context.operations){assert.equal(operation.result.snapshot.verified.coverSha,undefined)}
 const final=context.operations.at(-1).result.snapshot;
 assert.deepEqual(final.verified.receiptBaseline,x.baseline);assert.equal(final.termsDocumentSha256,x.documentHash);
 for(const call of x.calls.filter(c=>c.action==='step')){
  assert.equal(call.input.coverPath,undefined);assert.equal(call.input.expectedCoverSha256,undefined);
  assert.deepEqual(call.input.existingAlbum,x.scope.existingAlbum);
 }
 assert.deepEqual(x.calls.filter(c=>c.action==='step').map(c=>c.input.step),['locate_intake','upload_audio','fill_metadata','set_cover','save_album','advance_to_terms']);
 assert.equal(result.job.submissionByClient,false);assert.equal(result.job.remoteId,null);
});
test('existing-album metadata reads song fields and exact title without touching old remote album fields',t=>{
 const x=fixture(t),raw=x.raw();
 for(const key of ['albumDescription','albumLanguage','albumGenre','albumType'])Object.defineProperty(raw.form,key,{get(){assert.fail('must not read published '+key)}});
 assert.deepEqual(w.verifyNativeMetadata(raw,x.scope,raw.form.lyrics),{lyricsHash:x.scope.lyricsHash,metadataHash:w.hash(x.scope.metadata)});
 for(const key of ['title','lyrics','genre','language','aiTool','generatedOn','albumTitle','ownLyrics','ownComposition','allowCover']){
  const value=x.raw();value.form[key]=typeof value.form[key]==='boolean'?!value.form[key]:'wrong';
  assert.throws(()=>w.verifyNativeMetadata(value,x.scope,x.raw().form.lyrics),/METADATA_READBACK_REQUIRED/,key);
 }
 const missingArtist=x.raw();missingArtist.form.text=missingArtist.form.text.replace(x.scope.metadata.artistName,'wrong');
 assert.throws(()=>w.verifyNativeMetadata(missingArtist,x.scope,missingArtist.form.lyrics),/AUTHOR_CHIP_READBACK_REQUIRED/);
});
test('local selected cover alone never proves an existing album and failure cannot replay',async t=>{
 const x=fixture(t,{changeRead:(raw,step)=>{if(step==='set_cover'){delete raw.existingAlbum;raw.coverState.manualSelected=true}}}),result=await x.run();
 assert.equal(result.job.state,'reconcile_required');assert.equal(result.job.reason,'EXISTING_ALBUM_READBACK_REQUIRED');
 const count=x.calls.length;
 await x.broker.ui('run',{id:result.job.id,expectedRevision:result.job.revision,consent:true});assert.equal(x.calls.length,count);
 for(const action of ['resumePicker','resumeCrop'])await assert.rejects(x.broker.ui(action,{id:result.job.id,expectedRevision:result.job.revision,consent:true}),/EXISTING_ALBUM_COVER_READ_ONLY/);
 assert.equal(x.calls.length,count);assert.equal(x.calls.filter(c=>c.input.step==='set_cover').length,1);
});
test('set-cover and local-save require fresh exact-title inherited read-only proof',async t=>{
 for(const step of ['set_cover','save_album'])for(const field of ['title','coverInherited','coverReadOnly']){
  const x=fixture(t,{changeRead:(raw,current)=>{if(current===step)raw.existingAlbum[field]=field==='title'?'Wrong official album':false}}),result=await x.run();
  assert.equal(result.job.state,'reconcile_required',step+'/'+field);assert.equal(result.job.reason,'EXISTING_ALBUM_READBACK_REQUIRED',step+'/'+field);
 }
});
test('baseline and PDF fingerprints reject malformed or conflicting native evidence',async t=>{
 const x=fixture(t),raw=x.raw();
 for(const receiptBaseline of [{source:'local-cache',songIds:['song_old_123']},{source:'official-list',songIds:['!']},{source:'official-list',songIds:['song_old_123'],remoteId:'album123'}])assert.throws(()=>w.nativeSnapshot({...raw,receiptBaseline}));
 assert.throws(()=>w.nativeSnapshot({...raw,termsDocumentSha256:'wrong-document'}));
 assert.throws(()=>w.nativeSnapshot({...raw,receiptBaseline:{source:'official-list',songIds:['different_123']}},{receiptBaseline:x.baseline}),/RECEIPT_BASELINE_CHANGED/);
 for(const change of ['baseline','document','changed-baseline']){
  const y=fixture(t,{changeRead:(read,step)=>{
   if(step==='advance_to_terms'){
    if(change==='baseline')read.receiptBaseline={source:'local-cache',songIds:['song_old_123']};
    if(change==='document')read.termsDocumentSha256='wrong-document';
    if(change==='changed-baseline')read.receiptBaseline.songIds=['different_123'];
   }
  }}),result=await y.run();
  assert.equal(result.job.state,'reconcile_required',change);assert.notEqual(result.job.state,'awaiting_terms_review',change);
  assert.equal(y.service.context(result.job.id).job.terms,null);
 }
});
test('existing-album selection participates in consent and prior-grant scope checks',async t=>{
 const x=fixture(t,{resolveScope:true}),inspection=await x.broker.ui('inspect',{workId:x.scope.workId});
 x.scope.existingAlbum.title='Changed album';
 await assert.rejects(x.broker.ui('register',{workId:x.scope.workId,consent:true,authorizationNonce:inspection.authorizationNonce}),/PREPARATION_CONSENT_SCOPE_CHANGED/);
 assert.equal(x.service.listPublic().grants.length,0);
 const y=fixture(t);await y.register();y.scope.existingAlbum.title='Changed album';y.write();
 await assert.rejects(y.register(),/PREPARATION_GRANT_STALE/);
});
test('legacy new-album preparation still requires local cover selection and complete album metadata',async t=>{
 const x=fixture(t,{albumMode:'new'}),result=await x.run(),context=x.service.context(result.job.id);
 assert.equal(result.job.state,'awaiting_terms_review');
 assert.equal(context.operations.find(o=>o.step==='set_cover').result.snapshot.verified.coverSha,x.scope.cover.sha256);
 assert.equal(x.calls.find(c=>c.input.step==='set_cover').input.coverPath,path.join(path.dirname(x.scope.upload.path),'cover.png'));
 const missing=x.raw();delete missing.form.albumDescription;
 assert.throws(()=>w.verifyNativeMetadata(missing,x.scope,missing.form.lyrics),/METADATA_READBACK_REQUIRED/);
 const y=fixture(t,{albumMode:'new',changeRead:(raw,step)=>{if(step==='set_cover')raw.coverState.manualSelected=false}}),failed=await y.run();
 assert.equal(failed.job.state,'reconcile_required');assert.equal(failed.job.reason,'COVER_FILE_SELECTION_PROOF_REQUIRED');
});
test('an async official-record barrier blocks old ready tasks using the current source SHA before native inspection',async t=>{
 for(const resolveScope of [true,false]){
  let blocked=false;const checked=[],x=fixture(t,{resolveScope,publicationBarrier:async input=>{
   await Promise.resolve();checked.push(structuredClone(input));
   return blocked?{reason:'OFFICIAL_RECORD_ALREADY_EXISTS'}:null;
  }}),started=await x.start(),old=x.service.context(started.job.id);
  assert.equal(old.job.state,'ready');assert.equal(old.grant.input.sourceAudio.sha256,'a'.repeat(64));
  x.scope.sourceAudio.sha256='e'.repeat(64);x.write();blocked=true;
  const nativeBefore=x.calls.length,operationsBefore=x.repo.all('operations'),jobBefore=structuredClone(old.job);
  await assert.rejects(x.broker.ui('run',{id:started.job.id,expectedRevision:started.job.revision,consent:true}),/OFFICIAL_RECORD_ALREADY_EXISTS/);
  assert.deepEqual(checked.at(-1),{workId:x.scope.workId,audioSha:'e'.repeat(64)},resolveScope?'current work scope':'legacy stored scope');
  assert.equal(x.calls.length,nativeBefore,'barrier must finish before inspect or step');
  assert.deepEqual(x.repo.all('operations'),operationsBefore);assert.deepEqual(x.service.context(started.job.id).job,jobBefore);
  await assert.rejects(x.broker.ui('inspect',{workId:x.scope.workId}),/OFFICIAL_RECORD_ALREADY_EXISTS/);
  await assert.rejects(x.broker.ui('start',{grantId:old.grant.id,expectedRevision:old.grant.revision,consent:true}),/OFFICIAL_RECORD_ALREADY_EXISTS/);
  await assert.rejects(x.register(),/OFFICIAL_RECORD_ALREADY_EXISTS/);
  assert.equal(x.calls.length,nativeBefore);assert.deepEqual(x.repo.all('operations'),operationsBefore);
 }
});
