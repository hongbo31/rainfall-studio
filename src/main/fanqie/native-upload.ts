import path from 'node:path';
import type {BrowserContext, Page, Locator} from 'playwright-core';
import type {FanqieInput} from '../../shared/fanqie';
import {readFanqieAccountUid} from './identity';
import {chooseFanqieFile, fanqieFileControl} from './form';
import {readFanqieVisibleForm, selectFanqieCredit, confirmFanqieFirstStep, assertFanqieFirstStepReadback, fanqieTransferVerified, type FanqieExpectedForm} from './first-step';

/** Translate the calibrated locator surface to Playwright's native timeout spelling. */
function locatorAdapter(locator: Locator): any {
  return new Proxy(locator, {get(target, property) {
    if (property === 'waitFor') return ({timeoutMs, ...options}: any) => target.waitFor({...options, timeout: timeoutMs});
    if (property === 'filter') return (options: any) => locatorAdapter(target.filter({...options,
      ...(options.has ? {has:options.has.__nativeLocator ?? options.has} : {}),
      ...(options.hasNot ? {hasNot:options.hasNot.__nativeLocator ?? options.hasNot} : {})}));
    if (['locator','getByRole','getByText'].includes(String(property)))
      return (...args: any[]) => locatorAdapter((target as any)[property](...args.map(a => a?.__nativeLocator ?? a)));
    if (property === '__nativeLocator') return target;
    const value = (target as any)[property]; return typeof value === 'function' ? value.bind(target) : value;
  }});
}
export function nativeFanqiePage(page: Page): any {
  return {url: async () => page.url(),
    readSongCount: () => page.locator('label[for]').evaluateAll(labels => labels.filter(label => /^songs_\d+_name_input$/.test(label.getAttribute('for') ?? '')).length),
    playwright: {
    domSnapshot: () => page.locator('body').ariaSnapshot(),
    locator: (selector: string) => locatorAdapter(page.locator(selector)),
    getByRole: (role: any, options: any) => locatorAdapter(page.getByRole(role, options)),
    getByText: (text: string, options: any) => locatorAdapter(page.getByText(text, options)),
    waitForEvent: (event: 'filechooser', options: {timeoutMs: number}) => page.waitForEvent(event, {timeout: options.timeoutMs}),
  }};
}
const sizeText = (bytes: number) => bytes >= 1024 * 1024 ? (bytes / 1024 / 1024).toFixed(1)+'MB' : (bytes / 1024).toFixed(1)+'KB';
export function expectedFanqieForm(input: FanqieInput): FanqieExpectedForm {
  return {title: input.title, authors: input.authors, ai: input.ai, musicType: input.musicType,
    audio: {displayName: input.title, format: path.extname(input.assets.audio.file).toLowerCase() === '.wav' ? 'WAV' : 'MP3', displaySize: sizeText(input.assets.audio.bytes), bytes: input.assets.audio.bytes},
    lyrics: {fileName: path.basename(input.assets.lyrics.file), displaySize: sizeText(input.assets.lyrics.bytes), bytes: input.assets.lyrics.bytes}};
}
export async function executeFanqieNativeUpload(context: BrowserContext, input: FanqieInput,
  callbacks: {guard: () => void; intent: (step: string) => Promise<void>; progress: (step: string) => void; diagnostic?:(value:unknown)=>void}) {
  const page = await context.newPage(), adapter = nativeFanqiePage(page);
  const formUrl = 'https://www.novelfm.com/creator/music/finished/ugc/uploadProduct';
  const assertScope = async () => {
    callbacks.guard();
    if (page.isClosed() || page.url() !== formUrl) throw Error('FANQIE_PAGE_SCOPE_CHANGED');
  };
  let accountProbe: Page | undefined;
  const account = async () => {
    callbacks.guard();
    const probe = accountProbe ??= await context.newPage();
      await probe.goto('https://www.novelfm.com/creator/music/account/profile', {waitUntil:'domcontentloaded', timeout:20000});
      const current = await readFanqieAccountUid(nativeFanqiePage(probe)); callbacks.guard();
      if (current.accountId !== input.scope.accountId) throw Error('FANQIE_CATALOG_SCOPE_CHANGED');
  };
  const intent = async (step: string) => {await account(); await callbacks.intent(step); callbacks.guard();};
  const expected = expectedFanqieForm(input);
  // Keep this page on success or failure so the user can inspect the exact upload/contract boundary.
  try {
  await account(); callbacks.progress('正在打开新作品表单');
  await page.goto('https://www.novelfm.com/creator/music/home', {waitUntil:'domcontentloaded', timeout:20000});
  await intent('open-release');
  callbacks.diagnostic?.({stage:'home-release',controls:await page.getByText('发布作品',{exact:true}).evaluateAll(elements=>elements.map(element=>({tag:element.tagName,role:element.getAttribute('role'),className:element.getAttribute('class'),visible:!!(element as HTMLElement).offsetWidth&&!!(element as HTMLElement).offsetHeight,ancestors:[element.parentElement,element.parentElement?.parentElement].filter(Boolean).map(parent=>({tag:parent!.tagName,role:parent!.getAttribute('role'),className:parent!.getAttribute('class')}))})))});
  const release=page.locator('.sidebar-menu .publish-works .publish-works__title').filter({hasText:/^发布作品$/});
  await release.waitFor({state:'visible',timeout:15000});
  if(await release.count()!==1)throw Error('FANQIE_RELEASE_ENTRY_AMBIGUOUS');
  await release.click();
  await intent('open-finished-release');
  await page.locator('.release-info-container').filter({hasText:'成品发行'}).getByRole('button', {name:'发布作品', exact:true}).click();
  await intent('add-song'); await page.getByText('点击添加歌曲', {exact:true}).click();
  await assertScope();
  const before = await readFanqieVisibleForm(adapter);
  if (before.title || Object.values(before.authors).some(v => v.length) || before.coverPreview.length || /上传完成/.test(before.audioText + before.lyricsText))
    throw Error('FANQIE_EXISTING_FORM_REQUIRES_RECONCILIATION');
  await intent('fill-title'); await page.getByRole('textbox', {name:'作品名称', exact:true}).fill(input.title);
  if (before.musicType !== '原创' || input.musicType !== 'original') throw Error('FANQIE_MUSIC_TYPE_UNSUPPORTED');
  if (before.ai !== (input.ai ? '是' : '否')) {
    const ai = page.locator('.arco-form-item').filter({has:page.locator('label[for="songs_0_ai_usage_type_input"]')});
    await intent('declare-ai'); await ai.getByText(input.ai ? '是' : '否', {exact:true}).click();
  }
  for (const role of ['lyricist','composer','singer'] as const) {
    callbacks.progress('正在填写署名');
    await selectFanqieCredit(adapter, role, input.authors[role], intent, assertScope);
  }
  const waitReadback = async (
    role: 'audio' | 'lyrics' | 'cover',
    test: (state: Awaited<ReturnType<typeof readFanqieVisibleForm>>) => boolean,
  ) => {
    const end = Date.now() + 120000;
    let state: Awaited<ReturnType<typeof readFanqieVisibleForm>> | undefined;
    while (Date.now() < end) {
      await assertScope(); state = await readFanqieVisibleForm(adapter);
      if (test(state)) return state;
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    callbacks.diagnostic?.({stage:'material-readback', role,
      acknowledgement: role === 'cover' ? state?.coverPreview :
        (role === 'audio' ? state?.audioText : state?.lyricsText)?.trim().slice(0, 240)});
    throw Error('FANQIE_UPLOAD_READBACK_TIMEOUT');
  };
  for (const role of ['audio','lyrics','cover'] as const) {
    callbacks.progress({audio:'正在上传音频',lyrics:'正在上传歌词',cover:'正在上传封面'}[role]);
    await intent('upload:'+role); await assertScope();
    await chooseFanqieFile(adapter, await fanqieFileControl(adapter, role), input.assets[role], assertScope);
    if (role === 'cover') {
      const crop = page.getByRole('dialog', {name:'裁剪图片 (1/1)', exact:true});
      await crop.waitFor({state:'visible', timeout:20000});
      await intent('confirm-square-crop'); await assertScope();
      await crop.getByRole('button', {name:'确定', exact:true}).click();
      await crop.waitFor({state:'hidden', timeout:20000});
      await waitReadback(role, s => s.coverPreview.length === 1 && s.coverPreview[0].complete && s.coverPreview[0].width > 0 && s.coverPreview[0].width === s.coverPreview[0].height);
    } else if (role === 'audio') await waitReadback(role, s => fanqieTransferVerified(s.audioText, expected.audio));
    else await waitReadback(role, s => fanqieTransferVerified(s.lyricsText, expected.lyrics));
  }
  assertFanqieFirstStepReadback(await readFanqieVisibleForm(adapter), expected);
  callbacks.progress('正在确认上传结果');
  const uploaded=await confirmFanqieFirstStep(adapter, expected, intent, assertScope);
  return uploaded;
  } finally {
    await accountProbe?.close().catch(() => {});
  }
}
