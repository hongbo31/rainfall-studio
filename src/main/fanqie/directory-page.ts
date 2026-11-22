import {randomUUID} from 'node:crypto';
import type {BrowserContext, Frame, Page} from 'playwright-core';
import {fanqieOrigin} from '../../shared/fanqie';
import {fanqieCatalogPath} from '../../shared/fanqie-catalog';

export const fanqieHomeUrl = fanqieOrigin + '/creator/music/home';
export const fanqiePublishWorksUrl = fanqieOrigin + '/creator/music/publishWorks';
export const fanqieUploadFormUrl = fanqieOrigin + '/creator/music/finished/ugc/uploadProduct';
export const fanqieProfileUrl = fanqieOrigin + '/creator/music/account/profile';
export const fanqieArtistUrl = fanqieOrigin + '/creator/music/account/artist';
const startUrls = new Set([
  fanqieHomeUrl, fanqiePublishWorksUrl, fanqieProfileUrl,
  fanqieArtistUrl, fanqieOrigin + fanqieCatalogPath, 'about:blank',
]);

function creatorDocument(raw: string) {
  const url = new URL(raw);
  return url.origin === fanqieOrigin && url.pathname.startsWith('/creator/music/') && !url.username && !url.password;
}

export function fanqieAccountTab(context: BrowserContext) {
  const page = context.pages().find(tab => !tab.isClosed() && creatorDocument(tab.url()));
  if (!page) throw Error('FANQIE_IDENTITY_PAGE_REQUIRED');
  return page;
}

/** Reuse a safe starting page and leave any unfinished editor untouched. */
export async function fanqieDirectoryStartTab(context: BrowserContext) {
  const pages = context.pages().filter(tab => !tab.isClosed());
  const page = pages.find(tab => tab.url() === fanqieHomeUrl) ?? pages.find(tab => startUrls.has(tab.url()));
  if (page) return page;
  if (!pages.length) return context.newPage();
  throw Error('FANQIE_DIRECTORY_TAB_NOT_READY');
}

/** Read same-origin account information without another tab or navigating the editor. */
export async function withFanqieReadFrame<T>(page: Page, guard: () => void, read: (frame: Frame) => Promise<T>) {
  guard();
  const owner = page.url();
  if (page.isClosed() || !creatorDocument(owner)) throw Error('FANQIE_IDENTITY_PAGE_REQUIRED');
  const id = 'rainfall-fanqie-read-' + randomUUID();
  const locator = page.locator('iframe#' + id);
  try {
    const created = await page.locator('body').evaluate((body, {id, owner}) => {
      if (location.href !== owner) return false;
      const iframe = document.createElement('iframe');
      iframe.id = id;
      iframe.title = '番茄账号核对';
      iframe.tabIndex = -1;
      iframe.setAttribute('aria-hidden', 'true');
      iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts');
      iframe.style.cssText = 'position:fixed;top:0;left:-2000px;width:1200px;height:800px;opacity:0;pointer-events:none;border:0';
      body.append(iframe);
      return true;
    }, {id, owner}, {timeout: 5000});
    if (!created || page.url() !== owner) throw Error('FANQIE_PAGE_SCOPE_CHANGED');
    const handle = await locator.elementHandle({timeout: 5000});
    const frame = await handle.contentFrame().finally(() => handle.dispose());
    if (!frame) throw Error('FANQIE_ACCOUNT_FRAME_UNAVAILABLE');
    const result = await read(frame);
    guard();
    if (page.url() !== owner || frame.isDetached()) throw Error('FANQIE_PAGE_SCOPE_CHANGED');
    return result;
  } finally {
    if (!page.isClosed()) await locator.evaluateAll(nodes => nodes.forEach(node => node.remove())).catch(() => {});
  }
}
