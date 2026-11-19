import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';

const root=path.resolve('output/qishui-tests');
await fs.mkdir(root,{recursive:true});
await build({entryPoints:['src/main/qishui-flow.ts'],outfile:path.join(root,'flow.cjs'),bundle:true,platform:'node',format:'cjs',packages:'external'});
await build({entryPoints:['src/main/browser-accounts.ts'],outfile:path.join(root,'accounts.cjs'),bundle:true,platform:'node',format:'cjs',packages:'external'});
const require=createRequire(import.meta.url),{QishuiFlow,verifyQishuiFile}=require(path.join(root,'flow.cjs'));
const {PlatformBrowserSessions}=require(path.join(root,'accounts.cjs'));
const origin='https://music.douyin.com';
const form=`<h2>发布全曲</h2>
<section><div>以下歌曲均使用AI创作*</div><label><input type=radio name=ai>是</label><label><input type=radio name=ai>否</label></section>
<button role=combobox aria-label=使用的AI工具 onclick="document.getElementById('option').hidden=false">请选择</button>
<button id=option role=option hidden onclick="this.hidden=true">tick Suno</button>
<input aria-label="歌曲标题*">
<section><div>是否是纯音乐*</div><label><input type=radio name=ins>是</label><label><input type=radio name=ins checked>否</label></section>
<textarea aria-label="歌词*"></textarea>
<section><div>表演者*</div><div role=combobox><button>测试艺人 close</button></div></section>
${['曲作者*','词作者*'].map(label=>`<section><div>${label}</div><div role=combobox></div><button onclick="this.previousElementSibling.innerHTML='<button>测试艺人 close</button>'">添加自己</button></section>`).join('')}
<button id=audio onclick="document.getElementById('audiofile').click()">cloud_upload_stroked 上传完整版</button>
<input id=audiofile type=file hidden onchange="document.getElementById('audio').hidden=true">
<button onclick="document.getElementById('coverfile').click()">cloud_upload_stroked 上传封面</button>
<input id=coverfile type=file hidden onchange="document.getElementById('crop').hidden=false">
<div id=crop role=dialog aria-label=调整图片 hidden><button onclick="this.parentElement.hidden=true">confirm</button></div>
<button onclick="document.body.dataset.saved='yes'">保存</button>
<button onclick="document.body.innerHTML='<h5>签约模式</h5><button>独家代理发行（3年）</button><button>接受合同</button>'">下一步</button>`;

async function setup(t,{duplicate=false}={}){
 const dir=await fs.mkdtemp(path.join(root,'run-'));
 const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());
 const context=await browser.newContext();
 await context.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:route.request().url().includes('/console/songs')?'<h1>我的歌曲</h1>'+(duplicate?'<a href=/console/songs/detail/123>测试新歌 测试艺人 审核通过</a>':'')+'<button disabled>Next</button>':form}));
 const page=await context.newPage();await page.goto(origin+'/console/complete-publish');
 const material={file:path.join(dir,'audio.mp3'),sha256:createHash('sha256').update('fixture').digest('hex'),bytes:7};await fs.writeFile(material.file,'fixture');
 const input={accountId:randomUUID(),workId:randomUUID(),variant:'A',performer:'测试艺人',composer:'测试艺人',lyricist:'测试艺人',ai:true,aiTool:'Suno'};
 const source={workId:input.workId,artistId:randomUUID(),title:'测试新歌',lyrics:'测试歌词',instrumental:false,audio:material,cover:material,fingerprint:'fixture'};
 return {page,input,source,flow:new QishuiFlow(dir),dir};
}
test('fill uploads both materials, reads fields, stops before next; authorization requires a separate action',async t=>{
 const {page,input,source,flow}=await setup(t);
 const job=await flow.fill(page,input,source,()=>{});
 assert.equal(job.stage,'form_ready');assert.equal(await page.getByRole('textbox',{name:'歌曲标题*',exact:true}).inputValue(),'测试新歌');
 assert.equal(await page.getByRole('button',{name:'测试艺人 close',exact:true}).count(),3);
 assert.equal(await page.locator('body').getAttribute('data-saved'),null);
 assert.equal(await page.getByRole('heading',{name:'签约模式'}).count(),0);
 await assert.rejects(flow.fill(page,input,source,()=>{}),/EXISTING_JOB/);
 const next=await flow.authorization(page,{...input,mode:'exclusive_agency'},()=>{});
 assert.equal(next.stage,'authorization');assert.equal(await page.getByRole('button',{name:'接受合同'}).count(),1);
});
test('existing published title prevents all form writes',async t=>{
 const {page,input,source,flow}=await setup(t,{duplicate:true});
 await assert.rejects(flow.fill(page,input,source,()=>{}),/POSSIBLE_DUPLICATE/);
 assert.equal(await page.getByRole('textbox',{name:'歌曲标题*',exact:true}).inputValue(),'');
 assert.equal(flow.status(input.accountId,input.workId),null);
});
test('contract acceptance requires current review, rejects changes and replay, stops at verification',async t=>{
 const {page,input,source,flow}=await setup(t);
 await flow.fill(page,input,source,()=>{});
 await flow.authorization(page,{...input,mode:'exclusive_agency'},()=>{});
 await page.setContent('<h5>签约模式</h5><button id=next>下一步</button>');
 await page.locator('#next').evaluate(el=>el.onclick=()=>{document.body.innerHTML='<main>测试新歌 独家代理发行合同<button id="accept">接受合同</button></main>';document.getElementById('accept').onclick=()=>{document.body.dataset.accepted='1';document.body.innerHTML='<label>验证码<input></label><button onclick="document.body.dataset.submitted=1">签署提交</button>';};});
 const review=await flow.contract(page,input,()=>{});
 assert.equal(review.stage,'contract_review');
 assert.equal(await page.locator('body').getAttribute('data-accepted'),null);
 const confirmation={...input,reviewToken:review.reviewToken,contractHash:review.contractHash,confirmed:true};
 await assert.rejects(flow.accept(page,{...confirmation,reviewToken:randomUUID()},()=>{}),/CONFIRMATION_REQUIRED/);
 await page.locator('main').evaluate(el=>el.prepend('修改'));
 await assert.rejects(flow.accept(page,confirmation,()=>{}),/CONTRACT_CHANGED/);
 await page.locator('main').evaluate(el=>el.firstChild.remove());
 const stopped=await flow.accept(page,confirmation,()=>{});
 assert.equal(stopped.stage,'verification_required');
 assert.equal(await page.locator('body').getAttribute('data-accepted'),'1');
 assert.equal(await page.locator('body').getAttribute('data-submitted'),null);
 assert.equal(await page.getByRole('textbox',{name:'验证码'}).inputValue(),'');
 await assert.rejects(flow.accept(page,confirmation,()=>{}),/CONFIRMATION_REQUIRED/);
});
test('workspace switch halts and marks uncertain writes; changed files rejected',async t=>{
 const {page,input,source,flow}=await setup(t);let n=0;
 await assert.rejects(flow.fill(page,input,source,()=>{if(++n===6)throw Error('WORKSPACE_CHANGED');}),/WORKSPACE_CHANGED/);
 assert.equal(flow.status(input.accountId,input.workId).stage,'unknown');
 await fs.writeFile(source.audio.file,'altered');assert.throws(()=>verifyQishuiFile(source.audio),/FILE_CHANGED/);
});
test('persistent account profile survives browser process closure and stays account isolated',async t=>{
 const dir=await fs.mkdtemp(path.join(root,'profiles-'));
 const launch=profile=>chromium.launchPersistentContext(profile,{channel:'chrome',headless:true});
 const a={id:randomUUID(),provider:'qishui',name:'fixture',dailyLimit:1};
 const prepare=async profile=>{const ctx=await launch(profile);await ctx.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<button>发布全曲</button>'}));return ctx;};
 let manager=new PlatformBrowserSessions(dir,prepare);t.after(()=>manager.close());
 await manager.open(a,origin+'/console/publish',()=>{});
 const page=await manager.qishuiPage(a.id);
 await page.context().addCookies([{name:'fixture_session',value:'test-only',domain:'music.douyin.com',path:'/',expires:Math.floor(Date.now()/1000)+3600,secure:true}]);
 await manager.close();
 manager=new PlatformBrowserSessions(dir,prepare);
 await manager.open(a,origin+'/console/publish',()=>{});
 assert.equal((await(await manager.qishuiPage(a.id)).context().cookies()).some(c=>c.name==='fixture_session'),true);
 const b={...a,id:randomUUID()};await manager.open(b,origin+'/console/publish',()=>{});
 assert.equal((await(await manager.qishuiPage(b.id)).context().cookies()).some(c=>c.name==='fixture_session'),false);
});
