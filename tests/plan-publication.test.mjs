import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const w=createRequire(import.meta.url)(process.env.RAINFALL_PLAN_PUBLICATION_BUNDLE);
const sha=x=>createHash('sha256').update(x).digest('hex');
function setup(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rainfall-plan-publication-')),repo=new w.Repository(path.join(root,'db.sqlite'));
 t.after(()=>{repo.close();fs.rmSync(root,{recursive:true,force:true})});
 const artist={id:randomUUID(),name:'Fixture artist'},accounts=[{id:randomUUID(),provider:'tme',name:'Account A',remoteSubject:'1'.repeat(64)},{id:randomUUID(),provider:'tme',name:'Account B',remoteSubject:'2'.repeat(64)}];
 repo.save('artists',artist);for(const a of accounts)repo.save('accounts',a);
 const b=Buffer.alloc(48);b.write('RIFF');b.writeUInt32LE(40,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(44100,24);b.writeUInt32LE(88200,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(4,40);
 const audio={id:randomUUID(),kind:'audio',sha256:sha(b),ext:'wav',mime:'audio/wav',bytes:b.length},cover={id:randomUUID(),kind:'image',sha256:sha('cover'),ext:'png',mime:'image/png',bytes:5};
 const files=new Map([[audio.id,path.join(root,'a.wav')],[cover.id,path.join(root,'cover.png')]]);fs.writeFileSync(files.get(audio.id),b);fs.writeFileSync(files.get(cover.id),'cover');for(const a of [audio,cover])repo.save('assets',a);
 const work={id:randomUUID(),artistId:artist.id,revision:1,title:'Fixture new song',lyrics:'Verified fixture lyrics',rights:'Confirmed original rights',ai:'generated',assets:{audio_A:audio.id,cover:cover.id},publicationMetadata:{lyricist:'Writer',composer:'Composer',ownLyrics:false,ownComposition:true,allowCover:false,aiTool:'Fixture tool',generatedOn:'2026-10-15',genre:'pop',language:'en',albumDescription:'Fixture description'}};repo.save('works',work);
 for(const target of ['qqmusic','kugou'])repo.save('settings',{id:'simple-publishing:platform:v1:'+target,value:{version:1,revision:1,target,accountId:accounts[0].id,artistId:artist.id,lyricist:'Writer',composer:'Composer',album:'Fixture album',genre:'pop',language:'en',aiDisclosure:'generated',isCover:false}});
 const run={id:randomUUID(),planId:randomUUID(),state:'running',stopRequested:false,snapshot:{artistId:artist.id,authorization:{publish:true},publishTargets:accounts.map(a=>({platform:'qqmusic',accountId:a.id,enabled:true,album:{mode:'existing',albumId:'fixture-album'}}))}};
 const item={id:run.id+':item:1',runId:run.id,workId:work.id,materials:{title:work.title,lyrics:work.lyrics,coverAssetId:cover.id,audioAssetId:audio.id,selectedVersion:'A',rightsEvidenceId:'fixture-rights',consistencyEvidenceId:'fixture-match'},versions:[{version:'A',assetId:audio.id,sha256:audio.sha256}]};
 const s={root,mode:'production',repo,now:()=>new Date('2026-10-19T10:00:00Z'),all:table=>repo.all(table),get:(table,id)=>repo.get(table,id),save:(table,row)=>repo.save(table,row),locate:id=>{const a=repo.get('assets',id),file=files.get(id);if(!file||sha(fs.readFileSync(file))!==a.sha256)throw Error('CORRUPT_ASSET');return{file}},planCenterService:()=>({list:()=>({runs:[run],items:[item]})}),lyricService:()=>({forWork:work=>({cleaned:work.lyrics,raw:work.lyrics,plainHash:sha(work.lyrics),alignmentConfirmed:true,audioHash:audio.sha256,warnings:[]})})};
 return {root,repo,s,work,item,run,accounts,audio,cover,files};
}
// Explicit test-only binding injection. The default setup retains the unbound production gate.
function installFixtureBindings(x,{source='offline-fixture'}={}){
 x.s.planAlbumService=()=>({status:()=>({operations:[]}),bindingForRun:input=>{
  const target=x.run.snapshot.publishTargets.find(t=>t.enabled&&t.platform===input.platform&&t.accountId===input.accountId),account=x.repo.maybe('accounts',input.accountId);
  if(input.runId!==x.run.id||!target||!account)return null;
  return{id:'fixture-binding-'+input.platform+'-'+input.accountId,albumId:target.album.albumId??'fixture-created',title:'Fixture album',scope:{platform:input.platform,accountId:input.accountId,accountFingerprint:account.remoteSubject},source,onlineVerified:source==='official'};
 }});
}
function installClaimableFixtureBindings(x){
 const now=x.s.now().toISOString(),plan={id:x.run.planId,revision:1,title:'Scoped receipt fixture',artistId:x.work.artistId,schedule:{kind:'daily',localTime:'09:00'},material:{source:'manual'},text:{},music:{route:'manual'},authorization:{publish:true},publishTargets:x.run.snapshot.publishTargets};
 Object.assign(x.run,{planRevision:1,snapshot:plan,summaryHash:'f'.repeat(64),requestId:randomUUID(),source:'debug',createdAt:now,updatedAt:now});
 Object.assign(x.item,{planId:plan.id,ordinal:1,expectedExternalItemId:'fixture-item',state:'ready',createdAt:now,updatedAt:now});
 for(const [kind,value] of [['plan',plan],['run',x.run],['item',x.item]])x.repo.save('settings',{id:'plan-center:'+kind+':'+value.id,value});
 const albums=new w.PlanAlbumService(x.repo,{now:x.s.now,materialFingerprint:()=>w.planPublicationMaterialFingerprint(x.s,x.run,x.item)});x.s.planAlbumService=()=>albums;
 for(const target of plan.publishTargets){const scope=albums.scope(target),catalog=albums.recordCatalog({scope,source:'official',completeness:'partial',observedAt:now,expiresAt:'2026-10-19T11:00:00Z',evidenceHash:'c'.repeat(64),entries:[{key:'exact',id:'fixture-album',title:'Fixture album'}]});albums.selectBinding({runId:x.run.id,platform:target.platform,accountId:target.accountId,catalogId:catalog.id,entryKey:'exact'});}
 return albums;
}
test('same item/account remains one stable existing queue task, two accounts stay separate',t=>{
 const x=setup(t),before=x.repo.get('settings','simple-publishing:platform:v1:qqmusic');
 const first=w.syncPlanPublications(x.s),again=w.syncPlanPublications(x.s);
 assert.equal(first.length,2);assert.deepEqual(again.map(l=>l.publicationTaskId),first.map(l=>l.publicationTaskId));assert.equal(new Set(first.map(l=>l.publicationTaskId)).size,2);
 assert.equal(w.unifiedPublicationService(x.s).list().length,2);assert.deepEqual(x.repo.get('settings','simple-publishing:platform:v1:qqmusic'),before);assert.deepEqual(x.repo.get('works',x.work.id),x.work);
 for(const link of first){assert.equal(link.onlineVerified,false);assert.equal(link.state,'blocked');assert.equal(link.reason,'ALBUM_CATALOG_REQUIRED');assert.equal(link.albumIntent.albumId,'fixture-album')}
});
test('missing work binding, stale bound material and corrupt bytes never enqueue',t=>{
 for(const change of [x=>delete x.item.workId,x=>x.item.materials.title='Changed',x=>fs.writeFileSync(x.files.get(x.audio.id),'corrupt')]){
  const x=setup(t);change(x);const links=w.syncPlanPublications(x.s);assert.ok(links.every(l=>l.state==='blocked'&&!l.publicationTaskId));assert.equal(w.unifiedPublicationService(x.s).list().length,0);
 }
});
test('same account Tencent targets retain the complete existing family across repeated sync',t=>{
 const x=setup(t);x.run.snapshot.publishTargets=[x.run.snapshot.publishTargets[0],{...x.run.snapshot.publishTargets[0],platform:'kugou'}];
 const first=w.syncPlanPublications(x.s),again=w.syncPlanPublications(x.s);assert.equal(first.length,2);assert.equal(first[0].publicationTaskId,first[1].publicationTaskId);assert.equal(again[0].reason,'ALBUM_CATALOG_REQUIRED');
 assert.deepEqual(w.unifiedPublicationService(x.s).byId(first[0].publicationTaskId).targets,['kugou','qqmusic']);
});
test('selected B uses its original recording slot without overwriting A',t=>{
 const x=setup(t),audioB={...x.audio,id:randomUUID()};x.repo.save('assets',audioB);x.files.set(audioB.id,x.files.get(x.audio.id));x.work.assets.audio_B=audioB.id;x.work.selectedAudioVariant='B';x.repo.save('works',x.work);
 installFixtureBindings(x);
 x.item.materials.audioAssetId=audioB.id;x.item.materials.selectedVersion='B';x.item.versions.push({version:'B',assetId:audioB.id,sha256:audioB.sha256});
 const [link]=w.syncPlanPublications(x.s),scope=w.resolveTmeAiPrepareScope(x.s,{workId:x.work.id,publicationTaskId:link.publicationTaskId,accountId:link.accountId});assert.equal(scope.sourceAudio.variant,'B');assert.equal(scope.sourceAudio.assetId,audioB.id);assert.equal(x.repo.get('works',x.work.id).assets.audio_A,x.audio.id);
});
test('frozen material cannot be silently refreshed after first sync',t=>{
 const x=setup(t),first=w.syncPlanPublications(x.s);x.work.rights='Changed rights';x.repo.save('works',x.work);const second=w.syncPlanPublications(x.s);
 assert.deepEqual(second.map(l=>l.publicationTaskId),first.map(l=>l.publicationTaskId));assert.ok(second.every(l=>l.reason==='PLAN_PUBLICATION_MATERIALS_CHANGED'));assert.equal(w.unifiedPublicationService(x.s).list().length,2);
});
test('unknown remains unknown and stop prevents new tasks while preserving receipt collection',t=>{
 const x=setup(t),[link]=w.syncPlanPublications(x.s),service=w.unifiedPublicationService(x.s),task=service.byId(link.publicationTaskId);
 service.update({id:task.id,expectedRevision:task.revision,patch:{state:'reconcile_required',reason:'OUTCOME_UNKNOWN'}});x.run.stopRequested=true;x.run.state='stopped';
 const status=w.syncPlanPublications(x.s);assert.equal(status.find(l=>l.id===link.id).state,'unknown');assert.equal(service.list().length,2);
 const y=setup(t);y.run.stopRequested=true;assert.equal(w.syncPlanPublications(y.s).length,0);assert.equal(w.unifiedPublicationService(y.s).list().length,0);
});
test('verified existing service receipts map only to their exact account',t=>{
 const x=setup(t),visible={kugouId:'123456789',qqDisplayName:'Fixture account',artistName:'Fixture artist'},subjectHash=w.tmeAiSubjectHash(visible);
 x.accounts[0].remoteSubject=subjectHash;x.repo.save('accounts',x.accounts[0]);
 const albums=installClaimableFixtureBindings(x);
 const [link]=w.syncPlanPublications(x.s),service=w.unifiedPublicationService(x.s),task=service.byId(link.publicationTaskId),prepareJobId=randomUUID();
 const identity={...visible,subjectHash,subjectType:'official_visible_binding_fingerprint',observedAt:x.s.now().toISOString(),evidenceHash:'a'.repeat(64)},binding={pid:42,handle:'101',started:'fixture'};
 const input={id:randomUUID(),...w.resolveTmeAiPrepareScope(x.s,{workId:x.work.id,publicationTaskId:task.id,accountId:x.accounts[0].id,createDerivative:true}),identity,binding,consent:true};delete input.variant;delete input.prepareOnly;
 const snapshot={identity,binding,observedAt:x.s.now().toISOString(),evidenceHash:'b'.repeat(64),mode:'ai_authorization',modeText:'Fixture terms',visibleSubmitButton:true,termsText:'Fixture terms only',termsHash:sha('Fixture terms only'),verified:{}};
 const prepared={id:prepareJobId,workId:x.work.id,grantId:input.id,state:'awaiting_terms_review',localAlbumSnapshot:{localVerified:true},terms:{termsHash:snapshot.termsHash}};
 x.repo.save('settings',{id:'tme-ai-prepare:job:'+prepareJobId,value:prepared});
 const append=albums.prepareAppend({runId:x.run.id,itemId:x.item.id,platform:link.platform,accountId:link.accountId,materialFingerprint:w.planPublicationMaterialFingerprint(x.s,x.run,x.item),publicationTaskId:task.id,prepareJobId}),appendPreview=albums.preview({operationId:append.id});albums.authorize({operationId:append.id,summaryHash:appendPreview.summaryHash,confirmed:true});albums.claim({operationId:append.id,summaryHash:appendPreview.summaryHash});
 const submission=new w.TmeAiSubmissionService(x.repo,{now:x.s.now,resolvePrepared:()=>({job:prepared,grant:{input}}),verifyAssets:()=>true,verifyWrite:g=>w.verifyPlanTmeAppendWrite(x.s,g,prepareJobId)}),sessionId=randomUUID(),contract={available:true,reasons:[],transport:'offline-fixture'};
 let row=submission.review({prepareJobId,snapshot,contract,sessionId});row=submission.authorize({id:row.id,expectedRevision:row.revision,termsHash:row.termsHash,consent:true,rightsConfirmed:true,sessionId});
 let claimed=submission.claim({id:row.id,expectedRevision:row.revision,phase:'accept',snapshot,sessionId});row=submission.record({id:row.id,operationId:claimed.operation.id,result:{status:'accepted',snapshot,scopeHash:row.scopeHash}});
 claimed=submission.claim({id:row.id,expectedRevision:row.revision,phase:'submit',snapshot,sessionId});
 const receipt={source:'official-tencent-review-record',entityType:'song',remoteId:'100001',albumId:'fixture-album',title:x.work.title,artistName:'Fixture artist',status:'reviewing',subjectHash,scopeHash:row.scopeHash,submittedAt:x.s.now().toISOString(),observedAt:x.s.now().toISOString(),evidenceHash:'c'.repeat(64),url:'https://y.tencentmusic.com/#/user/manage/albumlist'};
 row=submission.record({id:row.id,operationId:claimed.operation.id,result:{status:'reviewing',receipt}});assert.equal(row.submissionByClient,true);
 service.update({id:task.id,expectedRevision:task.revision,patch:{prepareJobId,submissionJobId:row.id}});
 const projected=w.syncPlanPublications(x.s);assert.equal(projected[0].state,'reviewing');assert.equal(projected[0].onlineVerified,true);assert.equal(projected[0].receipt.remoteId,'100001');assert.equal(projected[1].onlineVerified,false);
});

test('Main scoped routing preserves independent nonce review and exact account RPC scope',async t=>{
 const x=setup(t),links=w.syncPlanPublications(x.s),grants=[],calls=[];
 installFixtureBindings(x);
 let currentAccount=0;
 const rpc=async(method,input={})=>{
  calls.push({method,input});
  if(method==='internal.tmeAiPrepare.resolveScope')return{ok:true,value:w.resolveTmeAiPrepareScope(x.s,input)};
  if(method==='internal.tmeAiPrepare.listPublic')return{ok:true,value:{grants:grants.map(g=>({id:g.id,revision:1,workId:g.input.workId,publicationTaskId:g.input.publicationTaskId,accountId:g.input.accountId})),jobs:[]}};
  if(method==='internal.tmeAiPrepare.grantContext')return{ok:true,value:grants.find(g=>g.id===input.id)};
  if(method==='internal.tmeAiPrepare.registerScopedGrant'){assert.equal(input.grant.publicationTaskId,input.publicationTaskId);assert.equal(input.grant.accountId,input.accountId);const grant={id:input.grant.id,input:input.grant};grants.push(grant);return{ok:true,value:grant}};
  if(method==='internal.tmeAiSubmission.inspectWork')return{ok:true,value:{workId:input.workId,readyForNative:false,reasons:['OFFLINE_FIXTURE'],prepareJobId:null}};
  throw Error('UNEXPECTED_RPC:'+method);
 };
 const options={root:x.root,rpc,available:()=>true,generation:()=>1};
 const wrapper=w.createPlanPublicationBrokers({prepare:{...options,port:{request:async()=>({snapshot:{observedAt:new Date().toISOString(),identity:{kugouId:String(123456789+currentAccount),qqDisplayName:'Fixture account '+currentAccount,artistName:'Fixture artist'},binding:{pid:42,handle:'101',started:'fixture'},mode:'intake',modeText:'Fixture intake',visibleSubmitButton:false}})}},submission:{...options,observe:async()=>{throw Error('NO_NATIVE_ACTION')}}});
 const scope=n=>({workId:x.work.id,publicationTaskId:links[n].publicationTaskId,accountId:links[n].accountId});
 const a=await wrapper.prepare.ui('inspect',scope(0));currentAccount=1;const b=await wrapper.prepare.ui('inspect',scope(1));
 await assert.rejects(wrapper.prepare.ui('register',{...scope(1),consent:true,authorizationNonce:a.authorizationNonce}),/CONSENT_REVIEW_REQUIRED/);
 // A failed use consumes only that task's nonce. Reinspect B; A's nonce remains usable.
 const freshB=await wrapper.prepare.ui('inspect',scope(1));await wrapper.prepare.ui('register',{...scope(1),consent:true,authorizationNonce:freshB.authorizationNonce});
 currentAccount=0;await wrapper.prepare.ui('register',{...scope(0),consent:true,authorizationNonce:a.authorizationNonce});assert.equal(grants.length,2);
 assert.equal(new Set(grants.map(g=>g.input.accountId)).size,2);assert.equal(new Set(grants.map(g=>g.input.publicationTaskId)).size,2);
 await wrapper.submission.ui('preflight',scope(1));const inspection=calls.find(c=>c.method==='internal.tmeAiSubmission.inspectWork');assert.equal(inspection.input.publicationTaskId,links[1].publicationTaskId);assert.equal(inspection.input.accountId,links[1].accountId);
});

test('Main album seam uses only explicit fixture transport and checks account evidence',async()=>{
 const scope={platform:'qqmusic',accountId:randomUUID(),accountFingerprint:'e'.repeat(64)},provider=w.createPlanPublicationAlbumProvider();
 assert.equal(provider.capabilities().albumCatalog.available,false);await assert.rejects(provider.catalog(scope),/OFFICIAL_ALBUM_CATALOG_UNAVAILABLE/);
 const fixture=w.createPlanPublicationAlbumProvider({environment:'offline-fixture',catalog:async request=>({...request,source:'offline-fixture',observedAt:'2026-10-19T10:00:00Z',evidenceId:'fixture-catalog',albums:[{id:'fixture-album',title:'Fixture album'}]})});
 const catalog=await fixture.catalog(scope);assert.equal(catalog.albums[0].id,'fixture-album');assert.equal(fixture.capabilities().albumAppend.available,false);
 const mismatch=w.createPlanPublicationAlbumProvider({environment:'offline-fixture',catalog:async request=>({...request,accountId:randomUUID(),source:'offline-fixture',observedAt:'2026-10-19T10:00:00Z',evidenceId:'fixture-catalog',albums:[]})});await assert.rejects(mismatch.catalog(scope),/ALBUM_CATALOG_ACCOUNT_SCOPE/);
});
test('Main wrapper preserves legacy fallback and one shared in-flight native UI lock',async t=>{
 const x=setup(t);
 let release,entered=false;
 const gate=new Promise(resolve=>{release=resolve}),options={root:x.root,rpc:async method=>{if(method==='internal.tmeAiPrepare.listPublic')return{ok:true,value:{grants:[],jobs:[]}};throw Error('UNEXPECTED_RPC')},available:()=>true,generation:()=>1};
 const wrapper=w.createPlanPublicationBrokers({prepare:{...options,resolveScope:async(workId,createDerivative)=>w.resolveTmeAiPrepareScope(x.s,{workId,createDerivative}),port:{request:async()=>{entered=true;await gate;return{snapshot:{observedAt:new Date().toISOString(),identity:{kugouId:'123456789',qqDisplayName:'Fixture account',artistName:'Fixture artist'},binding:{pid:42,handle:'101',started:'fixture'},mode:'intake',modeText:'Fixture intake',visibleSubmitButton:false}}}}},submission:{...options,observe:async()=>{throw Error('NO_NATIVE_ACTION')}}});
 const first=wrapper.prepare.ui('inspect',{workId:x.work.id});await new Promise(resolve=>setTimeout(resolve,0));assert.equal(entered,true);
 await assert.rejects(wrapper.prepare.ui('inspect',{workId:x.work.id}),/PUBLICATION_BUSY/);release();assert.ok((await first).authorizationNonce);
});
test('legacy official receipts protect history but cannot attribute success without account evidence',t=>{
 const x=setup(t),receipt={source:'official',state:'reviewing',workId:x.work.id,title:x.work.title,artistName:'Fixture artist',audioSha256:x.audio.sha256,externalSongRecordId:'100001',albumId:'200001',albumTitle:'Fixture album',acceptedAt:'2026-10-19T09:00:00Z',termsSha256:'d'.repeat(64),explicitUserConsentAt:'2026-10-19T08:59:00Z',submittedAt:'2026-10-19T09:00:01Z',observedAt:'2026-10-19T10:00:00Z',officialStatusText:'Fixture reviewing',sourceUrl:'https://y.tencentmusic.com/#/user/manage/albumlist'};
 x.repo.save('settings',{id:'external-publication:tme:'+x.work.id,value:receipt});const links=w.syncPlanPublications(x.s);assert.ok(links.every(l=>!l.onlineVerified&&l.reason==='OFFICIAL_RECEIPT_ACCOUNT_UNVERIFIED'));
 for(const task of w.unifiedPublicationService(x.s).list())assert.throws(()=>w.unifiedPublicationService(x.s).claim({id:task.id,expectedRevision:task.revision}),/OFFICIAL_RECORD_ALREADY_EXISTS/);
});
test('real album directory/create/append remain unavailable and no local album snapshot becomes remote success',t=>{
 const x=setup(t),caps=w.planPublicationCapabilities(x.s);for(const k of ['albumCatalog','albumCreate','albumAppend'])assert.equal(caps[k].available,false);
 assert.equal(caps.publication.available,true);x.run.snapshot.publishTargets[0].album={mode:'new',title:'New fixture album'};
 const links=w.syncPlanPublications(x.s);assert.equal(links[0].reason,'ALBUM_CREATE_CONFIRMATION_REQUIRED');assert.equal(links[0].onlineVerified,false);
});
test('exact publication task scope resolves two accounts without global account edits',t=>{
 const x=setup(t),links=w.syncPlanPublications(x.s);assert.throws(()=>w.resolveTmeAiPrepareScope(x.s,{workId:x.work.id}),/ACCOUNT_SCOPE_AMBIGUOUS/);
 installFixtureBindings(x);
 for(const l of links){const scope=w.resolveTmeAiPrepareScope(x.s,{workId:x.work.id,publicationTaskId:l.publicationTaskId,accountId:l.accountId});assert.equal(scope.accountId,l.accountId);assert.equal(scope.publicationTaskId,l.publicationTaskId)}
 assert.throws(()=>w.resolveTmeAiPrepareScope(x.s,{workId:x.work.id,publicationTaskId:links[0].publicationTaskId,accountId:links[1].accountId}),/ACCOUNT_SCOPE/);
});
test('Core exact scoped grants preserve identity/material gates and do not unlock unavailable plan albums',async t=>{
 const x=setup(t),identities=x.accounts.map((a,n)=>{const visible={kugouId:String(123456789+n),qqDisplayName:'Fixture account '+n,artistName:'Fixture artist'};return{...visible,subjectType:'official_visible_binding_fingerprint',subjectHash:w.tmeAiSubjectHash(visible),observedAt:x.s.now().toISOString(),evidenceHash:sha('identity-'+n)}});
 x.accounts.forEach((a,n)=>{a.remoteSubject=identities[n].subjectHash;x.repo.save('accounts',a)});
 const links=w.syncPlanPublications(x.s),service=w.createTmeAiPrepareService(x.s);x.s.tmeAiPrepareService=()=>service;
 const grantFor=n=>{const scope=w.resolveTmeAiPrepareScope(x.s,{workId:x.work.id,publicationTaskId:links[n].publicationTaskId,accountId:links[n].accountId,createDerivative:true});delete scope.variant;delete scope.prepareOnly;return{id:randomUUID(),...scope,identity:identities[n],binding:{pid:42,handle:'101',started:'fixture'},consent:true}};
 assert.throws(()=>grantFor(0),/ALBUM_NOT_BOUND/);assert.equal(service.listPublic().grants.length,0);
 // The same established standalone queue service supports distinct exact grants; no plan capability is enabled.
 x.repo.db.prepare("DELETE FROM settings WHERE id LIKE 'plan-publication:v1:%'").run();
 for(let n=0;n<2;n++){const grant=grantFor(n);const saved=w.executeTmeAiPrepare(x.s,'registerScopedGrant',{grant,accountId:links[n].accountId,publicationTaskId:links[n].publicationTaskId});assert.equal(saved.input.accountId,links[n].accountId);assert.equal(saved.input.publicationTaskId,links[n].publicationTaskId);w.verifyCurrentTmeAiScope(x.s,grant);}
 assert.equal(service.listPublic().grants.length,2);assert.equal(w.executeTmeAiPrepare(x.s,'listPublic').grants.filter(g=>g.publicationTaskId).length,2);
 let selectedAccount=0;
 const rpc=async(method,input={})=>{try{return{ok:true,value:w.executeTmeAiPrepare(x.s,method.split('.').at(-1),input)}}catch(e){return{ok:false,error:{code:e.message}}}};
 const options={root:x.root,rpc,available:()=>true,generation:()=>1},wrapper=w.createPlanPublicationBrokers({prepare:{...options,port:{request:async()=>({snapshot:{observedAt:x.s.now().toISOString(),identity:identities[selectedAccount],binding:{pid:42,handle:'101',started:'fixture'},mode:'intake',modeText:'Fixture intake',visibleSubmitButton:false}})}},submission:{...options,observe:async()=>{throw Error('NO_NATIVE_ACTION')}}});
 for(const [n,g] of w.executeTmeAiPrepare(x.s,'listPublic').grants.entries()){selectedAccount=n;const started=await wrapper.prepare.ui('start',{grantId:g.id,expectedRevision:g.revision,consent:true});assert.equal(started.job.grantId,g.id);assert.equal(started.job.state,'ready');}
 assert.equal(x.repo.all('operations').length,0);
 const first=service.listPublic().grants[0],current=x.repo.get('settings','tme-ai-prepare:grant:'+first.id).value.input;
 assert.throws(()=>w.verifyCurrentTmeAiScope(x.s,{...current,accountId:links[1].accountId}),/ACCOUNT_SCOPE/);
 x.work.publicationMetadata.aiTool='Changed tool';x.repo.save('works',x.work);assert.throws(()=>w.verifyCurrentTmeAiScope(x.s,current),/PREPARATION_GRANT_STALE/);
});

test('cover timeout keeps all tasks blocked until the original native promise really settles',async t=>{
 const x=setup(t),links=w.syncPlanPublications(x.s),jobId=randomUUID(),grantId=randomUUID(),operationId=randomUUID();
 installFixtureBindings(x);
 const scope=n=>({workId:x.work.id,publicationTaskId:links[n].publicationTaskId,accountId:links[n].accountId});
 const grant={id:grantId,input:{...scope(0),metadata:{artistName:'Fixture artist'},binding:{pid:42,handle:'101',started:'fixture'}}};
 const context={job:{id:jobId,workId:x.work.id,grantId,revision:1,state:'reconcile_required',reason:'MANUAL_COVER_ACCEPTANCE_REQUIRED',step:'set_cover',operationId},grant,operations:[{id:operationId,cropResume:{}}]};
 let release,nativeInspections=0;
 const pending=new Promise(resolve=>{release=resolve});
 const rawSnapshot={observedAt:new Date().toISOString(),identity:{kugouId:'123456789',qqDisplayName:'Fixture account',artistName:'Fixture artist'},binding:grant.input.binding,mode:'intake',modeText:'Fixture intake',visibleSubmitButton:false};
 const rpc=async(method,input={})=>{
  if(method==='internal.tmeAiPrepare.context')return{ok:true,value:context};
  if(method==='internal.tmeAiPrepare.resolveScope')return{ok:true,value:w.resolveTmeAiPrepareScope(x.s,input)};
  if(method==='internal.tmeAiPrepare.listPublic')return{ok:true,value:{grants:[],jobs:[]}};
  throw Error('UNEXPECTED_RPC:'+method);
 };
 const options={root:x.root,rpc,available:()=>true,generation:()=>1};
 const wrapper=w.createPlanPublicationBrokers({prepare:{...options,readbackTimeoutMs:10,port:{request:async action=>{if(action==='observe')return pending;nativeInspections++;return{snapshot:rawSnapshot}}}},submission:{...options,observe:async()=>{throw Error('NO_NATIVE_ACTION')}}});
 try{
  await assert.rejects(wrapper.prepare.ui('reconcile',{id:jobId,publicationTaskId:scope(0).publicationTaskId,accountId:scope(0).accountId}),/MANUAL_COVER_ACCEPTANCE_REQUIRED/);
  await assert.rejects(wrapper.prepare.ui('inspect',scope(1)),/PUBLICATION_BUSY/);assert.equal(nativeInspections,0);
 }finally{release({snapshot:rawSnapshot});await new Promise(resolve=>setTimeout(resolve,0));}
 await wrapper.prepare.ui('inspect',scope(1));assert.equal(nativeInspections,1);
});

test('explicit task/account can never route another task grant, prepare job or submission job',async t=>{
 const x=setup(t),links=w.syncPlanPublications(x.s),grantId=randomUUID(),jobId=randomUUID(),submissionId=randomUUID(),effects=[];
 const scope=n=>({workId:x.work.id,publicationTaskId:links[n].publicationTaskId,accountId:links[n].accountId});
 const grant={id:grantId,input:{...scope(0),metadata:{artistName:'Fixture artist'}}},context={job:{id:jobId,workId:x.work.id,grantId,revision:1,state:'reconcile_required',reason:'NATIVE_OUTCOME_UNKNOWN'},grant,operations:[]};
 const rpc=async(method,input={})=>{
  if(method==='internal.tmeAiPrepare.grantContext')return{ok:true,value:grant};
  if(method==='internal.tmeAiPrepare.context')return{ok:true,value:context};
  if(method==='internal.tmeAiSubmission.context')return{ok:true,value:{job:{id:submissionId,workId:x.work.id,prepareJobId:jobId},prepared:context}};
  if(method==='internal.tmeAiPrepare.listPublic')return{ok:true,value:{grants:[],jobs:[]}};
  if(method==='internal.tmeAiSubmission.externalContext')return{ok:true,value:null};
  effects.push(method);return{ok:true,value:{}};
 };
 const options={root:x.root,rpc,available:()=>true,generation:()=>1},wrapper=w.createPlanPublicationBrokers({prepare:{...options,port:{request:async()=>{effects.push('native');throw Error('UNEXPECTED_NATIVE')}}},submission:{...options,observe:async()=>{effects.push('observe');throw Error('UNEXPECTED_NATIVE')}}});
 const route={publicationTaskId:links[1].publicationTaskId,accountId:links[1].accountId};
 for(const action of ['reconcile','start','run','context','resumePicker','resumeCrop'])await assert.rejects(wrapper.prepare.ui(action,{...(action==='start'?{grantId}:{id:jobId}),...route,...(['context','reconcile'].includes(action)?{}:{expectedRevision:1,consent:true})}),/PREPARATION_ACCOUNT_SCOPE/);
 for(const action of ['authorizeAndSubmit','reconcile'])await assert.rejects(wrapper.submission.ui(action,{id:submissionId,...route,...(action==='authorizeAndSubmit'?{expectedRevision:1,termsHash:'a'.repeat(64),consent:true,rightsConfirmed:true}:{})}),/SUBMISSION_ACCOUNT_SCOPE/);
 assert.deepEqual(effects,[]);
});

test('legacy grants remain legacy in Core context and queue pump inputs',async t=>{
 const x=setup(t),visible={kugouId:'123456789',qqDisplayName:'Fixture account',artistName:'Fixture artist'};
 x.accounts[0].remoteSubject=w.tmeAiSubjectHash(visible);x.repo.save('accounts',x.accounts[0]);x.run.snapshot.publishTargets=x.run.snapshot.publishTargets.slice(0,1);
 const [link]=w.syncPlanPublications(x.s);x.repo.db.prepare("DELETE FROM settings WHERE id LIKE 'plan-publication:v1:%'").run();
 const service=w.createTmeAiPrepareService(x.s);x.s.tmeAiPrepareService=()=>service;
 const current=w.resolveTmeAiPrepareScope(x.s,{workId:x.work.id,createDerivative:true});delete current.variant;delete current.prepareOnly;delete current.accountId;
 const identity={...visible,subjectType:'official_visible_binding_fingerprint',subjectHash:x.accounts[0].remoteSubject,observedAt:x.s.now().toISOString(),evidenceHash:'f'.repeat(64)};
 const grant=service.registerGrant({id:randomUUID(),...current,identity,binding:{pid:42,handle:'101',started:'fixture'},consent:true});
 const ctx=w.executeUnifiedPublication(x.s,'prepareContext',{id:link.publicationTaskId});assert.equal(ctx.grant.id,grant.id);assert.equal(ctx.grant.publicationTaskId,undefined);assert.equal(ctx.grant.scopeKind,'legacy');
 const rpc=async(method,input={})=>{try{return{ok:true,value:w.executeTmeAiPrepare(x.s,method.split('.').at(-1),input)}}catch(e){return{ok:false,error:{code:e.message}}}};
 const options={root:x.root,rpc,available:()=>true,generation:()=>1},wrapper=w.createPlanPublicationBrokers({prepare:{...options,resolveScope:async(workId,createDerivative)=>w.resolveTmeAiPrepareScope(x.s,{workId,createDerivative}),port:{request:async()=>({snapshot:{observedAt:x.s.now().toISOString(),identity:visible,binding:grant.input.binding,mode:'intake',modeText:'Fixture intake',visibleSubmitButton:false}})}},submission:{...options,observe:async()=>{throw Error('NO_NATIVE_ACTION')}}});
 const started=await wrapper.prepare.ui('start',{grantId:grant.id,expectedRevision:grant.revision,consent:true});assert.equal(started.job.grantId,grant.id);assert.equal(started.job.state,'ready');assert.equal(x.repo.all('operations').length,0);
 let task={...ctx.task,state:'queued'},calls=[];
 const broker=w.createUnifiedPublishBroker({available:()=>true,generation:()=>1,nativeAvailable:()=>true,rpc:async(method,input={})=>{const action=method.split('.').at(-1);if(action==='list')return{ok:true,value:[task]};if(action==='prepareContext')return{ok:true,value:{...ctx,task}};if(action==='claim'){task={...task,state:'preparing',revision:task.revision+1};return{ok:true,value:task}};if(action==='update'){task={...task,...input.patch,revision:task.revision+1};return{ok:true,value:task}};throw Error('UNEXPECTED_RPC:'+method)},prepare:{ui:async(action,input)=>{calls.push([action,input]);return{job:{id:randomUUID(),workId:x.work.id,grantId:grant.id,revision:1,state:'awaiting_terms_review'}}}},submission:{ui:async(action,input)=>{calls.push([action,input]);return{workId:x.work.id,job:{id:randomUUID()}}}}});
 await broker.pump();assert.equal(task.state,'awaiting_confirmation');for(const [,input] of calls){assert.equal(input.publicationTaskId,undefined);assert.equal(input.accountId,undefined)}
});

test('scoped ready preflight validates a preparation ID as preparation context and reaches review only for its exact scope',async t=>{
 for(const mismatch of [false,true]){
  const x=setup(t),scope={workId:x.work.id,publicationTaskId:randomUUID(),accountId:x.accounts[0].id},prepareId=randomUUID(),grantId=randomUUID(),submissionId=randomUUID(),calls=[];
  const prepared={job:{id:prepareId,workId:x.work.id,grantId,state:'awaiting_terms_review'},grant:{id:grantId,input:{...scope,...(mismatch?{publicationTaskId:randomUUID()}: {})}}};
  const row={id:submissionId,workId:x.work.id,prepareJobId:prepareId,familyKey:'a'.repeat(64),revision:1,state:'reviewed'};
  let observations=0,reviews=0;
  const rpc=async(method,input={})=>{
   calls.push({method,input});
   if(method==='internal.tmeAiSubmission.inspectWork')return{ok:true,value:{workId:x.work.id,title:x.work.title,readyForNative:true,prepareJobId:prepareId}};
   if(method==='internal.tmeAiPrepare.context'||method==='internal.tmeAiSubmission.preparedContext'){assert.equal(input.id,prepareId);return{ok:true,value:prepared};}
   if(method==='internal.tmeAiSubmission.context'){if(input.id===prepareId)return{ok:false,error:{code:'NOT_FOUND'}};assert.equal(input.id,submissionId);return{ok:true,value:{job:row,prepared}};}
   if(method==='internal.tmeAiSubmission.review'){assert.equal(input.prepareJobId,prepareId);reviews++;return{ok:true,value:row};}
   if(method==='internal.tmeAiSubmission.publicJob')return{ok:true,value:row};
   throw Error('UNEXPECTED_RPC:'+method);
  };
  const options={root:x.root,rpc,available:()=>true,generation:()=>1},wrapper=w.createPlanPublicationBrokers({prepare:{...options,port:{request:async()=>{throw Error('NO_PREPARE_ACTION')}}},submission:{...options,observe:async context=>{assert.equal(context.job.id,prepareId);observations++;return{fixture:true}},executor:{capability:()=>({available:true,reasons:[],transport:'offline-fixture'}),accept:async()=>{throw Error('NO_ACCEPT')},submit:async()=>{throw Error('NO_SUBMIT')},readReceipt:async()=>{throw Error('NO_RECEIPT')}}}});
  const result=await wrapper.submission.ui('preflight',scope);
  if(mismatch){assert.equal(result.ready,false);assert.ok(result.reasons.includes('SUBMISSION_ACCOUNT_SCOPE'));assert.equal(observations,0);assert.equal(reviews,0);}
  else{assert.equal(result.ready,true);assert.equal(result.job.id,submissionId);assert.equal(observations,1);assert.equal(reviews,1);}
  assert.equal(calls.some(call=>call.method==='internal.tmeAiSubmission.context'&&call.input.id===prepareId),false);
 }
});
