import { launchHeadlessChromium } from "../scripts/lib/headless-chromium.mjs";
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import path from 'node:path';
import {chromium} from 'playwright-core';

const out=path.resolve('output/official-browser-read-tests/read.cjs');
await build({entryPoints:['src/main/tme/official-browser-read.ts'],outfile:out,bundle:true,platform:'node',target:'node24',format:'cjs',packages:'external'});
const {readFreshOfficialAccount,readOfficialPendingSongs,parseOfficialPendingSongs,readOfficialReleasedSong}=createRequire(import.meta.url)(out);
const origin='https://y.tencentmusic.com';
const primaryUrl=`${origin}/#/user/manage/aiChoose/add?draft=untouched`;
const pendingUrl=`${origin}/#/user/manage/albumlist?tab=unPublish&type=Song`;
const api='/openapi/musician/original/cursorUnPublishSong';
const releasedApi='/openapi/musician/transmit/v2/v2/album/getAlbumSongList';
const observedAt='2026-10-18T13:30:00.000Z';
const record={id:18281901,name:'便利店门口的晴天',albumId:6437318,albumName:'那场雨',status:0};
const visible={cells:[record.name,record.albumName,'审核中'],titles:[record.name,record.albumName]};
const payload=(rows=[record])=>({code:'0',data:{content:rows}});
const releasedRecord={id:record.id,name:record.name,albumid:record.albumId,albumName:record.albumName,singerName:'Test Artist',status:1,statusStr:'审核通过',qqmusicstatus:1,kugoustatus:1,platformPublishStatusStr:'QQ音乐、酷狗音乐已上架<br/>酷我音乐上架中',publishTimeStr:'2026/10/19 01:17'};
const expectedReleased={id:String(record.id),name:record.name,albumId:String(record.albumId),albumName:record.albumName,artistName:'Test Artist'};
let browser;
before(async()=>{browser=await launchHeadlessChromium(chromium);});
after(async()=>{await browser?.close();});

const artistHtml=name=>`<div class="mod_top_login"><div class="top_login__links"><span class="name">${name}</span></div></div>`;
const accountHtml=`<div class="account-item"><span class="account-item-content-label">QQ音乐</span><span class="account-item-content-value">已绑定个人账号：Test QQ</span></div><div class="account-item"><span class="account-item-content-label">酷狗音乐</span><span class="account-item-content-value">已绑定酷狗ID：123456789</span><span class="account-item-content-value">已绑定酷狗音乐推ID：123456789（酷狗音乐关联）</span></div>`;
const rowHtml=(name=record.name,album=record.albumName,status='审核中',hidden=false)=>`<tr${hidden?' style="display:none"':''}><td><span title="${name}">${name}</span></td><td><span title="${album}">${album}</span></td><td>${status}</td></tr>`;

async function fixture(t,options={}){
 const context=await browser.newContext();t.after(()=>context.close());
 const requests=[];
 const document=`<!doctype html><meta charset="utf-8"><body><script>
 const options=${JSON.stringify(options)};
 function render(){
 if(location.hash.includes('/musician/edit')){
  document.body.innerHTML=${JSON.stringify(artistHtml(options.profileArtist||'Test Artist'))}+${JSON.stringify('<button role="tab" aria-selected="false">绑定其他平台账号</button>')}+(options.stale?'':${JSON.stringify(accountHtml)});
  document.querySelector('[role=tab]').onclick=()=>setTimeout(()=>document.querySelector('[role=tab]').setAttribute('aria-selected','true'),25);
  document.body.insertAdjacentHTML('beforeend','<button>歌曲管理</button><button id="original-works">原创作品</button>');document.querySelector('#original-works').onclick=()=>location.hash='#/user/manage/albumlist';
 }else if(location.hash.includes('/songlist/')){
  document.body.innerHTML=${JSON.stringify(artistHtml('Test Artist'))}+${JSON.stringify('<h1>'+record.albumName+'</h1>')};
  fetch('${releasedApi}').then(r=>r.json()).then(()=>document.body.insertAdjacentHTML('beforeend',${JSON.stringify(`<div class="song-list"><div class="el-table__body-wrapper"><table><tbody>${options.releasedRowsHtml??rowHtml(record.name,record.albumName,'审核通过')}</tbody></table></div></div>`)}));
 }else if(location.hash==='#/user/manage/albumlist'){
  document.body.innerHTML=${JSON.stringify(artistHtml('Test Artist')+`<div class="song-list"><div class="el-table__body-wrapper"><table><tbody><tr><td><span>${record.albumName}</span><span>已发布</span></td></tr></tbody></table></div></div>`)};
 }else if(location.hash.includes('/albumlist')){
  document.body.innerHTML=${JSON.stringify(artistHtml(options.pendingArtist||'Test Artist'))};
  fetch('${api}',options.readMethod==='GET'?{method:'GET'}:{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).then(r=>r.json()).then(()=>{
   document.body.insertAdjacentHTML('beforeend',${JSON.stringify(`<div class="song-list"><div class="el-table__body-wrapper"><table><tbody>${options.rowsHtml??rowHtml()}</tbody></table></div></div>`)});
  });
 }else{
  document.body.innerHTML=${JSON.stringify(artistHtml('Test Artist')+'<input id="draft" value="keep this draft"><button id="submit">Submit must never be clicked</button>')};
 }
 }
 window.addEventListener('hashchange',render);render();
 </script>`;
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());requests.push({url:request.url(),method:request.method()});
  assert.equal(url.origin,origin,'No real website or other-origin requests may escape this fixture');
  if(url.pathname===releasedApi){assert.equal(request.method(),'GET');await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(options.releasedResponse??{code:'0',data:[releasedRecord]})});}
  else if(url.pathname===api){assert.equal(request.method(),options.readMethod??'POST');await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(options.response??payload())});}
  else if(request.isNavigationRequest())await route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:document});
  else await route.abort();
 });
 const page=await context.newPage();await page.goto(primaryUrl);await page.locator('#draft').waitFor();
 return{context,page,requests};
}

async function assertUntouched(x){
 assert.equal(x.page.url(),primaryUrl);
 assert.equal(await x.page.locator('#draft').inputValue(),'keep this draft');
 assert.deepEqual(x.context.pages(),[x.page]);
}

test('fresh account waits for selected official tab, reuses calibrated identity, preserves draft and closes temporary page',async t=>{
 const x=await fixture(t);
 assert.deepEqual(await readFreshOfficialAccount(x.page),{kugouId:'123456789',qqDisplayName:'Test QQ',artistName:'Test Artist'});
 await assertUntouched(x);
 assert.equal(x.requests.some(r=>r.method==='POST'),false);
});

test('stale SPA scaffold cannot report an account and its temporary page is closed',async t=>{
 const x=await fixture(t,{stale:true});
 await assert.rejects(readFreshOfficialAccount(x.page),/BROWSER_ACCOUNT_IDENTITY_UNVERIFIED/);
 await assertUntouched(x);
});

test('fresh profile account change and caller subject hash mismatch both fail closed',async t=>{
 for(const options of [{profileArtist:'Other Artist'},{}]){
  const x=await fixture(t,options);
  await assert.rejects(readFreshOfficialAccount(x.page,{expectedSubjectHash:'0'.repeat(64)}),/ACCOUNT_CHANGED/);
  await assertUntouched(x);
 }
});

test('successful pending read observes page POST and main table; hidden clones do not duplicate receipts',async t=>{
 const x=await fixture(t,{rowsHtml:rowHtml()+rowHtml(record.name,record.albumName,'审核中',true)});
 const result=await readOfficialPendingSongs(x.page);
 assert.equal(result.url,pendingUrl);assert.match(result.observedAt,/^\d{4}-\d{2}-\d{2}T/);
 assert.deepEqual(result.rows,[{id:'18281901',name:record.name,albumId:'6437318',albumName:record.albumName,status:'reviewing',observedAt:result.observedAt}]);
 assert.equal('submittedAt'in result.rows[0],false);
 assert.equal(x.requests.filter(r=>new URL(r.url).pathname===api&&r.method==='POST').length,1);
 await assertUntouched(x);
});

test('the observed GET variant remains a page-triggered read with exact visible row verification',async t=>{
 const x=await fixture(t,{readMethod:'GET'});const result=await readOfficialPendingSongs(x.page);assert.equal(result.rows[0].id,'18281901');assert.equal(x.requests.filter(r=>new URL(r.url).pathname===api&&r.method==='GET').length,1);await assertUntouched(x);
});

test('released song fallback matches the original independent record, exact album and explicit platform status',async t=>{
 const x=await fixture(t);const result=await readOfficialReleasedSong(x.page,expectedReleased);assert.equal(result.row.id,'18281901');assert.equal(result.row.status,'published');assert.equal(result.row.officialStatusText,'审核通过');assert.equal(result.row.platformStatusText,'QQ音乐、酷狗音乐已上架；酷我音乐上架中');assert.equal(result.row.officialPublishedAtText,'2026/10/19 01:17');await assertUntouched(x);
});

test('released fallback refuses wrong album/song/account or platform state and preserves the draft',async t=>{
 for(const patch of [{id:18281902},{albumid:2},{albumName:'wrong'},{singerName:'Other Artist'},{status:0},{statusStr:'审核未通过'},{kugoustatus:0}]){const x=await fixture(t,{releasedResponse:{code:'0',data:[{...releasedRecord,...patch}]}});await assert.rejects(readOfficialReleasedSong(x.page,expectedReleased),/SCOPE|STATUS_UNVERIFIED/);await assertUntouched(x)}
});

test('contradictory rejected visible song row cannot certify released API data',async t=>{
 const x=await fixture(t,{releasedRowsHtml:rowHtml(record.name,record.albumName,'审核未通过')});await assert.rejects(readOfficialReleasedSong(x.page,expectedReleased),/ROW_UNVERIFIED/);await assertUntouched(x);
});

test('pending response mismatch and changed list account close only the temporary page',async t=>{
 for(const options of [{response:payload([{...record,name:'Other song'}])},{pendingArtist:'Other Artist'},{response:{code:'1',data:{content:[record]}}}]){
  const x=await fixture(t,options);
  await assert.rejects(readOfficialPendingSongs(x.page),/BROWSER_PENDING_SONG_ROW_UNVERIFIED|ACCOUNT_CHANGED|BROWSER_PENDING_SONG_PAYLOAD_INVALID/);
  await assertUntouched(x);
 }
});

test('oversized official responses are refused and the owned temporary page is closed',async t=>{
 const x=await fixture(t,{response:{...payload(),padding:'x'.repeat(1_048_576)}});
 await assert.rejects(readOfficialPendingSongs(x.page),/BROWSER_PENDING_RESPONSE_TOO_LARGE/);
 await assertUntouched(x);
});

test('primary artist changes during profile read are detected without restoring or closing the primary',async t=>{
 const x=await fixture(t);
 x.context.on('page',temporary=>{temporary.on('domcontentloaded',()=>{void x.page.locator('.name').evaluate(el=>{el.textContent='Changed Artist';});});});
 await assert.rejects(readFreshOfficialAccount(x.page),/ACCOUNT_CHANGED/);
 assert.deepEqual(x.context.pages(),[x.page]);assert.equal(x.page.url(),primaryUrl);
});

test('foreign primary origin is refused before opening a temporary page',async t=>{
 const x=await fixture(t);await x.page.goto('about:blank');
 await assert.rejects(readFreshOfficialAccount(x.page),/BROWSER_OFFICIAL_ORIGIN_REQUIRED/);
 await assert.rejects(readOfficialPendingSongs(x.page),/BROWSER_OFFICIAL_ORIGIN_REQUIRED/);
 assert.deepEqual(x.context.pages(),[x.page]);
});

test('navigation failures close the owned temporary page',async()=>{
 let closed=0;let primaryClosed=0;
 const temporary={goto:async()=>{throw Error('navigation failed');},close:async()=>{closed++;},waitForResponse:async()=>{throw Error('response unavailable');}};
 const context={browser:()=>({newBrowserCDPSession:async()=>({send:async(method,args)=>{assert.equal(method,'Target.createTarget');assert.equal(args.background,true);assert.equal(args.browserContextId,'fixture-context');return{targetId:'owned'};},detach:async()=>{}})}),pages:()=>[page,temporary],newCDPSession:async target=>({send:async()=>({targetInfo:{targetId:target===page?'primary':'owned',browserContextId:'fixture-context'}}),detach:async()=>{}})};
 const page={url:()=>primaryUrl,evaluate:async()=>['Test Artist'],context:()=>context,close:()=>{primaryClosed++;}};
 await assert.rejects(readFreshOfficialAccount(page),/navigation failed/);
 await assert.rejects(readOfficialPendingSongs(page),/navigation failed/);
 assert.equal(closed,2);assert.equal(primaryClosed,0);
});

test('strict receipt parser rejects duplicate song IDs, album-only records, unsafe IDs and oversized responses',()=>{
 for(const [records,error] of [
  [[record,record],/DUPLICATE_ID/],
  [[{albumId:record.albumId,albumName:record.albumName,name:record.name,status:0}],/ID_INVALID/],
  [[{...record,id:9007199254740992}],/ID_INVALID/],
  [[{...record,id:0}],/ID_INVALID/],
  [Array.from({length:101},(_,i)=>({...record,id:i+1})),/PAYLOAD_INVALID/]
 ])assert.throws(()=>parseOfficialPendingSongs(payload(records),[visible],observedAt),error);
 assert.throws(()=>parseOfficialPendingSongs({code:0,data:{content:[record]}},[visible],observedAt),/PAYLOAD_INVALID/);
});

test('unmatched, duplicate or missing visible rows and unsupported statuses cannot certify a receipt',()=>{
 for(const [records,rows,error] of [
  [[record],[],/ROW_UNVERIFIED/],
  [[record],[visible,visible],/ROW_UNVERIFIED/],
  [[record],[{cells:[record.albumName,'审核中'],titles:[]}],/ROW_UNVERIFIED/],
  [[{...record,status:7}],[visible],/STATUS_UNKNOWN/],
  [[{...record,status:0}],[{...visible,cells:[record.name,record.albumName,'已发布']}],/STATUS_UNKNOWN/],
  [[{...record,status:'0'}],[visible],/STATUS_UNKNOWN/],
  [[record],[{...visible,cells:[record.name,record.albumName,'等待中']}],/STATUS_UNKNOWN/]
 ])assert.throws(()=>parseOfficialPendingSongs(payload(records),rows,observedAt),error);
});

test('nonzero statuses only use an exact visible rejected/published label, never guessed numeric mappings',()=>{
 for(const [label,status] of [['已发布','published'],['审核不通过','rejected']]){
  const rows=parseOfficialPendingSongs(payload([{...record,status:99}]),[{cells:[record.name,record.albumName,label],titles:[]}],observedAt);
  assert.equal(rows[0].status,status);
 }
 assert.deepEqual(parseOfficialPendingSongs(payload([]),[],observedAt),[]);
});

test('a hidden primary artist is not live account evidence',async t=>{
 const x=await fixture(t);await x.page.locator('.name').evaluate(el=>{el.style.opacity='0';});
 await assert.rejects(readFreshOfficialAccount(x.page),/BROWSER_ACCOUNT_IDENTITY_UNVERIFIED/);
 await assert.rejects(readOfficialPendingSongs(x.page),/BROWSER_ACCOUNT_IDENTITY_UNVERIFIED/);
 assert.deepEqual(x.context.pages(),[x.page]);
});

test('song/album names require distinct table cells and cannot supply a status label',()=>{
 const sameName={...record,name:record.albumName};
 assert.throws(()=>parseOfficialPendingSongs(payload([sameName]),[{cells:[record.albumName,'审核中'],cellTitles:[[record.albumName],[]]}],observedAt),/ROW_UNVERIFIED/);
 const statusName={...record,name:'审核中'};
 assert.throws(()=>parseOfficialPendingSongs(payload([statusName]),[{cells:['审核中',record.albumName,'未知状态']}],observedAt),/STATUS_UNKNOWN/);
 assert.equal(parseOfficialPendingSongs(payload([sameName]),[{cells:[record.albumName,record.albumName,'审核中']}],observedAt)[0].status,'reviewing');
});
