const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const w=require(process.env.RAINFALL_WORKFLOW_BUNDLE),q=require(process.env.RAINFALL_QUALITY_BUNDLE),{draft}=require('../fixtures/workflow.cjs'),{policy,assessment,levels}=require('../fixtures/quality.cjs');
function setup({mode='simulation',low=false,unknown=false,invalid=false,locked=false}={}){
 assert.equal(typeof w.CreationService,'function');
 const root=path.resolve('output/test-runs','workflow-'+randomUUID());fs.mkdirSync(root,{recursive:true});const repo=new w.Repository(path.join(root,'library.sqlite'));
 const artistId=randomUUID();repo.save('artists',{id:artistId,name:'原创测试',revision:1,defaults:{language:'中文',genre:'民谣'}});
 const registry=new w.TextProviderRegistry();let count=0;
 registry.register({id:'offline-fixture',source:'fixture',invoke:async r=>{count++;if(unknown)return{status:'unknown',actualCost:null};if(r.kind==='generate'||r.kind==='revise')return {status:'ok',actualCost:1,evidenceId:r.operationId,value:invalid?{}:({...draft(),...(locked&&r.kind==='revise'?{sections:[{id:'verse',kind:'verse',lines:['删除了固定内容']}],hook:{sectionId:'verse',startLine:0,endLine:1},vocalPlan:[{sectionId:'verse',voice:'female'}]}:{})})};assert.equal(r.context.pair,undefined);const p=repo.all('drafts').at(-1).pair;return{status:'ok',actualCost:1,evidenceId:r.operationId,value:{...assessment(p,r.context.group,low?levels([2,3,4,4],[2,4,3,4],[3,4,3]):levels(),policy(),r.kind==='review'),sessionId:r.sessionId}};}});
 const service=new w.CreationService(repo,mode,{registry,adapterId:'offline-fixture',policy:policy(),dailyLimit:200});
 const input={requestId:randomUUID(),sessionId:randomUUID(),artistId,expectedRevision:0,instruction:'雨中相识',parentDraftId:null,lockedQuotes:[],profileId:null,seriesId:null,budgetLimit:100};
 return{repo,root,service,input,registry,count:()=>count};
}
test('chat stores immutable drafts, assessments, exact budget and idempotent requests',async()=>{
 const x=setup();try{const t=x.service.begin(x.input);assert.equal(t.state,'queued');await x.service.execute(t.id);const r=x.repo.get('creativeTurns',t.id);assert.equal(r.state,'ready_for_review');assert.equal(x.repo.all('drafts').length,1);assert.equal(x.repo.all('evaluations')[0].decision.state,'pass');assert.equal(x.repo.all('workflowLedger').filter(e=>e.kind==='settle').reduce((n,e)=>n+e.amount,0),4);assert.equal(x.service.balance().reserved,0);assert.equal(x.service.begin(x.input).id,t.id);await x.service.execute(t.id);assert.equal(x.count(),4);assert.throws(()=>x.service.begin({...x.input,instruction:'different'}),/IDEMPOTENCY_CONFLICT/);const stored=x.repo.get('drafts',r.draftId);assert.equal(stored.source,'fixture');assert.equal(stored.pairHash,q.pairHash(stored.pair));}finally{x.repo.close();}
});
test('finite rewrites include invalid format and preserve two total revisions',async()=>{
 for(const invalid of [false,true]){const x=setup({low:true,invalid});try{let t=x.service.begin(x.input);await x.service.execute(t.id);const r=x.repo.get('creativeTurns',t.id);assert.equal(r.revisionCount,2);assert.equal(r.state,'manual');assert.equal(x.repo.all('operations').filter(o=>o.kind==='revise').length,2);assert.ok(x.count()<=21);}finally{x.repo.close();}}
});
test('unknown generation freezes provider across restart and later budget dates without retry',async()=>{
 const x=setup({unknown:true});try{let t=x.service.begin(x.input);await x.service.execute(t.id);assert.equal(x.repo.get('creativeTurns',t.id).state,'reconcile_required');assert.ok(x.service.balance().reserved>0);const restarted=new w.CreationService(x.repo,'simulation',{registry:new w.TextProviderRegistry(),adapterId:'offline-fixture',policy:policy(),now:()=>new Date('2026-10-17T10:00:00Z')});await restarted.execute(t.id);assert.equal(x.count(),1);const n=restarted.begin({...x.input,requestId:randomUUID(),sessionId:randomUUID()});assert.equal(n.state,'blocked');assert.ok(n.reasons.includes('PROVIDER_RISK_FROZEN'));}finally{x.repo.close();}
});
test('production unconfigured turn and insufficient budget send nothing, CAS rejects stale edit',async()=>{
 const x=setup({mode:'production'});try{let t=x.service.begin(x.input);assert.equal(t.state,'blocked');await x.service.execute(t.id);assert.equal(x.count(),0);assert.ok(t.reasons.includes('TEXT_CONFIGURATION_REQUIRED'));}finally{x.repo.close();}
 const y=setup();try{let t=y.service.begin({...y.input,budgetLimit:1});assert.equal(t.state,'blocked');assert.ok(t.reasons.includes('BUDGET_INSUFFICIENT'));assert.equal(y.count(),0);assert.throws(()=>y.service.begin({...y.input,requestId:randomUUID()}),/REVISION_CONFLICT/);}finally{y.repo.close();}
});
test('chat locked text and artist scope cannot silently change',async()=>{
 const x=setup({low:true,locked:true});try{let t=x.service.begin({...x.input,lockedQuotes:['雨滴落在屋檐']});await x.service.execute(t.id);assert.equal(x.repo.get('creativeTurns',t.id).state,'manual');assert.ok(x.repo.get('creativeTurns',t.id).reasons.includes('LOCKED_CONTENT_CHANGED'));assert.throws(()=>x.service.begin({...x.input,artistId:randomUUID(),requestId:randomUUID(),expectedRevision:1}),/ARTIST_SCOPE|NOT_FOUND/);}finally{x.repo.close();}
});
test('review: shared workspace budget includes music risk before text reservation',()=>{
 const x=setup();try{x.service.options.dailyLimit=100;x.repo.save('workflowLedger',{id:randomUUID(),eventKey:'music-risk',scope:'music',date:x.service.now().slice(0,10),unit:'fixture_credit',kind:'reserve',amount:100});const t=x.service.begin(x.input);assert.equal(t.state,'blocked');assert.ok(t.reasons.includes('BUDGET_INSUFFICIENT'));}finally{x.repo.close();}
});
test('review: dispatch rechecks a provider freeze established after two turns queued',async()=>{
 const x=setup({unknown:true});try{const a=x.service.begin(x.input),b=x.service.begin({...x.input,requestId:randomUUID(),sessionId:randomUUID()});await x.service.execute(a.id);await x.service.execute(b.id);assert.equal(x.count(),1);assert.equal(x.repo.get('creativeTurns',b.id).state,'blocked');assert.equal(x.service.balance().reserved,21);}finally{x.repo.close();}
});
test('review: restart between completed calls pauses unfinished turn without resending',async()=>{
 const x=setup();try{const a=x.service.begin(x.input);x.repo.save('creativeTurns',{...a,state:'running'});const restarted=new w.CreationService(x.repo,'simulation',x.service.options);assert.equal(x.repo.get('creativeTurns',a.id).state,'paused');await restarted.execute(a.id);assert.equal(x.count(),0);assert.equal(restarted.balance().reserved,0);assert.equal(restarted.begin({...x.input,requestId:randomUUID(),expectedRevision:1}).state,'queued');}finally{x.repo.close();}
});
test('self review: unapproved policy never authorizes automatic format rewrites',async()=>{
 const x=setup({invalid:true});try{x.service.options.policy=policy(false);const t=x.service.begin(x.input);await x.service.execute(t.id);assert.equal(x.count(),1);assert.equal(x.repo.get('creativeTurns',t.id).state,'shadow');}finally{x.repo.close();}
});
test('self review: locked quote multiplicity survives a directed revision',async()=>{
 const x=setup({low:true});try{const provider=x.registry.get('offline-fixture'),original=provider.invoke;provider.invoke=async r=>{const result=await original(r);if(r.kind==='generate')result.value.sections[0].lines.unshift('雨滴落在屋檐');return result;};const t=x.service.begin({...x.input,lockedQuotes:['雨滴落在屋檐']});await x.service.execute(t.id);const result=x.repo.get('creativeTurns',t.id);assert.equal(result.state,'manual');assert.ok(result.reasons.includes('LOCKED_CONTENT_CHANGED'));assert.equal(result.revisionCount,1);}finally{x.repo.close();}
});
test('self review: unsent text crosses budget day only after a fresh atomic reservation',async()=>{
 const x=setup();try{x.service.options.dailyLimit=100;const t=x.service.begin(x.input),tomorrow=new Date(Date.now()+86400000);x.service.options.now=()=>tomorrow;x.repo.save('workflowLedger',{id:randomUUID(),eventKey:'tomorrow-full',scope:'music',kind:'reserve',amount:100,date:tomorrow.toISOString().slice(0,10),unit:'fixture_credit'});await x.service.execute(t.id);assert.equal(x.count(),0);assert.equal(x.repo.get('creativeTurns',t.id).state,'blocked');}finally{x.repo.close();}
});
