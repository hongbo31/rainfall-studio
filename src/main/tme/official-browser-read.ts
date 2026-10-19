import type {Page, Response} from 'playwright-core';
import {readOfficialProfileIdentity} from './browser-identity';
import {tmeAiSubjectHash} from '../../shared/tme-ai-prepare';
import {openBackgroundOfficialPage,observedJson,verifiedVisiblePage,visibleNext,advanceObserved,observeListResponses,type OfficialSourceCoverage,type OfficialVisibleRow} from './official-catalog-pagination';

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
export type OfficialPendingSongs={rows:OfficialPendingSong[];observedAt:string;url:string;coverage:OfficialSourceCoverage};
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
 const temporary=await openBackgroundOfficialPage(page);
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
export async function readOfficialPendingSongs(page:Page,options:{expectedSubjectHash?:string}={}):Promise<OfficialPendingSongs>{
 const primaryUrl=page.url(),artist=await liveArtist(page);
 const temporary=await openBackgroundOfficialPage(page);
 try{
  const profile=await readLoadedProfile(temporary),subject=tmeAiSubjectHash(profile);if(profile.artistName!==artist||options.expectedSubjectHash!==undefined&&subject!==options.expectedSubjectHash)throw Error('ACCOUNT_CHANGED');
  const guard=async()=>{if(temporary.url()!==pendingUrl||await liveArtist(temporary)!==artist)throw Error('ACCOUNT_CHANGED');await assertPrimary(page,primaryUrl,artist);};
  const observed=observeListResponses(temporary,isPendingResponse),rows:OfficialPendingSong[]=[],seen=new Set<string>(),cursors=new Set<string>(),reasons:string[]=[];
  let previousVisible:OfficialVisibleRow[]=[],pagesRead=0,complete=false,expectedCursor:string|undefined;
  try{
   await temporary.evaluate(hash=>{window.location.hash=hash},new URL(pendingUrl).hash);
   for(;;){
    const response=await observed.next();await guard();const payload=await observedJson(response,temporary,pendingUrl),content=payload?.data?.content;
    if(payload?.code!=='0'||!Array.isArray(content)||content.length>maxRows)throw Error('BROWSER_PENDING_SONG_PAYLOAD_INVALID');
    const request=response.request(),cursorParams=request.method()==='GET'?new URL(request.url()).searchParams:undefined,actualCursor=cursorParams?cursorParams.get('cursor'):request.postDataJSON()?.cursor;
    if(cursorParams&&cursorParams.getAll('cursor').length>1)throw Error('BROWSER_CATALOG_CURSOR_SEQUENCE');
    if(expectedCursor===undefined&&actualCursor!==undefined&&actualCursor!==null&&actualCursor!=='')throw Error('BROWSER_CATALOG_CURSOR_START_UNVERIFIED');
    if(expectedCursor!==undefined&&actualCursor!==expectedCursor)throw Error('BROWSER_CATALOG_CURSOR_SEQUENCE');
    const hasMore=payload.data.hasMore;if(hasMore!==undefined&&typeof hasMore!=='boolean')throw Error('BROWSER_CATALOG_CURSOR_INVALID');
    if(hasMore!==undefined){
     const request=response.request(),query=request.method()==='GET'?new URL(request.url()).searchParams:undefined;
     if(query&&['name','showStatus','pageSize'].some(key=>query.getAll(key).length!==1))throw Error('BROWSER_CATALOG_FILTERED_SCOPE');
     const params=query?Object.fromEntries(query):request.postDataJSON();if(params?.name!==''||String(params?.showStatus)!=='0')throw Error('BROWSER_CATALOG_FILTERED_SCOPE');if(!/^[1-9]\d*$/.test(String(params?.pageSize))||content.length>Number(params.pageSize))throw Error('BROWSER_CATALOG_REQUEST_PAGE_MISMATCH');
    }
    const observedAt=new Date().toISOString(),offset=rows.length;
    const parsed=await verifiedVisiblePage(temporary,'.song-list',content.length===0,visible=>{
     if(visible.length<offset+content.length||hasMore===false&&visible.length!==offset+content.length||JSON.stringify(visible.slice(0,offset))!==JSON.stringify(previousVisible))throw Error('BROWSER_PENDING_SONG_ROW_UNVERIFIED');
     const parsed=parseOfficialPendingSongs(payload,visible.slice(offset,offset+content.length),observedAt);previousVisible=visible.slice(0,offset+content.length);return parsed;
    },'暂无歌曲');
    for(const row of parsed){if(seen.has(row.id))throw Error('BROWSER_CATALOG_DUPLICATE_ID');seen.add(row.id);rows.push(row);}pagesRead++;await guard();
    if(hasMore===false){
     if(rows.length){const marker=temporary.locator('.song-list .cursor-pagination-status').filter({visible:true});if(await marker.count()!==1||(await marker.innerText()).trim()!=='没有更多了'){reasons.push('BROWSER_CATALOG_CURSOR_TERMINATION_UNVERIFIED');break;}}
     complete=true;break;
    }
    if(hasMore===undefined){reasons.push('BROWSER_CATALOG_CURSOR_TERMINATION_UNVERIFIED');break;}
    const nextCursor=payload.data.nextCursor;if(typeof nextCursor!=='string'||!nextCursor||nextCursor.length>4000)throw Error('BROWSER_CATALOG_CURSOR_INVALID');
    if(cursors.has(nextCursor))throw Error('BROWSER_CATALOG_CURSOR_CYCLE');cursors.add(nextCursor);expectedCursor=nextCursor;
    if(!parsed.length)throw Error('BROWSER_CATALOG_EMPTY_NONTERMINAL_PAGE');
    if(!observed.hasQueued()){
     const table=temporary.locator('.song-list .el-table__body-wrapper').filter({visible:true});
     const status=temporary.locator('.song-list .cursor-pagination-status').filter({visible:true});
     if(await table.count()!==1||await status.count()!==1||(await status.innerText()).trim()!=='向下滚动加载更多'){reasons.push('BROWSER_CATALOG_SCROLL_CONTROL_UNVERIFIED');break;}
     await guard();await table.evaluate(el=>{el.scrollTop=el.scrollHeight;});
    }
   }
  }finally{observed.close();}
  // Same visible artist can represent another account; re-read the full binding at completion.
  const finalProfile=await readLoadedProfile(temporary);if(tmeAiSubjectHash(finalProfile)!==subject)throw Error('ACCOUNT_CHANGED');await assertPrimary(page,primaryUrl,artist);
  return{rows,observedAt:rows.at(-1)?.observedAt??new Date().toISOString(),url:pendingUrl,coverage:{source:'official-pending-song-reference',pagesRead,rowCount:rows.length,complete,reasons}};
 }finally{await temporary.close();}
}

export type OfficialAlbumDirectoryRow={id:string;name:string;artistName:string;songCount:number;publication:'published'|'unpublished';observedAt:string};
export type OfficialAlbumDirectory={rows:OfficialAlbumDirectoryRow[];observedAt:string;url:string;coverage:OfficialSourceCoverage;sourceCoverage:(OfficialSourceCoverage&{publication:'published'|'unpublished';totalCount:number})[]};

/** Names, IDs and pagination metadata are the observed official original-album contract.
 * Status enum numbers are deliberately not mapped to submission or publication receipts. */
export function parseOfficialAlbumDirectoryPage(payload:unknown,visible:OfficialVisibleRow[],publication:'published'|'unpublished',artist:string,observedAt:string):OfficialAlbumDirectoryRow[]{
 const value=payload as any;
 if(value?.code!=='0'||!Array.isArray(value.data?.content)||value.data.content.length>1000||!Number.isFinite(Date.parse(observedAt)))throw Error('BROWSER_ALBUM_PAYLOAD_INVALID');
 const matched=new Set<number>(),seen=new Set<string>();
 const rows=value.data.content.map((record:any)=>{
  if(!record||typeof record!=='object'||Array.isArray(record)||!Number.isSafeInteger(record.songnum)||record.songnum<0)throw Error('BROWSER_ALBUM_PAYLOAD_INVALID');
  const id=positiveId(record.id),name=boundedText(record.name),artistName=record.singerName===undefined?artist:boundedText(record.singerName);
  if(seen.has(id))throw Error('BROWSER_CATALOG_DUPLICATE_ID');seen.add(id);
  if(publication==='published'&&(!Number.isSafeInteger(record.publishSongnum)||record.publishSongnum<0||!Number.isSafeInteger(record.unPublishSongnum)||record.unPublishSongnum<0))throw Error('BROWSER_ALBUM_PAYLOAD_INVALID');
  const countLabel=publication==='published'?'已发布'+record.publishSongnum+(record.unPublishSongnum?',未发布'+record.unPublishSongnum:''):record.songnum?String(record.songnum):'-';
  const matches=visible.flatMap((row,index)=>{
   const nameIndex=row.columnLabels?.indexOf('专辑名称')??-1,countIndex=row.columnLabels?.indexOf('歌曲数')??-1;
   if(nameIndex<0||countIndex<0||nameIndex===countIndex||row.columnLabels?.filter(l=>l==='专辑名称').length!==1||row.columnLabels?.filter(l=>l==='歌曲数').length!==1)return[];
   return(row.cells[nameIndex]===name||row.cellTitles?.[nameIndex]?.includes(name))&&row.cells[countIndex]===countLabel?[index]:[];
  });
  if(matches.length!==1||matched.has(matches[0]))throw Error('BROWSER_ALBUM_ROW_UNVERIFIED');matched.add(matches[0]);
  return{id,name,artistName,songCount:record.songnum,publication,observedAt};
 });
 if(matched.size!==visible.length)throw Error('BROWSER_ALBUM_ROW_UNVERIFIED');return rows;
}

/** Reads both observed original-album sources, clicking only the official visible next
 * control. It never calculates a request page/cursor, calls an API, or edits a user page. */
export async function readOfficialAlbumDirectory(page:Page,options:{expectedSubjectHash?:string}={}):Promise<OfficialAlbumDirectory>{
 const primaryUrl=page.url(),artist=await liveArtist(page),temporary=await openBackgroundOfficialPage(page);
 try{
  const profile=await readLoadedProfile(temporary),subject=tmeAiSubjectHash(profile);if(profile.artistName!==artist||options.expectedSubjectHash!==undefined&&subject!==options.expectedSubjectHash)throw Error('ACCOUNT_CHANGED');
  const rows:OfficialAlbumDirectoryRow[]=[],sourceCoverage:OfficialAlbumDirectory['sourceCoverage']=[],seen=new Set<string>();
  for(const publication of ['published','unpublished'] as const){
   const path='/cd-gateway/musician/original/'+(publication==='published'?'pagePublishAlbum':'pageUnPublishAlbum');
   const targetUrl=publication==='published'?`${origin}/#/user/manage/albumlist`:`${origin}/#/user/manage/albumlist?tab=unPublish&type=Album`;
   const predicate=(response:Response)=>{try{const u=new URL(response.url());return u.origin===origin&&!u.username&&!u.password&&u.pathname===path&&response.request().method()==='GET';}catch{return false;}};
   const guard=async()=>{
    if(temporary.url()!==targetUrl||await liveArtist(temporary)!==artist)throw Error('ACCOUNT_CHANGED');
    const selected=temporary.locator('#tab-'+(publication==='published'?'published':'unPublish')+'[role="tab"][aria-selected="true"]');
    if(await selected.count()!==1||!await selected.isVisible()||!await selected.evaluate(el=>{for(let p:Element|null=el;p;p=p.parentElement){const s=getComputedStyle(p);if(s.display==='none'||s.visibility==='hidden'||s.visibility==='collapse'||Number(s.opacity)===0||p.getAttribute('aria-hidden')==='true')return false;}return true;}))throw Error('BROWSER_ALBUM_TAB_UNVERIFIED');
    await assertPrimary(page,primaryUrl,artist);
   };
   let response:Response;
   if(publication==='published')response=await advanceObserved(temporary,predicate,async()=>{await temporary.getByText('歌曲管理',{exact:true}).click({timeout});await temporary.getByText('原创作品',{exact:true}).click({timeout});});
   else response=await advanceObserved(temporary,predicate,()=>temporary.getByText('未发布',{exact:true}).click({timeout}));
   // The actual tab click starts its list request before committing the SPA's query route.
   await temporary.waitForURL(targetUrl,{timeout});
   let expectedPage=1,total:number|undefined,pageSize:number|undefined,count=0,pagesRead=0,complete=false;const reasons:string[]=[];
   for(;;){
    await guard();const payload=await observedJson(response,temporary,targetUrl),data=payload?.data;
    if(payload?.code!=='0'||!data||!Array.isArray(data.content)||!Number.isSafeInteger(data.pageNo)||data.pageNo<1||!Number.isSafeInteger(data.pageSize)||data.pageSize<1||data.pageSize>1000||!Number.isSafeInteger(data.totalCount)||data.totalCount<0)throw Error('BROWSER_ALBUM_PAGINATION_INVALID');
    const params=new URL(response.request().url()).searchParams;
    if(params.getAll('name').length!==1||params.get('name')!==''||params.getAll('showStatus').length!==1||params.get('showStatus')!=='0')throw Error('BROWSER_CATALOG_FILTERED_SCOPE');
    if(params.getAll('pageNo').length!==1||params.getAll('pageSize').length!==1||params.get('pageNo')!==String(data.pageNo)||params.get('pageSize')!==String(data.pageSize))throw Error('BROWSER_CATALOG_REQUEST_PAGE_MISMATCH');
    if(data.pageNo!==expectedPage)throw Error('BROWSER_CATALOG_PAGE_SEQUENCE');
    if(total!==undefined&&total!==data.totalCount||pageSize!==undefined&&pageSize!==data.pageSize)throw Error('BROWSER_CATALOG_TOTAL_CHANGED');total=data.totalCount;pageSize=data.pageSize;
    if(data.content.length!==Math.min(pageSize!,Math.max(0,total!-count)))throw Error('BROWSER_CATALOG_PAGE_COUNT_INCONSISTENT');
    const observedAt=new Date().toISOString();
    const parsed=await verifiedVisiblePage(temporary,'.album-list',!data.content.length,visible=>parseOfficialAlbumDirectoryPage(payload,visible,publication,artist,observedAt));
    for(const row of parsed){if(seen.has(row.id))throw Error('BROWSER_CATALOG_DUPLICATE_ID');seen.add(row.id);rows.push(row);}count+=parsed.length;pagesRead++;await guard();
    if(count===total){if(await visibleNext(temporary))throw Error('BROWSER_CATALOG_TERMINATION_INCONSISTENT');complete=true;break;}
    const next=await visibleNext(temporary);if(!next){reasons.push('BROWSER_CATALOG_NEXT_CONTROL_UNVERIFIED');break;}
    await guard();response=await advanceObserved(temporary,predicate,()=>next.click({timeout}));expectedPage++;
   }
   sourceCoverage.push({source:'official-album-directory',publication,pagesRead,rowCount:count,complete,reasons,totalCount:total!});
  }
  const finalProfile=await readLoadedProfile(temporary);if(tmeAiSubjectHash(finalProfile)!==subject)throw Error('ACCOUNT_CHANGED');await assertPrimary(page,primaryUrl,artist);
  const coverage:OfficialSourceCoverage={source:'official-album-directory',pagesRead:sourceCoverage.reduce((n,s)=>n+s.pagesRead,0),rowCount:rows.length,complete:sourceCoverage.every(s=>s.complete),reasons:[...new Set(sourceCoverage.flatMap(s=>s.reasons))]};
  return{rows,observedAt:new Date().toISOString(),url:`${origin}/#/user/manage/albumlist`,coverage,sourceCoverage};
 }finally{await temporary.close();}
}

/** Already approved songs leave the pending list. Observe the known existing album's own list request. */
export async function readOfficialReleasedSong(page:Page,expected:{id:string;name:string;albumId:string;albumName:string;artistName:string}):Promise<{row:OfficialReleasedSong;url:string}>{
 if(!/^[1-9]\d{4,19}$/.test(expected.id)||!/^[1-9]\d{0,19}$/.test(expected.albumId)||expected.id===expected.albumId)throw Error('SONG_RECORD_ID_REQUIRED');
 const primaryUrl=page.url(),artist=await liveArtist(page),temporary=await openBackgroundOfficialPage(page);
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

/** Read-only production mapping observed in 1420.d8a8271d.js on 2026-10-19.
 * The displayed selected.name and the component's selected.id must agree with the
 * propagated albumInfo. A title, list position, DOM data-id or prefilling alone is
 * never albumId evidence. Does not select, emit, save or submit anything. */
export async function readOfficialSelectedAlbum(page:Page):Promise<{albumId:string;title:string;artistName:string;provenance:'official-selected-album-state'}|null>{
 const route='https://y.tencentmusic.com/#/user/manage/aiChoose/add';
 if(page.url()!==route)throw Error('ALBUM_INTAKE_ROUTE_REQUIRED');
 const artistName=await liveArtist(page);
 const selected=await page.evaluate(()=>{
  const fail=()=>{throw Error('ALBUM_SELECTED_STATE_UNVERIFIED')};
  const visible=(el:Element)=>{if(!el.isConnected||!el.getClientRects().length)return false;for(let p:Element|null=el;p;p=p.parentElement){const s=getComputedStyle(p);if(s.display==='none'||s.visibility==='hidden'||s.visibility==='collapse'||Number(s.opacity)===0||p.getAttribute('aria-hidden')==='true')return false;}return true;};
  const roots=Array.from(document.querySelectorAll('.album-search')).filter(visible);
  if(roots.length!==1)return fail();
  const root=roots[0],vm=(root as Element&{__vue__?:any}).__vue__;
  if(!vm||vm.$el!==root||vm.$props?.mode!=='origin')return fail();
  const record=vm.$data?.selected,info=vm.$props?.albumInfo;
  const titles=Array.from(root.querySelectorAll('.selected .album strong')).filter(visible);
  if(record===null&&titles.length===0&&!info?.id&&info?.mode!=='exit')return null;
  if(!record||!info||titles.length!==1||record.prefillFlag||info.prefillFlag||info.mode!=='exit')return fail();
  const id=(value:unknown)=>{if(typeof value==='number'&&(!Number.isSafeInteger(value)||value<=0))return fail();const s=typeof value==='number'?String(value):value;if(typeof s!=='string'||!/^[1-9]\d{0,29}$/.test(s))return fail();return s;};
  const albumId=id(record.id);if(id(info.id)!==albumId)return fail();
  const title=(titles[0] as HTMLElement).innerText.trim().replace(/\s+/g,' ');
  if(!title||title.length>200||typeof record.name!=='string'||typeof info.name!=='string'||record.name.trim().replace(/\s+/g,' ')!==title||info.name.trim().replace(/\s+/g,' ')!==title)return fail();
  return{albumId,title};
 });
 if(page.url()!==route||await liveArtist(page)!==artistName)throw Error('ACCOUNT_CHANGED');
 return selected?{...selected,artistName,provenance:'official-selected-album-state'}:null;
}
