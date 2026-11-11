import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {chromium} from 'playwright-core';
await build({entryPoints:['src/main/fanqie/authorization.ts'],outfile:'output/fanqie-tests/authorization.cjs',bundle:true,platform:'node',format:'cjs',packages:'external'});
const {prepareFanqieAuthorization}=createRequire(import.meta.url)('../output/fanqie-tests/authorization.cjs');
const pref={mode:'exclusive',platforms:['fanqie_music','fanqie_audio'],confirmContractManually:true};
async function fixture(t){
 const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const context=await browser.newContext();const page=await context.newPage();
 await page.context().route('**/*',r=>r.request().url().endsWith('/ugc')?r.fulfill({contentType:'text/html; charset=utf-8',body:`<table><tr><td>测试歌曲 作品ID：1234567890 待授权</td><td><svg class="serial-fm-icon-general_edit" onclick="location.href='/creator/music/finished/ugc/uploadProduct'" width=30 height=30><rect width=30 height=30 /></svg></td></tr></table>`}):r.fulfill({contentType:'text/html; charset=utf-8',body:`<h3>选择签约模式</h3><button onclick="mode=true;ready()">独家授权</button><button>非独家授权</button><h3>授权信息·1</h3><div>测试歌曲</div><input placeholder="请选择签约身份" onclick="document.querySelector('[role=option]').hidden=false"><div role="option" hidden onclick="identity=true;this.hidden=true;ready()">个人</div><h3 onclick="document.querySelector('#platforms').hidden=true">签约信息</h3><div class="platform-panel-trigger" onclick="document.querySelector('#platforms').hidden=false"><img alt="番茄音乐"></div><div id="platforms" hidden><span>番茄畅听</span><input type="checkbox" role="switch" checked disabled><input type="checkbox" role="switch" onchange="document.querySelector('.platform-panel-trigger').insertAdjacentHTML('beforeend','<img alt=番茄畅听>')"></div><button id="next" disabled onclick="document.body.innerHTML='<h3>确认签约协议</h3><button onclick=window.signed=true>确认签署</button>'">下一步</button><script>let mode=false,identity=false;function ready(){document.querySelector('#next').disabled=!(mode&&identity)}</script>`}));
 await page.goto('https://www.novelfm.com/creator/music/finished/ugc/uploadProduct');return page;
}
test('authorization prepares saved options and stops before legal acceptance',async t=>{
 const page=await fixture(t),steps=[];const result=await prepareFanqieAuthorization(page,'测试歌曲',pref,async step=>steps.push(step));
 assert.deepEqual(result,{phase:'awaiting_signature',contractAccepted:false});assert.equal(await page.getByRole('button',{name:'确认签署'}).count(),1);assert.equal(await page.evaluate(()=>window.signed),undefined);assert.equal(steps.at(-1),'authorization:preview');
});
test('authorization refuses wrong song before changing the form',async t=>{
 const page=await fixture(t),steps=[];await assert.rejects(prepareFanqieAuthorization(page,'另一首',pref,async s=>steps.push(s)),/WORK_MISMATCH/);assert.deepEqual(steps,[]);
});
test('authorization refuses unsupported platform selection',async t=>{
 const page=await fixture(t);await assert.rejects(prepareFanqieAuthorization(page,'测试歌曲',{...pref,platforms:['fanqie_audio']},async()=>{}),/PREFERENCE_INVALID/);
});

await build({entryPoints:['src/main/fanqie/authorize-records.ts'],outfile:'output/fanqie-tests/authorize-records.cjs',bundle:true,platform:'node',format:'cjs',packages:'external'});
const {authorizeFanqieRecords}=createRequire(import.meta.url)('../output/fanqie-tests/authorize-records.cjs');
test('existing work authorization verifies ID, persists signature boundary and reuses preview',async t=>{
 const page=await fixture(t),context=page.context(),root=fs.mkdtempSync(path.join(os.tmpdir(),'rainfall-auth-'));
 const session={run:async fn=>fn(context,()=>{}),mark:()=>{},inspect:async()=>({report:{accountKey:'account'},catalog:{complete:true,rows:[{id:'1234567890',title:'测试歌曲',stage:'contract_pending',officialStatus:'待授权'}]}})};
 const result=await authorizeFanqieRecords(root,session,'account',['1234567890'],pref,()=>{});
 assert.equal(result[0].phase,'awaiting_signature');const count=context.pages().length;
 const again=await authorizeFanqieRecords(root,session,'account',['1234567890'],pref,()=>{});assert.equal(again[0].phase,'awaiting_signature');assert.equal(context.pages().length,count);
 assert.equal(await context.pages().at(-1).evaluate(()=>window.signed),undefined);
 await context.pages().at(-1).close();await assert.rejects(authorizeFanqieRecords(root,session,'account',['1234567890'],pref,()=>{}),/RECONCILIATION_REQUIRED/);
});
