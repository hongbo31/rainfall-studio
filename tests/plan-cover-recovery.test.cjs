const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),{randomUUID}=require('node:crypto'),sharp=require('sharp');
const api=require(process.env.RAINFALL_COVER_RECOVERY_BUNDLE),fixture=require('./fixtures/plan-cover-recovery.cjs');
function setup(t){const s=new api.Studio(path.resolve('output/test-runs/cover-recovery-'+randomUUID()),'production');t.after(()=>s.close());return s;}
async function receive(s,workId,color='red'){const request=await s.call('cover.request',{workId,requestId:randomUUID(),brief:'Final lyrics isolated fixture'}),file=path.join(s.root,randomUUID()+'.png');await sharp({create:{width:512,height:512,channels:3,background:color}}).png().toFile(file);const receipt=await s.coverHandoff().receiveFile(file,workId,request.id,'image');return{request,receipt,file};}
test('real SQLite pure lyrics cover failure recovers via saved final work, handoff, explicit select and retry',async t=>{
 const s=setup(t),x=fixture(s,api);api.tickPlanCenter(s);const failed=x.center.list().stageAttempts.find(a=>a.stage==='cover');assert.equal(failed.reason,'COVER_REFRESH_REQUIRED');
 const saved=await s.call('planCenter.prepareCoverWork',x.input);assert.equal(saved.workId,x.item().workId);const work=s.get('works',saved.workId);assert.equal(work.lyrics,x.item().material.lyrics);assert.deepEqual(work.assets,{});assert.deepEqual(x.item().versions,[]);assert.equal((await s.call('planCenter.prepareCoverWork',x.input)).workId,work.id);assert.equal(s.all('works').length,1);
 const {receipt,request}=await receive(s,work.id);assert.equal(s.get('works',work.id).assets.cover,undefined,'receiving is not selecting');await s.call('work.selectAsset',{workId:work.id,role:'cover',assetId:receipt.assetId});
 const retry=await s.call('planCenter.retry',{attemptId:failed.id});assert.equal(retry.state,'dispatching');api.tickPlanCenter(s);const success=x.center.list().stageAttempts.find(a=>a.id===retry.id);assert.equal(success.state,'succeeded');assert.equal(success.result.receiptId,receipt.id);assert.equal(success.result.requestId,request.id);api.tickPlanCenter(s);assert.equal(x.center.list().runs[0].state,'completed');assert.equal(s.all('operations').length,0);assert.equal(s.externalRequests,0);
});

for (const modelId of ['cogview-3-flash', 'glm-image']) test(`智谱 cover uses ${modelId}, downloads without the key, and preserves the selected cover`, async t => {
 const s = setup(t);
 const paid = modelId === 'glm-image';
 const profile = {id:randomUUID(), kind:'image', providerId:'zhipu_image', label:'智谱 AI', modelId, executionEnabled:false};
 await assert.rejects(s.call('apiProfile.save', {profile:{...profile, modelId:'gpt-image-2.6-sunburst'}, expectedRevision:null}));
 const saved = await s.call('apiProfile.save', {profile, expectedRevision:null});
 await s.call('generationConfig.save', {role:'image', profileId:saved.id, expectedRevision:0});
 const work = s.saveWork({title:'雨中漫步', artistId:s.all('artists')[0].id, story:'夜雨', lyrics:'雨声轻轻', prompt:'', parameters:{}, rights:'隔离测试', ai:'unknown'});
 const original = await receive(s, work.id);
 await s.call('work.selectAsset', {workId:work.id, role:'cover', assetId:original.receipt.assetId});
 assert.deepEqual(api.planCoverImage(s, 'list', {}), [], 'external requests do not send an API call');
 const draft = {workId:work.id, requestId:randomUUID(), brief:'城市夜雨', prompt:paid ? '雨夜🌧'.repeat(400) : '城市夜雨，水彩风格'};
 if (paid) await assert.rejects(s.call('cover.generate', draft), /IMAGE_MODEL_CONFIRMATION_REQUIRED/);
 const input = paid ? {...draft, confirmedModelId:modelId} : draft;
 const entry = await s.call('cover.generate', input);
 assert.equal((await s.call('cover.generate', input)).requestId, entry.requestId);
 await assert.rejects(s.call('cover.generate', {...input, requestId:randomUUID()}), /COVER_GENERATION_PENDING/);
 const key = 'fixture.zhipu', download = 'https://sfile.chatglm.cn/testpath/cover.png';
 const edge = paid ? 1280 : 1024;
 const bytes = await sharp({create:{width:edge,height:edge,channels:3,background:'blue'}}).png().toBuffer();
 const calls = [];
 const credentials = new api.ApiCredentials({
  vault:{isAvailable:()=>true, has:()=>true, get:()=>key}, getProfile:async()=>saved,
  context:()=>({mode:'production',generation:1}),
  connectionRequest:async request => {
   await request.assertDispatch?.();
   request.assertActive?.();
   calls.push(request.method);
   if (request.method === 'POST') {
    assert.equal(request.url, 'https://open.bigmodel.cn/api/paas/v4/images/generations');
    assert.equal(request.headers.Authorization, 'Bearer ' + key);
    const prompt = paid ? Array.from(input.prompt).slice(0, 1000).join('') : input.prompt;
    assert.deepEqual(request.body, {model:modelId, prompt, size:`${edge}x${edge}`});
    return {status:200, body:{data:[{url:download}]}};
   }
   assert.equal(request.url, download);
   assert.equal(request.headers?.Authorization, undefined);
   assert.equal(request.binary, true);
   return {status:200, body:bytes};
  },
 });
 const runner = api.createPlanCoverImageRunner({credentials, available:()=>true, generation:()=>1,
  rpc:async (method, value)=>({ok:true,value:api.planCoverImage(s,method.split('.').at(-1),value)}),
 });
 await runner.pump();
 await runner.pump();
 assert.deepEqual(calls, ['POST', 'GET']);
 fs.utimesSync(path.join(entry.directory, 'generated.jpg'), new Date(0), new Date(0));
 await api.scanCoverInbox(s);
 const result = (await s.call('cover.list', {workId:work.id})).receipts.find(receipt=>receipt.requestId===entry.requestId);
 assert.deepEqual(result.provenance, {producer:'zhipu_image', model:modelId, generatedAt:null});
 assert.equal(result.generationVerified, true);
 assert.ok(s.get('works', work.id).assetHistory.includes(result.assetId));
 assert.equal(s.get('works', work.id).assets.cover, original.receipt.assetId);
});

for (const modelId of ['doubao-seedream-5-5-261028', 'doubao-seedream-5-0-pro-260628']) test(`方舟封面使用 ${modelId} 的已确认配置`, async t => {
 const s = setup(t);
 const profile = {id:randomUUID(), kind:'image', providerId:'doubao_image', label:'方舟封面', modelId, executionEnabled:false};
 await assert.rejects(s.call('apiProfile.save', {profile:{...profile,modelId:'doubao-seedance-2-5-260628'},expectedRevision:null}), /IMAGE_MODEL_REQUIRED/);
 const saved = await s.call('apiProfile.save', {profile,expectedRevision:null});
 await s.call('generationConfig.save', {role:'image',profileId:saved.id,expectedRevision:0});
 const work = s.saveWork({title:'夜归',artistId:s.all('artists')[0].id,story:'夜雨',lyrics:'雨声轻轻',prompt:'',parameters:{},rights:'隔离测试',ai:'unknown'});
 const cover = await s.call('cover.list', {workId:work.id});
 assert.deepEqual(cover.manualCover, {providerId:'doubao_image', modelId});
 const input = {workId:work.id,requestId:randomUUID(),brief:'',prompt:'城市夜雨，水彩风格'};
 await assert.rejects(s.call('cover.generate', input), /IMAGE_MODEL_CONFIRMATION_REQUIRED/);
 await assert.rejects(s.call('cover.generate', {...input,confirmedModelId:'glm-image'}), /IMAGE_MODEL_CONFIRMATION_REQUIRED/);
 assert.deepEqual(api.planCoverImage(s, 'list', {}), []);
 const entry = await s.call('cover.generate', {...input,confirmedModelId:modelId});
 assert.equal(api.planCoverImage(s, 'list', {})[0].model, modelId);
 const bytes = await sharp({create:{width:1536,height:1536,channels:3,background:'blue'}}).jpeg().toBuffer();
 const requests = [];
 const credentials = new api.ApiCredentials({
  vault:{isAvailable:()=>true,has:()=>true,get:()=> 'fixture-ark'}, getProfile:async()=>saved,
  context:()=>({mode:'production',generation:1}),
  connectionRequest:async request=>{
   await request.assertDispatch();
   requests.push(request.body);
   assert.equal(request.method, 'POST');
   assert.equal(request.url, 'https://ark.cn-beijing.volces.com/api/v3/images/generations');
   assert.equal(request.purpose, 'doubao_image');
   assert.equal(request.headers.Authorization, 'Bearer fixture-ark');
   return {status:200,body:{model:modelId,data:[{b64_json:bytes.toString('base64'),size:'1536x1536'}]}};
  },
 });
 const runner = api.createPlanCoverImageRunner({credentials,available:()=>true,generation:()=>1,
  rpc:async (method,value)=>({ok:true,value:api.planCoverImage(s,method.split('.').at(-1),value)}),
 });
 await runner.pump();
 await runner.pump();
 assert.deepEqual(requests,[{model:modelId,prompt:input.prompt,size:'1536x1536',response_format:'b64_json',output_format:'jpeg'}]);
 fs.utimesSync(path.join(entry.directory, 'generated.jpg'), new Date(0), new Date(0));
 await api.scanCoverInbox(s);
 const result = (await s.call('cover.list',{workId:work.id})).receipts.find(row=>row.requestId===entry.requestId);
 assert.ok(result, 'the downloaded JPEG is imported as a cover version');
 assert.equal(result.generationVerified,true);
 assert.deepEqual(result.provenance,{producer:'doubao_image', model:modelId, generatedAt:null});
 assert.equal(s.externalRequests,0);
});

test('智谱 cover rejects untrusted result URLs before starting a download', async () => {
 const profile = {id:randomUUID(), kind:'image', providerId:'zhipu_image', label:'智谱 AI', modelId:'cogview-3-flash', executionEnabled:false, revision:1};
 const scope = {profileId:profile.id, expectedRevision:profile.revision};
 for(const url of ['http://sfile.chatglm.cn/cover.png', 'https://sfile.chatglm.cn.example.org/cover.png', 'https://sfile.chatglm.cn:8443/cover.png', 'https://user@sfile.chatglm.cn/cover.png']){
  const calls = [];
  const credentials = new api.ApiCredentials({
   vault:{get:()=>'offline-fixture'}, getProfile:async()=>profile, context:()=>({mode:'production', generation:1}),
   connectionRequest:async request=>{calls.push(request.method);return {status:200, body:{data:[{url}]}};},
  });
  await assert.rejects(credentials.generatePlanCover(scope, 'offline prompt', async()=>{}, ()=>{}), /IMAGE_DOWNLOAD_URL_REJECTED/);
  assert.deepEqual(calls, ['POST']);
 }
 await assert.rejects(api.nodeHttpsTransport({method:'GET', url:'https://sfile.chatglm.cn/cover.png', binary:true,
  headers:{authorization:'offline-fixture'}}), /DOWNLOAD_AUTH_REJECTED/);
 await assert.rejects(api.nodeHttpsTransport({method:'POST', url:'https://open.bigmodel.cn/api/paas/v4/chat/completions'}), /HTTP_HOST_REJECTED/);
});
test('materials explicit retry consumes its persisted attempt once',async t=>{
 const s=setup(t),x=fixture(s,api),cover=x.center.claim({runId:x.run.id,itemId:x.item().id,stage:'cover'});x.center.record({attemptId:cover.id,status:'succeeded',evidenceId:'isolated-cover'});const material=x.center.claim({runId:x.run.id,itemId:x.item().id,stage:'materials'});x.center.record({attemptId:material.id,status:'failed',reason:'ISOLATED_LOCAL_INTERRUPTION'});const retry=x.center.retry({attemptId:material.id});api.tickPlanCenter(s);assert.equal(x.center.list().stageAttempts.find(a=>a.id===retry.id).state,'succeeded');assert.equal(x.center.list().stageAttempts.filter(a=>a.stage==='materials').length,2);
});
test('stale hashes, edited final work and stopped plans cannot write or silently recover',async t=>{
 const s=setup(t),x=fixture(s,api);await assert.rejects(s.call('planCenter.prepareCoverWork',{...x.input,expectedFinalPairHash:'0'.repeat(64)}),/FINAL_MATERIAL_CHANGED/);assert.equal(s.all('works').length,0);const saved=await s.call('planCenter.prepareCoverWork',x.input);const work=s.get('works',saved.workId);const foreign=s.save('artists',{...s.all('artists')[0],id:randomUUID(),name:'Foreign fixture'});s.save('works',{...work,artistId:foreign.id});await assert.rejects(s.call('cover.request',{workId:work.id,requestId:randomUUID(),brief:''}),/ARTIST_MISMATCH/);s.save('works',{...work,lyrics:work.lyrics+' changed'});await assert.rejects(s.call('planCenter.prepareCoverWork',x.input),/FINAL_MATERIAL_CHANGED/);s.save('works',work);x.center.stop({runId:x.run.id});await assert.rejects(s.call('planCenter.prepareCoverWork',x.input),/STOP_REQUESTED/);await assert.rejects(s.call('cover.request',{workId:work.id,requestId:randomUUID(),brief:''}),/STOP_REQUESTED/);assert.equal(s.all('operations').length,0);
});
test('restart preserves final work idempotency and unknown local retry does not execute',async t=>{
 const s=setup(t),x=fixture(s,api);api.tickPlanCenter(s);const failed=x.center.list().stageAttempts.find(a=>a.stage==='cover'),saved=await s.call('planCenter.prepareCoverWork',x.input),retry=x.center.retry({attemptId:failed.id});s.close();const reopened=new api.Studio(s.root,'production');t.after(()=>reopened.close());assert.equal((await reopened.call('planCenter.prepareCoverWork',x.input)).workId,saved.workId);api.tickPlanCenter(reopened);assert.equal(reopened.planCenterService().list().stageAttempts.find(a=>a.id===retry.id).state,'unknown');assert.equal(reopened.all('operations').length,0);
});
test('old source image and unrelated work receipts cannot unlock refreshed cover',async t=>{
 const s=setup(t),x=fixture(s,api),oldFile=path.join(s.root,'old-cover.png');await sharp({create:{width:512,height:512,channels:3,background:'green'}}).png().toFile(oldFile);const old=await s.importFile(oldFile,'cover');s.save('textCandidates',{id:x.item().material.candidateId,cover:{assetId:old.id,sha256:old.sha256}});
 const saved=await s.call('planCenter.prepareCoverWork',x.input),work=s.get('works',saved.workId),request=await s.call('cover.request',{workId:work.id,requestId:randomUUID(),brief:''}),receipt=await s.coverHandoff().receiveFile(oldFile,work.id,request.id,'image');await assert.rejects(s.call('work.selectAsset',{workId:work.id,role:'cover',assetId:receipt.assetId}),/COVER_REFRESH_REQUIRED/);
 const unrelated=s.saveWork({artistId:work.artistId,title:'Other',lyrics:'Other',story:'',prompt:'',parameters:{}}),foreign=await receive(s,unrelated.id,'blue');s.save('works',{...s.get('works',work.id),assetHistory:[...s.get('works',work.id).assetHistory,foreign.receipt.assetId]});await assert.rejects(s.call('work.selectAsset',{workId:work.id,role:'cover',assetId:foreign.receipt.assetId}),/COVER_RECEIPT_REQUIRED/);
 api.tickPlanCenter(s);assert.equal(x.center.list().stageAttempts.find(a=>a.stage==='cover').state,'failed');
});
test('stale cover context and corrupt selected bytes remain blocked on explicit retry',async t=>{
 const s=setup(t),x=fixture(s,api);api.tickPlanCenter(s);const failed=x.center.list().stageAttempts.find(a=>a.stage==='cover'),saved=await s.call('planCenter.prepareCoverWork',x.input),work=s.get('works',saved.workId),r=await receive(s,work.id);s.save('works',{...s.get('works',work.id),story:'Changed after request'});await assert.rejects(s.call('work.selectAsset',{workId:work.id,role:'cover',assetId:r.receipt.assetId}),/COVER_CONTEXT_CHANGED/);s.save('works',{...s.get('works',work.id),story:''});await s.call('work.selectAsset',{workId:work.id,role:'cover',assetId:r.receipt.assetId});fs.writeFileSync(s.locate(r.receipt.assetId).file,'corrupt');const retry=x.center.retry({attemptId:failed.id});api.tickPlanCenter(s);const result=x.center.list().stageAttempts.find(a=>a.id===retry.id);assert.equal(result.state,'failed');assert.match(result.reason,/CORRUPT/);
});
test('stop during asynchronous import prevents receipt and selected cover commitment',async t=>{
 const s=setup(t),x=fixture(s,api),saved=await s.call('planCenter.prepareCoverWork',x.input),work=s.get('works',saved.workId),request=await s.call('cover.request',{workId:work.id,requestId:randomUUID(),brief:''}),file=path.join(s.root,'late.png');await sharp({create:{width:512,height:512,channels:3,background:'yellow'}}).png().toFile(file);const original=s.importFile.bind(s);s.importFile=async(...args)=>{const asset=await original(...args);x.center.stop({runId:x.run.id});return asset;};await assert.rejects(s.coverHandoff().receiveFile(file,work.id,request.id,'image'),/STOP_REQUESTED/);assert.equal(s.coverHandoff().list(work.id).receipts.length,0);assert.equal(s.get('works',work.id).assets.cover,undefined);assert.equal(s.get('works',work.id).assetHistory.length,0);assert.equal(s.all('operations').length,0);
});
test('direct cover import on recovery work requires scoped handoff; ordinary work remains supported',async t=>{
 const s=setup(t),x=fixture(s,api),saved=await s.call('planCenter.prepareCoverWork',x.input),file=path.join(s.root,'direct.png');await sharp({create:{width:512,height:512,channels:3,background:'white'}}).png().toFile(file);await assert.rejects(s.importFile(file,'cover',saved.workId),/COVER_HANDOFF_REQUIRED/);const ordinary=s.saveWork({artistId:s.all('artists')[0].id,title:'Ordinary',lyrics:'Ordinary',story:'',prompt:'',parameters:{}});await s.importFile(file,'cover',ordinary.id);assert.ok(s.get('works',ordinary.id).assets.cover);
});
test('stop while image metadata is pending creates no persistent asset row',async t=>{
 const s=setup(t),x=fixture(s,api),saved=await s.call('planCenter.prepareCoverWork',x.input),request=await s.call('cover.request',{workId:saved.workId,requestId:randomUUID(),brief:''}),file=path.join(s.root,'pending.png');await sharp({create:{width:512,height:512,channels:3,background:'orange'}}).png().toFile(file);const before=s.all('assets').length,original=s.importFile.bind(s);s.importFile=(...args)=>{const pending=original(...args);x.center.stop({runId:x.run.id});return pending;};await assert.rejects(s.coverHandoff().receiveFile(file,saved.workId,request.id,'image'),/STOP_REQUESTED/);assert.equal(s.all('assets').length,before);assert.equal(s.coverHandoff().list(saved.workId).receipts.length,0);
});
test('materials revalidates exact final lyrics and cover proof after cover stage succeeds',async t=>{
 const s=setup(t),x=fixture(s,api);api.tickPlanCenter(s);const failed=x.center.list().stageAttempts.find(a=>a.stage==='cover'),saved=await s.call('planCenter.prepareCoverWork',x.input),r=await receive(s,saved.workId);await s.call('work.selectAsset',{workId:saved.workId,role:'cover',assetId:r.receipt.assetId});x.center.retry({attemptId:failed.id});api.tickPlanCenter(s);const work=s.get('works',saved.workId);await s.call('work.save',{...work,expected:work.revision,lyrics:work.lyrics+' changed'});api.tickPlanCenter(s);assert.notEqual(x.center.list().runs[0].state,'completed');assert.equal(x.center.list().stageAttempts.find(a=>a.stage==='materials').reason,'FINAL_MATERIAL_CHANGED');
});
test('new current-context receipt for the same image is not masked by an earlier stale receipt',async t=>{
 const s=setup(t),x=fixture(s,api),saved=await s.call('planCenter.prepareCoverWork',x.input),first=await receive(s,saved.workId),work=s.get('works',saved.workId);s.save('works',{...work,story:'Current revised cover brief'});const request=await s.call('cover.request',{workId:work.id,requestId:randomUUID(),brief:'Current context'}),receipt=await s.coverHandoff().receiveFile(first.file,work.id,request.id,'image');assert.equal(receipt.assetId,first.receipt.assetId);await s.call('work.selectAsset',{workId:work.id,role:'cover',assetId:receipt.assetId});assert.equal(s.coverHandoff().verifiedSelectedReceipt(work.id).request.id,request.id);
});
test('selected cover changes between cover success and materials require the completed proof',async t=>{
 const s=setup(t),x=fixture(s,api);api.tickPlanCenter(s);const failed=x.center.list().stageAttempts.find(a=>a.stage==='cover'),saved=await s.call('planCenter.prepareCoverWork',x.input),first=await receive(s,saved.workId),second=await receive(s,saved.workId,'purple');await s.call('work.selectAsset',{workId:saved.workId,role:'cover',assetId:first.receipt.assetId});x.center.retry({attemptId:failed.id});api.tickPlanCenter(s);await s.call('work.selectAsset',{workId:saved.workId,role:'cover',assetId:second.receipt.assetId});api.tickPlanCenter(s);assert.equal(x.center.list().stageAttempts.find(a=>a.stage==='materials').reason,'COVER_MATERIAL_CHANGED');assert.notEqual(x.center.list().runs[0].state,'completed');
});
test('completed cover cannot be reopened by creating an empty final-lyrics work',async t=>{
 const s=setup(t),x=fixture(s,api),cover=x.center.claim({runId:x.run.id,itemId:x.item().id,stage:'cover'});x.center.record({attemptId:cover.id,status:'succeeded',evidenceId:'verified-original-cover'});await assert.rejects(s.call('planCenter.prepareCoverWork',x.input),/COVER_ALREADY_COMPLETED/);assert.equal(s.all('works').length,0);api.tickPlanCenter(s);assert.equal(x.center.list().runs[0].state,'completed');
});
test('cross-item final CAS rejects and concurrent SQLite connections create exactly one recovery work',async t=>{
 const s=setup(t),x=fixture(s,api),y=fixture(s,api);await assert.rejects(s.call('planCenter.prepareCoverWork',{...x.input,itemId:y.item().id}),/FINAL_MATERIAL_CHANGED/);assert.equal(s.all('works').length,0);
 const {Worker}=require('node:worker_threads'),worker=`const {parentPort,workerData:p}=require('node:worker_threads');require(p.guard);const {Studio}=require(p.bundle);const s=new Studio(p.root,'production');s.call('planCenter.prepareCoverWork',p.input).then(r=>parentPort.postMessage(r)).catch(e=>parentPort.postMessage({error:e.message})).finally(()=>s.close());`;
 const runWorker=()=>new Promise((resolve,reject)=>{const w=new Worker(worker,{eval:true,workerData:{guard:path.resolve('tests/fixtures/offline-only.cjs'),bundle:process.env.RAINFALL_COVER_RECOVERY_BUNDLE,root:s.root,input:x.input}});w.once('message',resolve);w.once('error',reject);});const results=await Promise.all([runWorker(),runWorker()]);assert.ok(results.every(r=>r.workId));assert.equal(results[0].workId,results[1].workId);assert.equal(s.all('works').length,1);assert.equal(s.all('operations').length,0);
});
test('stopping after cover success prevents local materials claim or completion',async t=>{
 const s=setup(t),x=fixture(s,api);api.tickPlanCenter(s);const failed=x.center.list().stageAttempts.find(a=>a.stage==='cover'),saved=await s.call('planCenter.prepareCoverWork',x.input),r=await receive(s,saved.workId);await s.call('work.selectAsset',{workId:saved.workId,role:'cover',assetId:r.receipt.assetId});const retry=x.center.retry({attemptId:failed.id});assert.throws(()=>x.center.retry({attemptId:failed.id}),/ATTEMPT_IN_PROGRESS/);api.tickPlanCenter(s);assert.equal(x.center.list().stageAttempts.find(a=>a.id===retry.id).state,'succeeded');x.center.stop({runId:x.run.id});api.tickPlanCenter(s);assert.equal(x.center.list().stageAttempts.filter(a=>a.stage==='materials').length,0);assert.equal(x.center.list().runs[0].state,'stopped');await assert.rejects(s.call('work.selectAsset',{workId:saved.workId,role:'cover',assetId:r.receipt.assetId}),/STOP_REQUESTED/);
});
test('same-context duplicate import preserves successful cover proof through materials',async t=>{
 const s=setup(t),x=fixture(s,api);api.tickPlanCenter(s);const failed=x.center.list().stageAttempts.find(a=>a.stage==='cover'),saved=await s.call('planCenter.prepareCoverWork',x.input),r=await receive(s,saved.workId);await s.call('work.selectAsset',{workId:saved.workId,role:'cover',assetId:r.receipt.assetId});x.center.retry({attemptId:failed.id});api.tickPlanCenter(s);const duplicate=await receive(s,saved.workId);assert.equal(duplicate.receipt.assetId,r.receipt.assetId);assert.equal(s.coverHandoff().verifiedSelectedReceipt(saved.workId).receipt.id,r.receipt.id);api.tickPlanCenter(s);assert.equal(x.center.list().runs[0].state,'completed');
});
