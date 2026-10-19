import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {randomUUID} from 'node:crypto';
const out=path.resolve('output/album-pagination/reader.cjs');
await build({entryPoints:['src/main/tme/official-browser-read.ts'],outfile:out,bundle:true,platform:'node',format:'cjs',packages:'external'});
const api=createRequire(import.meta.url)(out),origin='https://y.tencentmusic.com';
const transportOut=path.resolve('output/album-pagination/transport.cjs');await build({entryPoints:['src/main/tme/album-browser.ts'],outfile:transportOut,bundle:true,platform:'node',format:'cjs',packages:'external'});const {createTmeAlbumBrowserTransport}=createRequire(import.meta.url)(transportOut);
test('published count evidence uses its labeled table column and never a coincidentally equal row index',()=>{
 const r={id:10001,name:'Synthetic album',singerName:'Fixture Artist',songnum:1,publishSongnum:1,unPublishSongnum:0},payload={code:'0',data:{content:[r]}};
 const visible={columnLabels:['#','专辑名称','歌曲数'],cells:['2',r.name,'已发布1']};
 assert.equal(api.parseOfficialAlbumDirectoryPage(payload,[visible],'published','Fixture Artist',new Date().toISOString())[0].id,'10001');
 assert.throws(()=>api.parseOfficialAlbumDirectoryPage(payload,[{...visible,cells:['1',r.name,'已发布2']}],'published','Fixture Artist',new Date().toISOString()),/ROW_UNVERIFIED/);
});
const publishedPath='/cd-gateway/musician/original/pagePublishAlbum',unpublishedPath='/cd-gateway/musician/original/pageUnPublishAlbum',pendingPath='/openapi/musician/original/cursorUnPublishSong';
let browser;
before(async()=>{browser=await chromium.launch({executablePath:process.env.RAINFALL_TEST_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});});
after(async()=>{await browser?.close();});
async function fixture(t,options={}){
 const context=await browser.newContext({serviceWorkers:'block'});t.after(()=>context.close());const requests=[];
 const html=`<!doctype html><meta charset="utf-8"><body><script>
 const options=${JSON.stringify(options)},publishedPath=${JSON.stringify(publishedPath)},unpublishedPath=${JSON.stringify(unpublishedPath)},pendingPath=${JSON.stringify(pendingPath)};
 let pageNo=1,records=[],cursor=0,loading=false;
 const artist='<div class="mod_top_login"><div class="top_login__links"><span class="name">Fixture Artist</span></div></div>';
 function shell(){document.body.innerHTML=artist+'<button id="manage">歌曲管理</button><button id="original">原创作品</button><button id="tab-published" role="tab" aria-selected="true">已发布</button><button id="tab-unPublish" role="tab" aria-selected="false">未发布</button><button id="songs">歌曲</button><div id="content"></div>';document.querySelector('#original').onclick=()=>location.hash='#/user/manage/albumlist';document.querySelector('#tab-published').onclick=()=>location.hash='#/user/manage/albumlist';document.querySelector('#tab-unPublish').onclick=()=>location.hash='#/user/manage/albumlist?tab=unPublish&type=Album';document.querySelector('#songs').onclick=()=>location.hash='#/user/manage/albumlist?tab=unPublish&type=Song';}
 async function albums(n=1){pageNo=n;const unpub=location.hash.includes('unPublish');document.querySelector('#tab-published').setAttribute('aria-selected',String(!unpub));document.querySelector('#tab-unPublish').setAttribute('aria-selected',String(unpub));const response=await fetch((unpub?unpublishedPath:publishedPath)+'?pageNo='+n+'&pageSize='+(options.requestSizeMismatch?20:10)+'&name='+(options.filtered?'Filtered':'')+'&showStatus=0');const {data}=await response.json();const rows=data.content;
 document.querySelector('#content').innerHTML='<div class="album-list"><div class="el-table"><div class="el-table__header-wrapper"><table><thead><tr><th>#</th><th>专辑名称</th><th>歌曲数</th></tr></thead></table></div><div class="el-table__body-wrapper"><table><tbody>'+rows.map((r,i)=>'<tr><td>'+(i+1)+'</td><td>'+r.name+'</td><td>'+(unpub?String(r.songnum):'已发布'+r.publishSongnum+(r.unPublishSongnum?',未发布'+r.unPublishSongnum:''))+'</td></tr>').join('')+'</tbody></table></div></div>'+(rows.length?'':'<div class="el-table__empty-block">暂无专辑</div>')+'<div class="pagination-contanier"><div class="el-pagination"><button class="btn-next" '+(n*10>=data.totalCount?'disabled':'')+'>下一页</button></div></div></div>';
 if(options.missingNext)document.querySelector('.btn-next').remove();else if(options.hiddenNext)document.querySelector('.btn-next').style.opacity='0';else document.querySelector('.btn-next').onclick=()=>albums(n+1);if(options.terminalNextEnabled)document.querySelector('.btn-next').disabled=false;
 }
 async function songs(){if(loading)return;loading=true;const {data}=await(await fetch(pendingPath+'?pageSize=50&'+(options.duplicateFilters?'name=Filtered&':'')+'name=&showStatus=0'+(cursor||options.initialCursor?'&cursor='+(cursor||options.initialCursor):''))).json();records.push(...data.content);cursor++;document.querySelector('#content').innerHTML='<div class="song-list"><div class="el-table__body-wrapper" style="max-height:220px;overflow:auto"><table><tbody>'+records.map(r=>'<tr style="height:24px"><td>'+r.name+'</td><td>'+r.albumName+'</td><td>审核中</td></tr>').join('')+'</tbody></table><div class="cursor-pagination-status">'+(data.hasMore?'向下滚动加载更多':'没有更多了')+'</div></div>'+(records.length?'':'<div class="el-table__empty-block">暂无歌曲</div>')+'</div>';const table=document.querySelector('.song-list .el-table__body-wrapper');table.onscroll=()=>{if(data.hasMore&&table.scrollHeight-table.scrollTop-table.clientHeight<=120)songs();};loading=false;if(options.wrongSongEmpty)document.querySelector('.song-list .el-table__empty-block').textContent='暂无专辑';if(options.staleAlbumEmpty){const element=document.querySelector('#content'),correct=element.innerHTML;element.innerHTML='<div class="album-list"><div class="el-table__empty-block">暂无专辑</div></div>';setTimeout(()=>element.innerHTML=correct,600);}}
 async function render(){shell();if(location.hash.includes('/musician/edit')){document.querySelector('#tab-published').style.display='none';document.querySelector('#tab-unPublish').style.display='none';document.querySelector('#content').innerHTML='<button role="tab" aria-selected="false">绑定其他平台账号</button><div class="account-item"><span class="account-item-content-label">QQ音乐</span><span class="account-item-content-value">已绑定个人账号：Fixture QQ</span></div><div class="account-item"><span class="account-item-content-label">酷狗音乐</span><span class="account-item-content-value">已绑定酷狗ID：123456789</span><span class="account-item-content-value">已绑定酷狗音乐推ID：123456789</span></div>';document.querySelector('#content [role=tab]').onclick=e=>e.currentTarget.setAttribute('aria-selected','true');}else if(location.hash.includes('type=Song')){records=[];cursor=0;await songs();}else if(location.hash.includes('/albumlist'))await albums();else document.querySelector('#content').innerHTML='<input id="draft" value="untouched">';}
 addEventListener('hashchange',render);render();</script>`;
 await context.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());requests.push({path:u.pathname,method:req.method(),cursor:u.searchParams.get('cursor'),pageNo:u.searchParams.get('pageNo')});assert.equal(u.origin,origin);
  if(req.isNavigationRequest())return route.fulfill({contentType:'text/html; charset=utf-8',body:html});
  const unpub=u.pathname===unpublishedPath;
  if(unpub||u.pathname===publishedPath){const n=Number(u.searchParams.get('pageNo')||1),total=unpub?(options.unpublishedCount??17):(options.publishedCount??123),actual=options.repeatPage&&n>1?1:n;let rows=Array.from({length:Math.max(0,Math.min(10,total-(actual-1)*10))},(_,i)=>({id:(unpub?20000:10000)+(actual-1)*10+i,name:'Synthetic album '+(unpub?'U':'P')+((actual-1)*10+i),singerName:'Fixture Artist',songnum:1,publishSongnum:1,unPublishSongnum:0}));if(options.duplicate&&n===2)rows[0]={...rows[0],id:10000};if(options.mismatch&&n===2)rows[0].name='Wrong visible name';const data={pageNo:options.pageNoMismatch&&n>1?n-1:n,pageSize:10,totalCount:options.totalDrift&&n>1?total+1:total,content:rows};return route.fulfill({contentType:'application/json',body:JSON.stringify({code:'0',data})});}
  if(u.pathname===pendingPath){const index=Number(u.searchParams.get('cursor')||0),count=options.pendingCount??145,total=Math.max(0,Math.min(50,count-index*50)),rows=Array.from({length:total},(_,i)=>({id:options.pendingDuplicate&&index===1&&i===0?30000:30000+index*50+i,name:'Synthetic pending '+(index*50+i),albumId:40000+index*50+i,albumName:'Synthetic pending album '+(index*50+i),status:0}));return route.fulfill({contentType:'application/json',body:JSON.stringify({code:'0',data:{content:rows,hasMore:(index+1)*50<count,...((index+1)*50<count?{nextCursor:options.cursorCycle?'1':String(index+1)}:{})}})});}
  return route.abort();
 });const page=await context.newPage();await page.goto(origin+'/#/user/manage/aiChoose/add');await page.locator('#draft').waitFor();return{context,page,requests};
}

test('official numbered album directory traverses every published and unpublished page beyond 100 rows',async t=>{
 assert.equal(typeof api.readOfficialAlbumDirectory,'function','Missing all-page album directory reader');const x=await fixture(t);const result=await api.readOfficialAlbumDirectory(x.page);
 assert.equal(result.rows.length,140);assert.equal(result.coverage.complete,true);assert.equal(result.coverage.pagesRead,15);assert.equal(result.coverage.rowCount,140);assert.equal(result.coverage.source,'official-album-directory');assert.deepEqual(result.coverage.reasons,[]);assert.equal(result.sourceCoverage.length,2);
 assert.equal(x.requests.filter(r=>r.path===publishedPath).length,13);assert.equal(x.requests.filter(r=>r.path===unpublishedPath).length,2);assert.ok(x.requests.every(r=>r.method==='GET'));assert.equal(await x.page.locator('#draft').inputValue(),'untouched');assert.deepEqual(x.context.pages(),[x.page]);
});
test('pending songs append all observed cursor pages beyond 100 rows without synthesizing requests',async t=>{
 const x=await fixture(t),result=await api.readOfficialPendingSongs(x.page);assert.equal(result.rows.length,145);assert.equal(result.coverage.complete,true);assert.equal(result.coverage.pagesRead,3);assert.deepEqual(x.requests.filter(r=>r.path===pendingPath).map(r=>r.cursor),[null,'1','2']);assert.deepEqual(x.context.pages(),[x.page]);
});
for(const [name,options,reason] of [['changed total',{totalDrift:true},/TOTAL_CHANGED/],['wrong response page',{pageNoMismatch:true},/PAGE_SEQUENCE|REQUEST_PAGE_MISMATCH/],['cross-page duplicate',{duplicate:true},/DUPLICATE_ID/],['repeated page',{repeatPage:true},/DUPLICATE_ID|PAGE_CYCLE/]])test('numbered traversal rejects '+name,async t=>{
 assert.equal(typeof api.readOfficialAlbumDirectory,'function');const x=await fixture(t,{publishedCount:23,unpublishedCount:0,...options});await assert.rejects(api.readOfficialAlbumDirectory(x.page),reason);assert.deepEqual(x.context.pages(),[x.page]);
});
for(const [name,options] of [['missing next',{missingNext:true}],['hidden next',{hiddenNext:true}]])test('numbered traversal explicitly reports incomplete '+name,async t=>{
 assert.equal(typeof api.readOfficialAlbumDirectory,'function');const x=await fixture(t,options),result=await api.readOfficialAlbumDirectory(x.page);assert.equal(result.coverage.complete,false);assert.ok(result.coverage.reasons.some(r=>/NEXT_CONTROL/.test(r)));assert.equal(result.rows.length,20);assert.deepEqual(x.context.pages(),[x.page]);
});
test('album catalog publishes directory completeness and provenance while preserving offline fixture labeling',async t=>{
 const x=await fixture(t),binding={transport:'cloud-playwright',sessionId:randomUUID(),pageId:randomUUID(),started:new Date().toISOString()},transport=createTmeAlbumBrowserTransport({page:x.page,isolatedFixture:true,account:async()=>({identity:{kugouId:'123456789',qqDisplayName:'Fixture QQ',artistName:'Fixture Artist'},binding})});
 const result=await transport.catalog({includeOfficialDirectory:true});assert.equal(result.entries.length,140);assert.equal(result.completeness,'complete');assert.equal(result.coverage.complete,true);assert.equal(result.coverage.pagesRead,15);assert.equal(result.source,'offline-fixture');assert.equal(result.onlineVerified,false);assert.ok(result.entries.every(e=>e.provenance==='official-album-directory'&&e.identityLevel==='remote_album_id'&&e.source==='offline-fixture'));
});
for(const [name,options,reason] of [['residual name filter',{filtered:true},/FILTERED_SCOPE/],['request response page-size mismatch',{requestSizeMismatch:true},/REQUEST_PAGE_MISMATCH/]])test('directory refuses '+name,async t=>{
 const x=await fixture(t,{publishedCount:1,unpublishedCount:0,...options});await assert.rejects(api.readOfficialAlbumDirectory(x.page),reason);assert.deepEqual(x.context.pages(),[x.page]);
});
for(const [name,options,reason] of [['cursor cycle',{cursorCycle:true},/CURSOR_CYCLE/],['duplicate song across pages',{pendingDuplicate:true},/DUPLICATE_ID/]])test('pending cursor traversal refuses '+name,async t=>{
 const x=await fixture(t,options);await assert.rejects(api.readOfficialPendingSongs(x.page),reason);assert.deepEqual(x.context.pages(),[x.page]);
});
test('primary identity drift between album pages stops before another page click',async t=>{
 const x=await fixture(t,{publishedCount:23,unpublishedCount:0});let changed=false;
 x.context.on('response',async response=>{if(!changed&&new URL(response.url()).pathname===publishedPath){changed=true;await x.page.locator('.name').evaluate(el=>{el.textContent='Changed primary artist';});}});
 await assert.rejects(api.readOfficialAlbumDirectory(x.page),/ACCOUNT_CHANGED/);assert.deepEqual(x.context.pages(),[x.page]);assert.equal(x.requests.filter(r=>r.path===publishedPath).length,1);
});
test('pending terminal tail loaded from a nonempty initial cursor cannot certify all pages',async t=>{
 const x=await fixture(t,{initialCursor:'2'});await assert.rejects(api.readOfficialPendingSongs(x.page),/CURSOR_START_UNVERIFIED/);assert.equal(x.requests.filter(r=>r.path===pendingPath).length,1);assert.deepEqual(x.context.pages(),[x.page]);
});
test('a visible enabled next button contradicts an allegedly terminal album total',async t=>{
 const x=await fixture(t,{publishedCount:1,unpublishedCount:0,terminalNextEnabled:true});await assert.rejects(api.readOfficialAlbumDirectory(x.page),/TERMINATION_INCONSISTENT/);assert.deepEqual(x.context.pages(),[x.page]);
});
test('empty pending source waits for its song table instead of accepting the preceding album empty state',async t=>{
 const x=await fixture(t,{pendingCount:0,staleAlbumEmpty:true}),started=Date.now(),result=await api.readOfficialPendingSongs(x.page);assert.equal(result.coverage.complete,true);assert.ok(Date.now()-started>=600);assert.deepEqual(x.context.pages(),[x.page]);
});
test('an album empty label inside a song table cannot certify an empty song source',async t=>{
 const x=await fixture(t,{pendingCount:0,wrongSongEmpty:true});await assert.rejects(api.readOfficialPendingSongs(x.page),/EMPTY_STATE_UNVERIFIED/);assert.deepEqual(x.context.pages(),[x.page]);
});
test('duplicate pending name query parameters cannot conceal a residual filter',async t=>{
 const x=await fixture(t,{pendingCount:0,duplicateFilters:true});await assert.rejects(api.readOfficialPendingSongs(x.page),/FILTERED_SCOPE/);assert.deepEqual(x.context.pages(),[x.page]);
});
