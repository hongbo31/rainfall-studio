import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
const out=path.resolve('output/unified-publish-main-tests/main.cjs');
await build({stdin:{contents:'export * from "./src/main/tme/unified-publish";export * from "./src/core/unified-publication";export {Repository} from "./src/core/database";',resolveDir:process.cwd()},outfile:out,bundle:true,platform:'node',format:'cjs',packages:'external'});
const {createUnifiedPublishBroker}=createRequire(import.meta.url)(out);
function fixture(options={}) {
 let task={id:'task',workId:'work',audioSha:'sha',revision:1,state:'queued'},generation=1;
 const calls=[],grant={id:'grant',revision:1,workId:'work'},job={id:'prepare',workId:'work',grantId:'grant',revision:1,state:'ready'};
 const broker=createUnifiedPublishBroker({available:()=>true,generation:()=>generation,nativeAvailable:()=>true,
 rpc:async(method,input={})=>{calls.push([method,input]);const action=method.split('.').at(-1);
  if(action==='list')return{ok:true,value:[{...task}]};
  if(action==='prepareContext')return{ok:true,value:{task:{...task},grant,job:null}};
  if(action==='claim'){task={...task,state:'preparing',revision:task.revision+1};return{ok:true,value:task}};
  if(action==='update'){assert.equal(input.expectedRevision,task.revision);task={...task,...input.patch,revision:task.revision+1};return{ok:true,value:task}};
  throw Error(method);
 },prepare:{ui:async(action,input)=>{calls.push(['prepare.'+action,input]);if(action==='start')return{job};if(action==='run')return{job:{...job,revision:2,state:'awaiting_terms_review'}};throw Error(action)}},submission:{ui:async(action,input)=>{calls.push(['submission.'+action,input]);return{workId:'work',ready:false,reasons:['EXECUTOR_UNAVAILABLE'],job:{id:'submission'}}}},...options});
 return{broker,calls,task:()=>task,switch:()=>generation++};
}
test('queued intent schedules preparation, persists job and stops at explicit submission confirmation',async()=>{
 const x=fixture();await x.broker.pump();assert.equal(x.task().state,'awaiting_confirmation');assert.equal(x.task().prepareJobId,'prepare');assert.equal(x.task().submissionJobId,'submission');
 assert.deepEqual(x.calls.filter(c=>c[0].startsWith('prepare.')||c[0].startsWith('submission.')).map(c=>c[0]),['prepare.start','prepare.run','submission.preflight']);
 assert.ok(x.calls.findIndex(c=>c[0].endsWith('.update')&&c[1].patch.prepareJobId)<x.calls.findIndex(c=>c[0]==='prepare.run'));
 await x.broker.pump();assert.equal(x.calls.filter(c=>c[0]==='prepare.run').length,1);
});
test('cloud platform reports unavailable without native or preparation dispatch',async()=>{
 const x=fixture({nativeAvailable:()=>false});await x.broker.pump();assert.equal(x.task().state,'blocked');assert.equal(x.task().reason,'WINDOWS_REQUIRED');assert.equal(x.calls.filter(c=>c[0].startsWith('prepare.')).length,0);
});
test('lost preparation result persists reconciliation and never retries',async()=>{
 const x=fixture({prepare:{ui:async()=>{throw Error('NATIVE_OUTCOME_UNKNOWN')}}});await x.broker.pump();assert.equal(x.task().state,'reconcile_required');await x.broker.pump();assert.equal(x.calls.filter(c=>c[0].endsWith('.claim')).length,1);
});
test('work mismatch fails closed before run or preflight',async()=>{
 const x=fixture({prepare:{ui:async()=>({job:{id:'other',workId:'other',grantId:'grant',revision:1,state:'ready'}})}});await x.broker.pump();assert.equal(x.task().state,'reconcile_required');assert.equal(x.task().reason,'PREPARE_WORK_SCOPE');assert.equal(x.calls.filter(c=>c[0].startsWith('submission.')).length,0);
});
test('workspace change never updates a replacement Core',async()=>{
 let x;x=fixture({prepare:{ui:async()=>{x.switch();throw Error('NATIVE_OUTCOME_UNKNOWN')}}});await x.broker.pump();assert.equal(x.task().state,'preparing');
});
test('production handler persists publish request before scheduling and simulation stays unchanged',async()=>{
 const source=fs.readFileSync('src/main/bootstrap.ts','utf8');assert.match(source,/createUnifiedPublishBroker/);assert.match(source,/method === ["']publish\.simple["']/);assert.match(source,/unifiedPublish\.pump\(/);
});
test('preflight lacking a reviewed submission job stays blocked',async()=>{
 const x=fixture({submission:{ui:async()=>({workId:'work',ready:false,reasons:['MATERIALS_CHANGED']})}});await x.broker.pump();assert.equal(x.task().state,'reconcile_required');assert.equal(x.task().reason,'MATERIALS_CHANGED');
});
test('unavailable production workspace does not read or dispatch',async()=>{
 const x=fixture({available:()=>false});await x.broker.pump();assert.equal(x.calls.length,0);
});
test('concurrent pumps cannot dispatch twice',async()=>{
 const x=fixture();await Promise.all([x.broker.pump(),x.broker.pump()]);assert.equal(x.calls.filter(c=>c[0]==='prepare.run').length,1);
});
test('transport reports cloud contract/session blockers without creating a browser',async()=>{
 const {createTmeAiTransportProvider}=createRequire(import.meta.url)(out);assert.equal(typeof createTmeAiTransportProvider,'function');
 const transport=createTmeAiTransportProvider({platform:'linux',native:{request:async()=>{throw Error('NATIVE_CALLED')}},nativeObserve:async()=>{throw Error('NATIVE_CALLED')}});
 assert.equal(transport.preparationCapability().available,false);assert.equal(transport.preparationCapability().reason,'CLOUD_PREPARE_CONTRACT_UNVERIFIED');
 assert.equal(transport.executor.capability().available,false);assert.equal(transport.executor.capability().transport,'cloud-playwright');
 await assert.rejects(transport.observe({}),/CLOUD_BROWSER_SESSION_REQUIRED/);await assert.rejects(transport.prepare.request('step',{}),/CLOUD_PREPARE_CONTRACT_UNVERIFIED/);
});

test('real Core journal and Main pump link prepare and submission without marking published',async t=>{
 const {Repository,UnifiedPublicationService}=createRequire(import.meta.url)(out);
 const repo=new Repository('output/test-runs/unified-main-'+randomUUID()+'/db.sqlite');t.after(()=>repo.close());
 const core=new UnifiedPublicationService(repo,{verify:()=>{}}),workId=randomUUID(),prepareId=randomUUID(),grantId=randomUUID(),submissionId=randomUUID();
 const request={id:randomUUID(),workId,title:'Cloud isolated integration',target:'qqmusic',accountId:randomUUID(),state:'unavailable',materialSnapshot:{audio:{sha256:'a'.repeat(64),boundAssetId:randomUUID()}}};
 const task=core.enqueue([request])[0],calls=[];
 const broker=createUnifiedPublishBroker({available:()=>true,generation:()=>1,nativeAvailable:()=>true,
  rpc:async(method,i={})=>{try{const action=method.split('.').at(-1);let value;
   if(action==='prepareContext')value={task:core.byId(i.id),grant:{id:grantId,workId,revision:1},job:null};
   else if(action==='list')value=core.list();else value=core[action](i);return{ok:true,value};
  }catch(e){return{ok:false,error:{code:e.message}}}},
  prepare:{ui:async(action)=>{calls.push(action);return{job:{id:prepareId,workId,grantId,revision:1,state:action==='start'?'ready':'awaiting_terms_review'}}}},
  submission:{ui:async(action)=>{calls.push(action);repo.save('settings',{id:'tme-ai-submission:'+submissionId,value:{id:submissionId,prepareJobId:prepareId,workId,state:'awaiting_confirmation'}});return{workId,job:{id:submissionId},reasons:['BROWSER_AI_SUBMIT_CONTRACT_UNVERIFIED']}}},
 });
 await broker.pump();const saved=core.byId(task.id);assert.equal(saved.state,'awaiting_confirmation');assert.equal(saved.prepareJobId,prepareId);assert.equal(saved.submissionJobId,submissionId);assert.ok(saved.dispatchedAt);assert.deepEqual(calls,['start','run','preflight']);
 const restored=new UnifiedPublicationService(repo,{verify:()=>{}});assert.equal(restored.byId(task.id).state,'awaiting_confirmation');await broker.pump();assert.equal(calls.length,3);
});
test('explicit reconciliation with a submit intent only reads receipt, never prepares or resubmits',async()=>{
 const calls=[],task={id:'task',workId:'work',revision:1,state:'reconcile_required',submissionJobId:'submission'};
 const b=createUnifiedPublishBroker({available:()=>true,generation:()=>1,rpc:async(method)=>{calls.push(method);return{ok:true,value:[task]}},prepare:{ui:async()=>{throw Error('MUST_NOT_PREPARE')}},submission:{ui:async(action,input)=>{calls.push(action);assert.equal(action,'reconcile');assert.equal(input.id,'submission')}}});
 await b.reconcile('task');assert.deepEqual(calls,['internal.unifiedPublish.list','reconcile','internal.unifiedPublish.list']);
});
test('read-only reconciliation of an incomplete preparation cannot start or run',async()=>{
 const calls=[],task={id:'task',workId:'work',revision:1,state:'reconcile_required'};
 const b=createUnifiedPublishBroker({available:()=>true,generation:()=>1,rpc:async(method)=>({ok:true,value:method.endsWith('.list')?[task]:{task,job:{id:'prepare'}}}),prepare:{ui:async(action)=>{calls.push(action);return{job:{id:'prepare',state:'reconcile_required'}}}},submission:{ui:async()=>{throw Error('MUST_NOT_SUBMIT')}}});
 await assert.rejects(b.reconcile('task'),/PREPARATION_RECONCILIATION_REQUIRED/);assert.deepEqual(calls,['reconcile']);
});
test('first publication blocked on cloud connection resumes only after capability is available',async()=>{
 let connected=false;const x=fixture({preparationCapability:()=>({available:connected,reason:'CLOUD_PREPARE_CONTRACT_UNVERIFIED'})});
 await x.broker.pump();assert.equal(x.task().state,'blocked');assert.equal(x.calls.filter(c=>c[0]==='prepare.run').length,0);
 connected=true;await x.broker.pump();assert.equal(x.task().state,'awaiting_confirmation');assert.equal(x.calls.filter(c=>c[0]==='prepare.run').length,1);await x.broker.pump();assert.equal(x.calls.filter(c=>c[0]==='prepare.run').length,1);
});

test('durable receipt barrier stops before preparation even with an older empty SQLite journal',async()=>{
 const x=fixture({publicationBarrier:()=>({reason:'OFFICIAL_RECORD_ALREADY_EXISTS'})});await x.broker.pump();assert.equal(x.task().state,'blocked');assert.equal(x.task().reason,'OFFICIAL_RECORD_ALREADY_EXISTS');assert.equal(x.calls.some(c=>c[0].endsWith('prepareContext')||c[0].startsWith('prepare.')||c[0].endsWith('.claim')),false);
});

test('existing-album runtime transport remains write locked while exposing separate receipt reads',async()=>{
 const {createTmeAiTransportProvider}=createRequire(import.meta.url)(out);let reads=0,writes=0;
 const session={page:{},account:async()=>{throw Error('UNEXPECTED_ACCOUNT')}};
 const t=createTmeAiTransportProvider({platform:'win32',cloudExistingAlbumSession:()=>session,readExternalReceipt:async()=>{reads++;return{state:'reviewing'}},native:{request:async()=>{writes++;throw Error('NATIVE_CALLED')}},nativeObserve:async()=>{writes++;throw Error('NATIVE_CALLED')}});
 assert.equal(t.preparationCapability().available,false);assert.equal(t.preparationCapability().reason,'EXISTING_ALBUM_WRITE_INTEGRATION_UNVERIFIED');assert.equal(t.executor.capability().available,false);assert.equal(t.executor.capability().readOnlyReceiptAvailable,true);
 await assert.rejects(t.prepare.request('step',{}),/EXISTING_ALBUM_WRITE_INTEGRATION_UNVERIFIED/);assert.deepEqual(await t.executor.readExternalReceipt({}),{state:'reviewing'});assert.equal(reads,1);assert.equal(writes,0);
});

test('external reviewing record reconciliation cannot prepare or submit',async()=>{
 const calls=[],task={id:'task',workId:'work',reason:'OFFICIAL_RECORD_ALREADY_EXISTS',state:'reviewing',receipt:{remoteId:'18281901'}};
 const b=createUnifiedPublishBroker({available:()=>true,generation:()=>1,rpc:async()=>({ok:true,value:[task]}),prepare:{ui:async()=>{throw Error('MUST_NOT_PREPARE')}},submission:{ui:async(action,input)=>{calls.push(action);assert.equal(action,'reconcile');assert.equal(input.id,'work')}}});
 await b.reconcile('task');assert.deepEqual(calls,['reconcile']);
});
