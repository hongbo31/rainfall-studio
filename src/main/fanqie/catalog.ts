import {assertFanqieCatalogUrl, parseFanqieCatalog, type FanqieCatalog} from '../../shared/fanqie-catalog';
export * from '../../shared/fanqie-catalog';
type CatalogLocator = {
  evaluate<T>(fn: (el: Element) => T): Promise<T>;
};
export interface FanqieCatalogPage {
  url(): Promise<string | undefined>;
  playwright: {getByRole(role: string, options?: {name?: string; exact?: boolean}): CatalogLocator};
}
/** Does not navigate, clear filters, change tabs, or open an existing record. */
export async function readFanqieCatalog(page: FanqieCatalogPage): Promise<FanqieCatalog> {
  const url = assertFanqieCatalogUrl(await page.url());
  const deadline = Date.now() + 15000;
  for (;;) {
  // One DOM read keeps the filter, tab count and rows from the same rendered state.
  const raw = await page.playwright.getByRole('tabpanel').evaluate(el => ({
    selectedTabs: Array.from(el.ownerDocument.querySelectorAll('[role="tab"][aria-selected="true"]')).map(t => t.textContent?.trim() ?? ''),
    queries: Array.from(el.ownerDocument.querySelectorAll<HTMLInputElement>('input[placeholder="请输入作品名称"]')).map(i => i.value),
    headers: Array.from(el.querySelectorAll('th')).map(h => (h.textContent ?? '').trim()),
    rows: Array.from(el.querySelectorAll('tr')).filter(r => r.querySelectorAll('td').length > 0)
      .map(r => Array.from(r.querySelectorAll('td')).map(c => c.innerText)),
  }));
  if (await page.url() !== url) throw Error('FANQIE_CATALOG_PAGE_CHANGED');
  if (raw.selectedTabs.length !== 1 || raw.queries.length !== 1) throw Error('FANQIE_CATALOG_FILTERED');
  let parsed: ReturnType<typeof parseFanqieCatalog>;
  try {parsed = parseFanqieCatalog({selectedTab: raw.selectedTabs[0], query: raw.queries[0], headers: raw.headers, rows: raw.rows});}
  catch (error) {
    // The count badges and table rows finish their separate SPA updates at different times.
    // Retry only this read; never navigate, click, clear a filter or write to the site.
    if (error instanceof Error && error.message === 'FANQIE_CATALOG_COUNT_INVALID' && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve,250)); continue;
    }
    throw error;
  }
  if (parsed.rows.length === 0 && Date.now() < deadline) {await new Promise(resolve => setTimeout(resolve,250)); continue;}
  // A transient zero-count SPA skeleton is indistinguishable from an empty account here.
  // Until an official empty-state completion signal is calibrated, it cannot authorize a new upload.
  return {source: 'browser', url, observedAt: new Date().toISOString(), ...parsed, complete: parsed.complete && parsed.total > 0};
  }
}
