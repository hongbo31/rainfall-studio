import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type {BrowserContext, Frame, Page} from 'playwright-core';
import {z} from 'zod';
import {readFanqieAccountUid, readFanqieArtists} from './identity';
import {readFanqieCatalogPages} from './catalog';
import {readFanqieDirectoryCatalog} from './catalog-lookup';
import {isOfficialSignInRoute,launchAccountBrowser} from '../browser-accounts';
import {openBackgroundOfficialPage} from '../background-page';
import {fanqieAccountTab, fanqieArtistUrl, fanqieProfileUrl as accountPage, withFanqieReadFrame} from './directory-page';
import {fanqieOrigin} from '../../shared/fanqie';
import {fanqieBrowserFailureCode} from './browser-errors';
import type {AccountLoginState} from '../../shared/platform-accounts';
import {FanqieCatalogRowError,type FanqieCatalog,type FanqieCatalogQuery,type FanqieCatalogReport} from '../../shared/fanqie-catalog';
import {fanqieDownloadIssues} from '../../shared/fanqie-downloads';
import {platformImageFailure} from '../../shared/platform-image';
import type {FanqieDirectoryTracePort} from './directory-trace';
import {fanqieRosterNameKey, searchFanqieDirectorySinger, type FanqieArtistPage, type FanqieDirectorySinger} from './artist-creation';
type AccountDocument = Page | Frame;
type Options = {
  root: string; available: () => boolean; generation: () => number;
  launch?: (profile: string) => Promise<BrowserContext>;
  account?: (page: AccountDocument) => Promise<{accountId: string}>;
  catalog?: (page: Page) => Promise<FanqieCatalog>;
  artists?: (page: AccountDocument) => Promise<{artists:{artistId:string;name:string}[]}>;
  stateDirectory?: string;
  browserDirectory?: string;
  verifyAccount?: (accountKey: string) => void;
};
type ObserveAccountOptions = {trace?:FanqieDirectoryTracePort; inPlace?:boolean; verifyAfterRead?:boolean};
// Only the public locator/evaluate surface is exposed to the read-only adapters.
function readPage(page: AccountDocument) {
  return {url: async () => page.url(), playwright: page};
}
const actions = z.enum(['open', 'read', 'status', 'syncProfile']);
const ProfileSchema=z.strictObject({accountKey:z.string().regex(/^[a-f0-9]{64}$/),maskedAccount:z.string(),observedAt:z.string(),artists:z.array(z.strictObject({artistId:z.string().regex(/^[1-9]\d{4,24}$/),name:z.string().min(1)}))});
const empty = z.strictObject({});

function fanqieSignInForm(page: AccountDocument) {
  return page.locator('body')
    .filter({has:page.getByPlaceholder('请输入手机号', {exact:true}).filter({visible:true})})
    .filter({has:page.getByPlaceholder('请输入验证码', {exact:true}).filter({visible:true})})
    .getByRole('button', {name:'登录/注册',exact:true}).filter({visible:true});
}

/** Dedicated application-owned Chrome session. Never imports another browser's cookies or profile. */
export class FanqieCatalogSession {
  private context?: BrowserContext;
  private busy = false;
  private report?: FanqieCatalogReport;
  private verifiedAccountKey?: string;
  private progress = '';
  private lastError: string | null = null;
  private loginCheck?: { context: BrowserContext; generation: number; until: number; result: Promise<AccountLoginState> };
  constructor(private readonly options: Options) {}
  private stateDirectory() {
    return this.options.stateDirectory ?? path.join(this.options.root, 'production', 'fanqie');
  }
  private browserDirectory() {
    return this.options.browserDirectory ?? path.join(this.options.root, 'browser-sessions', 'fanqie');
  }
  async close() {
    await this.context?.close();
  }
  private assertCurrent(generation: number) {
    if (!this.options.available()) throw Error('PRODUCTION_REQUIRED');
    if (this.options.generation() !== generation) throw Error('WORKSPACE_CHANGED');
  }
  mark(step: string, error: string | null = null, location?: {page?: number; row: number}) {
    this.progress = step; this.lastError = error;
    const folder = this.options.stateDirectory &&
      this.options.stateDirectory !== path.join(this.options.root, 'production', 'fanqie')
      ? path.join(this.stateDirectory(), 'diagnostics') : path.join(this.options.root, 'diagnostics');
    fs.mkdirSync(folder, {recursive: true});
    // No page text, URLs, account IDs, file paths or credentials in diagnostics.
    fs.writeFileSync(path.join(folder, 'fanqie-operation.json'), JSON.stringify({at: new Date().toISOString(), step, error, ...location}));
  }
  private profile(){
    try{return ProfileSchema.parse(JSON.parse(fs.readFileSync(path.join(this.stateDirectory(),'profile.json'),'utf8')));}catch{return null;}
  }
  status() {
    const profile = this.profile();
    return {
      connected: !!this.context, savedProfile: fs.existsSync(this.browserDirectory()),
      profileVerified: !!this.context && !!profile && this.verifiedAccountKey === profile.accountKey && !this.lastError,
      busy: this.busy, report: this.report ?? null, profile,
      progress: this.progress, lastError: this.lastError, uploadAvailable: false as const,
    };
  }
  loginState(): Promise<AccountLoginState> {
    const context = this.context;
    if (!context) return Promise.resolve('unknown');
    const generation = this.options.generation();
    const pages = context.pages().filter(page => !page.isClosed() && page.url().startsWith(fanqieOrigin + '/'));
    const source = pages.find(page => !isOfficialSignInRoute(page.url(), fanqieOrigin));
    if (!source && pages.length) {
      this.loginCheck = undefined;
      return Promise.resolve('expired');
    }
    if (this.loginCheck?.context === context && this.loginCheck.generation === generation && this.loginCheck.until > Date.now())
      return this.loginCheck.result;
    if (!source || this.busy) return Promise.resolve('unknown');
    const guard = () => {
      this.assertCurrent(generation);
      if (this.context !== context) throw Error('FANQIE_BROWSER_CONNECTION_REQUIRED');
    };
    const check = (): Promise<AccountLoginState> => withFanqieReadFrame(source, guard, async page => {
      const response = await page.goto(accountPage, {waitUntil:'domcontentloaded',timeout:8_000});
      guard();
      if (isOfficialSignInRoute(page.url(), fanqieOrigin) || (response?.status() === 401 && page.url().startsWith(fanqieOrigin + '/')))
        return 'expired';
      if (!this.options.account) {
        const signIn = fanqieSignInForm(page);
        const uid = page.getByText('UID', {exact:true}).filter({visible:true});
        // The site may redirect after DOMContentLoaded or render login in place.
        await uid.or(signIn).first().waitFor({state:'visible',timeout:8_000}).catch(error => {
          if (!(error instanceof Error) || error.name !== 'TimeoutError') throw error;
        });
        guard();
        if (isOfficialSignInRoute(page.url(), fanqieOrigin) ||
            (page.url().startsWith(fanqieOrigin + '/') && await signIn.count())) return 'expired';
        if (!await uid.count()) return 'unknown';
      }
      const { accountId } = await (this.options.account ?? (tab => readFanqieAccountUid(readPage(tab))))(page);
      guard();
      const saved = this.profile();
      const key = createHash('sha256').update('fanqie:' + accountId).digest('hex');
      return /^[1-9]\d{4,24}$/.test(accountId) && (!saved || saved.accountKey === key) ? 'valid' : 'unknown';
    });
    const result = check().catch((): AccountLoginState => 'unknown').then(state => {
      if (this.loginCheck?.result === result)
        this.loginCheck.until = Date.now() + (state === 'valid' ? 30_000 : 5_000);
      return state;
    });
    this.loginCheck = { context, generation, until: Infinity, result };
    return result;
  }
  async verifyRestoredAccount(){
    return this.run(async(context,guard)=>{
      const observed=await this.observeAccount(context,guard,async()=>null,{inPlace:true});
      if(observed.accountKey!==this.profile()?.accountKey)throw Error('FANQIE_ACCOUNT_IDENTITY_MISMATCH');
      this.verifiedAccountKey=observed.accountKey;
      this.mark('登录已核对');
      return this.status();
    });
  }
  async run<T>(action: (context: BrowserContext, guard: () => void) => Promise<T>): Promise<T> {
    const generation = this.options.generation(); this.assertCurrent(generation);
    if (this.busy) throw Error('FANQIE_BROWSER_BUSY');
    const context = this.context; if (!context) throw Error('FANQIE_BROWSER_CONNECTION_REQUIRED');
    this.busy = true;
    const guard = () => {this.assertCurrent(generation); if (this.context !== context) throw Error('FANQIE_BROWSER_CONNECTION_REQUIRED');};
    try {return await action(context, guard);}
    catch (error) {
      const location=error instanceof FanqieCatalogRowError ? {page:error.page,row:error.row} : undefined;
      this.mark('操作未完成', fanqieCatalogError(error).code, location);
      throw error;
    }
    finally {this.busy = false;}
  }
  async withArtistCreationPage<T>(action: (scope: FanqieArtistPage) => Promise<T>) {
    const opened = !this.context;
    if (opened) await this.ui('open');
    return this.run(async (context, guard) => {
      const pages = context.pages().filter(page => !page.isClosed());
      const page = opened && pages.length === 1 ? pages[0] : await context.newPage();
      const verifyAccount = async () => {
        const observed = await withFanqieReadFrame(page, guard,
          frame => this.observeAccountDocument(frame, page, guard, async () => null));
        return observed.accountKey;
      };
      return action({
        page, guard, verifyAccount, stateDirectory: this.stateDirectory(), mark: step => this.mark(step),
        close: async () => {
          if (page.isClosed()) return;
          if (opened && context.pages().filter(tab => !tab.isClosed()).every(tab => tab === page)) await context.close();
          else await page.close();
        },
      });
    });
  }
  private async observeAccount<T>(
    context: BrowserContext,
    guard: () => void,
    read: (document: AccountDocument, go: (url: string) => Promise<void>, page: Page, accountKey: string) => Promise<T>,
    options:ObserveAccountOptions = {},
  ) {
    const {trace,inPlace=false,verifyAfterRead=true}=options;
    this.verifiedAccountKey = undefined;
    this.mark('正在读取番茄账号'); guard();
    if (inPlace) {
      const page = fanqieAccountTab(context);
      return withFanqieReadFrame(page, guard, frame => this.observeAccountDocument(frame, page, guard, read, trace, verifyAfterRead));
    }
    const primary = context.pages().find(page => !page.isClosed());
    if (!primary) throw Error('FANQIE_BROWSER_CONNECTION_REQUIRED');
    const page = await openBackgroundOfficialPage(primary);
    try {
      return await this.observeAccountDocument(page, page, guard, read, trace, verifyAfterRead);
    } finally { await page.close().catch(() => {}); }
  }
  private async observeAccountDocument<T>(
    document: AccountDocument,
    page: Page,
    guard: () => void,
    read: (document: AccountDocument, go: (url: string) => Promise<void>, page: Page, accountKey: string) => Promise<T>,
    trace?: FanqieDirectoryTracePort,
    verifyAfterRead = true,
  ) {
    const releaseTrace=trace?.watch(page);
    let checkpoint='catalog:account';
    const go = async (url: string) => {
      guard();
      checkpoint=url.endsWith('/ugc')?'catalog:existing':url.endsWith('/artist')?'catalog:artists':'catalog:account';
      await trace?.trace(checkpoint,'begin',page);
      await document.goto(url, {waitUntil: 'domcontentloaded', timeout: 20000});
      guard();
    };
    const readAccount = this.options.account ?? (p => readFanqieAccountUid(readPage(p)));
    try {
      await go(accountPage);
      const { accountId } = await readAccount(document); guard();
      if (!/^[1-9]\d{4,24}$/.test(accountId)) throw Error('FANQIE_ACCOUNT_ID_UNVERIFIED');
      const accountKey = createHash('sha256').update('fanqie:' + accountId).digest('hex');
      await trace?.trace('catalog:account','ok',page,undefined,undefined,{accountIdentityChecks:1});
      const value = await read(document, go, page, accountKey); guard();
      if (verifyAfterRead) {
        await go(accountPage);
        const after = await readAccount(document); guard();
        if (accountId !== after.accountId) throw Error('FANQIE_CATALOG_SCOPE_CHANGED');
      }
      this.options.verifyAccount?.(accountKey);
      if (verifyAfterRead) await trace?.trace('catalog:account','ok',page,undefined,undefined,{accountIdentityChecks:2});
      return { value, accountId, accountKey, maskedAccount: '***' + accountId.slice(-4) };
    } catch(error) {
      await trace?.trace(checkpoint,'error',page,undefined,error);
      throw error;
    } finally {releaseTrace?.();}
  }
  private async readArtists(page: AccountDocument, go: (url: string) => Promise<void>) {
    this.mark('正在核对署名');
    await go(fanqieArtistUrl);
    return (await (this.options.artists ?? (p => readFanqieArtists(readPage(p))))(page)).artists;
  }
  async resolveDirectorySingers(context: BrowserContext, guard: () => void, expectedAccountKey: string,
    names: readonly string[], trace?: FanqieDirectoryTracePort): Promise<ReadonlyMap<string, FanqieDirectorySinger>> {
    const keys = new Set(names.map(fanqieRosterNameKey));
    if (!keys.size) return new Map();
    // The upload form independently rechecks the bound account before any write.
    // Avoid a redundant trailing profile read after the read-only artist lookup.
    const { value, accountKey } = await this.observeAccount(context, guard, async (_document, go, page, before) => {
      if (before !== expectedAccountKey) throw Error('FANQIE_CATALOG_SCOPE_CHANGED');
      this.options.verifyAccount?.(before);
      this.mark('正在核对本批歌手');
      await go(fanqieArtistUrl);
      const found = new Map<string, FanqieDirectorySinger>();
      for (const key of keys) {
        guard();
        found.set(key, key ? await searchFanqieDirectorySinger(page, key, guard) : {issue: 'FANQIE_ARTIST_SEARCH_UNVERIFIED'});
      }
      await trace?.trace('catalog:artists','ok',page);
      return found;
    }, {trace, verifyAfterRead:false});
    guard();
    if (accountKey !== expectedAccountKey) throw Error('FANQIE_CATALOG_SCOPE_CHANGED');
    this.verifiedAccountKey = accountKey;
    return value;
  }
  private saveProfile(input: z.input<typeof ProfileSchema>) {
    const profile = ProfileSchema.parse(input);
    const folder = this.stateDirectory();
    fs.mkdirSync(folder, {recursive: true});
    const file = path.join(folder, 'profile.json');
    fs.writeFileSync(file + '.tmp', JSON.stringify(profile, null, 2));
    fs.renameSync(file + '.tmp', file);
  }
  async inspect(context: BrowserContext, guard: () => void, withArtists = false, trace?:FanqieDirectoryTracePort,
    queries?: readonly FanqieCatalogQuery[]) {
    if (!queries) this.report = undefined;
    const { value: { catalog, artists }, accountId, accountKey, maskedAccount } = await this.observeAccount(context, guard, async (document, go, page) => {
      let catalog: FanqieCatalog;
      if (queries) {
        this.mark('正在核对本批作品');
        await trace?.trace('catalog:batch-lookup','begin',page);
        try {
          catalog = await readFanqieDirectoryCatalog(document,guard,queries);
        } catch(error) {
          await trace?.trace('catalog:batch-lookup','error',page,undefined,error);
          throw error;
        }
        await trace?.trace('catalog:batch-lookup','ok',page);
      } else {
        this.mark('正在读取已有作品');
        await go('https://www.novelfm.com/creator/music/finished/ugc');
        catalog = await (this.options.catalog ?? (p => readFanqieCatalogPages(p,guard)))(page);
        await trace?.trace('catalog:existing','ok',page);
      }
      if (catalog.source !== 'browser') throw Error('FANQIE_CATALOG_SOURCE_REQUIRED');
      if(trace&&(!catalog.complete||catalog.rows.length!==catalog.total))throw Error('FANQIE_CATALOG_INCOMPLETE');
      const artists=withArtists?await this.readArtists(document,go):[];
      if(withArtists)await trace?.trace('catalog:artists','ok',page);
      return { catalog, artists };
    },{trace,inPlace:queries!==undefined,
      // Initial/submit preflight lookups are followed by another account check at the form;
      // receipt reads keep the post-read identity check.
      verifyAfterRead:!queries || queries.some(query=>query.waitForReceipt)});
    guard();
    const report = {...catalog, accountKey, maskedAccount};
    const folder = this.stateDirectory(); fs.mkdirSync(folder, {recursive: true});
    if (!queries) {
      const temp = path.join(folder, 'catalog.json.tmp'), target = path.join(folder, 'catalog.json');
      fs.writeFileSync(temp, JSON.stringify(report, null, 2)); fs.renameSync(temp, target);
      this.report = report;
    } else if (this.report && this.report.accountKey !== accountKey) this.report = undefined;
    if (withArtists) this.saveProfile({accountKey, maskedAccount, observedAt:report.observedAt, artists});
    else {
      const old = this.profile();
      if (old && old.accountKey !== accountKey) fs.unlinkSync(path.join(folder, 'profile.json'));
    }
    this.verifiedAccountKey = accountKey;
    this.mark(queries ? '本批作品核对完成' : '作品读取完成');
    return {accountId, catalog, report, artists};
  }
  async ui(action: unknown, input: unknown = {}, trace?:FanqieDirectoryTracePort) {
    const name = actions.parse(action); empty.parse(input);
    const generation = this.options.generation(); this.assertCurrent(generation);
    if (name === 'status') return this.status();
    if(name==='syncProfile'){
      if(!this.context)await this.ui('open');
      return this.run(async (context, guard) => {
        const { value: artists, accountKey, maskedAccount } = await this.observeAccount(
          context, guard, (page, go) => this.readArtists(page, go),
        );
        guard();
        if (this.report?.accountKey !== accountKey) this.report = undefined;
        this.saveProfile({accountKey, maskedAccount, artists, observedAt: new Date().toISOString()});
        this.verifiedAccountKey = accountKey;
        this.loginCheck = undefined;
        this.mark('官网资料已同步');
        return {...this.status(), busy:false};
      });
    }
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
        const profile = this.browserDirectory();
        fs.mkdirSync(profile, {recursive: true});
        const context = await (this.options.launch ?? launchAccountBrowser)(profile);
        this.context = context;
        this.mark('浏览器已连接，正在打开番茄');
        context.setDefaultTimeout(15000); context.setDefaultNavigationTimeout(20000);
        context.on('close', () => {
          if (this.context === context) {
            this.context = undefined;
            this.report = undefined;
            this.verifiedAccountKey = undefined;
            this.loginCheck = undefined;
          }
        });
        this.assertCurrent(generation);
        const page = context.pages().find(p => !p.isClosed()) ?? await context.newPage();
        // A new session starts at Home. Never navigate an existing upload or contract editor.
        const unwatch=trace?.watch(page);
        try {
          await trace?.trace('browser:home','begin',page);
          if (page.url() === 'about:blank') await page.goto('https://www.novelfm.com/creator/music/home', {waitUntil: 'domcontentloaded', timeout: 20000});
          await trace?.trace('browser:home','ok',page);
        } catch(error) {
          await trace?.trace('browser:home','error',page,undefined,error);
          throw error;
        } finally {unwatch?.();}
        this.mark('工作窗口已连接');
        this.assertCurrent(generation); return {...this.status(), busy: false};
      }
    } catch (error) {this.mark('连接未完成', fanqieCatalogError(error).code); throw error;}
    finally {this.busy = false;}
  }
}

export function fanqieCatalogError(error: unknown) {
  const browserCode=fanqieBrowserFailureCode(error);
  const code = browserCode!=='FANQIE_BROWSER_OPERATION_FAILED' ? browserCode : error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'FANQIE_BROWSER_OPERATION_FAILED';
  const messages: Record<string, string> = {
    FANQIE_CHROME_NOT_FOUND: '未找到已安装的 Google Chrome，请检查浏览器安装位置。',
    FANQIE_BATCH_SCOPE_CHANGED: '账号或批次选择已变化，已停止操作，请重新核对。',
    FANQIE_AUTHORIZATION_RECONCILIATION_REQUIRED: '已有待确认合同，请先在官网完成或核对签约，再更新状态；不会重新上传。',
    FANQIE_AUTHORIZATION_WORK_MISMATCH: '授权页作品与当前任务不一致，已停止操作。',
    FANQIE_AUTHORIZATION_PICKER_MISMATCH: '官网待授权列表未能匹配本批作品，请刷新官网记录后继续。',
    FANQIE_AUTHORIZATION_IDENTITY_REQUIRED: '请在官网完成个人签约身份认证。',
    FANQIE_AUTHORIZATION_MODE_UNVERIFIED: '官网签约模式未能核对，请检查授权页面。',
    FANQIE_AUTHORIZATION_PLATFORM_UNVERIFIED: '官网发行平台未能核对，已保留当前页面。',
    FANQIE_AUTHORIZATION_INCOMPLETE: '官网授权信息尚未完整，已保留页面供核对。',
    PRODUCTION_REQUIRED: '请切换到真实作品库。',
    FANQIE_CONFIGURATION_REQUIRED: '请先在配置中心保存番茄音乐的署名和发布规则。',
    FANQIE_AI_DISCLOSURE_REQUIRED: '请先在作品资料中设置 AI 标注。',
    FANQIE_MUSIC_TYPE_UNSUPPORTED: '此番茄上传流程暂只支持原创作品，请核对作品类型。',
    FANQIE_INSTRUMENTAL_FORM_UNVERIFIED: '未能核对官网纯音乐选项，请在专属窗口检查表单。',
    FANQIE_CONFIGURATION_CHANGED: '批次署名或签约设置已变化，请核对已上传作品。',
    WORKSPACE_CHANGED: '作品库已切换，请重新读取。',
    FANQIE_BROWSER_CONNECTION_REQUIRED: '请先打开番茄工作窗口并登录。',
    BROWSER_BACKGROUND_PAGE_REQUIRED: '未能打开番茄核对页面，请重新打开番茄工作窗口。',
    FANQIE_BROWSER_BUSY: '番茄窗口仍在处理中，请稍候。',
    FANQIE_CONTROL_AMBIGUOUS: '页面出现多个同名控件，已停止操作并保留页面。',
    FANQIE_RELEASE_ENTRY_AMBIGUOUS: '首页发布入口不唯一，已停止操作并保留页面。',
    FANQIE_BROWSER_TIMEOUT: '番茄页面读取超时，请核对登录状态后重试读取。',
    FANQIE_BROWSER_PAGE_CLOSED: '番茄工作页面已关闭，自动化已暂停。请重新打开工作窗口，并核对执行日志和官网回执后再继续。',
    FANQIE_IDENTITY_PAGE_REQUIRED: '请在番茄工作窗口完成登录后重试。',
    FANQIE_ACCOUNT_ID_UNVERIFIED: '未读到番茄账号，请核对登录状态。',
    FANQIE_CATALOG_FILTERED: '未读到完整作品列表，请重新读取。',
    FANQIE_CATALOG_WORK_TITLE_UNVERIFIED: '官网作品列表中有一行读不到唯一的歌名，已暂停上传查重。',
    FANQIE_CATALOG_WORK_ID_UNVERIFIED: '官网作品列表中有一行读不到有效作品 ID，已暂停上传查重。',
    FANQIE_CATALOG_DUPLICATE_ID: '官网作品列表出现重复 ID，已暂停上传查重。',
    FANQIE_CATALOG_STATUS_UNVERIFIED: '所选作品的官网状态待核对，已暂停签约或回执确认。',
    FANQIE_LYRICS_CONTENT_REJECTED: '番茄提示这首歌的歌词内容不符合规范；执行日志已记录歌名和序号。请用修订后的真实歌词替换歌词附件，再重新核对。',
    FANQIE_LYRICS_CONTENT_REJECTED_UNMAPPED: '番茄提示歌词内容不符合规范，但未能唯一匹配歌曲，已暂停上传；请查看执行日志和番茄页面。',
    FANQIE_SUBMISSION_REJECTION_UNMAPPED: '番茄提示作品信息提交失败，但歌名无法唯一匹配到本批歌曲；已暂停并保留页面，请查看执行日志。',
    FANQIE_SUBMISSION_REJECTION_RETRIES_EXHAUSTED: '番茄连续拒绝了多首作品，自动剔除和复核已达到 7 次上限；已暂停并保留页面，请人工检查剩余歌曲。',
    FANQIE_ALL_SONGS_REJECTED: '本批歌曲都被番茄拒绝，未进入签约或归档；已回收拒绝歌曲的本地音频、歌词和封面。',
    FANQIE_SUBMISSION_VALIDATION_REJECTED: '番茄拒绝了这首作品；对应的本地音频、歌词和封面已移入系统回收站。',
    FANQIE_REJECTED_MATERIALS_CLEANUP_FAILED: '番茄已拒绝这首作品，但本地素材未能全部安全移入回收站；批次已暂停，请查看执行日志后处理。',
    FANQIE_CATALOG_SCOPE_CHANGED: '番茄账号发生变化，请重新读取。',
    FANQIE_ACCOUNT_IDENTITY_MISMATCH: '当前登录与已绑定账号不一致，请在专属窗口登录原账号。',
    FANQIE_ACCOUNT_ALREADY_BOUND: '该番茄账号已在其他本地账号中绑定，请使用原账号。',
    ACCOUNT_PROVIDER_MISMATCH: '所选账号不属于这个平台。',
    ACCOUNT_NOT_FOUND: '该平台账号已删除或不存在。',
    ARTIST_ACCOUNT_MISMATCH: '该艺人已经不属于所选番茄账号，请刷新账号管理。',
    REVISION_CONFLICT: '艺人或图片配置已更新，请重新确认后执行。',
    FANQIE_ARTIST_SCOPE_CHANGED: '艺人资料或所选图像模型配置已变化，请重新确认。',
    FANQIE_ARTIST_LOGIN_REQUIRED: '请在本次打开的番茄窗口登录，再点「艺人创建」。',
    FANQIE_ARTIST_ROSTER_UNAVAILABLE: '未能打开番茄「艺人信息」或加载搜索框，请核对当前窗口后重试。',
    FANQIE_ARTIST_NAME_REQUIRED: '请在艺人信息中填写歌手名称。',
    FANQIE_ARTIST_SEARCH_UNVERIFIED: '未能核对番茄的艺人搜索结果，请检查登录和网络后重试。',
    FANQIE_ARTIST_AVATAR_RESOLUTION: '番茄艺人头像至少为 1024 × 1024，请在艺人信息中调整封面分辨率。',
    FANQIE_ARTIST_AVATAR_VOICE_REQUIRED: '请在艺人信息里设置男或女，以匹配头像。',
    CREDENTIAL_NOT_CONFIGURED: '请在配置中心保存所选图像模型提供商的 API Key。',
    FANQIE_ARTIST_AVATAR_UPLOAD: '番茄未确认头像上传，请核对建档窗口。',
    FANQIE_ARTIST_FORM_CHANGED: '未能核对艺人名称、头像和全部角色，请检查番茄艺人窗口。',
    FANQIE_ARTIST_CREATE_REJECTED: '番茄拒绝添加艺人，请查看官网表单提示。',
    FANQIE_ARTIST_CREATE_UNCONFIRMED: '艺人提交结果待核对，请查看番茄艺人列表。',
    ACCOUNT_DIRECTORY_LINK: '账号存储目录无效。',
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
    FANQIE_ARTIST_CREDITS_REQUIRED: '同批含多个音乐人，请先保存每位音乐人的发行署名。',
    FANQIE_ARTIST_NAME_AMBIGUOUS: '合作艺人中存在多个同名记录，请先在官网核对。',
    FANQIE_OFFICIAL_RECORD_ALREADY_EXISTS: '官网已有同名作品，已阻止重复上传。',
    FANQIE_CATALOG_INCOMPLETE: '作品列表未读全，暂不能排除重复。',
    FANQIE_ASSET_CHANGED: '材料已变化，请重新选择并检查。',
    FANQIE_UPLOAD_AUTHORIZATION_REQUIRED: '本次上传检查已失效，请重新检查材料。',
    FANQIE_RECONCILIATION_REQUIRED: '这份音频已有上传操作，请先核对原页面和官网记录。',
    FANQIE_EXISTING_FORM_REQUIRES_RECONCILIATION: '番茄仍开着上传表单，请先核对该表单。',
    FANQIE_UPLOAD_READBACK_TIMEOUT: '上传回显等待超时。已保留原页面，请核对结果，勿重新上传。',
    FANQIE_SAVED_WORK_READBACK_REQUIRED: '尚未找到唯一的新作品记录，请保留原页面核对，勿重复上传。',
  };
  const location=error instanceof FanqieCatalogRowError && error.page ? `（第 ${error.page} 页第 ${error.row} 行）` : '';
  const fallback = /^(?:IMAGE_|CREDENTIAL_|SECURE_STORAGE_|HTTP_TIMEOUT$|HTTP_REQUEST_FAILED$)/u.test(code) ? platformImageFailure(code).message :
    '番茄记录读取未完成，请核对工作窗口的登录状态和网络。';
  return {code, message: (messages[code] ?? fanqieDownloadIssues[code] ?? fallback)+location};
}
