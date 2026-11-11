// All transports and IDs here are synthetic; no browser is launched.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createHash}=require('node:crypto');
const {FanqieUploadBroker,loadFanqieBundle,nativeFanqiePage}=require(path.join(path.dirname(process.env.RAINFALL_FANQIE_BUNDLE),'upload.cjs'));
const h=x=>createHash('sha256').update(x).digest('hex');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rainfall-fanqie-upload-'));
const catalogUrl='https://www.novelfm.com/creator/music/finished/ugc';
function uploadFixture() {
 const root=fs.mkdtempSync(path.join(dir,'upload-')),manifest=path.join(root,'bundle.json');
 const raw={version:1,title:'合成测试作品',authors:{lyricist:'测试艺人',composer:'测试艺人',singer:'测试艺人'},ai:true,musicType:'original',files:{audio:'audio.wav',lyrics:'lyrics.txt',cover:'cover.jpg'}};
 for(const file of Object.values(raw.files))fs.writeFileSync(path.join(root,file),'synthetic file');fs.writeFileSync(manifest,JSON.stringify(raw));
 let generation=1,call=0;const marks=[],current={accountId:'12345678',report:{accountKey:h('test-account')},artists:[{name:'测试艺人',artistId:'123456789'}],catalog:{source:'browser',url:catalogUrl,observedAt:new Date().toISOString(),total:0,complete:true,rows:[]}};
 const options={root,pickBundle:async()=>manifest,available:()=>true,generation:()=>generation,verify:async()=>{},
  session:{run:async action=>action({},()=>{}),mark:step=>marks.push(step),inspect:async()=>structuredClone(current)},
  execute:async(_context,input,callbacks)=>{call++;await callbacks.intent('upload:audio');const saved=JSON.parse(fs.readFileSync(path.join(root,'production/fanqie/uploads',fs.readdirSync(path.join(root,'production/fanqie/uploads'))[0]),'utf8'));assert.equal(saved.pending,'upload:audio');current.catalog={...current.catalog,total:1,rows:[{id:'9876543210987654321',title:input.title,stage:'contract_pending',officialStatus:'待授权',createdAtText:'fixture',publishedAtText:'-'}]};return{authorizationPageObserved:true,officialRecordVerified:false}}};
 return{root,manifest,raw,current,marks,options,calls:()=>call,changeGeneration:()=>generation++};
}
async function readyUpload(f){const broker=new FanqieUploadBroker(f.options);await broker.ui('pick');await broker.ui('prepare',{rightsConfirmed:true,lyricsMatchConfirmed:true});return broker;}

test('saved publication defaults survive restart and require explicit standing consent',async()=>{
 const f=uploadFixture(),broker=new FanqieUploadBroker(f.options),config={version:1,authors:f.raw.authors,useWorkMaterials:true,publicationConsent:true};
 await assert.rejects(broker.ui('saveConfiguration',{...config,publicationConsent:false}));
 assert.equal((await broker.ui('configuration')).configuration,null);
 await broker.ui('saveConfiguration',config);
 const restarted=new FanqieUploadBroker(f.options);assert.deepEqual((await restarted.ui('configuration')).configuration,config);
 f.options.work=async()=>({ai:'unknown'});await assert.rejects(restarted.ui('publishConfigured',{workId:'00000000-0000-4000-8000-000000000003',variant:'B'}),/FANQIE_AI_DISCLOSURE_REQUIRED/);assert.equal(f.calls(),0);
});
test('bundle files must be explicit local basenames and public preview exposes no paths',async()=>{
 const f=uploadFixture(),broker=new FanqieUploadBroker(f.options);const picked=await broker.ui('pick');assert.equal(picked.bundle.files.audio.name,'audio.wav');assert(!JSON.stringify(picked).includes(f.root));
 f.raw.files.audio='../secret.txt';fs.writeFileSync(f.manifest,JSON.stringify(f.raw));assert.throws(()=>loadFanqieBundle(f.manifest));
});
test('native upload broker only promotes a fresh official ID after durable intent',async()=>{
 const f=uploadFixture(),broker=await readyUpload(f),ready=broker.status();assert.equal(ready.ready,true);
 const done=await broker.ui('upload',{token:ready.token,consent:true});assert.equal(f.calls(),1);assert.equal(done.jobs[0].phase,'contract_pending');assert.equal(done.jobs[0].officialRecord.id,'9876543210987654321');
 assert(!JSON.stringify(done).includes('accountId'));await assert.rejects(broker.ui('upload',{token:ready.token,consent:true}),/AUTHORIZATION_REQUIRED/);
});
test('fresh duplicate and incomplete catalog block production writes even after preparation',async()=>{
 for(const kind of ['duplicate','incomplete']){
  const f=uploadFixture(),broker=await readyUpload(f),ready=broker.status();
  if(kind==='duplicate')f.current.catalog={...f.current.catalog,total:1,rows:[{id:'1234567890123456',title:f.raw.title,stage:'contract_pending',officialStatus:'待授权'}]};
  else f.current.catalog={...f.current.catalog,total:2,complete:false};
  const result=await broker.ui('upload',{token:ready.token,consent:true});assert.equal(f.calls(),0);assert.equal(result.result.allowed,false);assert.equal(result.jobs.length,0);
 }
});
test('upload rejects changed account, artist, generation and file verification before browser writes',async()=>{
 for(const kind of ['account','artist','generation','file']){
  const f=uploadFixture(),broker=await readyUpload(f),ready=broker.status();
  if(kind==='account')f.current.accountId='88888888';if(kind==='artist')f.current.artists[0].artistId='88888888';if(kind==='generation')f.changeGeneration();if(kind==='file')f.options.verify=async()=>{throw Error('FANQIE_ASSET_CHANGED')};
  await assert.rejects(broker.ui('upload',{token:ready.token,consent:true}));assert.equal(f.calls(),0);assert.equal(broker.status().jobs.length,0);
 }
});
test('ambiguous write stays unknown after restart and cannot be prepared again',async()=>{
 const f=uploadFixture();f.options.execute=async(_context,_input,callbacks)=>{await callbacks.intent('upload:audio');throw Error('FANQIE_UPLOAD_READBACK_TIMEOUT')};
 const broker=await readyUpload(f),ready=broker.status();await assert.rejects(broker.ui('upload',{token:ready.token,consent:true}),/TIMEOUT/);
 assert.equal(broker.status().jobs[0].phase,'unknown');const restarted=new FanqieUploadBroker(f.options);await restarted.ui('pick');await assert.rejects(restarted.ui('prepare',{rightsConfirmed:true,lyricsMatchConfirmed:true}),/RECONCILIATION_REQUIRED/);
});
test('authorization page alone or pre-existing ID never becomes a saved production receipt',async()=>{
 for(const kind of ['absent','reviewing','duplicate-new']){
  const f=uploadFixture();f.options.execute=async(_context,input,callbacks)=>{await callbacks.intent('first-step:confirm-upload');
   if(kind!=='absent'){const row={id:'9876543210987654321',title:input.title,stage:kind==='reviewing'?'reviewing':'contract_pending',officialStatus:'fixture'};f.current.catalog={...f.current.catalog,total:kind==='duplicate-new'?2:1,rows:kind==='duplicate-new'?[row,{...row,id:'9876543210987654322'}]:[row]};}
   return{authorizationPageObserved:true,officialRecordVerified:false};};
  const broker=await readyUpload(f),ready=broker.status();await assert.rejects(broker.ui('upload',{token:ready.token,consent:true}),/SAVED_WORK_READBACK_REQUIRED/);assert.equal(broker.status().jobs[0].phase,'unknown');
 }
});
test('native adapter translates timeoutMs and unwraps scoped locators',async()=>{
 let waits=[],filters=[];const locator={waitFor:async o=>waits.push(o),filter:o=>{filters.push(o);return locator},getByRole:()=>locator};
 const page=nativeFanqiePage({url:()=>catalogUrl+'/uploadProduct',locator:()=>locator,getByRole:()=>locator,getByText:()=>locator,waitForEvent:async(_event,o)=>{waits.push(o);return{}}});
 const bound=page.playwright.locator('test');await bound.waitFor({state:'visible',timeoutMs:125});bound.filter({has:bound});await page.playwright.waitForEvent('filechooser',{timeoutMs:15000});
 assert.deepEqual(waits,[{state:'visible',timeout:125},{timeout:15000}]);assert.equal(filters[0].has,locator);
});

test('material selection remains locked until asynchronous preparation finishes',async()=>{
 const f=uploadFixture(),broker=new FanqieUploadBroker(f.options);await broker.ui('pick');
 let release;const paused=new Promise(resolve=>{release=resolve});const inspect=f.options.session.inspect;
 f.options.session.inspect=async()=>{await paused;return inspect();};
 const pending=broker.ui('prepare',{rightsConfirmed:true,lyricsMatchConfirmed:true});
 try{
  assert.equal(broker.status().busy,true);
  await assert.rejects(broker.ui('pick'),/FANQIE_BROWSER_BUSY/);
 }finally{release();await pending;}
 assert.equal(broker.status().busy,false);
});

test('current library selection freezes source materials and refuses changes before upload',async()=>{
 const f=uploadFixture();let fingerprint='source-one';
 f.options.work=async selection=>({...selection,title:f.raw.title,fingerprint,lyrics:'合成歌词',ai:'generated',audio:{},cover:{}});
 f.options.materials=async()=>loadFanqieBundle(f.manifest).assets;
 const broker=new FanqieUploadBroker(f.options);
 await broker.ui('selectWork',{workId:'00000000-0000-4000-8000-000000000003',variant:'A',authors:f.raw.authors,ai:true,createPublicationCopies:true});
 const ready=await broker.ui('prepare',{rightsConfirmed:true,lyricsMatchConfirmed:true});fingerprint='source-two';
 await assert.rejects(broker.ui('upload',{token:ready.token,consent:true}),/FANQIE_WORK_CHANGED/);
 assert.equal(f.calls(),0);assert.equal(broker.status().jobs.length,0);
});

test('read-only reconciliation recovers a saved final confirmation without replaying upload',async()=>{
 const f=uploadFixture();let writes=0;
 f.options.execute=async(_context,input,callbacks)=>{writes++;await callbacks.intent('first-step:confirm-upload');f.current.catalog={...f.current.catalog,total:1,rows:[{id:'9876543210987654321',title:input.title,stage:'contract_pending',officialStatus:'待授权'}]};throw Error('FANQIE_UPLOAD_READBACK_TIMEOUT');};
 const broker=await readyUpload(f),ready=broker.status();await assert.rejects(broker.ui('upload',{token:ready.token,consent:true}));
 const restarted=new FanqieUploadBroker(f.options),job=restarted.status().jobs[0];
 const result=await restarted.ui('reconcile',{id:job.id});assert.equal(result.jobs[0].phase,'contract_pending');assert.equal(writes,1);
 f.current.catalog.rows[0].stage='reviewing';f.current.catalog.rows[0].officialStatus='审核中';
 const updated=await restarted.ui('reconcile',{id:job.id});assert.equal(updated.jobs[0].phase,'recorded');assert.equal(updated.jobs[0].officialRecord.officialStatus,'审核中');assert.equal(writes,1);
});

test('reconciliation refuses account mismatch and title-only matches before final confirmation',async()=>{
 for(const kind of ['account','early']){
  const f=uploadFixture();f.options.execute=async(_context,input,callbacks)=>{await callbacks.intent(kind==='early'?'upload:audio':'first-step:confirm-upload');f.current.catalog={...f.current.catalog,total:1,rows:[{id:'9876543210987654321',title:input.title,stage:'contract_pending',officialStatus:'待授权'}]};throw Error('FANQIE_UPLOAD_READBACK_TIMEOUT');};
  const broker=await readyUpload(f),ready=broker.status();await assert.rejects(broker.ui('upload',{token:ready.token,consent:true}));
  if(kind==='account')f.current.accountId='87654321';
  await assert.rejects(broker.ui('reconcile',{id:broker.status().jobs[0].id}));assert.equal(broker.status().jobs[0].phase,'unknown');
 }
});

test('Core resolves only the chosen work version and detects changed lyrics without writing',()=>{
 const {resolveFanqieWork}=require(process.env.RAINFALL_FANQIE_BUNDLE);
 const work={id:'00000000-0000-4000-8000-000000000003',title:'合成作品',assets:{audio_A:'a',audio_B:'b',cover:'c'},ai:'generated'};
 const assets={a:{id:'a',kind:'audio',sha256:h('A'),bytes:1},b:{id:'b',kind:'audio',sha256:h('B'),bytes:1},c:{id:'c',kind:'image',sha256:h('C'),bytes:1}};
 let lyrics='原歌词';const studio={mode:'production',get:(table,id)=>table==='works'?work:assets[id],locate:id=>({file:path.join(dir,id)}),lyricService:()=>({forWork:()=>({cleaned:lyrics})})};
 const first=resolveFanqieWork(studio,{workId:work.id,variant:'B'});assert.equal(first.audio.sha256,h('B'));assert.equal(work.assets.audio_A,'a');
 lyrics='修改歌词';assert.notEqual(resolveFanqieWork(studio,{workId:work.id,variant:'B'}).fingerprint,first.fingerprint);
 assert.throws(()=>resolveFanqieWork(studio,{workId:work.id,variant:'B',file:'untrusted'}));
 studio.mode='simulation';assert.throws(()=>resolveFanqieWork(studio,{workId:work.id,variant:'A'}),/PRODUCTION_REQUIRED/);
});

test('only pre-editor opening failures may be explicitly recovered after a fresh catalog check',async()=>{
 for(const step of ['open-release','upload:audio']){
  const f=uploadFixture();f.options.execute=async(_context,_input,callbacks)=>{await callbacks.intent(step);throw Error('FANQIE_CONTROL_AMBIGUOUS');};
  const broker=await readyUpload(f),ready=broker.status();await assert.rejects(broker.ui('upload',{token:ready.token,consent:true}));
  const id=broker.status().jobs[0].id;
  if(step==='upload:audio'){await assert.rejects(broker.ui('recoverOpening',{id}),/RECONCILIATION_REQUIRED/);assert.equal(broker.status().jobs.length,1);}
  else{await broker.ui('recoverOpening',{id});assert.equal(broker.status().jobs.length,0);assert.equal(fs.readdirSync(path.join(f.root,'production/fanqie/uploads/opening-history')).length,1);const prepared=await broker.ui('prepare',{rightsConfirmed:true,lyricsMatchConfirmed:true});assert.equal(prepared.ready,true);}
 }
});

test('authorization preferences persist without granting automatic contract signature',async()=>{
 const f=uploadFixture(),broker=new FanqieUploadBroker(f.options);
 const authorizationPreference={mode:'exclusive',platforms:['fanqie_music','fanqie_audio'],confirmContractManually:true};
 const config={version:1,authors:f.raw.authors,useWorkMaterials:true,publicationConsent:true,authorizationPreference};
 await broker.ui('saveConfiguration',config);
 const restarted=new FanqieUploadBroker(f.options);
 assert.deepEqual((await restarted.ui('configuration')).configuration.authorizationPreference,authorizationPreference);
 for(const patch of [{confirmContractManually:false},{platforms:[]},{platforms:['fanqie_music','fanqie_music']},{platforms:['unknown']}]){
  await assert.rejects(broker.ui('saveConfiguration',{...config,authorizationPreference:{...authorizationPreference,...patch}}));
 }
 assert.equal(f.calls(),0);
});

test('batch pauses on uncertain work, survives restart and resumes only unfinished items',async()=>{
 const {FanqieBatch}=require(path.join(path.dirname(process.env.RAINFALL_FANQIE_BUNDLE),'upload.cjs'));
 const root=fs.mkdtempSync(path.join(dir,'batch-')),batch=new FanqieBatch(root),items=[{workId:'one',variant:'A'},{workId:'two',variant:'B'},{workId:'three',variant:'A'}],calls=[];
 const result=await batch.run(items,'account',async item=>{calls.push(item.workId);assert.equal(batch.read().state,'running');if(item.workId==='two')throw Error('FANQIE_RECONCILIATION_REQUIRED');return {id:'saved-one'};},()=>{});
 assert.equal(result.state,'paused');assert.deepEqual(calls,['one','two']);
 const restarted=new FanqieBatch(root);await assert.rejects(restarted.run(items,'another',async()=>{},()=>{},true),/SCOPE_CHANGED/);
 calls.length=0;const finished=await restarted.run(items,'account',async i=>{calls.push(i.workId);return {reconciled:true}},()=>{},true);
 assert.equal(finished.state,'complete');assert.deepEqual(calls,['two','three']);assert.equal(finished.items[0].result.id,'saved-one');
});
test('interrupted running batch is paused without invoking any external operation',async()=>{
 const {FanqieBatch}=require(path.join(path.dirname(process.env.RAINFALL_FANQIE_BUNDLE),'upload.cjs'));
 const root=fs.mkdtempSync(path.join(dir,'interrupted-')),file=path.join(root,'production/fanqie/batch.json');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({id:'batch',accountKey:'account',state:'running',items:[{workId:'one',variant:'A',state:'running'}]}));
 const state=new FanqieBatch(root).read();assert.equal(state.state,'paused');assert.equal(state.items[0].error,'FANQIE_RECONCILIATION_REQUIRED');
});
test('authorization skips all reviewing works and rejects changed account without opening editors',async()=>{
 const {authorizeFanqieRecords}=require(path.join(path.dirname(process.env.RAINFALL_FANQIE_BUNDLE),'upload.cjs'));
 const f=uploadFixture();f.current.catalog.rows=[{id:'1234567890',title:'Already sent',stage:'reviewing',officialStatus:'审核中'}];f.current.catalog.total=1;
 const pref={mode:'exclusive',platforms:['fanqie_music','fanqie_audio'],confirmContractManually:true};
 const result=await authorizeFanqieRecords(f.root,f.options.session,f.current.report.accountKey,['1234567890'],pref,()=>{});assert.equal(result[0].phase,'already_processed');assert.equal(f.calls(),0);
 await assert.rejects(authorizeFanqieRecords(f.root,f.options.session,'other',['1234567890'],pref,()=>{}),/SCOPE_CHANGED/);
});

test('configured batch uploads two distinct works once and skips them on a repeated batch',async()=>{
 const f=uploadFixture(),ids=['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002'];
 f.options.session.status=()=>({connected:true,report:f.current.report});
 f.options.work=async selection=>({workId:selection.workId,variant:selection.variant,title:'合成作品'+selection.workId.slice(-1),ai:'generated',fingerprint:h(selection.workId)});
 f.options.materials=async(_root,source)=>{
  const result={};for(const role of ['audio','lyrics','cover']){const file=path.join(f.root,source.workId+'-'+role);const bytes=Buffer.from(source.workId+role);fs.writeFileSync(file,bytes);result[role]={file,bytes:bytes.length,sha256:h(bytes)};}return result;
 };
 let uploads=0;f.options.execute=async(_context,input,callbacks)=>{await callbacks.intent('first-step:confirm-upload');uploads++;f.current.catalog.rows.push({id:'987654321098765432'+uploads,title:input.title,stage:'contract_pending',officialStatus:'待授权',createdAtText:'fixture',publishedAtText:'-'});f.current.catalog.total=f.current.catalog.rows.length;return{authorizationPageObserved:true,officialRecordVerified:false};};
 const broker=new FanqieUploadBroker(f.options);await broker.ui('saveConfiguration',{version:1,authors:f.raw.authors,useWorkMaterials:true,publicationConsent:true});
 const request={items:ids.map(workId=>({workId,variant:'A'}))};const first=await broker.ui('publishBatch',request);assert.equal(first.batch.state,'complete',JSON.stringify(first.batch));assert.equal(uploads,2);assert.equal(first.jobs.length,2);
 const second=await broker.ui('publishBatch',request);assert.equal(second.batch.state,'complete');assert.equal(uploads,2);assert.equal(f.current.catalog.rows.length,2);
});
