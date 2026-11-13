import type {Page,Response} from 'playwright-core';
export {openBackgroundOfficialPage} from '../background-page';
export type OfficialSourceCoverage={source:'official-album-directory'|'official-pending-song-reference';pagesRead:number;rowCount:number;complete:boolean;reasons:string[]};
export type OfficialVisibleRow={cells:string[];cellTitles?:string[][];columnLabels?:string[]};
const timeout=15_000;

export async function visibleRows(page:Page,root:string):Promise<OfficialVisibleRow[]>{
 return page.evaluate(root=>{
  const visible=(el:Element)=>{if(!el.isConnected||!el.getClientRects().length)return false;for(let p:Element|null=el;p;p=p.parentElement){const s=getComputedStyle(p);if(s.display==='none'||s.visibility==='hidden'||s.visibility==='collapse'||Number(s.opacity)===0||p.getAttribute('aria-hidden')==='true')return false;}return true;};
  const text=(el:Element)=>(el as HTMLElement).innerText.trim().replace(/\s+/g,' ');
  return Array.from(document.querySelectorAll(root+' .el-table__body-wrapper tr')).filter(visible).map(row=>{
   const cells=Array.from(row.querySelectorAll('td')).filter(visible);
   const table=row.closest('.el-table'),columnLabels=table?Array.from(table.querySelectorAll('.el-table__header-wrapper th')).filter(visible).map(text):undefined;
   return{cells:cells.map(text),cellTitles:cells.map(cell=>Array.from(cell.querySelectorAll('[title]')).filter(visible).map(el=>el.getAttribute('title')?.trim().replace(/\s+/g,' ')||'').filter(Boolean)),...(columnLabels?{columnLabels}:{})};
  });
 },root);
}

/** Wait for the current response's exact table, rather than accepting the preceding SPA page. */
export async function verifiedVisiblePage<T>(page:Page,root:string,empty:boolean,parse:(rows:OfficialVisibleRow[])=>T,emptyLabel?:string):Promise<T>{
 const deadline=Date.now()+timeout;let last:unknown;
 do{
  const rows=await visibleRows(page,root);
  const state=await page.evaluate(root=>{
   const visible=(el:Element)=>{if(!el.getClientRects().length)return false;for(let p:Element|null=el;p;p=p.parentElement){const s=getComputedStyle(p);if(s.display==='none'||s.visibility==='hidden'||s.visibility==='collapse'||Number(s.opacity)===0||p.getAttribute('aria-hidden')==='true')return false;}return true;};
   return{roots:Array.from(document.querySelectorAll(root)).filter(visible).length,empties:Array.from(document.querySelectorAll(root+' .el-table__empty-block')).filter(visible).map(el=>(el as HTMLElement).innerText.trim().replace(/\s+/g,' '))};
  },root);
  if(state.roots!==1)last=Error('BROWSER_CATALOG_ROOT_UNVERIFIED');
  else if(empty&&(state.empties.length!==1||emptyLabel!==undefined&&state.empties[0]!==emptyLabel))last=Error('BROWSER_CATALOG_EMPTY_STATE_UNVERIFIED');
  else try{return parse(rows);}catch(error){last=error;if(!(error instanceof Error)||!error.message.includes('ROW_UNVERIFIED'))throw error;}
  await new Promise(resolve=>setTimeout(resolve,75));
 }while(Date.now()<deadline);
 throw last??Error('BROWSER_CATALOG_TABLE_TIMEOUT');
}

export async function observedJson(response:Response,page:Page,expectedUrl:string):Promise<any>{
 if(page.url()!==expectedUrl||response.status()!==200||response.fromServiceWorker()||response.request().frame().page()!==page)throw Error('BROWSER_PENDING_RESPONSE_UNVERIFIED');
 const body=await response.text();if(Buffer.byteLength(body,'utf8')>1_048_576)throw Error('BROWSER_PENDING_RESPONSE_TOO_LARGE');
 try{return JSON.parse(body);}catch{throw Error('BROWSER_PENDING_SONG_PAYLOAD_INVALID');}
}

export async function visibleNext(page:Page){
 const selector='.album-list .pagination-contanier .el-pagination button.btn-next';
 const matches=await page.locator(selector).all(),visible=[];
 for(const item of matches)if(await item.isVisible()&&await item.evaluate(el=>{for(let p:Element|null=el;p;p=p.parentElement){const s=getComputedStyle(p);if(s.display==='none'||s.visibility==='hidden'||s.visibility==='collapse'||Number(s.opacity)===0||p.getAttribute('aria-hidden')==='true')return false;}return true;}))visible.push(item);
 if(visible.length!==1||!await visible[0].isEnabled())return null;
 return visible[0];
}

/** Owns exactly one pending observed-response wait, including all rejection paths. */
export async function advanceObserved(page:Page,predicate:(response:Response)=>boolean,advance:()=>Promise<unknown>){
 const response=page.waitForResponse(predicate,{timeout});void response.catch(()=>{});
 await advance();try{return await response;}catch{throw Error('BROWSER_CATALOG_PAGE_TIMEOUT');}
}

/** Cursor tables can auto-load another page while the first one is rendering. Keep their
 * real responses in order; never manufacture the page's cursor or issue a direct request. */
export function observeListResponses(page:Page,predicate:(response:Response)=>boolean){
 const queued:Response[]=[];let waiter:((response:Response)=>void)|undefined;
 const listener=(response:Response)=>{if(!predicate(response))return;if(waiter){const resolve=waiter;waiter=undefined;resolve(response);}else queued.push(response);};
 page.on('response',listener);
 return{hasQueued:()=>queued.length>0,next:()=>queued.length?Promise.resolve(queued.shift()!):new Promise<Response>((resolve,reject)=>{
  const timer=setTimeout(()=>{waiter=undefined;reject(Error('BROWSER_CATALOG_PAGE_TIMEOUT'));},timeout);
  waiter=response=>{clearTimeout(timer);resolve(response);};
 }),close:()=>{page.off('response',listener);}};
}
