import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';

const sha=value=>createHash('sha256').update(value).digest('hex');
export const fixtureIdentity={kugouId:'123456789',qqDisplayName:'Plan fixture QQ',artistName:'Plan fixture Artist'};
export const fixtureNow='2026-10-19T10:00:00.000Z';
const origin='https://plan-album.fixture.invalid',createUrl=origin+'/#/create',resultUrl=origin+'/#/result';

/** Synthetic UI contract only. These selectors/routes are never passed to production. */
export function fixtureCreateContract(){return{version:'offline-plan-album-e2e-v1',source:'offline-fixture',origin,createUrl,resultUrls:[createUrl,resultUrl],calibratedAt:fixtureNow,evidenceHash:sha('plan-album synthetic UI contract v1'),identityMarkers:[{selector:'#artist',identityKey:'artistName'},{selector:'#subject',identityKey:'subjectHash'}],fields:[{key:'title',selector:'#title',required:true},{key:'description',selector:'#description',required:true},{key:'artistName',selector:'#album-artist',required:true},{key:'idempotencyKey',selector:'#request-key',required:true}],createControl:'#create',result:{container:'.album-result',albumId:{selector:'.remote-id'},title:{selector:'.remote-title'},idempotencyKey:{selector:'.request-key'}}};}

export async function planAlbumBrowserFixture(t,{browser,subjectHash,onCreate,noResult=false}){
 const context=await browser.newContext({serviceWorkers:'block'});t.after(()=>context.close());
 const requests=[],writes=[],results=[];
 const binding={transport:'cloud-playwright',sessionId:randomUUID(),pageId:randomUUID(),started:fixtureNow};
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());requests.push({url:request.url(),method:request.method()});
  if(url.origin!==origin){await route.abort();return;}
  if(url.pathname==='/fixture-create'&&request.method()==='POST'){
   const input=request.postDataJSON();writes.push(input);
   try{await onCreate?.(input);}catch(error){await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:error.message})});throw error;}
   const result={albumId:'fixture-created-plan-album-501',title:input.title,idempotencyKey:input.idempotencyKey};results.push(result);
   await route.fulfill({contentType:'application/json',body:JSON.stringify(result)});return;
  }
  if(!request.isNavigationRequest()||url.pathname!=='/'){await route.abort();return;}
  await route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><body>
   <div id="artist">${fixtureIdentity.artistName}</div><div id="subject">${subjectHash}</div>
   <input id="title"><textarea id="description"></textarea><input id="album-artist"><input id="request-key"><button id="create">Create synthetic album</button><div id="results"></div>
   <script>
   window.fixture={clicks:0,fields:null};window.renderFixtureResult=result=>{const row=document.createElement('div');row.className='album-result';for(const [css,text] of [['remote-id',result.albumId],['remote-title',result.title],['request-key',result.idempotencyKey]]){const child=document.createElement('span');child.className=css;child.textContent=text;row.append(child);}document.querySelector('#results').append(row);location.hash='#/result';};
   document.querySelector('#create').addEventListener('click',()=>{fixture.clicks++;fixture.fields={title:document.querySelector('#title').value,description:document.querySelector('#description').value,artistName:document.querySelector('#album-artist').value,idempotencyKey:document.querySelector('#request-key').value};
    const request=new XMLHttpRequest();request.open('POST','/fixture-create',false);request.setRequestHeader('Content-Type','application/json');request.send(JSON.stringify(fixture.fields));if(request.status!==200)throw Error('FIXTURE_CREATE_REJECTED');const result=JSON.parse(request.responseText);${noResult?'':'window.renderFixtureResult(result);'}
   });</script>`});
 });
 const page=await context.newPage();await page.goto(createUrl);assert.equal(page.url(),createUrl);
 return{page,context,binding,requests,writes,results,contract:fixtureCreateContract(),clicks:async()=>(await page.evaluate(()=>window.fixture)).clicks,fields:()=>page.evaluate(()=>window.fixture.fields),publishResult:result=>page.evaluate(value=>window.renderFixtureResult(value),result),clearResults:()=>page.locator('#results').evaluate(el=>el.replaceChildren())};
}
