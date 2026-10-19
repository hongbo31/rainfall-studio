import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const w=createRequire(import.meta.url)(process.env.RAINFALL_PLAN_ALBUMS_BUNDLE);
function setup(t,{allowFixture=false,album={mode:'existing',albumId:'remote-album'},targets}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rainfall-album-core-')),repo=new w.Repository(path.join(root,'db.sqlite'));
 t.after(()=>{repo.close();fs.rmSync(root,{recursive:true,force:true})});
 const account={id:randomUUID(),provider:'tme',remoteSubject:'a'.repeat(64)};repo.save('accounts',account);
 let at='2026-10-19T10:00:00Z',material='material-v1';
 const options={now:()=>new Date(at),allowFixture,materialFingerprint:()=>material};
 const center=new w.PlanCenterService(repo,{now:options.now}),plan=center.save({expectedRevision:null,plan:{id:randomUUID(),title:'Offline album test',artistId:randomUUID(),schedule:{kind:'daily',localTime:'09:00'},count:1,material:{source:'manual'},text:{},music:{route:'manual'},authorization:{publish:true},publishTargets:targets??[{platform:'qqmusic',accountId:account.id,enabled:true,album}]}});
 const trigger=()=>{const p=center.preview({id:plan.id});return center.run({id:plan.id,expectedRevision:p.planRevision,summaryHash:p.summaryHash,requestId:randomUUID(),source:'debug'})};
 const run=trigger(),item=center.list().items[0];
 const service=new w.PlanAlbumService(repo,options),input={runId:run.id,platform:'qqmusic',accountId:account.id};
 const catalog=(changes={})=>service.recordCatalog({scope:service.scope(input),source:'official',completeness:'partial',observedAt:'2026-10-19T10:00:00Z',expiresAt:'2026-10-19T11:00:00Z',evidenceHash:'b'.repeat(64),entries:[{key:'visible',id:'remote-album',title:'Observed album'},{key:'no-id',id:null,title:'Observed without ID'}],...changes});
 const bind=()=>{const c=catalog();return service.selectBinding({...input,catalogId:c.id,entryKey:'visible'})};
 const authorize=op=>{const p=service.preview({operationId:op.id});service.authorize({operationId:op.id,summaryHash:p.summaryHash,confirmed:true});return{operationId:op.id,summaryHash:p.summaryHash}};
 const receipt=(op,changes={})=>service.record({operationId:op.id,status:'succeeded',scope:op.scope,source:'official',albumId:'remote-created',evidenceHash:'c'.repeat(64),...changes});
 return{repo,service,options,center,plan,run,item,account,input,catalog,bind,authorize,receipt,trigger,now:v=>at=v,material:v=>material=v};
}
test('album service exists and persists exact-scope catalog with null remote IDs',t=>{
 assert.equal(typeof w.PlanAlbumService,'function');const x=setup(t),c=x.catalog();assert.equal(c.entries[1].id,null);assert.equal(c.onlineVerified,true);assert.equal(x.service.catalog(x.input).id,c.id);
 const other={id:randomUUID(),provider:'tme',remoteSubject:x.account.remoteSubject};x.repo.save('accounts',other);assert.equal(x.service.catalog({...x.input,accountId:other.id}),null);assert.equal(x.service.catalog({...x.input,platform:'kugou'}),null);
 assert.equal(new w.PlanAlbumService(x.repo,{...x.options,recoverDispatching:false}).catalog(x.input).id,c.id);
});
test('selection requires exact fresh catalog, observed remote ID and snapshot album intent',t=>{
 const x=setup(t),c=x.catalog();assert.throws(()=>x.service.selectBinding({...x.input,catalogId:c.id,entryKey:'no-id'}),/ALBUM_REMOTE_ID_REQUIRED/);
 const binding=x.service.selectBinding({...x.input,catalogId:c.id,entryKey:'visible'});assert.equal(binding.albumId,'remote-album');
 const wrong=x.catalog({entries:[{key:'wrong',id:'different-album',title:'Observed album'}],evidenceHash:'d'.repeat(64)});assert.throws(()=>x.service.selectBinding({...x.input,catalogId:wrong.id,entryKey:'wrong'}),/ALBUM_INTENT_MISMATCH/);
 x.now('2026-10-19T12:00:00Z');assert.throws(()=>x.service.selectBinding({...x.input,catalogId:wrong.id,entryKey:'wrong'}),/ALBUM_CATALOG_EXPIRED/);
});
test('fixtures cannot bind in production and never project online verification',t=>{
 const x=setup(t),c=x.catalog({source:'offline-fixture'});assert.equal(c.onlineVerified,false);assert.throws(()=>x.service.selectBinding({...x.input,catalogId:c.id,entryKey:'visible'}),/ALBUM_OFFICIAL_EVIDENCE_REQUIRED/);
 const y=setup(t,{allowFixture:true}),d=y.catalog({source:'offline-fixture'}),b=y.service.selectBinding({...y.input,catalogId:d.id,entryKey:'visible'});assert.equal(b.onlineVerified,false);
});
test('actual account subject drift invalidates catalog binding and authorization',t=>{
 const x=setup(t);x.bind();const op=x.service.prepareAppend({...x.input,itemId:x.item.id,materialFingerprint:'material-v1'}),claim=x.authorize(op);
 x.repo.save('accounts',{...x.account,remoteSubject:'e'.repeat(64)});assert.equal(x.service.catalog(x.input),null);assert.equal(x.service.bindingForRun(x.input),null);assert.throws(()=>x.service.claim(claim),/ACCOUNT_SCOPE_CHANGED/);
});
test('create claim persists before result, is stable, and cannot dispatch twice',t=>{
 const x=setup(t,{album:{mode:'new',title:'One new album'}}),op=x.service.prepareCreate(x.input);assert.equal(x.service.prepareCreate(x.input).id,op.id);
 const claim=x.authorize(op),claimed=x.service.claim(claim);assert.equal(claimed.state,'dispatching');assert.equal(x.service.status().operations[0].state,'dispatching');assert.throws(()=>x.service.claim(claim),/ALBUM_RECONCILE_REQUIRED/);
 x.receipt(op);assert.equal(x.service.bindingForRun(x.input).albumId,'remote-created');assert.equal(x.service.status().operations[0].onlineVerified,true);
});
test('restart converts dispatching to unknown and only original operation reconciliation resolves it',t=>{
 const x=setup(t,{album:{mode:'new',title:'Crash test'}}),op=x.service.prepareCreate(x.input),claim=x.authorize(op);x.service.claim(claim);
 const restarted=new w.PlanAlbumService(x.repo,x.options);assert.equal(restarted.status().operations[0].state,'unknown');assert.throws(()=>restarted.claim(claim),/ALBUM_RECONCILE_REQUIRED/);assert.equal(restarted.prepareCreate(x.input).id,op.id);
 const result=restarted.reconcile({operationId:op.id,status:'succeeded',scope:op.scope,source:'official',albumId:'after-crash',evidenceHash:'c'.repeat(64)});assert.equal(result.id,op.id);assert.equal(restarted.bindingForRun(x.input).albumId,'after-crash');
});
test('stop prevents new claims but still collects original receipt',t=>{
 const x=setup(t,{album:{mode:'new',title:'Stop test'}}),op=x.service.prepareCreate(x.input),claim=x.authorize(op);x.center.stop({runId:x.run.id});assert.throws(()=>x.service.claim(claim),/STOP_REQUESTED/);
 const y=setup(t,{album:{mode:'new',title:'Already sent'}}),sent=y.service.prepareCreate(y.input);y.service.claim(y.authorize(sent));y.center.stop({runId:y.run.id});y.receipt(sent);assert.equal(y.service.bindingForRun(y.input).albumId,'remote-created');
});
test('append authorization expires on material, catalog or plan revision change',t=>{
 for(const change of [x=>x.material('material-v2'),x=>x.catalog({evidenceHash:'f'.repeat(64)}),x=>x.center.save({plan:{...x.plan,title:'Changed'},expectedRevision:x.plan.revision})]){
  const x=setup(t);x.bind();const op=x.service.prepareAppend({...x.input,itemId:x.item.id,materialFingerprint:'material-v1'}),claim=x.authorize(op);change(x);assert.throws(()=>x.service.claim(claim),/ALBUM_AUTHORIZATION_STALE|ALBUM_MATERIALS_CHANGED|PLAN_REVISION_CHANGED/);
 }
});
test('same TME account conflicting QQ and Kugou intents fail before create',t=>{
 const x=setup(t,{album:{mode:'new',title:'First'}});const row=x.repo.get('settings','plan-center:run:'+x.run.id);row.value.snapshot.publishTargets.push({...row.value.snapshot.publishTargets[0],platform:'kugou',album:{mode:'new',title:'Other'}});x.repo.save('settings',row);
 assert.throws(()=>x.service.prepareCreate(x.input),/ALBUM_FAMILY_INTENT_CONFLICT/);assert.equal(x.service.status().operations.length,0);
});
test('same remote subject across distinct account rows detects TME conflict',t=>{
 const x=setup(t,{album:{mode:'new',title:'First'}}),other={...x.account,id:randomUUID()};x.repo.save('accounts',other);const row=x.repo.get('settings','plan-center:run:'+x.run.id);row.value.snapshot.publishTargets.push({platform:'kugou',accountId:other.id,enabled:true,album:{mode:'existing',albumId:'different'}});x.repo.save('settings',row);assert.throws(()=>x.service.prepareCreate(x.input),/ALBUM_FAMILY_INTENT_CONFLICT/);
});
test('same plan and TME family creates once across sibling targets and later runs',t=>{
 const x=setup(t,{album:{mode:'new',title:'One family'}});const row=x.repo.get('settings','plan-center:run:'+x.run.id);row.value.snapshot.publishTargets.push({...row.value.snapshot.publishTargets[0],platform:'kugou'});x.repo.save('settings',row);
 const op=x.service.prepareCreate(x.input);assert.equal(x.service.prepareCreate({...x.input,platform:'kugou'}).id,op.id);x.service.claim(x.authorize(op));x.receipt(op);assert.equal(x.service.bindingForRun({...x.input,platform:'kugou'}).albumId,'remote-created');
 const runrow=x.repo.get('settings','plan-center:run:'+x.run.id);runrow.value.state='completed';x.repo.save('settings',runrow);const next=x.trigger();assert.equal(x.service.prepareCreate({...x.input,runId:next.id}).id,op.id);assert.equal(x.service.status().operations.length,1);
});
test('claim refuses enclosing transaction and failed receipt never fabricates binding',t=>{
 const x=setup(t,{album:{mode:'new',title:'No rollback'}}),op=x.service.prepareCreate(x.input),claim=x.authorize(op);assert.throws(()=>x.repo.transaction(()=>x.service.claim(claim)),/ALBUM_CLAIM_REQUIRES_STANDALONE_TRANSACTION/);x.service.claim(claim);
 assert.throws(()=>x.receipt(op,{albumId:undefined}),/ALBUM_REMOTE_ID_REQUIRED/);assert.equal(x.service.bindingForRun(x.input),null);x.service.record({operationId:op.id,status:'unknown',scope:op.scope,source:'official',reason:'Transport timed out'});assert.throws(()=>x.service.claim(claim),/ALBUM_RECONCILE_REQUIRED/);
});
test('append success needs original song receipt identity, album and queue provenance',t=>{
 const x=setup(t);x.bind();const op=x.service.prepareAppend({...x.input,itemId:x.item.id,materialFingerprint:'material-v1',publicationTaskId:'original-task',prepareJobId:'original-job'});x.service.claim(x.authorize(op));
 const result={operationId:op.id,status:'succeeded',scope:op.scope,source:'official',albumId:'remote-album',evidenceHash:'c'.repeat(64)};
 assert.throws(()=>x.service.record(result),/ALBUM_SONG_RECEIPT_REQUIRED/);
 const receipt={songId:'song-1',albumId:'remote-album',subjectHash:x.account.remoteSubject,publicationTaskId:'original-task',prepareJobId:'original-job'};
 assert.throws(()=>x.service.record({...result,receipt:{...receipt,subjectHash:'wrong'}}),/ALBUM_RECEIPT_ACCOUNT_SCOPE/);
 assert.throws(()=>x.service.record({...result,receipt:{...receipt,publicationTaskId:'wrong'}}),/ALBUM_RECEIPT_TASK_SCOPE/);
 assert.equal(x.service.record({...result,receipt}).state,'succeeded');assert.equal(x.service.record({...result,receipt}).id,op.id);
});
test('fixture create stays fixture and account drift rejects a late result',t=>{
 const x=setup(t,{allowFixture:true,album:{mode:'new',title:'Fixture create'}}),op=x.service.prepareCreate(x.input);x.service.claim(x.authorize(op));x.receipt(op,{source:'offline-fixture'});assert.equal(x.service.allowsFixture,true);assert.equal(x.service.status().operations[0].onlineVerified,false);assert.equal(x.service.bindingForRun(x.input).onlineVerified,false);
 const y=setup(t,{album:{mode:'new',title:'Old identity'}}),old=y.service.prepareCreate(y.input);y.service.claim(y.authorize(old));y.repo.save('accounts',{...y.account,remoteSubject:'f'.repeat(64)});assert.throws(()=>y.receipt(old),/ACCOUNT_SCOPE_CHANGED/);assert.equal(y.service.status().operations[0].state,'dispatching');
});
test('independent service connections cannot both claim the same authorized write',t=>{
 const x=setup(t,{album:{mode:'new',title:'Race'}}),op=x.service.prepareCreate(x.input),claim=x.authorize(op),repo2=new w.Repository(x.repo.filename);try{const other=new w.PlanAlbumService(repo2,{...x.options,recoverDispatching:false});x.service.claim(claim);assert.throws(()=>other.claim(claim),/ALBUM_RECONCILE_REQUIRED/);assert.equal(other.status().operations.length,1);}finally{repo2.close()}
});
test('re-preparing append with different frozen material never reuses an old authorization',t=>{
 const x=setup(t);x.bind();x.service.prepareAppend({...x.input,itemId:x.item.id,materialFingerprint:'material-v1'});x.material('material-v2');assert.throws(()=>x.service.prepareAppend({...x.input,itemId:x.item.id,materialFingerprint:'material-v2'}),/ALBUM_REQUEST_CHANGED/);
});
test('never-dispatched create intent rebinds a later run and revokes old confirmation while preserving idempotency',t=>{
 for(const authorized of [false,true]){
  const x=setup(t,{album:{mode:'new',title:'Stopped before create'}}),old=x.service.prepareCreate(x.input),oldPreview=x.service.preview({operationId:old.id});if(authorized)x.service.authorize({operationId:old.id,summaryHash:oldPreview.summaryHash,confirmed:true});x.center.stop({runId:x.run.id});const next=x.trigger(),rebased=x.service.prepareCreate({...x.input,runId:next.id});
  assert.equal(rebased.id,old.id);assert.equal(rebased.idempotencyKey,old.idempotencyKey);assert.equal(rebased.runId,next.id);assert.equal(rebased.state,'prepared');assert.equal(rebased.authorizationHash,undefined);const preview=x.service.preview({operationId:rebased.id});assert.notEqual(preview.summaryHash,oldPreview.summaryHash);assert.throws(()=>x.service.claim({operationId:rebased.id,summaryHash:oldPreview.summaryHash}),/ALBUM_AUTHORIZATION_STALE/);x.service.authorize({operationId:rebased.id,summaryHash:preview.summaryHash,confirmed:true});assert.equal(x.service.claim({operationId:rebased.id,summaryHash:preview.summaryHash}).state,'dispatching');
 }
});
