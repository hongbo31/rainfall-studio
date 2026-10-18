import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const bundle=await build({entryPoints:['src/main/tme/cover-readback.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {waitForStableManualCover}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));

const snapshot=(extra={})=>({
 identity:{kugouId:'12345',qqDisplayName:'离线用户',artistName:'离线艺人'},
 binding:{pid:123,handle:'456',started:'2026-10-18T00:00:00Z',documentId:'offline-document'},
 route:'https://y.tencentmusic.com/#/user/manage/aiChoose/add',mode:'editor',
 observedAt:'2026-10-18T00:00:00Z',
 form:{title:'离线歌曲',lyrics:'歌词提到调整图片和裁剪图片',albumDescription:'已为您生成智能专辑封面只是歌词',text:'作词 离线艺人 作曲 离线艺人'},
 coverState:{manualSelected:true,generatorBanner:false},...extra,
});
function replay(frames,options={}){
 let time=0,reads=0,guards=0;
 const sleeps=[];
 const run=()=>waitForStableManualCover({
  read:async()=>{const frame=frames[Math.min(reads++,frames.length-1)];if(frame instanceof Error)throw frame;return frame;},
  guard:()=>{guards++;},now:()=>time,sleep:async ms=>{sleeps.push(ms);time+=ms;},...options,
 });
 return{run,get reads(){return reads;},get guards(){return guards;},get time(){return time;},sleeps};
}

test('returns the latest snapshot only after three matching ready observations over 200ms',async()=>{
 const frames=[snapshot(),snapshot({observedAt:'2026-10-18T00:00:01Z'}),snapshot({observedAt:'2026-10-18T00:00:02Z'})];
 const x=replay(frames);assert.strictEqual(await x.run(),frames[2]);assert.equal(x.reads,3);assert.equal(x.time,200);assert.equal(x.guards,6);
});
test('a transient ready old tree followed by missing or generated cover resets settling',async()=>{
 for(const nonReady of [snapshot({mode:'intake'}),snapshot({coverState:{manualSelected:false,generatorBanner:false}}),snapshot({coverState:{manualSelected:true,generatorBanner:true}}),snapshot({coverState:{manualSelected:1,generatorBanner:false}}),snapshot({coverState:{manualSelected:true}}),snapshot({form:null})]){
  const final=snapshot({observedAt:'2026-10-18T00:00:09Z'}),x=replay([snapshot(),nonReady,snapshot(),snapshot(),final]);
  assert.strictEqual(await x.run(),final);assert.equal(x.reads,5);assert.equal(x.time,400);
 }
});
test('changed metadata resets the stable sequence and returns only the latest consistent materials',async()=>{
 const changed=snapshot({form:{...snapshot().form,title:'另一首离线歌曲'}}),x=replay([snapshot(),snapshot(),changed,changed,changed]);
 assert.strictEqual(await x.run(),changed);assert.equal(x.reads,5);
});
test('object key order does not create a false material or binding change',async()=>{
 const original=snapshot(),reordered={...original,identity:Object.fromEntries(Object.entries(original.identity).reverse()),binding:Object.fromEntries(Object.entries(original.binding).reverse()),form:Object.fromEntries(Object.entries(original.form).reverse())};
 const x=replay([original,reordered,original]);assert.strictEqual(await x.run(),original);assert.equal(x.reads,3);
});
test('three rapid observations cannot bypass the minimum 200ms stability window',async()=>{
 let time=0,reads=0;
 await waitForStableManualCover({read:async()=>{reads++;return snapshot();},guard:()=>{},now:()=>time,sleep:async()=>{time+=10;}});
 assert.equal(time,200);assert.equal(reads,21);
});
test('scope changes fail immediately even while the page is not ready',async()=>{
 for(const changed of [snapshot({identity:{...snapshot().identity,kugouId:'99999'}}),snapshot({binding:{...snapshot().binding,documentId:'other'}}),snapshot({route:'https://y.tencentmusic.com/#/help'}),snapshot({identity:{},mode:'intake'}),snapshot({binding:null})]){
  const x=replay([snapshot(),changed]);await assert.rejects(x.run(),/COVER_READBACK_SCOPE_CHANGED|COVER_READBACK_SCOPE_REQUIRED/);assert.equal(x.reads,2);
 }
});
test('a read failure is propagated without another read',async()=>{
 const failure=Error('AI_DOCUMENT_CHANGED'),x=replay([snapshot(),failure]);await assert.rejects(x.run(),e=>e===failure);assert.equal(x.reads,2);
});
test('workspace guard is checked after a pending read before accepting its result',async()=>{
 let changed=false,reads=0;
 await assert.rejects(waitForStableManualCover({read:async()=>{reads++;changed=true;return snapshot();},guard:()=>{if(changed)throw Error('WORKSPACE_CHANGED');}}),/WORKSPACE_CHANGED/);
 assert.equal(reads,1);
});
test('a failed initial guard prevents all native reads',async()=>{
 const x=replay([snapshot()],{guard:()=>{throw Error('WORKSPACE_CHANGED');}});await assert.rejects(x.run(),/WORKSPACE_CHANGED/);assert.equal(x.reads,0);
});
test('nonready or continuously changing materials time out within six seconds',async()=>{
 const x=replay([snapshot({coverState:{manualSelected:false,generatorBanner:false}})]);await assert.rejects(x.run(),/MANUAL_COVER_ACCEPTANCE_REQUIRED/);assert.equal(x.time,6000);assert.equal(x.reads,60);
 let n=0;const changing=replay([],{read:async()=>snapshot({form:{title:String(n++)}})});await assert.rejects(changing.run(),/MANUAL_COVER_ACCEPTANCE_REQUIRED/);assert.equal(changing.time,6000);assert.equal(n,60);
});
test('a stalled read has a hard deadline and its late result cannot start more reads',async()=>{
 let reads=0,release;
 const pending=new Promise(resolve=>{release=resolve;});
 const result=waitForStableManualCover({read:()=>{reads++;return pending;},guard:()=>{},timeoutMs:20});
 await assert.rejects(result,/MANUAL_COVER_ACCEPTANCE_REQUIRED/);release(snapshot());await new Promise(resolve=>setImmediate(resolve));assert.equal(reads,1);
});
test('invalid deadline settings stop before the first read',async()=>{
 for(const timeoutMs of [0,-1,NaN,Infinity,6001]){const x=replay([snapshot()],{timeoutMs});await assert.rejects(x.run(),/INVALID_COVER_READBACK_TIMEOUT/);assert.equal(x.reads,0);}
});
