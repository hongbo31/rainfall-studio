import fs from 'node:fs';
import {digest} from '../../core/assets';
import {fanqieOrigin, type FanqieAsset} from '../../shared/fanqie';
import type {FanqieRole} from '../../shared/fanqie';

/** Only public supported browser operations. No CDP connection, profile access, HTTP or hidden site APIs. */
export interface FanqieReadPage {
  url(): Promise<string | undefined>;
  /** Native snapshots flatten generic containers; count the calibrated visible name fields directly. */
  readSongCount?(): Promise<number>;
  playwright: {domSnapshot(): Promise<string>};
}
const markers = ['上传歌曲信息','授权签约模式','预览合同协议','音乐类型','完整歌曲','歌词','作品名称','词作者','曲作者','歌手','歌曲封面','是否为AI作品'];
export async function probeFanqieForm(page: FanqieReadPage) {
  const raw = await page.url();
  const u = raw ? new URL(raw) : null;
  if (!u || u.origin !== fanqieOrigin || u.username || u.password) throw Error('FANQIE_PAGE_ORIGIN_CHANGED');
  const snapshot = await page.playwright.domSnapshot();
  const songCount = page.readSongCount ? await page.readSongCount() : (snapshot.match(/^\s*- generic: "歌曲\d+:/gm) ?? []).length;
  const fields = markers.every(text => snapshot.includes(text));
  const authors = (snapshot.match(/textbox "搜索或选择艺人"/g) ?? []).length;
  // Selected credits lose their placeholder; role ownership is checked independently before actions.
  // Display names do not prove stable account/artist identity.
  return { origin: u.origin, firstStepObserved: fields && songCount === 1,
    songCount, authorControlCount: authors, identityVerified: false,
    roleRegionsVerified: false, albumVerified: false, fileInputsVerified: false,
    uploadAvailable: false, submissionAvailable: false };
}
type Control = {count(): Promise<number>; isVisible(): Promise<boolean>; click(): Promise<void>};
type Chooser = {isMultiple(): boolean; setFiles(files: string[]): Promise<void>};
type FilePage = {playwright: {waitForEvent(event: 'filechooser', options: {timeoutMs: number}): Promise<Chooser>}};
/** An exact role control must come from a fresh, verified song/role region. Never infer a hidden file input. */
export async function chooseFanqieFile(page: FilePage, control: Control, asset: FanqieAsset, assertCurrentScope: () => Promise<void>) {
  const verify = () => {
    if (!fs.statSync(asset.file).isFile() || fs.statSync(asset.file).size !== asset.bytes || digest(asset.file) !== asset.sha256) throw Error('FANQIE_ASSET_CHANGED');
  };
  await assertCurrentScope(); verify();
  if (await control.count() !== 1 || !await control.isVisible()) throw Error('FANQIE_UPLOAD_CONTROL_UNVERIFIED');
  const pending = page.playwright.waitForEvent('filechooser', {timeoutMs: 15000});
  // Observe a rejection even if click fails. A failed click must not be retried here.
  void pending.catch(() => {});
  await control.click();
  const chooser = await pending;
  await assertCurrentScope(); verify();
  // The official audio picker permits multiple files. Always send exactly the one authorized asset.
  await chooser.setFiles([asset.file]);
}

/** Role-region ownership must be established by a calibrated runtime before selecting an artist. */
export async function fanqieAuthorControl(song: {count(): Promise<number>}, region: {
  count(): Promise<number>; getByRole(role: string, options: {name: string; exact: boolean}): Control;
}, verifyOwnership: () => Promise<boolean>) {
  if (await song.count() !== 1 || await region.count() !== 1 || !await verifyOwnership()) throw Error('FANQIE_AUTHOR_REGION_UNVERIFIED');
  const field = region.getByRole('textbox', {name: '搜索或选择艺人', exact: true});
  if (await field.count() !== 1 || !await field.isVisible()) throw Error('FANQIE_AUTHOR_REGION_UNVERIFIED');
  return field;
}

type FormLocator = Control & {
  locator(selector: string): FormLocator;
  filter(options: {has: FormLocator}): FormLocator;
  evaluate<T>(fn: (el: Element) => T): Promise<T>;
  getByRole(role: string, options: {name: string; exact: boolean}): FormLocator;
};
type CalibratedFormPage = FanqieReadPage & {playwright: {locator(selector: string): FormLocator}};
const roles = {
  audio: {field: 'songFile', label: '完整歌曲', selector: '#songs_0_songFile .upload-input-container-Xm4c1M'},
  lyrics: {field: 'lyricFile', label: '歌词', selector: '#songs_0_lyricFile .upload-input-container-Xm4c1M'},
  cover: {field: 'coverImage', label: '歌曲封面', selector: '#songs_0_coverImage .image-upload-input-btn'},
  lyricist: {field: 'lyricist_id_list', label: '词作者'},
  composer: {field: 'composer_id_list', label: '曲作者'},
  singer: {field: 'singer_id_list', label: '歌手'},
} as const;
async function calibratedRegion(page: CalibratedFormPage, role: keyof typeof roles) {
  const url = await page.url();
  if (!url || new URL(url).pathname !== '/creator/music/finished/ugc/uploadProduct' ||
      !(await probeFanqieForm(page)).firstStepObserved) throw Error('FANQIE_FORM_UNVERIFIED');
  const expected = roles[role];
  const label = page.playwright.locator(`label[for="songs_0_${expected.field}_input"]`);
  if (await label.count() !== 1 || (await label.evaluate(el => el.textContent?.trim())) !== expected.label)
    throw Error('FANQIE_ROLE_REGION_CHANGED');
  const region = page.playwright.locator('.arco-form-item').filter({has: label});
  if (await region.count() !== 1 || !await region.isVisible() || await page.url() !== url)
    throw Error('FANQIE_ROLE_REGION_CHANGED');
  return region;
}
/** Calibrated on the empty 2026-11-11 form; resolving a control does not upload. */
export async function fanqieFileControl(page: CalibratedFormPage, role: FanqieRole) {
  const region = await calibratedRegion(page, role), control = region.locator(roles[role].selector);
  if (await control.count() !== 1 || !await control.isVisible()) throw Error('FANQIE_UPLOAD_CONTROL_UNVERIFIED');
  return control;
}
export async function fanqieCreditControl(page: CalibratedFormPage, role: 'lyricist' | 'composer' | 'singer') {
  const region = await calibratedRegion(page, role);
  const control = region.getByRole('textbox', {name: '搜索或选择艺人', exact: true});
  if (await control.count() !== 1 || !await control.isVisible()) throw Error('FANQIE_AUTHOR_REGION_UNVERIFIED');
  return control;
}
