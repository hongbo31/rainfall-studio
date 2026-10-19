import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createHash,randomUUID} from 'node:crypto';import {createRequire} from 'node:module';const api=createRequire(import.meta.url)(path.resolve('output/existing-album-browser-tests/adapter.cjs'));
const hash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const origin='https://y.tencentmusic.com',route=origin+'/#/user/manage/aiChoose/add';
const pendingPath='/openapi/musician/original/cursorUnPublishSong';
const pdfBytes='Rainfall isolated existing-album authorization fixture v1',termsText='非独家授权 测试授权书';
const binding={transport:'cloud-playwright',sessionId:randomUUID(),pageId:randomUUID(),started:'2026-10-18T10:00:00.000Z'};
const identity={kugouId:'123456789',qqDisplayName:'Fixture QQ',artistName:'Fixture Artist'};
const subjectHash=hash({subjectType:'official_visible_binding_fingerprint',...identity});
const metadata={title:'Fixture song',albumMode:'existing',albumTitle:'Exact album',albumDescription:'Local description',artistName:identity.artistName,lyricist:'Fixture Lyricist',composer:'Fixture Composer',ownLyrics:true,ownComposition:false,aiTool:'Fixture tool',generatedOn:'2026-10-18',allowCover:false,genre:'流行',language:'国语',version:'完整版',releaseMode:'审核通过即发布'};
const lyricsText='These are explicitly synthetic fixture lyrics.';
async function runProbe(t,{stop=false,unknown=false}={}){
 const albumMode='existing';
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rainfall-bound-album-e2e-')),repo=new api.Repository(path.join(root,'db.sqlite')),now=()=>new Date('2026-10-19T10:00:00Z');
 t.after(()=>repo.close());
 const account={id:randomUUID(),provider:'tme',name:'Offline fixture',remoteSubject:subjectHash},artist={id:randomUUID(),name:identity.artistName};repo.save('accounts',account);repo.save('artists',artist);
 const pcm=Buffer.alloc(16044);pcm.write('RIFF');pcm.writeUInt32LE(16036,4);pcm.write('WAVEfmt ',8);pcm.writeUInt32LE(16,16);pcm.writeUInt16LE(1,20);pcm.writeUInt16LE(1,22);pcm.writeUInt32LE(8000,24);pcm.writeUInt32LE(16000,28);pcm.writeUInt16LE(2,32);pcm.writeUInt16LE(16,34);pcm.write('data',36);pcm.writeUInt32LE(16000,40);
 const audio={id:randomUUID(),kind:'audio',sha256:createHash('sha256').update(pcm).digest('hex'),ext:'wav',mime:'audio/wav',bytes:pcm.length},cover={id:randomUUID(),kind:'image',sha256:hash('fixture cover'),ext:'png',mime:'image/png',bytes:13};
 const files=new Map([[audio.id,path.join(root,'source.wav')],[cover.id,path.join(root,'cover.png')]]);fs.writeFileSync(files.get(audio.id),pcm);fs.writeFileSync(files.get(cover.id),'fixture cover');for(const a of [audio,cover])repo.save('assets',a);
 const work={id:randomUUID(),revision:1,artistId:artist.id,title:metadata.title,lyrics:lyricsText,rights:'Confirmed fixture original',ai:'generated',assets:{audio_A:audio.id,cover:cover.id},publicationMetadata:{...metadata,albumMode:'new',albumTitle:'Global default'}};repo.save('works',work);
 for(const target of ['qqmusic','kugou'])repo.save('settings',{id:'simple-publishing:platform:v1:'+target,value:{version:1,revision:1,target,accountId:account.id,artistId:artist.id,lyricist:metadata.lyricist,composer:metadata.composer,album:'Global default',genre:metadata.genre,language:metadata.language,aiDisclosure:'generated',isCover:false}});
 const center=new api.PlanCenterService(repo,{now}),plan=center.save({expectedRevision:null,plan:{id:randomUUID(),title:'Isolated append integration',artistId:artist.id,schedule:{kind:'daily',localTime:'09:00'},count:1,material:{source:'manual'},text:{},music:{route:'manual'},authorization:{publish:true},publishTargets:['qqmusic','kugou'].map(platform=>({platform,accountId:account.id,enabled:true,album:albumMode==='new'?{mode:'new',title:metadata.albumTitle}:{mode:'existing',albumId:'6437318'}}))}}),preview=center.preview({id:plan.id}),run=center.run({id:plan.id,expectedRevision:preview.planRevision,summaryHash:preview.summaryHash,requestId:randomUUID(),source:'debug'});
 const albums=new api.PlanAlbumService(repo,{now,allowFixture:true}),albumInput={runId:run.id,platform:'qqmusic',accountId:account.id};
 if(albumMode==='new'){const op=albums.prepareCreate(albumInput),preview=albums.preview({operationId:op.id});albums.authorize({operationId:op.id,summaryHash:preview.summaryHash,confirmed:true});albums.claim({operationId:op.id,summaryHash:preview.summaryHash});albums.record({operationId:op.id,status:'succeeded',scope:op.scope,source:'offline-fixture',albumId:'6437318',evidenceHash:'c'.repeat(64)});}
 else for(const platform of ['qqmusic','kugou']){const c=albums.recordCatalog({scope:albums.scope({...albumInput,platform}),source:'offline-fixture',completeness:'partial',observedAt:now().toISOString(),expiresAt:'2026-10-19T11:00:00Z',evidenceHash:'c'.repeat(64),entries:[{key:'observed',id:'6437318',title:metadata.albumTitle}]});albums.selectBinding({...albumInput,platform,catalogId:c.id,entryKey:'observed'});}
 const studio={root,mode:'production',now,repo,get:(table,id)=>repo.get(table,id),all:table=>repo.all(table),save:(table,row)=>repo.save(table,row),locate:id=>({file:files.get(id)}),planAlbumService:()=>albums,lyricService:()=>({forWork:w=>({raw:w.lyrics,cleaned:w.lyrics,plainHash:hash(w.lyrics),alignmentConfirmed:true,audioHash:audio.sha256,warnings:[]})})};
 const prepareService=api.createTmeAiPrepareService(studio);studio.tmeAiPrepareService=()=>prepareService;
 const task=api.publishSimple(studio,{workIds:[work.id],targets:['qqmusic','kugou'],accountOverrides:{qqmusic:account.id,kugou:account.id}}).pipeline[0];
 for(const platform of task.targets)repo.save('settings',{id:'plan-publication:v1:'+platform,value:{runId:run.id,platform,accountId:account.id,workId:work.id,publicationTaskId:task.id,albumIntent:{mode:'existing',albumId:'6437318'},albumBindingId:albums.bindingForRun({...albumInput,platform}).id}});
 const scopeInput={workId:work.id,publicationTaskId:task.id,accountId:account.id},scope=api.resolveTmeAiPrepareScope(studio,{...scopeInput,createDerivative:true});

 if(stop||unknown){const op=albums.prepareAppend({...albumInput,itemId:center.list().items[0].id,materialFingerprint:'fixture-material-v1',publicationTaskId:task.id}),p=albums.preview({operationId:op.id});albums.authorize({operationId:op.id,summaryHash:p.summaryHash,confirmed:true});albums.claim({operationId:op.id,summaryHash:p.summaryHash});}
 const {prepareOnly,variant,...frozen}=scope,observed={...identity,subjectType:'official_visible_binding_fingerprint',subjectHash,observedAt:now().toISOString(),evidenceHash:'e'.repeat(64)};
 const grant=api.executeTmeAiPrepare(studio,'registerScopedGrant',{accountId:account.id,publicationTaskId:task.id,grant:{...frozen,id:randomUUID(),identity:observed,binding,consent:true}});
 let job=prepareService.start({grantId:grant.id,expectedRevision:grant.revision,identity:observed,binding});
 const before={identity:observed,binding,observedAt:now().toISOString(),evidenceHash:'f'.repeat(64),mode:'intake',modeText:'fixture intake',visibleSubmitButton:false,verified:{}};const locate=prepareService.claim({id:job.id,expectedRevision:job.revision,step:job.step,before});job=prepareService.record({id:job.id,operationId:locate.operation.id,result:{status:'verified_existing',snapshot:before}});assert.equal(job.step,'upload_audio');
 if(stop)center.stop({runId:run.id});
 if(unknown)new api.PlanAlbumService(repo,{now,allowFixture:true});
 assert.throws(()=>prepareService.claim({id:job.id,expectedRevision:job.revision,step:job.step,before:{identity:observed,binding,observedAt:now().toISOString(),evidenceHash:'f'.repeat(64),mode:'intake',modeText:'fixture intake',visibleSubmitButton:false,verified:{}}}),stop?/STOP/:/ALBUM_APPEND/);
}
test('review: plan-linked original preparation cannot bypass absent append authorization',t=>runProbe(t));
test('review: stopping the plan revokes original preparation write claims',t=>runProbe(t,{stop:true}));

test("review: unknown album append cannot authorize another upload claim",t=>runProbe(t,{unknown:true}));
