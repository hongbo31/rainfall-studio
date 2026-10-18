import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const outfile=path.resolve('output/cloud-session-tests/manager.cjs');
await build({entryPoints:['src/main/tme/ai-cloud-session.ts'],outfile,bundle:true,platform:'node',format:'cjs',packages:'external'});
const {TmeAiCloudSessionManager,validateCloudCdpEndpoint}=createRequire(import.meta.url)(outfile);
function fixture(options={}){
 const state={connected:true,closed:false,connects:0,disconnects:0,url:'https://y.tencentmusic.com/#/user/manage/aiChoose/add',values:{kg:'123456',qq:'Test QQ',artist:'Test Artist'},count:1,visible:true};
 const page={url:()=>state.url,isClosed:()=>state.closed,locator:s=>({count:async()=>state.count,isVisible:async()=>state.visible,innerText:async()=>state.values[s]??''})};
 const browser={contexts:()=>[{pages:()=>state.pages??[page]}],isConnected:()=>state.connected,on:(_,fn)=>{state.onDisconnect=fn},close:async()=>{state.disconnects++;state.connected=false;state.onDisconnect?.()}};
 const manager=new TmeAiCloudSessionManager({...options,connectCDP:async port=>{state.connects++;state.port=port;return browser}});
 return{manager,state,page,browser};
}
const identityContract={version:'offline-test',verified:true,source:'browser',origin:'https://y.tencentmusic.com',calibrationEvidenceHash:'a'.repeat(64),identity:{kugouId:'kg',qqDisplayName:'qq',artistName:'artist'}};
test('no startup connection; default contracts remain unverified after authorized connection',async()=>{
 const x=fixture();assert.equal(x.state.connects,0);assert.equal(x.manager.status().connected,false);
 const status=await x.manager.connect({allowConnection:true});assert.equal(status.connected,true);assert.equal(status.connecting,false);assert.equal(x.state.port,9222);assert.equal(status.identityCalibrated,false);
 assert.ok(status.reasons.includes('BROWSER_AI_PREPARE_CONTRACT_UNVERIFIED'));assert.ok(status.reasons.includes('OFFICIAL_RECEIPT_CONTRACT_UNVERIFIED'));
 await assert.rejects(x.manager.preparationSession().account(),/IDENTITY_UNVERIFIED/);
 assert.equal(x.manager.submissionSession().contract.verified,false);assert.equal(x.manager.preparationSession().contract.verified,false);
});
test('permission, production and endpoint shape fail before any connector invocation',async()=>{
 const x=fixture();for(const input of [{},{allowConnection:false},{allowConnection:true,port:0},{allowConnection:true,endpoint:'https://evil.example'},{allowConnection:true,contract:{verified:true}}])await assert.rejects(x.manager.connect(input));assert.equal(x.state.connects,0);
 const y=fixture({available:()=>false});await assert.rejects(y.manager.connect({allowConnection:true}),/PRODUCTION_REQUIRED/);assert.equal(y.state.connects,0);
});
test('CDP websocket endpoint accepts only same exact loopback port and browser target',()=>{
 assert.equal(validateCloudCdpEndpoint('ws://127.0.0.1:9222/devtools/browser/test-id',9222),'ws://127.0.0.1:9222/devtools/browser/test-id');
 for(const endpoint of ['ws://evil.example:9222/devtools/browser/a','ws://127.0.0.1:9223/devtools/browser/a','wss://127.0.0.1:9222/devtools/browser/a','ws://user:pass@127.0.0.1:9222/devtools/browser/a','ws://127.0.0.1:9222/devtools/page/a','ws://127.0.0.1:9222/devtools/browser/a?x=1'])assert.throws(()=>validateCloudCdpEndpoint(endpoint,9222),/LOOPBACK_CDP_REQUIRED/);
});
test('exactly one official page required; failure detaches without creating pages',async()=>{
 for(const pages of [[],[{},{}]]){const x=fixture();x.state.pages=pages.map(()=>x.page);await assert.rejects(x.manager.connect({allowConnection:true}),/SINGLE_TME_PAGE_REQUIRED/);assert.equal(x.state.disconnects,1);assert.equal(x.manager.status().connected,false)}
 const x=fixture();x.state.url='https://y.tencentmusic.com.evil.example/';await assert.rejects(x.manager.connect({allowConnection:true}),/SINGLE_TME_PAGE_REQUIRED/);
});
test('cloud sessions have stable page and explicit non-native binding; identity reads all three calibrated selectors',async()=>{
 const x=fixture({submissionContract:identityContract});await x.manager.connect({allowConnection:true});
 const prep=x.manager.preparationSession(),submission=x.manager.submissionSession();assert.equal(prep,x.manager.preparationSession());assert.equal(submission,x.manager.submissionSession());assert.equal(prep.page,submission.page);
 const account=await prep.account();assert.deepEqual(account.identity,{kugouId:'123456',qqDisplayName:'Test QQ',artistName:'Test Artist'});assert.equal(account.binding.transport,'cloud-playwright');assert.equal('pid'in account.binding,false);assert.equal('handle'in account.binding,false);assert.equal(submission.binding(),account.binding);
 x.state.values.qq='Another QQ';await assert.rejects(prep.account(),/ACCOUNT_CHANGED/);
});
test('artist-only page, missing/duplicate/hidden identity and origin change all block',async()=>{
 for(const change of [s=>{delete s.values.kg},s=>{s.count=2},s=>{s.visible=false}]){const x=fixture({submissionContract:identityContract});await x.manager.connect({allowConnection:true});change(x.state);await assert.rejects(x.manager.preparationSession().account(),/IDENTITY_UNVERIFIED/)}
 const x=fixture({submissionContract:identityContract});await x.manager.connect({allowConnection:true});x.state.url='https://example.com';await assert.rejects(x.manager.preparationSession().account(),/PAGE_ORIGIN_CHANGED/);assert.throws(()=>x.manager.submissionSession().binding(),/PAGE_ORIGIN_CHANGED/);
});
test('disconnect invalidates captured sessions and reconnect cannot reuse prior binding',async()=>{
 const x=fixture({submissionContract:identityContract});await x.manager.connect({allowConnection:true});const old=x.manager.preparationSession(),binding=(await old.account()).binding;await x.manager.disconnect();assert.equal(x.manager.preparationSession(),undefined);await assert.rejects(old.account(),/SESSION_REQUIRED/);
 x.state.connected=true;await x.manager.connect({allowConnection:true});assert.notEqual((await x.manager.preparationSession().account()).binding.sessionId,binding.sessionId);await assert.rejects(old.account(),/SESSION_REQUIRED/);
});
test('status is read-only and session close invalidates cached session',async()=>{
 const x=fixture();await x.manager.connect({allowConnection:true});for(let i=0;i<3;i++)x.manager.status();assert.equal(x.state.connects,1);assert.equal(x.state.disconnects,0);x.state.connected=false;x.state.onDisconnect();assert.equal(x.manager.status().connected,false);assert.equal(x.manager.submissionSession(),undefined);
});
test('bootstrap supplies concrete session callbacks and explicit connection handler',()=>{
 const bootstrap=fs.readFileSync('src/main/bootstrap.ts','utf8');for(const expected of ['new TmeAiCloudSessionManager','cloudSession:()=>tmeAiCloud.submissionSession()','cloudPreparationSession:()=>tmeAiCloud.preparationSession()',"action==='connectBrowser'",'tmeAiCloud.connect(input)'])assert.ok(bootstrap.includes(expected),expected);
});
