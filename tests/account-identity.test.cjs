const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const api=require(process.env.RAINFALL_ACCOUNT_IDENTITY_BUNDLE);
function setup(t,{environment='test',withAdapter=true}={}){
 assert.equal(typeof api.AccountIdentityService,'function','independent identity service must exist');
 const root=path.resolve('output/tme-binding-contract-review/test-'+randomUUID());
 const repo=new api.Repository(path.join(root,'state.sqlite'));t.after(()=>repo.db.close());
 let now=new Date('2026-10-19T12:00:00Z');
 const artistId=randomUUID(),otherArtistId=randomUUID(),accountId=randomUUID(),otherAccountId=randomUUID();
 repo.save('artists',{id:artistId,name:'Same stage name'});repo.save('artists',{id:otherArtistId,name:'Same stage name'});
 for(const id of [accountId,otherAccountId])repo.save('accounts',{id,provider:'tme',remoteSubject:'legacy-fingerprint'});
 const oldBinding={id:randomUUID(),artistId,accountId,remoteArtistId:'legacy-local-only'};repo.save('bindings',oldBinding);
 const responses=new Map(),calls=[];
 const observation=id=>({status:'observed',provider:'tme',namespace:'official-tme-musician-v1',remoteAccountId:'remote-account-'+id,remoteArtistId:'remote-artist-'+id,accountDisplayName:'Same account name',artistDisplayName:'Same stage name',observedAt:now.toISOString(),evidenceRef:'official-observation:'+randomUUID(),evidenceHash:'a'.repeat(64),sessionRef:'session:'+id});
 for(const id of [accountId,otherAccountId])responses.set(id,observation(id));
 const adapter={provider:'tme',source:'offline-fixture',contractVersion:'isolated-test-v1',evidenceHash:'b'.repeat(64),read:async input=>{calls.push(input);return responses.get(input.accountId)}};
 const options={environment,now:()=>now,adapters:withAdapter?[adapter]:[]};
 const service=new api.AccountIdentityService(repo,options),start={artistId,accountId,provider:'tme'};
 const bind=async(input=start)=>{const pending=await service.execute('start',input);assert.equal(pending.bindingState,'pending_verification');return service.execute('confirm',{id:pending.id,expectedRevision:pending.revision,confirmed:true});};
 const scope=b=>({bindingId:b.id,bindingRevision:b.revision,artistId:b.artistId,accountId:b.accountId,provider:b.provider,namespace:b.namespace,remoteAccountId:b.remoteAccountId,remoteArtistId:b.remoteArtistId,externalState:'not_started'});
 return{repo,service,options,start,artistId,otherArtistId,accountId,otherAccountId,responses,calls,bind,scope,oldBinding,observation,advance:ms=>{now=new Date(now.getTime()+ms)}};
}
test('default production start/check report missing verified identity adapter without opening sessions',async t=>{
 const x=setup(t,{environment:'production',withAdapter:false});
 for(const action of ['start','check']){const r=await x.service.execute(action,x.start);assert.equal(r.reason,'IDENTITY_ADAPTER_UNVERIFIED');assert.equal(r.bindingState,'unsupported');assert.equal(r.loginState,'unchecked');assert.deepEqual(r.missing,['remoteAccountId','remoteArtistId','officialIdentityContract']);}
 assert.equal(x.calls.length,0);assert.equal(x.service.execute('list',{}).length,0);
});
test('public payload cannot self-attest remote identity, verification, adapter or login state',async t=>{
 const x=setup(t);
 for(const extra of [{verified:true},{bindingState:'bound'},{remoteAccountId:'invented'},{remoteArtistId:'invented'},{observation:x.observation(x.accountId)},{adapter:{}},{loginState:'valid'},{sessionRef:'forged'}])await assert.rejects(x.service.execute('start',{...x.start,...extra}));
 await assert.rejects(x.service.execute('observe',x.observation(x.accountId)),/ACTION_NOT_ALLOWED/);
 assert.equal(x.calls.length,0);assert.equal(x.service.execute('list',{}).length,0);
});
test('trusted complete observation requires explicit mapping confirmation and preserves legacy records',async t=>{
 const x=setup(t),pending=await x.service.execute('start',x.start);
 assert.equal(pending.bindingState,'pending_verification');assert.equal(pending.loginState,'valid');
 assert.throws(()=>x.service.assertPublishScope(x.scope(pending)),/BINDING_NOT_VERIFIED/);
 const bound=await x.service.execute('confirm',{id:pending.id,expectedRevision:pending.revision,confirmed:true});
 assert.equal(bound.bindingState,'bound');assert.equal(bound.loginState,'valid');assert.equal(x.service.assertPublishScope(x.scope(bound)).id,bound.id);
 assert.equal(JSON.stringify(bound).includes('session:'),false);
 assert.deepEqual(x.repo.get('bindings',x.oldBinding.id),x.oldBinding);assert.equal(x.repo.get('accounts',x.accountId).remoteSubject,'legacy-fingerprint');
});
test('partial official identity and fixture adapters in production cannot create a bound record',async t=>{
 const x=setup(t);delete x.responses.get(x.accountId).remoteArtistId;
 const r=await x.service.execute('start',x.start);assert.equal(r.reason,'IDENTITY_ADAPTER_UNVERIFIED');assert.deepEqual(r.missing,['remoteArtistId']);assert.equal(x.service.execute('list',{}).length,0);
 const prod=new api.AccountIdentityService(x.repo,{...x.options,environment:'production'});assert.equal((await prod.execute('start',x.start)).reason,'IDENTITY_ADAPTER_UNVERIFIED');assert.equal(x.calls.length,1);
});
test('publish scope rejects every cross-artist/account/provider/namespace/remote-ID/revision substitution',async t=>{
 const x=setup(t),b=await x.bind(),s=x.scope(b);
 for(const patch of [{artistId:x.otherArtistId},{accountId:x.otherAccountId},{provider:'qqmusic'},{namespace:'another'},{remoteAccountId:'another'},{remoteArtistId:'another'},{bindingRevision:b.revision+1}])assert.throws(()=>x.service.assertPublishScope({...s,...patch}),/IDENTITY_PUBLISH_SCOPE/);
 await assert.rejects(x.service.execute('start',{...x.start,artistId:x.otherArtistId}),/IDENTITY_MAPPING_CONFLICT/);
});
test('relogin with same names and different stable identity blocks original binding until exact identity returns',async t=>{
 const x=setup(t),b=await x.bind();
 x.responses.set(x.accountId,{...x.responses.get(x.accountId),remoteArtistId:'different-same-name'});
 const mismatch=await x.service.execute('check',x.start);assert.equal(mismatch.loginState,'identity_mismatch');assert.equal(mismatch.remoteArtistId,b.remoteArtistId);assert.equal(mismatch.bindingState,'bound');
 assert.throws(()=>x.service.assertPublishScope(x.scope(b)),/LOGIN_IDENTITY_MISMATCH/);
 x.responses.set(x.accountId,x.observation(x.accountId));assert.equal((await x.service.execute('check',x.start)).loginState,'valid');assert.equal(x.service.assertPublishScope(x.scope(b)).id,b.id);
});
test('new service after process restart starts unchecked even if persistent data claims valid',async t=>{
 const x=setup(t),b=await x.bind();
 for(const row of x.repo.all('settings').filter(r=>r.kind==='account-identity-v1'))x.repo.save('settings',{...row,value:{...row.value,loginState:'valid',sessionRef:'forged-persisted-session'}});
 const restarted=new api.AccountIdentityService(x.repo,x.options),stored=restarted.execute('get',{id:b.id});assert.equal(stored.bindingState,'bound');assert.equal(stored.loginState,'unchecked');assert.equal('sessionRef'in stored,false);
 assert.throws(()=>restarted.assertPublishScope(x.scope(b)),/LOGIN_CHECK_REQUIRED/);
 await restarted.execute('check',x.start);assert.equal(restarted.assertPublishScope(x.scope(b)).id,b.id);
});
test('expired account blocks only itself and a fresh independent account remains usable',async t=>{
 const x=setup(t),a=await x.bind(),b=await x.bind({...x.start,accountId:x.otherAccountId});
 x.responses.set(x.accountId,{status:'expired'});assert.equal((await x.service.execute('check',x.start)).loginState,'expired');
 assert.throws(()=>x.service.assertPublishScope(x.scope(a)),/LOGIN_EXPIRED/);assert.equal(x.service.assertPublishScope(x.scope(b)).id,b.id);
});
test('revocation blocks subsequent checking, confirmation and publishing without touching historical intent',async t=>{
 const x=setup(t),b=await x.bind(),op={id:randomUUID(),kind:'tme_ai_submission',state:'unknown',scopeHash:'c'.repeat(64)};x.repo.save('operations',op);
 const revoked=await x.service.execute('revoke',{id:b.id,expectedRevision:b.revision});assert.equal(revoked.bindingState,'revoked');
 await assert.rejects(x.service.execute('check',x.start),/BINDING_REVOKED/);await assert.rejects(x.service.execute('confirm',{id:b.id,expectedRevision:revoked.revision,confirmed:true}),/BINDING_REVOKED/);
 assert.throws(()=>x.service.assertPublishScope({...x.scope(revoked)}),/BINDING_REVOKED/);assert.deepEqual(x.repo.get('operations',op.id),op);
});
test('unknown or dispatched submission requires reconciliation and cannot become a new upload after relogin',async t=>{
 const x=setup(t),b=await x.bind();await x.service.execute('check',x.start);
 for(const state of ['unknown','dispatching','submitted','reviewing','published','rejected'])assert.throws(()=>x.service.assertPublishScope({...x.scope(b),externalState:state}),/RECONCILIATION_REQUIRED/);
 assert.equal(x.repo.all('operations').length,0);
});
test('stale identity observations and stale login checks cannot authorize publication',async t=>{
 const x=setup(t),b=await x.bind();x.advance(300001);assert.equal(x.service.execute('get',{id:b.id}).loginState,'unchecked');assert.throws(()=>x.service.assertPublishScope(x.scope(b)),/LOGIN_CHECK_REQUIRED/);
 await assert.rejects(x.service.execute('check',x.start),/IDENTITY_OBSERVATION_STALE/);assert.equal(x.service.execute('get',{id:b.id}).loginState,'unchecked');
});
test('mapping confirmation is scoped, revision-checked and cannot accept a forged full binding',async t=>{
 const x=setup(t),p=await x.service.execute('start',x.start);
 await assert.rejects(x.service.execute('confirm',{id:p.id,expectedRevision:p.revision,confirmed:true,artistId:x.otherArtistId}));
 await assert.rejects(x.service.execute('confirm',{id:p.id,expectedRevision:p.revision+1,confirmed:true}),/REVISION_CONFLICT/);
 x.advance(300001);await assert.rejects(x.service.execute('confirm',{id:p.id,expectedRevision:p.revision,confirmed:true}),/LOGIN_CHECK_REQUIRED/);
});
test('checking another artist on the same account invalidates previous session validation',async t=>{
 const x=setup(t),first=await x.bind();
 x.responses.set(x.accountId,{...x.observation(x.accountId),remoteArtistId:'second-official-artist'});
 const second=await x.bind({...x.start,artistId:x.otherArtistId});assert.equal(second.loginState,'valid');
 assert.throws(()=>x.service.assertPublishScope(x.scope(first)),/LOGIN_CHECK_REQUIRED/);
 assert.equal(x.service.assertPublishScope(x.scope(second)).id,second.id);
});
test('independent process loading persisted binding has no inherited valid session',()=>{
 const proof=JSON.parse(fs.readFileSync(process.env.RAINFALL_ACCOUNT_IDENTITY_RESTART_PROOF,'utf8'));
 assert.equal(proof.before.loginState,'valid');assert.equal(proof.after.id,proof.before.id);assert.equal(proof.after.loginState,'unchecked');assert.equal(proof.after.bindingState,'bound');assert.equal('sessionRef'in proof.after,false);
});
test('revocation during in-flight observation cannot resurrect the binding',async t=>{
 const x=setup(t),b=await x.bind();let resolve;
 const adapter={...x.options.adapters[0],read:()=>new Promise(r=>{resolve=r})};
 const service=new api.AccountIdentityService(x.repo,{...x.options,adapters:[adapter]});
 const check=service.execute('check',x.start);await service.execute('revoke',{id:b.id,expectedRevision:b.revision});resolve(x.observation(x.accountId));
 await assert.rejects(check,/BINDING_REVOKED/);assert.equal(service.execute('get',{id:b.id}).bindingState,'revoked');
});
