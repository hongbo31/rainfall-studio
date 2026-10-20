import fs from 'node:fs';
import {digest} from '../../core/assets';
import {fanqieOrigin, type FanqieAsset} from '../../shared/fanqie';

/** Only public supported browser operations. No CDP connection, profile access, HTTP or hidden site APIs. */
export interface FanqieReadPage {
  url(): Promise<string | undefined>;
  playwright: {domSnapshot(): Promise<string>};
}
const markers = ['上传歌曲信息','授权签约模式','预览合同协议','音乐类型','完整歌曲','歌词','作品名称','词作者','曲作者','歌手','歌曲封面','是否为AI作品'];
export async function probeFanqieForm(page: FanqieReadPage) {
  const raw = await page.url();
  const u = raw ? new URL(raw) : null;
  if (!u || u.origin !== fanqieOrigin || u.username || u.password) throw Error('FANQIE_PAGE_ORIGIN_CHANGED');
  const snapshot = await page.playwright.domSnapshot();
  const songCount = (snapshot.match(/generic: "歌曲\d+:"/g) ?? []).length;
  const fields = markers.every(text => snapshot.includes(text));
  const authors = (snapshot.match(/textbox "搜索或选择艺人"/g) ?? []).length;
  // Display names do not prove stable account/artist identity or which role region owns a control.
  return { origin: u.origin, firstStepObserved: fields && songCount === 1 && authors === 3,
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
  if (chooser.isMultiple()) throw Error('FANQIE_SINGLE_FILE_CONTROL_REQUIRED');
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
