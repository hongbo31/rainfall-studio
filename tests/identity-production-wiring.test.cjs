const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{randomUUID}=require('node:crypto');
const api=require(process.env.RAINFALL_IDENTITY_WIRING_BUNDLE);
function fixture(t,sessionOverride){
 assert.equal(typeof api.createAccountIdentityBroker,'function','production Main identity broker must exist');assert.equal(typeof api.createAccountIdentityBridge,'function','out-of-chain identity reply bridge must exist');
 let available=true,generation=1,connected=false,session='session-one',reads=0,remoteAccountId='610001',remoteArtistId='720002',hold,sessionHold;
 const sessionOwner={async readStableIdentity(){reads++;if(!connected)throw Error('CLOUD_BROWSER_SESSION_REQUIRED');if(hold)await hold;return{provider:'tme',namespace:'tme-musician',remoteAccountId,remoteArtistId,accountDisplayName:'TME fixture',artistDisplayName:'Fixture artist',observedAt:new Date().toISOString(),platformArtists:[],source:{kind:'official-page-own-response',origin:'https://y.tencentmusic.com',path:'/v2/v2/user/getUserInfo',method:'GET'},evidenceHash:'a'.repeat(64),sessionRef:session}},async stableIdentitySessionValid(ref){if(sessionHold)await sessionHold;return connected&&ref===session}};
 let service,broker;const requests=[];
 const bridge=api.createAccountIdentityBridge({postMessage:m=>{requests.push(m);queueMicrotask(async()=>{const captured=generation;try{const value=await broker.provider(m,()=>{if(captured!==generation)throw Error('STALE_CORE_GENERATION')});bridge.accept({kind:'account-identity-result',id:m.id,ok:true,value})}catch(e){bridge.accept({kind:'account-identity-result',id:m.id,ok:false,error:{code:e.message}})}})}},{invalidated:()=>service?.invalidateSessions(),timeoutMs:1000});
 const root=path.resolve('output/identity-production-wiring-20261019/fixture-'+randomUUID());const studio=new api.Studio(root,'production',{accountIdentityAdapter:bridge.adapter});t.after(()=>{bridge.close();studio.close()});service=studio.accountIdentityService();const artistId=studio.all('artists')[0].id,accountId=randomUUID();studio.repo.save('accounts',{id:accountId,provider:'tme',remoteSubject:'preserve-old'});
 broker=api.createAccountIdentityBroker({session:sessionOverride??sessionOwner,available:()=>available,generation:()=>generation,rpc:async(method,input)=>{try{return{ok:true,value:await studio.call(method.replace(/^internal\./,''),input)}}catch(e){return{ok:false,error:{code:e.message}}}}});
 const selection={artistId,accountId,provider:'tme'};
 const bind=async()=>{const p=await broker.ui('start',selection);return broker.ui('confirm',{id:p.id,expectedRevision:p.revision,confirmed:true})};
 return{studio,service,broker,bridge,selection,requests,bind,get reads(){return reads},connect(){connected=true},disconnect(){connected=false;bridge.accept({kind:'account-identity-invalidated'})},disconnectSilently(){connected=false},mismatch(){remoteArtistId='999999'},switchGeneration(){generation++},unavailable(){available=false},hold(){let resolve;hold=new Promise(r=>{resolve=r});return resolve},holdSession(){let resolve;sessionHold=new Promise(r=>{resolve=r});return resolve}};
}
test('explicit existing connection precedes production adapter observation and local confirmation',async t=>{
 const x=fixture(t);assert.equal(x.reads,0);await assert.rejects(x.broker.ui('start',x.selection),/CLOUD_BROWSER_SESSION_REQUIRED/);x.connect();const p=await x.broker.ui('start',x.selection);assert.equal(p.bindingState,'pending_verification');assert.equal(p.loginState,'valid');const n=x.reads;
 const b=await x.broker.ui('confirm',{id:p.id,expectedRevision:p.revision,confirmed:true});assert.equal(b.bindingState,'bound');assert.equal(x.reads,n,'confirm verifies session locally and never reads the official page');assert.equal(x.studio.repo.get('accounts',x.selection.accountId).remoteSubject,'preserve-old');
});
test('production bridge has separate reply lane, rejects identity self-attestation and does not deadlock',async t=>{
 const x=fixture(t);x.connect();for(const extra of [{verified:true},{remoteAccountId:'injected'},{observation:{}},{sessionRef:'injected'}])await assert.rejects(x.broker.ui('start',{...x.selection,...extra}));assert.equal(x.reads,0);
 const b=await x.bind();assert.equal(b.bindingState,'bound');assert(x.requests.some(r=>r.action==='read'));assert(x.requests.some(r=>r.action==='session'));assert.equal(x.bridge.accept({kind:'account-identity-result',id:randomUUID(),ok:true,value:{}}),false);
});
test('disconnect invalidates previously fresh valid state and prevents confirmation',async t=>{
 const x=fixture(t);x.connect();const p=await x.broker.ui('start',x.selection);x.disconnect();assert.equal((await x.broker.ui('get',{id:p.id})).loginState,'unchecked');await assert.rejects(x.broker.ui('confirm',{id:p.id,expectedRevision:p.revision,confirmed:true}),/LOGIN_CHECK_REQUIRED/);
});
test('confirmation checks session liveness even if disconnect notification is delayed',async t=>{
 const x=fixture(t);x.connect();const p=await x.broker.ui('start',x.selection);x.disconnectSilently();
 await assert.rejects(x.broker.ui('confirm',{id:p.id,expectedRevision:p.revision,confirmed:true}),/LOGIN_CHECK_REQUIRED/);
});
function cloudFixture(){
 let connected=true,available=true,closed=false,temporaryClosed=false,reads=0,invalidated=0,wait;const handlers={};
 let visible={artistNames:['Fixture artist'],loadedAccountId:610001,loadedArtistId:720002,loadedArtistName:'Fixture artist',loadedHeadAccountId:610001,loadedHeadArtistId:720002};
 const payload={code:'0',success:true,data:{singerInfo:{accountId:610001,id:720002,name:'Fixture artist',platformInfos:[]},platformIds:{}}};
 const context={pages:()=>temporaryClosed?[primary]:temporary?[primary,temporary]:[primary]};let temporary;
 const response={url:()=> 'https://y.tencentmusic.com/v2/v2/user/getUserInfo',request:()=>({method:()=> 'GET'}),status:()=>200,frame:()=>({page:()=>temporary,url:()=>temporary.url()}),headerValue:async k=>k==='content-type'?'application/json':null,body:async()=>Buffer.from(JSON.stringify(payload))};
 const primary={url:()=> 'https://y.tencentmusic.com/#/user/musician/index',isClosed:()=>closed,context:()=>context,evaluate:async()=>visible,on:(event,fn)=>{handlers['page:'+event]=fn},__offline:{open:async()=>{reads++;temporaryClosed=false;temporary={url:()=> 'https://y.tencentmusic.com/#/user/musician/edit',context:()=>context,evaluate:async()=>visible,waitForResponse:async predicate=>{assert.equal(predicate(response),true);if(wait)await wait;return response},goto:async()=>{},waitForFunction:async()=>{},close:async()=>{temporaryClosed=true}};return temporary}}};
 const browser={contexts:()=>[context],isConnected:()=>connected,on:(event,fn)=>{handlers[event]=fn},close:async()=>{connected=false;handlers.disconnected?.()}};
 const manager=new api.TmeAiCloudSessionManager({enableExistingAlbum:true,connectCDP:async()=>browser,available:()=>available});
 assert.equal(typeof manager.readStableIdentity,'function','Main-only stable reader must be added to existing manager');manager.onIdentityInvalidated(()=>invalidated++);
 return{manager,get reads(){return reads},get invalidated(){return invalidated},swap(){visible={...visible,loadedAccountId:610099,loadedHeadAccountId:610099,loadedArtistId:720099,loadedHeadArtistId:720099}},closePage(){closed=true;handlers['page:close']?.()},switchMode(){available=false},hold(){let resolve;wait=new Promise(r=>{resolve=r});return resolve}};
}
test('existing cloud manager stable identity has explicit connection, epoch checks and local session validation',async()=>{
 const x=cloudFixture();await assert.rejects(x.manager.readStableIdentity(),/CLOUD_BROWSER_SESSION_REQUIRED/);assert.equal(x.reads,0);await x.manager.connect({port:9222,allowConnection:true});const observed=await x.manager.readStableIdentity();assert.equal(observed.remoteAccountId,'610001');assert.equal(observed.remoteArtistId,'720002');assert.equal(await x.manager.stableIdentitySessionValid(observed.sessionRef),true);await x.manager.disconnect();assert.equal(await x.manager.stableIdentitySessionValid(observed.sessionRef),false);assert(x.invalidated>0);
});
test('actual manager through production adapter and Core refuses same-page same-name account swap before confirm',async t=>{
 const cloud=cloudFixture();await cloud.manager.connect({port:9222,allowConnection:true});const x=fixture(t,cloud.manager);cloud.manager.onIdentityInvalidated(()=>x.bridge.accept({kind:'account-identity-invalidated'}));
 const p=await x.broker.ui('start',x.selection);assert.equal(p.bindingState,'pending_verification');const reads=cloud.reads;cloud.swap();
 await assert.rejects(x.broker.ui('confirm',{id:p.id,expectedRevision:p.revision,confirmed:true}),/LOGIN_CHECK_REQUIRED/);
 assert.equal(cloud.reads,reads,'confirm must inspect already loaded state without fresh GET or background page');assert.equal(x.service.execute('get',{id:p.id}).bindingState,'pending_verification');assert.equal(x.service.execute('get',{id:p.id}).loginState,'unchecked');
});
test('malformed session reply cannot promote an error object to a valid login',async()=>{
 let message;const bridge=api.createAccountIdentityBridge({postMessage:m=>{message=m}},{invalidated:()=>{},timeoutMs:1000});
 const check=bridge.adapter.checkSession('opaque-session');bridge.accept({kind:'account-identity-result',id:message.id,ok:true,value:{error:'not-a-valid-session'}});assert.equal(await check,false);bridge.close();
});
test('cloud stable read in flight cannot return identity after page close, disconnect or mode switch',async()=>{
 for(const action of ['closePage','switchMode','disconnect']){const x=cloudFixture();await x.manager.connect({port:9222,allowConnection:true});const release=x.hold(),reading=x.manager.readStableIdentity();await new Promise(r=>setImmediate(r));if(action==='disconnect')await x.manager.disconnect();else x[action]();release();await assert.rejects(reading);assert(x.invalidated>0);}
});
test('restart restores bound mapping as unchecked, then explicit check restores current identity',async t=>{
 const x=fixture(t);x.connect();const b=await x.bind();const restarted=new api.Studio(x.studio.root,'production',{accountIdentityAdapter:x.bridge.adapter});t.after(()=>restarted.close());assert.equal((await restarted.call('accountIdentity.get',{id:b.id})).loginState,'unchecked');assert.equal((await restarted.call('accountIdentity.check',x.selection)).loginState,'valid');
});
test('same-name changed stable artist blocks binding and revoke cannot be undone by recheck',async t=>{
 const x=fixture(t);x.connect();const b=await x.bind();x.mismatch();const r=await x.broker.ui('check',x.selection);assert.equal(r.loginState,'identity_mismatch');assert.equal(r.remoteArtistId,b.remoteArtistId);await x.broker.ui('revoke',{id:b.id,expectedRevision:b.revision});await assert.rejects(x.broker.ui('check',x.selection),/BINDING_REVOKED/);
});
test('workspace/worker change or disconnect during read cannot persist a pending mapping',async t=>{
 for(const action of ['switchGeneration','disconnect','unavailable']){const x=fixture(t);x.connect();const release=x.hold();const reading=x.broker.ui('start',x.selection);await new Promise(r=>setImmediate(r));x[action]();release();await assert.rejects(reading);assert.equal(x.service.execute('list',{}).length,0);}
});
test('one shared-session read cannot leave another account silently valid after identity selection changes',async t=>{
 const x=fixture(t);x.connect();const b=await x.bind(),other=randomUUID();x.studio.repo.save('accounts',{id:other,provider:'tme'});x.mismatch();await x.broker.ui('start',{...x.selection,accountId:other});assert.equal((await x.broker.ui('get',{id:b.id})).loginState,'unchecked');
});
test('changing selection while a read is pending cannot persist the old selection or run concurrent official reads',async t=>{
 const x=fixture(t);x.connect();const other=randomUUID();x.studio.repo.save('accounts',{id:other,provider:'tme'});const release=x.hold();
 const first=x.broker.ui('start',x.selection);first.catch(()=>{});await new Promise(r=>setImmediate(r));
 const second=x.broker.ui('start',{...x.selection,accountId:other});second.catch(()=>{});await new Promise(r=>setImmediate(r));release();await assert.rejects(first,/IDENTITY_SELECTION_CHANGED/);await assert.rejects(second,/IDENTITY_CHECK_BUSY/);
 assert.equal(x.service.execute('list',{}).length,0);assert.equal((await x.broker.ui('start',{...x.selection,accountId:other})).accountId,other);
});
test('selection change during final local-DOM session await cannot persist the previous mapping',async t=>{
 const x=fixture(t);x.connect();const other=randomUUID();x.studio.repo.save('accounts',{id:other,provider:'tme'});const release=x.holdSession();
 const first=x.broker.ui('start',x.selection);first.catch(()=>{});await new Promise(r=>setImmediate(r));
 const second=x.broker.ui('start',{...x.selection,accountId:other});second.catch(()=>{});await new Promise(r=>setImmediate(r));release();
 await assert.rejects(first,/IDENTITY_SELECTION_CHANGED/);await assert.rejects(second,/IDENTITY_CHECK_BUSY/);assert.equal(x.service.execute('list',{}).length,0);
});
test('actual calibrated manager, production adapter and Core confirm unchanged loaded identity and invalidate on disconnect',async t=>{
 const cloud=cloudFixture();await cloud.manager.connect({port:9222,allowConnection:true});const x=fixture(t,cloud.manager);cloud.manager.onIdentityInvalidated(()=>x.bridge.accept({kind:'account-identity-invalidated'}));
 const b=await x.bind();assert.equal(b.bindingState,'bound');assert.equal(b.loginState,'valid');assert.equal(cloud.reads,1);await cloud.manager.disconnect();assert.equal((await x.broker.ui('get',{id:b.id})).loginState,'unchecked');assert.equal(cloud.reads,1);
});
