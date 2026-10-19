import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
let createProductionFlowBroker,YourMusicAdapter;
if(fs.existsSync('src/main/production-flow.ts')){
 await build({stdin:{contents:'export * from "./src/main/production-flow"; export {YourMusicAdapter} from "./src/core/workflow/yourmusic";',resolveDir:process.cwd()},outfile:'output/production-flow-broker-test.cjs',bundle:true,platform:'node',format:'cjs',packages:'external'});
 ({createProductionFlowBroker,YourMusicAdapter}=createRequire(import.meta.url)(path.resolve('output/production-flow-broker-test.cjs')));
}
createRequire(import.meta.url)('./fixtures/offline-only.cjs');
const id='ef67e259-de42-444e-b1d2-56ed39392dc9',profileId='c006db5f-7cdc-4247-898d-d5a29e9b007a',opId='6a9206c8-0ec2-405a-86c4-687ae6b5b30e';
function setup(type='text_generate'){
 let configured=true,active=true,generation=1,recorded;
 const events=[],run={id,revision:1,plan:{text:{profileId,profileRevision:1},music:{profileId,profileRevision:1}}};
 const task={type,profileId,profileRevision:1,request:{operationId:opId,songIds:['a','b']}};
 const credentials={apiCredentialStatus:async()=>({configured}),withDeepSeekAdapter:async(_i,fn,guard)=>{guard();return fn({invoke:async()=>{events.push('http');return {operationId:opId}},evaluate:async()=>{events.push('score');return {operationId:opId}}})},withMusicAdapter:async(_i,fn,guard)=>{guard();return fn({submit:async()=>{events.push('music');return{state:'unknown'}},query:async()=>{events.push('query');return{songs:[]}}})}};
 const o={credentials,available:()=>active,generation:()=>generation,publication:{capability:()=>({available:false,reasons:['ACCOUNT_UNIQUE_ID_REQUIRED','AI_ROUTE_NOT_VALIDATED','TERMS_ACCEPTANCE_REQUIRED']})},rpc:async(method,input)=>{
  events.push(method);
  let value={};
  if(method.endsWith('.list'))value={plans:[],runs:[run]};
  if(method.endsWith('.context'))value={run};
  if(method.endsWith('.next'))value={run,task};
  if(method.endsWith('.claim'))value={run,task,operation:{id:opId}};
  if(method.endsWith('.record'))recorded=input;
  return{ok:true,value};
 }};
 return{o,events,missing:()=>configured=false,stop:()=>active=false,move:()=>generation++,recorded:()=>recorded};
}
test('production flow broker exists',()=>assert.equal(typeof createProductionFlowBroker,'function'));
test('missing Key blocks durably before claim or HTTP',async()=>{const x=setup();x.missing();await createProductionFlowBroker(x.o).pump();assert(x.events.includes('internal.productionFlow.block'));assert(!x.events.includes('internal.productionFlow.claim'));assert(!x.events.includes('http'))});
test('text charge claims durably before HTTP and records same operation',async()=>{const x=setup();await createProductionFlowBroker(x.o).pump();assert(x.events.indexOf('internal.productionFlow.claim')<x.events.indexOf('http'));assert.equal(x.recorded().operationId,opId);assert.equal(x.recorded().result.type,'text_generate')});
test('model scoring dispatches evaluate rather than invoke',async()=>{const x=setup('text_score');await createProductionFlowBroker(x.o).pump();assert(x.events.includes('score'));assert(!x.events.includes('http'))});
test('publication capability block creates no claim and no fabricated receipt',async()=>{const x=setup('publication_submit');await createProductionFlowBroker(x.o).pump();assert(x.events.includes('internal.productionFlow.block'));assert(!x.events.includes('internal.productionFlow.claim'));assert.equal(x.recorded(),undefined)});
test('renderer cannot inject official receipts, charges, claims or assets',async()=>{const x=setup(),b=createProductionFlowBroker(x.o);for(const action of ['claim','record','materialize','importAudio','block'])await assert.rejects(b.ui(action,{}),/METHOD_NOT_ALLOWED/);assert.equal(x.events.length,0)});
test('unavailable/simulation workspace makes no RPC',async()=>{const x=setup();x.stop();await createProductionFlowBroker(x.o).pump();assert.deepEqual(x.events,[])});
test('known budget, risk and plan guard failures retain precise durable blocker codes',async()=>{
 for(const code of ['TEXT_BUDGET_INSUFFICIENT','MUSIC_BUDGET_INSUFFICIENT','PROVIDER_RISK_FROZEN','FLOW_PROVIDER_BUSY','PLAN_REVISION_CHANGED','PROFILE_REVISION_CHANGED']){
  const x=setup(),rpc=x.o.rpc;let reason;
  x.o.rpc=async(method,input)=>{if(method.endsWith('.claim'))return{ok:false,error:{code}};if(method.endsWith('.block'))reason=input.reason;return rpc(method,input)};
  await createProductionFlowBroker(x.o).pump();assert.equal(reason,code);assert(!x.events.includes('http'));
 }
});
test('a pending request serializes pumps until actual adapter completion',async()=>{
 const x=setup();let finish,enter;const started=new Promise(r=>enter=r);
 x.o.credentials.withDeepSeekAdapter=async(_i,fn)=>fn({invoke:async()=>{x.events.push('http');enter();return new Promise(r=>finish=()=>r({operationId:opId}))}});
 const b=createProductionFlowBroker(x.o),first=b.pump();await started;await b.pump();assert.equal(x.events.filter(e=>e==='http').length,1);finish();await first;
});
test('workspace change after HTTP cannot record into a new Core generation',async()=>{const x=setup();x.o.credentials.withDeepSeekAdapter=async(_i,fn)=>fn({invoke:async()=>{x.move();return{operationId:opId}}});await createProductionFlowBroker(x.o).pump();assert.equal(x.recorded(),undefined)});

test('actual YourMusic succeeded query shape downloads and imports the original requested IDs in order',async()=>{
 const x=setup('music_assets'),http=[],imports=[];
 const songs=[{id:'b',status:'succeeded',audio_url:'https://oss.yourmusic.fun/original-b.wav',title:'B',lyric:'provider lyric B'},{id:'a',status:'succeeded',audio_url:'https://oss.yourmusic.fun/original-a.wav',title:'A',lyric:'provider lyric A'}];
 const adapter=new YourMusicAdapter({source:'external',credential:async()=> 'SYNTHETIC_ONLY',request:async request=>{
  http.push(request);
  return request.url.startsWith('https://api.yourmusic.fun/')?{status:200,body:songs}:{status:200,headers:{'content-type':'audio/wav'},body:Buffer.from('synthetic original bytes')};
 }});
 x.o.credentials.withMusicAdapter=async(_identity,fn,guard)=>{guard();return fn(adapter)};
 const rpc=x.o.rpc;x.o.rpc=async(method,input)=>{
  if(method.endsWith('.importAudio')){imports.push(input);return{ok:true,value:{providerSongId:input.providerSongId,ordinal:input.ordinal,assetId:input.ordinal===0?id:profileId,sha256:'a'.repeat(64)}}}
  return rpc(method,input);
 };
 await createProductionFlowBroker(x.o).pump();
 assert.deepEqual(http.map(request=>[request.method,request.url]),[['GET','https://api.yourmusic.fun/v1/music/generations/query?songid=a%2Cb'],['GET','https://oss.yourmusic.fun/original-a.wav'],['GET','https://oss.yourmusic.fun/original-b.wav']]);
 assert.deepEqual(imports.map(value=>[value.operationId,value.providerSongId,value.ordinal]),[[opId,'a',0],[opId,'b',1]]);
 assert.equal(imports[0].providerMetadata.lyric,'provider lyric A');
 assert.equal(x.recorded().result.status,'complete');
 assert.deepEqual(x.recorded().result.assets.map(asset=>asset.providerSongId),['a','b']);
 assert(!x.events.includes('music'));
});

test('query errors and incomplete original song sets cannot fabricate assets or resubmit music',async()=>{
 for(const query of [{state:'error'},{state:'known',songs:[{id:'a',status:'succeeded',audio_url:'https://oss.yourmusic.fun/a.wav'}]},{state:'known',songs:[{id:'a',status:'failed'},{id:'b',status:'processing'}]}]){
  const x=setup('music_assets');let downloads=0,submits=0;
  x.o.credentials.withMusicAdapter=async(_identity,fn,guard)=>{guard();return fn({query:async()=>query,download:async()=>{downloads++;throw Error('UNEXPECTED_DOWNLOAD')},submit:async()=>{submits++;throw Error('UNEXPECTED_SUBMIT')}})};
  await createProductionFlowBroker(x.o).pump();
  assert.equal(downloads,0);assert.equal(submits,0);assert.deepEqual(x.recorded().result.assets,[]);
  assert.equal(x.recorded().result.status,query.state==='error'||query.songs?.some(song=>song.status==='failed')?'failed':'pending');
 }
});

test('a failed original download records asset failure while preserving the accepted song IDs',async()=>{
 const x=setup('music_assets'),queried=[],downloaded=[];
 x.o.credentials.withMusicAdapter=async(_identity,fn,guard)=>{guard();return fn({query:async ids=>{queried.push(ids);return{state:'known',songs:ids.map(id=>({id,status:'succeeded',audio_url:'https://oss.yourmusic.fun/'+id+'.wav'}))}},download:async url=>{downloaded.push(url);throw Error('SYNTHETIC_DOWNLOAD_FAILURE')},submit:async()=>{throw Error('MUST_NOT_REGENERATE')}})};
 await createProductionFlowBroker(x.o).pump();
 assert.deepEqual(queried,[['a','b']]);assert.deepEqual(downloaded,['https://oss.yourmusic.fun/a.wav']);
 assert.equal(x.recorded().operationId,opId);assert.equal(x.recorded().result.type,'music_assets');
 assert.equal(x.recorded().result.status,'failed');assert.equal(x.recorded().result.reason,'ORIGINAL_DOWNLOAD_FAILED');
});

test('profile or durable claim rejection cannot cross into an HTTP request or fabricated provider record',async()=>{
 for(const phase of ['profile','claim']){
  const x=setup();
  if(phase==='profile')x.o.credentials.withDeepSeekAdapter=async()=>{throw Error('REVISION_CONFLICT')};
  else{const rpc=x.o.rpc;x.o.rpc=async(method,input)=>method.endsWith('.claim')?{ok:false,error:{code:'REVISION_CONFLICT'}}:rpc(method,input)}
  await createProductionFlowBroker(x.o).pump();
  assert(!x.events.includes('http'));assert.equal(x.recorded(),undefined);
  assert(x.events.includes('internal.productionFlow.block'));
 }
});

test('an exception after a durable paid claim records unknown for that operation without a second dispatch',async()=>{
 const x=setup();let calls=0;
 x.o.credentials.withDeepSeekAdapter=async(_identity,fn,guard)=>{guard();return fn({invoke:async()=>{calls++;throw Error('SYNTHETIC_UNCERTAIN_RESPONSE')}})};
 await createProductionFlowBroker(x.o).pump();
 assert.equal(calls,1);assert.equal(x.recorded().operationId,opId);
 assert.equal(x.recorded().result.status,'unknown');assert.equal(x.recorded().result.confirmedUnsent,false);
});

test('workspace changes during credential checks stop before durable claim or cross-workspace record',async()=>{
 const x=setup();x.o.credentials.apiCredentialStatus=async()=>{x.move();return{configured:true}};
 await createProductionFlowBroker(x.o).pump();
 assert(!x.events.includes('internal.productionFlow.claim'));assert(!x.events.includes('http'));assert.equal(x.recorded(),undefined);
});

test('the pump stays busy until the durable result acknowledgement resolves',async()=>{
 const x=setup();let enter,finish;const started=new Promise(resolve=>enter=resolve),rpc=x.o.rpc;
 x.o.rpc=async(method,input)=>{if(method.endsWith('.record')){enter();await new Promise(resolve=>finish=resolve)}return rpc(method,input)};
 const broker=createProductionFlowBroker(x.o),first=broker.pump();await started;await broker.pump();
 assert.equal(x.events.filter(event=>event==='http').length,1);finish();await first;
 assert.equal(x.recorded().operationId,opId);
});

test('retry UI delegates only the strict revision request and cannot inject an unsent or provider receipt',async()=>{
 const x=setup(),broker=createProductionFlowBroker(x.o);
 await assert.rejects(broker.ui('retry',{id,expectedRevision:1,status:'confirmed_unsent',confirmedUnsent:true}));
 assert.deepEqual(x.events,[]);
 await broker.ui('retry',{id,expectedRevision:1});
 assert.deepEqual(x.events,['internal.productionFlow.retry']);assert.equal(x.recorded(),undefined);
});

test('a publication poll exception retains the original release identity and never submits again',async()=>{
 const x=setup('publication_poll'),polled=[];let submitted=0;
 x.o.publication={capability:()=>({available:true,reasons:[],transport:'synthetic-read-only',receiptSource:'official-executor-only'}),submit:async()=>{submitted++;throw Error('MUST_NOT_SUBMIT')},poll:async request=>{polled.push(request.externalId);throw Error('SYNTHETIC_QUERY_FAILURE')}};
 const rpc=x.o.rpc;x.o.rpc=async(method,input)=>{const reply=await rpc(method,input);if(reply.value?.task){reply.value.task.request.externalId='original-release';reply.value.run.externalId='original-release'}return reply};
 await createProductionFlowBroker(x.o).pump();
 assert.equal(submitted,0);assert.deepEqual(polled,['original-release']);
 assert.equal(x.recorded().operationId,opId);assert.equal(x.recorded().result.type,'publication_poll');
 assert.equal(x.recorded().result.status,'failed');assert.equal(x.recorded().result.reason,'PUBLICATION_QUERY_FAILED');
 assert.equal(x.recorded().result.externalId,undefined);assert.equal(x.recorded().result.receipt,undefined);
});
