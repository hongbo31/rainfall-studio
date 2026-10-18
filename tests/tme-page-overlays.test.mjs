import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['src/main/tme/page-overlays.ts'],bundle:true,platform:'node',format:'esm',write:false});
const api=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const home='https://y.tencentmusic.com/#/user/musician/index';
const row=(ruleId,heading,actionName,extra={})=>({instanceId:ruleId??'dom-1',ruleId,heading,text:heading,actionName,actionCount:1,visible:true,role:'dialog',editable:false,...extra});
const fixtures=[
 row('musician-index-upgrade','音乐人指数全新改版',''),
 row('musician-index-tour','个人资料&资产','跳过引导'),
 row('musician-ai-intro','腾讯音乐人推出全新AI助手，提供智能数据、智能宣推、版权保护等全方位支持，快来尝试吧！',''),
 row('musician-wechat-recommendation','绑定微信视频号，歌曲推广更便捷','稍后再说'),
];
test('only four observed homepage container/title/action contracts are dismissible',()=>{
 const result=api.classifyTmeOverlays(home,fixtures);assert.equal(result.length,4);assert.ok(result.every(x=>x.verified));assert.deepEqual(result.map(x=>x.kind),['notice','tour','notice','notice']);
});
test('homepage evidence cannot authorize the different upload or AI intake routes',()=>{
 for(const route of ['https://y.tencentmusic.com/#/user/manage/add','https://y.tencentmusic.com/#/user/manage/aiChoose/add','https://evil.invalid/#/user/musician/index']){
  assert.ok(api.classifyTmeOverlays(route,fixtures).every(x=>!x.verified));
 }
});
test('a title, container, close-control, or visibility mismatch cannot become a safe match',()=>{
 for(const altered of [{heading:'音乐人指数全新改版。'},{ruleId:'unknown'},{actionName:'开始探索'},{actionCount:2},{actionCount:0},{editable:true},{visible:false}]){
  const result=api.classifyTmeOverlays(home,[{...fixtures[0],...altered}]);assert.ok(!result[0]?.verified);
 }
});
test('hidden driver Close is never used in place of the visible skip-tour control',()=>{
 const result=api.classifyTmeOverlays(home,[{...fixtures[1],actionName:'Close'}]);assert.equal(result[0].verified,false);
});
test('agreement, login, captcha, permission, unsaved exit and delete confirmations always pause',()=>{
 for(const [text,kind] of [['登录账号','login'],['请输入验证码','captcha'],['同意用户协议','terms'],['允许访问相机权限','permission'],['未保存，是否退出','unsaved'],['确认删除作品','delete']]){
  const result=api.classifyTmeOverlays(home,[{...fixtures[0],text}]);assert.equal(result[0].kind,kind);assert.equal(result[0].verified,false);
 }
});
test('body prose with the same title is not a dialog or clickable overlay',()=>{
 const result=api.classifyTmeOverlays(home,[row(undefined,'音乐人指数全新改版','',{role:'paragraph',blocking:false})]);assert.ok(!result[0]?.verified);assert.equal(result[0]?.blocking,false);
});
test('unknown visible dialog or orphan backdrop is a blocking unresolved overlay',()=>{
 for(const candidate of [row(undefined,'未知通知','关闭'),row(undefined,'','',{role:'mask'})]){
  const [result]=api.classifyTmeOverlays(home,[candidate]);assert.equal(result.kind,'unknown');assert.equal(result.blocking,true);assert.equal(result.verified,false);
 }
});
test('live contracts never contain exploratory, binding, agreement or generic close-button actions',()=>{
 const rules=api.TME_OBSERVED_OVERLAY_RULES;assert.equal(rules.length,4);
 assert.deepEqual(rules.map(x=>x.id),fixtures.map(x=>x.ruleId));
 assert.ok(rules.every(x=>x.observedRoute===home));
 assert.ok(rules.every(x=>!['开始探索','下一个','立即体验','去绑定','确定','确认','Close'].includes(x.actionName)));
 assert.equal(rules.find(x=>x.id==='musician-index-tour').actionName,'跳过引导');
 assert.equal(rules.find(x=>x.id==='musician-index-tour').actionRole,'button');
});
function adapterHarness({rows=[fixtures[0]],click,onScan,onScope,now}={}){
 let current=rows,route=home,scans=0,clicks=0,handler;
 const scope={subject:'fixture-account',binding:'fixture-session',materials:'fixture-empty'};
 const locator=(selector)=>({filter(){return this},async count(){return 1},async innerText(){return api.TME_OBSERVED_OVERLAY_RULES.find(r=>r.headingSelector===selector)?.heading??''},async isEnabled(){return true},locator,getByRole(){return locator('button')},async click(){clicks++;if(click)await click({scope,setRows:r=>current=r,setRoute:r=>route=r});else current=[]}});
 const page={on(event,fn){handler=fn},url:()=>route,locator,async evaluate(){scans++;if(onScan)onScan({scans,scope,setRows:r=>current=r,setRoute:r=>route=r});return{route,rows:current,ready:true}}};
 return{guard:new api.TmePageOverlayGuard(page,async()=>{if(onScope)await onScope();return {...scope}},now),stats:()=>({scans,clicks}),dialog:()=>handler(),scope};
}
test('adapter closes one observed notice and re-observes before reporting clear',async()=>{
 const h=adapterHarness();const result=await h.guard.run();assert.equal(result.status,'clear');assert.equal(h.stats().clicks,1);assert.ok(h.stats().scans>=4);
});
test('adapter sequential re-observation handles upgrade revealing a tour',async()=>{
 let n=0;const h=adapterHarness({click:async({setRows})=>setRows(++n===1?[fixtures[1]]:[])});await h.guard.run();assert.equal(h.stats().clicks,2);
});
test('adapter never retries an unsuccessful close or a repeated notice',async()=>{
 const h=adapterHarness({click:async()=>{}});await assert.rejects(h.guard.run(),/OVERLAY_DISMISS_UNCONFIRMED|OVERLAY_REPEATED/);assert.equal(h.stats().clicks,1);
});
test('adapter final scope validation stops SPA/account/material drift before click',async()=>{
 for(const change of ['route','subject','materials']){
  const h=adapterHarness({onScan({scans,scope,setRoute}){if(scans===3){if(change==='route')setRoute('https://y.tencentmusic.com/#/user/manage/add');else scope[change]='changed'}}});
  await assert.rejects(h.guard.run(),/SCOPE_CHANGED/);assert.equal(h.stats().clicks,0);
 }
});
test('adapter refuses native dialog instead of accepting or dismissing it',async()=>{
 const h=adapterHarness();h.dialog();await assert.rejects(h.guard.run(),/PAGE_NATIVE_DIALOG_REQUIRES_USER/);assert.equal(h.stats().clicks,0);
});
test('adapter holds busy until a stalled click really settles',async()=>{
 let settle,started;const entered=new Promise(r=>started=r);const gate=new Promise(r=>settle=r);
 const h=adapterHarness({click:async({setRows})=>{started();await gate;setRows([])}});
 const pending=h.guard.run();await entered;await assert.rejects(h.guard.run(),/PAGE_OVERLAY_BUSY/);assert.equal(h.stats().clicks,1);settle();await pending;
});
test('adapter preserves close error and does not retry mutation',async()=>{
 const h=adapterHarness({click:async()=>{throw Error('CONTROL_CLICK_TIMEOUT')}});await assert.rejects(h.guard.run(),/CONTROL_CLICK_TIMEOUT/);assert.equal(h.stats().clicks,1);
});

test('scanned aria-modal and role-less el-dialog facts remain blocking and protected',()=>{
 for(const text of ['未知通知','同意用户协议','登录账号','未保存，是否退出']){
  const [value]=api.classifyTmeOverlays(home,[row(undefined,'','',{role:'container',modal:true,text})]);
  assert.equal(value.blocking,true);assert.equal(value.verified,false);
  assert.equal(value.kind,text==='未知通知'?'unknown':text==='同意用户协议'?'terms':text==='登录账号'?'login':'unsaved');
 }
});

test('adapter latches a failed close across later observe/run calls',async()=>{
 const h=adapterHarness({click:async()=>{}});
 await assert.rejects(h.guard.run(),/OVERLAY_DISMISS_UNCONFIRMED|OVERLAY_REPEATED/);
 await assert.rejects(h.guard.run(),/OVERLAY_DISMISS_UNCONFIRMED|OVERLAY_REPEATED/);
 assert.equal(h.stats().clicks,1);
});
test('adapter does not dismiss a formerly closed rule again on a later run',async()=>{
 let reappear=false;const h=adapterHarness({onScan({setRows}){if(reappear)setRows([fixtures[0]])}});
 await h.guard.run();reappear=true;await assert.rejects(h.guard.run(),/OVERLAY_REPEATED/);assert.equal(h.stats().clicks,1);
});

test('adapter expired budget during final scope read cannot issue a click',async()=>{
 let time=0,reads=0;const h=adapterHarness({now:()=>time,onScope:async()=>{if(++reads===3)time=10001}});
 await assert.rejects(h.guard.run(),/OVERLAY_TIMEOUT/);assert.equal(h.stats().clicks,0);
});
