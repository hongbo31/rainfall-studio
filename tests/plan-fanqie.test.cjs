const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto'),sharp=require('sharp');
const {createPlanFanqiePublisher,recoverPlanFanqie,planFanqieAction,planFanqieBatchSettled,YourMusicAdapter,Studio,planPuleAction,
 tickPlanCenter,planCoverImage,scanCoverInbox,recoverCoverImages,createPlanCoverImageRunner,ApiCredentials,openAiCoverModel,setDownloadDirectory}=require('../output/plan-fanqie/index.cjs');
function harness(){
 const jobs=[1,2].map(i=>({id:'item'+i,workId:'work'+i,variant:'A',accountKey:'a'.repeat(64),configurationHash:'b'.repeat(64),fingerprint:'c'.repeat(64),state:'ready'}));
 const calls=[];let writes=0,fail=false,stopped=false,epoch=1;
 const rpc=async(method,input)=>{
  calls.push(method.split('.').at(-1));
  if(method.endsWith('.list'))return{ok:true,value:jobs.map(j=>({...j}))};
  const j=jobs.find(j=>j.id===input.id);
  if(method.endsWith('.current'))return stopped?{ok:false,error:{code:'STOP_REQUESTED'}}:{ok:true,value:j};
  if(method.endsWith('.claim')){assert.equal(j.state,'ready');j.state='dispatching';return{ok:true,value:{...j}};}
  assert.equal(j.state,'dispatching');Object.assign(j,input);return{ok:true,value:j};
 };
 const upload={status:()=>({busy:false}),publishScheduled:async(input,check)=>{await check();if(fail)throw Error('FANQIE_UPLOAD_READBACK_TIMEOUT');writes++;return{result:{uploaded:true,officialRecord:{id:'900'+writes,stage:'contract_pending'}}};}};
 return{jobs,calls,rpc,upload,get writes(){return writes},get epoch(){return epoch},stop(){stopped=true},fail(){fail=true},switch(){epoch++}};
}
test('scheduled publisher drains two distinct works once and never replays receipts',async()=>{
 const h=harness(),p=createPlanFanqiePublisher({rpc:h.rpc,upload:h.upload,available:()=>true,generation:()=>h.epoch});
 await p.pump();await p.pump();assert.equal(h.writes,2);assert.deepEqual(h.jobs.map(j=>j.state),['uploaded','uploaded']);
});
test('scheduled publisher sends explicitly scoped jobs to that account and preserves the legacy default',async()=>{
 const h=harness(),accountId='00000000-0000-4000-8000-000000000013',routed=[];
 h.jobs[1].accountId=accountId;
 const other={status:()=>({busy:false}),publishScheduled:async(input,check)=>{
  await check();routed.push(input.workId);
  return {result:{uploaded:true,officialRecord:{id:'8001',stage:'contract_pending'}}};
 }};
 const p=createPlanFanqiePublisher({rpc:h.rpc,upload:h.upload,available:()=>true,generation:()=>h.epoch,
  forAccount:async id=>{assert.equal(id,accountId);return other;}});
 await p.pump();
 assert.equal(h.writes,1);
 assert.deepEqual(routed,['work2']);
 assert.deepEqual(h.jobs.map(j=>j.state),['uploaded','uploaded']);
});
test('uncertain upload pauses remaining works; restart does not dispatch unknown intent',async()=>{
 const h=harness();h.fail();const options={rpc:h.rpc,upload:h.upload,available:()=>true,generation:()=>h.epoch};
 await createPlanFanqiePublisher(options).pump();assert.deepEqual(h.jobs.map(j=>j.state),['unknown','ready']);
 await createPlanFanqiePublisher(options).pump();assert.equal(h.writes,0);assert.deepEqual(h.jobs.map(j=>j.state),['unknown','ready']);
});
test('scheduled legacy uploads cannot claim work after their local account was deleted',async()=>{
 const h=harness(),publisher=createPlanFanqiePublisher({rpc:h.rpc,upload:h.upload,available:()=>true,
  generation:()=>h.epoch,assertAccount:async()=>{throw Error('ACCOUNT_NOT_FOUND');}});
 await publisher.pump();
 assert.deepEqual(h.calls,['list']);
 assert.equal(h.writes,0);
 assert.deepEqual(h.jobs.map(job=>job.state),['ready','ready']);
});
test('stop check is executed before browser writes',async()=>{
 const h=harness();h.stop();await createPlanFanqiePublisher({rpc:h.rpc,upload:h.upload,available:()=>true,generation:()=>h.epoch}).pump();
 assert.equal(h.writes,0);assert.equal(h.jobs[0].reason,'STOP_REQUESTED');
});
test('manual publisher lock prevents scheduled claims for the same account',async()=>{
 const h=harness();h.upload.status=()=>({busy:true});await createPlanFanqiePublisher({rpc:h.rpc,upload:h.upload,available:()=>true,generation:()=>h.epoch}).pump();
 assert(!h.calls.includes('claim'));assert.equal(h.writes,0);
});
test('concurrent timer ticks share a single publisher and do not double claim',async()=>{
 const h=harness(),p=createPlanFanqiePublisher({rpc:h.rpc,upload:h.upload,available:()=>true,generation:()=>h.epoch});
 await Promise.all([p.pump(),p.pump()]);assert.equal(h.writes,2);
});
test('the plan publisher verifies pending contract generation by the original work and account',async()=>{
 const accountId=randomUUID(),accountKey='a'.repeat(64);
 const record={id:'90001',title:'夜雨',stage:'contract_pending',officialStatus:'待授权',createdAtText:'',publishedAtText:''};
 const job={accountId,accountKey,record,state:'uploaded',authorization:'awaiting_signature',continueAfterContract:true};
 const generated={...record,contract:{state:'awaiting_signature',id:'80001'}};
 const observed=[];
 const publisher=createPlanFanqiePublisher({
  available:()=>true,generation:()=>1,upload:{status:()=>({busy:false}),publishScheduled:()=>assert.fail('replayed upload')},
  rpc:async(method,input)=>{
   if(method.endsWith('.list'))return {ok:true,value:[job]};
   assert.equal(method,'internal.planFanqie.observeAuthorization');
   observed.push(input);
   return {ok:true};
  },
  readAuthorization:async(id,queries)=>{
   assert.equal(id,accountId);
   assert.deepEqual(queries,[{id:record.id,title:record.title}]);
   return {source:'browser',complete:true,accountKey,rows:[{...generated,id:'90002'},generated]};
  },
 });
 await publisher.pump();
 assert.deepEqual(observed,[{accountId,accountKey,records:[generated]}]);
});
test('a complete unsigned batch needs the same generated contract for each pending song',()=>{
 const receipt=(id,contractId)=>({batchSize:2,state:'uploaded',record:{
  id,stage:'contract_pending',contract:{state:'awaiting_signature',id:contractId},
 }});
 const first=receipt('90001','80001'),other=receipt('90002','80002'),matching=receipt('90002','80001');
 assert.equal(planFanqieBatchSettled([first],true),false);
 assert.equal(planFanqieBatchSettled([first,other],true),false);
 assert.equal(planFanqieBatchSettled([first,matching],false),false);
 assert.equal(planFanqieBatchSettled([first,matching],true),true);
});
test('a ten-song occurrence waits for all materials and prepares exactly one scoped contract',async()=>{
 const accountId='00000000-0000-4000-8000-000000000013',runId='scheduled-run';
 const accountKey='a'.repeat(64),configurationHash='b'.repeat(64),fingerprint='c'.repeat(64);
 const jobs=Array.from({length:10},(_,i)=>({
  ordinal:i+1,workId:'work'+(i+1),variant:'A',fingerprint,batchSize:10,runId,accountId,accountKey,configurationHash,state:'ready',
 }));
 const selection=jobs.map(({workId,variant,fingerprint})=>({workId,variant,fingerprint}));
 let prepared=9,claims=0,contracts=0;
 const rpc=async(method,input)=>{
  switch(method.split('.').at(-1)){
   case 'list':return {ok:true,value:jobs.slice(0,prepared)};
   case 'claimBatch':
    assert.deepEqual(input,{runId});
    claims++;
    for(const job of jobs)job.state='dispatching';
    return {ok:true,value:{accountKey,configurationHash,items:selection}};
   case 'currentBatch':
    assert.equal(input.runId,runId);
    assert.ok(selection.some(work=>work.workId===input.workId));
    return {ok:true};
   case 'recordBatch':
    assert.equal(input.runId,runId);
    assert.equal(input.reason,undefined);
    assert.equal(input.receipts.length,10);
    assert.ok(input.receipts.every(receipt=>receipt.authorization==='awaiting_signature'));
    assert.equal(new Set(input.receipts.map(receipt=>receipt.record.id)).size,10);
    for(const job of jobs)job.state='uploaded';
    return {ok:true};
   default:assert.fail('Individual submission cannot consume a batch job');
  }
 };
 const upload={status:()=>({busy:false}),publishScheduled:()=>assert.fail('Individual upload dispatched')};
 const publisher=createPlanFanqiePublisher({rpc,upload,available:()=>true,generation:()=>1,
  forAccount:async id=>{
   assert.equal(id,accountId);
   return {...upload,publishScheduledBatch:async(input,check)=>{
    assert.deepEqual(input,{runId,accountKey,configurationHash,items:selection});
    contracts++;
    for(const work of input.items)await check(work.workId);
    const records=jobs.map(job=>({id:String(9000+job.ordinal),stage:'contract_pending'}));
    return {batch:{state:'complete',items:jobs.map((job,index)=>({
     workId:job.workId,result:{result:{officialRecord:records[index]}},
    })),authorization:records.map(record=>({id:record.id,phase:'awaiting_signature'}))}};
   }};
  },
 });
 await publisher.pump();
 assert.equal(claims,0);
 prepared=10;
 await Promise.all([publisher.pump(),publisher.pump()]);
 await publisher.pump();
 assert.equal(claims,1);
 assert.equal(contracts,1);
});
test('Core restart preserves uncertain intent rather than returning it to ready',()=>{
 const rows=[{id:'plan-fanqie:one',value:{id:'one',state:'dispatching'}},{id:'plan-fanqie:two',value:{id:'two',state:'uploaded'}}];
 const s={repo:{settingsByPrefix:prefix=>rows.filter(row=>row.id.startsWith(prefix))},save:(_,row)=>{rows[rows.findIndex(x=>x.id===row.id)]=row;}};
 recoverPlanFanqie(s);assert.equal(rows[0].value.state,'unknown');assert.equal(rows[1].value.state,'uploaded');
});
test('Core rejects fabricated completion without official work ID',()=>{
 const s={mode:'production',repo:{get:()=>({value:{state:'dispatching'}})}};
 assert.throws(()=>planFanqieAction(s,'record',{id:'one',state:'uploaded',record:{stage:'contract_pending'}}),/FANQIE_SAVED_WORK_READBACK_REQUIRED/);
});
test('prompt submissions accept a verified 2xx receipt and preserve uncertain outputs without replay',async()=>{
 let requests=0,scoped=0;
 const receipt={task_id:'receipt',status:'pending',songs:[{id:'song-a'},{id:'song-b'}]};
 const adapter=new YourMusicAdapter({source:'fixture',credential:async()=>'fixture',request:async input=>{
  assert.equal(new URL(input.url).pathname,'/v1/suno/generate/prompt');
  await input.assertDispatch();
  requests++;
  return {status:201,body:requests===1?receipt:{...receipt,songs:[{id:'song-a'},{id:'song-a'}]}};
 }});
 const input={modelId:'chirp-v6',prompt:'恋爱风，雨后街角'};
 const check=async()=>{scoped++;};
 assert.deepEqual(await adapter.submitPrompt(input,check),{state:'accepted',trackingId:'receipt',songIds:['song-a','song-b']});
 assert.deepEqual(await adapter.submitPrompt(input,check),{state:'unknown',reason:'DUPLICATE_REMOTE_ID'});
 assert.equal(requests,2);
 assert.equal(scoped,2);
});
function audioFixture(){
 const rate=8000,samples=rate*2,data=Buffer.alloc(44+samples*2);
 data.write('RIFF');data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);
 data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(1,22);
 data.writeUInt32LE(rate,24);data.writeUInt32LE(rate*2,28);data.writeUInt16LE(2,32);data.writeUInt16LE(16,34);
 data.write('data',36);data.writeUInt32LE(samples*2,40);
 return data;
}
async function coverPlan(t,{generate=false,count=2,instrumental=false,zhipu=false}={}){
 const root=path.resolve('output/test-runs/plan-cover-'+randomUUID()),s=new Studio(root,'production');
 t.after(()=>s.close());
 const account=await s.call('account.save',{provider:'fanqie',name:'离线番茄账号',dailyLimit:3});
 if(!instrumental){
  const downloads=path.join(root,'downloads');
  fs.mkdirSync(downloads);
  setDownloadDirectory(s.repo,{root:downloads,expectedRevision:0});
 }
 const music=await s.call('apiProfile.save',{profile:{id:randomUUID(),kind:'music',providerId:'yourmusic',label:'Fixture music',modelId:'chirp-v6',executionEnabled:false},expectedRevision:null});
 const image=generate?await s.call('apiProfile.save',{profile:{id:randomUUID(),kind:'image',providerId:zhipu?'zhipu_image':'openai_image',label:'Fixture image',modelId:zhipu?'cogview-3-flash':openAiCoverModel,executionEnabled:false},expectedRevision:null}):null;
 const center=s.planCenterService(),artistId=s.all('artists')[0].id;
 const plan=center.save({plan:{
  id:randomUUID(),artistId,title:'Fixture release',theme:'恋爱',count,schedule:{kind:'daily',localTime:'09:00'},
  material:{source:instrumental?'provider':'pule_prompt'},...(instrumental?{songType:'instrumental'}:{}),text:{},music:{route:'pule',profileId:music.id,profileRevision:music.revision,modelId:music.modelId,budgetCredits:100,maxCostPerRequestCredits:20,consent:true,creditPolicy:{mode:'uncapped_existing_credits',noRecharge:true,actualCostUnknown:true,consent:true}},
  routing:{text:{source:'default'},music:{source:'override',profileId:music.id},image:image?{source:'override',profileId:image.id}:{source:'default'}},
  outputs:{lyrics:true,music:true,cover:instrumental},
  authorization:{text:false,music:true,publish:true},fanqie:{accountId:account.id,accountKey:'a'.repeat(64),configurationHash:'b'.repeat(64),materialsConsent:true},
 },expectedRevision:null});
 assert.equal(plan.outputs.cover,true);
 const preview=center.preview({id:plan.id}),run=center.run({id:plan.id,expectedRevision:plan.revision,summaryHash:preview.summaryHash,requestId:randomUUID(),source:'manual'});
 for(const item of center.list().items){
  const scope={runId:run.id,itemId:item.id,stage:'music_submit'},submit=planPuleAction(s,'claim',scope);
  if(instrumental){
   assert.equal(submit.draft.instrumental,true);assert.deepEqual(submit.draft.sections,[]);
   const adapter=new YourMusicAdapter({source:'fixture',credential:async()=> 'fixture',request:async request=>{
    assert.match(request.url,/generate\/custom$/);
    assert.equal(request.body.instrumental,true);assert.equal(request.body.lyrics,'');
    assert.match(request.body.tags,/纯器乐演奏/);await request.assertDispatch();
    return{status:202,body:{task_id:'fixture',status:'pending',songs:[{id:'a',status:'pending'},{id:'b',status:'pending'}]}};
   }});
   const result=await adapter.submit({draft:submit.draft,modelId:submit.modelId,operationId:submit.attemptId},async()=>{});
   assert.equal(result.state,'accepted');
  }
  const songIds=[`song-${item.ordinal}-A`,`song-${item.ordinal}-B`];
  planPuleAction(s,'record',{...scope,attemptId:submit.attemptId,status:'succeeded',receipt:{trackingId:'job-'+item.ordinal,songIds}});
  const stage={...scope,stage:'music_assets'},assets=planPuleAction(s,'claim',stage);
  await planPuleAction(s,'assets',{...stage,attemptId:assets.attemptId,songs:[{
   id:songIds[0],title:'街角 '+item.ordinal,lyrics:instrumental?'':'这一首独立歌词 '+item.ordinal+'\n在街角等候回音\n今天把约定写下',mime:'audio/wav',bytes:audioFixture(),
  },null]});
 }
 tickPlanCenter(s);
 assert.equal(planFanqieAction(s,'list',{}).length,0);
 assert(center.list().items.every(item=>!s.get('works',item.workId).assets.cover));
 const entries=await s.call('cover.inboxStatus',{});
 assert.equal(entries.length,count);
 return {s,center,entries,image};
}
function settleFile(file){
 const past=new Date(Date.now()-3000);fs.utimesSync(file,past,past);
}
function fixtureCover(background){
 return sharp({create:{width:512,height:512,channels:3,background}}).jpeg().toBuffer();
}
test('prompt releases wait for song-specific covers and reject reuse across songs',async t=>{
 const {s,center,entries}=await coverPlan(t);
 const briefs=entries.map(entry=>JSON.parse(fs.readFileSync(path.join(entry.directory,'request.json'),'utf8')));
 assert.equal(new Set(briefs.map(brief=>brief.workId)).size,2);
 for(const brief of briefs){
  assert(brief.prompt.includes(brief.context.title));
  assert(brief.prompt.includes(brief.context.lyrics));
 }
 assert.deepEqual(planCoverImage(s,'list',{}),[]);
 const first=await fixtureCover('#87ab99'),second=await fixtureCover('#ecbc8a');
 const files=entries.map(entry=>path.join(entry.directory,'cover.jpg'));
 for(const file of files){fs.writeFileSync(file,first);settleFile(file);}
 await scanCoverInbox(s);tickPlanCenter(s);tickPlanCenter(s);
 assert.equal(planFanqieAction(s,'list',{}).length,1);
 assert.equal((await s.call('cover.inboxStatus',{}))[1].reason,'COVER_INBOX_DUPLICATE_IMAGE');
 fs.writeFileSync(files[1],second);settleFile(files[1]);
 await scanCoverInbox(s);tickPlanCenter(s);tickPlanCenter(s);
 assert.equal(planFanqieAction(s,'list',{}).length,2);
 assert.equal(new Set(center.list().items.map(item=>item.materials.coverAssetId)).size,2);
 assert.equal(s.all('works').length,2);
});
test('instrumental plan uses custom music without text stages and prepares lyric-free Fanqie materials',async t=>{
 const {s,center,entries}=await coverPlan(t,{instrumental:true,generate:true,count:1});
 const file=path.join(entries[0].directory,'cover.jpg');
 fs.writeFileSync(file,await fixtureCover('#6ca452'));settleFile(file);
 await scanCoverInbox(s);tickPlanCenter(s);tickPlanCenter(s);
 const item=center.list().items[0],work=s.get('works',item.workId);
 assert.equal(work.config.voice,'instrumental');assert.equal(work.lyrics,'');
 assert.equal(item.materials.lyrics,'');
 assert.deepEqual(center.list().stageAttempts.map(row=>row.stage),['music_submit','music_assets','cover','materials']);
 assert.equal(planFanqieAction(s,'list',{}).length,1);
});
for (const zhipu of [false,true]) test(`${zhipu?'智谱':'OpenAI'} sends each final song brief once and persists the generated cover`,async t=>{
 const {s,center,entries,image}=await coverPlan(t,{generate:true,zhipu});
 const prompts=[],images=[await fixtureCover('#99aa87'),await fixtureCover('#cd9c77')];
 const credentials=new ApiCredentials({
  vault:{isAvailable:()=>true,has:()=>true,get:()=>'offline-test-key'},
  context:()=>({mode:'production',generation:1}),getProfile:async()=>image,
  connectionRequest:async input=>{
   if(zhipu&&input.method==='GET'){
    assert.equal(input.url,'https://sfile.chatglm.cn/testpath/fixture.jpg');
    return {status:200,body:images.shift()};
   }
   assert.equal(input.url,zhipu?'https://open.bigmodel.cn/api/paas/v4/images/generations':'https://api.openai.com/v1/images/generations');
   assert.equal(input.body.model,image.modelId);
   await input.assertDispatch();
   input.assertActive();
   prompts.push(input.body.prompt);
   const result=zhipu?{url:'https://sfile.chatglm.cn/testpath/fixture.jpg'}:{b64_json:images.shift().toString('base64')};
   return {status:200,body:{data:[result]}};
  },
 });
 const rpc=async(method,raw)=>{
  try{return {ok:true,value:planCoverImage(s,method.split('.').at(-1),raw)};}
  catch(error){return {ok:false,error:{code:error.message}};}
 };
 const runner=createPlanCoverImageRunner({rpc,credentials,available:()=>true,generation:()=>1});
 await Promise.all([runner.pump(),runner.pump()]);
 assert.equal(prompts.length,1);
 recoverCoverImages(s);
 settleFile(path.join(entries[0].directory,'generated.jpg'));
 await scanCoverInbox(s);tickPlanCenter(s);tickPlanCenter(s);
 await runner.pump();
 assert.equal(prompts.length,2);
 assert.notEqual(prompts[0],prompts[1]);
 for(const [index,prompt] of prompts.entries())assert(prompt.includes('这一首独立歌词 '+(index+1)));
 settleFile(path.join(entries[1].directory,'generated.jpg'));
 await scanCoverInbox(s);tickPlanCenter(s);tickPlanCenter(s);await runner.pump();
 assert.equal(planFanqieAction(s,'list',{}).length,2);
 assert.equal(prompts.length,2);
 assert(center.list().stageAttempts.filter(row=>row.stage==='cover').every(row=>row.result.generationVerified));
 assert((await s.call('cover.list',{})).receipts.every(receipt=>receipt.provenance.producer===image.providerId));
});
test('an interrupted image request is not sent again and can be resolved by importing a cover',async t=>{
 const {s,entries}=await coverPlan(t,{generate:true,count:1});
 const request={requestId:entries[0].requestId};
 planCoverImage(s,'dispatch',request);
 recoverCoverImages(s);
 assert.deepEqual(planCoverImage(s,'list',{}),[]);
 const [waiting]=await s.call('cover.inboxStatus',{});
 assert.equal(waiting.generation.state,'unknown');
 const file=path.join(waiting.directory,'cover.jpg');
 fs.writeFileSync(file,await fixtureCover('#88ad77'));settleFile(file);
 await scanCoverInbox(s);tickPlanCenter(s);tickPlanCenter(s);
 assert.equal(planFanqieAction(s,'list',{}).length,1);
});
