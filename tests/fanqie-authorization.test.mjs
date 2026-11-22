import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright-core';
import sharp from 'sharp';
await build({entryPoints:['src/main/fanqie/authorization.ts'],outfile:'output/fanqie-tests/authorization.cjs',bundle:true,platform:'node',format:'cjs',packages:'external'});
const {prepareFanqieAuthorization}=createRequire(import.meta.url)('../output/fanqie-tests/authorization.cjs');
const pref={mode:'exclusive',platforms:['fanqie_music','fanqie_audio'],confirmContractManually:true};
const available=[
 {id:'1234567890',title:'测试歌曲',stage:'contract_pending',officialStatus:'待授权'},
 {id:'1234567891',title:'另一首待授权',stage:'contract_pending',officialStatus:'待授权'},
 {id:'1234567892',title:'其他待授权',stage:'contract_pending',officialStatus:'待授权'},
];
async function fixture(t,rightsDelay=0,options={}){
 const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const context=await browser.newContext();const page=await context.newPage();
 const list=`<table>${available.map((row,index)=>`
  <tr><td><div class="task-title-content-main"><div class="music-ellipsis-text">${row.title}</div><div class="music-ellipsis-text music-ellipsis-holder">${row.title}</div></div>
  <div>单曲 · 原创</div><div class="task-title-content-desc"><div class="music-ellipsis-text">作品 ID ： ${row.id}</div><button>复制</button></div></td><td>待授权</td>
  <td><svg class="serial-fm-icon-general_edit" onclick="location.href='/creator/music/finished/ugc/uploadProduct?record=${index}'" width=30 height=30><rect width=30 height=30 /></svg></td></tr>`).join('')}</table>`;
 const editor=`
  <h3>选择签约模式</h3>
  <button class="auth-type-card" onclick="this.classList.add('selected');mode=true;ready()">独家授权</button>
  <button class="auth-type-card">非独家授权</button>
  <h3 id="rights-heading">授权信息·</h3><div class="auth-rights-list"></div>
  <button onclick="window.pickerOpened=true;document.querySelector('#picker').hidden=false">添加未授权歌曲</button>
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
   let works=${options.attached ? JSON.stringify(options.attached) : '[anchor]'};
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
    const sync=${JSON.stringify(options.syncPrompt ?? '')};
    if(sync){
     document.body.innerHTML='<div role="dialog"><div class="arco-modal"><h3>'+sync+'</h3><button onclick="window.synced=true;renderPreview()">确认同步</button></div></div>';
     return;
    }
    renderPreview();
   }
   function renderPreview(){
    if(${!!options.unsignedContract}){
     document.body.innerHTML='<div class="contract-step"><h3>确认签约协议</h3><div class="contract-paper"></div></div><div class="action-row"><button class="confirm-button"><span>确认签署</span></button></div>';
     setTimeout(()=>{document.querySelector('.contract-paper').textContent='隔离测试合同正文';},350);
     const button=document.querySelector('.confirm-button');
     button.onclick=()=>{
      window.generated=(window.generated??0)+1;
      button.querySelector('span').textContent='合同生成中';
      setTimeout(()=>{button.hidden=true;window.open('https://verification.invalid/check','_blank');},80);
     };
     return;
    }
    document.body.innerHTML='<h3>确认签约协议</h3><button onclick=window.signed=true>确认签署</button>';
   }
   const picker=document.querySelector('#picker [role=list]');
   const anchorRow=[...picker.children].find(row=>row.querySelector('input').value===anchor);
   picker.append(anchorRow.cloneNode(true));
   picker.querySelectorAll('input').forEach(i=>i.checked=i.value===anchor);
   window.renderFixtureRights = renderRights;
   ${rightsDelay ? '' : 'renderRights();'}
  </script>`;
 await context.route('**/*',r=>{
  const url=new URL(r.request().url());
  let body=url.pathname.endsWith('/ugc')?list:editor;
  if(url.pathname==='/creator/music/contract'){
   const works=options.contractWorks??available.slice(0,2);
   body=`<input placeholder="请输入合同ID">
     <table><tr><td>其他合同</td><td><div>查看作品</div></td><td><button onclick="window.wrongContract=true">签约合同</button></td></tr>
     <tr><td>当前合同</td><td><div onclick="document.querySelector('dialog').showModal()">查看作品</div></td>
     <td><button onclick="window.signingOpened=(window.signingOpened??0)+1;window.open('https://verification.invalid/check','_blank')">签约合同</button></td></tr></table>
     <dialog><h3>作品信息</h3><table><thead><tr><th>作品名称</th><th>作品ID</th></tr></thead><tbody>
       ${works.map(({title,id})=>`<tr><td>${title}</td><td>${id}</td></tr>`).join('')}
     </tbody></table><button onclick="this.closest('dialog').close()">关闭</button></dialog>
     <script>setTimeout(()=>{document.querySelector('input').value='当前合同'},350)</script>`;
  }else if(url.origin==='https://verification.invalid')body='<span>数据安全验证</span><button onclick="window.signed=true">签署</button>';
  return r.fulfill({contentType:'text/html; charset=utf-8',body});
 });
 await page.goto('https://www.novelfm.com/creator/music/finished/ugc/uploadProduct');
 if(rightsDelay)await page.getByRole('heading',{name:'授权信息·',exact:true}).waitFor({state:'visible'});
 return page;
}
test('authorization prepares saved options and stops before legal acceptance',async t=>{
 const page=await fixture(t,300),steps=[];
 assert.equal(await page.getByRole('heading',{name:'授权信息·',exact:true}).count(),1);
 await page.evaluate(()=>{setTimeout(window.renderFixtureRights,300);});
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

await build({stdin:{contents:"export * from './src/main/fanqie/authorize-records'; export * from './src/main/fanqie/upload-broker'; export * from './src/main/fanqie/directory-trace';",resolveDir:process.cwd()},outfile:'output/fanqie-tests/authorize-records.cjs',bundle:true,platform:'node',format:'cjs',packages:'external'});
const {authorizeFanqieRecords,FanqieUploadBroker,FanqieDirectoryTrace}=createRequire(import.meta.url)('../output/fanqie-tests/authorize-records.cjs');
test('an unknown status cannot be treated as proof of authorization',async()=>{
 const row={...available[0],stage:'unknown',officialStatus:'处理中'};
 const session={run:async fn=>fn({newPage:()=>assert.fail('must not open an editor')},()=>{}),
  inspect:async()=>({report:{accountKey:'account'},catalog:{complete:true,rows:[row]}})};
 await assert.rejects(authorizeFanqieRecords(os.tmpdir(),session,'account',[row.id],pref,()=>{}),/FANQIE_CATALOG_STATUS_UNVERIFIED/);
});
test('existing work authorization verifies ID, persists signature boundary and reuses preview',async t=>{
 const page=await fixture(t),context=page.context(),root=fs.mkdtempSync(path.join(os.tmpdir(),'rainfall-auth-'));
 const session={run:async fn=>fn(context,()=>{}),mark:()=>{},inspect:async()=>({report:{accountKey:'account'},catalog:{complete:true,rows:[{id:'1234567890',title:'测试歌曲',stage:'contract_pending',officialStatus:'待授权'}]}})};
 let editor;
 const result=await authorizeFanqieRecords(root,session,'account',['1234567890'],pref,()=>{},undefined,false,{onPreview:page=>{editor=page;}});
 assert.equal(result[0].phase,'awaiting_signature');const count=context.pages().length;
 assert.equal(editor,context.pages().at(-1));
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'production/fanqie/authorizations/account-1234567890.json'),'utf8')).step,'authorization:preview');
 const again=await authorizeFanqieRecords(root,session,'account',['1234567890'],pref,()=>{});assert.equal(again[0].phase,'awaiting_signature');assert.equal(context.pages().length,count);
 assert.equal(await context.pages().at(-1).evaluate(()=>window.signed),undefined);
 await assert.rejects(authorizeFanqieRecords(root,session,'account',['1234567890'],{...pref,mode:'nonexclusive'},()=>{}),/RECONCILIATION_REQUIRED/);
 await context.pages().at(-1).close();await assert.rejects(authorizeFanqieRecords(root,session,'account',['1234567890'],pref,()=>{}),/RECONCILIATION_REQUIRED/);
});

test('one recovery call prepares an uncreated contract for the exact saved works after leaving the preview',async t=>{
 const page=await fixture(t),context=page.context(),root=fs.mkdtempSync(path.join(os.tmpdir(),'rainfall-auth-resume-'));
 const records=available.slice(0,2),ids=records.map(row=>row.id);
 const rows=available.map(row=>({...row,contract:{state:'not_created'}}));
 const session={run:async fn=>fn(context,()=>{}),mark:()=>{},inspect:async()=>({report:{accountKey:'account'},catalog:{complete:true,rows}})};
 await page.goto('https://www.novelfm.com/creator/music/finished/ugc');
 await authorizeFanqieRecords(root,session,'account',ids,pref,()=>{},undefined,true,{records});
 await page.goto('https://www.novelfm.com/creator/music/publishWorks');
 const result=await authorizeFanqieRecords(root,session,'account',ids,pref,()=>{},undefined,true,{records,resume:true});
 assert.equal(result.length,2);
 assert.deepEqual(await page.evaluate(()=>window.previewWorks),records.map(row=>row.title));
 assert.equal(await page.getByRole('button',{name:'确认签署',exact:true}).count(),1);
 assert.equal(await page.evaluate(()=>window.signed),undefined);
 assert.deepEqual(context.pages(),[page]);
});

test('opening an existing contract verifies the official works and opens only the signing page',async t=>{
 const page=await fixture(t),context=page.context(),root=fs.mkdtempSync(path.join(os.tmpdir(),'rainfall-auth-open-'));
 const records=available.slice(0,2),ids=records.map(row=>row.id);
 const contractId='9876543210123456789';
 let rows=available.map(row=>({...row,contract:{state:'not_created'}}));
 const session={run:async fn=>fn(context,()=>{}),mark:()=>{},inspect:async()=>({report:{accountKey:'account'},catalog:{complete:true,rows}})};
 await page.goto('https://www.novelfm.com/creator/music/finished/ugc');
 await authorizeFanqieRecords(root,session,'account',ids,pref,()=>{},undefined,true,{records});
 await page.goto('https://www.novelfm.com/creator/music/publishWorks');
 rows=records.map(row=>({...row,contract:{state:'awaiting_signature',id:contractId}}));
 let opened;
 const result=await authorizeFanqieRecords(root,session,'account',ids,pref,()=>{},undefined,true,
  {records,resume:true,onPreview:(owner,signing)=>{assert.equal(owner,page);opened=signing;}});
 assert.deepEqual(result.map(row=>row.phase),['awaiting_signature','awaiting_signature']);
 assert.equal(opened.contractId,contractId);
 assert.equal(new URL(page.url()).searchParams.get('contract_task_id'),contractId);
 assert.deepEqual(context.pages(),[page,opened.popup]);
 assert.equal(await page.evaluate(()=>window.signingOpened),1);
 assert.equal(await page.evaluate(()=>window.wrongContract),undefined);
 assert.equal(await opened.popup.evaluate(()=>window.signed),undefined);
});

test('resume refuses a contract that lists other uploaded works',async t=>{
 const page=await fixture(t,0,{contractWorks:available}),context=page.context();
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rainfall-auth-contract-scope-'));
 const records=available.slice(0,2),ids=records.map(row=>row.id);
 const rows=records.map(row=>({...row,contract:{state:'awaiting_signature',id:'9876543210123456789'}}));
 const session={run:async fn=>fn(context,()=>{}),mark:()=>{},inspect:async()=>({report:{accountKey:'account'},catalog:{complete:true,rows}})};
 await page.goto('https://www.novelfm.com/creator/music/finished/ugc');
 await assert.rejects(authorizeFanqieRecords(root,session,'account',ids,pref,()=>{},undefined,true,{records,resume:true}),
  /FANQIE_AUTHORIZATION_WORK_MISMATCH/);
 assert.deepEqual(context.pages(),[page]);
 assert.equal(await page.evaluate(()=>window.signingOpened),undefined);
});

test('the upload receipt opens one contract on the verified upload page',async t=>{
 const records=available.slice(0,2),ids=records.map(row=>row.id),titles=records.map(row=>row.title);
 const page=await fixture(t,0,{attached:titles,syncPrompt:'是否将作品同步至番茄畅听？'});
 const context=page.context(),root=fs.mkdtempSync(path.join(os.tmpdir(),'rainfall-upload-auth-'));
 const session={run:async fn=>fn(context,()=>{}),mark:()=>{},inspect:async(_context,_guard,_artists,_trace,queries)=>{
  assert.deepEqual(queries,titles.map(title=>({title})));
  return {report:{accountKey:'account'},catalog:{complete:true,rows:available}};
 }};
 const steps=[];
 const trace={trace:(step,event)=>steps.push([step,event]),watch:()=>()=>{}};
 let prepared;
 const options={uploadedPage:page,trace,records,onPreview:preview=>{prepared=preview;}};
 const result=await authorizeFanqieRecords(root,session,'account',ids,pref,()=>{},undefined,true,options);
 assert.deepEqual(result.map(record=>record.phase),['awaiting_signature','awaiting_signature']);
 assert.equal(prepared,page);
 assert.equal(context.pages().length,1);
 assert.deepEqual(await page.evaluate(()=>({works:window.previewWorks,picker:window.pickerOpened,sync:window.synced,signed:window.signed})),
  {works:titles,picker:undefined,sync:true,signed:undefined});
 for(const step of ['authorization:mode','authorization:preview','authorization:confirm-sync']){
  assert.ok(steps.some(entry=>entry[0]===step&&entry[1]==='begin'));
  assert.ok(steps.some(entry=>entry[0]===step&&entry[1]==='ok'));
 }
 prepared=undefined;
 await authorizeFanqieRecords(root,session,'account',ids,pref,()=>{},undefined,true,options);
 assert.equal(prepared,page);
});

test('mismatched official receipts or attached songs prevent authorization on the upload page',async t=>{
 const records=available.slice(0,2),ids=records.map(row=>row.id);
 const page=await fixture(t,0,{attached:[records[0].title,available[2].title]});
 const context=page.context(),root=fs.mkdtempSync(path.join(os.tmpdir(),'rainfall-mismatched-auth-'));
 let rows=[records[0],{...records[1],stage:'reviewing',officialStatus:'审核中'},available[2]];
 const session={run:async fn=>fn(context,()=>{}),mark:()=>{},inspect:async()=>({report:{accountKey:'account'},catalog:{complete:true,rows}})};
 await assert.rejects(authorizeFanqieRecords(root,session,'account',ids,pref,()=>{},undefined,true,{uploadedPage:page}),/WORK_MISMATCH/);
 rows=available;
 await assert.rejects(authorizeFanqieRecords(root,session,'account',ids,pref,()=>{},undefined,true,{uploadedPage:page}),/WORK_MISMATCH/);
 assert.equal(context.pages().length,1);
 assert.equal(await page.locator('.auth-type-card.selected').count(),0);
 assert.equal(await page.evaluate(()=>window.pickerOpened),undefined);
});

test('a fresh directory preview goes straight to one unsigned contract and records intent before clicking',async t=>{
 const records=available.slice(0,2),ids=records.map(row=>row.id),titles=records.map(row=>row.title);
 const page=await fixture(t,0,{attached:titles,unsignedContract:true});
 const context=page.context(),root=fs.mkdtempSync(path.join(os.tmpdir(),'rainfall-auth-generate-'));
 const rows=records.map(row=>({...row,contract:{state:'not_created'}}));
 const session={run:async fn=>fn(context,()=>{}),mark:()=>{},inspect:async()=>({report:{accountKey:'account'},catalog:{complete:true,rows}})};
 const steps=[];
 const trace={trace:(step,event)=>steps.push([step,event]),watch:()=>()=>{}};
 let popup;
 await authorizeFanqieRecords(root,session,'account',ids,pref,()=>{},undefined,true,{
  uploadedPage:page,trace,records,directPreview:true,beforeGenerate:async preview=>{
   assert.equal(preview,page);
   assert.equal(await page.evaluate(()=>window.generated),undefined);
   assert.equal(await page.locator('.contract-paper').innerText(),'隔离测试合同正文');
   assert.equal(context.pages().length,1);
   popup=page.waitForEvent('popup');
   void popup.catch(()=>{});
  },
 });
 assert.equal(await page.evaluate(()=>window.generated),1);
 assert(steps.some(entry=>entry[0]==='authorization:generate-contract'&&entry[1]==='ok'));
 assert(steps.every(entry=>entry[0]!=='authorization:confirm-sync'));
 const signer=await popup;
 await signer.waitForLoadState('domcontentloaded');
 assert.equal(await signer.opener(),page);
 assert.equal(await signer.locator('span').and(signer.getByText('数据安全验证',{exact:true})).count(),1);
 assert.deepEqual(context.pages(),[page,signer]);
 assert.equal(await signer.evaluate(()=>window.signed),undefined);
});

test('a directory preview leaves an unexpected synchronization prompt for review',async t=>{
 const page=await fixture(t,0,{syncPrompt:'是否将作品同步至番茄畅听？'});
 await assert.rejects(prepareFanqieAuthorization(page,[available[0].title],pref,async()=>{},{directPreview:true}),
  /FANQIE_AUTHORIZATION_SYNC_PROMPT/);
 assert.equal(await page.evaluate(()=>window.synced),undefined);
});

test('optional synchronization requires a matching Fanqie Audio setting and prompt',async t=>{
 for(const [syncPrompt,platforms] of [
  ['是否将作品同步至番茄畅听？',['fanqie_music']],
  ['是否将作品同步至其他平台？',pref.platforms],
 ]){
  const page=await fixture(t,0,{syncPrompt});
  await assert.rejects(prepareFanqieAuthorization(page,[available[0].title],{...pref,platforms},async()=>{}),/PLATFORM_UNVERIFIED/);
  assert.equal(await page.evaluate(()=>window.synced),undefined);
  assert.equal(await page.getByRole('button',{name:'确认同步',exact:true}).isVisible(),true);
 }
});

test('directory trace persists redacted browser and form errors, then detaches',async t=>{
 const page=await fixture(t),root=fs.mkdtempSync(path.join(os.tmpdir(),'rainfall-fanqie-trace-'));
 const trace=new FanqieDirectoryTrace(root,()=>{}).round(2),detach=trace.watch(page);
 t.after(detach);
 const file=path.join(root,'trace.jsonl');
 const entries=()=>fs.readFileSync(file,'utf8').trim().split('\n').map(JSON.parse);
 await trace.trace('upload:materials','begin',page,2);
 await page.evaluate(()=>{
  document.body.insertAdjacentHTML('beforeend',`
   <form><div class="arco-form-item arco-form-item-error">
   <label for="songs_2_name_input">作品名称</label>
   <input id="songs_2_name_input" value="private-field-secret" style="background:#24fd1d">
   <div class="arco-form-item-message">secret-inline-123</div>
   </div><div class="arco-form-item-message">请上传歌词</div>
   <div class="arco-form-item"><label for="songs_1_authorizationFiles_input">版权证明</label>
   <span class="error-message-LrT5c3">上传失败</span></div></form>
   <div class="arco-message-error">secret-toast-123</div>
   <div class="arco-message-error" hidden>hidden-toast</div>`);
  setTimeout(()=>{throw new Error('private-page-error');},0);
 });
 const deadline=Date.now()+5000;
 while(Date.now()<deadline && entries().filter(record=>record.event==='error').length<5)
  await new Promise(resolve=>setTimeout(resolve,30));
 const errors=entries().filter(record=>record.event==='error');
 assert.deepEqual(errors.map(record=>record.code).sort(),[
  'FANQIE_ARCO_INLINE_ERROR','FANQIE_ARCO_TOAST_ERROR','FANQIE_FORM_VALIDATION_ERROR','FANQIE_FORM_VALIDATION_ERROR','FANQIE_PAGE_SCRIPT_ERROR',
 ]);
 assert.ok(errors.every(record=>record.round===2&&record.step==='upload:materials'&&
  record.songIndex===(record.field==='authorizationFiles'?2:3)));
 assert.equal(errors.filter(record=>record.field==='authorizationFiles').length,1);
 for(const record of errors){
  assert.match(record.screenshot,/^screenshots\/[a-z0-9-]+\.png$/);
  assert.equal(fs.readFileSync(path.join(root,record.screenshot)).subarray(1,4).toString(),'PNG');
 }
 const formImage=fs.readFileSync(path.join(root,errors.find(record=>record.code==='FANQIE_FORM_VALIDATION_ERROR').screenshot));
 const pixels=await page.evaluate(async screenshot=>{
  const image=new Image();image.src='data:image/png;base64,'+screenshot;await image.decode();
  const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
  const context=canvas.getContext('2d');context.drawImage(image,0,0);
  const rgba=context.getImageData(0,0,image.width,image.height).data;
  const hasColor=(red,green,blue)=>{
   for(let i=0;i<rgba.length;i+=4)if(rgba[i]===red&&rgba[i+1]===green&&rgba[i+2]===blue)return true;
   return false;
  };
  return {input:hasColor(36,253,29),safeError:hasColor(149,14,58)};
 },formImage.toString('base64'));
 assert.deepEqual(pixels,{input:false,safeError:true});
 detach();
 await page.evaluate(()=>setTimeout(()=>{throw new Error('error-after-detach');},0));
 await page.goto('https://www.novelfm.com.example.invalid/?secret-url');
 await trace.trace('upload:scope','error',page,2,new Error('private error details https://www.novelfm.com/?secret-url'));
 const log=fs.readFileSync(file,'utf8');
 assert.doesNotMatch(log,/private|secret|https:|hidden-toast/);
 assert.deepEqual(entries().map(record=>record.sequence),[1,2,3,4,5,6,7]);
 assert.equal(entries().at(-1).screenshotReason,'non-fanqie-origin');
 assert.equal(entries().at(-1).screenshot,undefined);
});

test('a verified signing page records its visible errors with a redacted image',async t=>{
 const opener=await fixture(t),signer=await opener.context().newPage();
 await signer.setViewportSize({width:640,height:420});
 await opener.context().route('https://signing-frame.invalid/**',route=>route.fulfill({
  contentType:'text/html',body:'<body style="background:#ef4d10"><div class="ant-message-error">child-frame-private</div></body>',
 }));
 const url='https://verification.invalid/check?document=private-contract-id';
 await signer.goto(url);
 await signer.setContent(`<h2>文件签署</h2><button>签署</button>
  <form><input value="806451" style="background:#24fd1d !important"></form>
  <a href="${url}">${url}</a>
  <section style="width:100px;height:50px;background:#afd924">private-contract-terms</section>
  <iframe src="https://signing-frame.invalid/otp-806451" style="height:50px;visibility:visible !important"></iframe>
  <div id="signature" style="height:50px"></div>`);
 await signer.evaluate(()=>{
  const host=document.getElementById('signature');
  host.attachShadow({mode:'closed'}).innerHTML='<div style="background:#5c17ed;height:50px">private-shadow-806451</div>';
 });
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rainfall-signing-trace-'));
 const file=path.join(root,'trace.jsonl'),trace=new FanqieDirectoryTrace(root,()=>{}).round(3);
 const detach=trace.watchSigningPage(signer,url);
 t.after(detach);
 await trace.trace('contract:verification-window','begin',signer);
 await trace.trace('contract:verification-window','ok',signer);
 const foreign=signer.frames().find(frame=>frame.url().startsWith('https://signing-frame.invalid/'));
 await foreign.evaluate(()=>{setTimeout(()=>{throw Error('private-frame-exception');},0);});
 await signer.evaluate(async()=>{
  setTimeout(()=>{throw Error('private-signer-exception 806451');},0);
  const alert=document.createElement('div');
  alert.className='ant-message-error';
  alert.style.cssText='position:absolute;left:470px;top:105px;width:130px;height:32px;background:#666873';
  alert.textContent='验证码错误 806451 private-toast';
  document.body.append(alert);
  await new Promise(resolve=>setTimeout(resolve,25));
  alert.remove();
  document.querySelector('form').insertAdjacentHTML('beforeend','<div class="ant-form-item-explain-error">验证码已过期</div>');
  document.body.insertAdjacentHTML('beforeend','<div role="alert">签署失败 private-alert</div><div class="ant-message-error" hidden>hidden-private</div>');
 });
 await trace.trace('contract:verification-window','ok',signer);
 const log=fs.readFileSync(file,'utf8');
 const errors=log.trim().split('\n').map(JSON.parse).filter(record=>record.event==='error');
 assert.deepEqual(errors.map(record=>record.code).sort(),[
  'FANQIE_PAGE_SCRIPT_ERROR','FANQIE_SIGNING_ALERT_ERROR','FANQIE_SIGNING_TOAST_ERROR','FANQIE_SIGNING_VALIDATION_ERROR',
 ]);
 assert.ok(errors.every(record=>record.round===3&&record.step==='contract:verification-window'));
 assert.doesNotMatch(log,/private|806451|https:/);
 for(const record of errors)assert.match(record.screenshot,/^screenshots\/event-.*\.png$/u);
 const image=path.join(root,errors.find(record=>record.code==='FANQIE_SIGNING_TOAST_ERROR').screenshot);
 const {data,info}=await sharp(image).removeAlpha().raw().toBuffer({resolveWithObject:true});
 const pixel=(x,y)=>Array.from(data.subarray((y*info.width+x)*3,(y*info.width+x)*3+3));
 assert.deepEqual([info.width,info.height],[640,420]);
 assert.notDeepEqual(pixel(475,131),pixel(630,410),'the transient toast geometry remains visible');
 assert.deepEqual(pixel(460,131),pixel(630,410),'the adjacent masked area remains blank');
 const colors=new Set();
 for(let i=0;i<data.length;i+=3)colors.add(data.readUIntBE(i,3));
 for(const privateColor of [0x24fd1d,0xafd924,0xef4d10,0x5c17ed,0x666873])assert.equal(colors.has(privateColor),false);
});

test('signing trace trust expires on navigation and belongs only to the registered page',async t=>{
 const opener=await fixture(t),context=opener.context(),signer=await context.newPage(),unrelated=await context.newPage();
 const url='https://verification.invalid/check';
 await Promise.all([signer.goto(url),unrelated.goto(url)]);
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rainfall-signing-scope-'));
 const trace=new FanqieDirectoryTrace(root,()=>{}).round(1);
 const detach=trace.watchSigningPage(signer,url);
 t.after(detach);
 const fail=(page,code='FANQIE_CONTRACT_LINK_NOT_READY')=>trace.trace('contract:verification-window','error',page,undefined,Error(code));
 await fail(unrelated);
 await fail(signer);
 await fail(signer,'FANQIE_CODE_806451');
 await signer.reload();
 await fail(signer);
 const renewed=trace.watchSigningPage(signer,url);
 t.after(renewed);
 detach();
 await fail(signer);
 renewed();
 await fail(signer);
 const log=fs.readFileSync(path.join(root,'trace.jsonl'),'utf8');
 const [other,verified,secret,navigated,reverified,released]=log.trim().split('\n').map(JSON.parse);
 assert.equal(other.screenshotReason,'non-fanqie-origin');
 assert.equal(other.screenshot,undefined);
 assert.match(verified.screenshot,/^screenshots\/event-.*\.png$/u);
 assert.equal(verified.code,'FANQIE_CONTRACT_LINK_NOT_READY');
 assert.equal(secret.code,'FANQIE_BROWSER_OPERATION_FAILED');
 assert.doesNotMatch(log,/806451/);
 assert.equal(navigated.screenshotReason,'signing-page-navigated');
 assert.equal(navigated.screenshot,undefined);
 assert.match(reverified.screenshot,/^screenshots\/event-.*\.png$/u);
 assert.equal(released.screenshotReason,'signing-page-unregistered');
});

test('directory trace keeps consecutive entries across round instances and resumes',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rainfall-trace-rounds-'));
 const first=new FanqieDirectoryTrace(root,()=>{}).round(1);
 const second=new FanqieDirectoryTrace(root,()=>{}).round(2);
 await Promise.all([first.trace('upload:materials','begin',undefined,0),second.trace('upload:materials','begin',undefined,1)]);
 await new FanqieDirectoryTrace(root,()=>{}).round(2).trace('upload:materials','ok',undefined,1);
 const entries=fs.readFileSync(path.join(root,'trace.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 assert.deepEqual(entries.map(({sequence,round,songIndex})=>[sequence,round,songIndex]),[[1,1,1],[2,2,2],[3,2,2]]);
});

test('directory trace keeps batch counts and drops unrelated or malformed metadata',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rainfall-trace-counts-'));
 const trace=new FanqieDirectoryTrace(root,()=>{}).round(1);
 await trace.trace('directory:scan','ok',undefined,undefined,undefined,{
  candidateCount:7,readyCount:0,batchLimit:3,batchSize:2,submittedCount:2,
  file:'private-song.wav',token:'private-token',
 });
 await trace.trace('directory:form','ok',undefined,undefined,undefined,{
  batchLimit:'private-limit',batchSize:-1,submittedCount:0.5,
 });
 const contents=fs.readFileSync(path.join(root,'trace.jsonl'),'utf8');
 const [counts,invalid]=contents.trim().split('\n').map(JSON.parse);
 assert.deepEqual(counts.details,{candidateCount:7,readyCount:0,batchLimit:3,batchSize:2,submittedCount:2});
 assert.equal(invalid.details,undefined);
 assert.doesNotMatch(contents,/private/);
});

test('a transient visible toast keeps the step that caused it',async t=>{
 const page=await fixture(t),root=fs.mkdtempSync(path.join(os.tmpdir(),'rainfall-trace-toast-'));
 await page.setViewportSize({width:640,height:420});
 const trace=new FanqieDirectoryTrace(root,()=>{}).round(1),detach=trace.watch(page);
 t.after(detach);
 await trace.trace('upload:materials','begin',page,0);
 await trace.trace('upload:materials','ok',page,0);
 await page.evaluate(async()=>{
  const toast=document.createElement('div');
  toast.className='arco-message-error';toast.textContent='上传失败';
  toast.style.cssText='position:fixed;left:460px;top:45px;width:120px;height:40px';
  document.body.append(toast);
  await new Promise(resolve=>setTimeout(resolve,25));
  toast.remove();
 });
 await trace.trace('upload:next','begin',page,1);
 const entries=fs.readFileSync(path.join(root,'trace.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 assert.deepEqual(entries.map(({step,event,songIndex,code})=>[step,event,songIndex,code]),[
  ['upload:materials','begin',1,undefined],['upload:materials','ok',1,undefined],
  ['upload:materials','error',1,'FANQIE_ARCO_TOAST_ERROR'],['upload:next','begin',2,undefined],
 ]);
 const {data,info}=await sharp(path.join(root,entries[2].screenshot)).removeAlpha().raw().toBuffer({resolveWithObject:true});
 const pixel=(x,y)=>data.subarray((y*info.width+x)*3,(y*info.width+x)*3+3);
 assert.notDeepEqual(pixel(470,80),pixel(450,80),'the PNG marks where the removed toast appeared');
});

test('directory trace captures visible error alerts outside the upload form',async t=>{
 const page=await fixture(t),root=fs.mkdtempSync(path.join(os.tmpdir(),'rainfall-trace-page-alert-'));
 const trace=new FanqieDirectoryTrace(root,()=>{}).round(1),detach=trace.watch(page);
 t.after(detach);
 await trace.trace('open-finished-release','begin',page);
 await page.evaluate(()=>document.body.insertAdjacentHTML('beforeend',`
  <svg role="alert" width="20" height="20"></svg>
  <aside role="alert">上传出错，请重试 private-detail</aside>
  <aside role="alert">上传完成</aside>
  <aside data-severity="error">private-error-notice</aside>
  <aside role="alert" hidden>上传失败</aside>`));
 await trace.trace('open-finished-release','ok',page);
 const contents=fs.readFileSync(path.join(root,'trace.jsonl'),'utf8');
 const errors=contents.trim().split('\n').map(JSON.parse).filter(record=>record.event==='error');
 assert.deepEqual(errors.map(record=>record.code),['FANQIE_PAGE_ALERT_ERROR','FANQIE_PAGE_ALERT_ERROR']);
 assert.ok(errors.every(record=>record.step==='open-finished-release'&&record.screenshot));
 assert.doesNotMatch(contents,/private/);
});

test('directory trace attributes errors after a nested readback to its enclosing operation',async t=>{
 const page=await fixture(t),root=fs.mkdtempSync(path.join(os.tmpdir(),'rainfall-trace-parent-step-'));
 const trace=new FanqieDirectoryTrace(root,()=>{}).round(1),detach=trace.watch(page);
 t.after(detach);
 await trace.trace('first-step:confirm-upload','begin',page);
 await trace.trace('first-step:readback','begin',page,4);
 await trace.trace('first-step:readback','ok',page,4);
 await page.evaluate(()=>document.body.insertAdjacentHTML('beforeend','<div class="arco-message-error">上传失败</div>'));
 await trace.trace('first-step:confirm-upload','ok',page);
 const entries=fs.readFileSync(path.join(root,'trace.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 assert.deepEqual(entries.filter(record=>record.event==='error').map(({step,songIndex,code})=>[step,songIndex,code]),[
  ['first-step:confirm-upload',null,'FANQIE_ARCO_TOAST_ERROR'],
 ]);
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
