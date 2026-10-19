import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {randomUUID,createHash} from 'node:crypto';import {createRequire} from 'node:module';
const api=createRequire(import.meta.url)(process.env.RAINFALL_PLAN_ALBUM_INTEGRATION_BUNDLE);
function setup(t,{fixture=false,album={mode:'new',title:'Isolated album'}}={}){
 let at='2026-10-19T10:00:00Z';const s=new api.Studio(path.resolve('output/test-runs/album-integration-'+randomUUID()),'production',{now:()=>new Date(at),...(fixture?{albumServiceFactory:studio=>api.createPlanAlbumService(studio,{allowFixture:true})}:{})});t.after(()=>s.close());
 const account=s.save('accounts',{id:randomUUID(),provider:'tme',remoteSubject:'a'.repeat(64),name:'Offline account'}),artist=s.all('artists')[0],center=s.planCenterService();
 const plan=center.save({expectedRevision:null,plan:{id:randomUUID(),artistId:artist.id,title:'Album integration',schedule:{kind:'daily',localTime:'09:00'},material:{source:'manual'},text:{},music:{route:'manual'},authorization:{publish:true},publishTargets:[{platform:'qqmusic',accountId:account.id,enabled:true,album}]}}),preview=center.preview({id:plan.id}),run=center.run({id:plan.id,expectedRevision:plan.revision,summaryHash:preview.summaryHash,requestId:randomUUID(),source:'debug'}),item=center.list().items[0];
 const input={runId:run.id,platform:'qqmusic',accountId:account.id};return{s,account,artist,center,plan,run,item,input,now:v=>at=v};
}
function attachMaterials(x){
 const {s}=x,asset=(kind,name)=>{const bytes=Buffer.from('Isolated original '+name),sha256=createHash('sha256').update(bytes).digest('hex'),ext=kind==='audio'?'wav':'png',file=path.join(s.root,'media','sha256',sha256.slice(0,2),sha256+'.'+ext);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);return s.save('assets',{id:randomUUID(),kind,sha256,ext,mime:kind==='audio'?'audio/wav':'image/png',bytes:bytes.length,metadata:kind==='audio'?{format:{duration:'180'},streams:[{codec_type:'audio',sample_rate:'48000'}]}:{width:3000,height:3000}})},audio=asset('audio','audio'),cover=asset('image','cover');
 let work=s.saveWork({artistId:x.artist.id,title:'Isolated album song',lyrics:'Isolated original lyrics',story:'Offline story',prompt:'Offline prompt',parameters:{},rights:'Original recording and composition owned by fixture',ai:'generated'});work=s.save('works',{...work,assets:{audio_A:audio.id,cover:cover.id},publicationMetadata:{lyricist:'Writer',composer:'Composer',ownLyrics:false,ownComposition:true,allowCover:false,aiTool:'Fixture tool',generatedOn:'2026-10-15',genre:'pop',language:'en',albumDescription:'Fixture album description'}});
 for(const target of ['qqmusic','kugou'])s.save('settings',{id:'simple-publishing:platform:v1:'+target,value:{version:1,revision:1,target,accountId:x.account.id,artistId:x.artist.id,lyricist:'Writer',composer:'Composer',album:'Old global album',genre:'pop',language:'en',aiDisclosure:'generated',isCover:false}});
 const lyric=s.lyricService().forWork(work);s.lyricService().confirm({workId:work.id,versionId:lyric.versionId,plainHash:lyric.plainHash,audioHash:audio.sha256,confirmed:true});
 const row=s.repo.get('settings','plan-center:item:'+x.item.id);row.value={...row.value,workId:work.id,materials:{title:work.title,lyrics:work.lyrics,audioAssetId:audio.id,coverAssetId:cover.id,selectedVersion:'A',rightsEvidenceId:'fixture-rights',consistencyEvidenceId:'fixture-match'},versions:[{version:'A',assetId:audio.id,sha256:audio.sha256}]};s.save('settings',row);return{work:s.get('works',work.id),audio,cover};
}
function selectExisting(x,source='official'){
 const service=x.s.planAlbumService(),catalog=service.recordCatalog({scope:service.scope(x.input),source,completeness:'partial',observedAt:x.s.now().toISOString(),expiresAt:'2026-10-19T11:00:00Z',evidenceHash:'b'.repeat(64),entries:[{key:'exact',id:'remote-existing',title:'Observed album'}]});return service.selectBinding({...x.input,catalogId:catalog.id,entryKey:'exact'});
}

test('review: original late receipt survives routine sync after expiry',async t=>{
 const x=setup(t,{album:{mode:'existing',albumId:'remote-existing'}});attachMaterials(x);selectExisting(x);
 const op=await x.s.call('planAlbums.prepareAppend',{...x.input,itemId:x.item.id}),preview=await x.s.call('planAlbums.preview',{operationId:op.id});
 api.executeInternalPlanAlbums(x.s,'authorize',{operationId:op.id,summaryHash:preview.summaryHash,confirmed:true});api.executeInternalPlanAlbums(x.s,'claim',{operationId:op.id,summaryHash:preview.summaryHash});api.executeInternalPlanAlbums(x.s,'activateAppend',{operationId:op.id});
 x.center.stop({runId:x.run.id});x.now('2026-10-19T12:00:00Z');
 const key='unified-publication:v1:'+op.publicationTaskId,row=x.s.repo.get('settings',key);x.s.save('settings',{...row,value:{...row.value,state:'published',receipt:{songId:'original-song',albumId:'remote-existing',subjectHash:x.account.remoteSubject,source:'official'}}});
 api.syncPlanPublications(x.s);
 assert.equal(api.executeInternalPlanAlbums(x.s,'appendResult',{operationId:op.id}).status,'succeeded');
});
test('review: catalog refresh allows same-run fresh create confirmation',async t=>{
 const x=setup(t),svc=x.s.planAlbumService(),op=svc.prepareCreate(x.input);
 svc.recordCatalog({scope:svc.scope(x.input),source:'official',completeness:'partial',observedAt:x.s.now().toISOString(),expiresAt:'2026-10-19T11:00:00Z',evidenceHash:'b'.repeat(64),entries:[]});
 const preparedAgain=svc.prepareCreate(x.input),preview=svc.preview({operationId:preparedAgain.id});
 assert.equal(svc.authorize({operationId:op.id,summaryHash:preview.summaryHash,confirmed:true}).state,'authorized');
});

test('review: expired binding never promotes a sibling-album receipt online',t=>{
 const x=setup(t,{album:{mode:'existing',albumId:'remote-existing'}});attachMaterials(x);selectExisting(x);const [link]=api.syncPlanPublications(x.s),key='unified-publication:v1:'+link.publicationTaskId,row=x.s.repo.get('settings',key);x.now('2026-10-19T12:00:00Z');
 x.s.save('settings',{...row,value:{...row.value,state:'published',receipt:{songId:'wrong-album-song',albumId:'sibling-album',subjectHash:x.account.remoteSubject,source:'official'}}});assert.equal(api.syncPlanPublications(x.s)[0].onlineVerified,false);
});
test('review: expired fixture binding never becomes official via old receipt shape',t=>{
 const x=setup(t,{fixture:true,album:{mode:'existing',albumId:'remote-existing'}});attachMaterials(x);selectExisting(x,'offline-fixture');const [link]=api.syncPlanPublications(x.s),key='unified-publication:v1:'+link.publicationTaskId,row=x.s.repo.get('settings',key);x.now('2026-10-19T12:00:00Z');
 x.s.save('settings',{...row,value:{...row.value,state:'published',receipt:{songId:'fixture-song',albumId:'remote-existing',subjectHash:x.account.remoteSubject,source:'official'}}});assert.equal(api.syncPlanPublications(x.s)[0].onlineVerified,false);
});
