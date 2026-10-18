import type {Page, Response} from 'playwright-core';
import {readOfficialProfileIdentity} from './browser-identity';
import {tmeAiSubjectHash} from '../../shared/tme-ai-prepare';

const origin='https://y.tencentmusic.com';
const profileUrl=`${origin}/#/user/musician/edit`;
const pendingUrl=`${origin}/#/user/manage/albumlist?tab=unPublish&type=Song`;
const pendingPath='/openapi/musician/original/cursorUnPublishSong';
const artistSelector='.mod_top_login .top_login__links .name';
const timeout=15_000;
const maxRows=100;
const maxResponseBytes=1_048_576;

export type OfficialAccount={kugouId:string;qqDisplayName:string;artistName:string};
export type OfficialPendingSong={id:string;name:string;albumId:string;albumName:string;status:'reviewing'|'rejected'|'published';observedAt:string};
export type OfficialPendingSongs={rows:OfficialPendingSong[];observedAt:string;url:string};
export type OfficialReleasedSong=OfficialPendingSong&{artistName:string;officialStatusText:string;platformStatusText:string;officialPublishedAtText:string};
type VisibleSongRow={cells:string[];cellTitles?:string[][]};

function assertOrigin(page:Page){
 let url:URL;try{url=new URL(page.url());}catch{throw Error('BROWSER_OFFICIAL_ORIGIN_REQUIRED');}
 if(url.origin!==origin||url.username||url.password)throw Error('BROWSER_OFFICIAL_ORIGIN_REQUIRED');
}

async function liveArtist(page:Page){
 assertOrigin(page);
 const names=await page.evaluate(selector=>{
  const visible=(el:Element)=>{if(!el.isConnected||!el.getClientRects().length)return false;for(let p:Element|null=el;p;p=p.parentElement){const s=getComputedStyle(p);if(s.display==='none'||s.visibility==='hidden'||s.visibility==='collapse'||Number(s.opacity)===0||p.getAttribute('aria-hidden')==='true')return false;}return true;};
  return Array.from(document.querySelectorAll(selector)).filter(visible).map(el=>(el as HTMLElement).innerText.trim().replace(/\s+/g,' '));
 },artistSelector);
 assertOrigin(page);
 if(names.length!==1||!names[0].trim()||names[0].trim().length>200)throw Error('BROWSER_ACCOUNT_IDENTITY_UNVERIFIED');
 return names[0].trim().replace(/\s+/g,' ');
}

async function assertPrimary(page:Page,url:string,artist:string){
 assertOrigin(page);
 if(page.url()!==url||await liveArtist(page)!==artist)throw Error('ACCOUNT_CHANGED');
}

async function readLoadedProfile(temporary:Page){
  await temporary.goto(profileUrl,{waitUntil:'domcontentloaded',timeout});
  if(temporary.url()!==profileUrl)throw Error('BROWSER_ACCOUNT_PROFILE_REQUIRED');
  const tab=temporary.getByRole('tab',{name:'绑定其他平台账号',exact:true});
  await tab.waitFor({state:'visible',timeout});
  await tab.click({timeout});
  await temporary.waitForFunction(()=>{
   const visible=(el:Element)=>!!el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden';
   const tabs=Array.from(document.querySelectorAll('[role="tab"][aria-selected="true"]')).filter(visible);
   return tabs.length===1&&tabs[0].textContent?.trim()==='绑定其他平台账号';
  },undefined,{timeout});
  // The selected tab appears before its account request completes; its initial scaffold says 未绑定.
  // Wait for the concrete bound values, then run the full strict identity reader below.
  try{await temporary.waitForFunction(()=>{
   const visible=(el:Element)=>!!el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden';
   const rows=Array.from(document.querySelectorAll('.account-item')).filter(visible);
   const values=(label:string)=>rows.filter(r=>Array.from(r.querySelectorAll('.account-item-content-label')).some(e=>visible(e)&&e.textContent?.trim()===label)).flatMap(r=>Array.from(r.querySelectorAll('.account-item-content-value')).filter(visible).map(e=>e.textContent?.trim()??''));
   return values('QQ音乐').some(v=>/^已绑定个人账号[：:]\s*\S/.test(v))&&values('酷狗音乐').some(v=>/^已绑定酷狗ID[：:]\s*\d{5,30}$/.test(v));
  },undefined,{timeout});}catch{throw Error('BROWSER_ACCOUNT_IDENTITY_UNVERIFIED');}
  const identity=await readOfficialProfileIdentity(temporary);

 return identity;
}

/** Reads a fresh official profile without navigating, closing, or editing the draft page. */
export async function readFreshOfficialAccount(page:Page,options:{expectedSubjectHash?:string}={}):Promise<OfficialAccount>{
 const primaryUrl=page.url(),artist=await liveArtist(page);
 const temporary=await page.context().newPage();
 try{
  const identity=await readLoadedProfile(temporary);
  if(identity.artistName!==artist||options.expectedSubjectHash!==undefined&&tmeAiSubjectHash(identity)!==options.expectedSubjectHash)throw Error('ACCOUNT_CHANGED');
  await assertPrimary(page,primaryUrl,artist);
  return identity;
 }finally{await temporary.close();}
}

function positiveId(value:unknown){
 if(typeof value==='number'&&(!Number.isSafeInteger(value)||value<=0))throw Error('BROWSER_PENDING_SONG_ID_INVALID');
 const id=typeof value==='number'?String(value):value;
 if(typeof id!=='string'||!(/^[1-9]\d{0,29}$/).test(id))throw Error('BROWSER_PENDING_SONG_ID_INVALID');
 return id;
}
function boundedText(value:unknown){
 if(typeof value!=='string'||!value.trim()||value.length>500)throw Error('BROWSER_PENDING_SONG_PAYLOAD_INVALID');
 return value.trim().replace(/\s+/g,' ');
}

/** Strict parser shared with offline fixtures; API numeric statuses are not inferred. */
export function parseOfficialPendingSongs(payload:unknown,visibleRows:VisibleSongRow[],observedAt:string):OfficialPendingSong[]{
 if(!Number.isFinite(Date.parse(observedAt)))throw Error('BROWSER_PENDING_OBSERVED_AT_INVALID');
 const value=payload as {code?:unknown;data?:{content?:unknown}}|null;
 if(!value||value.code!=='0'||!Array.isArray(value.data?.content)||value.data.content.length>maxRows||visibleRows.length>maxRows)throw Error('BROWSER_PENDING_SONG_PAYLOAD_INVALID');
 const records=value.data.content;
 const seen=new Set<string>();
 const matched=new Set<number>();
 const rows=records.map(record=>{
  if(!record||typeof record!=='object'||Array.isArray(record))throw Error('BROWSER_PENDING_SONG_PAYLOAD_INVALID');
  const row=record as Record<string,unknown>;
  const id=positiveId(row.id),albumId=positiveId(row.albumId),name=boundedText(row.name),albumName=boundedText(row.albumName);
  if(seen.has(id))throw Error('BROWSER_PENDING_SONG_DUPLICATE_ID');
  seen.add(id);
  if(typeof row.status!=='number'||!Number.isSafeInteger(row.status)||row.status<0)throw Error('BROWSER_PENDING_SONG_STATUS_UNKNOWN');
  const matches=visibleRows.map((visible,index)=>({visible,index})).filter(({visible})=>{
   const positions=(value:string)=>visible.cells.flatMap((text,i)=>text===value||visible.cellTitles?.[i]?.includes(value)?[i]:[]);
   return positions(name).some(songIndex=>positions(albumName).some(albumIndex=>songIndex!==albumIndex));
  });
  if(matches.length!==1||matched.has(matches[0].index))throw Error('BROWSER_PENDING_SONG_ROW_UNVERIFIED');
  const {visible,index}=matches[0];matched.add(index);
  const labels=visible.cells.filter(text=>text!==name&&text!==albumName&&['审核中','审核未通过','审核不通过','已驳回','已拒绝','已发布'].includes(text));
  if(labels.length!==1)throw Error('BROWSER_PENDING_SONG_STATUS_UNKNOWN');
  let status:OfficialPendingSong['status'];
  if(row.status===0&&labels[0]==='审核中')status='reviewing';
  else if(row.status!==0&&labels[0]==='已发布')status='published';
  else if(row.status!==0&&['审核未通过','审核不通过','已驳回','已拒绝'].includes(labels[0]))status='rejected';
  else throw Error('BROWSER_PENDING_SONG_STATUS_UNKNOWN');
  return{id,name,albumId,albumName,status,observedAt};
 });
 // A partial API page or stale SPA table cannot silently become a complete receipt.
 if(matched.size!==visibleRows.length)throw Error('BROWSER_PENDING_SONG_ROW_UNVERIFIED');
 return rows;
}

function isPendingResponse(response:Response){
 // The official SPA has used POST and GET for this same read endpoint; both are observed page requests.
 try{const url=new URL(response.url());return url.origin===origin&&!url.username&&!url.password&&url.pathname===pendingPath&&['GET','POST'].includes(response.request().method());}catch{return false;}
}

/** Observes the page's own list request; never makes an API request or submits a song. */
export async function readOfficialPendingSongs(page:Page):Promise<OfficialPendingSongs>{
 const primaryUrl=page.url(),artist=await liveArtist(page);
 const temporary=await page.context().newPage();
 try{
  const profile=await readLoadedProfile(temporary);if(profile.artistName!==artist)throw Error('ACCOUNT_CHANGED');
  const responsePromise=temporary.waitForResponse(isPendingResponse,{timeout});
  // Handle navigation failure without leaving the outstanding response wait unhandled.
  void responsePromise.catch(()=>{});
  // Direct initial deep links can be redirected by the SPA before musician bootstrap completes.
  await temporary.evaluate(hash=>{window.location.hash=hash},new URL(pendingUrl).hash);
  const response=await responsePromise;
  if(temporary.url()!==pendingUrl||response.status()!==200||response.fromServiceWorker()||response.request().frame().page()!==temporary)throw Error('BROWSER_PENDING_RESPONSE_UNVERIFIED');
  const body=await response.text();
  if(Buffer.byteLength(body,'utf8')>maxResponseBytes)throw Error('BROWSER_PENDING_RESPONSE_TOO_LARGE');
  let payload:unknown;try{payload=JSON.parse(body);}catch{throw Error('BROWSER_PENDING_SONG_PAYLOAD_INVALID');}
  const content=(payload as {data?:{content?:unknown}}|null)?.data?.content;
  if(!Array.isArray(content)||content.length>maxRows)throw Error('BROWSER_PENDING_SONG_PAYLOAD_INVALID');
  await temporary.waitForFunction(expected=>{
   const visible=(el:Element)=>{if(!el.isConnected||!el.getClientRects().length)return false;for(let p:Element|null=el;p;p=p.parentElement){const s=getComputedStyle(p);if(s.display==='none'||s.visibility==='hidden'||s.visibility==='collapse'||Number(s.opacity)===0||p.getAttribute('aria-hidden')==='true')return false;}return true;};
   const rows=Array.from(document.querySelectorAll('.el-table__body-wrapper tr')).filter(visible);
   return expected>0?rows.length>0:Array.from(document.querySelectorAll('.el-table__empty-block')).some(visible);
  },content.length,{timeout});
  const visibleRows=await temporary.evaluate(()=>{
   const visible=(el:Element)=>{if(!el.isConnected||!el.getClientRects().length)return false;for(let p:Element|null=el;p;p=p.parentElement){const s=getComputedStyle(p);if(s.display==='none'||s.visibility==='hidden'||s.visibility==='collapse'||Number(s.opacity)===0||p.getAttribute('aria-hidden')==='true')return false;}return true;};
   const text=(el:Element)=>(el as HTMLElement).innerText.trim().replace(/\s+/g,' ');
   return Array.from(document.querySelectorAll('.el-table__body-wrapper tr')).filter(visible).map(row=>{
    const cells=Array.from(row.querySelectorAll('td')).filter(visible);
    return{cells:cells.map(text),cellTitles:cells.map(cell=>Array.from(cell.querySelectorAll('[title]')).filter(visible).map(el=>el.getAttribute('title')?.trim().replace(/\s+/g,' ')||'').filter(Boolean))};
   });
  });
  const observedAt=new Date().toISOString();
  const rows=parseOfficialPendingSongs(payload,visibleRows,observedAt);
  if(temporary.url()!==pendingUrl||await liveArtist(temporary)!==artist)throw Error('ACCOUNT_CHANGED');
  await assertPrimary(page,primaryUrl,artist);
  return{rows,observedAt,url:pendingUrl};
 }finally{await temporary.close();}
}

/** Already approved songs leave the pending list. Observe the known existing album's own list request. */
export async function readOfficialReleasedSong(page:Page,expected:{id:string;name:string;albumId:string;albumName:string;artistName:string}):Promise<{row:OfficialReleasedSong;url:string}>{
 if(!/^[1-9]\d{4,19}$/.test(expected.id)||!/^[1-9]\d{0,19}$/.test(expected.albumId)||expected.id===expected.albumId)throw Error('SONG_RECORD_ID_REQUIRED');
 const primaryUrl=page.url(),artist=await liveArtist(page),temporary=await page.context().newPage();
 try{
  const profile=await readLoadedProfile(temporary);if(profile.artistName!==artist||artist!==expected.artistName)throw Error('ACCOUNT_CHANGED');
  // Use the observed menu entry; initial direct album links can be reset by this SPA's router.
  await temporary.getByText('歌曲管理',{exact:true}).click({timeout});
  await temporary.getByText('原创作品',{exact:true}).click({timeout});
  // The published-song table omits per-song audit labels. Verify its published album context explicitly.
  await temporary.waitForFunction(album=>Array.from(document.querySelectorAll('.el-table__body-wrapper tr')).filter(r=>!!r.getClientRects().length&&getComputedStyle(r).visibility!=='hidden').some(r=>Array.from(r.querySelectorAll('*')).some(e=>!!e.getClientRects().length&&e.textContent?.trim()===album)&&Array.from(r.querySelectorAll('*')).some(e=>!!e.getClientRects().length&&/^已发布(?:[1-9]\d*)?$/.test(e.textContent?.trim()??''))),expected.albumName,{timeout});
  const url=`${origin}/#/user/manage/songlist/${expected.albumId}`;
  const responsePromise=temporary.waitForResponse(r=>{try{const u=new URL(r.url());return u.origin===origin&&u.pathname==='/openapi/musician/transmit/v2/v2/album/getAlbumSongList'&&r.request().method()==='GET'}catch{return false}},{timeout});void responsePromise.catch(()=>{});
  await temporary.evaluate(hash=>{window.location.hash=hash},new URL(url).hash);
  const response=await responsePromise;
  if(response.status()!==200||response.fromServiceWorker()||response.request().frame().page()!==temporary||temporary.url()!==url)throw Error('BROWSER_RELEASED_RESPONSE_UNVERIFIED');
  const body=await response.text();if(Buffer.byteLength(body,'utf8')>maxResponseBytes)throw Error('BROWSER_PENDING_RESPONSE_TOO_LARGE');
  let payload:any;try{payload=JSON.parse(body)}catch{throw Error('BROWSER_RELEASED_RESPONSE_UNVERIFIED')}
  if(payload.code!=='0'||!Array.isArray(payload.data)||payload.data.length>maxRows)throw Error('BROWSER_RELEASED_RESPONSE_UNVERIFIED');
  const matches=payload.data.filter((r:any)=>String(r.id)===expected.id&&r.name===expected.name&&String(r.albumid)===expected.albumId&&r.albumName===expected.albumName&&r.singerName===expected.artistName);
  if(matches.length!==1)throw Error('OFFICIAL_RECEIPT_SCOPE');const record=matches[0];
  if(record.status!==1||record.statusStr!=='审核通过'||record.qqmusicstatus!==1||record.kugoustatus!==1||typeof record.platformPublishStatusStr!=='string'||!record.platformPublishStatusStr.includes('QQ音乐、酷狗音乐已上架'))throw Error('OFFICIAL_RELEASE_STATUS_UNVERIFIED');
  await temporary.waitForFunction(title=>Array.from(document.querySelectorAll('.el-table__body-wrapper tr')).filter(r=>!!r.getClientRects().length&&getComputedStyle(r).visibility!=='hidden').some(r=>Array.from(r.querySelectorAll('td')).some(c=>(c as HTMLElement).innerText.split('\n').some(line=>line.trim()===title))),expected.name,{timeout});
  const visibleMatches=await temporary.evaluate(title=>Array.from(document.querySelectorAll('.el-table__body-wrapper tr')).filter(r=>!!r.getClientRects().length&&getComputedStyle(r).visibility!=='hidden').filter(r=>Array.from(r.querySelectorAll('td')).some(c=>(c as HTMLElement).innerText.split('\n').some(line=>line.trim()===title))).length,expected.name);
  const contradictory=await temporary.evaluate(title=>Array.from(document.querySelectorAll('.el-table__body-wrapper tr')).filter(r=>!!r.getClientRects().length&&getComputedStyle(r).visibility!=='hidden').filter(r=>Array.from(r.querySelectorAll('td')).some(c=>(c as HTMLElement).innerText.split('\n').some(line=>line.trim()===title))).some(r=>Array.from(r.querySelectorAll('td')).some(c=>/审核未通过|审核不通过|审核中|已驳回/.test((c as HTMLElement).innerText))),expected.name);
  if(visibleMatches!==1||contradictory||!(await temporary.locator('body').innerText()).split('\n').some(line=>line.trim()===expected.albumName)||await liveArtist(temporary)!==artist)throw Error('BROWSER_RELEASED_ROW_UNVERIFIED');
  await assertPrimary(page,primaryUrl,artist);
  const observedAt=new Date().toISOString();return{row:{id:expected.id,name:expected.name,albumId:expected.albumId,albumName:expected.albumName,artistName:expected.artistName,status:'published',officialStatusText:'审核通过',platformStatusText:record.platformPublishStatusStr.replace(/<br\s*\/?>/gi,'；'),officialPublishedAtText:String(record.publishTimeStr??''),observedAt},url};
 }finally{await temporary.close()}
}
