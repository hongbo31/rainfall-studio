import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
const api=createRequire(import.meta.url)(process.env.RAINFALL_PLAN_MODEL_BUNDLE);
const at='2026-10-19T12:00:00.000Z';
const later='2026-10-20T12:00:00.000Z';
const modelIds=['chirp-v6','chirp-v6-wild','chirp-v6-mini'];
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rainfall-plan-models-'));
 const file=path.join(dir,'fixture.sqlite'),repo=new api.Repository(file);
 t.after(()=>{repo.close();fs.rmSync(dir,{recursive:true,force:true});});
 const profile={id:randomUUID(),kind:'music',providerId:'yourmusic',label:'offline fixture',modelId:'chirp-v6',executionEnabled:false,revision:1};
 repo.save('settings',{...profile,id:'api-profile:'+profile.id});
 let generation=1,mode='production',response={status:200,body:page()},transport;
 const calls=[];
 const vault=new api.CredentialVault(path.join(dir,'synthetic-vault'),{isEncryptionAvailable:()=>true,encryptString:plain=>Buffer.from(plain),decryptString:bytes=>bytes.toString()});
 vault.put({accountId:profile.id,providerId:'yourmusic',remoteSubject:'local-profile:'+profile.id},'SYNTHETIC_OFFLINE_KEY');
 const options={vault,getProfile:async id=>{const p=repo.maybe('settings','api-profile:'+id);return p?{...p,id}:undefined;},context:()=>({mode,generation}),connectionRequest:async input=>{calls.push(input);return transport?transport(input):response;}};
 const credentials=new api.ApiCredentials(options);
 return {repo,file,profile,credentials,options,calls,vault,identity:{profileId:profile.id,expectedRevision:1},setResponse:r=>response=r,setTransport:fn=>transport=fn,changeWorkspace:()=>generation++,generation:()=>generation,setMode:value=>mode=value};
}
function page(data=[]){return {data,total:data.length,page:1,size:20,total_pages:data.length?1:0};}
function evidence(profile,models=['chirp-v6'],time=at){return {profileId:profile.id,profileRevision:profile.revision,providerId:'yourmusic',source:'yourmusic_history',scope:'historical_success_only',range:{page:1,size:20},observedAt:time,expiresAt:new Date(Date.parse(time)+86400000).toISOString(),models:models.map(modelId=>({modelId,status:'account-observed-success'}))};}
function required(name){assert.equal(typeof api[name],'function',name+' is implemented');}
test('contract catalogue shows all installed models and retained source without account proof',t=>{
 required('planModelCatalog');const x=fixture(t),catalog=api.planModelCatalog(x.repo,at);
 assert.deepEqual(catalog.map(m=>m.modelId),modelIds);
 for(const m of catalog){assert.equal(m.contractStatus,'contract-supported');assert.equal(m.accountStatus,'unknown');assert.equal(m.verified,false);assert.equal(m.currentAvailability,'unknown');assert.equal(m.contract.document,'docs/integrations/yourmusic-contract-2026-10-16.json');assert.equal(m.contract.version,'1.0.0');assert.match(m.contract.checkedAt,/^2026-10-16/);assert.equal(m.evidence,null);}
 x.repo.db.prepare('DELETE FROM settings').run();assert.equal(api.planModelCatalog(x.repo,at).length,3);assert.equal(api.planModelCatalog(x.repo,at)[0].profileId,null);
});
test('profile scoped model successes persist, expire and never assert current permissions',t=>{
 required('recordPlanModelEvidence');const x=fixture(t);
 api.recordPlanModelEvidence(x.repo,{evidence:evidence(x.profile)},at);
 assert.equal(api.planModelCatalog(x.repo,at)[0].accountStatus,'account-observed-success');
 const reopened=new api.Repository(x.file);try{assert.equal(api.planModelCatalog(reopened,at)[0].accountStatus,'account-observed-success');}finally{reopened.close();}
 assert.equal(api.planModelCatalog(x.repo,later)[0].accountStatus,'stale');
 assert.equal(api.planModelCatalog(x.repo,later)[1].accountStatus,'unknown');
 assert.equal(api.planModelCatalog(x.repo,later)[0].verified,false);
 x.repo.save('settings',{...x.profile,revision:2,id:'api-profile:'+x.profile.id});assert.equal(api.planModelCatalog(x.repo,at)[0].accountStatus,'unknown');
 assert.throws(()=>api.recordPlanModelEvidence(x.repo,{evidence:evidence(x.profile)},at),/REVISION_CONFLICT/);
});
test('internal evidence rejects injection, future/invalid TTL and other provider/profile data',t=>{
 required('recordPlanModelEvidence');const x=fixture(t),e=evidence(x.profile);
 for(const raw of [{evidence:{...e,secret:'leak'}},{evidence:{...e,models:[{modelId:'invented',status:'account-observed-success'}]}},{evidence:{...e,expiresAt:'2099-01-01T00:00:00.000Z'}},{evidence:{...e,observedAt:later,expiresAt:'2026-10-21T12:00:00.000Z'}},{evidence:{...e,providerId:'suno'}},{evidence:{...e,profileId:randomUUID()}}])assert.throws(()=>api.recordPlanModelEvidence(x.repo,raw,at));
 assert.equal(x.repo.all('settings').length,1);
});
test('real ApiCredentials reads only fixed history GET and projects successful known models safely',async t=>{
 assert.equal(typeof api.ApiCredentials.prototype.readMusicModelEvidence,'function');const x=fixture(t);
 x.setResponse({status:200,body:page([{id:'PRIVATE_SONG_ID',status:'succeeded',model_name:'chirp-v6',title:'PRIVATE_TITLE',lyric:'PRIVATE_LYRICS',created_at:at},{id:'pending',status:'processing',model_name:'chirp-v6-wild'},{id:'unknown',status:'succeeded',model_name:'some-other-engine'},{id:'duplicate',status:'succeeded',model_name:'chirp-v6'}])});
 const result=await x.credentials.readMusicModelEvidence(x.identity);
 assert.deepEqual(result.range,{page:1,size:20});
 assert.deepEqual(result.models,[{modelId:'chirp-v6',status:'account-observed-success'}]);
 assert.equal(result.profileRevision,1);assert.equal(result.scope,'historical_success_only');assert.equal(Date.parse(result.expiresAt)-Date.parse(result.observedAt),86400000);
 assert.equal(x.calls.length,1);assert.equal(x.calls[0].method,'GET');assert.equal(x.calls[0].url,'https://api.yourmusic.fun/v1/music/generations/history?page=1&size=20');assert.equal(x.calls[0].body,undefined);
 assert.equal(x.calls[0].headers.Authorization,'Bearer SYNTHETIC_OFFLINE_KEY');assert.equal(typeof x.calls[0].assertActive,'function');
 for(const text of ['PRIVATE_SONG_ID','PRIVATE_TITLE','PRIVATE_LYRICS','SYNTHETIC_OFFLINE_KEY'])assert.equal(JSON.stringify(result).includes(text),false);
});
test('authentication success and pending/failed/absent model observations grant no model proof',async t=>{
 assert.equal(typeof api.ApiCredentials.prototype.readMusicModelEvidence,'function');const x=fixture(t);
 for(const data of [[],[{id:'a',status:'pending',model_name:'chirp-v6'}],[{id:'a',status:'failed',model_name:'chirp-v6'}],[{id:'a',status:'succeeded'}]]){x.setResponse({status:200,body:page(data)});assert.deepEqual((await x.credentials.readMusicModelEvidence(x.identity)).models,[]);}
});
test('strict bounded history schema refuses malformed, extra, oversized and mismatched page data',async t=>{
 assert.equal(typeof api.ApiCredentials.prototype.readMusicModelEvidence,'function');const x=fixture(t);
 for(const body of [{data:[]},{...page(),size:1},{...page(),extra:'unexpected'},page([{id:'a',status:'succeeded',model_name:7}]),page([{id:'a',status:'succeeded',extra:'unexpected'}]),page(Array.from({length:21},(_,i)=>({id:String(i),status:'succeeded',model_name:'chirp-v6'}))),{...page(),total:-1}]){x.setResponse({status:200,body});await assert.rejects(x.credentials.readMusicModelEvidence(x.identity),/MODEL_EVIDENCE_INVALID_RESPONSE/);}
});
test('no credentials, wrong revision, wrong mode or provider refuse before transport',async t=>{
 assert.equal(typeof api.ApiCredentials.prototype.readMusicModelEvidence,'function');const x=fixture(t);
 await assert.rejects(x.credentials.readMusicModelEvidence({...x.identity,expectedRevision:2}),/REVISION_CONFLICT/);
 x.setMode('simulation');await assert.rejects(x.credentials.readMusicModelEvidence(x.identity),/SIMULATION_CREDENTIALS_DISABLED/);x.setMode('production');
 x.repo.save('settings',{...x.profile,providerId:'suno',id:'api-profile:'+x.profile.id});await assert.rejects(x.credentials.readMusicModelEvidence(x.identity),/PROVIDER_NOT_CONFIGURED/);
 x.repo.save('settings',{...x.profile,id:'api-profile:'+x.profile.id});x.vault.delete({accountId:x.profile.id,providerId:'yourmusic',remoteSubject:'local-profile:'+x.profile.id});await assert.rejects(x.credentials.readMusicModelEvidence(x.identity),/CREDENTIAL_NOT_CONFIGURED/);
 assert.equal(x.calls.length,0);
});
test('Main broker stores only internally read evidence and bad refresh preserves last cache',async t=>{
 required('createPlanModelBroker');required('recordPlanModelEvidence');const x=fixture(t),rpcs=[];
 const broker=api.createPlanModelBroker({credentials:x.credentials,available:()=>true,generation:x.generation,rpc:async(method,input)=>{rpcs.push({method,input});return {ok:true,value:api.recordPlanModelEvidence(x.repo,input)};}});
 x.setResponse({status:200,body:page([{id:'a',status:'succeeded',model_name:'chirp-v6'}])});await broker.ui('refresh',x.identity);
 assert.equal(rpcs[0].method,'internal.planCenter.recordModelEvidence');assert.equal(api.planModelCatalog(x.repo)[0].accountStatus,'account-observed-success');
 const before=JSON.stringify(x.repo.all('settings'));
 for(const response of [{status:200,body:{unexpected:'invalid'}},{status:401,body:{secret:'do not expose'}},{status:500,body:{lyric:'do not expose'}}]){x.setResponse(response);await assert.rejects(broker.ui('refresh',x.identity),/MODEL_EVIDENCE_/);assert.equal(JSON.stringify(x.repo.all('settings')),before);}
 await assert.rejects(broker.ui('refresh',{...x.identity,evidence:evidence(x.profile)}));assert.equal(rpcs.length,1);
});
test('workspace or revision changes while history is in flight cannot write a cache',async t=>{
 required('createPlanModelBroker');const x=fixture(t);let writes=0;
 const broker=api.createPlanModelBroker({credentials:x.credentials,available:()=>true,generation:x.generation,rpc:async()=>{writes++;return {ok:true,value:[]};}});
 x.setTransport(async()=>{x.changeWorkspace();return {status:200,body:page([{id:'a',status:'succeeded',model_name:'chirp-v6'}])};});
 await assert.rejects(broker.ui('refresh',x.identity),/WORKSPACE_CHANGED/);assert.equal(writes,0);
 x.setTransport(async()=>{x.repo.save('settings',{...x.profile,revision:2,id:'api-profile:'+x.profile.id});return {status:200,body:page()};});
 await assert.rejects(broker.ui('refresh',x.identity),/REVISION_CONFLICT/);assert.equal(writes,0);
});
test('broker checks workspace immediately before RPC even for independently safe credentials',async()=>{
 required('createPlanModelBroker');let generation=1,writes=0;const profile={id:randomUUID(),revision:1};
 const broker=api.createPlanModelBroker({available:()=>true,generation:()=>generation,credentials:{readMusicModelEvidence:async()=>{generation++;return evidence(profile);}},rpc:async()=>{writes++;return {ok:true,value:[]};}});
 await assert.rejects(broker.ui('refresh',{profileId:profile.id,expectedRevision:1}),/WORKSPACE_CHANGED/);assert.equal(writes,0);
});
test('observations disclose fixed sample range and caches retain only safe projected model facts',async t=>{
 const x=fixture(t);x.setResponse({status:200,body:page([{id:'PRIVATE_ID',status:'succeeded',model_name:'chirp-v6',title:'PRIVATE_TITLE',lyric:'PRIVATE_LYRIC'}])});
 const result=await x.credentials.readMusicModelEvidence(x.identity);assert.deepEqual(result.range,{page:1,size:20});
 api.recordPlanModelEvidence(x.repo,{evidence:result});
 const saved=x.repo.all('settings').filter(r=>r.id.startsWith('plan-model-evidence:'));assert.equal(saved.length,1);
 assert.deepEqual(Object.keys(saved[0]).sort(),['evidence','id']);
 assert.deepEqual(Object.keys(saved[0].evidence).sort(),['expiresAt','models','observedAt','profileId','profileRevision','providerId','range','scope','source']);
 for(const secret of ['PRIVATE_ID','PRIVATE_TITLE','PRIVATE_LYRIC','SYNTHETIC_OFFLINE_KEY'])assert.equal(JSON.stringify(saved).includes(secret),false);
 const bad={...result,range:{page:2,size:20}};assert.throws(()=>api.recordPlanModelEvidence(x.repo,{evidence:bad}));
});
test('contract source and supported models remain consistent with retained checked-in contract',t=>{
 const x=fixture(t),contract=JSON.parse(fs.readFileSync('docs/integrations/yourmusic-contract-2026-10-16.json','utf8'));
 const catalog=api.planModelCatalog(x.repo,at);assert.deepEqual(catalog.map(m=>m.modelId),contract.models);
 assert.equal(catalog[0].contract.source,contract.contractSource);assert.equal(catalog[0].contract.checkedAt,contract.checkedAt);assert.equal(catalog[0].contract.version,contract.contractVersion);
});
test('empty later observations and older delayed successes cannot erase newer model success',t=>{
 const x=fixture(t),newAt='2026-10-19T12:01:00.000Z';
 api.recordPlanModelEvidence(x.repo,{evidence:evidence(x.profile,['chirp-v6'],newAt)},newAt);
 api.recordPlanModelEvidence(x.repo,{evidence:evidence(x.profile)},newAt);
 api.recordPlanModelEvidence(x.repo,{evidence:evidence(x.profile,[],newAt)},newAt);
 assert.equal(api.planModelCatalog(x.repo,newAt)[0].evidence.observedAt,newAt);
 const second={...x.profile,id:randomUUID()};x.repo.save('settings',{...second,id:'api-profile:'+second.id});
 assert.equal(api.planModelCatalog(x.repo,newAt).find(m=>m.profileId===second.id).accountStatus,'unknown');
});
function managedCredentials(x,hook){return new api.ApiCredentials({...x.options,invalidateMusicModelEvidence:hook??(async identity=>api.invalidatePlanModelEvidence(x.repo,identity))});}
function binding(x){return {accountId:x.profile.id,providerId:'yourmusic',remoteSubject:'local-profile:'+x.profile.id};}
test('same profile key replacement invalidates A observations before using B and empty B history cannot revive A',async t=>{
 const x=fixture(t),credentials=managedCredentials(x);
 x.setResponse({status:200,body:page([{id:'a',status:'succeeded',model_name:'chirp-v6'}])});
 api.recordPlanModelEvidence(x.repo,{evidence:await credentials.readMusicModelEvidence(x.identity)});
 assert.equal(api.planModelCatalog(x.repo)[0].accountStatus,'account-observed-success');
 await credentials.writeApiCredential({...x.identity,secret:'SYNTHETIC_B'});
 assert.equal(x.vault.get(binding(x)),'SYNTHETIC_B');assert.equal(api.planModelCatalog(x.repo)[0].accountStatus,'unknown');
 x.setResponse({status:200,body:page()});api.recordPlanModelEvidence(x.repo,{evidence:await credentials.readMusicModelEvidence(x.identity)});
 assert.equal(api.planModelCatalog(x.repo)[0].accountStatus,'unknown');assert.equal(x.calls.at(-1).headers.Authorization,'Bearer SYNTHETIC_B');
});
test('clear invalidates every revision of only its profile and rejects stale identity before deleting cache',async t=>{
 const x=fixture(t),other={...x.profile,id:randomUUID()},credentials=managedCredentials(x);
 x.repo.save('settings',{...other,id:'api-profile:'+other.id});
 api.recordPlanModelEvidence(x.repo,{evidence:evidence(x.profile)},at);api.recordPlanModelEvidence(x.repo,{evidence:evidence(other)},at);
 const old=x.repo.all('settings').find(r=>r.id.startsWith('plan-model-evidence:'+x.profile.id+':'));
 x.repo.save('settings',{...old,id:old.id.replace(':1:yourmusic:',':99:yourmusic:')});
 required('invalidatePlanModelEvidence');assert.throws(()=>api.invalidatePlanModelEvidence(x.repo,{...x.identity,expectedRevision:2}),/REVISION_CONFLICT/);
 await credentials.clearApiCredential(x.identity);
 assert.equal(x.vault.has(binding(x)),false);assert.equal(api.planModelCatalog(x.repo,at)[0].accountStatus,'unknown');
 assert.equal(x.repo.all('settings').filter(r=>r.id.startsWith('plan-model-evidence:'+x.profile.id+':')).length,0);
 assert.equal(api.planModelCatalog(x.repo,at).find(m=>m.profileId===other.id).accountStatus,'account-observed-success');
});
test('cache invalidation failure blocks write and clear while retaining old key and old cache',async t=>{
 const x=fixture(t),credentials=managedCredentials(x,async()=>{throw Error('FIXTURE_INVALIDATION_FAILED');});
 api.recordPlanModelEvidence(x.repo,{evidence:evidence(x.profile)},at);
 for(const [method,input] of [['writeApiCredential',{...x.identity,secret:'SYNTHETIC_B'}],['clearApiCredential',x.identity]]){
  await assert.rejects(credentials[method](input),/FIXTURE_INVALIDATION_FAILED/);
  assert.equal(x.vault.get(binding(x)),'SYNTHETIC_OFFLINE_KEY');assert.equal(api.planModelCatalog(x.repo,at)[0].accountStatus,'account-observed-success');
 }
});
test('workspace and revision changes during cache invalidation prevent vault write and clear',async t=>{
 for(const method of ['writeApiCredential','clearApiCredential']){
  const x=fixture(t),credentials=managedCredentials(x,async identity=>{api.invalidatePlanModelEvidence(x.repo,identity);x.changeWorkspace();});
  await assert.rejects(credentials[method]({...x.identity,...(method==='writeApiCredential'?{secret:'SYNTHETIC_B'}:{})}),/WORKSPACE_CHANGED/);
  assert.equal(x.vault.get(binding(x)),'SYNTHETIC_OFFLINE_KEY');
  const revised=managedCredentials(x,async()=>{x.repo.save('settings',{...x.profile,revision:2,id:'api-profile:'+x.profile.id});});
  await assert.rejects(revised[method]({...x.identity,...(method==='writeApiCredential'?{secret:'SYNTHETIC_B'}:{})}),/REVISION_CONFLICT/);
  assert.equal(x.vault.get(binding(x)),'SYNTHETIC_OFFLINE_KEY');
 }
});
test('broker retains credential lock until cache write finishes so a delayed A observation cannot outlive B replacement',async t=>{
 const x=fixture(t);let invalidations=0;
 const credentials=managedCredentials(x,async identity=>{invalidations++;api.invalidatePlanModelEvidence(x.repo,identity);});
 let entered,release;const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
 x.setResponse({status:200,body:page([{id:'a',status:'succeeded',model_name:'chirp-v6'}])});
 const broker=api.createPlanModelBroker({credentials,available:()=>true,generation:x.generation,rpc:async(method,input)=>{entered();await gate;return {ok:true,value:api.recordPlanModelEvidence(x.repo,input)};}});
 const refresh=broker.ui('refresh',x.identity);await started;
 const write=credentials.writeApiCredential({...x.identity,secret:'SYNTHETIC_B'});
 await new Promise(resolve=>setImmediate(resolve));
 try{assert.equal(x.vault.get(binding(x)),'SYNTHETIC_OFFLINE_KEY');assert.equal(invalidations,0);}finally{release();}
 await refresh;await write;assert.equal(api.planModelCatalog(x.repo)[0].accountStatus,'unknown');
});
