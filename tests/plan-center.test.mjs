import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
const require = createRequire(import.meta.url), w = require(process.env.RAINFALL_PLAN_CENTER_BUNDLE);
function setup(t, options = {}) {
  assert.equal(typeof w.PlanCenterService, 'function', 'unified engine is exported');
  const filename = path.resolve('output/test-runs/plan-center-' + randomUUID(), 'library.sqlite');
  const repo = new w.Repository(filename); t.after(() => repo.close());
  let at = '2026-10-18T00:00:00Z';
  const opts = { now: () => new Date(at), ...options };
  const service = new w.PlanCenterService(repo, opts);
  const plan = { id: randomUUID(), title: '离线计划', artistId: randomUUID(), enabled: true,
    schedule: { kind: 'daily', localTime: '09:00' }, count: 2, theme: '雨天',
    material: { source: 'dot', channel: 'fixture-channel', identity: 'fixture-person' },
    text: { threshold: 75, maxRewrites: 2, maxScoreRetries: 2 },
    music: { route: 'manual', versionPolicy: 'first' }, publishTargets: [],
    catchUp: { mode: 'latest', limit: 1 } };
  return { repo, filename, opts, service, plan, now: s => { at = s; }, save: (changes = {}) => service.save({ plan: { ...plan, ...changes }, expectedRevision: null }) };
}
function trigger(x, p) { const v = x.service.preview({ id: p.id }); return x.service.run({ id: p.id, expectedRevision: v.planRevision, summaryHash: v.summaryHash, requestId: randomUUID(), source: 'manual' }); }
const full = { dot: { available: true }, text: { available: true }, music: { available: true }, publication: { available: true }, albumCatalog: { available: true }, albumCreate: { available: true }, albumAppend: { available: true } };
test('Beijing scheduled occurrence is stable, manual/debug isolated and count means independent items', t => {
  const x = setup(t), p = x.save();
  const r = trigger(x,p); assert.equal(x.service.list().items.length, 2);
  assert.equal(x.service.list().occurrences.length,0); x.service.stop({runId:r.id});
  x.now('2026-10-18T01:00:01Z'); x.service.tick(); x.service.tick();
  const rows=x.service.list(); assert.equal(rows.runs.length,2); assert.equal(rows.occurrences.length,1);
  assert.equal(rows.occurrences[0].intendedAt,'2026-10-18T01:00:00.000Z');
  assert.equal(rows.items.length,4); assert.equal(rows.plans[0].enabled,true);
  assert.equal(rows.runs[1].source,'scheduled'); assert.equal(rows.runs[1].snapshot.count,2);
});
test('weekly and once schedules use local Shanghai calendar and bounded latest catchup', t=> {
  const x=setup(t); x.save({schedule:{kind:'weekly',localTime:'09:00',weekdays:[1]}});
  x.now('2026-10-18T12:00:00Z'); x.service.tick(); assert.equal(x.service.list().runs.length,0);
  x.now('2026-10-19T01:00:01Z'); x.service.tick(); assert.equal(x.service.list().runs.length,1);
  const y=setup(t); y.save({schedule:{kind:'once',localTime:'00:05',date:'2026-10-19'}});
  y.now('2026-10-18T16:05:01Z'); y.service.tick(); assert.equal(y.service.list().occurrences[0].intendedAt,'2026-10-18T16:05:00.000Z');
  const z=setup(t); z.save(); z.now('2026-10-25T01:00:01Z'); z.service.tick();
  assert.equal(z.service.list().occurrences.filter(o=>o.status==='claimed').length,1);
  assert.equal(z.service.list().runs.length,1);
  assert.throws(()=>z.service.save({plan:{...z.plan,id:randomUUID(),catchUp:{mode:'bounded',limit:6}},expectedRevision:null}));
});
test('cross-connection active lock, request idempotency and confirmation revision/hash reject races',t=>{
  const x=setup(t),p=x.save(),v=x.service.preview({id:p.id});
  const repo2=new w.Repository(x.filename);t.after(()=>repo2.close());const other=new w.PlanCenterService(repo2,x.opts);
  const input={id:p.id,expectedRevision:v.planRevision,summaryHash:v.summaryHash,requestId:randomUUID(),source:'manual'};
  const r=x.service.run(input);assert.equal(other.run(input).id,r.id);
  assert.throws(()=>other.run({...input,requestId:randomUUID()}),/ACTIVE_RUN/);
  x.service.stop({runId:r.id});const updated=x.service.save({plan:{...p,title:'changed'},expectedRevision:p.revision});
  assert.throws(()=>other.run({...input,requestId:randomUUID()}),/REVISION_CONFLICT/);
  assert.throws(()=>other.run({...input,expectedRevision:updated.revision,requestId:randomUUID()}),/SUMMARY_CONFLICT/);
});
test('missing real dot port waits honestly; stop leaves future plan enabled',t=>{
  const x=setup(t),p=x.save(),r=trigger(x,p),rows=x.service.list();
  assert.equal(rows.items[0].state,'waiting_external_dot');assert.equal(rows.stageAttempts.length,0);
  assert.equal(x.service.claim({runId:r.id,itemId:rows.items[0].id,stage:'dot'}).state,'waiting_external_dot');
  x.service.stop({runId:r.id});assert.equal(x.service.list().runs[0].state,'stopped');assert.equal(x.service.list().plans[0].enabled,true);
});
test('stopped run refuses new stages but receives in-flight result; versions remain on one item',t=>{
  const x=setup(t,{capabilities:full}),p=x.save(),r=trigger(x,p),i=x.service.list().items[0];
  const a=x.service.claim({runId:r.id,itemId:i.id,stage:'dot'});x.service.stop({runId:r.id});
  assert.throws(()=>x.service.claim({runId:r.id,itemId:i.id,stage:'text_score'}),/STOP_REQUESTED/);
  x.service.record({attemptId:a.id,status:'succeeded',externalTaskId:'dot-fixture',evidenceId:'receipt-fixture',result:{title:'雨',lyrics:'离线',artistId:p.artistId,channel:p.material.channel,identity:p.material.identity,externalItemId:i.expectedExternalItemId}});
  assert.equal(x.service.list().stageAttempts[0].state,'succeeded');assert.equal(x.service.list().runs[0].state,'stopped');
  assert.equal(x.service.list().items.length,2);
});
test('restart makes dispatching unknown and requires evidenced reconciliation before retry',t=>{
  const x=setup(t,{capabilities:full}),p=x.save(),r=trigger(x,p),i=x.service.list().items[0];
  const a=x.service.claim({runId:r.id,itemId:i.id,stage:'dot'});
  const restarted=new w.PlanCenterService(x.repo,x.opts);assert.equal(restarted.list().stageAttempts[0].state,'unknown');
  assert.throws(()=>restarted.retry({attemptId:a.id}),/RECONCILE_REQUIRED/);
  restarted.reconcile({attemptId:a.id,status:'not_found',evidenceId:'trusted-query'});
  assert.equal(restarted.retry({attemptId:a.id}).ordinal,2);
});
test('stage success is immutable and exact dot identity protects item material',t=>{
  const x=setup(t,{capabilities:full}),p=x.save(),r=trigger(x,p),i=x.service.list().items[0],a=x.service.claim({runId:r.id,itemId:i.id,stage:'dot'});
  const result={artistId:p.artistId,channel:p.material.channel,identity:p.material.identity,externalItemId:i.expectedExternalItemId,title:'雨',lyrics:'词'};
  assert.throws(()=>x.service.record({attemptId:a.id,status:'succeeded',evidenceId:'receipt',result:{...result,identity:'wrong'}}),/DOT_IDENTITY_MISMATCH/);
  x.service.record({attemptId:a.id,status:'succeeded',evidenceId:'receipt',result});
  assert.equal(x.service.claim({runId:r.id,itemId:i.id,stage:'dot'}).id,a.id);
  assert.throws(()=>x.service.claim({runId:r.id,itemId:i.id,stage:'dot',requestHash:'f'.repeat(64)}),/REQUEST_HASH_CONFLICT/);
  assert.throws(()=>x.service.record({attemptId:a.id,status:'failed',reason:'late'}),/TERMINAL_ATTEMPT/);
});
test('album binding reuses across runs, unknown does not recreate; material gate isolates platform results',t=>{
  const x=setup(t,{capabilities:full,ports:{albumCatalog:()=>({evidenceId:'catalog',albums:[{id:'real-fixture-album'}]})}});
  const targets=[{platform:'tme',accountId:'fixture-account',enabled:true,album:{mode:'new',title:'雨集'}},{platform:'other',accountId:'other-account',enabled:true,album:{mode:'existing',albumId:'real-fixture-album'}}];
  const p=x.save({publishTargets:targets,authorization:{text:false,music:false,publish:true}}),r=trigger(x,p),i=x.service.list().items[0];
  const b=x.service.claimAlbum({runId:r.id,platform:'tme',accountId:'fixture-account'});
  x.service.recordAlbum({bindingId:b.id,status:'unknown',reason:'timeout'});
  assert.throws(()=>x.service.claimAlbum({runId:r.id,platform:'tme',accountId:'fixture-account'}),/ALBUM_RECONCILE_REQUIRED/);
  x.service.recordAlbum({bindingId:b.id,status:'bound',albumId:'created-fixture',evidenceId:'official-fixture'});
  assert.throws(()=>x.service.claimPublish({runId:r.id,itemId:i.id,platform:'tme',accountId:'fixture-account'}),/MATERIALS_INCOMPLETE/);
  x.service.setMaterials({itemId:i.id,title:'雨',lyrics:'词',coverAssetId:'cover',audioAssetId:'audio-a',rightsEvidenceId:'rights',consistencyEvidenceId:'consistency',selectedVersion:'A'});
  const pa=x.service.claimPublish({runId:r.id,itemId:i.id,platform:'tme',accountId:'fixture-account'});
  x.service.recordPublish({attemptId:pa.id,status:'rejected',evidenceId:'platform-rejection',reason:'fixture-rejected'});
  const pb=x.service.claimPublish({runId:r.id,itemId:i.id,platform:'other',accountId:'other-account'});
  x.service.recordPublish({attemptId:pb.id,status:'submitted',externalId:'submission-fixture',evidenceId:'official-fixture'});
  assert.deepEqual(x.service.list().publishAttempts.map(a=>a.state),['rejected','submitted']);
  x.service.stop({runId:r.id});x.service.recordPublish({attemptId:pb.id,status:'published',externalId:'submission-fixture',evidenceId:'official-published'});
  const r2=trigger(x,p);assert.equal(x.service.claimAlbum({runId:r2.id,platform:'tme',accountId:'fixture-account'}).albumId,'created-fixture');
});
test('existing album needs catalog evidence and append unsupported blocks reuse',t=>{
  const x=setup(t,{capabilities:full}),p=x.save({publishTargets:[{platform:'tme',accountId:'a',enabled:true,album:{mode:'existing',albumId:'handwritten'}}]}),r=trigger(x,p);
  assert.throws(()=>x.service.claimAlbum({runId:r.id,platform:'tme',accountId:'a'}),/ALBUM_CATALOG_UNAVAILABLE/);
});
test('migration retains enabled flags, source rows and histories, with transactional CAS rollback',t=>{
  const x=setup(t);const id=randomUUID(),daily=randomUUID(),flow=randomUUID();
  x.repo.save('plans',{id,enabled:true,title:'legacy',artistId:x.plan.artistId,time:'09:00'});
  const legacyRunId=randomUUID();x.repo.save('runs',{id:legacyRunId,planId:id,date:'2026-10-17',slot:'09:00',state:'completed'});
  x.repo.save('steps',{id:randomUUID(),runId:legacyRunId,state:'succeeded'});
  x.repo.save('dailyPlans',{id:daily,enabled:false,title:'paused',artistId:x.plan.artistId,localTime:'10:00'});
  x.repo.save('settings',{id:'production-flow:plan:'+flow,value:{id:flow,enabled:true,title:'flow',artistId:x.plan.artistId,localTime:'11:00'}});
  const m=x.service.migrateLegacy();assert.equal(m.entries.length,3);assert.equal(x.service.list().plans.filter(p=>p.enabled).length,2);
  assert.equal(m.entries.find(e=>e.kind==='plans').history.steps.length,1);
  assert.equal(w.isLegacyOwned(x.repo,'plans',id),true);assert.equal(x.repo.all('plans').length,1);assert.equal(x.repo.all('runs').length,1);
  assert.equal(x.service.migrateLegacy().entries.length,3);
  x.service.rollbackMigration();assert.equal(x.repo.get('plans',id).enabled,true);assert.equal(w.isLegacyOwned(x.repo,'plans',id),false);assert.equal(x.service.list().plans.length,0);
  x.service.migrateLegacy();x.repo.save('dailyPlans',{...x.repo.get('dailyPlans',daily),title:'concurrent'});
  assert.throws(()=>x.service.rollbackMigration(),/MIGRATION_CONFLICT/);assert.equal(w.isLegacyOwned(x.repo,'plans',id),true);
});
test('executed migrated plan refuses unsafe rollback',t=>{
  const x=setup(t);x.repo.save('plans',{id:randomUUID(),enabled:false,title:'old',artistId:x.plan.artistId});x.service.migrateLegacy();const p=x.service.list().plans[0];trigger(x,p);
  assert.throws(()=>x.service.rollbackMigration(),/MIGRATION_EXECUTED/);
});
test('attachDot reads only current verified local candidates and exact channel artistRef identity',t=>{
  const x=setup(t),p=x.save(),r=trigger(x,p),item=x.service.list().items[0];
  const candidateId=randomUUID(),draftId=randomUUID();
  x.repo.save('settings',{id:'inbox-channel',channel:{id:p.material.channel,artistRefs:{[p.material.identity]:p.artistId}}});
  x.repo.save('drafts',{id:draftId,artistId:p.artistId,draft:{title:'离线雨',sections:[{lines:['测试词']} ]}});
  const candidate={id:candidateId,artistId:p.artistId,draftId,isCurrent:true,externalItemId:item.expectedExternalItemId,source:{channelId:p.material.channel,verification:'local_channel',producerClaim:'untrusted-model'}};
  x.repo.save('textCandidates',candidate);
  assert.equal(typeof x.service.attachDot,'function');
  const a=x.service.attachDot({itemId:item.id,candidateId});assert.equal(a.state,'succeeded');assert.equal(a.result.candidateId,candidateId);
  assert.equal(x.service.attachDot({itemId:item.id,candidateId}).id,a.id);
  assert.equal(x.service.list().items.length,2);
  const i2=x.service.list().items[1];
  assert.throws(()=>x.service.attachDot({itemId:i2.id,candidateId}),/DOT_IDENTITY_MISMATCH/);
  x.repo.save('textCandidates',{...candidate,id:randomUUID(),isCurrent:false});
  const old=x.repo.all('textCandidates').at(-1);assert.throws(()=>x.service.attachDot({itemId:i2.id,candidateId:old.id}),/DOT_CANDIDATE_UNTRUSTED/);
});
test('configuration snapshot, explicit grants and score provenance prevent implicit paid execution',t=>{
  const x=setup(t,{capabilities:full}),p=x.save(),r=trigger(x,p),i=x.service.list().items[0];
  const a=x.service.claim({runId:r.id,itemId:i.id,stage:'dot'});
  x.service.record({attemptId:a.id,status:'succeeded',evidenceId:'dot-receipt',result:{title:'雨',lyrics:'词',artistId:p.artistId,channel:p.material.channel,identity:p.material.identity,externalItemId:i.expectedExternalItemId}});
  assert.equal(x.service.claim({runId:r.id,itemId:i.id,stage:'text_score'}).reason,'TEXT_GRANT_REQUIRED');
  x.service.save({plan:{...p,count:3,title:'new revision'},expectedRevision:p.revision});
  assert.equal(x.service.list().runs[0].snapshot.count,2);assert.equal(x.service.list().runs[0].snapshot.title,'离线计划');
});
test('skip and bounded catchup remain bounded while stop allows next scheduled run',t=>{
  const x=setup(t);x.save({catchUp:{mode:'skip',limit:1}});x.now('2026-10-25T03:00:00Z');x.service.tick();
  assert.equal(x.service.list().runs.length,0);assert.equal(x.service.list().occurrences[0].status,'skipped');
  const y=setup(t);y.save({catchUp:{mode:'bounded',limit:3}});y.now('2026-10-25T01:00:01Z');
  for(let n=0;n<4;n++){y.service.tick();const active=y.service.list().runs.find(r=>!['stopped','completed','failed'].includes(r.state));if(active)y.service.stop({runId:active.id});}
  assert.equal(y.service.list().runs.length,3);
});
test('managed scoring child plans are never reimported as legacy user plans',t=>{
  const x=setup(t);x.repo.save('settings',{id:'production-flow:plan:child',value:{id:'child',enabled:false,managedByPlanCenter:true}});
  assert.equal(x.service.migrateLegacy().entries.length,0);
});
test('generated external IDs satisfy real InboxId contract and item count validates explicit identities',t=>{
  const x=setup(t),p=x.save(),r=trigger(x,p);
  for(const i of x.service.list().items)assert.equal(w.InboxId.safeParse(i.expectedExternalItemId).success,true);
  assert.throws(()=>x.service.save({plan:{...p,id:randomUUID(),material:{...p.material,expectedExternalItemIds:['a']}},expectedRevision:null}),/EXTERNAL_ITEM_COUNT/);
  assert.throws(()=>x.service.save({plan:{...p,id:randomUUID(),material:{...p.material,expectedExternalItemIds:['duplicate','duplicate']}},expectedRevision:null}),/DUPLICATE_EXTERNAL_ITEM/);
});
test('concurrent workers with independent connections atomically claim only one active run',async t=>{
  const x=setup(t),p=x.save(),v=x.service.preview({id:p.id});
  const worker=`const {parentPort,workerData:p}=require('node:worker_threads');require(p.guard);const {Repository,PlanCenterService}=require(process.env.RAINFALL_PLAN_CENTER_BUNDLE);const repo=new Repository(p.filename);try{const s=new PlanCenterService(repo,{now:()=>new Date('2026-10-18T00:00:00Z')});s.run(p.input);parentPort.postMessage('CREATED')}catch(e){parentPort.postMessage(e.message)}finally{repo.close()}`;
  const runWorker=()=>new Promise((resolve,reject)=>{const child=new Worker(worker,{eval:true,workerData:{guard:path.resolve('tests/fixtures/offline-only.cjs'),filename:x.filename,input:{id:p.id,expectedRevision:v.planRevision,summaryHash:v.summaryHash,requestId:randomUUID(),source:'manual'}}});child.on('message',resolve);child.on('error',reject);});
  assert.deepEqual((await Promise.all([runWorker(),runWorker()])).sort(),['ACTIVE_RUN','CREATED']);assert.equal(x.service.list().runs.length,1);
});
test('migration converts original UTC schedule to Beijing while preserving source timezone evidence',t=>{
  const x=setup(t);const id=randomUUID();x.repo.save('plans',{id,title:'utc',artistId:x.plan.artistId,enabled:true,timezone:'Etc/UTC',localTime:'09:00'});
  const m=x.service.migrateLegacy(),p=x.service.list().plans[0];assert.equal(p.schedule.localTime,'17:00');assert.equal(m.entries[0].original.timezone,'Etc/UTC');
});
test('stopping album dispatch keeps unknown operation in reconciliation until evidence settles it',t=>{
  const x=setup(t,{capabilities:full}),p=x.save({publishTargets:[{platform:'tme',accountId:'a',enabled:true,album:{mode:'new',title:'雨集'}}]}),r=trigger(x,p);
  const a=x.service.claimAlbum({runId:r.id,platform:'tme',accountId:'a'});x.service.stop({runId:r.id});assert.equal(x.service.list().runs[0].state,'stopping');
  const restarted=new w.PlanCenterService(x.repo,x.opts);assert.equal(restarted.list().albumBindings[0].state,'unknown');
  assert.equal(restarted.list().runs[0].state,'stopping');
  restarted.recordAlbum({bindingId:a.id,status:'bound',albumId:'fixture',evidenceId:'verified-query'});assert.equal(restarted.list().runs[0].state,'stopped');
});
function scoreable(t,changes={}) {
  const x=setup(t,{capabilities:full}),p=x.save({count:1,authorization:{text:true,music:true,publish:false},text:{profileId:'fixture-text-profile',profileRevision:1,modelId:'deepseek-chat',maxOutputTokens:2048,budgetMicros:10000,consent:true,threshold:75,maxRewrites:2,maxScoreRetries:2},music:{route:'yourmusic',profileId:'fixture-music-profile',profileRevision:1,modelId:'fixture-model',budgetCredits:100,maxCostPerRequestCredits:10,pricingEvidence:'fixture-pricing',consent:true,versionPolicy:'first'},...changes}),r=trigger(x,p),i=x.service.list().items[0];
  const dot=x.service.claim({runId:r.id,itemId:i.id,stage:'dot'});
  x.service.record({attemptId:dot.id,status:'succeeded',evidenceId:'fixture-dot',result:{title:'雨',lyrics:'词',candidateId:'fixture-candidate',artistId:p.artistId,channel:p.material.channel,identity:p.material.identity,externalItemId:i.expectedExternalItemId}});
  return {...x,p,r,i};
}
test('only finite model score for the bound source candidate can complete a score stage',t=>{
  const x=scoreable(t),a=x.service.claim({runId:x.r.id,itemId:x.i.id,stage:'text_score'});
  assert.throws(()=>x.service.record({attemptId:a.id,status:'succeeded',evidenceId:'rule',result:{source:'rules',score:99,candidateId:'fixture-candidate'}}),/MODEL_SCORE_REQUIRED/);
  assert.throws(()=>x.service.record({attemptId:a.id,status:'succeeded',evidenceId:'nan',result:{source:'model',score:NaN,candidateId:'fixture-candidate'}}),/MODEL_SCORE_REQUIRED/);
  assert.throws(()=>x.service.record({attemptId:a.id,status:'succeeded',evidenceId:'other',result:{source:'model',score:90,candidateId:'other-candidate'}}),/SCORE_CANDIDATE_MISMATCH/);
  x.service.record({attemptId:a.id,status:'succeeded',evidenceId:'model-operation',result:{source:'model',score:80,candidateId:'fixture-candidate'}});
  assert.equal(x.service.list().stageAttempts.at(-1).state,'succeeded');
});
test('saved targets with publish disabled finish after local materials without waiting for publication',t=>{
  const x=scoreable(t,{publishTargets:[{platform:'tme',accountId:'fixture',enabled:true,album:{mode:'new',title:'雨集'}}]});
  const score=x.service.claim({runId:x.r.id,itemId:x.i.id,stage:'text_score'});x.service.record({attemptId:score.id,status:'succeeded',evidenceId:'model',result:{source:'model',score:80,candidateId:'fixture-candidate'}});
  const m=x.service.claim({runId:x.r.id,itemId:x.i.id,stage:'materials'});x.service.record({attemptId:m.id,status:'succeeded',evidenceId:'local-materials',result:{prepared:true}});
  assert.equal(x.service.list().runs[0].state,'completed');assert.equal(x.service.list().publishAttempts.length,0);
});
test('A/B are versions on one Item and first/manual policy validates selected audio identity',t=>{
  const x=scoreable(t,{outputs:{lyrics:true,cover:false,music:true}}),base={runId:x.r.id,itemId:x.i.id};
  const score=x.service.claim({...base,stage:'text_score'});x.service.record({attemptId:score.id,status:'succeeded',evidenceId:'model',result:{source:'model',score:85,candidateId:'fixture-candidate'}});
  const submit=x.service.claim({...base,stage:'music_submit'});x.service.record({attemptId:submit.id,status:'succeeded',evidenceId:'fixture-submit',externalTaskId:'fixture-job',result:{accepted:true}});
  const assets=x.service.claim({...base,stage:'music_assets'});x.service.record({attemptId:assets.id,status:'succeeded',evidenceId:'fixture-assets',result:{versions:[{version:'A',assetId:'audio-a'},{version:'B',assetId:'audio-b'}]}});
  assert.equal(x.service.list().items.length,1);assert.equal(x.service.list().items[0].versions.length,2);
  const materials={itemId:x.i.id,title:'雨',lyrics:'词',coverAssetId:'cover',audioAssetId:'audio-b',rightsEvidenceId:'rights',consistencyEvidenceId:'consistency',selectedVersion:'B'};
  assert.throws(()=>x.service.setMaterials(materials),/VERSION_POLICY_FIRST/);
  assert.throws(()=>x.service.setMaterials({...materials,selectedVersion:'A'}),/AUDIO_VERSION_MISMATCH/);
  x.service.setMaterials({...materials,selectedVersion:'A',audioAssetId:'audio-a'});
});
test('append unavailable blocks a persisted binding without creating another album',t=>{
  let append=true;const x=setup(t,{capabilities:()=>({...full,albumAppend:{available:append}})}),p=x.save({publishTargets:[{platform:'tme',accountId:'a',enabled:true,album:{mode:'new',title:'雨集'}}]}),r=trigger(x,p);
  const b=x.service.claimAlbum({runId:r.id,platform:'tme',accountId:'a'});x.service.recordAlbum({bindingId:b.id,status:'bound',albumId:'verified-fixture-album',evidenceId:'fixture-evidence'});
  append=false;assert.throws(()=>x.service.claimAlbum({runId:r.id,platform:'tme',accountId:'a'}),/ALBUM_APPEND_UNSUPPORTED/);assert.equal(x.service.list().albumBindings.length,1);
});
test('passed rewritten revision becomes final material and immutable original dot evidence remains',t=>{
  const x=scoreable(t),a=x.service.claim({runId:x.r.id,itemId:x.i.id,stage:'text_score'}),evaluationRunId=randomUUID();
  const original=x.service.list().items[0].material;
  const draft=require('./fixtures/workflow.cjs').draft();draft.title='改写后的雨';draft.sections[0].lines=['改写之后的新歌词','另一行经过修订的词'];
  const candidate=w.flowCandidate({id:evaluationRunId,plan:{theme:'雨'},revisionCount:1},draft,'deepseek-api',{providerModel:'deepseek-chat'});
  const assessment={revisionId:candidate.id,dimensions:{lyrics:85,style:85,coherence:85},overall:85,findings:['引用歌词后给出的具体模型评价与建议'],threshold:75,passed:true,source:'model-scored',calibration:'not_human_calibrated'};
  const evaluation={id:evaluationRunId,state:'completed',artistId:x.p.artistId,inboxCandidateId:'fixture-candidate',plan:{managedByPlanCenter:true,managedOwnerKey:a.id},candidate,score:assessment,revisionCount:1};
  x.repo.save('settings',{id:'production-flow:run:'+evaluationRunId,value:evaluation});
  x.repo.save('drafts',{id:candidate.id,artistId:x.p.artistId,source:'inbox-evaluation',evaluationRunId,draft,pair:candidate.pair});
  const record={attemptId:a.id,status:'succeeded',evidenceId:'fixture-model-operation',result:{source:'model',score:85,candidateId:'fixture-candidate',evaluationRunId,evaluatedDraftId:candidate.id,assessment,rewriteCount:1}};
  assert.throws(()=>x.service.record({...record,result:{...record.result,assessment:{...assessment,revisionId:randomUUID()}}}),/SCORE_PROOF_MISMATCH/);
  x.service.record(record);
  const material=x.service.list().items[0].material;
  assert.equal(material.title,'改写后的雨');assert.ok(material.lyrics.includes('改写之后的新歌词'));assert.equal(material.finalDraftId,candidate.id);
  assert.deepEqual(material.originalDot,original);assert.equal(material.candidateId,original.candidateId);assert.equal(material.coverRefreshRequired,true);
});
test('publication material schema accepts full length song lyrics',()=>{
  assert.equal(w.PlanCenterMaterialsSchema.safeParse({itemId:'fixture',title:'雨',lyrics:'离线歌词'.repeat(500),coverAssetId:'cover',audioAssetId:'audio',rightsEvidenceId:'rights',consistencyEvidenceId:'consistency',selectedVersion:'A'}).success,true);
});
test('an older failed attempt cannot bypass reconciliation of its newer unknown retry',t=>{
  const x=setup(t,{capabilities:full}),p=x.save(),r=trigger(x,p),i=x.service.list().items[0];
  const first=x.service.claim({runId:r.id,itemId:i.id,stage:'dot'});x.service.record({attemptId:first.id,status:'failed',evidenceId:'fixture-definitive-failure'});
  const second=x.service.retry({attemptId:first.id});x.service.record({attemptId:second.id,status:'unknown',reason:'timeout'});
  assert.throws(()=>x.service.retry({attemptId:first.id}),/RECONCILE_REQUIRED/);assert.equal(x.service.list().stageAttempts.length,2);
});
