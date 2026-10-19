import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import path from 'node:path';
await build({entryPoints:['src/main/api-credentials.ts'],outfile:'output/deepseek-bridge-test.cjs',bundle:true,platform:'node',format:'cjs',packages:'external'});
const {ApiCredentials}=createRequire(import.meta.url)(path.resolve('output/deepseek-bridge-test.cjs'));
const profile={id:'c006db5f-7cdc-4247-898d-d5a29e9b007a',revision:1,kind:'text',providerId:'deepseek',label:'DeepSeek QA',modelId:null,executionEnabled:false};
function setup(request){let reads=0;let generation=1;const service=new ApiCredentials({vault:{isAvailable:()=>true,has:()=>true,get:()=>{reads++;return 'QA_ONLY_NEVER_REAL'}},getProfile:async()=>profile,context:()=>({mode:'production',generation}),textRequest:request});return{service,reads:()=>reads,invalidate:()=>generation++}}
test('DeepSeek connection uses fixed read-only models endpoint without exposing credential',async()=>{
 const sent=[];const x=setup(async r=>{sent.push(r);return{status:200,body:{object:'list',data:[{id:'deepseek-flash',object:'model'}]}}});
 const result=await x.service.checkApiConnection({profileId:profile.id,expectedRevision:1});
 assert.equal(result.state,'connected');assert.equal(result.providerId,'deepseek');assert.equal(result.paidGenerationRequested,false);
 assert.deepEqual(sent.map(r=>[r.method,r.url]),[['GET','https://api.deepseek.com/models']]);
 assert(!JSON.stringify(result).includes('QA_ONLY'));assert.equal(x.reads(),1);
});
test('DeepSeek check rejects response without model identity and discards remote payload',async()=>{
 const x=setup(async()=>({status:200,body:{data:[{id:''}],secret:'DO_NOT_EXPOSE'}}));
 const result=await x.service.checkApiConnection({profileId:profile.id,expectedRevision:1});
 assert.equal(result.state,'invalid_response');assert(!JSON.stringify(result).includes('DO_NOT_EXPOSE'));
});
test('DeepSeek bridge checks live scope before invoking consumer and hides credential behind adapter',async()=>{
 const x=setup(async()=>({status:200,body:{data:[]}}));
 assert.equal(typeof x.service.withDeepSeekAdapter,'function');
 let called=0;
 await assert.rejects(x.service.withDeepSeekAdapter({profileId:profile.id,expectedRevision:1},async()=>called++,()=>{throw Error('WORKSPACE_CHANGED')}),/WORKSPACE_CHANGED/);
 assert.equal(called,0);assert.equal(x.reads(),0);
});
