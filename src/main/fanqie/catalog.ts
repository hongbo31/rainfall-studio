import {assertFanqieCatalogUrl, FanqieCatalogRowError, parseFanqieCatalog, parseFanqieWorkIdentity,
  readFanqieWorkStatus, type FanqieCatalog} from '../../shared/fanqie-catalog';
import type {Locator,Page} from 'playwright-core';
export * from '../../shared/fanqie-catalog';
type CatalogLocator = {
  evaluate<T>(fn: (el: Element) => T): Promise<T>;
};
export interface FanqieCatalogPage {
  url(): Promise<string | undefined>;
  playwright: {getByRole(role: string, options?: {name?: string; exact?: boolean}): CatalogLocator};
}

function snapshotCatalog(scope: Element) {
  const rows = (scope.matches('tr') ? [scope] : Array.from(scope.querySelectorAll('tr')))
    .map(row => Array.from(row.querySelectorAll<HTMLTableCellElement>('td'))).filter(cells => cells.length);
  const workFields = rows.map(([work]) => {
    const titleGroup = '[class*="task-title-content-main"]';
    const idGroup = '[class*="task-title-content-desc"]';
    if (!work.querySelector(titleGroup + ',' + idGroup)) return null;
    const text = (group: string) => {
      const values = new Set(Array.from(work.querySelectorAll<HTMLElement>(group + ' .music-ellipsis-text:not(.music-ellipsis-holder)'))
        .filter(node => node.getClientRects().length && getComputedStyle(node).visibility === 'visible')
        .map(node => node.innerText.trim()).filter(Boolean));
      return values.size === 1 ? [...values][0] : '';
    };
    return {title: text(titleGroup), idText: text(idGroup)};
  });
  return {
    selectedTabs: Array.from(scope.ownerDocument.querySelectorAll('[role="tab"][aria-selected="true"]')).map(tab => tab.textContent?.trim() ?? ''),
    queries: Array.from(scope.ownerDocument.querySelectorAll<HTMLInputElement>('input[placeholder="请输入作品名称"]')).map(input => input.value),
    headers: Array.from(scope.querySelectorAll('th')).map(header => (header.textContent ?? '').trim()),
    rows: rows.map(cells => cells.map(cell => cell.innerText)),
    workFields,
  };
}

export async function readFanqieCatalogWork(row: Locator) {
  const raw = await row.evaluate(snapshotCatalog);
  const [work = '', status = ''] = raw.rows[0] ?? [];
  return {...parseFanqieWorkIdentity(work, raw.workFields[0], 1), ...readFanqieWorkStatus(status)};
}

/** Does not navigate, clear filters, change tabs, or open an existing record. */
export async function readFanqieCatalog(page: FanqieCatalogPage, pageNumber = 1): Promise<FanqieCatalog> {
  const url = assertFanqieCatalogUrl(await page.url());
  const deadline = Date.now() + 15000;
  for (;;) {
    // One DOM read keeps the filter, tab count and rows from the same rendered state.
    const raw = await page.playwright.getByRole('tabpanel').evaluate(snapshotCatalog);
    if (await page.url() !== url) throw Error('FANQIE_CATALOG_PAGE_CHANGED');
    if (raw.selectedTabs.length !== 1 || raw.queries.length !== 1) throw Error('FANQIE_CATALOG_FILTERED');
    let parsed: ReturnType<typeof parseFanqieCatalog>;
    try {
      parsed = parseFanqieCatalog({selectedTab: raw.selectedTabs[0], query: raw.queries[0],
        headers: raw.headers, rows: raw.rows, workFields: raw.workFields});
    } catch (error) {
      if (error instanceof FanqieCatalogRowError) error.page = pageNumber;
      // The count badges and table rows can finish rendering at different times.
      if (error instanceof Error && ['FANQIE_CATALOG_COUNT_INVALID','FANQIE_CATALOG_WORK_TITLE_UNVERIFIED',
        'FANQIE_CATALOG_WORK_ID_UNVERIFIED'].includes(error.message) && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve,250)); continue;
      }
      throw error;
    }
    if ((parsed.rows.length === 0 || raw.rows.some(cells => !cells[1].trim())) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve,250)); continue;
    }
    // A transient zero-count SPA skeleton is indistinguishable from an empty account here.
    return {source: 'browser', url, observedAt: new Date().toISOString(), ...parsed, complete: parsed.complete && parsed.total > 0};
  }
}

/** Page through a fresh, application-owned catalog while retaining the all-works filter. */
export async function readFanqieCatalogPages(page:Page, guard:()=>void, untilId?:string):Promise<FanqieCatalog> {
  const read=(number:number)=>readFanqieCatalog({url:async()=>page.url(),playwright:page},number);
  guard();
  const first=await read(1);
  guard();
  const rows=[...first.rows],seen=new Set(rows.map(row=>row.id));
  const pager=page.getByRole('tabpanel').locator('.arco-table-pagination');
  const current=pager.locator('.arco-pagination-item-active[aria-current="true"]').filter({visible:true});
  const next=pager.getByRole('listitem',{name:'下一页',exact:true})
    .and(pager.locator('.arco-pagination-item-next:not(.arco-pagination-item-disabled)')).filter({visible:true});
  for(let number=1;seen.size<first.total&&(!untilId||!seen.has(untilId));number++){
    await current.waitFor({state:'visible',timeout:5000});
    if(await current.count()!==1||Number((await current.innerText()).trim())!==number||
       await next.count()!==1||!(await next.isEnabled()))break;
    guard();
    if(page.url()!==first.url)throw Error('FANQIE_CATALOG_PAGE_CHANGED');
    await next.click({timeout:5000});
    const deadline=Date.now()+15000;
    let advanced=false;
    while(Date.now()<deadline){
      guard();
      const result=await read(number+1);
      guard();
      if(result.total!==first.total||result.url!==first.url)throw Error('FANQIE_CATALOG_COUNT_INVALID');
      if(await current.count()===1&&Number((await current.innerText()).trim())===number+1&&
        result.rows.length&&result.rows.every(row=>!seen.has(row.id))){
        for(const row of result.rows){seen.add(row.id);rows.push(row);}
        advanced=true;
        break;
      }
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    if(!advanced)break;
    if(seen.size>first.total)throw Error('FANQIE_CATALOG_COUNT_INVALID');
  }
  return {...first,rows,complete:first.total>0&&seen.size===first.total,observedAt:new Date().toISOString()};
}
