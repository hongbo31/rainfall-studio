import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {build} from 'esbuild';

const buildRoot=path.resolve('output/provider-plan-bridge-tests',randomUUID());
fs.mkdirSync(buildRoot,{recursive:true});
await build({stdin:{contents:`export {Repository} from './src/core/database'; export {PlanCenterService} from './src/core/plan-center'; export {PlanCenterPlanSchema,PlanCenterStageSchema} from './src/shared/plan-center'; export {Studio} from './src/core/studio'; export {tickPlanCenter} from './src/core/plan-center-integration'; export {ProviderTextService} from './src/core/provider-text'; export {providerPlanFinal} from './src/core/provider-plan-text';`,resolveDir:process.cwd()},outfile:path.join(buildRoot,'bridge.cjs'),bundle:true,platform:'node',format:'cjs',packages:'external'});
const require=createRequire(import.meta.url);
require(path.resolve('tests/fixtures/offline-only.cjs'));
const w=require(path.join(buildRoot,'bridge.cjs'));
const {draft}=require('./fixtures/workflow.cjs');
function setup(t){
 const repo=new w.Repository(path.join(buildRoot,randomUUID(),'library.sqlite'));t.after(()=>repo.close());
 const service=new w.PlanCenterService(repo,{capabilities:{text:{available:true}}});
 const plan={id:randomUUID(),artistId:randomUUID(),title:'Provider fixture',theme:'A song about the rain',enabled:false,schedule:{kind:'daily',localTime:'09:00'},material:{source:'provider',channel:'',identity:''},text:{consent:false,threshold:75,maxRewrites:2,maxScoreRetries:2},music:{route:'manual',consent:false},authorization:{text:false,music:false,publish:false}};
 return{repo,service,plan,save:()=>service.save({plan,expectedRevision:null})};
}
test('provider plan is accepted without granting any paid execution and waits at generation',t=>{
 const x=setup(t);const plan=x.save();
 assert.equal(plan.material.source,'provider');assert.equal(plan.authorization.text,false);
 const preview=x.service.preview({id:plan.id});
 const run=x.service.run({id:plan.id,expectedRevision:plan.revision,summaryHash:preview.summaryHash,requestId:randomUUID(),source:'manual'});
 const next=x.service.next({runId:run.id});
 assert.equal(next.stage,'text_generate');assert.equal(next.state,'blocked');assert.equal(next.reason,'TEXT_GRANT_REQUIRED');
 assert.equal(x.service.list().stageAttempts.length,0);
});
function studioFixture(t,changes={}){
 const s=new w.Studio(path.join(buildRoot,'studio-'+randomUUID()),'production');t.after(()=>s.close());
 const profileId=randomUUID(),artistId=s.all('artists')[0].id;
 s.save('settings',{id:'api-profile:'+profileId,kind:'text',providerId:'doubao',label:'Offline fixture text',revision:1,modelId:'fixture-doubao',executionEnabled:false,textPricing:{currency:'CNY',modelId:'fixture-doubao',inputMicrosPerMillionTokens:1000,outputMicrosPerMillionTokens:1000,source:'offline fixture only',version:'fixture-v1',responseModelIds:['fixture-doubao']}});
 const center=s.planCenterService();
 const plan=center.save({plan:{id:randomUUID(),artistId,title:'Offline provider bridge',theme:'quiet rain in the city',styleTemplate:'warm acoustic pop',enabled:false,schedule:{kind:'daily',localTime:'09:00'},outputs:{lyrics:true,cover:true,music:false},material:{source:'provider'},text:{profileId,profileRevision:1,budgetMicros:100000,maxOutputTokens:2048,consent:true,threshold:75,maxRewrites:2,maxScoreRetries:1},music:{route:'manual'},authorization:{text:true,music:false,publish:false},...changes},expectedRevision:null});
 const preview=center.preview({id:plan.id}),run=center.run({id:plan.id,expectedRevision:plan.revision,summaryHash:preview.summaryHash,requestId:randomUUID(),source:'manual'});
 const text=new w.ProviderTextService(s.repo,{recover:false});
 w.tickPlanCenter(s);return{s,center,plan,run,item:()=>center.list().items.find(i=>i.runId===run.id),text,job:()=>text.list()[0]};
}
function response(claim,content){return{operationId:claim.operation.id,providerId:claim.job.providerId,requestedModelId:claim.job.modelId,status:'complete',providerRequestId:'fixture-'+claim.operation.id,providerModel:claim.job.modelId,finishReason:'stop',httpStatus:200,usage:{promptTokens:100,completionTokens:200,cachedTokens:0},content:JSON.stringify(content),reason:null};}
function generate(x,change={}){const c=x.text.claim({id:x.job().id});assert.ok(['generate','rewrite'].includes(c.job.phase));return x.text.record({id:c.job.id,operationId:c.operation.id,result:response(c,{...draft(),...change})});}
function score(x,level=85){const c=x.text.claim({id:x.job().id});assert.equal(c.job.phase,'score');const quote=c.job.pair.lyrics.split('\n').find(l=>l.length>=4&&!l.startsWith('['));return x.text.record({id:c.job.id,operationId:c.operation.id,result:response(c,{revisionId:c.job.draftId,dimensions:{lyrics:level,style:level,coherence:level},findings:['[lyrics] "'+quote+'" creates a concrete scene and supports the intended narrative clearly.']})});}
test('provider lyrics wait for a real cover, then resume from a verified studio import',async t=>{
 const x=studioFixture(t);assert.equal(x.text.list().length,1);assert.equal(x.s.all('textCandidates').length,0);
 generate(x);w.tickPlanCenter(x.s);score(x);w.tickPlanCenter(x.s);w.tickPlanCenter(x.s);
 const item=x.item(),run=x.center.list().runs.find(r=>r.id===x.run.id);
 assert.equal(x.job().state,'complete');assert.equal(run.state,'waiting');assert.equal(item.reason,'COVER_REQUIRED');assert.ok(item.workId);
 assert.equal(x.s.get('works',item.workId).assets.cover,undefined);assert.equal(x.s.all('textCandidates').length,0);
 const proof=w.providerPlanFinal(x.s.repo,run,item);assert.equal(proof.job.id,x.job().id);assert.equal(proof.scoreOperation.phase,'score');
 assert.equal(x.center.list().stageAttempts.some(a=>a.stage==='dot'),false);
 w.tickPlanCenter(x.s);assert.equal(x.center.list().stageAttempts.filter(a=>a.stage==='cover').length,1);assert.equal(x.text.list().length,1);
 const request=await x.s.call('cover.request',{workId:item.workId,requestId:randomUUID(),brief:'Offline fixture actual bitmap'});
 const file=path.join(buildRoot,randomUUID()+'.png');
 await require('sharp')({create:{width:512,height:512,channels:3,background:'teal'}}).png().toFile(file);
 const receipt=await x.s.coverHandoff().receiveFile(file,item.workId,request.id,'image');
 await x.s.call('work.selectAsset',{workId:item.workId,role:'cover',assetId:receipt.assetId});
 w.tickPlanCenter(x.s);w.tickPlanCenter(x.s);
 assert.equal(x.center.list().runs.find(r=>r.id===x.run.id).state,'completed');
 assert.equal(x.text.list().length,1);assert.equal(x.s.all('operations').length,0);
});
test('directory runs are durable and idempotent while public manual API rejects directory source',t=>{
 const x=setup(t),plan=x.save(),v=x.service.preview({id:plan.id}),input={id:plan.id,expectedRevision:plan.revision,summaryHash:v.summaryHash,requestId:'directory:'+randomUUID()};
 assert.throws(()=>x.service.run({...input,source:'directory'}));
 const run=x.service.runDirectory(input);assert.equal(run.source,'directory');assert.equal(x.service.runDirectory(input).id,run.id);
 assert.equal(x.service.list().runs.length,1);
});
test('provider proof starts one managed music child and preserves stop and unknown submission barriers',async t=>{
 const musicProfileId=randomUUID();
 const x=studioFixture(t,{outputs:{lyrics:true,cover:false,music:true},music:{route:'yourmusic',profileId:musicProfileId,profileRevision:1,modelId:'chirp-v6',budgetCredits:20,maxCostPerRequestCredits:10,creditPolicy:{mode:'existing_credits',noRecharge:true,actualCostUnknown:true,consent:true},consent:true},authorization:{text:true,music:true,publish:false}});
 x.s.save('settings',{id:'api-profile:'+musicProfileId,kind:'music',providerId:'yourmusic',label:'Offline music fixture',revision:1,modelId:'chirp-v6',executionEnabled:false});
 generate(x);w.tickPlanCenter(x.s);score(x);w.tickPlanCenter(x.s);w.tickPlanCenter(x.s);
 const flow=x.s.productionFlowService(),children=flow.list().runs;
 assert.equal(children.length,1);assert.equal(children[0].managedProviderText.providerJobId,x.job().id);assert.equal(children[0].inboxCandidateId,undefined);
 const child=children[0];assert.ok(child.workId);const n=flow.next({id:child.id});assert.equal(n.task.type,'music_submit');
 const c=flow.claim({id:child.id,expectedRevision:n.run.revision});assert.equal(c.task.type,'music_submit');
 assert.equal(c.operation.costState,'reserved');
 w.tickPlanCenter(x.s);assert.equal(flow.list().runs.length,1);
 await x.s.call('planCenter.stop',{runId:x.run.id});
 assert.throws(()=>flow.claim({id:child.id,expectedRevision:flow.context(child.id).run.revision}),/FLOW_TASK_BUSY|MANAGED_MUSIC_STOPPED/);
 flow.record({id:child.id,operationId:c.operation.id,result:{type:'music_submit',status:'unknown',reason:'OFFLINE_UNKNOWN',confirmedUnsent:false}});
 w.tickPlanCenter(x.s);assert.equal(flow.context(child.id).run.state,'unknown');
 assert.equal(x.center.list().stageAttempts.find(a=>a.stage==='music_submit').state,'unknown');
 assert.equal(x.s.all('operations').filter(o=>o.taskType==='music_submit').length,1);
 assert.throws(()=>x.center.retry({attemptId:x.center.list().stageAttempts.find(a=>a.stage==='music_submit').id}),/RECONCILE_REQUIRED|STOP_REQUESTED/);
});
test('provider final proof rejects edits to the persisted score operation and wrong item ownership',t=>{
 const x=studioFixture(t,{outputs:{lyrics:true,cover:false,music:false}});generate(x);w.tickPlanCenter(x.s);score(x);w.tickPlanCenter(x.s);
 const item=x.item(),run=x.center.list().runs.find(r=>r.id===x.run.id);assert.equal(run.state,'running');
 assert.throws(()=>w.providerPlanFinal(x.s.repo,run,{...item,id:'another-item'}),/PROVIDER/);
 const key='provider-text:operation:'+x.job().scoreOperationId,row=x.s.repo.get('settings',key);
 x.s.repo.save('settings',{...row,value:{...row.value,requestHash:'f'.repeat(64)}});
 assert.throws(()=>w.providerPlanFinal(x.s.repo,run,item),/TEXT_PROOF_OPERATION_SCOPE/);
});
test('a prepared provider generation resumes after restart when no external operation was ever claimed',t=>{
 const x=studioFixture(t);const jobId=x.job().id,root=x.s.root;x.s.close();
 const reopened=new w.Studio(root,'production');t.after(()=>reopened.close());
 const jobs=new w.ProviderTextService(reopened.repo,{recover:false});
 assert.equal(reopened.planCenterService().list().stageAttempts.find(a=>a.stage==='text_generate').state,'unknown');
 w.tickPlanCenter(reopened);
 assert.equal(jobs.list().length,1);assert.equal(jobs.list()[0].id,jobId);
 assert.doesNotThrow(()=>jobs.claim({id:jobId}));
});
test('an interrupted local generation claim without a provider job can prepare once after restart',t=>{
 const x=studioFixture(t),job=x.job(),bindingKey='provider-plan:binding:'+x.item().id;
 x.s.repo.db.prepare('DELETE FROM settings WHERE id IN (?,?)').run('provider-text:job:'+job.id,bindingKey);
 const root=x.s.root;x.s.close();const reopened=new w.Studio(root,'production');t.after(()=>reopened.close());
 w.tickPlanCenter(reopened);const jobs=new w.ProviderTextService(reopened.repo,{recover:false});
 assert.equal(jobs.list().length,1);assert.doesNotThrow(()=>jobs.claim({id:jobs.list()[0].id}));
});
test('provider bounded rewrite preserves one owner and final lyrics and prompt from the same revision',t=>{
 const x=studioFixture(t,{outputs:{lyrics:true,cover:false,music:false}});const owner=x.job().ownerKey;
 generate(x);w.tickPlanCenter(x.s);score(x,30);w.tickPlanCenter(x.s);
 const revised={...draft(),title:'Rewritten provider fixture'};revised.sections[0].lines[0]='A rewritten original phrase beneath the amber city lights';revised.musicPrompts.yourmusic.positiveStyle='restrained acoustic guitar and intimate female vocal';
 generate(x,revised);w.tickPlanCenter(x.s);score(x);w.tickPlanCenter(x.s);
 const final=x.item().material.finalRevision;assert.equal(final.title,revised.title);assert.match(final.lyrics,/rewritten original phrase/);assert.equal(final.musicPrompt,revised.musicPrompts.yourmusic.positiveStyle);
 assert.equal(x.text.list().length,1);assert.equal(x.job().ownerKey,owner);assert.equal(x.job().versions.length,2);
 assert.equal(x.center.list().stageAttempts.filter(a=>a.stage==='text_generate').length,1);assert.equal(x.center.list().stageAttempts.filter(a=>a.stage==='text_score').length,1);
});
test('independent briefs differ and a duplicate draft must be rewritten even when it passes scoring',t=>{
 const x=studioFixture(t,{count:2,distinctLyrics:true,outputs:{lyrics:true,cover:false,music:false}});
 const [first,second]=x.text.list().sort((a,b)=>a.itemId.localeCompare(b.itemId));
 assert.notEqual(first.theme,second.theme);
 assert.match(second.theme,/同批第 2 首/);
 generate({...x,job:()=>first});w.tickPlanCenter(x.s);
 assert.equal(score({...x,job:()=>first}).state,'complete');
 w.tickPlanCenter(x.s);
 generate({...x,job:()=>second});w.tickPlanCenter(x.s);
 const duplicate=score({...x,job:()=>second});
 assert.equal(duplicate.phase,'rewrite');assert.equal(duplicate.reason,'TEXT_BATCH_DUPLICATE');
 const revised=draft();
 revised.title='Last ferry home';revised.storyBeat='An empty deck under a single yellow lamp';
 revised.sections=revised.sections.map(s=>({...s,lines:s.lines.map(line=>'Midnight ferry: '+line)}));
 generate({...x,job:()=>second},revised);w.tickPlanCenter(x.s);
 assert.equal(score({...x,job:()=>second}).state,'complete');w.tickPlanCenter(x.s);
 const item=x.center.list().items.find(i=>i.id===second.itemId);
 assert.equal(item.material.finalRevision.title,revised.title);
 assert.equal(x.text.context(second.id).job.versions.length,2);
});
test('provider generation stage is distinct and stopped provider run cannot claim a new stage',t=>{
 const x=setup(t);assert.equal(w.PlanCenterStageSchema.parse('text_generate'),'text_generate');
 const plan=x.save(),preview=x.service.preview({id:plan.id});
 const run=x.service.run({id:plan.id,expectedRevision:plan.revision,summaryHash:preview.summaryHash,requestId:randomUUID(),source:'manual'});
 x.service.stop({runId:run.id});const item=x.service.list().items[0];
 assert.throws(()=>x.service.claim({runId:run.id,itemId:item.id,stage:'text_generate'}),/STOP_REQUESTED/);
});
test('provider generation cannot succeed with fabricated stage evidence',t=>{
 const x=setup(t),profileId=randomUUID();
 x.repo.save('settings',{id:'api-profile:'+profileId,kind:'text',providerId:'deepseek',revision:1,modelId:'deepseek-flash'});
 x.plan.text={...x.plan.text,profileId,profileRevision:1,modelId:'deepseek-flash',budgetMicros:100000,consent:true};x.plan.authorization.text=true;
 const plan=x.save(),preview=x.service.preview({id:plan.id});const run=x.service.run({id:plan.id,expectedRevision:plan.revision,summaryHash:preview.summaryHash,requestId:randomUUID(),source:'manual'}),item=x.service.list().items[0];
 const a=x.service.claim({runId:run.id,itemId:item.id,stage:'text_generate'});
 assert.throws(()=>x.service.record({attemptId:a.id,status:'succeeded',evidenceId:'fake-generation',result:{source:'provider',providerJobId:'missing'}}),/PROVIDER/);
 assert.notEqual(x.service.list().stageAttempts[0].state,'succeeded');
});
