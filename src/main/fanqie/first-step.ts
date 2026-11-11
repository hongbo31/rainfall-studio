import {fanqieOrigin} from '../../shared/fanqie';
import {probeFanqieForm} from './form';

type Locator = {
  count(): Promise<number>;
  isVisible(): Promise<boolean>;
  click(): Promise<void>;
  fill(value: string): Promise<void>;
  innerText(): Promise<string>;
  waitFor(options: {state: 'visible' | 'hidden'; timeoutMs: number}): Promise<void>;
  evaluate<T>(fn: (el: Element) => T): Promise<T>;
  locator(selector: string): Locator;
  filter(options: {has: Locator}): Locator;
  getByRole(role: string, options?: {name?: string; exact?: boolean}): Locator;
  getByText(text: string, options: {exact: boolean}): Locator;
};
export type FanqieFirstStepPage = {
  url(): Promise<string | undefined>;
  playwright: {
    domSnapshot(): Promise<string>;
    locator(selector: string): Locator;
    getByRole(role: string, options?: {name?: string; exact?: boolean}): Locator;
    getByText(text: string, options: {exact: boolean}): Locator;
  };
};
export type FanqieVisibleForm = {
  title: string; songCount: number; musicType: string; ai: string;
  authors: {lyricist: string[]; composer: string[]; singer: string[]};
  audioText: string; lyricsText: string;
  coverPreview: {complete: boolean; width: number; height: number}[];
};
export type FanqieExpectedForm = {
  title: string; ai: boolean; musicType: 'original' | 'cover';
  authors: {lyricist: string; composer: string; singer: string};
  audio: {displayName: string; format: 'WAV' | 'MP3'; displaySize: string};
  lyrics: {fileName: string; displaySize: string};
};
function assertUrl(raw: string | undefined) {
  const url = raw ? new URL(raw) : null;
  if (!url || url.origin !== fanqieOrigin || url.pathname !== '/creator/music/finished/ugc/uploadProduct' || url.username || url.password)
    throw Error('FANQIE_FORM_UNVERIFIED');
}
/** Reads selected tags, not the search query or hidden search results. No private site state. */
export async function readFanqieVisibleForm(page: FanqieFirstStepPage): Promise<FanqieVisibleForm> {
  const url = await page.url(); assertUrl(url);
  const state = await page.playwright.getByRole('textbox', {name: '作品名称', exact: true}).evaluate(el => {
    const form = el.closest('form');
    if (!form) throw Error('FANQIE_FORM_UNVERIFIED');
    const region = (field: string) => form.querySelector(`label[for="songs_0_${field}_input"]`)?.closest('.arco-form-item');
    const credit = (field: string) => Array.from(region(field)?.querySelectorAll('.arco-tag-content .name') ?? []).map(n => n.textContent?.trim() ?? '');
    const radio = (field: string) => region(field)?.querySelector('input[type="radio"]:checked')?.closest('label')?.textContent?.trim() ?? '';
    return {
      title: (el as HTMLInputElement).value,
      songCount: Array.from(form.querySelectorAll('label[for]')).filter(l => /^songs_\d+_name_input$/.test(l.getAttribute('for') ?? '')).length,
      musicType: radio('type'), ai: radio('ai_usage_type'),
      authors: {lyricist: credit('lyricist_id_list'), composer: credit('composer_id_list'), singer: credit('singer_id_list')},
      audioText: (form.querySelector('#songs_0_songFile') as HTMLElement | null)?.innerText ?? '',
      lyricsText: (form.querySelector('#songs_0_lyricFile') as HTMLElement | null)?.innerText ?? '',
      coverPreview: Array.from(form.querySelectorAll<HTMLImageElement>('#songs_0_coverImage img.arco-image-img'))
        .map(img => ({complete: img.complete, width: img.naturalWidth, height: img.naturalHeight})),
    };
  });
  if (await page.url() !== url || state.songCount !== 1) throw Error('FANQIE_PAGE_SCOPE_CHANGED');
  return state;
}

/** These are visible transfer acknowledgements, not remote file hashes or a saved official work ID. */
export function assertFanqieFirstStepReadback(actual: FanqieVisibleForm, expected: FanqieExpectedForm) {
  if (actual.songCount !== 1 || actual.title !== expected.title || actual.ai !== (expected.ai ? '是' : '否') ||
      actual.musicType !== (expected.musicType === 'original' ? '原创' : '翻唱')) throw Error('FANQIE_METADATA_READBACK_REQUIRED');
  for (const role of ['lyricist', 'composer', 'singer'] as const) {
    if (actual.authors[role].length !== 1 || actual.authors[role][0] !== expected.authors[role]) throw Error('FANQIE_AUTHOR_READBACK_REQUIRED');
  }
  if (actual.audioText.trim() !== `${expected.audio.displayName}\n${expected.audio.format}｜上传完成｜${expected.audio.displaySize}` ||
      actual.lyricsText.trim() !== `${expected.lyrics.fileName}\n上传完成｜${expected.lyrics.displaySize}`) throw Error('FANQIE_UPLOAD_READBACK_REQUIRED');
  // The official cropper turns a valid 2048px source into a 1400px preview. Validate source dimensions before transfer.
  if (actual.coverPreview.length !== 1 || !actual.coverPreview[0].complete || actual.coverPreview[0].width <= 0 ||
      actual.coverPreview[0].width !== actual.coverPreview[0].height) throw Error('FANQIE_COVER_READBACK_REQUIRED');
}

const creditFields = {lyricist: 'lyricist_id_list', composer: 'composer_id_list', singer: 'singer_id_list'} as const;
/** Scope guard and durable intent belong to Main; never pass either from a renderer request. */
export async function selectFanqieCredit(page: FanqieFirstStepPage, role: keyof typeof creditFields, name: string,
  beforeWrite: (step: string) => Promise<void>, assertCurrentScope: () => Promise<void>) {
  if (!name.trim()) throw Error('FANQIE_AUTHORS_REQUIRED');
  await assertCurrentScope();
  if (!(await probeFanqieForm(page)).firstStepObserved) throw Error('FANQIE_FORM_UNVERIFIED');
  const before = await readFanqieVisibleForm(page), selected = before.authors[role];
  if (selected.length === 1 && selected[0] === name) return;
  if (selected.length) throw Error('FANQIE_EXISTING_AUTHOR_REQUIRES_RECONCILIATION');
  const label = page.playwright.locator(`label[for="songs_0_${creditFields[role]}_input"]`);
  const labelText = {lyricist: '词作者', composer: '曲作者', singer: '歌手'}[role];
  if (await label.count() !== 1 || await label.evaluate(el => el.textContent?.trim()) !== labelText) throw Error('FANQIE_AUTHOR_REGION_UNVERIFIED');
  const region = page.playwright.locator('.arco-form-item').filter({has: label});
  if (await region.count() !== 1 || !await region.isVisible()) throw Error('FANQIE_AUTHOR_REGION_UNVERIFIED');
  await beforeWrite(`credit:${role}:search`); await assertCurrentScope();
  await region.getByRole('textbox', {name: '搜索或选择艺人', exact: true}).fill(name);
  const option = page.playwright.getByRole('option', {name, exact: true});
  await option.waitFor({state: 'visible', timeoutMs: 15000});
  if (await option.count() !== 1) throw Error('FANQIE_AUTHOR_AMBIGUOUS');
  await beforeWrite(`credit:${role}:preview`); await assertCurrentScope(); await option.click();
  const dialog = page.playwright.getByRole('dialog', {name: '艺人详情', exact: true});
  await dialog.waitFor({state: 'visible', timeoutMs: 15000});
  if (await dialog.count() !== 1 || await dialog.getByText(name, {exact: true}).count() !== 1) throw Error('FANQIE_AUTHOR_DETAILS_CHANGED');
  await beforeWrite(`credit:${role}:confirm`); await assertCurrentScope();
  await dialog.getByRole('button', {name: '确认选择', exact: true}).click();
  await dialog.waitFor({state: 'hidden', timeoutMs: 15000});
  await assertCurrentScope();
  const after = await readFanqieVisibleForm(page);
  if (after.title !== before.title || after.authors[role].length !== 1 || after.authors[role][0] !== name) throw Error('FANQIE_AUTHOR_READBACK_REQUIRED');
}

/** Stops at the authorization-mode page. No signing identity, license selection or contract acceptance API. */
export async function confirmFanqieFirstStep(page: FanqieFirstStepPage, expected: FanqieExpectedForm,
  beforeWrite: (step: string) => Promise<void>, assertCurrentScope: () => Promise<void>) {
  await assertCurrentScope();
  assertFanqieFirstStepReadback(await readFanqieVisibleForm(page), expected);
  await beforeWrite('first-step:next'); await assertCurrentScope();
  await page.playwright.getByRole('button', {name: '下一步', exact: true}).click();
  const dialog = page.playwright.getByRole('dialog', {name: '是否确认上传成品', exact: true});
  await dialog.waitFor({state: 'visible', timeoutMs: 15000});
  await assertCurrentScope();
  assertFanqieFirstStepReadback(await readFanqieVisibleForm(page), expected);
  await beforeWrite('first-step:confirm-upload'); await assertCurrentScope();
  await dialog.getByRole('button', {name: '确认上传', exact: true}).click();
  await page.playwright.getByRole('heading', {name: '选择签约模式', exact: true}).waitFor({state: 'visible', timeoutMs: 15000});
  await assertCurrentScope(); assertUrl(await page.url());
  if (await page.playwright.getByRole('heading', {name: '授权信息·1', exact: true}).count() !== 1 ||
      await page.playwright.getByText(expected.title, {exact: true}).count() !== 1) throw Error('FANQIE_SAVED_WORK_READBACK_REQUIRED');
  // A separate fresh catalog read must supply the official work ID before a durable contract_pending receipt is stored.
  return {authorizationPageObserved: true as const, officialRecordVerified: false as const};
}
