import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {chromium, type BrowserContext, type Page} from 'playwright-core';
import {z} from 'zod';
import {readFanqieAccountUid, readFanqieArtists} from './identity';
import {readFanqieCatalog} from './catalog';
import type {FanqieCatalog, FanqieCatalogReport} from '../../shared/fanqie-catalog';
type Options = {
  root: string; available: () => boolean; generation: () => number;
  launch?: (profile: string) => Promise<BrowserContext>;
  account?: (page: Page) => Promise<{accountId: string}>;
  catalog?: (page: Page) => Promise<FanqieCatalog>;
};
// Only the public locator/evaluate surface is exposed to the read-only adapters.
function readPage(page: Page) {
  return {url: async () => page.url(), playwright: page};
}
const actions = z.enum(['open', 'read', 'status']);
const empty = z.strictObject({});
/** Dedicated application-owned Chrome session. Never imports another browser's cookies or profile. */
export class FanqieCatalogSession {
  private context?: BrowserContext;
  private busy = false;
  private report?: FanqieCatalogReport;
  private progress = '';
  private lastError: string | null = null;
  constructor(private readonly options: Options) {}
  private assertCurrent(generation: number) {
    if (!this.options.available()) throw Error('PRODUCTION_REQUIRED');
    if (this.options.generation() !== generation) throw Error('WORKSPACE_CHANGED');
  }
  mark(step: string, error: string | null = null) {
    this.progress = step; this.lastError = error;
    const folder = path.join(this.options.root, 'diagnostics'); fs.mkdirSync(folder, {recursive: true});
    // No page text, URLs, account IDs, file paths or credentials in diagnostics.
    fs.writeFileSync(path.join(folder, 'fanqie-operation.json'), JSON.stringify({at: new Date().toISOString(), step, error}));
  }
  status() {return {connected: !!this.context, busy: this.busy, report: this.report ?? null, progress: this.progress, lastError: this.lastError, uploadAvailable: false as const};}
  async run<T>(action: (context: BrowserContext, guard: () => void) => Promise<T>): Promise<T> {
    const generation = this.options.generation(); this.assertCurrent(generation);
    if (this.busy) throw Error('FANQIE_BROWSER_BUSY');
    const context = this.context; if (!context) throw Error('FANQIE_BROWSER_CONNECTION_REQUIRED');
    this.busy = true;
    const guard = () => {this.assertCurrent(generation); if (this.context !== context) throw Error('FANQIE_BROWSER_CONNECTION_REQUIRED');};
    try {return await action(context, guard);}
    catch (error) {this.mark('操作未完成', fanqieCatalogError(error).code); throw error;}
    finally {this.busy = false;}
  }
  async inspect(context: BrowserContext, guard: () => void, withArtists = false) {
    this.mark('正在读取番茄账号'); guard();
    const page = await context.newPage();
    const go = async (url: string) => {guard(); await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 20000}); guard();};
    try {
      await go('https://www.novelfm.com/creator/music/account/profile');
      const account = await (this.options.account ?? (p => readFanqieAccountUid(readPage(p))))(page); guard();
      this.mark('正在读取已有作品');
      await go('https://www.novelfm.com/creator/music/finished/ugc');
      const catalog = await (this.options.catalog ?? (p => readFanqieCatalog(readPage(p))))(page); guard();
      let artists: {artistId: string; name: string}[] = [];
      if (withArtists) {
        this.mark('正在核对署名'); await go('https://www.novelfm.com/creator/music/account/artist');
        artists = (await readFanqieArtists(readPage(page))).artists; guard();
      }
      await go('https://www.novelfm.com/creator/music/account/profile');
      const after = await (this.options.account ?? (p => readFanqieAccountUid(readPage(p))))(page); guard();
      if (!/^[1-9]\d{4,24}$/.test(account.accountId)) throw Error('FANQIE_ACCOUNT_ID_UNVERIFIED');
      if (account.accountId !== after.accountId) throw Error('FANQIE_CATALOG_SCOPE_CHANGED');
      if (catalog.source !== 'browser') throw Error('FANQIE_CATALOG_SOURCE_REQUIRED');
      const report = {...catalog, accountKey: createHash('sha256').update('fanqie:'+account.accountId).digest('hex'), maskedAccount: '***'+account.accountId.slice(-4)};
      const folder = path.join(this.options.root, 'production', 'fanqie'); fs.mkdirSync(folder, {recursive: true});
      const temp = path.join(folder, 'catalog.json.tmp'), target = path.join(folder, 'catalog.json');
      fs.writeFileSync(temp, JSON.stringify(report, null, 2)); fs.renameSync(temp, target);
      this.report = report; this.mark('作品读取完成'); return {accountId: account.accountId, catalog, report, artists};
    } finally {await page.close().catch(() => {});}
  }
  async ui(action: unknown, input: unknown = {}) {
    const name = actions.parse(action); empty.parse(input);
    const generation = this.options.generation(); this.assertCurrent(generation);
    if (name === 'status') return this.status();
    if (name === 'read') return this.run(async (context, guard) => {await this.inspect(context, guard); return {...this.status(), busy: false};});
    if (this.busy) throw Error('FANQIE_BROWSER_BUSY');
    this.busy = true;
    try {
      if (name === 'open') {
        this.mark('正在连接番茄工作窗口');
        if (this.context) {
          const page = this.context.pages().find(p => !p.isClosed());
          if (page) {await page.bringToFront(); this.assertCurrent(generation); return {...this.status(), busy: false};}
          throw Error('FANQIE_BROWSER_CONNECTION_REQUIRED');
        }
        const profile = path.join(this.options.root, 'browser-sessions', 'fanqie');
        fs.mkdirSync(profile, {recursive: true});
        const context = await (this.options.launch ?? (p => chromium.launchPersistentContext(p, {
          channel: 'chrome', headless: false, chromiumSandbox: true,
          acceptDownloads: false, viewport: null, timeout: 30000,
        })))(profile);
        this.context = context;
        this.mark('浏览器已连接，正在打开番茄');
        context.setDefaultTimeout(15000); context.setDefaultNavigationTimeout(20000);
        context.on('close', () => {if (this.context === context) this.context = undefined;});
        this.assertCurrent(generation);
        const page = context.pages().find(p => !p.isClosed()) ?? await context.newPage();
        // A new session starts at Home. Never navigate an existing upload or contract editor.
        if (page.url() === 'about:blank') await page.goto('https://www.novelfm.com/creator/music/home', {waitUntil: 'domcontentloaded', timeout: 20000});
        this.mark('工作窗口已连接');
        this.assertCurrent(generation); return {...this.status(), busy: false};
      }
    } catch (error) {this.mark('连接未完成', fanqieCatalogError(error).code); throw error;}
    finally {this.busy = false;}
  }
}

export function fanqieCatalogError(error: unknown) {
  const code = error instanceof Error && error.name === 'TimeoutError' ? 'FANQIE_BROWSER_TIMEOUT' : error instanceof Error && /strict mode violation/.test(error.message) ? 'FANQIE_CONTROL_AMBIGUOUS' : error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'FANQIE_BROWSER_OPERATION_FAILED';
  const messages: Record<string, string> = {
    PRODUCTION_REQUIRED: '请切换到真实作品库。',
    FANQIE_CONFIGURATION_REQUIRED: '请先在配置中心保存番茄音乐的署名和发布规则。',
    FANQIE_AI_DISCLOSURE_REQUIRED: '请先在作品资料中设置 AI 标注。',
    FANQIE_MUSIC_TYPE_UNSUPPORTED: '此番茄上传流程暂只支持原创作品，请核对作品类型。',
    WORKSPACE_CHANGED: '作品库已切换，请重新读取。',
    FANQIE_BROWSER_CONNECTION_REQUIRED: '请先打开番茄工作窗口并登录。',
    FANQIE_BROWSER_BUSY: '番茄窗口仍在处理中，请稍候。',
    FANQIE_CONTROL_AMBIGUOUS: '页面出现多个同名控件，已停止操作并保留页面。',
    FANQIE_RELEASE_ENTRY_AMBIGUOUS: '首页发布入口不唯一，已停止操作并保留页面。',
    FANQIE_BROWSER_TIMEOUT: '番茄页面读取超时，请核对登录状态后重试读取。',
    FANQIE_IDENTITY_PAGE_REQUIRED: '请在番茄工作窗口完成登录，再读取已有作品。',
    FANQIE_ACCOUNT_ID_UNVERIFIED: '未读到番茄账号，请核对登录状态。',
    FANQIE_CATALOG_FILTERED: '未读到完整作品列表，请重新读取。',
    FANQIE_CATALOG_SCOPE_CHANGED: '番茄账号发生变化，请重新读取。',
    FANQIE_BUNDLE_REQUIRED: '请先选择发布材料清单。',
    FANQIE_WORK_MATERIALS_REQUIRED: '所选版本缺少音频、封面或歌词，请先在作品库补齐。',
    FANQIE_WORK_CHANGED: '作品或素材已改变，请重新生成发布副本并检查。',
    FANQIE_JOB_NOT_FOUND: '未找到这次上传，请刷新客户端。',
    FANQIE_BUNDLE_INVALID: '材料清单无效，请确认音频、歌词和封面都在同一个文件夹。',
    FANQIE_AUDIO_FORMAT: '音频须为 WAV 或 MP3，且不超过 200 MB。',
    FANQIE_AUDIO_PROPERTIES: '音频须超过 30 秒，双声道，采样率至少 44.1 kHz。',
    FANQIE_AUDIO_BIT_DEPTH_UNVERIFIED: 'WAV 位深须至少 16 位。',
    FANQIE_COVER_DIMENSIONS: '封面须为正方形，至少 1440 × 1440。',
    FANQIE_COVER_FORMAT: '封面须为 JPG 或 PNG，且不超过 10 MB。',
    FANQIE_LYRICS_INVALID: '歌词文件无效，请使用 UTF-8 文本。',
    FANQIE_ARTIST_ID_UNVERIFIED: '署名没有匹配到唯一的合作艺人，请在番茄核对。',
    FANQIE_ARTIST_LIST_NOT_READY: '合作艺人列表在 15 秒内未加载，请检查番茄工作窗口后重新检查。',
    FANQIE_ARTIST_NAME_NOT_FOUND: '已读到合作艺人列表，但没有找到填写的署名，请核对名称。',
    FANQIE_ARTIST_NAME_AMBIGUOUS: '合作艺人中存在多个同名记录，请先在官网核对。',
    FANQIE_OFFICIAL_RECORD_ALREADY_EXISTS: '官网已有同名作品，已阻止重复上传。',
    FANQIE_CATALOG_INCOMPLETE: '作品列表未读全，暂不能排除重复。',
    FANQIE_ASSET_CHANGED: '材料已变化，请重新选择并检查。',
    FANQIE_UPLOAD_AUTHORIZATION_REQUIRED: '本次上传检查已失效，请重新检查材料。',
    FANQIE_RECONCILIATION_REQUIRED: '这份音频已有上传操作，请先核对原页面和官网记录。',
    FANQIE_UPLOAD_READBACK_TIMEOUT: '上传回显等待超时。已保留原页面，请核对结果，勿重新上传。',
    FANQIE_SAVED_WORK_READBACK_REQUIRED: '尚未找到唯一的新作品记录，请保留原页面核对，勿重复上传。',
  };
  return {code, message: messages[code] ?? '番茄记录读取未完成，请核对工作窗口的登录状态和网络。'};
}
