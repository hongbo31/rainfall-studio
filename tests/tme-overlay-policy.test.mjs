import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {build} from 'esbuild';

let implementation;
if(fs.existsSync('src/main/tme/overlay-policy.ts')){
 const bundle=await build({entryPoints:['src/main/tme/overlay-policy.ts'],bundle:true,platform:'node',format:'esm',write:false});
 implementation=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
}
const run=options=>{assert.equal(typeof implementation?.runOverlayGuard,'function','bounded overlay policy must be implemented');return implementation.runOverlayGuard(options);};
const scope=()=>({origin:'https://fixture.invalid',route:'/ai/upload',subject:'fixture-artist',binding:'fixture-document-1',materials:'empty'});
const overlay=(extra={})=>({instanceId:'notice-1',ruleId:'fixture-notice',kind:'notice',visible:true,blocking:true,verified:true,actionCount:1,...extra});
const snapshot=(overlays=[],extra={})=>({scope:scope(),overlays,scanComplete:true,...extra});
function replay(frames,options={}){
 let reads=0,guards=0,time=0;
 const closes=[],contexts=[];
 const runOptions={observe:async context=>{contexts.push(context);const frame=frames[Math.min(reads++,frames.length-1)];if(frame instanceof Error)throw frame;return frame;},dismiss:async(target,context)=>{closes.push({target,context});},guard:()=>{guards++;},now:()=>time,...options};
 return{run:()=>run(runOptions),closes,contexts,get reads(){return reads;},get guards(){return guards;},get time(){return time;},set time(value){time=value;}};
}
const rejects=(x,code)=>assert.rejects(x.run(),error=>error.code===code&&error.message===code);

test('a complete clear scan returns evidence without any action on same-name body text',async()=>{
 const x=replay([snapshot([],{bodyText:'知道了 关闭 新手引导 确认授权模式'})]);
 const result=await x.run();assert.equal(result.status,'clear');assert.deepEqual(result.dismissals,[]);assert.deepEqual(result.snapshot.scope,scope());assert.equal(x.reads,1);assert.equal(x.closes.length,0);assert.equal(x.guards,2);
});
test('one verified notice is reobserved before close and must disappear afterward',async()=>{
 const notice=overlay(),x=replay([snapshot([notice]),snapshot([notice]),snapshot()]);
 const result=await x.run();assert.equal(result.status,'clear');assert.deepEqual(result.dismissals,[{instanceId:'notice-1',ruleId:'fixture-notice'}]);assert.equal(x.reads,3);assert.equal(x.closes.length,1);assert.deepEqual(x.closes[0].target,notice);assert.deepEqual(x.closes[0].context.scope,scope());assert.equal(x.closes[0].context.timeoutMs,10000);assert.equal(x.guards,8);
});
test('multiple verified notices and tours close sequentially with fresh evidence each time',async()=>{
 const a=overlay(),b=overlay({instanceId:'tour-1',ruleId:'fixture-tour',kind:'tour'});
 const x=replay([snapshot([a,b]),snapshot([a,b]),snapshot([b]),snapshot([b]),snapshot()]);
 const result=await x.run();assert.equal(result.dismissals.length,2);assert.deepEqual(x.closes.map(x=>x.target.instanceId),['notice-1','tour-1']);assert.equal(x.reads,5);
});
test('nonblocking and invisible ordinary overlays are not action targets',async()=>{
 const x=replay([snapshot([overlay({blocking:false}),overlay({instanceId:'hidden',ruleId:'hidden',visible:false})])]);assert.equal((await x.run()).status,'clear');assert.equal(x.closes.length,0);
});
test('unknown nonblocking decoration can remain but unknown blocking overlays pause',async()=>{
 const harmless=replay([snapshot([overlay({kind:'unknown',verified:false,blocking:false})])]);assert.equal((await harmless.run()).status,'clear');
 const blocked=replay([snapshot([overlay({kind:'unknown',verified:false})])]);await rejects(blocked,'OVERLAY_UNSAFE');assert.equal(blocked.closes.length,0);
});
test('login, terms, permission, captcha, unsaved and delete pause even when nonblocking',async()=>{
 for(const kind of ['login','terms','permission','captcha','unsaved','delete'])for(const blocking of [true,false]){
  const x=replay([snapshot([overlay(),overlay({instanceId:'sensitive',ruleId:'sensitive',kind,blocking})])]);await rejects(x,'OVERLAY_UNSAFE');assert.equal(x.closes.length,0);
 }
});
test('invisible sensitive overlays do not block a complete clear scan',async()=>{
 const x=replay([snapshot([overlay({kind:'terms',visible:false})])]);assert.equal((await x.run()).status,'clear');assert.equal(x.closes.length,0);
});
test('unverified, unidentified or ambiguous dismiss actions pause before mutation',async()=>{
 for(const change of [{verified:false},{ruleId:undefined},{ruleId:''},{ruleId:'  '},{actionCount:0},{actionCount:2}]){
  const x=replay([snapshot([overlay(change)])]);await rejects(x,'OVERLAY_UNSAFE');assert.equal(x.closes.length,0);
 }
});
test('duplicate visible instances or rule identities pause instead of choosing arbitrarily',async()=>{
 for(const second of [overlay({ruleId:'other'}),overlay({instanceId:'other'})]){
  const x=replay([snapshot([overlay(),second])]);await rejects(x,'OVERLAY_AMBIGUOUS');assert.equal(x.closes.length,0);
 }
});
test('scan completeness is required initially, immediately before close and afterward',async()=>{
 const a=snapshot([overlay()]);
 for(const frames of [[snapshot([],{scanComplete:false})],[a,snapshot([overlay()],{scanComplete:false})],[a,a,snapshot([],{scanComplete:false})]]){
  const x=replay(frames);await rejects(x,'OVERLAY_SCAN_INCOMPLETE');assert.equal(x.closes.length,frames.length===3?1:0);assert.equal(x.reads,frames.length);
 }
});
test('every scope field must be a nonempty string before the first action',async()=>{
 for(const key of Object.keys(scope()))for(const value of ['', ' ', undefined,null,0]){
  const x=replay([snapshot([overlay()],{scope:{...scope(),[key]:value}})]);await rejects(x,'OVERLAY_SCOPE_REQUIRED');assert.equal(x.closes.length,0);
 }
});
test('origin, SPA route, subject, document binding and material changes before close stop all actions',async()=>{
 for(const key of Object.keys(scope())){
  const x=replay([snapshot([overlay()]),snapshot([overlay()],{scope:{...scope(),[key]:'changed'}})]);await rejects(x,'OVERLAY_SCOPE_CHANGED');assert.equal(x.closes.length,0);assert.equal(x.reads,2);
 }
});
test('scope changes after close pause before any subsequent overlay is dismissed',async()=>{
 for(const key of Object.keys(scope())){
  const a=overlay(),b=overlay({instanceId:'tour-2',ruleId:'another'}),x=replay([snapshot([a]),snapshot([a]),snapshot([b],{scope:{...scope(),[key]:'changed'}})]);await rejects(x,'OVERLAY_SCOPE_CHANGED');assert.equal(x.closes.length,1);assert.equal(x.reads,3);
 }
});
test('a reused mutable observation object cannot hide a scope change',async()=>{
 const shared=snapshot([overlay()]);let reads=0,closes=0;
 await assert.rejects(run({observe:async()=>{if(++reads===2)shared.scope.subject='other';return shared;},dismiss:async()=>{closes++;},guard:()=>{}}),e=>e.code==='OVERLAY_SCOPE_CHANGED');assert.equal(closes,0);
});
test('an overlay replaced before close is never acted on through its old target',async()=>{
 for(const change of [{instanceId:'replacement'},{ruleId:'replacement'},{kind:'tour'},{blocking:false},{visible:false}]){
  const x=replay([snapshot([overlay()]),snapshot([overlay(change)])]);await rejects(x,'OVERLAY_TARGET_CHANGED');assert.equal(x.closes.length,0);
 }
 const gone=replay([snapshot([overlay()]),snapshot()]);await rejects(gone,'OVERLAY_TARGET_CHANGED');assert.equal(gone.closes.length,0);
});
test('a new blocker before close invalidates the candidate instead of using a stale target',async()=>{
 const a=overlay(),b=overlay({instanceId:'new',ruleId:'new'}),x=replay([snapshot([a]),snapshot([a,b])]);await rejects(x,'OVERLAY_TARGET_CHANGED');assert.equal(x.closes.length,0);
});
test('new unsafe evidence before close takes priority over the old safe candidate',async()=>{
 const a=overlay(),x=replay([snapshot([a]),snapshot([a,overlay({instanceId:'terms',ruleId:'terms',kind:'terms'})])]);await rejects(x,'OVERLAY_UNSAFE');assert.equal(x.closes.length,0);
});
test('a no-op close is not retried and is reported as unconfirmed',async()=>{
 const a=snapshot([overlay()]),x=replay([a,a,a]);await rejects(x,'OVERLAY_DISMISS_UNCONFIRMED');assert.equal(x.closes.length,1);assert.equal(x.reads,3);
});
test('a repeated rule pauses immediately even when the DOM instance identity changes',async()=>{
 const a=snapshot([overlay()]),x=replay([a,a,snapshot([overlay({instanceId:'replacement'})])]);await rejects(x,'OVERLAY_REPEATED');assert.equal(x.closes.length,1);assert.equal(x.reads,3);
});
test('a previously dismissed rule returning after another close pauses',async()=>{
 const a=overlay(),b=overlay({instanceId:'tour-1',ruleId:'tour',kind:'tour'}),x=replay([snapshot([a]),snapshot([a]),snapshot([b]),snapshot([b]),snapshot([overlay({instanceId:'notice-new'})])]);await rejects(x,'OVERLAY_REPEATED');assert.equal(x.closes.length,2);
});
test('four successful closes may clear but a fifth close is never attempted',async()=>{
 const notices=Array.from({length:5},(_,i)=>overlay({instanceId:`notice-${i}`,ruleId:`rule-${i}`}));
 for(const count of [4,5]){
  const frames=[];for(const notice of notices.slice(0,4))frames.push(snapshot([notice]),snapshot([notice]));frames.push(count===4?snapshot():snapshot([notices[4]]));const x=replay(frames);
  if(count===4)assert.equal((await x.run()).dismissals.length,4);else await rejects(x,'OVERLAY_LIMIT_REACHED');assert.equal(x.closes.length,4);assert.equal(x.reads,9);
 }
});
test('observation and close errors stop immediately and preserve the original failure',async()=>{
 const failure=Error('EXECUTOR_TIMEOUT'),a=snapshot([overlay()]);
 const readFailure=replay([a,failure]);await assert.rejects(readFailure.run(),e=>e===failure);assert.equal(readFailure.closes.length,0);assert.equal(readFailure.reads,2);
 let closes=0;const closeFailure=replay([a,a],{dismiss:async()=>{closes++;throw failure;}});await assert.rejects(closeFailure.run(),e=>e===failure);assert.equal(closes,1);assert.equal(closeFailure.reads,2);
});
test('an explicit false close response pauses without any retry or extra read',async()=>{
 const a=snapshot([overlay()]);let closes=0;const x=replay([a,a],{dismiss:async()=>{closes++;return false;}});await rejects(x,'OVERLAY_DISMISS_FAILED');assert.equal(closes,1);assert.equal(x.reads,2);
});
test('workspace guard cancellation prevents first observation and guards in-flight results',async()=>{
 const failure=Error('WORKSPACE_CHANGED'),initial=replay([],{guard:()=>{throw failure;}});await assert.rejects(initial.run(),e=>e===failure);assert.equal(initial.reads,0);
 let changed=false,reads=0,closes=0;await assert.rejects(run({observe:async()=>{reads++;changed=true;return snapshot([overlay()]);},dismiss:async()=>{closes++;},guard:()=>{if(changed)throw failure;}}),e=>e===failure);assert.equal(reads,1);assert.equal(closes,0);
});
test('guard cancellation after a close prevents follow-up observations and actions',async()=>{
 let changed=false,reads=0,closes=0;await assert.rejects(run({observe:async()=>{reads++;return snapshot([overlay()]);},dismiss:async()=>{closes++;changed=true;},guard:()=>{if(changed)throw Error('WORKSPACE_CHANGED');}}),/WORKSPACE_CHANGED/);assert.equal(reads,2);assert.equal(closes,1);
});
test('deadline exhaustion after an observation prevents all further actions',async()=>{
 let time=0,reads=0,closes=0;await assert.rejects(run({observe:async()=>{reads++;time=10000;return snapshot([overlay()]);},dismiss:async()=>{closes++;},guard:()=>{},now:()=>time}),e=>e.code==='OVERLAY_TIMEOUT');assert.equal(reads,1);assert.equal(closes,0);
});
test('executor calls receive only the remaining deadline budget',async()=>{
 let time=0,reads=0;const budgets=[],closeBudgets=[];
 const result=await run({observe:async context=>{budgets.push(context.timeoutMs);time+=100;return ++reads===3?snapshot():snapshot([overlay()]);},dismiss:async(target,context)=>{closeBudgets.push(context.timeoutMs);time+=200;},guard:()=>{},now:()=>time,timeoutMs:1000});
 assert.equal(result.status,'clear');assert.deepEqual(budgets,[1000,900,600]);assert.deepEqual(closeBudgets,[800]);
});
test('a stalled close keeps the caller lock until it settles, then timeout prevents a late continuation',async()=>{
 let release,time=0,reads=0,closes=0,settled=false;const pending=new Promise(resolve=>{release=resolve;});
 const operation=run({observe:async()=>{reads++;return snapshot([overlay()]);},dismiss:async()=>{closes++;await pending;},guard:()=>{},now:()=>time,timeoutMs:20});operation.then(()=>{settled=true;},()=>{settled=true;});
 await new Promise(resolve=>setImmediate(resolve));time=30;await new Promise(resolve=>setTimeout(resolve,30));assert.equal(settled,false);assert.equal(closes,1);assert.equal(reads,2);release();await assert.rejects(operation,e=>e.code==='OVERLAY_TIMEOUT');await new Promise(resolve=>setImmediate(resolve));assert.equal(closes,1);assert.equal(reads,2);
});
test('a stalled observation cannot release its caller lock or begin later actions after timeout',async()=>{
 let release,time=0,reads=0,closes=0,settled=false;const pending=new Promise(resolve=>{release=resolve;});
 const operation=run({observe:async()=>{reads++;return pending;},dismiss:async()=>{closes++;},guard:()=>{},now:()=>time,timeoutMs:20});operation.then(()=>{settled=true;},()=>{settled=true;});
 await new Promise(resolve=>setImmediate(resolve));time=30;await new Promise(resolve=>setTimeout(resolve,30));assert.equal(settled,false);release(snapshot([overlay()]));await assert.rejects(operation,e=>e.code==='OVERLAY_TIMEOUT');assert.equal(reads,1);assert.equal(closes,0);
});
test('invalid timeout settings fail before any observation',async()=>{
 for(const timeoutMs of [0,-1,NaN,Infinity,10001]){const x=replay([],{timeoutMs});await rejects(x,'OVERLAY_INVALID_TIMEOUT');assert.equal(x.reads,0);}
});
test('nonfinite or backwards clocks fail closed',async()=>{
 for(const invalid of [NaN,Infinity]){const x=replay([],{now:()=>invalid});await rejects(x,'OVERLAY_CLOCK_INVALID');assert.equal(x.reads,0);}
 let time=10,reads=0;await assert.rejects(run({observe:async()=>{reads++;time=0;return snapshot();},dismiss:async()=>{},guard:()=>{},now:()=>time}),e=>e.code==='OVERLAY_CLOCK_INVALID');assert.equal(reads,1);
});
test('malformed overlay observations never become a clear-page assertion',async()=>{
 for(const frame of [null,{},snapshot(null),snapshot([{}]),snapshot([overlay({visible:'yes'})]),snapshot([overlay({blocking:'yes'})]),snapshot([overlay({instanceId:''})]),snapshot([overlay({actionCount:NaN})]),snapshot([overlay({kind:'future-kind'})])]){
  const x=replay([frame]);await rejects(x,'OVERLAY_INVALID_OBSERVATION');assert.equal(x.closes.length,0);
 }
});
