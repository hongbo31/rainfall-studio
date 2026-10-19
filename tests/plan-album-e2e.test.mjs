import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {fixtureIdentity,fixtureNow,planAlbumBrowserFixture} from './fixtures/plan-album-browser.mjs';

const w=createRequire(import.meta.url)(process.env.RAINFALL_PLAN_ALBUM_E2E_BUNDLE??path.resolve('output/album-integration/e2e/integration.cjs'));
let browser;
before(async()=>{browser=await chromium.launch({executablePath:process.env.RAINFALL_TEST_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});});
after(async()=>{await browser?.close();});

async function setup(t,{noResult=false}={}){
 const root=path.resolve('output/album-integration/e2e/runs/'+randomUUID());fs.mkdirSync(root,{recursive:true});
 let currentTime=Date.parse(fixtureNow);
 const filename=path.join(root,'db.sqlite'),subjectHash=w.tmeAiSubjectHash(fixtureIdentity),options={allowFixture:true,now:()=>new Date(currentTime)};
 const state={repo:new w.Repository(filename),observer:null,service:null,center:null,broker:null,transport:null,session:null};
 state.observer=new w.Repository(filename);t.after(()=>{state.observer?.close();state.repo.close();});
 state.center=new w.PlanCenterService(state.repo,{now:options.now});
 const account={id:randomUUID(),provider:'tme',remoteSubject:subjectHash};state.repo.save('accounts',account);
 const artist={id:randomUUID(),name:fixtureIdentity.artistName};state.repo.save('artists',artist);
 const plan=state.center.save({expectedRevision:null,plan:{id:randomUUID(),title:'Headless album integration plan',artistId:artist.id,schedule:{kind:'daily',localTime:'09:00'},count:1,material:{source:'manual'},text:{},music:{route:'manual'},authorization:{publish:true},publishTargets:[{platform:'qqmusic',accountId:account.id,enabled:true,album:{mode:'new',title:'Observed fixture album',description:'Offline integration description'}}]}});
 const trigger=()=>{const preview=state.center.preview({id:plan.id});return state.center.run({id:plan.id,expectedRevision:preview.planRevision,summaryHash:preview.summaryHash,requestId:randomUUID(),source:'debug'});};
 const run=trigger(),target={runId:run.id,platform:'qqmusic',accountId:account.id},calls=[],writeWitness=[];
 const fixture=await planAlbumBrowserFixture(t,{browser,subjectHash,noResult,onCreate:fields=>{
  const operations=state.observer.all('settings').filter(row=>row.id.startsWith('plan-albums:v1:operation:')).map(row=>row.value);
  assert.equal(operations.length,1);const op=operations[0];assert.equal(op.state,'dispatching','A second DB connection must see committed dispatching before browser write');assert.equal(state.repo.db.inTransaction,false);assert.ok(op.authorizationHash);assert.equal(fields.idempotencyKey,op.idempotencyKey);assert.equal(fields.title,op.selection.title);writeWitness.push({operationId:op.id,idempotencyKey:op.idempotencyKey,state:op.state});
 }});
 const accountState={identity:{...fixtureIdentity},binding:fixture.binding,observedAt:fixtureNow};
 function connect(){
  state.service=new w.PlanAlbumService(state.repo,options);
  const readAccount=async()=>({...accountState,observedAt:options.now().toISOString()});
  state.transport=w.createTmeAlbumBrowserTransport({page:fixture.page,account:readAccount,now:options.now,isolatedFixture:true,createContract:fixture.contract});
  state.session={transport:state.transport,account:readAccount};
  const rpc=async(method,input={})=>{
   calls.push({method,input:structuredClone(input)});
   try{
    let value;
    if(method==='internal.planAlbums.scope')value=state.service.scope(input);
    else if(method==='internal.planAlbums.context'){
     const {operation}=state.service.preview(input),savedRun=state.center.list().runs.find(r=>r.id===operation.runId),savedArtist=state.repo.get('artists',savedRun.snapshot.artistId);value={operation,artistName:savedArtist.name};
    }else if(method==='planAlbums.preview')value=state.service.preview(input);
    else{const action=method.replace('internal.planAlbums.','');if(!['recordCatalog','authorize','claim','record','reconcile'].includes(action))throw Error('TEST_RPC_METHOD_NOT_MAPPED');value=state.service[action](input);}
    return{ok:true,value};
   }catch(error){return{ok:false,error:{code:error.message}};}
  };
  state.broker=w.createPlanAlbumBroker({rpc,available:()=>true,generation:()=>1,getSession:scope=>scope.accountId===account.id?state.session:undefined,now:options.now});
 }
 connect();
 const catalog=state.service.recordCatalog({scope:state.service.scope(target),source:'offline-fixture',completeness:'partial',observedAt:fixtureNow,expiresAt:'2026-10-19T11:00:00.000Z',evidenceHash:'b'.repeat(64),entries:[{key:'visible-without-id',id:null,title:'Visible candidate'}]});
 const prepare=()=>state.service.prepareCreate(target),confirm=op=>{const preview=state.service.preview({operationId:op.id});return state.broker.ui('confirm',{operationId:op.id,summaryHash:preview.summaryHash,confirmed:true});};
 const restart=()=>{state.observer.close();state.repo.close();state.repo=new w.Repository(filename);state.observer=new w.Repository(filename);state.center=new w.PlanCenterService(state.repo,{now:options.now});connect();};
 return{state,fixture,target,run,plan,account,accountState,subjectHash,options,catalog,calls,writeWitness,prepare,confirm,trigger,restart,advance:milliseconds=>{currentTime+=milliseconds;}};
}

test('durable Core claim precedes actual browser create; observed ID binds and later run reuses it',async t=>{
 const x=await setup(t),op=x.prepare();assert.equal(op.state,'prepared');assert.equal(x.state.service.bindingForRun(x.target),null);assert.equal(x.catalog.onlineVerified,false);
 x.advance(60000);
 const result=await x.confirm(op);assert.equal(result.state,'succeeded');assert.equal(result.albumId,'fixture-created-plan-album-501');assert.equal(result.source,'offline-fixture');assert.equal(result.onlineVerified,false);assert.equal(await x.fixture.clicks(),1);assert.equal(x.fixture.writes.length,1);assert.equal(x.writeWitness.length,1);
 const methods=x.calls.map(row=>row.method);assert.ok(methods.indexOf('internal.planAlbums.authorize')<methods.indexOf('internal.planAlbums.claim'));assert.ok(methods.indexOf('internal.planAlbums.claim')<methods.indexOf('internal.planAlbums.record'));
 const binding=x.state.service.bindingForRun(x.target);assert.equal(binding.albumId,result.albumId);assert.equal(binding.operationId,op.id);assert.equal(binding.source,'offline-fixture');assert.equal(binding.onlineVerified,false);assert.deepEqual(await x.fixture.fields(),{title:op.selection.title,description:op.selection.description,artistName:fixtureIdentity.artistName,idempotencyKey:op.idempotencyKey});
 x.advance(60000);x.state.center.stop({runId:x.run.id});const next=x.trigger(),nextTarget={...x.target,runId:next.id};assert.notEqual(next.id,x.run.id);assert.equal(x.state.service.bindingForTask(nextTarget).albumId,result.albumId);assert.equal(x.state.service.prepareCreate(nextTarget).id,op.id);assert.equal(x.state.service.status().operations.length,1);assert.equal(await x.fixture.clicks(),1);assert.equal(x.fixture.writes.length,1);
 assert.ok(x.fixture.requests.every(row=>new URL(row.url).origin==='https://plan-album.fixture.invalid'));
});

test('unknown after actual write survives DB/session restart and reconciles only the original key',async t=>{
 const x=await setup(t,{noResult:true}),op=x.prepare();x.advance(60000);const result=await x.confirm(op);assert.equal(result.state,'unknown');assert.equal(await x.fixture.clicks(),1);assert.equal(x.fixture.writes.length,1);assert.equal(x.state.service.bindingForRun(x.target),null);assert.notEqual(result.authorizedAt,op.createdAt);
 x.advance(60000);const sameTransport=await x.state.broker.ui('reconcile',{operationId:op.id});assert.equal(sameTransport.state,'unknown');assert.equal(sameTransport.reason,'ALBUM_ORIGINAL_RESULT_NOT_FOUND');assert.equal(await x.fixture.clicks(),1);
 x.restart();assert.equal(x.state.service.status().operations[0].id,op.id);assert.equal(x.state.service.status().operations[0].state,'unknown');assert.equal(x.prepare().id,op.id);await assert.rejects(x.confirm(op),/ALBUM_RECONCILE_REQUIRED/);
 x.advance(60000);await x.fixture.publishResult({...x.fixture.results[0],idempotencyKey:'some-other-operation'});const unrelated=await x.state.broker.ui('reconcile',{operationId:op.id});assert.equal(unrelated.state,'unknown');assert.equal(x.state.service.bindingForRun(x.target),null);assert.equal(await x.fixture.clicks(),1);
 x.advance(60000);await x.fixture.clearResults();await x.fixture.publishResult(x.fixture.results[0]);const recovered=await x.state.broker.ui('reconcile',{operationId:op.id});assert.equal(recovered.state,'succeeded');assert.equal(recovered.id,op.id);assert.equal(recovered.albumId,'fixture-created-plan-album-501');assert.equal(recovered.source,'offline-fixture');assert.equal(recovered.onlineVerified,false);assert.equal(x.state.service.bindingForRun(x.target).albumId,recovered.albumId);assert.equal(await x.fixture.clicks(),1);assert.equal(x.fixture.writes.length,1);
 const createCalls=x.calls.filter(row=>row.method==='internal.planAlbums.claim');assert.equal(createCalls.length,1);assert.equal(x.calls.filter(row=>row.method==='internal.planAlbums.reconcile').length,3);
});

test('wrong Main account subject cannot authorize or perform a browser create',async t=>{
 const x=await setup(t),op=x.prepare();x.accountState.identity.qqDisplayName='Different bound QQ';await assert.rejects(x.confirm(op),/ACCOUNT_SCOPE_CHANGED/);assert.equal(x.state.service.status().operations[0].state,'prepared');assert.equal(await x.fixture.clicks(),0);assert.equal(x.fixture.writes.length,0);assert.equal(x.calls.filter(row=>row.method==='internal.planAlbums.claim').length,0);assert.equal(x.state.service.bindingForRun(x.target),null);
});
