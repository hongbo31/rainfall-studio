import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright-core';
await build({entryPoints:['src/main/fanqie/authorization.ts'],outfile:'output/fanqie-tests/authorization.cjs',bundle:true,platform:'node',format:'cjs',packages:'external'});
const {prepareFanqieAuthorization}=createRequire(import.meta.url)('../output/fanqie-tests/authorization.cjs');
const pref={mode:'exclusive',platforms:['fanqie_music','fanqie_audio'],confirmContractManually:true};
const available=[
 {id:'1234567890',title:'测试歌曲',stage:'contract_pending',officialStatus:'待授权'},
 {id:'1234567891',title:'另一首待授权',stage:'contract_pending',officialStatus:'待授权'},
 {id:'1234567892',title:'其他待授权',stage:'contract_pending',officialStatus:'待授权'},
];
async function fixture(t,rightsDelay=0){
 const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const context=await browser.newContext();const page=await context.newPage();
 const list=`<table>${available.map((row,index)=>`
  <tr><td><div>${row.title}</div><div hidden>${row.title}</div><div>作品ID：${row.id}</div></td><td>待授权</td>
  <td><svg class="serial-fm-icon-general_edit" onclick="location.href='/creator/music/finished/ugc/uploadProduct?record=${index}'" width=30 height=30><rect width=30 height=30 /></svg></td></tr>`).join('')}</table>`;
 const editor=`
  <h3>选择签约模式</h3>
  <button class="auth-type-card" onclick="this.classList.add('selected');mode=true;ready()">独家授权</button>
  <button class="auth-type-card">非独家授权</button>
  <h3 id="rights-heading">授权信息·</h3><div class="auth-rights-list"></div>
  <button onclick="document.querySelector('#picker').hidden=false">添加未授权歌曲</button>
  <section id="picker" hidden>
    <span id="picked-count">(已选1首)</span>
    <div role="list">${available.map(row=>`<div class="unauth-song-item"><span>${row.title}</span><label class="arco-checkbox"><input type="checkbox" value="${row.title}" onchange="updateCount()"></label></div>`).join('')}</div>
    <label class="arco-checkbox"><input type="checkbox" onchange="document.querySelectorAll('#picker [role=list] input').forEach(i=>i.checked=this.checked);updateCount()">全选</label>
    <button onclick="addSelected()">确认添加</button>
  </section>
  <div class="arco-form-item">
   <label for="sign_identity_input"> 签约身份</label>
   <button type="button" role="combobox" id="sign_identity_input" onclick="document.querySelector('[role=option]').hidden=false">请选择签约身份</button>
  </div>
  <div role="option" hidden onclick="document.querySelector('#sign_identity_input').textContent='个人';identity=true;this.hidden=true;ready()">个人</div>
  <h3 onclick="document.querySelector('#platforms').hidden=true">签约信息</h3>
  <div class="platform-panel-trigger" onclick="document.querySelector('#platforms').hidden=false"><img alt="番茄音乐"></div>
  <div id="platforms" class="platform-panel-panel" hidden>
   <div class="platform-panel-item"><span>番茄音乐</span><input type="checkbox" role="switch" checked disabled></div>
   <div class="platform-panel-item"><span>番茄畅听</span><input type="checkbox" role="switch" onchange="document.querySelector('.platform-panel-trigger').insertAdjacentHTML('beforeend','<img alt=番茄畅听>')"></div>
  </div>
  <button id="next" disabled onclick="preview()">下一步</button>
  <script>
   let mode=false,identity=false;
   let titles=${JSON.stringify(available.map(row=>row.title))};
   let anchor=titles[Number(new URL(location.href).searchParams.get('record') ?? '0')];
   let works=[anchor];
   function ready(){document.querySelector('#next').disabled=!(mode&&identity)}
   function renderRights(){
    document.querySelector('#rights-heading').textContent='授权信息·'+works.length;
    document.querySelector('.auth-rights-list').innerHTML=works.map((title,index)=>'<div class="auth-right-item"><div class="song-name">'+title+'</div><div class="rights-selection"><svg class="serial-fm-icon-general_delete delete-icon" onclick="removeRight('+index+')" width="16" height="16"><rect width="16" height="16"/></svg></div></div>').join('');
   }
   function selectedWorks(){return [...document.querySelectorAll('#picker [role=list] input:checked')].map(i=>i.value)}
   function updateCount(){document.querySelector('#picked-count').textContent='(已选'+new Set(selectedWorks()).size+'首)'}
   function addSelected(){
    works=selectedWorks();
    document.querySelector('#picker').hidden=true;
    renderRights();
   }
   function removeRight(index){
    window.removedRights=[...(window.removedRights??[]),works[index]];
    works.splice(index,1);
    renderRights();
   }
   function preview(){
    window.previewWorks=works;
    document.body.innerHTML='<h3>确认签约协议</h3><button onclick=window.signed=true>确认签署</button>';
   }
   const picker=document.querySelector('#picker [role=list]');
   const anchorRow=[...picker.children].find(row=>row.querySelector('input').value===anchor);
   picker.append(anchorRow.cloneNode(true));
   picker.querySelectorAll('input').forEach(i=>i.checked=i.value===anchor);
   setTimeout(renderRights,${rightsDelay});
  </script>`;
 await context.route('**/*',r=>r.fulfill({
  contentType:'text/html; charset=utf-8',
  body:r.request().url().endsWith('/ugc')?list:editor,
 }));
 await page.goto('https://www.novelfm.com/creator/music/finished/ugc/uploadProduct');return page;
}
test('authorization prepares saved options and stops before legal acceptance',async t=>{
 const page=await fixture(t,300),steps=[];
 assert.equal(await page.getByRole('heading',{name:'授权信息·',exact:true}).count(),1);
 const result=await prepareFanqieAuthorization(page,['测试歌曲'],pref,async step=>{
  assert.equal(await page.locator('.auth-right-item .song-name').innerText(),'测试歌曲');
  steps.push(step);
 });
 assert.deepEqual(result,{phase:'awaiting_signature',contractAccepted:false});assert.equal(await page.getByRole('button',{name:'确认签署'}).count(),1);assert.equal(await page.evaluate(()=>window.signed),undefined);assert.equal(steps.at(-1),'authorization:preview');
});
test('authorization refuses wrong song before changing the form',async t=>{
 const page=await fixture(t),steps=[];await assert.rejects(prepareFanqieAuthorization(page,['另一首'],pref,async s=>steps.push(s)),/WORK_MISMATCH/);assert.deepEqual(steps,[]);
});
test('authorization refuses unsupported platform selection',async t=>{
 const page=await fixture(t);await assert.rejects(prepareFanqieAuthorization(page,['测试歌曲'],{...pref,platforms:['fanqie_audio']},async()=>{}),/PREFERENCE_INVALID/);
});

await build({stdin:{contents:"export * from './src/main/fanqie/authorize-records'; export * from './src/main/fanqie/upload-broker';",resolveDir:process.cwd()},outfile:'output/fanqie-tests/authorize-records.cjs',bundle:true,platform:'node',format:'cjs',packages:'external'});
const {authorizeFanqieRecords,FanqieUploadBroker}=createRequire(import.meta.url)('../output/fanqie-tests/authorize-records.cjs');
test('existing work authorization verifies ID, persists signature boundary and reuses preview',async t=>{
 const page=await fixture(t),context=page.context(),root=fs.mkdtempSync(path.join(os.tmpdir(),'rainfall-auth-'));
 const session={run:async fn=>fn(context,()=>{}),mark:()=>{},inspect:async()=>({report:{accountKey:'account'},catalog:{complete:true,rows:[{id:'1234567890',title:'测试歌曲',stage:'contract_pending',officialStatus:'待授权'}]}})};
 const result=await authorizeFanqieRecords(root,session,'account',['1234567890'],pref,()=>{});
 assert.equal(result[0].phase,'awaiting_signature');const count=context.pages().length;
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'production/fanqie/authorizations/account-1234567890.json'),'utf8')).step,'authorization:preview');
 const again=await authorizeFanqieRecords(root,session,'account',['1234567890'],pref,()=>{});assert.equal(again[0].phase,'awaiting_signature');assert.equal(context.pages().length,count);
 assert.equal(await context.pages().at(-1).evaluate(()=>window.signed),undefined);
 await assert.rejects(authorizeFanqieRecords(root,session,'account',['1234567890'],{...pref,mode:'nonexclusive'},()=>{}),/RECONCILIATION_REQUIRED/);
 await context.pages().at(-1).close();await assert.rejects(authorizeFanqieRecords(root,session,'account',['1234567890'],pref,()=>{}),/RECONCILIATION_REQUIRED/);
});

test('upload batch prepares one contract for verified uploads and keeps unrelated pending songs out',async t=>{
 const page=await fixture(t),context=page.context(),root=fs.mkdtempSync(path.join(os.tmpdir(),'rainfall-group-auth-'));
 const accountKey='a'.repeat(64),rows=[available[2]];
 const workIds=['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002'];
 const catalog={complete:true,source:'browser',url:'https://www.novelfm.com/creator/music/finished/ugc',rows};
 const authors={lyricist:'测试艺人',composer:'测试艺人',singer:'测试艺人'};
 const session={
  status:()=>({connected:true,report:{accountKey}}),
  run:async fn=>fn(context,()=>{}),
  mark:()=>{},
  inspect:async()=>({
   accountId:'12345678',report:{accountKey},catalog:{...catalog,total:rows.length},
   artists:[{artistId:'12345678',name:authors.singer}],
  }),
 };
 const sha=value=>createHash('sha256').update(value).digest('hex');
 let uploads=0;
 const broker=new FanqieUploadBroker({
  root,session,available:()=>true,generation:()=>1,verify:async()=>{},
  work:async item=>({...item,artistId:workIds[0],title:available[workIds.indexOf(item.workId)].title,ai:'generated',fingerprint:sha(item.workId)}),
  materials:async(_root,source)=>Object.fromEntries(['audio','lyrics','cover'].map(role=>{
   const file=path.join(root,source.workId+'-'+role),data=source.workId+role;
   fs.writeFileSync(file,data);return [role,{file,bytes:data.length,sha256:sha(data)}];
  })),
  execute:async(_context,input,callbacks)=>{
   await callbacks.intent('first-step:confirm-upload');uploads++;
   rows.push(available.find(row=>row.title===input.title));
  },
 });
 await broker.ui('saveConfiguration',{version:1,authors,useWorkMaterials:true,publicationConsent:true,authorizationPreference:pref});
 const request={items:workIds.map(workId=>({workId,variant:'A'}))};
 const {batch,jobs}=await broker.ui('publishBatch',request);
 const expected=available.slice(0,2);
 assert.equal(batch.state,'complete',JSON.stringify(batch));
 assert.deepEqual(batch.authorization.map(record=>[record.id,record.phase]),expected.map(row=>[row.id,'awaiting_signature']));
 assert.equal(uploads,2);
 assert.equal(context.pages().length,2);
 const preview=context.pages().at(-1);
 assert.deepEqual(await preview.evaluate(()=>window.previewWorks),expected.map(row=>row.title));
 assert.deepEqual(await preview.evaluate(()=>window.removedRights),[expected[0].title]);
 assert.equal(await preview.evaluate(()=>window.signed),undefined);
 const ids=expected.map(row=>row.id);
 const exact=await broker.ui('authorizeExisting',{accountKey,ids:[...ids].reverse()});
 assert.equal(exact.authorization.length,2);
 await assert.rejects(broker.ui('authorizeExisting',{accountKey,ids:[ids[0]]}),/RECONCILIATION_REQUIRED/);
 assert.equal(context.pages().length,2);
 await preview.close();
 const repeat=await broker.ui('publishBatch',request);
 assert.equal(repeat.batch.authorizationError,'FANQIE_AUTHORIZATION_RECONCILIATION_REQUIRED');
 assert.equal(uploads,2);
 for(const row of expected)rows[rows.findIndex(item=>item.id===row.id)]={...row,stage:'reviewing',officialStatus:'审核中'};
 const recovered=await broker.ui('publishBatch',{...request,resume:true});
 assert.deepEqual(recovered.batch.authorization.map(record=>record.status),['审核中','审核中']);
 const refreshed=await broker.ui('reconcile',{id:jobs[0].id});
 assert.equal(refreshed.jobs.filter(job=>job.phase==='recorded').length,2);
 assert.equal(uploads,2);
});

test('authorization refuses a picker that includes an unexpected preselected work',async t=>{
 const page=await fixture(t),steps=[];
 await page.locator('#picker input').nth(2).evaluate(input=>{input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));});
 await assert.rejects(prepareFanqieAuthorization(page,available.slice(0,2).map(row=>row.title),pref,async step=>steps.push(step)),/PICKER_MISMATCH/);
 assert.deepEqual(steps,['authorization:open-picker']);
});
