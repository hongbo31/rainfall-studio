import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import type {BrowserContext, Locator, Page} from 'playwright-core';
import {fanqieOrigin, type FanqieAsset, type FanqieInput} from '../../shared/fanqie';
import {fanqieDownloadBatchLimit, fanqieOriginalSingerSchema, fanqieOriginalWorkIdSchema} from '../../shared/fanqie-downloads';
import {
  fanqieDirectoryStartTab, fanqieHomeUrl as homeUrl, fanqieProfileUrl as profileUrl,
  fanqiePublishWorksUrl as publishUrl, fanqieUploadFormUrl as formUrl, withFanqieReadFrame,
} from './directory-page';
import {assertFanqieFirstStepReadback, fanqieTransferVerified, type FanqieExpectedForm} from './first-step';
import {chooseDirectoryFile, directoryFileReceipt, type DirectoryFileRole} from './directory-files';
import {addSongCaption, bindDirectoryCards, songNameLabel} from './directory-cards';
import type {FanqieDirectoryTraceDetails, FanqieDirectoryTracePort} from './directory-trace';
import {directoryPageError, directoryValidationMessages, readDirectoryFieldErrors, type DirectoryRepairField} from './directory-validation';
import {readFanqieAccountUid} from './identity';
import {expectedFanqieForm} from './native-upload';

export type FanqieDirectorySong = FanqieInput & {
  songAttribute: 'original' | 'multi_version'; copyrightProof?: FanqieAsset; originalSinger?: string; originalWorkId?: string;
  singerArtistId?: string;
};
export type FanqieDirectoryFormCallbacks = Pick<FanqieDirectoryTracePort, 'trace' | 'watch'> & {
  guard: () => void;
  checkStopped?: () => Promise<void>;
  intent: (step: string, songIndex?: number) => Promise<void>;
  archiveObserved: (songIndexes: readonly number[]) => Promise<void>;
  verifyUnsubmitted: (songIndex: number) => Promise<void>;
  rejectUnsubmittedSong: (songIndex: number) => Promise<void>;
};

const finishedRelease = 'xpath=//span[text()="成品发行"]/../..//span[text()="发布作品"]';
const authors = {
  lyricist: ['lyricist_id_list', '词作者'], composer: ['composer_id_list', '曲作者'], singer: ['singer_id_list', '歌手'],
} as const;
const authorRoles = ['lyricist', 'composer', 'singer'] as const;
const fileFields = {
  audio: ['songFile', '完整歌曲'], lyrics: ['lyricFile', '歌词'],
  cover: ['coverImage', '歌曲封面'], proof: ['authorizationFiles', '版权证明'],
} as const;
const repairFieldControls: Record<DirectoryRepairField, string> = {
  audio: fileFields.audio[0], lyrics: fileFields.lyrics[0], title: 'name', cover: fileFields.cover[0],
  lyricist: authors.lyricist[0], composer: authors.composer[0], singer: authors.singer[0],
};
const musicTypes = {original: '原创', cover: '翻唱'} as const;
const songAttributes = {original: '原版歌曲', multi_version: '多版本歌曲'} as const;
const originalSingerError = 'FANQIE_ORIGINAL_SINGER_UNVERIFIED';
const originalWorkError = 'FANQIE_ORIGINAL_WORK_UNVERIFIED';
const singerIdError = 'FANQIE_SINGER_ID_UNVERIFIED';
const artistSongsPath = '/api/author/home/get_song_list/v0/';
const fieldValidationError = 'FANQIE_DIRECTORY_FIELD_VALIDATION';
const lyricsContentRejectedError = 'FANQIE_LYRICS_CONTENT_REJECTED';
const lyricsContentSongUnmappedError = 'FANQIE_LYRICS_CONTENT_REJECTED_UNMAPPED';
const deleteDraftError = 'FANQIE_DIRECTORY_DELETE_UNVERIFIED';
const submissionRejectionUnmappedError = 'FANQIE_SUBMISSION_REJECTION_UNMAPPED';
const submissionRejectionRetriesExhaustedError = 'FANQIE_SUBMISSION_REJECTION_RETRIES_EXHAUSTED';
const allSongsRejectedError = 'FANQIE_ALL_SONGS_REJECTED';
const submissionRejectionRetries = 7;
const submissionRejectionWaitMs = 4_000;
const audioTransferTimeoutMs = 10 * 60_000;
const coverCropWaitTimeoutMs = 60_000;
const planStopCheckIntervalMs = 2_000;
const artistSearchTimeoutMs = 8_000;
const artistSearchResultTimeoutMs = 15_000;
const artistSearchRetries = 3;
const aiChoices = ['是', '否'];
const visible = (locator: Locator) => locator.filter({visible: true});

async function one(locator: Locator, code: string, timeout = 15_000) {
  const target = visible(locator);
  await target.first().waitFor({state: 'visible', timeout}).catch(error => {throw Error(code, {cause: error});});
  if (await target.count() !== 1) throw Error(code);
  return target;
}

function fieldLabel(page: Page, index: number, field: string) {
  return page.locator(`label[for="songs_${index}_${field}_input"]`);
}

async function fieldRegion(page: Page, card: Locator, index: number, field: string, name: string,
  code = field === fileFields.proof[0] ? 'FANQIE_COPYRIGHT_PROOF_CONTROL_UNVERIFIED' : 'FANQIE_ROLE_REGION_CHANGED') {
  const label = fieldLabel(page, index, field);
  const region = visible(card.locator('.arco-form-item').filter({has: label}));
  if (await region.count() !== 1 || await visible(region.locator(label)).count() !== 1 ||
      (await region.locator(label).innerText()).trim() !== name)
    throw Error(code);
  return region;
}

async function titleField(page: Page, card: Locator, index: number) {
  const region = await fieldRegion(page, card, index, 'name', '作品名称');
  return one(region.locator(`input[id="songs_${index}_name_input"]`), 'FANQIE_TITLE_CONTROL_UNVERIFIED');
}

async function choice(page: Page, region: Locator, name: string, role: 'radio' | 'checkbox' = 'radio') {
  const native = page.locator(`input[type="${role}"]`);
  const label = visible(region.locator('label').filter({hasText: new RegExp(`^\\s*${name}\\s*$`, 'u'), has: native}));
  if (await label.count()) {
    if (await label.count() !== 1 || await label.locator(native).count() !== 1) throw Error('FANQIE_CHOICE_CONTROL_UNVERIFIED');
    return {control: label, state: label.locator(native)};
  }
  const control = visible(region.getByRole(role, {name, exact: true}));
  const count = await control.count();
  if (count > 1) throw Error('FANQIE_CHOICE_CONTROL_UNVERIFIED');
  if (count === 1) return {control, state: control};
}

async function chosenRadio(page: Page, region: Locator, names: readonly string[]) {
  const selected: string[] = [];
  for (const name of names) {
    if (await (await choice(page, region, name))?.state.isChecked()) selected.push(name);
  }
  if (selected.length !== 1) throw Error('FANQIE_METADATA_READBACK_REQUIRED');
  return selected[0];
}

async function songAttributeRegion(page: Page, card: Locator, index: number, attribute: FanqieDirectorySong['songAttribute']) {
  if (!await card.locator(fieldLabel(page, index, 'is_multi_version')).count() &&
      !await visible(card.getByText('歌曲属性', {exact: true})).count()) {
    if (attribute === 'original') return;
    throw Error(originalWorkError);
  }
  return fieldRegion(page, card, index, 'is_multi_version', '歌曲属性', 'FANQIE_CHOICE_CONTROL_UNVERIFIED');
}

async function instrumentalChoice(page: Page, card: Locator) {
  const checkbox = await choice(page, card, '纯音乐', 'checkbox');
  const radio = await choice(page, card, '纯音乐');
  if (checkbox && radio) throw Error('FANQIE_INSTRUMENTAL_FORM_UNVERIFIED');
  return checkbox ? {...checkbox, toggle: true} : radio;
}

function artistOptions(page: Page, name: string) {
  const text = page.getByText(name, {exact: true});
  const named = page.getByRole('option', {name, exact: true});
  const select = page.locator('.arco-select-popup-inner label:not([role="option"] *)').filter({has: text});
  const autocomplete = page.locator('.artist-autocomplete-item-left:not([role="option"] *, .arco-select-popup-inner label *)').filter({has: text});
  return visible(named.or(select).or(autocomplete));
}

function artistNames(region: Locator) {
  return visible(region.locator('.arco-tag-content .name')).allInnerTexts().then(names => names.map(name => name.trim()));
}

type CreditFiber = {
  return?: CreditFiber;
  key?: string | null;
  memoizedProps?: {artist?: {id?: unknown}};
};

// Fanqie's result label carries artist.id. Arco keys the mounted selected tag by the field value.
// Read those bindings because both elements display only the name.
function renderedSingerIds(elements: Element[], source: 'option' | 'tag') {
  return elements.map(element => {
    const node = source === 'option' ? element : element.closest('.arco-tag');
    if (!node) return null;
    const property = Object.getOwnPropertyNames(node).find(key => key.startsWith('__reactFiber$'));
    let fiber = property ? Reflect.get(node, property) as CreditFiber : undefined;
    for (let depth = 0; fiber && depth < 6; depth++, fiber = fiber.return) {
      if (source === 'tag') {
        const value = /^([1-9]\d{4,24})-tag$/u.exec(fiber.key ?? '')?.[1];
        if (value) return value;
      } else {
        const value = fiber.memoizedProps?.artist?.id;
        const id = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
        if (typeof id === 'string' && /^[1-9]\d{4,24}$/u.test(id)) return id;
      }
    }
    return null;
  });
}

async function verifySingerId(region: Locator, expectedId: string) {
  const ids = await visible(region.locator('.arco-tag-content .name')).evaluateAll(renderedSingerIds, 'tag' as const);
  if (ids.length !== 1 || ids[0] !== expectedId) throw Error(singerIdError);
}

function dialog(page: Page, title: string) {
  return visible(page.getByRole('dialog', {name: title, exact: true}).or(
    page.locator('.arco-modal:not([role="dialog"], [role="dialog"] *)').filter({
      has: page.locator('.arco-modal-title').and(page.getByText(title, {exact: true})),
    }),
  ));
}

async function fileArea(page: Page, card: Locator, index: number, role: DirectoryFileRole) {
  const [field, name] = fileFields[role];
  const region = await fieldRegion(page, card, index, field, name);
  const id = `songs_${index}_${field}`;
  return one(region.locator(`#${id}:not(#${id}_input *), #${id}_input:not(#${id} *)`),
    role === 'proof' ? 'FANQIE_COPYRIGHT_PROOF_CONTROL_UNVERIFIED' : 'FANQIE_UPLOAD_CONTROL_UNVERIFIED');
}

function proofVerified(text: string, asset: FanqieAsset) {
  const [name, detail, extra] = text.split('\n');
  if (name !== path.basename(asset.file) || !detail || extra !== undefined) return false;
  const parts = detail.split(/[|｜]/u).map(part => part.trim());
  if (parts[0] === path.extname(asset.file).slice(1).toUpperCase()) parts.shift();
  if (parts.length !== 2 || parts[0] !== '上传完成') return false;
  const size = /^(\d{1,9})(?:\.(\d{1,3}))?\s*(B|KB|MB)$/iu.exec(parts[1]);
  if (!size) return false;
  const [, whole, fraction = '', unit] = size;
  const power = ['B', 'KB', 'MB'].indexOf(unit.toUpperCase());
  return [1000, 1024].some(base => Number(`${whole}.${fraction}`) === Number((asset.bytes / base ** power).toFixed(fraction.length)));
}

function coverPreview(area: Locator) {
  return visible(area.locator('img.arco-image-img, .upload-img-item img')).evaluateAll(elements => elements.map(element => {
    const image = element as HTMLImageElement;
    const uploaderBusy = !!image.closest('.upload-img-item')?.querySelector('.upload-img-item-mask');
    return {complete: image.complete && !uploaderBusy, width: image.naturalWidth, height: image.naturalHeight, source: image.currentSrc};
  }));
}

function coverUploadFailure(area: Locator) {
  return visible(area.locator('.upload-img-item-mask').getByText('上传失败', {exact:true}));
}

async function waitForCropOrFailure(crop: Locator, failed: Locator) {
  try {
    await crop.or(failed).first().waitFor({state: 'visible', timeout: coverCropWaitTimeoutMs});
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') throw Error('FANQIE_COVER_CROP_TIMEOUT', {cause: error});
    throw error;
  }
}

async function closeTimedOutCrop(crop: Locator, write: () => Promise<void>) {
  const close = visible(crop.locator('.arco-modal-close-icon, .arco-modal-close'));
  if (await close.count() !== 1) throw Error('FANQIE_COVER_CROP_CLOSE_UNVERIFIED');
  await write();
  await close.click({timeout: coverCropWaitTimeoutMs});
  await crop.waitFor({state: 'hidden', timeout: coverCropWaitTimeoutMs});
}

async function waitForCover(area: Locator, assertScope: () => void, verifiedSource?: string) {
  const deadline = performance.now() + 20_000;
  let broughtIntoView = false;
  while (performance.now() < deadline) {
    assertScope();
    if (await visible(area.locator('.upload-img-item-mask').getByText('上传失败', {exact: true})).count())
      throw Error('FANQIE_COVER_UPLOAD_FAILED');
    const [preview, ...other] = await coverPreview(area);
    if (other.length || (preview?.complete && preview.source && verifiedSource && preview.source !== verifiedSource))
      throw Error('FANQIE_COVER_READBACK_REQUIRED');
    if (preview?.complete && preview.width > 0 && preview.width === preview.height && preview.source) return preview;
    // A remounted song can be outside the viewport, where Fanqie defers loading the cover.
    if (!broughtIntoView) {
      await area.scrollIntoViewIfNeeded({timeout: Math.max(1, deadline - performance.now())}).catch(error => {
        throw Error('FANQIE_COVER_READBACK_REQUIRED', {cause: error});
      });
      broughtIntoView = true;
      continue;
    }
    await delay(250);
  }
  throw Error('FANQIE_COVER_READBACK_REQUIRED');
}

type Trace = <T>(step: string, action: () => Promise<T>, songIndex?: number, details?: FanqieDirectoryTraceDetails) => Promise<T>;
type Write = (step: string, songIndex?: number, url?: string) => Promise<void>;
type ExpectedDirectorySong = FanqieExpectedForm & {originalSinger?: string; originalWorkId?: string};
type DirectorySongEntry = {
  song: FanqieDirectorySong;
  spec: ExpectedDirectorySong;
  jobIndex: number;
  repairs: number;
  coverSource?: string;
  coverUploadRetries: number;
};
type DirectoryRepair = {entry: DirectorySongEntry; fields: ReadonlySet<DirectoryRepairField>};

function expectedDirectorySong(song: FanqieDirectorySong): ExpectedDirectorySong {
  if (song.singerArtistId !== undefined &&
    (typeof song.singerArtistId !== 'string' || !/^[1-9]\d{4,24}$/u.test(song.singerArtistId))) throw Error(singerIdError);
  const originalSinger = song.musicType === 'cover' ? fanqieOriginalSingerSchema.safeParse(song.originalSinger) : undefined;
  const originalWorkId = song.songAttribute === 'multi_version' ? fanqieOriginalWorkIdSchema.safeParse(song.originalWorkId) : undefined;
  if (originalSinger?.success === false) throw Error('FANQIE_DOWNLOAD_ORIGINAL_SINGER_REQUIRED');
  if (originalWorkId?.success === false) throw Error('FANQIE_DOWNLOAD_ORIGINAL_WORK_REQUIRED');
  return {...expectedFanqieForm(song), originalSinger: originalSinger?.data, originalWorkId: originalWorkId?.data};
}

function originalSingerTags(region: Locator) {
  return visible(region.locator('.arco-input-tag-tag .arco-tag-content'));
}

async function verifyOriginalSinger(region: Locator, singer: string) {
  const tag = await one(originalSingerTags(region), originalSingerError);
  if ((await tag.innerText()).trim().replaceAll('\u00a0', ' ') !== singer.replaceAll('\u00a0', ' ')) throw Error(originalSingerError);
}

async function selectOriginalSinger(page: Page, card: Locator, index: number, singer: string, write: Write) {
  await one(card.locator(fieldLabel(page, index, 'originalSingers')), originalSingerError);
  const region = await fieldRegion(page, card, index, 'originalSingers', '原唱', originalSingerError);
  const input = await one(region.locator('.arco-input-tag').getByPlaceholder(/^输入原唱后按回车键确认，最多\d+位$/u), originalSingerError);
  if (await originalSingerTags(region).count() || await input.inputValue()) throw Error(originalSingerError);
  await write('select-original-singer', index);
  await input.fill(singer);
  if (await input.inputValue() !== singer) throw Error(originalSingerError);
  await input.press('Enter');
  await verifyOriginalSinger(region, singer);
}

function workIdText(region: Page | Locator, id?: string) {
  return region.getByText(new RegExp(`^作品ID\\s*[:：]\\s*${id ?? '\\d+'}$`, 'u'));
}

async function verifyOriginalWork(region: Locator, id: string) {
  const selected = await one(region.locator('.multi-ver-song-selector-select .multi-ver-song-option-card'), originalWorkError);
  if (await visible(workIdText(selected)).count() !== 1 || await visible(workIdText(selected, id)).count() !== 1 ||
      await visible(region.locator('.multi-ver-trace-tip')).count()) throw Error(originalWorkError);
}

async function selectOriginalWork(page: Page, card: Locator, index: number, id: string, write: Write, trace: Trace) {
  await one(card.locator(fieldLabel(page, index, 'master_product_id')), originalWorkError);
  const region = await fieldRegion(page, card, index, 'master_product_id', '关联原作品', originalWorkError);
  const combo = await one(region.locator('.multi-ver-song-search-selector').getByRole('combobox'), originalWorkError);
  const input = await one(combo.getByPlaceholder('请输入作品名称或作品ID搜索', {exact: true}), originalWorkError);
  const popupId = await combo.getAttribute('aria-controls');
  if (!popupId || !/^[A-Za-z][\w:.-]*$/u.test(popupId) || await input.inputValue() ||
      await visible(combo.locator('.multi-ver-song-option-card')).count()) throw Error(originalWorkError);
  const popup = visible(page.locator(`.arco-select-popup-inner.multi-ver-dropdown[id="${popupId}"]`));
  if (await popup.count()) throw Error(originalWorkError);
  const exactId = workIdText(page, id);
  const option = await trace('select-original-work:search', async () => {
    await write('select-original-work:search', index);
    await input.click();
    await input.fill(id);
    return one(popup.getByRole('option').filter({has: exactId}), originalWorkError);
  });
  await trace('select-original-work:option', async () => {
    await write('select-original-work:option', index);
    if (await combo.getAttribute('aria-controls') !== popupId || await popup.count() !== 1 ||
        await visible(option.locator(exactId)).count() !== 1 || await visible(workIdText(option)).count() !== 1) throw Error(originalWorkError);
    await option.click();
    await popup.first().waitFor({state: 'hidden'});
    await verifyOriginalWork(region, id);
  });
}

async function selectCredit(page: Page, card: Locator, index: number, role: keyof typeof authors, artist: string, write: Write, trace: Trace,
  assertScope: () => void, artistId?: string) {
  const [field, name] = authors[role];
  const region = await fieldRegion(page, card, index, field, name);
  const search = await one(region.getByRole('textbox', {name: '搜索或选择艺人', exact: true}).or(region.locator('[role="combobox"] input')),
    'FANQIE_AUTHOR_REGION_UNVERIFIED', artistSearchTimeoutMs);
  const options = artistId ? visible(region.locator('.artist-autocomplete-item-left').filter({
    has: page.getByText(artist, {exact: true}),
  })) : artistOptions(page, artist);
  if (!artist.trim() || (await artistNames(region)).length) throw Error('FANQIE_AUTHOR_REGION_UNVERIFIED');
  const retryMessage = async () => {
    // The creator form renders this retry link inside its own autocomplete panel,
    // not the generic Arco select-popup-inner container.
    const dropdown = visible(region.locator('.artist-autocomplete-dropdown'));
    const message = visible(dropdown.getByText('加载艺人失败，点击此处或下拉列表重试', {exact: true}));
    if (await message.count() > 1) throw Error('FANQIE_AUTHOR_RETRY_CONTROL_AMBIGUOUS');
    return await message.count() === 1 ? message : undefined;
  };
  const option = await trace(`credit:${role}:search`, async () => {
    await search.scrollIntoViewIfNeeded({timeout: artistSearchTimeoutMs});
    await write(`credit:${role}:search`, index);
    await search.click({timeout: artistSearchTimeoutMs});
    let lastFailure: unknown;
    let sawNamedCandidate = false;
    let loadRetries = 0;
    let searchRetries = 0;
    let keepSearchAfterLoadRetry = false;
    for (;;) {
      assertScope();
      if (!keepSearchAfterLoadRetry) await search.fill(artist, {timeout: artistSearchTimeoutMs});
      keepSearchAfterLoadRetry = false;
      const deadline = performance.now() + artistSearchResultTimeoutMs;
      let clickedRetry = false;
      while (performance.now() < deadline) {
        assertScope();
        if (await search.inputValue() !== artist) throw Error(artistId ? singerIdError : 'FANQIE_AUTHOR_SEARCH_UNVERIFIED');
        const failed = await retryMessage();
        if (failed) {
          if (loadRetries >= artistSearchRetries) throw Error('FANQIE_AUTHOR_LOAD_RETRIES_EXHAUSTED');
          loadRetries++;
          await write(`credit:${role}:retry-load`, index);
          try {
            await failed.click({timeout: artistSearchTimeoutMs});
            lastFailure = Error('番茄下拉框提示加载艺人失败，已点击重试');
          } catch (error) { throw Error('FANQIE_AUTHOR_RETRY_CONTROL_UNVERIFIED', {cause: error}); }
          clickedRetry = true;
          break;
        }
        if (artistId) {
          sawNamedCandidate ||= await options.count() > 0;
          const ids = await options.evaluateAll(renderedSingerIds, 'option' as const);
          const match = ids.indexOf(artistId);
          if (match >= 0) return options.nth(match);
        } else {
          const count = await options.count();
          if (count > 1) throw Error('FANQIE_AUTHOR_AMBIGUOUS');
          if (count === 1) return options;
        }
        await delay(120);
      }
      if (clickedRetry) {
        keepSearchAfterLoadRetry = true;
        continue;
      }
      if (performance.now() >= deadline) lastFailure = Error(`输入艺人后 ${artistSearchResultTimeoutMs / 1000} 秒未加载到匹配下拉项`);
      if (searchRetries < artistSearchRetries) {
        searchRetries++;
        await write(`credit:${role}:retry-search`, index);
        await delay(250);
        continue;
      }
      break;
    }
    if (artistId && sawNamedCandidate) throw Error(singerIdError, {cause: lastFailure});
    throw Error(artistId ? 'FANQIE_AUTHOR_SEARCH_TIMEOUT' : 'FANQIE_AUTHOR_NOT_FOUND', {cause: lastFailure});
  });
  const {detail, artistLabel, confirm} = await trace(`credit:${role}:preview`, async () => {
    await write(`credit:${role}:preview`, index);
    if (artistId) {
      if ((await option.evaluateAll(renderedSingerIds, 'option' as const))[0] !== artistId) throw Error(singerIdError);
      // The official details dialog queries this artist's songs on open, before a selection is committed.
      const [detailsRequest] = await Promise.all([
        page.waitForRequest(request => {
          const url = new URL(request.url());
          if (url.origin !== fanqieOrigin || url.pathname !== artistSongsPath ||
              request.method() !== 'GET' || (url.searchParams.get('page_no') ?? '0') !== '0' || request.serviceWorker()) return false;
          try { return request.frame() === page.mainFrame(); } catch { return false; }
        }, {timeout: 12_000}).catch(error => {throw Error(singerIdError, {cause: error});}),
        option.click(),
      ]);
      const ids = new URL(detailsRequest.url()).searchParams.getAll('artist_id');
      if (ids.length !== 1 || ids[0] !== artistId) throw Error(singerIdError);
    } else {
      await option.click();
    }
    const detail = await one(dialog(page, '艺人详情'), 'FANQIE_AUTHOR_DETAILS_CHANGED');
    const artistLabel = visible(detail.getByText(artist, {exact: true}));
    if (await artistLabel.count() !== 1) throw Error('FANQIE_AUTHOR_DETAILS_CHANGED');
    const confirm = await one(detail.getByRole('button', {name: '确认选择', exact: true}), 'FANQIE_AUTHOR_DETAILS_CHANGED');
    return {detail, artistLabel, confirm};
  });
  await trace(`credit:${role}:confirm`, async () => {
    await write(`credit:${role}:confirm`, index);
    if (await artistLabel.count() !== 1) throw Error('FANQIE_AUTHOR_DETAILS_CHANGED');
    await confirm.click();
    await detail.waitFor({state: 'hidden'});
    const selected = await artistNames(region);
    if (selected.length !== 1 || selected[0] !== artist) throw Error('FANQIE_AUTHOR_READBACK_REQUIRED');
    if (artistId) await verifySingerId(region, artistId);
  });
}

async function waitForTransfer(area: Locator, verify: (text: string) => boolean, assertScope: () => void,
  timeoutMs = 120_000, checkStopped?: FanqieDirectoryFormCallbacks['checkStopped'], retryFailure?: () => Promise<void>) {
  const deadline = performance.now() + timeoutMs;
  let nextStopCheck = 0;
  for (let now = performance.now(); now < deadline; now = performance.now()) {
    assertScope();
    if (checkStopped && now >= nextStopCheck) {
      await checkStopped();
      assertScope();
      nextStopCheck = performance.now() + planStopCheckIntervalMs;
    }
    const text = await directoryFileReceipt(area);
    if (verify(text)) return;
    if (/上传失败|上传出错/u.test(text)) {
      if (retryFailure) await retryFailure();
      else throw Error('FANQIE_UPLOAD_READBACK_REQUIRED');
    } else if (/上传完成/u.test(text)) throw Error('FANQIE_UPLOAD_READBACK_REQUIRED');
    await delay(250);
  }
  throw Error('FANQIE_UPLOAD_READBACK_TIMEOUT');
}

function failedTransferRetryControl(area: Locator) {
  const failedRows = visible(area.locator('[class*="upload-list-item-"]').filter({hasText: /上传失败|上传出错/u}));
  return {failedRows, controls: visible(failedRows.locator('.serial-fm-icon-general_reload'))};
}

async function waitForTransferRetryStart(area: Locator, assertScope: () => void, checkStopped?: FanqieDirectoryFormCallbacks['checkStopped']) {
  const deadline = performance.now() + 30_000;
  while (performance.now() < deadline) {
    assertScope();
    await checkStopped?.();
    assertScope();
    if (!/上传失败|上传出错/u.test(await directoryFileReceipt(area))) return;
    await delay(250);
  }
}

async function checkAuthorizationGroup(page: Page, titles: readonly string[], assertScope: () => void) {
  await delay(3_000);
  assertScope();
  const heading = visible(page.getByRole('heading', {name: '选择签约模式', exact: true}));
  const errors = visible(page.locator(directoryPageError)).or(directoryValidationMessages(page.locator('.upload-form form')));
  await heading.or(errors).first().waitFor({state: 'visible', timeout: 15_000}).catch(error => {
    throw Error('FANQIE_AUTHORIZATION_STEP_UNVERIFIED', {cause: error});
  });
  assertScope();
  if (!await heading.count() && await errors.count()) throw Error('FANQIE_UPLOAD_PAGE_ERROR');
  if (await heading.count() !== 1) throw Error('FANQIE_AUTHORIZATION_STEP_UNVERIFIED');
  const archiveMarker = visible(page.locator('xpath=//div/h3[text()="选择签约模式"]/../div/div[2]'));
  await archiveMarker.waitFor({state: 'visible', timeout: 15_000}).catch(error => {
    throw Error('FANQIE_ARCHIVE_MARKER_UNVERIFIED', {cause: error});
  });
  if (await archiveMarker.count() !== 1) throw Error('FANQIE_ARCHIVE_MARKER_UNVERIFIED');
  const expectedCount = new RegExp(`^授权信息\\s*[·・]\\s*${titles.length}$`, 'u');
  await one(page.getByRole('heading', {name: expectedCount}), 'FANQIE_AUTHORIZATION_WORK_MISMATCH');
  if (await visible(page.getByRole('heading', {name: /^授权信息\s*[·・]\s*\d+$/u})).count() !== 1 ||
      await visible(page.locator(`.upload-form form, form ${songNameLabel}`)).count() ||
      await visible(page.getByText(addSongCaption, {exact: true})).count() || await dialog(page, '是否确认上传成品').count())
    throw Error('FANQIE_AUTHORIZATION_WORK_MISMATCH');
  const list = await one(page.locator('.auth-rights-list'), 'FANQIE_AUTHORIZATION_WORK_MISMATCH');
  const rows = visible(list.locator('.auth-right-item'));
  const names = visible(rows.locator('.song-name'));
  await names.nth(titles.length - 1).waitFor({state: 'visible', timeout: 15_000}).catch(error => {
    throw Error('FANQIE_AUTHORIZATION_WORK_MISMATCH', {cause: error});
  });
  const actual = (await names.allInnerTexts()).map(name => name.trim()).sort();
  if (await rows.count() !== titles.length || JSON.stringify(actual) !== JSON.stringify([...titles].sort()) ||
      !(await Promise.all((await rows.all()).map(async row => await visible(row.locator('.song-name')).count() === 1))).every(Boolean))
    throw Error('FANQIE_AUTHORIZATION_WORK_MISMATCH');
  assertScope();
}

/** Fill a fresh official multi-song form and stop at the authorization-mode page. */
export async function executeFanqieDirectoryForm(context: BrowserContext, songs: readonly FanqieDirectorySong[],
  callbacks: FanqieDirectoryFormCallbacks): Promise<Page> {
  let page: Page | undefined;
  let unwatch: (() => void) | undefined;
  let editor: Awaited<ReturnType<typeof bindDirectoryCards>> | undefined;
  const trace: Trace = async (step, action, index, details) => {
    const eventDetails = index === undefined ? details : {...details, songTitle: songs[index]?.title};
    await callbacks.trace(step, 'begin', page, index, undefined, eventDetails);
    try {
      callbacks.guard();
      const value = await action();
      await callbacks.trace(step, 'ok', page, index, undefined, eventDetails);
      return value;
    } catch (error) {
      await callbacks.trace(step, 'error', page, index, error, eventDetails);
      throw error;
    }
  };
  const assertScope = (url = formUrl) => {
    callbacks.guard();
    if (!page || page.isClosed() || page.url() !== url) throw Error('FANQIE_PAGE_SCOPE_CHANGED');
  };
  const write: Write = async (step, index, url) => {
    assertScope(url);
    await callbacks.intent(step, index);
    assertScope(url);
    if (!url || url === formUrl) await editor?.assertCurrent();
  };
  const account = async (tab: Page) => {
    const {accountId} = await withFanqieReadFrame(tab, callbacks.guard, async frame => {
      await frame.goto(profileUrl, {waitUntil: 'domcontentloaded', timeout: 20_000});
      await one(frame.getByText('UID', {exact: true}), 'FANQIE_ACCOUNT_ID_UNVERIFIED');
      return readFanqieAccountUid({url: async () => frame.url(), playwright: frame});
    });
    if (songs[0].scope.accountId !== accountId) throw Error('FANQIE_CATALOG_SCOPE_CHANGED');
  };

  try {
    const expected = await trace('validate-songs', async () => {
      if (!songs.length || songs.length > fanqieDownloadBatchLimit || new Set(songs.map(song => song.title)).size !== songs.length || songs.some(song =>
        !song.title.trim() || !song.rightsConfirmed || (!song.instrumental && !song.lyricsMatchConfirmed) ||
        !musicTypes[song.musicType] || !songAttributes[song.songAttribute] || !/^\.(wav|mp3)$/iu.test(path.extname(song.assets.audio.file)) ||
        song.scope.accountId !== songs[0].scope.accountId || song.scope.sessionId !== songs[0].scope.sessionId))
        throw Error('FANQIE_DIRECTORY_SONGS_UNVERIFIED');
      return songs.map(expectedDirectorySong);
    });
    const tab = await trace('select-upload-tab', () => fanqieDirectoryStartTab(context));
    page = tab;
    await trace('open-home', async () => {
      tab.setDefaultTimeout(15_000);
      unwatch = callbacks.watch(tab);
      if (tab.url() !== homeUrl) await tab.goto(homeUrl, {waitUntil: 'domcontentloaded', timeout: 20_000});
      assertScope(homeUrl);
      await trace('open-home:account-readback', () => account(tab));
    });
    await trace('open-release', async () => {
      const entry = await one(tab.locator('.sidebar-menu .publish-works .publish-works__title').filter({hasText: /^发布作品$/u}), 'FANQIE_RELEASE_ENTRY_AMBIGUOUS');
      await write('open-release', undefined, homeUrl);
      await entry.click();
      await tab.waitForURL(publishUrl, {waitUntil: 'domcontentloaded', timeout: 20_000});
      assertScope(publishUrl);
    });
    const {cards, add} = await trace('open-finished-release', async () => {
      const entry = await one(tab.locator(finishedRelease), 'FANQIE_FINISHED_RELEASE_UNVERIFIED');
      await write('open-finished-release', undefined, publishUrl);
      await entry.click();
      await tab.waitForURL(formUrl, {waitUntil: 'domcontentloaded', timeout: 20_000});
      assertScope();
      const add = await one(tab.getByText(addSongCaption, {exact: true}), 'FANQIE_ADD_SONG_CONTROL_UNVERIFIED');
      editor = await bindDirectoryCards(add, assertScope);
      return {cards: editor, add};
    });

    // The official Form.List renumbers later cards on deletion. Keep material,
    // cover receipts and the durable journal tied to the original batch slot.
    const order: DirectorySongEntry[] = [];
    const positionOf = (entry: DirectorySongEntry) => {
      const index = order.indexOf(entry);
      if (index === -1) throw Error('FANQIE_SONG_CARD_UNVERIFIED');
      return index;
    };
    const repairFields = (entry: DirectorySongEntry, index: number, errors: Awaited<ReturnType<typeof readDirectoryFieldErrors>>) => {
      const fields = new Set<DirectoryRepairField>();
      for (const error of errors) {
        if (error.index !== index || !error.field ||
            (entry.song.instrumental && (error.field === 'lyrics' || error.field === 'lyricist')))
          throw Error(fieldValidationError);
        fields.add(error.field);
      }
      return fields;
    };
    const readSong = async (entry: DirectorySongEntry) => {
      const {song, spec} = entry;
      const index = positionOf(entry), count = order.length;
      assertScope();
      const card = await cards.card(index, count);
      const fields = repairFields(entry, index, await readDirectoryFieldErrors(card));
      const title = await (await titleField(tab, card, index)).inputValue();
      if (title && title !== song.title) throw Error('FANQIE_METADATA_READBACK_REQUIRED');
      if (!title) fields.add('title');
      const type = await fieldRegion(tab, card, index, 'type', '音乐类型');
      const ai = await fieldRegion(tab, card, index, 'ai_usage_type', '是否为AI作品');
      const credit = {lyricist: [] as string[], composer: [] as string[], singer: [] as string[]};
      for (const role of authorRoles) {
        const [field, name] = authors[role];
        if (song.instrumental && role === 'lyricist') {
          credit.lyricist = await artistNames(card.locator('.arco-form-item').filter({has: tab.locator(`label[for="songs_${index}_${field}_input"]`)}));
        } else {
          const region = await fieldRegion(tab, card, index, field, name);
          credit[role] = await artistNames(region);
          if (!credit[role].length) fields.add(role);
          else if (role === 'singer' && song.singerArtistId) await verifySingerId(region, song.singerArtistId);
        }
      }
      const audioArea = await fileArea(tab, card, index, 'audio');
      const audioText = await directoryFileReceipt(audioArea);
      if (!audioText && await visible(audioArea.locator('[class*="upload-input-container-"]')).count() === 1) fields.add('audio');
      const audio = expectedAudio(spec, song, audioText, true);
      const lyricsArea = song.instrumental ? card.locator(`#songs_${index}_lyricFile, #songs_${index}_lyricFile_input`) :
        await fileArea(tab, card, index, 'lyrics');
      const lyricsText = await directoryFileReceipt(lyricsArea);
      if (!song.instrumental && !lyricsText && await visible(lyricsArea.locator('[class*="upload-input-container-"]')).count() === 1)
        fields.add('lyrics');
      const coverArea = await fileArea(tab, card, index, 'cover');
      if (await visible(coverArea.locator('.image-upload-input-btn')).count() === 1 && !(await coverPreview(coverArea)).length)
        fields.add('cover');
      await cards.requireMounted(index, count);
      if (fields.size) return fields;

      if (!entry.coverSource) throw Error('FANQIE_COVER_READBACK_REQUIRED');
      const preview = await waitForCover(coverArea, assertScope, entry.coverSource);
      assertFanqieFirstStepReadback({
        title, songCount: 1, musicType: await chosenRadio(tab, type, Object.values(musicTypes)), ai: await chosenRadio(tab, ai, aiChoices), authors: credit,
        instrumental: await (await instrumentalChoice(tab, card))?.state.isChecked(), audioText, lyricsText, coverPreview: [preview],
      }, {...spec, audio});
      const attribute = await songAttributeRegion(tab, card, index, song.songAttribute);
      if (attribute && await chosenRadio(tab, attribute, Object.values(songAttributes)) !== songAttributes[song.songAttribute])
        throw Error('FANQIE_METADATA_READBACK_REQUIRED');
      if (spec.originalSinger) await verifyOriginalSinger(await fieldRegion(tab, card, index, 'originalSingers', '原唱', originalSingerError), spec.originalSinger);
      if (spec.originalWorkId) await verifyOriginalWork(await fieldRegion(tab, card, index, 'master_product_id', '关联原作品', originalWorkError), spec.originalWorkId);
      const proofText = await directoryFileReceipt(song.copyrightProof ? await fileArea(tab, card, index, 'proof') :
        card.locator(`#songs_${index}_authorizationFiles, #songs_${index}_authorizationFiles_input`));
      if (song.copyrightProof ? !proofVerified(proofText, song.copyrightProof) : !!proofText)
        throw Error('FANQIE_COPYRIGHT_PROOF_READBACK_REQUIRED');
      await cards.requireMounted(index, count);
      return fields;
    };

    const freshCard = async (index: number, count: number) => {
      const fresh = await cards.card(index, count);
      if (await (await titleField(tab, fresh, index)).inputValue() || await visible(fresh.locator('.arco-tag-content .name')).count() ||
          await visible(fresh.getByText(/上传完成/u)).count() || (await coverPreview(fresh)).length)
        throw Error('FANQIE_EXISTING_FORM_REQUIRES_RECONCILIATION');
    };
    const addCard = (entry: DirectorySongEntry, index: number) => trace('add-song', async () => {
      assertScope();
      await cards.count(index);
      await write('add-song', entry.jobIndex);
      await add.click();
      await cards.count(index + 1, true);
      await freshCard(index, index + 1);
    }, entry.jobIndex);

    const fillSong = async (entry: DirectorySongEntry, fields?: ReadonlySet<DirectoryRepairField>) => {
      const {song, spec, jobIndex} = entry;
      const index = positionOf(entry), count = order.length;
      const card = await cards.card(index, count);
      const writeSong: Write = step => write(step, jobIndex);
      const traceSong = <T>(step: string, action: () => Promise<T>) => trace(step, action, jobIndex);
      const needs = (field: DirectoryRepairField) => !fields || fields.has(field);
      const select = async (step: string, region: Locator, name: string, names: readonly string[]) => {
        const option = await choice(tab, region, name);
        if (!option) throw Error('FANQIE_CHOICE_CONTROL_UNVERIFIED');
        if (!await option.state.isChecked()) {
          await writeSong(step);
          await option.control.click();
        }
        if (await chosenRadio(tab, region, names) !== name) throw Error('FANQIE_METADATA_READBACK_REQUIRED');
      };
      if (!fields) {
        await traceSong('select-music-type', async () => select('select-music-type', await fieldRegion(tab, card, index, 'type', '音乐类型'),
          musicTypes[song.musicType], Object.values(musicTypes)));
        await traceSong('select-song-attribute', async () => {
          const attribute = await songAttributeRegion(tab, card, index, song.songAttribute);
          if (attribute) await select('select-song-attribute', attribute, songAttributes[song.songAttribute], Object.values(songAttributes));
        });
        const {originalSinger, originalWorkId} = spec;
        if (originalSinger) await traceSong('select-original-singer', () => selectOriginalSinger(tab, card, index, originalSinger, writeSong));
        if (originalWorkId) await traceSong('select-original-work', () => selectOriginalWork(tab, card, index, originalWorkId, writeSong, traceSong));
        await traceSong('select-instrumental', async () => {
          const option = await instrumentalChoice(tab, card);
          if (!!await option?.state.isChecked() === !!song.instrumental) return;
          if (!option || (!song.instrumental && !('toggle' in option))) throw Error('FANQIE_INSTRUMENTAL_FORM_UNVERIFIED');
          await writeSong('select-instrumental');
          await option.control.click();
          if (await option.state.isChecked() !== !!song.instrumental) throw Error('FANQIE_INSTRUMENTAL_FORM_UNVERIFIED');
        });
      }

      const uploadMaterial = async (role: DirectoryFileRole, replaceCover = false) => {
        const asset = role === 'proof' ? song.copyrightProof : song.assets[role];
        if (!asset) throw Error('FANQIE_ASSET_INVALID');
        await cards.count(count);
        await cards.card(index, count);
        const area = await fileArea(tab, card, index, role);
        const existingCover = role === 'cover' ? await coverPreview(area) : [];
        const failedCover = role === 'cover' ? coverUploadFailure(area) : undefined;
        const failedCoverCount = failedCover ? await failedCover.count() : 0;
        if (failedCoverCount > 1) throw Error('FANQIE_COVER_RETRY_CONTROL_UNVERIFIED');
        if (role === 'cover' && existingCover.length && !replaceCover) throw Error('FANQIE_COVER_READBACK_REQUIRED');
        if (role !== 'cover' && await directoryFileReceipt(area)) throw Error('FANQIE_EXISTING_FORM_REQUIRES_RECONCILIATION');
        const missingControl = role === 'proof' ? 'FANQIE_COPYRIGHT_PROOF_CONTROL_UNVERIFIED' : 'FANQIE_UPLOAD_CONTROL_UNVERIFIED';
        if (failedCoverCount === 1) await failedCover!.hover();
        const uploader = await one(area.locator(role === 'cover' && (existingCover.length || failedCoverCount)
          ? '.upload-img-item-btns-replace-text' : role === 'cover' ? '.image-upload-input-btn' : '[class*="upload-input-container-"]'),
          role === 'cover' && failedCoverCount ? 'FANQIE_COVER_RETRY_CONTROL_UNVERIFIED' : missingControl);
        // Click the upload icon inside the shared file area to keep the copyright guide link untouched.
        const control = role === 'cover' ? uploader : await one(uploader.locator('[class*="upload-input-icon-container-"]'), missingControl);
        await writeSong(role === 'proof' ? 'upload:copyright-proof' : 'upload:' + role);
        await chooseDirectoryFile(tab, area, control, role, asset, async () => {
          // The account was verified before opening this form. Re-navigating a hidden
          // account iframe around every local file selection can interrupt a long draft
          // when the network changes; the form URL and owned card are the live scope here.
          assertScope();
          await cards.requireMounted(index, count);
          assertScope();
        });
        return area;
      };
      if (needs('audio')) await traceSong('upload:audio', async () => {
        const area = await uploadMaterial('audio');
        let retries = 0;
        await waitForTransfer(area, text => fanqieTransferVerified(text, expectedAudio(spec, song, text)),
          assertScope, audioTransferTimeoutMs, callbacks.checkStopped, async () => {
            if (retries >= 3) throw Error('FANQIE_UPLOAD_RETRIES_EXHAUSTED');
            retries++;
            await traceSong(`upload:audio:retry:${retries}`, async () => {
              const {failedRows, controls} = failedTransferRetryControl(area);
              if (await failedRows.count() !== 1 || await controls.count() !== 1) throw Error('FANQIE_UPLOAD_RETRY_CONTROL_UNVERIFIED');
              await writeSong(`upload:audio:retry:${retries}`);
              await controls.click();
              await waitForTransferRetryStart(area, assertScope, callbacks.checkStopped);
            });
          });
      });
      if (!song.instrumental && needs('lyrics')) await traceSong('upload:lyrics', async () => {
        const area = await uploadMaterial('lyrics');
        let retries = 0;
        await waitForTransfer(area, text => fanqieTransferVerified(text, spec.lyrics!), assertScope, 120_000, undefined, async () => {
          if (retries >= 3) throw Error('FANQIE_UPLOAD_RETRIES_EXHAUSTED');
          retries++;
          await traceSong(`upload:lyrics:retry:${retries}`, async () => {
            const {failedRows, controls} = failedTransferRetryControl(area);
            if (await failedRows.count() !== 1 || await controls.count() !== 1) throw Error('FANQIE_UPLOAD_RETRY_CONTROL_UNVERIFIED');
            await writeSong(`upload:lyrics:retry:${retries}`);
            await controls.click();
            await waitForTransferRetryStart(area, assertScope);
          });
        });
      });
      else if (song.instrumental && !fields) await callbacks.trace('upload:lyrics:skipped-instrumental', 'ok', tab, jobIndex, undefined, {songTitle: song.title});
      if (needs('title')) await traceSong('fill-title', async () => {
        const title = await titleField(tab, card, index);
        await writeSong('fill-title');
        await title.fill(song.title);
        if (await title.inputValue() !== song.title) throw Error('FANQIE_METADATA_READBACK_REQUIRED');
      });
      for (const role of authorRoles) {
        if (role === 'lyricist' && song.instrumental) {
          if (!fields) await callbacks.trace('credit:lyricist:skipped-instrumental', 'ok', tab, jobIndex, undefined, {songTitle: song.title});
          continue;
        }
        if (needs(role)) await traceSong('credit:' + role, () => selectCredit(tab, card, index, role, song.authors[role], writeSong, traceSong,
          assertScope, role === 'singer' ? song.singerArtistId : undefined));
      }
      if (needs('cover')) await traceSong('upload:cover', async () => {
        let area = await uploadMaterial('cover', !!fields), retries = 0;
        for (;;) {
          try {
            await traceSong(retries ? `confirm-square-crop:retry:${retries}` : 'confirm-square-crop', async () => {
              const crop = dialog(tab, '裁剪图片 (1/1)'), failed = coverUploadFailure(area);
              await waitForCropOrFailure(crop, failed);
              if (await failed.count()) throw Error('FANQIE_COVER_UPLOAD_FAILED');
              const confirmedCrop = await one(crop, 'FANQIE_CROP_DIALOG_UNVERIFIED');
              const confirm = await one(confirmedCrop.getByRole('button', {name: '确定', exact: true}), 'FANQIE_COVER_CROP_TIMEOUT', coverCropWaitTimeoutMs);
              await writeSong('confirm-square-crop');
              await confirm.click();
              await confirmedCrop.waitFor({state: 'hidden', timeout: coverCropWaitTimeoutMs}).catch(error => {
                if (error instanceof Error && error.name === 'TimeoutError') throw Error('FANQIE_COVER_CROP_TIMEOUT', {cause:error});
                throw error;
              });
            });
            entry.coverSource = (await waitForCover(area, assertScope)).source;
            break;
          } catch (error) {
            if (!(error instanceof Error) || !['FANQIE_COVER_UPLOAD_FAILED', 'FANQIE_COVER_CROP_TIMEOUT'].includes(error.message)) throw error;
            if (retries >= 3) throw Error('FANQIE_COVER_UPLOAD_RETRIES_EXHAUSTED', {cause:error});
            retries++;
            await traceSong(`upload:cover:retry:${retries}`, async () => {
              if (error.message === 'FANQIE_COVER_CROP_TIMEOUT') {
                const crop = dialog(tab, '裁剪图片 (1/1)');
                if (await crop.count() === 1) await closeTimedOutCrop(crop, () => writeSong(`close-cover-crop:retry:${retries}`));
              }
              area = await uploadMaterial('cover', true);
            });
          }
        }
      });
      if (!fields) await traceSong('declare-ai', async () => select('declare-ai', await fieldRegion(tab, card, index, 'ai_usage_type', '是否为AI作品'), song.ai ? '是' : '否', aiChoices));
      const proof = song.copyrightProof;
      if (proof && !fields) await traceSong('upload:copyright-proof', async () => {
        const area = await uploadMaterial('proof');
        await waitForTransfer(area, text => proofVerified(text, proof), assertScope);
      });
      else if (!fields) await callbacks.trace('upload:copyright-proof:skipped', 'ok', tab, jobIndex, undefined, {songTitle: song.title});
    };

    const assertDraftIdentity = async (entry: DirectorySongEntry, card: Locator, index: number) => {
      const title = await (await titleField(tab, card, index)).inputValue();
      const receipt = await directoryFileReceipt(await fileArea(tab, card, index, 'audio'));
      const filename = receipt.split('\n', 1)[0];
      const {base, name} = path.parse(entry.song.assets.audio.file);
      if ((title && title !== entry.song.title) || (filename && ![base, name, entry.song.title].includes(filename)))
        throw Error('FANQIE_EXISTING_FORM_REQUIRES_RECONCILIATION');
    };
    const replaceDraft = async (entry: DirectorySongEntry) => {
      const index = positionOf(entry);
      // Fanqie requires the editor to retain at least one draft.
      const onlySong = order.length === 1;
      if (onlySong) await addCard(entry, 1);
      const count = onlySong ? 2 : order.length;
      await trace('repair:remove-song', async () => {
        await cards.count(count);
        const card = await cards.card(index, count);
        const songItem = cards.form.locator('.song-item').filter({has: fieldLabel(tab, index, 'name')});
        const header = await one(songItem.locator(':scope > .song-header'), deleteDraftError);
        const caption = await one(header.locator(':scope > .name'), deleteDraftError);
        const remove = await one(header.locator(':scope > .delete-icon'), deleteDraftError);
        await remove.scrollIntoViewIfNeeded();
        await write('repair:remove-song', entry.jobIndex);
        const label = /^歌曲\s*(\d+)\s*[:：]\s*(.*)$/u.exec((await caption.innerText()).trim());
        if (Number(label?.[1]) !== index + 1 || (label?.[2] && label[2] !== entry.song.title)) throw Error(deleteDraftError);
        await assertDraftIdentity(entry, card, index);
        await cards.requireMounted(index, count);
        await remove.click();
        const removal = await one(dialog(tab, '温馨提示').filter({
          has: tab.getByText('删除后，歌曲和编辑的内容都将被删除', {exact: true}),
        }), deleteDraftError);
        const confirm = await one(removal.getByRole('button', {name: '确认删除', exact: true}), deleteDraftError);
        const button = await confirm.elementHandle();
        try {
          await write('repair:confirm-delete', entry.jobIndex);
          await button.click({timeout: 3_000}).catch(error => {throw Error(deleteDraftError, {cause: error});});
        } finally {
          await button.dispose().catch(() => {});
        }
        await removal.waitFor({state: 'hidden'});
        await cards.count(count - 1);
      }, entry.jobIndex);
      order.splice(index, 1);
      entry.coverSource = undefined;
      if (onlySong) await freshCard(0, 1);
      else await addCard(entry, order.length);
      order.push(entry);
    };
    const removeRejectedDraft = async (entry: DirectorySongEntry) => {
      const index = positionOf(entry), count = order.length;
      await trace('first-step:submission-rejection:remove-card', async () => {
        await cards.count(count);
        const card = await cards.card(index, count);
        const songItem = cards.form.locator('.song-item').filter({has: fieldLabel(tab, index, 'name')});
        const header = await one(songItem.locator(':scope > .song-header'), deleteDraftError);
        const caption = await one(header.locator(':scope > .name'), deleteDraftError);
        const remove = await one(header.locator(':scope > .delete-icon'), deleteDraftError);
        await remove.scrollIntoViewIfNeeded();
        await write('first-step:submission-rejection:remove-card', entry.jobIndex);
        const label = /^歌曲\s*(\d+)\s*[:：]\s*(.*)$/u.exec((await caption.innerText()).trim());
        if (Number(label?.[1]) !== index + 1 || label?.[2] !== entry.song.title) throw Error(deleteDraftError);
        await assertDraftIdentity(entry, card, index);
        await cards.requireMounted(index, count);
        await remove.click();
        const removal = await one(dialog(tab, '温馨提示').filter({
          has: tab.getByText('删除后，歌曲和编辑的内容都将被删除', {exact: true}),
        }), deleteDraftError);
        const confirm = await one(removal.getByRole('button', {name: '确认删除', exact: true}), deleteDraftError);
        const button = await confirm.elementHandle();
        try {
          await write('first-step:submission-rejection:confirm-delete', entry.jobIndex);
          await button.click({timeout: 3_000}).catch(error => {throw Error(deleteDraftError, {cause: error});});
        } finally {
          await button.dispose().catch(() => {});
        }
        await removal.waitFor({state: 'hidden'});
        await cards.count(count - 1);
      }, entry.jobIndex, {songTitle: entry.song.title});
      order.splice(index, 1);
      entry.coverSource = undefined;
    };

    const repairSong = async ({entry, fields}: DirectoryRepair, rebuild = false) => {
      const index = positionOf(entry), count = order.length;
      const {jobIndex} = entry;
      const card = await cards.card(index, count);
      for (const field of fields) {
        const label = fieldLabel(tab, index, repairFieldControls[field]);
        const region = visible(card.locator('.arco-form-item').filter({has: label}));
        const message = directoryValidationMessages(region).first();
        const target = await message.count() ? message : region;
        if (await target.count() === 1) await target.scrollIntoViewIfNeeded({timeout: 1_500}).catch(() => {});
        await callbacks.trace('first-step:validation:' + field, 'error', tab, jobIndex, Error(fieldValidationError), {songTitle: entry.song.title});
      }
      await trace('repair:song', async () => {
        if (entry.repairs >= 2) throw Error('FANQIE_DIRECTORY_REPAIR_LIMIT');
        entry.repairs++;
        await account(tab);
        await assertDraftIdentity(entry, card, index);
        let replace = rebuild || fields.has('audio');
        for (const role of ['lyrics', 'cover'] as const) {
          if (replace || !fields.has(role)) continue;
          const area = await fileArea(tab, card, index, role);
          replace = role === 'lyrics' ? !!await directoryFileReceipt(area) : !!(await coverPreview(area)).length;
        }
        for (const role of authorRoles) {
          if (replace || !fields.has(role)) continue;
          const [field, name] = authors[role];
          replace = !!(await artistNames(await fieldRegion(tab, card, index, field, name))).length;
        }
        if (replace) await replaceDraft(entry);
        await fillSong(entry, replace ? undefined : fields);
      }, jobIndex);
    };

    for (const [jobIndex, song] of songs.entries()) {
      const entry: DirectorySongEntry = {song, spec: expected[jobIndex], jobIndex, repairs: 0, coverUploadRetries: 0};
      await addCard(entry, order.length);
      order.push(entry);
      try {
        await fillSong(entry);
      } catch (error) {
        if (error instanceof Error && error.message === 'FANQIE_COVER_READBACK_REQUIRED' && entry.coverUploadRetries < 1) {
          entry.coverUploadRetries++;
          await repairSong({entry, fields: new Set<DirectoryRepairField>(['cover'])});
        } else {
          if (!(error instanceof Error) || !/^FANQIE_(?:UPLOAD_READBACK_(?:REQUIRED|TIMEOUT)|COVER_UPLOAD_FAILED)$/u.test(error.message))
            throw error;
          const index = positionOf(entry);
          const card = await cards.card(index, order.length);
          const fields = repairFields(entry, index, await readDirectoryFieldErrors(card));
          if (!fields.size && error.message === 'FANQIE_UPLOAD_READBACK_TIMEOUT') {
            // A stalled transfer may leave the uploader blank without rendering a validation message.
            // Re-read the visible draft before deciding; never infer success from the timeout itself.
            const observed = await trace('upload:timeout-readback', () => readSong(entry), jobIndex);
            if (!observed.size) continue;
            const uploadFields = new Set([...observed].filter(field => field === 'audio' || field === 'lyrics' || field === 'cover'));
            if (!uploadFields.size) throw error;
            await repairSong({entry, fields: uploadFields});
          } else {
            if (!fields.size) throw error;
            await repairSong({entry, fields}, true);
          }
        }
      }
      for (;;) {
        const fields = await trace('song:readback', () => readSong(entry), jobIndex);
        if (!fields.size) break;
        if (fields.has('cover')) {
          if (entry.coverUploadRetries >= 1) throw Error('FANQIE_COVER_READBACK_REQUIRED');
          entry.coverUploadRetries++;
        }
        await repairSong({entry, fields});
      }
    }

    const readGroup = async () => {
      assertScope();
      await cards.count(order.length);
      await cards.start();
      const repairs: DirectoryRepair[] = [];
      for (const entry of order) {
        const fields = await trace('first-step:readback', () => readSong(entry), entry.jobIndex);
        if (fields.size) repairs.push({entry, fields});
      }
      await cards.count(order.length);
      return repairs;
    };

    const confirmation = dialog(tab, '是否确认上传成品');
    const rejectionNotice = visible(tab.locator('xpath=//span[contains(text(),"作品信息提交失败")]'));
    const waitForSubmissionRejection = async () => {
      const deadline = Date.now() + submissionRejectionWaitMs;
      for (;;) {
        callbacks.guard();
        if (tab.isClosed()) throw Error('FANQIE_BROWSER_PAGE_CLOSED');
        // Successful confirmation can navigate to the authorization step. The
        // rejection watch only applies while the upload form remains visible.
        if (tab.url() !== formUrl) return undefined;
        const texts = (await rejectionNotice.allInnerTexts()).map(text => text.trim()).filter(Boolean);
        if (texts.length) {
          const uniqueTexts = [...new Set(texts)];
          const titles = [...new Set(uniqueTexts.map(text => /作品信息提交失败\s*[：:]\s*《([^》]+)》/u.exec(text)?.[1]?.trim())
            .filter((title): title is string => Boolean(title)))];
          return {texts: uniqueTexts, title: titles.length === 1 && uniqueTexts.every(text =>
            /作品信息提交失败\s*[：:]\s*《([^》]+)》/u.test(text)) ? titles[0] : undefined};
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) return undefined;
        await delay(Math.min(100, remaining));
      }
    };
    const afterNext = async () => {
      const messages = directoryValidationMessages(cards.form);
      const pageErrors = visible(tab.locator(directoryPageError));
      await confirmation.or(messages).or(pageErrors).first().waitFor({state: 'visible', timeout: 15_000}).catch(async error => {
        const code = await pageErrors.count() ? 'FANQIE_UPLOAD_PAGE_ERROR' : 'FANQIE_UPLOAD_CONFIRMATION_UNVERIFIED';
        throw Error(code, {cause: error});
      });
      await cards.assertCurrent();
      const errors = await readDirectoryFieldErrors(cards.form);
      if (!await confirmation.count() && await pageErrors.count()) {
        const notices = (await pageErrors.allInnerTexts()).map(text => text.trim()).filter(Boolean);
        const rejectedTitles = [...new Set(notices.map(text => /作品信息提交失败\s*[：:]\s*《([^》]+)》\s*歌词内容不符合规范/u.exec(text)?.[1]?.trim()).filter((title): title is string => Boolean(title)))];
        if (rejectedTitles.length) {
          const rejectedTitle = rejectedTitles.length === 1 ? rejectedTitles[0] : undefined;
          if (!rejectedTitle) {
            await callbacks.trace('first-step:validation:lyrics-content', 'error', tab, undefined,
              Error(lyricsContentSongUnmappedError));
            throw Error(lyricsContentSongUnmappedError);
          }
          const matches = order.filter(entry => entry.song.title.trim() === rejectedTitle);
          if (matches.length === 1) {
            const entry = matches[0];
            await callbacks.trace('first-step:validation:lyrics-content', 'error', tab, entry.jobIndex,
              Error(lyricsContentRejectedError), {songTitle: entry.song.title});
            throw Error(lyricsContentRejectedError);
          }
          await callbacks.trace('first-step:validation:lyrics-content', 'error', tab, undefined,
            Error(lyricsContentSongUnmappedError), {songTitle: rejectedTitle});
          throw Error(lyricsContentSongUnmappedError);
        }
        if (!errors.length) throw Error('FANQIE_UPLOAD_PAGE_ERROR');
      }
      if (!errors.length) {
        if (await confirmation.count() !== 1) throw Error(fieldValidationError);
        return [];
      }
      const byIndex = new Map<number, typeof errors>();
      for (const error of errors) {
        const group = byIndex.get(error.index);
        if (group) group.push(error);
        else byIndex.set(error.index, [error]);
      }
      const repairs: DirectoryRepair[] = [];
      for (const [index, issues] of byIndex) {
        const entry = order[index];
        if (!entry) throw Error(fieldValidationError);
        repairs.push({entry, fields: repairFields(entry, index, issues)});
      }
      return repairs;
    };

    const cancelConfirmation = () => trace('first-step:cancel-upload', async () => {
      const cancel = await one(confirmation.getByRole('button', {name: '取消', exact: true}), 'FANQIE_UPLOAD_CONFIRMATION_UNVERIFIED');
      await write('first-step:cancel-upload');
      await cancel.click();
      await confirmation.waitFor({state: 'hidden'});
    });

    let removedRejectedSongs = 0;
    for (;;) {
      const repairs = await trace('first-step:next', async () => {
        await account(tab);
        const pending = await readGroup();
        if (pending.length) return pending;
        const next = await one(tab.getByRole('button', {name: '下一步', exact: true}), 'FANQIE_NEXT_CONTROL_UNVERIFIED');
        await write('first-step:next');
        await next.click();
        return afterNext();
      });
      if (repairs.length) {
        if (await confirmation.count()) await cancelConfirmation();
        for (const repair of repairs) await repairSong(repair);
        continue;
      }

      let rejectedAndRemoved = false;
      const recheck = await trace('first-step:confirm-upload', async () => {
        const confirm = await one(confirmation.getByRole('button', {name: '确认上传', exact: true}), 'FANQIE_UPLOAD_CONFIRMATION_UNVERIFIED');
        await trace('first-step:preflight', () => write('first-step:preflight'));
        await account(tab);
        const pending = await readGroup();
        if (pending.length) {
          await cancelConfirmation();
          return pending;
        }
        await trace('first-step:confirm-upload:click', async () => {
          await write('first-step:confirm-upload');
          await confirm.click({noWaitAfter: true});
        }, undefined, {batchSize: order.length});
        const rejection = await trace('first-step:submission-rejection:watch-4s', () => waitForSubmissionRejection(),
          undefined, {batchSize: order.length, submissionRejectionWaitMs});
        if (rejection) {
          if (!rejection.title) {
            await callbacks.trace('first-step:submission-rejection:unmapped', 'error', tab, undefined,
              Error(submissionRejectionUnmappedError), {noticeCount: rejection.texts.length});
            throw Error(submissionRejectionUnmappedError);
          }
          const matches = order.filter(entry => entry.song.title.trim() === rejection.title);
          if (matches.length !== 1) {
            await callbacks.trace('first-step:submission-rejection:unmapped', 'error', tab, undefined,
              Error(submissionRejectionUnmappedError), {songTitle: rejection.title, matchCount: matches.length});
            throw Error(submissionRejectionUnmappedError);
          }
          const entry = matches[0];
          await callbacks.trace('first-step:submission-rejection:matched', 'ok', tab, entry.jobIndex, undefined,
            {songTitle: entry.song.title, noticeCount: rejection.texts.length, removedCount: removedRejectedSongs});
          await callbacks.verifyUnsubmitted(entry.jobIndex);
          if (order.length === 1) {
            // The official Form.List requires one card to remain. Keep that rejected
            // card visible for review, but remove its unsubmitted local materials.
            await callbacks.rejectUnsubmittedSong(entry.jobIndex);
            await callbacks.trace('first-step:submission-rejection:all-songs-removed', 'error', tab, entry.jobIndex,
              Error(allSongsRejectedError), {songTitle: entry.song.title});
            throw Error(allSongsRejectedError);
          }
          if (removedRejectedSongs >= submissionRejectionRetries) {
            await callbacks.trace('first-step:submission-rejection:limit', 'error', tab, entry.jobIndex,
              Error(submissionRejectionRetriesExhaustedError), {songTitle: entry.song.title, retryLimit: submissionRejectionRetries});
            throw Error(submissionRejectionRetriesExhaustedError);
          }
          await removeRejectedDraft(entry);
          await callbacks.rejectUnsubmittedSong(entry.jobIndex);
          removedRejectedSongs++;
          rejectedAndRemoved = true;
        }
        return [];
      });
      if (rejectedAndRemoved) continue;
      if (!recheck.length) break;
      for (const repair of recheck) await repairSong(repair);
    }
    await trace('first-step:authorization-readback', async () => {
      await checkAuthorizationGroup(tab, order.map(entry => entry.song.title), assertScope);
      await callbacks.archiveObserved(order.map(entry => entry.jobIndex));
      await account(tab);
      assertScope();
    }, undefined, {batchSize: order.length});
    return tab;
  } finally {
    await editor?.dispose().catch(() => {});
    unwatch?.();
  }
}

function expectedAudio(spec: FanqieExpectedForm, song: FanqieDirectorySong, text: string, _includeTitle = false) {
  const {name, base} = path.parse(song.assets.audio.file);
  const shown = text.split(/\r?\n/u, 1)[0].trim();
  // Only the selected local audio filename (with or without extension) verifies
  // the upload. A separately edited work title is not evidence of its filename.
  const allowed = [name, base];
  return {...spec.audio, displayName: allowed.includes(shown) ? shown : name};
}
