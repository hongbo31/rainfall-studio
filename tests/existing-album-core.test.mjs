import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const bundle=path.resolve('output/existing-album-core-tests/core.cjs');
await build({stdin:{contents:`export {Repository,hash} from './src/core/database';export * from './src/shared/tme-ai-prepare';export * from './src/shared/tme-ai-submission';export * from './src/core/tme-ai-prepare';export * from './src/core/tme-ai-submission';export * from './src/core/tme-ai-scope';export {verifyCurrentTmeAiScope} from './src/core/tme-ai-prepare-integration';export {publicationMetadataDefaults,savePublicationMetadata} from './src/renderer/components/PublicationMetadataForm';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Form from './src/renderer/components/PublicationMetadataForm';export const renderForm=(props)=>renderToStaticMarkup(<Form {...props}/>);`,loader:'tsx',resolveDir:process.cwd()},outfile:bundle,bundle:true,platform:'node',format:'cjs',packages:'external'});
createRequire(import.meta.url)(path.resolve('tests/fixtures/offline-only.cjs'));
const w=createRequire(import.meta.url)(bundle),sha='a'.repeat(64),uploadSha='b'.repeat(64),coverSha='c'.repeat(64),lyricsHash='d'.repeat(64),documentSha='7'.repeat(64);
function setup(t,albumMode='existing'){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rainfall-existing-core-')),repo=new w.Repository(path.join(root,'library.sqlite'));
 t.after(()=>{repo.close();fs.rmSync(root,{recursive:true,force:true})});
 const now=new Date('2026-10-18T10:00:00Z'),binding={pid:100,handle:'200',started:'offline-fixture'},identity={subjectType:'official_visible_binding_fingerprint',kugouId:'1234567890',qqDisplayName:'Offline account',artistName:'Offline artist',observedAt:now.toISOString(),evidenceHash:'e'.repeat(64)};identity.subjectHash=w.tmeAiSubjectHash(identity);
 const metadata={title:'Offline new song',albumTitle:'Released fixture album',albumDescription:albumMode==='existing'?'沿用已有专辑，不修改原专辑资料。':'New album description',artistName:identity.artistName,lyricist:'Writer',composer:'Composer',ownLyrics:false,ownComposition:false,aiTool:'Offline fixture tool',generatedOn:'2026-10-17',allowCover:false,genre:'pop',language:'Chinese',version:'studio',releaseMode:'single',...(albumMode?{albumMode}:{})};
 const input={id:randomUUID(),workId:randomUUID(),identity,binding,sourceAudio:{assetId:randomUUID(),sha256:sha,variant:'A'},upload:{path:path.join(root,'fixture.wav'),sha256:uploadSha,format:'pcm_wav',derivedFromSha256:sha},cover:{assetId:randomUUID(),sha256:coverSha},lyricsHash,metadata,consent:true,...(albumMode==='existing'?{existingAlbum:{title:metadata.albumTitle}}:{})};
 const service=new w.TmeAiPrepareService(repo,{now:()=>now,verifyAssets:()=>true});
 const verified=()=>({sourceAudioSha:sha,uploadSha,lyricsHash,metadataHash:w.hash(w.TmeAiPrepareMetadataSchema.parse(metadata)),albumSaved:true,...(albumMode==='existing'?{existingAlbum:{title:metadata.albumTitle,coverInherited:true,coverReadOnly:true},receiptBaseline:{songIds:['18281901','fixture-old'],source:'official-list'}}:{coverSha})});
 const snapshot=(extra={})=>({identity,binding,observedAt:now.toISOString(),evidenceHash:'f'.repeat(64),mode:'editor',modeText:'Offline editor',visibleSubmitButton:false,verified:verified(),...extra});
 const start=()=>{const grant=service.registerGrant(input);return service.start({grantId:grant.id,expectedRevision:grant.revision,identity,binding})};
 const advance=(job,step,after=snapshot())=>{const claim=service.claim({id:job.id,expectedRevision:job.revision,step,before:snapshot()});return service.record({id:job.id,operationId:claim.operation.id,result:{status:'verified_existing',snapshot:after}})};
 const finish=()=>{let job=start();for(const step of w.tmeAiPrepareSteps){const after=step==='advance_to_terms'?snapshot({mode:'ai_authorization',visibleSubmitButton:true,termsText:'Offline fixture agreement',termsHash:w.hash('Offline fixture agreement'),...(albumMode==='existing'?{termsDocumentSha256:documentSha}:{})}):snapshot();job=advance(job,step,after)}return job};
 return{root,repo,service,input,identity,binding,metadata,verified,snapshot,start,advance,finish,now};
}
test('existing album grant requires the exact selected album title and explicit mode',t=>{
 const x=setup(t);assert.throws(()=>x.service.registerGrant({...x.input,existingAlbum:{title:'Another album'}}),/EXISTING_ALBUM_SCOPE/);
 assert.throws(()=>x.service.registerGrant({...x.input,existingAlbum:undefined}),/EXISTING_ALBUM_SCOPE/);
 assert.throws(()=>x.service.registerGrant({...x.input,metadata:{...x.metadata,albumMode:undefined}}),/EXISTING_ALBUM_MODE_REQUIRED/);
 assert.equal(x.repo.all('operations').length,0);
});
test('official work or audio receipts block reusing restored ready grants before register, start or claim effects',t=>{
 for(const mode of ['existing',''])for(const match of ['work','audio']){
  const x=setup(t,mode),job=x.start(),workId=match==='work'?x.input.workId:randomUUID(),stamp=x.now.toISOString();
  x.repo.save('settings',{id:'external-publication:tme:'+workId,value:{source:'official',state:'reviewing',workId,title:x.metadata.title,artistName:x.metadata.artistName,audioSha256:match==='audio'?x.input.sourceAudio.sha256:'9'.repeat(64),externalSongRecordId:'987654321',albumId:'12345',albumTitle:x.metadata.albumTitle,acceptedAt:stamp,termsSha256:'6'.repeat(64),explicitUserConsentAt:stamp,submittedAt:stamp,observedAt:stamp,officialStatusText:'审核中',sourceUrl:'https://y.tencentmusic.com/#/user/manage/offline-fixture'}});
  let assetChecks=0;
  const restored=new w.TmeAiPrepareService(x.repo,{now:()=>x.now,verifyAssets:()=>{assetChecks++;return true}}),before={operations:x.repo.all('operations'),settings:x.repo.all('settings')};
  assert.equal(restored.context(job.id).job.state,'ready');
  const grant=restored.context(job.id).grant;
  for(const [action,call] of [
   ['register',()=>restored.registerGrant(x.input)],
   ['start',()=>restored.start({grantId:grant.id,expectedRevision:grant.revision,identity:x.identity,binding:x.binding})],
   ['claim',()=>restored.claim({id:job.id,expectedRevision:job.revision,step:job.step,before:x.snapshot()})],
  ]){
   assert.throws(call,/OFFICIAL_RECORD_ALREADY_EXISTS/,`${mode||'legacy'}/${match}/${action}`);
   assert.deepEqual({operations:x.repo.all('operations'),settings:x.repo.all('settings')},before,'official-record rejection must have no job or operation effects');
  }
  assert.equal(assetChecks,0,'official-record barrier precedes the local asset verifier');
 }
});
test('local cover SHA alone cannot prove inherited cover; matching read-only album proof can',t=>{
 const x=setup(t);let job=x.start();for(const step of w.tmeAiPrepareSteps.slice(0,3))job=x.advance(job,step);
 const claim=x.service.claim({id:job.id,expectedRevision:job.revision,step:'set_cover',before:x.snapshot()});
 const record=verified=>x.service.record({id:job.id,operationId:claim.operation.id,result:{status:'verified_existing',snapshot:x.snapshot({verified})}});
 assert.throws(()=>record({...x.verified(),existingAlbum:undefined,coverSha}),/MATERIAL_EXISTING_ALBUM_PROOF_REQUIRED/);
 assert.throws(()=>record({...x.verified(),existingAlbum:{title:'Wrong album',coverInherited:true,coverReadOnly:true},coverSha}),/MATERIAL_EXISTING_ALBUM_PROOF_REQUIRED/);
 for(const flag of ['coverInherited','coverReadOnly'])assert.throws(()=>record({...x.verified(),existingAlbum:{...x.verified().existingAlbum,[flag]:false}}));
 job=record(x.verified());assert.equal(job.step,'save_album');assert.equal(x.service.context(job.id).operations.at(-1).result.snapshot.verified.coverSha,undefined);
});
test('prepared local album explicitly records inherited cover, official baseline and document SHA',t=>{
 const x=setup(t),job=x.finish();assert.equal(job.state,'awaiting_terms_review');
 assert.deepEqual(job.localAlbumSnapshot.existingAlbum,{title:x.metadata.albumTitle,coverInherited:true,coverReadOnly:true});
 assert.equal(job.localAlbumSnapshot.coverInherited,true);assert.equal(job.localAlbumSnapshot.coverReadOnly,true);
 assert.deepEqual(job.localAlbumSnapshot.receiptBaseline,{songIds:['18281901','fixture-old'],source:'official-list'});
 assert.equal(job.localAlbumSnapshot.remoteAlbumSaveVerified,false);assert.equal(job.terms.termsDocumentSha256,documentSha);
 assert.equal(x.service.contextPublic(job.id).job.terms.termsDocumentSha256,documentSha);
});
test('legacy omitted mode and explicit new album still require the original cover SHA',t=>{
 for(const mode of [undefined,'new']){const x=setup(t,mode===undefined?'':mode);let job=x.start();for(const step of w.tmeAiPrepareSteps.slice(0,3))job=x.advance(job,step);
  const claim=x.service.claim({id:job.id,expectedRevision:job.revision,step:'set_cover',before:x.snapshot()});
  assert.throws(()=>x.service.record({id:job.id,operationId:claim.operation.id,result:{status:'applied',snapshot:x.snapshot({verified:{...x.verified(),coverSha:undefined,existingAlbum:{title:x.metadata.albumTitle,coverInherited:true,coverReadOnly:true}}})}}),/MATERIAL_COVER_PROOF_REQUIRED/);
  job=x.service.record({id:job.id,operationId:claim.operation.id,result:{status:'applied',snapshot:x.snapshot()}});assert.equal(job.step,'save_album');
 }
});
function submission(t,legacy=false){
 const x=setup(t,legacy?'':'existing'),job=x.finish(),sessionId=randomUUID(),prepared=x.service.context(job.id),snapshot=()=>x.snapshot({mode:'ai_authorization',visibleSubmitButton:true,termsText:job.terms.termsText,termsHash:job.terms.termsHash,...(job.terms.termsDocumentSha256?{termsDocumentSha256:job.terms.termsDocumentSha256}:{})});
 const submit=new w.TmeAiSubmissionService(x.repo,{now:()=>x.now,resolvePrepared:()=>prepared,verifyAssets:()=>true});
 const review=()=>submit.review({prepareJobId:job.id,snapshot:snapshot(),contract:{available:true,reasons:[],transport:'offline-fixture'},sessionId});
 const authorize=row=>submit.authorize({id:row.id,expectedRevision:row.revision,termsHash:row.termsHash,consent:true,rightsConfirmed:true,sessionId});
 const claim=(row,phase)=>submit.claim({id:row.id,expectedRevision:row.revision,phase,snapshot:snapshot(),sessionId});
 const accepted=()=>{let row=authorize(review());const c=claim(row,'accept');return submit.record({id:row.id,operationId:c.operation.id,result:{status:'accepted',snapshot:snapshot(),scopeHash:row.scopeHash}})};
 return{...x,prepared,submit,snapshot,review,authorize,claim,accepted};
}
test('submission intent freezes baseline IDs, exact album and document hash and rejects baseline receipt',t=>{
 const x=submission(t),row=x.accepted(),claim=x.claim(row,'submit'),scope=claim.operation.receiptScope;
 assert.deepEqual(scope.baselineSongIds,['18281901','fixture-old']);assert.equal(scope.albumTitle,x.metadata.albumTitle);assert.equal(scope.termsDocumentSha256,documentSha);
 const receipt={source:'official-tencent-review-record',entityType:'song',remoteId:'18281901',title:x.metadata.title,artistName:x.metadata.artistName,status:'reviewing',subjectHash:x.identity.subjectHash,scopeHash:row.scopeHash,submittedAt:claim.operation.createdAt,submittedAtSource:'dispatch-intent',observedAt:x.now.toISOString(),evidenceHash:'9'.repeat(64),url:'https://y.tencentmusic.com/#/user/manage/offline'};
 assert.throws(()=>x.submit.record({id:row.id,operationId:claim.operation.id,result:{status:'reviewing',receipt}}),/ALREADY_IN_BASELINE/);
 const completed=x.submit.record({id:row.id,operationId:claim.operation.id,result:{status:'reviewing',receipt:{...receipt,remoteId:'fixture-new'}}});assert.equal(completed.receipt.submittedAtSource,'dispatch-intent');
});
test('baseline or document mutations invalidate already reviewed submission consent',t=>{
 for(const mutate of [x=>x.prepared.job.localAlbumSnapshot.receiptBaseline.songIds.push('later-old'),x=>x.prepared.job.terms.termsDocumentSha256='8'.repeat(64)]){const x=submission(t),row=x.review();mutate(x);assert.throws(()=>x.authorize(row),/SUBMISSION_SCOPE_CHANGED/);assert.equal(x.repo.all('operations').filter(o=>o.kind==='tme_ai_submission').length,0)}
});
test('unknown or changed live document hashes are not implicitly accepted',t=>{
 const x=submission(t);for(const termsDocumentSha256 of [undefined,'8'.repeat(64)])assert.throws(()=>x.submit.review({prepareJobId:x.prepared.job.id,snapshot:{...x.snapshot(),termsDocumentSha256},contract:{available:true,reasons:[],transport:'offline-fixture'},sessionId:randomUUID()}),/TERMS_DOCUMENT_CHANGED/);
 const legacy=submission(t,true);assert.throws(()=>legacy.submit.review({prepareJobId:legacy.prepared.job.id,snapshot:{...legacy.snapshot(),termsDocumentSha256:documentSha},contract:{available:true,reasons:[],transport:'offline-fixture'},sessionId:randomUUID()}),/TERMS_DOCUMENT_CHANGED/);
});
test('legacy submission without baseline/document retains its prior consent hash contract',t=>{
 const x=submission(t,true),row=x.review();assert.equal(row.scopeHash,w.hash({prepareJobId:x.prepared.job.id,input:x.prepared.grant.input,termsHash:x.prepared.job.terms.termsHash}));
 const scope=x.claim(x.accepted(),'submit').operation.receiptScope;assert.equal('baselineSongIds' in scope,false);assert.equal('termsDocumentSha256' in scope,false);
});
test('new forms default to existing album with neutral local note and author-list labels; legacy saves omit mode',async()=>{
 const work={id:'offline-work',title:'Offline song',revision:1},job={state:'blocked'},data={};
 const defaults=w.publicationMetadataDefaults(work,data);assert.equal(defaults.albumMode,'existing');assert.equal(defaults.albumDescription,'沿用已有专辑，不修改原专辑资料。');
 const legacy=w.publicationMetadataDefaults({...work,publicationMetadata:{albumDescription:'Original description'}},data);assert.equal(legacy.albumMode,'');
 const html=w.renderForm({work,data,job});assert.ok(html.includes('我是作词人'));assert.ok(html.includes('我是作曲人'));assert.ok(html.includes('不修改原专辑封面或资料'));assert.ok(html.includes('本地专辑备注'));
 const metadata={...defaults,albumMode:'',albumDescription:'Original description',artistName:'Artist',lyricist:'Writer',composer:'Composer',ownLyrics:'false',ownComposition:'false',aiTool:'Fixture',generatedOn:'2026-01-01',allowCover:'false',genre:'pop',language:'Chinese'};let payload;
 await w.savePublicationMetadata({work,job,metadata,expectedRevision:1,call:async(_,input)=>payload=input,refresh:async()=>{}});assert.equal('albumMode' in payload.metadata,false);assert.equal(payload.metadata.ownLyrics,false);
});

test('current-work scope resolves existing album only explicitly and stale comparison binds the selected album',t=>{
 const x=setup(t),pcm=Buffer.alloc(48);pcm.write('RIFF');pcm.writeUInt32LE(40,4);pcm.write('WAVEfmt ',8);pcm.writeUInt32LE(16,16);pcm.writeUInt16LE(1,20);pcm.writeUInt16LE(1,22);pcm.writeUInt32LE(44100,24);pcm.writeUInt32LE(88200,28);pcm.writeUInt16LE(2,32);pcm.writeUInt16LE(16,34);pcm.write('data',36);pcm.writeUInt32LE(4,40);
 const audio={id:x.input.sourceAudio.assetId,kind:'audio',sha256:w.hash(pcm)},cover={id:x.input.cover.assetId,kind:'image',sha256:coverSha},artist={id:randomUUID(),name:x.identity.artistName};
 const work={id:x.input.workId,title:x.metadata.title,artistId:artist.id,lyrics:'Offline original lyrics',assets:{audio_A:audio.id,cover:cover.id},publicationMetadata:{...x.metadata,version:'完整版',releaseMode:'审核通过即发布'}};
 const files=new Map([[audio.id,path.join(x.root,'source.wav')],[cover.id,path.join(x.root,'cover.png')]]);fs.writeFileSync(files.get(audio.id),pcm);fs.writeFileSync(files.get(cover.id),'offline cover');
 const tables={works:[work],artists:[artist],assets:[audio,cover],settings:[]};const studio={root:x.root,mode:'production',now:()=>x.now,get:(table,id)=>tables[table].find(row=>row.id===id),all:table=>tables[table],repo:{maybe:(table,id)=>tables[table].find(row=>row.id===id)},locate:id=>({file:files.get(id)})};
 const scope=w.resolveTmeAiPrepareScope(studio,{workId:work.id});assert.deepEqual(scope.existingAlbum,{title:x.metadata.albumTitle});const grant={...scope,id:x.input.id};w.verifyCurrentTmeAiScope(studio,grant);
 work.publicationMetadata.albumTitle='Other released album';assert.throws(()=>w.verifyCurrentTmeAiScope(studio,grant),/PREPARATION_GRANT_STALE/);work.publicationMetadata.albumTitle=x.metadata.albumTitle;
 assert.throws(()=>w.verifyCurrentTmeAiScope(studio,{...grant,existingAlbum:{title:'Forged alternate album'}}),/PREPARATION_GRANT_STALE/);
 for(const mode of ['new',undefined]){if(mode)work.publicationMetadata.albumMode=mode;else delete work.publicationMetadata.albumMode;const resolved=w.resolveTmeAiPrepareScope(studio,{workId:work.id});assert.equal('existingAlbum' in resolved,false);assert.equal(resolved.metadata.albumMode,mode)}
});
