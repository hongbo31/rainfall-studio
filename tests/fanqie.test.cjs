const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process'),{createHash}=require('node:crypto');
const sharp=require('sharp');
const ffmpeg = require('./fixtures/media-tool-path.cjs')('ffmpeg');
const {FanqiePreparationService,fanqieMetadataFingerprint,verifyFanqieMaterials,fanqieCapabilities,Repository,probeFanqieForm,chooseFanqieFile,fanqieAuthorControl,UnifiedPublicationService}=require(process.env.RAINFALL_FANQIE_BUNDLE);
const {parseFanqieCatalog,checkFanqieNewUpload,readFanqieCatalog}=require(process.env.RAINFALL_FANQIE_BUNDLE);
const {parseFanqieArtists,readFanqieAccountUid,fanqieFileControl,fanqieCreditControl}=require(process.env.RAINFALL_FANQIE_BUNDLE);
const {assertFanqieFirstStepReadback,confirmFanqieFirstStep,selectFanqieCredit}=require(process.env.RAINFALL_FANQIE_BUNDLE);
const {FanqieCatalogSession,FanqieAccountSessions,defaultFanqieAccountId}=require(path.join(path.dirname(process.env.RAINFALL_FANQIE_BUNDLE),'session.cjs'));
const h=x=>createHash('sha256').update(x).digest('hex');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rainfall-fanqie-test-'));
function catalogSessionFixture() {
 const root=fs.mkdtempSync(path.join(dir,'session-'));let generation=1,available=true,uid='123456789012345',closed;
 const visits=[],editor={url:()=>catalogUrl+'/uploadProduct',isClosed:()=>false,bringToFront:async()=>{}};
 const probes=[];
 const context={
  setDefaultTimeout:n=>assert.equal(n,15000),
  setDefaultNavigationTimeout:n=>assert.equal(n,20000),
  pages:()=>[editor,...probes.filter(page=>!page.closed)],
  on:(event,fn)=>{assert.equal(event,'close');closed=fn},
  newCDPSession:async page=>({
   send:async()=>({targetInfo:{targetId:page.targetId,browserContextId:'fixture'}}),
   detach:async()=>{},
  }),
  browser:()=>({newBrowserCDPSession:async()=>({
   send:async(method,params)=>{
    assert.equal(method,'Target.createTarget');
    assert.deepEqual(params,{url:'about:blank',background:true,browserContextId:'fixture'});
    const targetId='probe-'+probes.length;
    let currentUrl='about:blank';
    const page={targetId,url:()=>currentUrl,isClosed:()=>!!page.closed,setDefaultTimeout:()=>{},
      goto:async url=>{currentUrl=url;visits.push(url);},close:async()=>{page.closed=true},accountUid:()=>uid};
    probes.push(page);return {targetId};
   },
   detach:async()=>{},
  })}),
 };
 editor.context=()=>context;
 const frames=new Map();
 editor.locator=selector=>selector==='body'?{evaluate:async(_create,{id})=>{
  let url='about:blank',detached=false;
  frames.set('iframe#'+id,{url:()=>url,goto:async target=>{url=target;visits.push(target);},
   isDetached:()=>detached,detach:()=>{detached=true;}});
  return true;
 }}:{
  elementHandle:async()=>({contentFrame:async()=>frames.get(selector),dispose:async()=>{}}),
  evaluateAll:async()=>{frames.get(selector)?.detach();frames.delete(selector);},
 };
 const catalog={source:'browser',url:catalogUrl,observedAt:new Date().toISOString(),total:1,complete:true,rows:[{id:'1234567890123456789',title:'已有作品',stage:'contract_pending',officialStatus:'待授权',createdAtText:'测试时间',publishedAtText:'-'}]};
 const options={root,available:()=>available,generation:()=>generation,launch:async()=>context,account:async()=>({accountId:uid}),catalog:async()=>structuredClone(catalog)};
 return{root,options,visits,probes,frames,editor,catalog,context,setUid:value=>{uid=value},changeGeneration:()=>{generation++},setAvailable:value=>{available=value},close:()=>closed()};
}
test('application catalog bridge persists only account-scoped public rows and preserves editor',async()=>{
 const f=catalogSessionFixture(),session=new FanqieCatalogSession(f.options);
 await session.ui('open');const result=await session.ui('read');
 assert.equal(result.busy,false);assert.equal(result.uploadAvailable,false);assert.equal(result.report.maskedAccount,'***2345');
 assert.equal(result.report.accountKey.length,64);assert.equal(result.report.rows[0].id,'1234567890123456789');
 assert.deepEqual(f.visits,['https://www.novelfm.com/creator/music/account/profile',catalogUrl,'https://www.novelfm.com/creator/music/account/profile']);
 assert.equal(f.probes.length,1);assert.equal(f.probes[0].closed,true);assert.equal(f.editor.url(),catalogUrl+'/uploadProduct');
 const saved=fs.readFileSync(path.join(f.root,'production/fanqie/catalog.json'),'utf8');assert(!saved.includes('123456789012345"'));assert.deepEqual(JSON.parse(saved),result.report);
});
test('application catalog bridge refuses account switch without storing a report',async()=>{
 const f=catalogSessionFixture();f.options.catalog=async()=>{f.setUid('987654321000001');return f.catalog};
 const session=new FanqieCatalogSession(f.options);await session.ui('open');await assert.rejects(session.ui('read'),/SCOPE_CHANGED/);
 assert.equal(session.status().report,null);assert.equal(f.probes[0].closed,true);assert(!fs.existsSync(path.join(f.root,'production/fanqie/catalog.json')));
});
test('application catalog bridge rejects workspace switch, synthetic source and malformed UID',async()=>{
 for(const failure of ['workspace','source','uid']){
  const f=catalogSessionFixture();f.options.catalog=async()=>{if(failure==='workspace')f.changeGeneration();if(failure==='uid')f.setUid('invalid');return{...f.catalog,source:failure==='source'?'fixture':'browser'}};
  const session=new FanqieCatalogSession(f.options);await session.ui('open');await assert.rejects(session.ui('read'),/WORKSPACE_CHANGED|SOURCE_REQUIRED|SCOPE_CHANGED/);assert.equal(session.status().report,null);assert.equal(f.probes[0].closed,true);
 }
});
test('catalog bridge serializes reads and requires explicit connection in production',async()=>{
 const f=catalogSessionFixture(),session=new FanqieCatalogSession(f.options);
 await assert.rejects(session.ui('read'),/CONNECTION_REQUIRED/);f.setAvailable(false);await assert.rejects(session.ui('open'),/PRODUCTION_REQUIRED/);f.setAvailable(true);
 let resolve;const pending=new Promise(r=>{resolve=r});f.options.catalog=async()=>{await pending;return f.catalog};
 await session.ui('open');const read=session.ui('read');await assert.rejects(session.ui('read'),/BUSY/);resolve();await read;
 f.close();assert.equal(session.status().connected,false);await assert.rejects(session.ui('read'),/CONNECTION_REQUIRED/);
});
const base={workId:'test-only-work',scope:{accountId:'official-id',artistId:'official-artist',sessionId:'session'},title:'测试作品',ai:true,musicType:'original',rightsConfirmed:true,authors:{lyricist:'词作者',composer:'曲作者',singer:'歌手'},lyricsMatchConfirmed:true,assets:Object.fromEntries(['audio','lyrics','cover'].map(r=>[r,{file:path.join(dir,r),sha256:h(r),bytes:3}]))};
function memory(){const rows=new Map();return{all:()=>[...rows.values()].map(v=>structuredClone(v)),get:(_t,k)=>{if(!rows.has(k))throw Error('NOT_FOUND');return structuredClone(rows.get(k))},maybe:(_t,k)=>rows.has(k)?structuredClone(rows.get(k)):undefined,save:(_t,v)=>rows.set(v.id,structuredClone(v)),transaction:f=>f()};}
function port(input=base){
 const o={origin:'https://www.novelfm.com',scope:{...input.scope},source:'fixture',formVerified:true,songCount:1,songKey:'observed-card-1',metadataFingerprint:null,uploads:{}};
 const p={source:'fixture',o,writes:[],reclaims:0,readCatalog:async()=>({source:'fixture',scope:{...input.scope},url:'https://www.novelfm.com/creator/music/finished/ugc',observedAt:new Date().toISOString(),total:0,complete:true,rows:[]}),observe:async()=>structuredClone(o),reclaim:async()=>{p.reclaims++},fill:async i=>{p.writes.push('metadata');o.metadataFingerprint=fanqieMetadataFingerprint(i)},chooseFile:async(role,a,key)=>{assert.equal(key,o.songKey);p.writes.push(role);o.uploads[role]={sha256:a.sha256,remoteId:'fixture-'+role}}};return p;
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
 execFileSync(ffmpeg,['-v','error','-f','lavfi','-i','anullsrc=r=44100:cl=stereo','-t','31','-c:a','pcm_s16le',wav]);
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
 ]){const file=path.join(dir,name+'.wav');execFileSync(ffmpeg,['-v','error','-f','lavfi','-i',`anullsrc=r=${rate}:cl=${layout}`,'-t',String(seconds),'-c:a',codec,file]);bind('audio',file);await assert.rejects(verifyFanqieMaterials(input),new RegExp(reason))}
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

test('real MP3 is accepted without PCM bit depth; channel and rate limits still apply',async()=>{
 const input=structuredClone(base),cover=path.join(dir,'mp3-cover.png'),lyrics=path.join(dir,'mp3-lyrics.txt');
 await sharp({create:{width:1440,height:1440,channels:3,background:'#223344'}}).png().toFile(cover);
 fs.writeFileSync(lyrics,'仅供离线验证的测试歌词');
 const bind=(role,file)=>{const bytes=fs.readFileSync(file);input.assets[role]={file,bytes:bytes.length,sha256:h(bytes)}};
 bind('cover',cover);bind('lyrics',lyrics);
 for(const [name,rate,channels,valid] of [['stereo',44100,2,true],['mono',44100,1,false],['low-rate',22050,2,false]]){
  const file=path.join(dir,'actual-'+name+'.mp3');
  execFileSync(ffmpeg,['-v','error','-f','lavfi','-i','sine=frequency=440:sample_rate='+rate,'-t','31','-ac',String(channels),'-c:a','libmp3lame','-b:a','128k',file],{windowsHide:true});
  bind('audio',file);
  if(valid)await verifyFanqieMaterials(input);
  else await assert.rejects(verifyFanqieMaterials(input),/AUDIO_PROPERTIES/);
 }
});

const catalogUrl='https://www.novelfm.com/creator/music/finished/ugc';
const catalogRaw=(status='待授权')=>({selectedTab:'全部·1',query:'',headers:['作品信息','作品状态','创建时间','上架时间','操作'],rows:[['测试作品\n作品ID：9000000000000000001',status,'2026-10-21 23:42','-','']]});
const catalog=(raw=catalogRaw())=>({source:'fixture',url:catalogUrl,observedAt:new Date().toISOString(),...parseFanqieCatalog(raw)});
test('visible catalog retains the exact 64-bit ID and distinguishes pending authorization from submission',()=>{
 for(const [text,stage] of [['待授权','contract_pending'],['审核中','reviewing'],['已上架','published'],['未通过','rejected'],['已下架','withdrawn']]){
  const c=catalog(catalogRaw(text));assert.equal(c.rows[0].id,'9000000000000000001');assert.equal(c.rows[0].stage,stage);assert.equal(c.complete,true);
 }
});
test('same-title records block every status without claiming equal audio hashes',()=>{
 for(const status of ['待授权','审核中','已上架','未通过','已下架']){
  const r=checkFanqieNewUpload(catalog(catalogRaw(status)),'测 试作品');assert.equal(r.allowed,false);assert.equal(r.reason,'FANQIE_OFFICIAL_RECORD_ALREADY_EXISTS');assert.equal(r.matches.length,1);assert.equal(r.matches[0].sha256,undefined);
 }
});
test('a new official status preserves the work identity for duplicate checks',()=>{
 const c=catalog(catalogRaw('处理中'));
 assert.equal(c.complete,true);
 assert.deepEqual([c.rows[0].stage,c.rows[0].officialStatus],['unknown','处理中']);
 assert.equal(checkFanqieNewUpload(c,'测试作品').reason,'FANQIE_OFFICIAL_RECORD_ALREADY_EXISTS');
 assert.equal(checkFanqieNewUpload(c,'从未发行的另一首').allowed,true);
});
test('filtered, incomplete, malformed and duplicate catalog data cannot clear the duplicate barrier',()=>{
 assert.throws(()=>catalog({...catalogRaw(),query:'测试作品'}),/FILTERED/);
 assert.throws(()=>catalog({...catalogRaw(),selectedTab:'待授权·1'}),/FILTERED/);
 assert.throws(()=>catalog({...catalogRaw(),headers:['作品信息']}),/LAYOUT_CHANGED/);
 assert.throws(()=>catalog({...catalogRaw(),rows:[['测试作品\n工单号：9000000000000000001',...catalogRaw().rows[0].slice(1)]]}),
  error=>error.message==='FANQIE_CATALOG_WORK_ID_UNVERIFIED'&&error.row===1);
 assert.throws(()=>catalog({...catalogRaw(),selectedTab:'全部·2',rows:[...catalogRaw().rows,...catalogRaw().rows]}),/DUPLICATE_ID/);
 const partial=catalog({...catalogRaw(),selectedTab:'全部·2'});assert.equal(partial.complete,false);assert.equal(checkFanqieNewUpload(partial,'另一首歌').reason,'FANQIE_CATALOG_INCOMPLETE');
 assert.equal(checkFanqieNewUpload(catalog(),'另一首歌').allowed,true);
 for(const url of ['https://example.com/creator/music/finished/ugc',catalogUrl+'/uploadProduct',catalogUrl+'?q=x'])assert.throws(()=>checkFanqieNewUpload({...catalog(),url},'另一首歌'),/PAGE_REQUIRED/);
});
test('catalog reader reads tabs, filter and rows atomically and rechecks the route',async()=>{
 let changed=false,query='';const raw=catalogRaw();let url=catalogUrl;
 const page={url:async()=>url,playwright:{getByRole:role=>{
  assert.equal(role,'tabpanel');return{evaluate:async()=>{if(changed)url=catalogUrl+'/uploadProduct';return{selectedTabs:[raw.selectedTab],queries:[query],headers:raw.headers,rows:raw.rows}}};
 }}};
 const c=await readFanqieCatalog(page);assert.equal(c.source,'browser');assert.equal(c.rows.length,1);
 query='测试作品';await assert.rejects(readFanqieCatalog(page),/FILTERED/);query='';changed=true;await assert.rejects(readFanqieCatalog(page),/PAGE_CHANGED/);
 page.url=async()=>catalogUrl+'/uploadProduct';await assert.rejects(readFanqieCatalog(page),/PAGE_REQUIRED/);
});
test('catalog reader waits for separately rendered count and rows without any site writes',async()=>{
 const raw=catalogRaw();let reads=0;
 const page={url:async()=>catalogUrl,playwright:{getByRole:()=>({evaluate:async()=>({selectedTabs:[++reads===1?'全部·0':raw.selectedTab],queries:[''],headers:raw.headers,rows:raw.rows})})}};
 const result=await readFanqieCatalog(page);assert.equal(reads,2);assert.equal(result.complete,true);assert.equal(result.rows.length,1);
});
test('a delayed status can settle before a fresh upload receipt is read',async()=>{
 let reads=0;
 const page={url:async()=>catalogUrl,playwright:{getByRole:()=>({evaluate:async()=>{
  const raw=catalogRaw(++reads===1?'':'待授权');
  return {selectedTabs:[raw.selectedTab],queries:[''],headers:raw.headers,rows:raw.rows};
 }})}};
 const result=await readFanqieCatalog(page);
 assert.equal(reads,2);
 assert.equal(result.rows[0].stage,'contract_pending');
});
test('an unreadable ID reports the affected page and row and retains no raw cell text in the error',async t=>{
 const raw=catalogRaw();
 raw.rows.push(['隐藏测试作品\n标签不符',...raw.rows[0].slice(1)]);
 const page={url:async()=>catalogUrl,playwright:{getByRole:()=>({evaluate:async()=>({
  selectedTabs:['全部·2'],queries:[''],headers:raw.headers,rows:raw.rows,
 })})}};
 const start=Date.now();
 let now=start;
 t.mock.method(Date,'now',()=>{now+=16000;return now;});
 await assert.rejects(readFanqieCatalog(page,4),{message:'FANQIE_CATALOG_WORK_ID_UNVERIFIED',page:4,row:2});
});
for(const failure of ['duplicate','incomplete','account','source'])test('catalog '+failure+' stops before metadata and file writes',async()=>{
 const {s,j,p,grant}=await setup();
 p.readCatalog=async()=>{
  const c={...catalog(),scope:{...base.scope}};
  if(failure==='incomplete'){c.total=2;c.complete=false;c.rows=[]}
  if(failure==='account')c.scope.accountId='other-account';
  if(failure==='source')c.source='browser';
  return c;
 };
 await assert.rejects(s.upload(j.id,p,grant),failure==='duplicate'?/OFFICIAL_RECORD_ALREADY_EXISTS/:failure==='incomplete'?/CATALOG_INCOMPLETE/:/CATALOG_SCOPE_CHANGED/);
 assert.deepEqual(p.writes,[]);assert.equal(s.list()[0].stage,'unknown');
});

test('artist roster keeps display names separate from exact string IDs',()=>{
 const rows=[{name:'账号艺名',text:'账号艺名\n艺人ID: 9000000000000000002'},{name:'作品署名',text:'作品署名\n艺人ID: 9000000000000000003'}];
 const artists=parseFanqieArtists(rows);assert.equal(artists[1].artistId,'9000000000000000003');assert.notEqual(artists[0].artistId,artists[1].artistId);
 assert.throws(()=>parseFanqieArtists([rows[0],rows[0]]),/ARTIST_ID_UNVERIFIED/);
 assert.throws(()=>parseFanqieArtists([{...rows[0],name:'wrong'}]),/ARTIST_ID_UNVERIFIED/);
});
test('account reader only reads the labeled visible UID and refuses navigation during read',async()=>{
 let url='https://www.novelfm.com/creator/music/account/profile',mutate=false;
 const page={url:async()=>url,playwright:{getByText:(text,options)=>{assert.equal(text,'UID');assert.equal(options.exact,true);return{evaluate:async fn=>{
  const result=fn({parentElement:{classList:{contains:c=>c==='profile-desc'},innerText:'UID\n100000000000001'}});if(mutate)url='https://www.novelfm.com/creator/music/home';return result;
 }}}}};
 assert.equal((await readFanqieAccountUid(page)).accountId,'100000000000001');mutate=true;await assert.rejects(readFanqieAccountUid(page),/ACCOUNT_ID_UNVERIFIED/);
});
test('calibrated form controls reject extra songs, changed role labels and ambiguous file targets',async()=>{
 let extra=false,label='完整歌曲',controls=1;
 const snapshot=['上传歌曲信息','授权签约模式','预览合同协议','音乐类型','完整歌曲','歌词','作品名称','词作者','曲作者','歌手','歌曲封面','是否为AI作品','- generic: "歌曲1:"',...Array(3).fill('- textbox "搜索或选择艺人"')].join('\n');
 const target={count:async()=>controls,isVisible:async()=>true};
 const region={count:async()=>1,isVisible:async()=>true,locator:()=>target,getByRole:()=>target};
 const page={url:async()=>catalogUrl+'/uploadProduct',playwright:{domSnapshot:async()=>snapshot+(extra?'\n- generic: "歌曲2:"':''),locator:selector=>selector==='.arco-form-item'?{filter:()=>region}:{count:async()=>1,evaluate:async()=>label}}};
 assert.equal(await fanqieFileControl(page,'audio'),target);
 controls=2;await assert.rejects(fanqieFileControl(page,'audio'),/CONTROL_UNVERIFIED/);controls=1;
 label='版权证明';await assert.rejects(fanqieFileControl(page,'audio'),/ROLE_REGION_CHANGED/);
 label='完整歌曲';extra=true;await assert.rejects(fanqieFileControl(page,'audio'),/FORM_UNVERIFIED/);extra=false;
 label='曲作者';assert.equal(await fanqieCreditControl(page,'composer'),target);
 label='词作者';await assert.rejects(fanqieCreditControl(page,'composer'),/ROLE_REGION_CHANGED/);
});

test('filled song titles and selected-credit placeholders do not invalidate the first step',async()=>{
 const snapshot=['上传歌曲信息','授权签约模式','预览合同协议','音乐类型','完整歌曲','歌词','作品名称','词作者','曲作者','歌手','歌曲封面','是否为AI作品','- generic: "歌曲1: 已填写的歌曲"',...Array(3).fill('- combobox:\n  - generic: 艺人\n  - textbox')].join('\n');
 const page={url:async()=>catalogUrl+'/uploadProduct',playwright:{domSnapshot:async()=>snapshot}};
 assert.equal((await probeFanqieForm(page)).firstStepObserved,true);
 page.playwright.domSnapshot=async()=>snapshot+'\n- generic: "歌曲2: 其他歌曲"';assert.equal((await probeFanqieForm(page)).firstStepObserved,false);
});
test('a multiple-capable official chooser still receives exactly one authorized file',async()=>{
 const file=path.join(dir,'single-selection.txt');fs.writeFileSync(file,'one');let sent;
 const page={playwright:{waitForEvent:async()=>({isMultiple:()=>true,setFiles:async value=>{sent=value}})}};
 await chooseFanqieFile(page,{count:async()=>1,isVisible:async()=>true,click:async()=>{}},{file,bytes:3,sha256:h('one')},async()=>{});
 assert.deepEqual(sent,[file]);
});
const expectedForm={title:'测试作品',ai:true,musicType:'original',authors:{lyricist:'测试署名',composer:'测试署名',singer:'测试署名'},audio:{displayName:'测试作品',format:'WAV',displaySize:'29.4MB'},lyrics:{fileName:'测试歌词.txt',displaySize:'1.1KB'}};
const visibleForm=()=>({title:'测试作品',songCount:1,musicType:'原创',ai:'是',authors:{lyricist:['测试署名'],composer:['测试署名'],singer:['测试署名']},audioText:'测试作品\nWAV｜上传完成｜29.4MB',lyricsText:'测试歌词.txt\n上传完成｜1.1KB',coverPreview:[{complete:true,width:1400,height:1400}]});
test('first-step readback verifies every credit and material without mistaking cropped preview dimensions for source dimensions',()=>{
 assert.doesNotThrow(()=>assertFanqieFirstStepReadback(visibleForm(),expectedForm));
 for(const mutate of [x=>{x.ai='否'},x=>{x.title='other'},x=>{x.songCount=2},x=>{x.authors.singer=[]},x=>{x.authors.composer.push('extra')},x=>{x.audioText='测试作品\nWAV｜上传中｜29.4MB'},x=>{x.lyricsText='other.txt\n上传完成｜1.1KB'},x=>{x.coverPreview[0].complete=false}]){const value=visibleForm();mutate(value);assert.throws(()=>assertFanqieFirstStepReadback(value,expectedForm),/READBACK_REQUIRED/)}
});
test('material readback accepts the displayed precision while requiring the exact file and transfer status',()=>{
 const expected={...expectedForm,lyrics:{fileName:'测试歌词.txt',displaySize:'1.2KB',bytes:1277}};
 const actual={...visibleForm(),lyricsText:'测试歌词.txt\n上传完成 ｜ 1.25 KB'};
 assert.doesNotThrow(()=>assertFanqieFirstStepReadback(actual,expected));
 assert.doesNotThrow(()=>assertFanqieFirstStepReadback({...actual,lyricsText:'测试歌词.txt\n上传完成｜1.3KB'},expected));
 const short={...expected,lyrics:{fileName:'测试歌词.txt',displaySize:'983.0B',bytes:983}};
 assert.doesNotThrow(()=>assertFanqieFirstStepReadback({...actual,lyricsText:'测试歌词.txt\n上传完成｜986.0B'},short));
 assert.throws(()=>assertFanqieFirstStepReadback({...actual,lyricsText:'测试歌词.txt\n上传完成｜987.0B'},short),/FANQIE_UPLOAD_READBACK_REQUIRED/);
 for(const lyricsText of ['测试歌词.txt\n上传完成｜1.27 KB','另一个文件.txt\n上传完成｜1.25 KB','测试歌词.txt\n上传中｜1.25 KB']){
  assert.throws(()=>assertFanqieFirstStepReadback({...actual,lyricsText},expected),/FANQIE_UPLOAD_READBACK_REQUIRED/);
 }
});
test('first-step confirmation persists two intents, sends no signing action and does not invent a work ID',async()=>{
 const events=[];let changed=false;
 const locator=(role,name)=>({count:async()=>1,evaluate:async()=>visibleForm(),waitFor:async()=>{},click:async()=>{events.push('click:'+name)},getByRole:(role,options)=>locator(role,options.name)});
 const page={url:async()=>catalogUrl+'/uploadProduct',playwright:{getByRole:(role,options)=>locator(role,options.name),getByText:(name)=>locator('text',name)}};
 const result=await confirmFanqieFirstStep(page,expectedForm,async step=>events.push('intent:'+step),async()=>{if(changed)throw Error('ACCOUNT_CHANGED')});
 assert.deepEqual(events,['intent:first-step:next','click:下一步','intent:first-step:confirm-upload','click:确认上传']);assert.equal(result.officialRecordVerified,false);assert.equal(result.officialRecordId,undefined);
 events.length=0;changed=true;await assert.rejects(confirmFanqieFirstStep(page,expectedForm,async step=>events.push(step),async()=>{throw Error('ACCOUNT_CHANGED')}),/ACCOUNT_CHANGED/);assert.deepEqual(events,[]);
});

test('credit selection requires the matching details dialog and skips an already selected credit',async()=>{
 const state=visibleForm();state.authors.lyricist=[];const writes=[];let correctDetails=false;
 const formSnapshot=['上传歌曲信息','授权签约模式','预览合同协议','音乐类型','完整歌曲','歌词','作品名称','词作者','曲作者','歌手','歌曲封面','是否为AI作品','- generic: "歌曲1: 测试作品"'].join('\n');
 const field={fill:async value=>writes.push('search:'+value)};
 const region={count:async()=>1,isVisible:async()=>true,getByRole:()=>field};
 const label={count:async()=>1,evaluate:async()=> '词作者'};
 const dialog={count:async()=>1,waitFor:async()=>{},getByText:()=>({count:async()=>correctDetails?1:0}),getByRole:()=>({click:async()=>{writes.push('confirm');state.authors.lyricist=['测试署名']}})};
 const page={url:async()=>catalogUrl+'/uploadProduct',playwright:{domSnapshot:async()=>formSnapshot,locator:selector=>selector==='.arco-form-item'?{filter:()=>region}:label,getByRole:(role)=>{
  if(role==='textbox')return{evaluate:async()=>structuredClone(state)};
  if(role==='option')return{count:async()=>1,waitFor:async()=>{},click:async()=>writes.push('preview')};
  assert.equal(role,'dialog');return dialog;
 }}};
 await assert.rejects(selectFanqieCredit(page,'lyricist','测试署名',async()=>{},async()=>{}),/AUTHOR_DETAILS_CHANGED/);assert.deepEqual(writes,['search:测试署名','preview']);
 correctDetails=true;writes.length=0;await selectFanqieCredit(page,'lyricist','测试署名',async()=>{},async()=>{});assert.deepEqual(writes,['search:测试署名','preview','confirm']);
 writes.length=0;await selectFanqieCredit(page,'lyricist','测试署名',async()=>{},async()=>{});assert.deepEqual(writes,[]);
});

test('configuration sync saves official artists across restart and clears mismatched account cache',async()=>{
 const f=catalogSessionFixture();f.options.artists=async()=>({artists:[{artistId:'12345678',name:'测试艺人'}]});
 const session=new FanqieCatalogSession(f.options);const result=await session.ui('syncProfile');
 assert.equal(result.profile.artists[0].name,'测试艺人');
 assert.deepEqual(new FanqieCatalogSession(f.options).status().profile,result.profile);
 f.setUid('987654321000001');await session.ui('read');assert.equal(session.status().profile,null);
});
test('artist sync refuses switched identity and preserves last verified snapshot',async()=>{
 const f=catalogSessionFixture();f.options.artists=async()=>({artists:[{artistId:'12345678',name:'原艺人'}]});
 const session=new FanqieCatalogSession(f.options);await session.ui('syncProfile');const original=session.status().profile;
 f.options.artists=async()=>{f.setUid('987654321000001');return{artists:[{artistId:'99999999',name:'其他艺人'}]}};
 await assert.rejects(session.ui('syncProfile'),/SCOPE_CHANGED/);assert.deepEqual(session.status().profile,original);
});

test('login indicators verify an account without another tab and recognize a sign-in redirect',async()=>{
 const f=catalogSessionFixture(),session=new FanqieCatalogSession(f.options);
 assert.equal(await session.loginState(),'unknown');
 await session.ui('open');
 assert.deepEqual(await Promise.all([session.loginState(),session.loginState()]),['valid','valid']);
 assert.equal(f.probes.length,0);
 assert.equal(f.frames.size,0);
 assert.equal(f.visits.length,1);
 assert.equal(session.status().profile,null);
 f.editor.url=()=>new URL('/creator/music/login',catalogUrl).href;
 assert.equal(await session.loginState(),'expired');
 assert.equal(f.probes.length,0);
 f.close();
 assert.equal(await session.loginState(),'unknown');
});

test('account slots keep the legacy session and independently persist two artist rosters and publication configurations',async()=>{
 const legacy=catalogSessionFixture(),second=catalogSessionFixture(),duplicate=catalogSessionFixture();
 const root=legacy.root,newId='00000000-0000-4000-8000-000000000011',duplicateId='00000000-0000-4000-8000-000000000012';
 const legacyDirectory=path.join(root,'browser-sessions','fanqie');
 const newDirectory=path.join(root,'browser-sessions','accounts',newId);
 const duplicateDirectory=path.join(root,'browser-sessions','accounts',duplicateId);
 const windows=new Map([[legacyDirectory,legacy],[newDirectory,second],[duplicateDirectory,duplicate]]);
 second.setUid('999999999998765');
 const launches=[];
 const options={...legacy.options,pickBundle:async()=>null,launch:async directory=>{
  launches.push(directory);const window=windows.get(directory);assert.ok(window);
  return {...window.context,close:async()=>window.close()};
 },account:async page=>({accountId:page.accountUid()}),artists:async page=>({
  artists:[1,2].map(i=>({artistId:'90000'+i,name:page.accountUid().slice(-4)+' 艺人 '+i})),
 }),catalog:async()=>{throw Error('Profile sync must not depend on a populated works list');}};
 const previous=new FanqieCatalogSession(options);
 const original=await previous.ui('syncProfile');
 await previous.close();
 const accounts=new FanqieAccountSessions(options),originalSlot=accounts.get(),newSlot=accounts.get(newId);
 assert.equal(accounts.get(defaultFanqieAccountId),originalSlot);
 assert.deepEqual(originalSlot.catalog.status().profile,original.profile);
 assert.equal(originalSlot.catalog.status().savedProfile,true);
 assert.equal(newSlot.catalog.status().savedProfile,false);
 assert.equal(newSlot.catalog.status().profile,null);
 const fresh=await newSlot.catalog.ui('syncProfile');
 assert.deepEqual(fresh.profile.artists.map(a=>a.name),['8765 艺人 1','8765 艺人 2']);
 assert.equal(fresh.profileVerified,true);
 assert.equal(fresh.report,null);
 await assert.rejects(accounts.get(duplicateId).catalog.ui('syncProfile'),/FANQIE_ACCOUNT_ALREADY_BOUND/);
 assert.equal(accounts.get(duplicateId).catalog.status().profile,null);
 const config=name=>({version:1,authors:{lyricist:name,composer:name,singer:name},useWorkMaterials:true,publicationConsent:true});
 await originalSlot.upload.ui('saveConfiguration',config('原艺人'));
 await newSlot.upload.ui('saveConfiguration',config('新艺人'));
 assert.deepEqual(launches,[legacyDirectory,newDirectory,duplicateDirectory]);
 await accounts.close();
 assert.equal(newSlot.catalog.status().profileVerified,false);
 const restarted=new FanqieAccountSessions(options);
 for(const [id,name] of [[defaultFanqieAccountId,'原艺人'],[newId,'新艺人']]){
  assert.equal((await restarted.get(id).upload.ui('configuration')).configuration.authors.singer,name);
 }
 assert.deepEqual(restarted.get(newId).catalog.status().profile,fresh.profile);
 second.setUid('777777777777777');
 await assert.rejects(restarted.get(newId).catalog.ui('syncProfile'),/FANQIE_ACCOUNT_IDENTITY_MISMATCH/);
 assert.deepEqual(restarted.get(newId).catalog.status().profile,fresh.profile);
 await restarted.close();
});

test('catalog reader waits for row text to finish rendering without accepting incomplete IDs',async()=>{
 const raw=catalogRaw();let reads=0;
 const page={url:async()=>catalogUrl,playwright:{getByRole:()=>({evaluate:async()=>({selectedTabs:[raw.selectedTab],queries:[''],headers:raw.headers,rows:++reads===1?raw.rows.map(r=>['',...r.slice(1)]):raw.rows})})}};
 const result=await readFanqieCatalog(page);assert.equal(reads,2);assert.equal(result.complete,true);assert.equal(result.rows[0].id,parseFanqieCatalog(raw).rows[0].id);
});
