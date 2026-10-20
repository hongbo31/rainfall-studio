const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process'),{createHash}=require('node:crypto');
const sharp=require('sharp');
const {FanqiePreparationService,fanqieMetadataFingerprint,verifyFanqieMaterials,fanqieCapabilities,Repository,probeFanqieForm,chooseFanqieFile,fanqieAuthorControl,UnifiedPublicationService}=require(process.env.RAINFALL_FANQIE_BUNDLE);
const h=x=>createHash('sha256').update(x).digest('hex');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rainfall-fanqie-test-'));
const base={workId:'test-only-work',scope:{accountId:'official-id',artistId:'official-artist',sessionId:'session'},title:'测试作品',ai:true,musicType:'original',rightsConfirmed:true,authors:{lyricist:'词作者',composer:'曲作者',singer:'歌手'},lyricsMatchConfirmed:true,assets:Object.fromEntries(['audio','lyrics','cover'].map(r=>[r,{file:path.join(dir,r),sha256:h(r),bytes:3}]))};
function memory(){const rows=new Map();return{all:()=>[...rows.values()].map(v=>structuredClone(v)),get:(_t,k)=>{if(!rows.has(k))throw Error('NOT_FOUND');return structuredClone(rows.get(k))},maybe:(_t,k)=>rows.has(k)?structuredClone(rows.get(k)):undefined,save:(_t,v)=>rows.set(v.id,structuredClone(v)),transaction:f=>f()};}
function port(input=base){
 const o={origin:'https://www.novelfm.com',scope:{...input.scope},source:'fixture',formVerified:true,songCount:1,songKey:'observed-card-1',metadataFingerprint:null,uploads:{}};
 const p={source:'fixture',o,writes:[],reclaims:0,observe:async()=>structuredClone(o),reclaim:async()=>{p.reclaims++},fill:async i=>{p.writes.push('metadata');o.metadataFingerprint=fanqieMetadataFingerprint(i)},chooseFile:async(role,a,key)=>{assert.equal(key,o.songKey);p.writes.push(role);o.uploads[role]={sha256:a.sha256,remoteId:'fixture-'+role}}};return p;
}
async function setup(){const repo=memory(),s=new FanqiePreparationService(repo,async()=>{}),j=await s.prepare(base),p=port();return{repo,s,j,p,grant:{fingerprint:j.fingerprint,upload:true}};}
test('production capability never claims upload, draft, submission or album support',()=>{assert.equal(fanqieCapabilities.preparation,true);for(const k of ['upload','draft','submission','album'])assert.equal(fanqieCapabilities[k],false)});
test('idempotent preparation freezes recording, account and artists',async()=>{const {s,j}=await setup();assert.equal((await s.prepare(base)).id,j.id);await assert.rejects(s.prepare({...base,title:'changed'}),/EXISTING_RECORDING/);const other=await s.prepare({...base,scope:{...base.scope,accountId:'different-account'}});assert.notEqual(other.id,j.id)});
test('production port remains blocked before any browser action',async()=>{const {s,j,p,grant}=await setup();p.source='browser';await assert.rejects(s.upload(j.id,p,grant),/RUNTIME_UNAVAILABLE/);assert.deepEqual(p.writes,[])});
test('upload needs exact explicit authorization',async()=>{const {s,j,p,grant}=await setup();await assert.rejects(s.upload(j.id,p,{...grant,upload:false}),/AUTHORIZATION/);await assert.rejects(s.upload(j.id,p,{...grant,fingerprint:'wrong'}),/AUTHORIZATION/);assert.deepEqual(p.writes,[])});
test('offline first step ends at contract boundary, never submitted',async()=>{const {s,j,p,grant}=await setup();const done=await s.upload(j.id,p,grant);assert.equal(done.stage,'contract_pending');assert.equal(done.reason,'OFFLINE_FIXTURE_ONLY');assert.deepEqual(p.writes,['metadata','audio','lyrics','cover']);await assert.rejects(s.upload(j.id,p,grant),/RECONCILIATION/)});
for(const change of ['origin','account','artist','session','card','duplicate'])test('rejects changed '+change+' before write',async()=>{const {s,j,p,grant}=await setup();if(change==='origin')p.o.origin='https://example.com';if(['account','artist','session'].includes(change))p.o.scope[change+'Id']='changed';if(change==='card')p.o.songKey='';if(change==='duplicate')p.o.songCount=2;await assert.rejects(s.upload(j.id,p,grant),/SCOPE_CHANGED/);assert.deepEqual(p.writes,[])});
test('reclaim retries reads only, and does not repeat a timed-out write',async()=>{const {s,j,p,grant}=await setup();let n=0;const read=p.observe;p.observe=async()=>{if(n++===0)throw Error('Debugger unattached');return read()};p.chooseFile=async role=>{p.writes.push(role);throw Error('timeout')};await assert.rejects(s.upload(j.id,p,grant),/timeout/);assert.equal(p.reclaims,1);assert.deepEqual(p.writes,['metadata','audio']);assert.equal(s.list()[0].stage,'unknown');await assert.rejects(s.upload(j.id,p,grant),/RECONCILIATION/)});
test('lost metadata readback prevents file transmission',async()=>{const {s,j,p,grant}=await setup();p.fill=async()=>{};await assert.rejects(s.upload(j.id,p,grant),/METADATA_READBACK/);assert.deepEqual(p.writes,[])});
test('existing upload or metadata is never overwritten',async()=>{const {s,j,p,grant}=await setup();p.o.uploads.audio={remoteId:'existing',sha256:base.assets.audio.sha256};await assert.rejects(s.upload(j.id,p,grant),/EXISTING_FORM/);assert.deepEqual(p.writes,[])});
test('concurrent dispatch writes at most once',async()=>{const {s,j,p,grant}=await setup();const result=await Promise.allSettled([s.upload(j.id,p,grant),s.upload(j.id,p,grant)]);assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(p.writes.filter(v=>v==='audio').length,1)});
test('restart preserves ambiguous operation; reconciliation is read-only',async()=>{const {s,j,p,repo,grant}=await setup();p.chooseFile=async(role,a)=>{p.writes.push(role);p.o.uploads[role]={remoteId:'after-timeout',sha256:a.sha256};throw Error('timeout')};await assert.rejects(s.upload(j.id,p,grant));const resumed=new FanqiePreparationService(repo,async()=>{});const count=p.writes.length;assert.equal((await resumed.reconcile(j.id,p)).stage,'unknown');assert.equal(p.writes.length,count);await assert.rejects(resumed.upload(j.id,p,grant),/RECONCILIATION/)});
test('changed previously read upload blocks the next file',async()=>{const {s,j,p,grant}=await setup();const choose=p.chooseFile;p.chooseFile=async(...a)=>{await choose(...a);if(a[0]==='lyrics')p.o.uploads.audio.remoteId='changed'};await assert.rejects(s.upload(j.id,p,grant),/UPLOAD_CHANGED/);assert.deepEqual(p.writes,['metadata','audio','lyrics'])});
test('real material bytes, probe duration/PCM/channels and decoded cover are verified',async()=>{
 const input=structuredClone(base);
 const wav=path.join(dir,'valid.wav'),cover=path.join(dir,'valid.png'),lyrics=path.join(dir,'valid.txt');
 execFileSync('C:\\ffmpeg\\ffmpeg-8.1-essentials_build\\bin\\ffmpeg.exe',['-v','error','-f','lavfi','-i','anullsrc=r=44100:cl=stereo','-t','31','-c:a','pcm_s16le',wav]);
 await sharp({create:{width:1440,height:1440,channels:3,background:'#334455'}}).png().toFile(cover);fs.writeFileSync(lyrics,'第一句\n第二句','utf8');
 for(const [r,f]of Object.entries({audio:wav,cover,lyrics})){const b=fs.readFileSync(f);input.assets[r]={file:f,bytes:b.length,sha256:h(b)}}
 await verifyFanqieMaterials(input);
 await assert.rejects(verifyFanqieMaterials({...input,ai:undefined}),/AI_DECLARATION/);
 await assert.rejects(verifyFanqieMaterials({...input,lyricsMatchConfirmed:false}),/LYRICS_MATCH/);
 await assert.rejects(verifyFanqieMaterials({...input,authors:{...input.authors,singer:''}}),/AUTHORS/);
 const bad=structuredClone(input);bad.assets.audio.sha256=h('changed');await assert.rejects(verifyFanqieMaterials(bad),/ASSET_CHANGED/);
 const small=path.join(dir,'small.png');await sharp({create:{width:1439,height:1439,channels:3,background:'#000000'}}).png().toFile(small);const b=fs.readFileSync(small);bad.assets.cover={file:small,bytes:b.length,sha256:h(b)};bad.assets.audio=input.assets.audio;await assert.rejects(verifyFanqieMaterials(bad),/COVER_DIMENSIONS/);
});
test('journal survives real sqlite close/reopen without replay',async()=>{const root=path.join(dir,'journal');fs.mkdirSync(root);const repo=new Repository(path.join(root,'library.sqlite'));const s=new FanqiePreparationService(repo,async()=>{}),j=await s.prepare(base);repo.close();const reopened=new Repository(path.join(root,'library.sqlite'));try{const next=new FanqiePreparationService(reopened,async()=>{});assert.equal(next.list()[0].id,j.id);assert.equal(next.list()[0].stage,'prepared')}finally{reopened.close()}});
test('visible form capability never infers stable identity or album support',async()=>{
 const snapshot=['上传歌曲信息','授权签约模式','预览合同协议','音乐类型','完整歌曲','歌词','作品名称','词作者','曲作者','歌手','歌曲封面','是否为AI作品','- generic: "歌曲1:"',...Array(3).fill('- textbox "搜索或选择艺人"')].join('\n');
 const page={url:async()=> 'https://www.novelfm.com/creator/music/upload',playwright:{domSnapshot:async()=>snapshot}};
 const c=await probeFanqieForm(page);assert.equal(c.firstStepObserved,true);assert.equal(c.identityVerified,false);assert.equal(c.uploadAvailable,false);assert.equal(c.albumVerified,false);
 page.playwright.domSnapshot=async()=>snapshot+'\n- generic: "歌曲2:"';assert.equal((await probeFanqieForm(page)).firstStepObserved,false);
 page.url=async()=> 'https://example.com';await assert.rejects(probeFanqieForm(page),/ORIGIN_CHANGED/);
});
test('chooser event starts before click; scope and bytes are checked before transmission',async()=>{
 const file=path.join(dir,'chooser.txt');fs.writeFileSync(file,'fixture');const asset={file,bytes:7,sha256:h('fixture')},events=[];
 const page={playwright:{waitForEvent:(name)=>{events.push(name);return Promise.resolve({isMultiple:()=>false,setFiles:async files=>{events.push('files');assert.deepEqual(files,[file])}})}}};
 const control={count:async()=>1,isVisible:async()=>true,click:async()=>{events.push('click')}};
 await chooseFanqieFile(page,control,asset,async()=>{events.push('scope')});assert.deepEqual(events,['scope','filechooser','click','scope','files']);
 events.length=0;control.click=async()=>fs.writeFileSync(file,'changed');await assert.rejects(chooseFanqieFile(page,control,asset,async()=>{}),/ASSET_CHANGED/);assert.ok(!events.includes('files'));
});
test('ambiguous upload controls and unowned artist regions fail closed',async()=>{
 const file=path.join(dir,'control.txt');fs.writeFileSync(file,'fixture');let clicked=false;
 await assert.rejects(chooseFanqieFile({playwright:{waitForEvent:()=>{throw Error('must not call')}}},{count:async()=>2,isVisible:async()=>true,click:async()=>{clicked=true}},{file,bytes:7,sha256:h('fixture')},async()=>{}),/CONTROL_UNVERIFIED/);assert.equal(clicked,false);
 await assert.rejects(fanqieAuthorControl({count:async()=>1},{count:async()=>1,getByRole:()=>{throw Error('must not call')}},async()=>false),/AUTHOR_REGION_UNVERIFIED/);
});
test('production queue cannot claim or promote an unsupported fanqie task',()=>{
 const id='80c96f21-623b-4c57-9b58-1c72c560661d',repo=memory();
 repo.save('settings',{id:'unified-publication:v1:'+id,value:{id,targets:['fanqie'],state:'blocked',revision:1,reason:'FANQIE_BROWSER_RUNTIME_UNAVAILABLE'}});
 const queue=new UnifiedPublicationService(repo,{verify:()=>{throw Error('must not dispatch')}});
 assert.throws(()=>queue.claim({id,expectedRevision:1}),/FANQIE_BROWSER_RUNTIME_UNAVAILABLE/);
 assert.throws(()=>queue.update({id,expectedRevision:1,patch:{state:'queued'}}),/FANQIE_BROWSER_RUNTIME_UNAVAILABLE/);
});
test('restart during active write cannot overwrite recovered unknown state',async()=>{
 const {s,j,p,repo,grant}=await setup();let release,entered;
 const wait=new Promise(r=>release=r),ready=new Promise(r=>entered=r);
 p.fill=async()=>{entered();await wait};
 const pending=s.upload(j.id,p,grant);await ready;
 const recovered=new FanqiePreparationService(repo,async()=>{});assert.equal(recovered.list()[0].stage,'unknown');
 release();await assert.rejects(pending,/REVISION_CONFLICT/);assert.equal(recovered.list()[0].stage,'unknown');assert.deepEqual(p.writes,[]);
});
test('decoded audio boundary failures cannot pass local preparation',async()=>{
 const input=structuredClone(base),cover=path.join(dir,'bounds.png'),lyrics=path.join(dir,'bounds.txt');
 await sharp({create:{width:1440,height:1440,channels:3,background:'#111111'}}).png().toFile(cover);fs.writeFileSync(lyrics,'测试歌词');
 const bind=(role,file)=>{const b=fs.readFileSync(file);input.assets[role]={file,bytes:b.length,sha256:h(b)}};bind('cover',cover);bind('lyrics',lyrics);
 for(const [name,rate,layout,seconds,codec,reason] of [
  ['short',44100,'stereo',30,'pcm_s16le','AUDIO_PROPERTIES'],
  ['mono',44100,'mono',31,'pcm_s16le','AUDIO_PROPERTIES'],
  ['rate',22050,'stereo',31,'pcm_s16le','AUDIO_PROPERTIES'],
  ['depth',44100,'stereo',31,'pcm_u8','AUDIO_BIT_DEPTH'],
 ]){const file=path.join(dir,name+'.wav');execFileSync('C:\\ffmpeg\\ffmpeg-8.1-essentials_build\\bin\\ffmpeg.exe',['-v','error','-f','lavfi','-i',`anullsrc=r=${rate}:cl=${layout}`,'-t',String(seconds),'-c:a',codec,file]);bind('audio',file);await assert.rejects(verifyFanqieMaterials(input),new RegExp(reason))}
});
test('metadata changed during final upload cannot reach contract boundary',async()=>{
 const {s,j,p,grant}=await setup(),choose=p.chooseFile;
 p.chooseFile=async(...args)=>{await choose(...args);if(args[0]==='cover')p.o.metadataFingerprint='changed'};
 await assert.rejects(s.upload(j.id,p,grant),/METADATA_CHANGED/);assert.equal(s.list()[0].stage,'unknown');
});
test('fixture journal cannot be reconciled into production evidence',async()=>{
 const {s,j,p,grant}=await setup();await s.upload(j.id,p,grant);p.source='browser';
 await assert.rejects(s.reconcile(j.id,p),/FIXTURE_CANNOT_AUTHORIZE_PRODUCTION/);
 assert.equal(s.list()[0].source,'offline-fixture');
});
