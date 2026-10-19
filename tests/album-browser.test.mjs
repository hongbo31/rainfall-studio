import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright-core';

const entry='src/main/tme/album-browser.ts',out=path.resolve('output/album-integration/browser-tests/transport.cjs');
let api={};
if(fs.existsSync(entry)){await build({entryPoints:[entry],outfile:out,bundle:true,platform:'node',format:'cjs',packages:'external'});api=createRequire(import.meta.url)(out);}
const hash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const createTransport=o=>{assert.equal(typeof api.createTmeAlbumBrowserTransport,'function','Missing calibrated album browser transport');return api.createTmeAlbumBrowserTransport(o);};
const fixtureOrigin='https://album.fixture.invalid',createUrl=fixtureOrigin+'/#/create',resultUrl=fixtureOrigin+'/#/result';
const intakeUrl='https://y.tencentmusic.com/#/user/manage/aiChoose/add';
const identity={kugouId:'123456789',qqDisplayName:'Fixture QQ',artistName:'Fixture Artist'};
const subjectHash=hash({subjectType:'official_visible_binding_fingerprint',...identity});
const now='2026-10-19T10:00:00.000Z';
const contract={version:'offline-album-create-v1',source:'offline-fixture',origin:fixtureOrigin,createUrl,resultUrls:[createUrl,resultUrl],calibratedAt:now,evidenceHash:hash('synthetic album fixture contract'),identityMarkers:[{selector:'#artist',identityKey:'artistName'},{selector:'#subject',identityKey:'subjectHash'}],fields:[{key:'title',selector:'#title',required:true},{key:'description',selector:'#description',required:true},{key:'artistName',selector:'#album-artist',required:true},{key:'idempotencyKey',selector:'#request-key',required:true}],createControl:'#create',result:{container:'.album-result',albumId:{selector:'.remote-id'},title:{selector:'.remote-title'},idempotencyKey:{selector:'.request-key'}}};
let browser;
before(async()=>{browser=await chromium.launch({executablePath:process.env.RAINFALL_TEST_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});});
after(async()=>{await browser?.close();});
async function fixture(t,{intake=false,duplicate=false,noResult=false,badResult=false,officialRows}={}){
 const context=await browser.newContext({serviceWorkers:'block'});t.after(()=>context.close());
 const requests=[];
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());requests.push({url:req.url(),method:req.method()});
  if(officialRows&&url.origin==='https://y.tencentmusic.com'&&url.pathname==='/openapi/musician/original/cursorUnPublishSong'){await route.fulfill({contentType:'application/json',body:JSON.stringify({code:'0',data:{content:officialRows}})});return;}
  if(![fixtureOrigin,'https://y.tencentmusic.com'].includes(url.origin)||!req.isNavigationRequest()){await route.abort();return;}
  const header=intake?`<div class="mod_top_login"><div class="top_login__links"><span class="name">${identity.artistName}</span></div></div>`:`<div id="artist">${identity.artistName}</div><div id="subject">${subjectHash}</div>`;
  const option=(artist=identity.artistName)=>`<div class="search-result-item" data-id="not-an-observed-album-id"><span class="album-name">Exact album</span><span class="singer-name">${artist}</span></div>`;
  const profile=officialRows?`<button role="tab" aria-selected="false">绑定其他平台账号</button><div class="account-item"><span class="account-item-content-label">QQ音乐</span><span class="account-item-content-value">已绑定个人账号:${identity.qqDisplayName}</span></div><div class="account-item"><span class="account-item-content-label">酷狗音乐</span><span class="account-item-content-value">已绑定酷狗ID:${identity.kugouId}</span><span class="account-item-content-value">已绑定酷狗音乐推ID:${identity.kugouId}</span></div>`:'';
  const body=intake?`<div class="album-search"><div class="selected" style="display:none"><div class="album"><strong>Exact album</strong></div></div></div>${option('Other artist')}${option()}${duplicate?option():''}`:`<input id="title"><textarea id="description"></textarea><input id="album-artist"><input id="request-key"><button id="create">Create fixture album</button><div id="results"></div>`;
  await route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><body>${header}${profile}${body}<script>
   window.fixture={creates:0,selections:0,submitted:null};
   document.querySelector('[role=tab]')?.addEventListener('click',e=>e.currentTarget.setAttribute('aria-selected','true'));
   addEventListener('hashchange',()=>{if(location.hash.includes('/albumlist'))fetch('/openapi/musician/original/cursorUnPublishSong',{method:'POST',body:'{}'}).then(r=>r.json()).then(({data})=>{const table=document.createElement('div');table.className='song-list';table.innerHTML='<div class="el-table__body-wrapper"><table>'+data.content.map(row=>'<tr><td>'+row.name+'</td><td>'+row.albumName+'</td><td>审核中</td></tr>').join('')+'</table></div>';document.body.append(table);});});
   for(const el of document.querySelectorAll('.search-result-item'))el.addEventListener('click',()=>{fixture.selections++;fixture.selectedArtist=el.querySelector('.singer-name').textContent;document.querySelector('.selected').style.display='block';for(const o of document.querySelectorAll('.search-result-item'))o.style.display='none';});
   document.querySelector('#create')?.addEventListener('click',()=>{fixture.creates++;fixture.submitted={title:document.querySelector('#title').value,description:document.querySelector('#description').value,artistName:document.querySelector('#album-artist').value,idempotencyKey:document.querySelector('#request-key').value};
    ${noResult?'':`const el=document.createElement('div');el.className='album-result';for(const [c,text] of [['remote-id','fixture-album-104'],['remote-title',${badResult?"'Different album'":"fixture.submitted.title"}],['request-key',fixture.submitted.idempotencyKey]]){const s=document.createElement('span');s.className=c;s.textContent=text;el.append(s);}document.querySelector('#results').append(el);location.hash='#/result';`}
   });</script>`});
 });
 const page=await context.newPage();await page.goto(intake?intakeUrl:createUrl);
 const binding={transport:'cloud-playwright',sessionId:randomUUID(),pageId:randomUUID(),started:now};
 const accountState={identity:{...identity},binding:{...binding}};
 const options={page,account:async()=>accountState,now:()=>new Date(now),isolatedFixture:true,createContract:contract};
 const transport=createTransport(options);
 const claim={operationId:randomUUID(),idempotencyKey:randomUUID(),requestHash:hash('fixture request'),state:'dispatching',title:'Exact album',artistName:identity.artistName,description:'Fixture description',subjectHash,binding,createdAt:now};
 return{context,page,transport,options,claim,accountState,requests,clicks:()=>page.evaluate(()=>window.fixture)};
}

test('production capability reports exact calibration gaps without touching the browser',async()=>{
 let touched=0;const x=createTransport({page:{url(){touched++;return intakeUrl;}},account:async()=>{touched++;throw Error('must not inspect');}});
 assert.equal(x.capability().create.available,false);assert.ok(x.capability().create.reasons.includes('ALBUM_CREATE_CONTRACT_UNCALIBRATED'));
 assert.ok(x.capability().create.missing.includes('origin/routes'));assert.ok(x.capability().create.missing.includes('result albumId/title/original-operation correlation'));
 assert.equal((await x.create({})).reason,'ALBUM_CREATE_CONTRACT_UNCALIBRATED');assert.equal((await x.reconcile({})).reason,'ALBUM_CREATE_CONTRACT_UNCALIBRATED');assert.equal(touched,0);
 assert.equal(x.capability().append.available,false);assert.equal(x.capability().append.executor,'existing-tme-ai-preparation-and-submission');
});

test('visible read-only catalog never guesses a remote ID from data-id',async t=>{
 const x=await fixture(t,{intake:true}),catalog=await x.transport.catalog();
 assert.equal(catalog.completeness,'partial');assert.equal(catalog.source,'offline-fixture');assert.equal(catalog.onlineVerified,false);
 assert.equal(catalog.scope.subjectHash,subjectHash);assert.equal(catalog.entries.length,2);
 for(const row of catalog.entries){assert.equal(row.identityLevel,'title_artist_only');assert.equal(row.remoteAlbumId,undefined);assert.ok(row.candidateKey);assert.notEqual(row.candidateKey,'not-an-observed-album-id');}
 assert.deepEqual(await x.clicks(),{creates:0,selections:0,submitted:null});assert.equal(x.context.pages().length,1);assert.equal(x.requests.length,1);
});

test('official pending-song album IDs are separate partial references, never a full directory',async t=>{
 const rows=[{id:'1234501',name:'Synthetic pending song',albumId:'87654321',albumName:'Official reference album',status:0}];
 const x=await fixture(t,{intake:true,officialRows:rows}),catalog=await x.transport.catalog({includeOfficialReferences:true});
 const ref=catalog.entries.find(row=>row.remoteAlbumId==='87654321');assert.ok(ref);assert.equal(ref.provenance,'official-pending-song-reference');assert.equal(ref.identityLevel,'remote_album_id');assert.equal(ref.source,'offline-fixture');assert.equal(catalog.completeness,'partial');assert.equal(catalog.entries.filter(row=>row.identityLevel==='title_artist_only').length,2);
 assert.equal(x.context.pages().length,1);assert.equal(x.requests.filter(row=>new URL(row.url).pathname==='/openapi/musician/original/cursorUnPublishSong').length,1);assert.equal((await x.clicks()).selections,0);assert.equal((await x.clicks()).creates,0);
});

test('exact selection checks candidate key, title, artist, session and readback',async t=>{
 const x=await fixture(t,{intake:true}),catalog=await x.transport.catalog(),row=catalog.entries.find(row=>row.artistName===identity.artistName);
 const input={candidateKey:row.candidateKey,title:row.title,artistName:row.artistName,expectedSubjectHash:subjectHash,expectedBinding:x.claim.binding};
 await assert.rejects(x.transport.select({...input,title:'Wrong title'}),/ALBUM_CANDIDATE_CHANGED/);assert.equal((await x.clicks()).selections,0);
 const selected=await x.transport.select(input);assert.equal(selected.identityLevel,'title_artist_only');assert.equal(selected.remoteAlbumId,undefined);assert.equal(selected.source,'offline-fixture');assert.equal((await x.clicks()).selectedArtist,identity.artistName);assert.equal((await x.clicks()).selections,1);
});

test('ambiguous exact album options never select the first',async t=>{
 const x=await fixture(t,{intake:true,duplicate:true}),catalog=await x.transport.catalog(),row=catalog.entries.find(row=>row.artistName===identity.artistName);
 await assert.rejects(x.transport.select({candidateKey:row.candidateKey,title:row.title,artistName:row.artistName,expectedSubjectHash:subjectHash,expectedBinding:x.claim.binding}),/ALBUM_EXACT_MATCH_REQUIRED/);assert.equal((await x.clicks()).selections,0);
});

test('actual browser executor fills mandatory fields once and reads back remote ID',async t=>{
 const x=await fixture(t),result=await x.transport.create(x.claim);
 assert.equal(result.status,'succeeded');assert.equal(result.remoteAlbumId,'fixture-album-104');assert.equal(result.title,x.claim.title);assert.equal(result.source,'offline-fixture');assert.equal(result.onlineVerified,false);
 const state=await x.clicks();assert.equal(state.creates,1);assert.deepEqual(state.submitted,{title:x.claim.title,description:x.claim.description,artistName:identity.artistName,idempotencyKey:x.claim.idempotencyKey});
 assert.equal((await x.transport.create(x.claim)).reason,'ALBUM_CREATE_ALREADY_DISPATCHED');assert.equal((await x.clicks()).creates,1);
 assert.equal((await x.transport.reconcile({...x.claim,state:'unknown'})).remoteAlbumId,'fixture-album-104');assert.equal((await x.clicks()).creates,1);
});

test('unknown create and fresh transport reconciliation only inspect the original result',async t=>{
 const x=await fixture(t,{noResult:true});assert.equal((await x.transport.create(x.claim)).status,'unknown');assert.equal((await x.clicks()).creates,1);
 const restarted=createTransport(x.options);assert.equal((await restarted.create({...x.claim,state:'unknown'})).status,'unknown');assert.equal((await x.clicks()).creates,1);
 await x.page.locator('#results').evaluate(el=>{el.innerHTML='<div class="album-result"><span class="remote-id">unrelated</span><span class="remote-title">Exact album</span><span class="request-key">other-operation</span></div>';});
 assert.equal((await restarted.reconcile({...x.claim,state:'unknown'})).status,'unknown');assert.equal((await x.clicks()).creates,1);
 await x.page.locator('#results').evaluate((el,key)=>{el.innerHTML='<div class="album-result"><span class="remote-id">fixture-album-104</span><span class="remote-title">Exact album</span><span class="request-key"></span></div>';el.querySelector('.request-key').textContent=key;},x.claim.idempotencyKey);
 assert.equal((await restarted.reconcile({...x.claim,state:'unknown'})).remoteAlbumId,'fixture-album-104');assert.equal((await x.clicks()).creates,1);
});

test('lost click acknowledgement cannot repeat a write and can reconcile original result',async t=>{
 const x=await fixture(t),locator=x.page.locator.bind(x.page);x.page.locator=(selector,...args)=>{const l=locator(selector,...args);if(selector==='#create'){const click=l.click.bind(l);l.click=async options=>{await click(options);throw Error('lost acknowledgement');};}return l;};
 assert.equal((await x.transport.create(x.claim)).status,'unknown');assert.equal((await x.transport.create(x.claim)).reason,'ALBUM_CREATE_ALREADY_DISPATCHED');assert.equal((await x.transport.reconcile({...x.claim,state:'unknown'})).status,'succeeded');assert.equal((await x.clicks()).creates,1);
});

test('account and window drift reject before create; changed visible identity also rejects',async t=>{
 for(const kind of ['account','binding','marker']){
  const x=await fixture(t);if(kind==='account')x.accountState.identity.qqDisplayName='Changed QQ';if(kind==='binding')x.accountState.binding.pageId=randomUUID();
  if(kind==='marker')await x.page.locator('#artist').evaluate(el=>{el.textContent='Other artist';});
  await assert.rejects(x.transport.create(x.claim),/ACCOUNT_CHANGED|WINDOW_BINDING_CHANGED/);assert.equal((await x.clicks()).creates,0);
 }
});

test('missing mandatory fields, changed claims, wrong result titles and duplicate results fail closed',async t=>{
 const x=await fixture(t);await assert.rejects(x.transport.create({...x.claim,description:''}),/ALBUM_MANDATORY_FIELD_REQUIRED/);assert.equal((await x.clicks()).creates,0);
 await x.transport.create(x.claim);await assert.rejects(x.transport.create({...x.claim,title:'Altered'}),/ALBUM_OPERATION_CHANGED/);assert.equal((await x.clicks()).creates,1);
 await x.page.locator('#results').evaluate(el=>el.append(el.firstElementChild.cloneNode(true)));assert.equal((await x.transport.reconcile({...x.claim,state:'unknown'})).reason,'ALBUM_RESULT_AMBIGUOUS');
 const y=await fixture(t,{badResult:true});assert.equal((await y.transport.create(y.claim)).status,'unknown');assert.equal((await y.clicks()).creates,1);
});

test('fixtures cannot enable a production contract and bad routes never fill',async t=>{
 const x=await fixture(t),disabled=createTransport({...x.options,isolatedFixture:false});assert.equal(disabled.capability().create.available,false);assert.equal((await disabled.create(x.claim)).reason,'ALBUM_FIXTURE_CONTRACT_REQUIRES_ISOLATION');assert.equal((await x.clicks()).creates,0);
 await x.page.goto(fixtureOrigin+'/#/wrong');await assert.rejects(x.transport.create(x.claim),/ALBUM_CREATE_ROUTE_REQUIRED/);assert.equal((await x.clicks()).creates,0);
});

test('opacity-hidden identity markers cannot authorize a create',async t=>{
 const x=await fixture(t);await x.page.locator('#subject').evaluate(el=>{el.style.opacity='0';});
 await assert.rejects(x.transport.create(x.claim),/ALBUM_PAGE_CONTRACT_CHANGED/);assert.equal((await x.clicks()).creates,0);
});

test('Main callback freshness and drift between field writes stop before create',async t=>{
 const stale=await fixture(t);stale.accountState.observedAt='2026-10-19T09:00:00.000Z';await assert.rejects(stale.transport.create(stale.claim),/ALBUM_ACCOUNT_OBSERVATION_STALE/);assert.equal((await stale.clicks()).creates,0);
 const x=await fixture(t);let observations=0;const changing=createTransport({...x.options,account:async()=>{if(++observations===3)x.accountState.identity.qqDisplayName='Drift during fill';return x.accountState;}});
 await assert.rejects(changing.create(x.claim),/ACCOUNT_CHANGED/);assert.equal((await x.clicks()).creates,0);
});

test('candidate reordering during fresh account observation cannot click another artist',async t=>{
 const x=await fixture(t,{intake:true}),catalog=await x.transport.catalog(),row=catalog.entries.find(row=>row.artistName===identity.artistName);let reads=0;
 const changing=createTransport({...x.options,account:async()=>{if(++reads===2)await x.page.locator('body').evaluate(el=>{const rows=el.querySelectorAll('.search-result-item');el.insertBefore(rows[1],rows[0]);});return x.accountState;}});
 await assert.rejects(changing.select({candidateKey:row.candidateKey,title:row.title,artistName:row.artistName,expectedSubjectHash:subjectHash,expectedBinding:x.claim.binding}),/ALBUM_CANDIDATE_CHANGED/);assert.equal((await x.clicks()).selections,0);
});

test('a field altered during the final account guard rejects before the create click',async t=>{
 const x=await fixture(t);let reads=0;
 const changing=createTransport({...x.options,account:async()=>{if(++reads===6)await x.page.locator('#title').fill('Altered after field readback');return x.accountState;}});
 await assert.rejects(changing.create(x.claim),/ALBUM_FIELD_READBACK_REQUIRED/);assert.equal(await x.page.locator('#title').inputValue(),'Altered after field readback');assert.equal((await x.clicks()).creates,0);
});
