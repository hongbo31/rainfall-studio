import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
test('published Leave a Light recording cannot create or claim another upload',t=>{
 const x=setup(t),task=x.service.enqueue([{...x.request,title:'留一盏灯'}])[0];assert.equal(task.state,'blocked');assert.equal(task.reason,'PROTECTED_PUBLISHED_WORK');assert.throws(()=>x.service.claim({id:task.id,expectedRevision:task.revision}),/PROTECTED/);
});
const w=createRequire(import.meta.url)('../output/unified-tests/core.cjs');
function setup(t){
 assert.equal(typeof w.UnifiedPublicationService,'function');
 const repo=new w.Repository('output/test-runs/unified-'+randomUUID()+'/db.sqlite');t.after(()=>repo.close());
 let valid=true;const options={verify:()=>{if(!valid)throw Error('MATERIALS_CHANGED')},now:()=>new Date('2026-10-18T10:00:00Z')};
 const service=new w.UnifiedPublicationService(repo,options);
 const request={id:randomUUID(),workId:randomUUID(),title:'New offline song',target:'qqmusic',accountId:randomUUID(),state:'unavailable',summary:'未接通',issues:[],materialSnapshot:{workRevision:1,audio:{sha256:'a'.repeat(64),boundAssetId:randomUUID()},account:{identityHash:'b'.repeat(64)}}};
 return{repo,options,service,request,invalidate:()=>valid=false};
}
test('publish intent combines Tencent targets and survives reordered repeated clicks',t=>{
 const x=setup(t);let tasks=x.service.enqueue([x.request,{...x.request,target:'kugou'}]);assert.equal(tasks.length,1);assert.deepEqual(tasks[0].targets,['kugou','qqmusic']);assert.equal(tasks[0].state,'queued');
 const again=x.service.enqueue([{...x.request,target:'kugou'},x.request]);assert.equal(again[0].id,tasks[0].id);assert.equal(x.service.list().length,1);
});
test('claim is durable and CAS guarded; restart does not replay unfinished dispatch',t=>{
 const x=setup(t),task=x.service.enqueue([x.request])[0];const active=x.service.claim({id:task.id,expectedRevision:task.revision});assert.equal(active.state,'preparing');
 assert.throws(()=>x.service.claim({id:task.id,expectedRevision:task.revision}),/REVISION/);
 const restarted=new w.UnifiedPublicationService(x.repo,x.options);assert.equal(restarted.list()[0].state,'reconcile_required');
 assert.equal(restarted.enqueue([x.request])[0].state,'reconcile_required');assert.throws(()=>restarted.claim({id:task.id,expectedRevision:restarted.list()[0].revision}),/RECONCILIATION/);
});
test('missing materials never dispatch and changed content is reverified before claim',t=>{
 const x=setup(t),missing=x.service.enqueue([{...x.request,state:'needs_materials'}])[0];assert.equal(missing.state,'needs_materials');assert.throws(()=>x.service.claim({id:missing.id,expectedRevision:missing.revision}),/NOT_READY/);
 const y=setup(t),ready=y.service.enqueue([y.request])[0];y.invalidate();assert.throws(()=>y.service.claim({id:ready.id,expectedRevision:ready.revision}),/MATERIALS_CHANGED/);assert.equal(y.service.list()[0].state,'queued');
});
test('changed material cannot create a second dispatch family after preparation starts',t=>{
 const x=setup(t),task=x.service.enqueue([x.request])[0];x.service.claim({id:task.id,expectedRevision:task.revision});
 const again=x.service.enqueue([{...x.request,materialSnapshot:{...x.request.materialSnapshot,cover:{sha256:'d'.repeat(64)}}}]);assert.equal(again[0].id,task.id);assert.equal(x.service.list().length,1);
});
test('published protected work is blocked before native preparation',t=>{
 const x=setup(t),task=x.service.enqueue([{...x.request,title:'把晚安留在门口'}])[0];assert.equal(task.state,'blocked');assert.equal(task.reason,'PROTECTED_PUBLISHED_WORK');assert.throws(()=>x.service.claim({id:task.id,expectedRevision:task.revision}),/PROTECTED/);
});
test('Main updates cannot fabricate a receipt or reset unknown state',t=>{
 const x=setup(t),task=x.service.enqueue([x.request])[0];assert.throws(()=>x.service.update({id:task.id,expectedRevision:task.revision,patch:{state:'published'}}),/RECEIPT/);
 const active=x.service.claim({id:task.id,expectedRevision:task.revision});const unknown=x.service.update({id:task.id,expectedRevision:active.revision,patch:{state:'reconcile_required',reason:'UNKNOWN'}});
 assert.throws(()=>x.service.update({id:task.id,expectedRevision:unknown.revision,patch:{state:'queued'}}),/RECONCILIATION/);
});
test('same recording under another local work cannot bypass an existing claim',t=>{
 const x=setup(t),task=x.service.enqueue([x.request])[0];x.service.claim({id:task.id,expectedRevision:task.revision});
 const duplicate=x.service.enqueue([{...x.request,workId:randomUUID()}])[0];assert.equal(duplicate.id,task.id);assert.equal(x.service.list().length,1);
});
test('existing formal submit intent blocks a new pipeline before preparation',t=>{
 const x=setup(t);x.repo.save('operations',{id:randomUUID(),kind:'tme_ai_submission',phase:'submit',state:'unknown',receiptScope:{sourceAudioSha:'a'.repeat(64)}});
 const task=x.service.enqueue([x.request])[0];assert.equal(task.state,'reconcile_required');assert.throws(()=>x.service.claim({id:task.id,expectedRevision:task.revision}),/RECONCILIATION/);
});
test('read-only reviewed linkage can recover interrupted preparation without a fresh dispatch',t=>{
 const x=setup(t),task=x.service.enqueue([x.request])[0],prepareJobId=randomUUID(),submissionJobId=randomUUID();x.service.claim({id:task.id,expectedRevision:task.revision});
 const restored=new w.UnifiedPublicationService(x.repo,x.options),unknown=restored.byId(task.id);
 assert.equal(typeof restored.linkReviewed,'function');
 assert.throws(()=>restored.linkReviewed({id:task.id,expectedRevision:unknown.revision,prepareJobId,submissionJobId}),/PREPARATION/);
 x.repo.save('settings',{id:'tme-ai-prepare:job:'+prepareJobId,value:{id:prepareJobId,workId:task.workId,state:'awaiting_terms_review',terms:{termsHash:'e'.repeat(64)}}});
 x.repo.save('settings',{id:'tme-ai-submission:'+submissionJobId,value:{id:submissionJobId,workId:task.workId,prepareJobId,state:'reviewed',termsHash:'e'.repeat(64)}});
 const reviewed=restored.linkReviewed({id:task.id,expectedRevision:unknown.revision,prepareJobId,submissionJobId});assert.equal(reviewed.state,'awaiting_confirmation');assert.ok(reviewed.dispatchedAt);assert.throws(()=>restored.claim({id:task.id,expectedRevision:reviewed.revision}),/RECONCILIATION/);
});
test('explicit publish retries a pre-dispatch unavailable capability after it is repaired',t=>{
 const x=setup(t),task=x.service.enqueue([x.request])[0];x.service.update({id:task.id,expectedRevision:task.revision,patch:{state:'blocked',reason:'CLOUD_PREPARE_CONTRACT_UNVERIFIED'}});
 assert.equal(x.service.enqueue([x.request])[0].state,'queued');
});
test('ordinary original music cannot be silently routed through AI authorization',t=>{
 const x=setup(t),task=x.service.enqueue([{...x.request,materialSnapshot:{...x.request.materialSnapshot,ai:'none'}}])[0];assert.equal(task.state,'blocked');assert.equal(task.reason,'AI_PREPARATION_NOT_APPLICABLE');
});
