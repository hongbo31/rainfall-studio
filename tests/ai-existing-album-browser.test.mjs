import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright-core';

const out=path.resolve('output/existing-album-browser-tests/adapter.cjs');
await build({entryPoints:['src/main/tme/ai-existing-album-browser.ts'],outfile:out,bundle:true,platform:'node',format:'cjs',packages:'external'});
const api=createRequire(import.meta.url)(out);
const hash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const origin='https://y.tencentmusic.com',route=origin+'/#/user/manage/aiChoose/add';
const pendingPath='/openapi/musician/original/cursorUnPublishSong';
const pdfBytes='Rainfall isolated existing-album authorization fixture v1',termsText='非独家授权 测试授权书';
const binding={transport:'cloud-playwright',sessionId:randomUUID(),pageId:randomUUID(),started:'2026-10-18T10:00:00.000Z'};
const identity={kugouId:'123456789',qqDisplayName:'Fixture QQ',artistName:'Fixture Artist'};
const subjectHash=hash({subjectType:'official_visible_binding_fingerprint',...identity});
const metadata={title:'Fixture song',albumMode:'existing',albumTitle:'Exact album',albumDescription:'Local description',artistName:identity.artistName,lyricist:'Fixture Lyricist',composer:'Fixture Composer',ownLyrics:true,ownComposition:false,aiTool:'Fixture tool',generatedOn:'2026-10-18',allowCover:false,genre:'流行',language:'国语',version:'完整版',releaseMode:'审核通过即发布'};
const lyricsText='These are explicitly synthetic fixture lyrics.';
const authorization='我已阅读授权书，并确认向腾讯音乐人授权';
let browser;
before(async()=>{browser=await chromium.launch({executablePath:process.env.RAINFALL_TEST_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});});
after(async()=>{await browser?.close();});
const header=`<div class="mod_top_login"><div class="top_login__links"><span class="name">${identity.artistName}</span></div></div>`;
const accountHtml=`<button role="tab" aria-selected="false">绑定其他平台账号</button><div class="account-item"><span class="account-item-content-label">QQ音乐</span><span class="account-item-content-value">已绑定个人账号：${identity.qqDisplayName}</span></div><div class="account-item"><span class="account-item-content-label">酷狗音乐</span><span class="account-item-content-value">已绑定酷狗ID：${identity.kugouId}</span><span class="account-item-content-value">已绑定酷狗音乐推ID：${identity.kugouId}（酷狗音乐关联）</span></div>`;
const checkbox=(name,checked=false)=>`<label class="el-checkbox"><input type="checkbox" style="display:none" ${checked?'checked':''}><span>${name}</span></label>`;
const radio=name=>`<label class="el-radio"><input type="radio" checked style="display:none"><span>${name}</span></label>`;
const author=(label,name,own,checked)=>`<div class="base-form-item"><label class="base-form-item__label">${label}</label><div class="person-selector"><span class="el-select__tags-text">${name}</span>${checkbox(own,checked)}</div></div>`;
function editor(options={}){
 return `<h4>上传AI歌曲 ( 1首 )</h4><div class="upload-song__row">${metadata.title}.wav 00:01</div>
 <input placeholder="请输入歌曲名称，最多60字" value="${metadata.title}">
 <div class="base-form-item"><label class="base-form-item__label">歌手名</label><div class="person-selector"><span class="el-select__tags-text">${identity.artistName}</span></div></div><label>曲风</label>
 ${author('作词',options.lyricist??metadata.lyricist,'我是作词人',options.ownLyrics??metadata.ownLyrics)}
 ${author('作曲',metadata.composer,'我是作曲人',metadata.ownComposition)}
 <h4>AI制作信息</h4>
 <input placeholder="请选择曲风" value="${metadata.genre}"><input placeholder="请选择语种" value="${metadata.language}">
 <input placeholder="请选择或填写您的生成工具名称" value="${metadata.aiTool}"><input placeholder="请选择生成时间" value="${metadata.generatedOn}">
 <textarea placeholder="10-20000字">${lyricsText}</textarea>${radio('完整版')}${radio('审核通过即发布')}
 <label class="el-switch"><input type="checkbox" style="display:none"><span>允许翻唱</span></label>
 <div class="album-search"><input id="album-search" placeholder="选择已发布专辑" ${options.noAlbum?'':'style="display:none"'}>
 <div class="selected" ${options.noAlbum?'style="display:none"':''}><div class="album"><img width="20" height="20" src="${origin}/fixture-cover.png"><strong>${options.album??metadata.albumTitle}</strong></div></div></div>
 <div class="search-result-item" style="display:none"><span class="album-name">Exact album</span><span class="singer-name">Different Artist</span></div>
 <div class="search-result-item" style="display:none"><span class="album-name">Exact album</span><span class="singer-name">${identity.artistName}</span></div>
 ${options.duplicateAlbum?`<div class="search-result-item" style="display:none"><span class="album-name">Exact album</span><span class="singer-name">${identity.artistName}</span></div>`:''}
 <button id="next">下一步</button>`;
}
async function fixture(t,options={}){
 const context=await browser.newContext({serviceWorkers:'block'});t.after(()=>context.close());
 const state={rows:options.rows??[{id:'18281901',name:metadata.title,albumId:'6437318',albumName:metadata.albumTitle,status:0}],requests:[],...options};
 const authorizationHtml=`<h2>确认授权模式</h2><div>非独家授权</div><iframe src="${origin}/static/pdfjs/web/viewer.html"></iframe>${checkbox(authorization)}<button id="submit" disabled>提交审核</button>`;
 const initial=options.mode==='terms'?authorizationHtml:options.mode==='intake'?'<h4>上传AI歌曲</h4><input type="file" class="upload-content-input" accept="audio/wav">':editor(options);
 await context.route('**/*',async r=>{
  const req=r.request(),url=new URL(req.url());state.requests.push({url:req.url(),method:req.method()});assert.equal(url.origin,origin,'Every HTTP request must be intercepted inside the fixture');
  if(url.pathname===pendingPath){await r.fulfill({contentType:'application/json',body:JSON.stringify({code:'0',data:{content:state.rows}})});return;}
  if(url.pathname==='/static/pdfjs/web/viewer.html'){
   const bytes=Array.from(Buffer.from(state.badPdf?'unknown document':pdfBytes));
   await r.fulfill({contentType:'text/html',body:`<body>Fixture PDF<script>window.PDFViewerApplication={pdfDocument:{numPages:1,getData:async()=>new Uint8Array(${JSON.stringify(bytes)}),getPage:async()=>({getTextContent:async()=>({items:[{str:${JSON.stringify(state.termsText??termsText)}}]})})}};</script>`});return;
  }
  if(!req.isNavigationRequest()){await r.abort();return;}
  const rows=state.rows.map(row=>`<tr><td>${row.name}</td><td>${row.albumName}</td><td>${state.visibleStatus??'审核中'}</td></tr>`).join('');
  await r.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><body>${header}<main>${initial}</main><script>
  window.clicks={next:0,submit:0,accept:0,upload:0};
  function wire(){
   document.querySelector('#next')?.addEventListener('click',()=>{clicks.next++;document.querySelector('main').innerHTML=${JSON.stringify(authorizationHtml)};wire();});
   document.querySelector('#submit')?.addEventListener('click',()=>{clicks.submit++;});
   for(const l of document.querySelectorAll('label.el-checkbox')) l.addEventListener('click',e=>{if(e.target.tagName!=='INPUT'){e.preventDefault();const i=l.querySelector('input');i.checked=!i.checked;if(l.innerText.trim()===${JSON.stringify(authorization)}){clicks.accept++;document.querySelector('#submit').disabled=!i.checked;}}});
   document.querySelector('#album-search')?.addEventListener('click',()=>{for(const option of document.querySelectorAll('.search-result-item'))option.style.display='block';});
   for(const option of document.querySelectorAll('.search-result-item'))option.addEventListener('click',()=>{window.albumSelection=option.querySelector('.singer-name').textContent;document.querySelector('.selected').style.display='block';document.querySelector('#album-search').style.display='none';for(const o of document.querySelectorAll('.search-result-item'))o.style.display='none';});
   document.querySelector('input[type=file]')?.addEventListener('change',()=>{clicks.upload++;document.querySelector('main').innerHTML=${JSON.stringify(editor(options))};wire();});
  }function render(){if(location.hash.includes('/albumlist')){document.querySelector('main').innerHTML='';fetch('${pendingPath}',{method:'POST',body:'{}'}).then(r=>r.json()).then(()=>document.body.insertAdjacentHTML('beforeend',${JSON.stringify('<div class="el-table__body-wrapper"><table>'+rows+'</table></div>')}));}else if(location.hash.includes('/musician/edit')){document.querySelector('main').innerHTML=${JSON.stringify(accountHtml)};document.querySelector('[role=tab]').onclick=e=>e.currentTarget.setAttribute('aria-selected','true');}else wire();}addEventListener('hashchange',render);render();</script>`});
 });
 const page=await context.newPage();await page.goto(route);await page.locator('.name').waitFor();
 const accountState={identity:{...identity},binding:{...binding}};
 const config={page,account:async()=>accountState,now:()=>new Date('2026-10-18T10:00:01.000Z'),isolatedFixture:true};
 const input={binding,artistName:identity.artistName,metadata,lyricsText,expectedAudioDuration:'00:01'};
 const prepare=api.createTmeExistingAlbumPreparePort(config),executor=api.createTmeExistingAlbumSubmissionExecutor(config);
 const grant={input:{metadata,identity:{...identity,subjectHash},binding}};
 const baseJob={id:randomUUID(),workId:randomUUID(),scopeHash:'b'.repeat(64),state:'dispatching',rightsConfirmed:true,termsHash:hash(termsText),termsDocumentSha256:hash(pdfBytes)};
 const claim=(phase='accept')=>{
  const op={id:randomUUID(),kind:'tme_ai_submission',phase,state:'dispatching',jobId:baseJob.id,scopeHash:baseJob.scopeHash,createdAt:'2026-10-18T10:00:00.000Z'};
  if(phase==='submit')op.receiptScope={workId:baseJob.workId,scopeHash:baseJob.scopeHash,subjectHash,binding,title:metadata.title,albumTitle:metadata.albumTitle,artistName:identity.artistName,baselineSongIds:[],termsDocumentSha256:hash(pdfBytes)};
  return{job:{...baseJob,operationId:op.id,termsAccepted:phase==='submit'},operation:op,operations:[op],prepared:{grant}};
 };
 const clicks=()=>page.evaluate(()=>window.clicks);
 return{page,context,state,config,input,prepare,executor,claim,clicks,accountState};
}

test('production constructors remain unavailable and never inspect or write',async()=>{
 let touched=0;const options={page:{url:()=>{touched++;return route}},account:async()=>{touched++;throw Error('unexpected')}};
 for(const port of [api.createTmeExistingAlbumPreparePort(options),api.createTmeExistingAlbumSubmissionExecutor(options)])assert.deepEqual(port.capability(),{available:false,reasons:['EXISTING_ALBUM_WRITE_INTEGRATION_UNVERIFIED'],transport:'cloud-playwright'});
 await assert.rejects(api.createTmeExistingAlbumPreparePort(options).request('inspect'),/INTEGRATION_UNVERIFIED/);
 await assert.rejects(api.createTmeExistingAlbumSubmissionExecutor(options).observe({}),/PREPARATION_REQUIRED|INTEGRATION_UNVERIFIED/);assert.equal(touched,0);
});
test('editor inspection uses Main identity and independently reads author membership and inherited cover',async t=>{
 const x=await fixture(t),raw=(await x.prepare.request('inspect',x.input)).snapshot;
 assert.deepEqual(raw.identity,identity);assert.deepEqual(raw.binding,binding);assert.equal(raw.form.ownLyrics,true);assert.equal(raw.form.ownComposition,false);assert.equal(raw.form.composer,metadata.composer);
 assert.deepEqual(raw.existingAlbum,{title:metadata.albumTitle,coverInherited:true,coverReadOnly:true});assert.equal(raw.coverState.manualSelected,false);assert.deepEqual(await x.clicks(),{next:0,submit:0,accept:0,upload:0});
});
test('exact existing album selection and metadata fill are bounded; unrelated artist option does not match',async t=>{
 const x=await fixture(t,{noAlbum:true});await x.page.locator('input[placeholder="请选择或填写您的生成工具名称"]').fill('');
 const r=await x.prepare.request('step',{...x.input,step:'fill_metadata'});assert.equal(r.snapshot.form.albumTitle,metadata.albumTitle);assert.equal(r.snapshot.form.aiTool,metadata.aiTool);
 assert.equal(await x.page.evaluate(()=>window.albumSelection),identity.artistName);
 await assert.rejects(x.prepare.request('step',{...x.input,step:'fill_metadata'}),/ALREADY_DISPATCHED/);assert.equal((await x.clicks()).submit,0);
});
test('ambiguous exact album candidates never choose the first',async t=>{
 const x=await fixture(t,{noAlbum:true,duplicateAlbum:true});await assert.rejects(x.prepare.request('step',{...x.input,step:'fill_metadata'}),/ALBUM_EXACT_MATCH_REQUIRED/);assert.equal(await x.page.locator('.selected').isVisible(),false);
});
test('author conflicts, unknown album mode, changed binding and account stop before metadata writes',async t=>{
 for(const change of ['author','mode','binding','account']){
  const x=await fixture(t,change==='author'?{lyricist:'Conflicting author'}:{});const input={...x.input,step:'fill_metadata'};
  if(change==='mode')input.metadata={...metadata,albumMode:'new'};if(change==='binding')input.binding={...binding,pageId:randomUUID()};if(change==='account')x.accountState.identity.qqDisplayName='Changed account';
  if(change==='account'){await x.prepare.request('inspect',x.input);x.accountState.identity.qqDisplayName='Changed again';}
  await assert.rejects(x.prepare.request('step',input),/AUTHOR_CHIP_CONFLICT|EXISTING_ALBUM_MODE_REQUIRED|WINDOW_BINDING_CHANGED|ACCOUNT_CHANGED/);assert.equal((await x.clicks()).next,0);
 }
});
test('cover step inherits the selected album and never reads a local cover path',async t=>{
 const x=await fixture(t),r=await x.prepare.request('step',{...x.input,step:'set_cover',coverPath:'C:/must-not-read/missing.png'});assert.equal(r.status,'verified_existing');assert.equal((await x.clicks()).upload,0);
 await x.page.locator('main').evaluate(el=>el.insertAdjacentHTML('beforeend','<input type="file" accept="image/png">'));
 await assert.rejects(x.prepare.request('step',{...x.input,step:'set_cover'}),/COVER_NOT_READ_ONLY/);
});
test('local album snapshot captures baseline through page POST plus visible rows without external save',async t=>{
 const x=await fixture(t),r=await x.prepare.request('step',{...x.input,step:'save_album'});assert.deepEqual(r.receiptBaseline,{songIds:['18281901'],source:'official-list'});assert.deepEqual(r.snapshot.receiptBaseline,r.receiptBaseline);assert.equal(r.snapshot.saveEvidence.remoteSavedVerified,false);
 assert.deepEqual(x.context.pages(),[x.page]);assert.equal(x.state.requests.filter(r=>new URL(r.url).pathname===pendingPath&&r.method==='POST').length,1);assert.equal((await x.clicks()).submit,0);
});
test('next previews pinned PDF bytes and text without accepting or submitting',async t=>{
 const x=await fixture(t),r=await x.prepare.request('step',{...x.input,step:'advance_to_terms'});assert.equal(r.snapshot.mode,'ai_authorization');assert.equal(r.snapshot.termsText,termsText);assert.equal(r.snapshot.termsDocumentSha256,hash(pdfBytes));assert.deepEqual(await x.clicks(),{next:1,submit:0,accept:0,upload:0});
});
test('unknown PDF document and unknown authorization mode fail closed',async t=>{
 const x=await fixture(t,{mode:'terms',badPdf:true});await assert.rejects(x.executor.observe(x.claim()),/TERMS_DOCUMENT_CHANGED/);assert.equal((await x.clicks()).accept,0);
 const y=await fixture(t,{mode:'terms'});await y.page.locator('main').evaluate(el=>el.insertAdjacentHTML('beforeend','<p>独家授权模式</p>'));await assert.rejects(y.executor.observe(y.claim()),/AUTHORIZATION_MODE_CHANGED/);
});
test('hidden native agreement input is clicked through exact visible label only after durable claims',async t=>{
 const x=await fixture(t,{mode:'terms'});const invalid=x.claim();delete invalid.operation;await assert.rejects(x.executor.accept(invalid),/SUBMISSION_CLAIM_REQUIRED/);assert.equal((await x.clicks()).accept,0);
 const result=await x.executor.accept(x.claim());assert.equal(result.status,'accepted');assert.equal(result.snapshot.termsDocumentSha256,hash(pdfBytes));assert.equal((await x.clicks()).accept,1);assert.equal((await x.clicks()).submit,0);
});
test('single submit yields only independent exact song receipt with dispatch-intent timestamp',async t=>{
 const x=await fixture(t,{mode:'terms'});await x.executor.accept(x.claim());const c=x.claim('submit'),result=await x.executor.submit(c);assert.equal(result.status,'reviewing');assert.equal(result.receipt.remoteId,'18281901');assert.equal(result.receipt.submittedAt,c.operation.createdAt);assert.equal(result.receipt.submittedAtSource,'dispatch-intent');assert.equal(result.receipt.entityType,'song');
 assert.equal((await x.executor.submit(x.claim('submit'))).reason,'SUBMISSION_ALREADY_DISPATCHED');assert.equal((await x.clicks()).submit,1);
});
test('baseline, album-only ID, wrong album and duplicate exact songs cannot certify a submission',async t=>{
 for(const kind of ['baseline','album-id','album-title','duplicate']){
  const x=await fixture(t,{mode:'terms'}),c=x.claim('submit');if(kind==='baseline')c.operation.receiptScope.baselineSongIds=['18281901'];if(kind==='album-id')x.state.rows[0].id=x.state.rows[0].albumId;if(kind==='album-title')x.state.rows[0].albumName='Another album';if(kind==='duplicate')x.state.rows.push({...x.state.rows[0],id:'18281902'});
  await assert.rejects(x.executor.readReceipt(c),/SINGLE_SONG_RECEIPT_REQUIRED|ROW_UNVERIFIED/);assert.equal((await x.clicks()).submit,0);
 }
});
test('missing baseline and mismatched immutable scope prevent submit before a click',async t=>{
 for(const kind of ['baseline','album','subject','document','stale']){
  const x=await fixture(t,{mode:'terms'});await x.executor.accept(x.claim());const c=x.claim('submit');if(kind==='baseline')delete c.operation.receiptScope.baselineSongIds;if(kind==='album')c.operation.receiptScope.albumTitle='Another album';if(kind==='subject')c.operation.receiptScope.subjectHash='a'.repeat(64);if(kind==='document')c.operation.receiptScope.termsDocumentSha256='a'.repeat(64);if(kind==='stale')c.operation.createdAt='2020-01-01T00:00:00.000Z';
  await assert.rejects(x.executor.submit(c),/RECEIPT_SCOPE_REQUIRED|CLAIM_STALE/);assert.equal((await x.clicks()).submit,0);
 }
});
test('lost click acknowledgement stays unknown and cannot dispatch again; reconciliation is read-only',async t=>{
 const x=await fixture(t,{mode:'terms'});await x.executor.accept(x.claim());const get=x.page.getByRole.bind(x.page);x.page.getByRole=(role,options)=>{const l=get(role,options);if(options?.name==='提交审核'){const click=l.click.bind(l);l.click=async options=>{await click(options);throw Error('lost acknowledgement')}}return l};
 const c=x.claim('submit');assert.equal((await x.executor.submit(c)).status,'unknown');assert.equal((await x.executor.submit(x.claim('submit'))).reason,'SUBMISSION_ALREADY_DISPATCHED');assert.equal((await x.executor.readReceipt(c)).remoteId,'18281901');assert.equal((await x.clicks()).submit,1);
});
test('upload hashes exact local bytes and rejects changed bytes before the file input',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'existing-album-audio-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,metadata.title+'.wav');fs.writeFileSync(file,'synthetic test PCM bytes');
 const x=await fixture(t,{mode:'intake'});await assert.rejects(x.prepare.request('step',{...x.input,step:'upload_audio',audioPath:file,expectedAudioSha256:'a'.repeat(64)}),/ASSET_HASH_CHANGED/);assert.equal((await x.clicks()).upload,0);
 const result=await x.prepare.request('step',{...x.input,step:'upload_audio',audioPath:file,expectedAudioSha256:hash('synthetic test PCM bytes')});assert.equal(result.status,'applied');assert.equal(result.receipt.remoteContentShaVerified,false);assert.equal(result.receipt.sha256,hash('synthetic test PCM bytes'));assert.equal((await x.clicks()).upload,1);
});
