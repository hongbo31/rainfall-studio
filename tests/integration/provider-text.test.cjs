const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {randomUUID,createHash}=require('node:crypto');
const m=require(process.env.RAINFALL_PROVIDER_TEXT_BUNDLE||'../../output/provider-text-test/provider-text.cjs');
const price=(provider='doubao',model='doubao-test')=>({currency:provider==='doubao'?'CNY':'USD',inputMicrosPerMillionTokens:1000000,outputMicrosPerMillionTokens:2000000,source:'https://www.volcengine.com/docs/ark/model-pricing',version:'offline-fixture-price',modelId:model,responseModelIds:[model]});
const profile=(provider='doubao')=>({id:randomUUID(),kind:'text',providerId:provider,label:'Offline '+provider,modelId:provider==='doubao'?'doubao-test':'deepseek-flash',textPricing:price(provider,provider==='doubao'?'doubao-test':'deepseek-flash'),executionEnabled:false});
function fixture(){
 const root=path.resolve('output/provider-text-test/data',randomUUID()),repo=new m.Repository(path.join(root,'qa.sqlite'));
 const p=m.saveApiProfile(repo,{profile:profile(),expectedRevision:null}),runId=randomUUID(),itemId=runId+':item:1',ownerKey=runId+':'+itemId+':text_generate:1',artistId=randomUUID();
 const plan={id:randomUUID(),revision:1,artistId,material:{source:'provider'},theme:'starlight river',styleTemplate:'acoustic original',authorization:{text:true},text:{profileId:p.id,profileRevision:p.revision,modelId:p.modelId,budgetMicros:100000,maxOutputTokens:1024,threshold:75,maxRewrites:1,maxScoreRetries:1,consent:true}};
 for(const [kind,id,value] of [['plan',plan.id,plan],['run',runId,{id:runId,planId:plan.id,planRevision:1,snapshot:plan,state:'running',stopRequested:false}],['item',itemId,{id:itemId,runId,planId:plan.id}],['stage',ownerKey,{id:ownerKey,runId,itemId,stage:'text_generate',state:'dispatching'}]])repo.save('settings',{id:`plan-center:${kind}:${id}`,value});
 const input={ownerKey,runId,itemId,artistId,profileId:p.id,profileRevision:p.revision,modelId:p.modelId,budgetMicros:100000,maxOutputTokens:1024,theme:plan.theme,styleTemplate:plan.styleTemplate,threshold:75,maxRewrites:1,maxScoreRetries:1,consent:true};
 return{repo,p,input,plan,service:typeof m.ProviderTextService==='function'?new m.ProviderTextService(repo,{recover:false}):null,close:()=>repo.close()};
}
const draft={title:'Starlight',topic:'river',storyBeat:'walk home',language:'English',style:'acoustic',instrumental:false,sections:[{id:'v',kind:'Verse',lines:['starlight river shines tonight']}],hook:{sectionId:'v',startLine:0,endLine:1},vocalPlan:[{sectionId:'v',voice:'male'}],musicPrompts:{suno:{positiveStyle:'acoustic original',negativeStyle:'',durationTarget:180,voiceArrangement:'male'},yourmusic:{positiveStyle:'acoustic original',negativeStyle:'',durationTarget:180,voiceArrangement:'male'}},continuityNotes:'original'};
const result=(claim,content)=>({operationId:claim.operation.id,providerId:claim.request.providerId,requestedModelId:claim.request.modelId,status:'complete',providerRequestId:randomUUID(),providerModel:claim.request.modelId,finishReason:'stop',httpStatus:200,usage:{promptTokens:20,completionTokens:10,cachedTokens:0},content:JSON.stringify(content),reason:null});
test('Doubao profiles normalize official baseURL and reject foreign hosts or cross currency pricing',()=>{
 const p=profile();const parsed=m.apiProfileInputSchema.safeParse(p);
 assert.equal(parsed.success,true,'Doubao must be an independent text profile');
 assert.equal(parsed.data.baseUrl,'https://ark.cn-beijing.volces.com/api/v3');
 assert.equal(m.apiProfileInputSchema.safeParse({...p,baseUrl:'https://evil.example/api/v3'}).success,false);
 assert.equal(m.apiProfileInputSchema.safeParse({...p,textPricing:{...p.textPricing,currency:'USD'}}).success,false);
 assert.equal(m.canStoreApiCredential({...parsed.data,revision:1}),true);
});
test('ProviderTextService rejects forged owners and unknown prices before any claim',()=>{
 assert.equal(typeof m.ProviderTextService,'function');const f=fixture();try{
 assert.throws(()=>f.service.prepare({...f.input,ownerKey:'forged'}),/OWNER|SCOPE/);
 const {revision,...metadata}=f.p;m.saveApiProfile(f.repo,{profile:{...metadata,textPricing:null},expectedRevision:1});
 assert.throws(()=>f.service.prepare({...f.input,profileRevision:2}),/PRICE|PROFILE|SCOPE/);
 assert.equal(f.repo.all('settings').filter(r=>r.id.startsWith('provider-text:operation:')).length,0);
 }finally{f.close()}
});
test('generation and scoring persist separate claims; passed proof is bound to immutable draft and owner',()=>{
 assert.equal(typeof m.ProviderTextService,'function');const f=fixture();try{
 const job=f.service.prepare(f.input);assert.equal(f.service.prepare(f.input).id,job.id);
 const c=f.service.claim({id:job.id});assert.equal(c.operation.phase,'generate');assert(c.job.reservedMicros>0);
 assert.throws(()=>f.service.claim({id:job.id}),/STATE|BUSY|DISPATCH/);
 const generated=f.service.record({id:job.id,operationId:c.operation.id,result:result(c,draft)});assert.equal(generated.phase,'score');assert.equal(generated.state,'ready');
 const sc=f.service.claim({id:job.id});assert.equal(sc.operation.phase,'score');
 const scored={revisionId:generated.draftId,dimensions:{lyrics:85,style:85,coherence:85},findings:['The phrase "starlight river" grounds the theme in a clear original scene.']};
 const done=f.service.record({id:job.id,operationId:sc.operation.id,result:result(sc,scored)});assert.equal(done.state,'complete');assert.equal(done.score.overall,85);assert.equal(done.operations.length,2);assert.equal(done.reservedMicros,0);
 const proof=m.verifyProviderTextProof(f.repo,done.id,f.input);assert.equal(proof.version.pairHash,done.pairHash);assert.equal(proof.scoreOperation.id,sc.operation.id);
 assert.throws(()=>m.verifyProviderTextProof(f.repo,done.id,{...f.input,itemId:'foreign'}),/SCOPE/);
 const row=f.repo.get('settings','provider-text:job:'+done.id);row.value.draft.title='forged';f.repo.save('settings',row);
 assert.throws(()=>m.verifyProviderTextProof(f.repo,done.id,f.input),/PROOF|DRAFT|HASH|VERSION/);
 }finally{f.close()}
});
test('interrupted claims freeze across restart and never create another paid operation',()=>{
 assert.equal(typeof m.ProviderTextService,'function');const f=fixture();try{const j=f.service.prepare(f.input);f.service.claim({id:j.id});const restart=new m.ProviderTextService(f.repo);const {job}=restart.context(j.id);assert.equal(job.state,'unknown');assert.throws(()=>restart.claim({id:j.id}),/STATE|UNKNOWN/);assert.equal(restart.list()[0].operations.length,1);}finally{f.close()}
});
test('stop and profile revision changes prevent subsequent claims while preserving in flight evidence',()=>{
 assert.equal(typeof m.ProviderTextService,'function');const f=fixture();try{const j=f.service.prepare(f.input),c=f.service.claim({id:j.id});f.service.stop(f.input.ownerKey);assert.equal(f.service.context(j.id).job.state,'unknown');f.service.record({id:j.id,operationId:c.operation.id,result:result(c,draft)});assert.equal(f.service.context(j.id).job.state,'stopped');assert.throws(()=>f.service.claim({id:j.id}),/STATE|STOP/);}finally{f.close()}
 const g=fixture();try{const j=g.service.prepare(g.input),{revision,...p}=g.p;m.saveApiProfile(g.repo,{profile:{...p,label:'changed'},expectedRevision:revision});assert.throws(()=>g.service.claim({id:j.id}),/PROFILE|REVISION/);assert.equal(g.service.context(j.id).job.operations.length,0);}finally{g.close()}
});
test('transport builds exact provider endpoints and refuses model, usage or identity mismatch',async()=>{
 assert.equal(typeof m.ProviderTextAdapter,'function');const f=fixture();try{const j=f.service.prepare(f.input),c=f.service.claim({id:j.id});let seen;
 const a=new m.ProviderTextAdapter({credential:async()=> 'OFFLINE_FIXTURE_NEVER_REAL',request:async r=>{seen=r;return{status:200,body:{id:'offline-response',model:c.request.modelId,choices:[{finish_reason:'stop',message:{content:JSON.stringify(draft)}}],usage:{prompt_tokens:20,completion_tokens:10,prompt_tokens_details:{cached_tokens:0}}}}}});
 const r=await a.invoke(c.request);assert.equal(seen.url,'https://ark.cn-beijing.volces.com/api/v3/chat/completions');assert.equal(seen.body.stream,false);assert.equal(r.status,'complete');assert.deepEqual(r.usage,{promptTokens:20,completionTokens:10,cachedTokens:0});assert(!JSON.stringify(r).includes('OFFLINE_FIXTURE'));
 const bad={...r,providerModel:'foreign-model'};assert.throws(()=>f.service.record({id:j.id,operationId:c.operation.id,result:bad}),/MODEL|PROOF/);
 }finally{f.close()}
});
test('authorized low-score rewrite is bounded and remains a new immutable version',()=>{
 const f=fixture();try{const j=f.service.prepare(f.input);let c=f.service.claim({id:j.id});let job=f.service.record({id:j.id,operationId:c.operation.id,result:result(c,draft)});
 for(let n=0;n<2;n++){
  c=f.service.claim({id:j.id});const low={revisionId:job.draftId,dimensions:{lyrics:40,style:40,coherence:40},findings:['The phrase "starlight river" needs a stronger emotional progression across the original scene.']};
  job=f.service.record({id:j.id,operationId:c.operation.id,result:result(c,low)});
  if(n===0){assert.equal(job.phase,'rewrite');c=f.service.claim({id:j.id});job=f.service.record({id:j.id,operationId:c.operation.id,result:result(c,{...draft,title:'A new starlight'})});}
 }
 assert.equal(job.state,'rejected');assert.equal(job.versions.length,2);assert.notEqual(job.versions[0].id,job.versions[1].id);assert.equal(job.rewrites,1);assert.equal(job.operations.length,4);assert.throws(()=>f.service.claim({id:j.id}),/STATE/);
 }finally{f.close()}
});
test('invalid model scores may retry only within authorized score retries',()=>{
 const f=fixture();try{const j=f.service.prepare(f.input);let c=f.service.claim({id:j.id});f.service.record({id:j.id,operationId:c.operation.id,result:result(c,draft)});
 for(let n=0;n<2;n++){c=f.service.claim({id:j.id});const job=f.service.record({id:j.id,operationId:c.operation.id,result:result(c,{madeUp:'not a score'})});assert.equal(job.state,n===0?'ready':'rejected');}
 assert.equal(f.service.context(j.id).job.operations.length,3);
 }finally{f.close()}
});
test('the run budget is shared across all items and includes uncertain reservations',()=>{
 const f=fixture();try{
  const budget=6000,plan={...f.plan,text:{...f.plan.text,budgetMicros:budget}};
  f.repo.save('settings',{id:'plan-center:plan:'+plan.id,value:plan});const r=f.repo.get('settings','plan-center:run:'+f.input.runId);r.value.snapshot=plan;f.repo.save('settings',r);
  const a=f.service.prepare({...f.input,budgetMicros:budget});const ca=f.service.claim({id:a.id});assert(ca.operation.reservedMicros<budget);
  const itemId=f.input.runId+':item:2',ownerKey=f.input.runId+':'+itemId+':text_generate:1';
  f.repo.save('settings',{id:'plan-center:item:'+itemId,value:{id:itemId,runId:f.input.runId,planId:plan.id}});f.repo.save('settings',{id:'plan-center:stage:'+ownerKey,value:{id:ownerKey,runId:f.input.runId,itemId,stage:'text_generate',state:'dispatching'}});
  const b=f.service.prepare({...f.input,itemId,ownerKey,budgetMicros:budget});assert.throws(()=>f.service.claim({id:b.id}),/BUDGET/);assert.equal(f.service.context(b.id).job.operations.length,0);
 }finally{f.close()}
});
test('proof rejects rewritten request payload even if its stored hash was recomputed',()=>{
 const f=fixture();try{const j=f.service.prepare(f.input),c=f.service.claim({id:j.id});const job=f.service.record({id:j.id,operationId:c.operation.id,result:result(c,draft)});
 const row=f.repo.get('settings','provider-text:operation:'+c.operation.id);row.value.request.messages[1].content='{"theme":"foreign-theme"}';
 const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
 row.value.requestHash=createHash('sha256').update(canonical(row.value.request)).digest('hex');f.repo.save('settings',row);
 assert.throws(()=>m.verifyProviderTextGeneration(f.repo,job.id,f.input),/PROOF|REQUEST/);
 }finally{f.close()}
});
test('Main credentials isolate providers and Doubao authentication checks never invoke generation',async()=>{
 const f=fixture();try{const requested=[],secrets=new Map();const binding=b=>b.providerId+':'+b.accountId;
 const vault={isAvailable:()=>true,has:b=>secrets.has(binding(b)),put:(b,s)=>secrets.set(binding(b),s),get:b=>{requested.push(binding(b));return secrets.get(binding(b))},delete:b=>secrets.delete(binding(b))};
 let networkCalls=0;const api=new m.ApiCredentials({vault,getProfile:async id=>id===f.p.id?f.p:undefined,context:()=>({mode:'production',generation:1}),textRequest:async()=>{networkCalls++;throw Error('offline')}});
 await api.writeApiCredential({profileId:f.p.id,expectedRevision:1,secret:'OFFLINE_DOUBAO_ONLY'});assert.equal((await api.apiCredentialStatus({profileId:f.p.id})).state,'stored_unverified');
 await assert.rejects(api.checkApiConnection({profileId:f.p.id,expectedRevision:1}),/UNSUPPORTED/);assert.equal(networkCalls,0);
 const j=f.service.prepare(f.input),c=f.service.claim({id:j.id});await api.withProviderTextAdapter({profileId:f.p.id,expectedRevision:1},async adapter=>{await assert.rejects(adapter.invoke({...c.request,providerId:'deepseek'}),/SCOPE|PRICE/);await adapter.invoke(c.request);});
 assert.deepEqual(requested,['doubao:'+f.p.id]);assert.equal(networkCalls,1);
 }finally{f.close()}
});
test('a stop after credential acquisition blocks dispatch and records an uncertain claim',async()=>{
 const f=fixture();try{const j=f.service.prepare(f.input),c=f.service.claim({id:j.id});let requests=0;
 const adapter=new m.ProviderTextAdapter({credential:async()=>{f.service.stop(f.input.ownerKey);return'OFFLINE_ONLY'},request:async()=>{requests++;throw Error('must not send')}});
 const response=await adapter.invoke(c.request,async()=>{const {job}=f.service.context(j.id);if(job.stopRequested)throw Error('TEXT_STOP_REQUESTED');});
 assert.equal(requests,0);assert.equal(response.status,'unknown');
 }finally{f.close()}
});
test('Main pump claims and stores each phase through internal RPC without exposing credentials',async()=>{
 const f=fixture();try{const j=f.service.prepare(f.input);let credentialReads=0;let calls=0;
 const adapter=new m.ProviderTextAdapter({credential:async()=>{credentialReads++;return'OFFLINE_MAIN_SECRET'},request:async req=>{
  calls++;const payload=JSON.parse(req.body.messages[1].content);return{status:200,body:{id:'fixture-'+calls,model:f.p.modelId,usage:{prompt_tokens:20,completion_tokens:10},choices:[{finish_reason:'stop',message:{content:JSON.stringify(payload.revisionId?{revisionId:payload.revisionId,dimensions:{lyrics:90,style:90,coherence:90},findings:['The phrase "starlight river" gives the song a coherent original visual identity.']}:draft)}}]}};
 }});
 const broker=m.createProviderTextBroker({credentials:{apiCredentialStatus:async()=>({configured:true}),withProviderTextAdapter:async(_input,fn)=>fn(adapter)},available:()=>true,generation:()=>1,rpc:async(method,input)=>{const name=method.replace('internal.providerText.','');try{return{ok:true,value:name==='context'?f.service.context(input.id):f.service[name](input)}}catch(e){return{ok:false,error:{code:e.message}}}}});
 assert.equal((await broker.pump()).processed,1);assert.equal((await broker.pump()).processed,1);assert.equal(f.service.context(j.id).job.state,'complete');assert.equal(credentialReads,2);assert.equal(calls,2);assert.equal((await broker.pump()).processed,0);broker.stop();assert.equal((await broker.pump()).processed,0);assert(!JSON.stringify(f.service.list()).includes('OFFLINE_MAIN_SECRET'));
 }finally{f.close()}
});
test('missing credentials are visible and remain resumable without creating an operation',async()=>{
 const f=fixture();try{const j=f.service.prepare(f.input);
 const broker=m.createProviderTextBroker({credentials:{apiCredentialStatus:async()=>({configured:false,state:'absent'}),withProviderTextAdapter:async()=>{throw Error('must not run')}},available:()=>true,rpc:async(method,input)=>{const name=method.replace('internal.providerText.','');return{ok:true,value:f.service[name](input)}}});
 await broker.pump();const job=f.service.context(j.id).job;assert.equal(job.reason,'CREDENTIAL_REQUIRED');assert.equal(job.state,'ready');assert.equal(job.operations.length,0);
 }finally{f.close()}
});
test('fixed transport rejects images, models probes, query strings and alternate hosts before networking',async()=>{
 assert.equal(typeof m.nodeHttpsTransport,'function');
 for(const url of ['https://ark.cn-beijing.volces.com/api/v3/images/generations','https://ark.cn-beijing.volces.com/api/v3/models','https://ark.cn-beijing.volces.com/api/v3/chat/completions?probe=1','https://ark.cn-beijing.volces.com/api/v3/chat/completions#probe','https://ark.cn-beijing.volcengineapi.com/','http://ark.cn-beijing.volces.com/api/v3/chat/completions'])await assert.rejects(m.nodeHttpsTransport({method:'POST',url}),/HTTP_HOST_REJECTED/);
 await assert.rejects(m.nodeHttpsTransport({method:'GET',url:'https://ark.cn-beijing.volces.com/api/v3/chat/completions'}),/HTTP_HOST_REJECTED/);
});
