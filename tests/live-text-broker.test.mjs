import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const implemented=fs.existsSync('src/main/live-text.ts');
let createLiveTextBroker;
if(implemented){await build({entryPoints:['src/main/live-text.ts'],outfile:'output/live-text-broker-test.cjs',bundle:true,platform:'node',format:'cjs',packages:'external'});({createLiveTextBroker}=createRequire(import.meta.url)(path.resolve('output/live-text-broker-test.cjs')))}
const job={id:'ef67e259-de42-444e-b1d2-56ed39392dc9',profileId:'c006db5f-7cdc-4247-898d-d5a29e9b007a',expectedProfileRevision:1,revision:1};
const operationId='6a9206c8-0ec2-405a-86c4-687ae6b5b30e';
function setup(){let available=true,configured=true;const events=[];const o={available:()=>available,credentials:{apiCredentialStatus:async()=>({configured}),withDeepSeekAdapter:async(_i,fn,guard)=>{guard();return fn({invoke:async()=>{events.push('http');return{operationId}}})}},rpc:async(name)=>{events.push(name);if(name==='internal.liveText.context')return{ok:true,value:{job}};if(name==='internal.liveText.claim')return{ok:true,value:{job,operation:{id:operationId},request:{}}};return{ok:true,value:job}}};return{o,events,stop:()=>available=false,missing:()=>configured=false}}
test('live text broker implementation exists',()=>assert.equal(typeof createLiveTextBroker,'function'));
test('unconfigured credentials never claim a chargeable text operation',async()=>{assert.equal(typeof createLiveTextBroker,'function');const x=setup();x.missing();await assert.rejects(createLiveTextBroker(x.o).ui('run',{id:job.id,expectedRevision:1}),/CREDENTIAL_REQUIRED/);assert(!x.events.includes('internal.liveText.claim'));assert(!x.events.includes('http'))});
test('explicit run durably claims before transport and records same operation',async()=>{assert.equal(typeof createLiveTextBroker,'function');const x=setup();await createLiveTextBroker(x.o).ui('run',{id:job.id,expectedRevision:1});assert.deepEqual(x.events,['internal.liveText.context','internal.liveText.claim','http','internal.liveText.record'])});
test('renderer cannot inject a provider completion through the text broker',async()=>{assert.equal(typeof createLiveTextBroker,'function');const x=setup();await assert.rejects(createLiveTextBroker(x.o).ui('record',{fake:'result'}),/METHOD_NOT_ALLOWED/);assert.deepEqual(x.events,[])});
test('unavailable workspace rejects run before any RPC or credential access',async()=>{assert.equal(typeof createLiveTextBroker,'function');const x=setup();x.stop();await assert.rejects(createLiveTextBroker(x.o).ui('run',{id:job.id,expectedRevision:1}),/PRODUCTION_REQUIRED/);assert.deepEqual(x.events,[])});
test('a second run cannot enter while the first transport is awaiting a result',async()=>{
 const x=setup();let finish,entered;const started=new Promise(r=>entered=r);
 x.o.credentials.withDeepSeekAdapter=async(_identity,fn,guard)=>{guard();return fn({invoke:async()=>{entered();return new Promise(resolve=>finish=()=>resolve({operationId}))}})};
 const broker=createLiveTextBroker(x.o),first=broker.ui('run',{id:job.id,expectedRevision:1});await started;
 const firstFinish=finish,second=broker.ui('run',{id:job.id,expectedRevision:1});
 const outcome=await Promise.race([second.then(()=> 'resolved',e=>e.message),new Promise(r=>setTimeout(()=>r('incorrectly_entered_transport'),100))]);
 firstFinish();if(finish!==firstFinish)finish();await Promise.allSettled([first,second]);
 assert.equal(outcome,'TEXT_TASK_BUSY');
});
