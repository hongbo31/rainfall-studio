const test=require('node:test'), assert=require('node:assert/strict');
const w=require(process.env.RAINFALL_WORKFLOW_BUNDLE), {draft,config}=require('../fixtures/workflow.cjs');
test('text provider remains unconfigured without inventing service, pricing or model',()=>{
 assert.equal(typeof w.textReadiness,'function');
 const r=w.textReadiness(config());
 for(const reason of ['TEXT_ADAPTER_MISSING','TEXT_MODEL_MISSING','TEXT_LIMITS_MISSING','TEXT_EVIDENCE_MISSING','LIVE_EXECUTION_DISABLED']) assert.ok(r.includes(reason));
 assert.throws(()=>w.TextConfigurationSchema.parse({...config(),secret:'fake'}));
 assert.throws(()=>w.TextConfigurationSchema.parse({...config(),executionEnabled:true}));
 assert.throws(()=>w.TextConfigurationSchema.parse({...config(),endpoint:'https://key:secret@example.com/'}));
});
test('creative structure validates hook references, vocal roles and instrumental absence',()=>{
 assert.equal(typeof w.parseDraft,'function');
 assert.equal(w.parseDraft(draft()).hook.sectionId,'chorus');
 for(const change of [{hook:{sectionId:'missing',startLine:0,endLine:1}},{vocalPlan:[{sectionId:'unknown',voice:'duet'}]},{instrumental:true}]) assert.throws(()=>w.parseDraft({...draft(),...change}));
 const instrumental={...draft(),instrumental:true,sections:[],hook:null,vocalPlan:[]};
 assert.deepEqual(w.parseDraft(instrumental).sections,[]);
});
test('adapter registry only invokes explicitly installed injected protocol and validates output',async()=>{
 assert.equal(typeof w.TextProviderRegistry,'function');
 const registry=new w.TextProviderRegistry();
 await assert.rejects(registry.invoke('missing',{kind:'generate'}),/TEXT_ADAPTER_UNAVAILABLE/);
 registry.register({id:'offline-fixture',source:'fixture',invoke:async()=>({status:'ok',value:draft(),actualCost:1,evidenceId:'fake-cost'})});
 assert.equal((await registry.invoke('offline-fixture',{kind:'generate'})).value.title,draft().title);
 assert.throws(()=>registry.register({id:'offline-fixture',source:'fixture',invoke:async()=>{}}),/DUPLICATE_ADAPTER/);
});
