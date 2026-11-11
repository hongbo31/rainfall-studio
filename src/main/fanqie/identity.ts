import {fanqieOrigin} from '../../shared/fanqie';
type IdentityLocator = {
  evaluate<T>(fn: (el: Element) => T): Promise<T>;
  evaluateAll<T>(fn: (els: Element[]) => T): Promise<T>;
};
type IdentityPage = {
  url(): Promise<string | undefined>;
  playwright: {
    getByText(text: string, options: {exact: boolean}): IdentityLocator;
    getByRole(role: string, options: {name: string; exact: boolean}): IdentityLocator;
    locator(selector: string): IdentityLocator;
  };
};
function assertPage(url: string | undefined, pathname: string) {
  const u = url ? new URL(url) : null;
  if (!u || u.origin !== fanqieOrigin || u.pathname !== pathname || u.username || u.password || u.search || u.hash)
    throw Error('FANQIE_IDENTITY_PAGE_REQUIRED');
}
/** Reads only the visible UID row, never contact, authentication or legal-identity fields. */
export async function readFanqieAccountUid(page: IdentityPage) {
  const url = await page.url(); assertPage(url, '/creator/music/account/profile');
  const row = await page.playwright.getByText('UID', {exact: true}).evaluate(el => {
    const parent = el.parentElement;
    return parent?.classList.contains('profile-desc') ? parent.innerText : '';
  });
  const id = /^UID\s+([1-9]\d{4,24})$/.exec(row.trim())?.[1];
  if (!id || await page.url() !== url) throw Error('FANQIE_ACCOUNT_ID_UNVERIFIED');
  return {accountId: id, source: 'browser' as const, url: url!, observedAt: new Date().toISOString()};
}
export function parseFanqieArtists(rows: {name: string; text: string}[]) {
  const ids = new Set<string>();
  return rows.map(row => {
    const match = /^(.+)\n艺人ID[：:]\s*([1-9]\d{4,24})$/.exec(row.text.trim());
    if (!match || match[1].trim() !== row.name.trim() || !row.name.trim() || ids.has(match[2]))
      throw Error('FANQIE_ARTIST_ID_UNVERIFIED');
    ids.add(match[2]);
    return {artistId: match[2], name: row.name.trim()};
  });
}
/** A cooperation roster is not a contractual authorization or an automatic choice of credit. */
export async function readFanqieArtists(page: IdentityPage) {
  const url = await page.url(); assertPage(url, '/creator/music/account/artist');
  const deadline=Date.now()+15000;
  for (;;) {
  const query = await page.playwright.getByRole('textbox', {name: '请输入艺人名', exact: true})
    .evaluate(el => (el as HTMLInputElement).value);
  if (query) throw Error('FANQIE_ARTIST_LIST_FILTERED');
  const rows = await page.playwright.locator('.artist-item').evaluateAll(els => els.map(el => ({
    name: el.querySelector('.artist-name')?.textContent?.trim() ?? '', text: (el as HTMLElement).innerText,
  })));
  if (await page.url() !== url) throw Error('FANQIE_IDENTITY_PAGE_REQUIRED');
  // The search field mounts before the asynchronous roster. An empty DOM is not
  // evidence that the account has no cooperating artists. Retry reads only.
  if(!rows.length){
    if(Date.now()>=deadline)throw Error('FANQIE_ARTIST_LIST_NOT_READY');
    await new Promise(resolve=>setTimeout(resolve,250));continue;
  }
  return {source: 'browser' as const, url: url!, observedAt: new Date().toISOString(), artists: parseFanqieArtists(rows)};
  }
}
