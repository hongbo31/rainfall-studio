import fs from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import { inspectQishuiSession } from "./qishui-session";
import { inspectPuleSession } from "./pule-session";
import { puleLoginUrl, puleOrigin, type PuleSessionState } from "../shared/pule-browser";
import {qishuiOrigin} from '../shared/qishui';
import { sunoCnOrigin } from "../shared/platform-directory";
import {
  PlatformAccountIdSchema,
  AccountWorkWindowSchema,
  AccountProviderSchema,
  type AccountLoginState,
  type PlatformAccount,
} from "../shared/platform-accounts";
import { fanqieChromeLaunchOptions } from "./fanqie/chrome-executable";
import { windowsChromiumExecutable } from "../shared/host-executable-paths";
import { capturePuleTaskLogin, openIsolatedPuleTaskWindow, TaskMusicWindows,
  type LaunchTaskMusicWindow, type TaskMusicWindowScope } from "./task-music-windows";

export function scopedDirectory(root: string, ...parts: string[]) {
  let directory = root;
  for (const part of parts) {
    directory = path.join(directory, part);
    if (fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink())
      throw Error("ACCOUNT_DIRECTORY_LINK");
  }
  return directory;
}

export function accountBrowserDirectory(root: string, accountId: string) {
  PlatformAccountIdSchema.parse({ accountId });
  return scopedDirectory(root, "browser-sessions", "accounts", accountId);
}

export function isOfficialSignInRoute(url: string, officialUrl: string) {
  const page = new URL(url);
  return page.origin === new URL(officialUrl).origin && /(?:^|\/)(?:login|signin|sign-in)(?:\/|$)/iu.test(page.pathname);
}

function installedBrowser() {
  const executablePath = process.platform === "win32"
    ? windowsChromiumExecutable("chrome") ?? windowsChromiumExecutable("msedge")
    : undefined;
  return executablePath ? { executablePath } : fanqieChromeLaunchOptions();
}

export function launchAccountBrowser(profile: string, provider?: PlatformAccount["provider"], headless = false) {
  fs.mkdirSync(profile, { recursive: true });
  const pule = provider === "yourmusic";
  return chromium.launchPersistentContext(profile, {
    ...installedBrowser(),
    headless,
    chromiumSandbox: true,
    acceptDownloads: pule || provider === "suno_cn",
    viewport: null,
    ...(pule ? { locale: "zh-CN" } : {}),
    timeout: 30_000,
  });
}

const launchTaskMusicWindow: LaunchTaskMusicWindow = async (provider, storageState) => {
  const browser = await chromium.launch({ ...installedBrowser(), headless: false, chromiumSandbox: true, timeout: 30_000 });
  try {
    const context = await browser.newContext({ storageState, acceptDownloads: true, viewport: null,
      ...(provider === "yourmusic" ? { locale: "zh-CN" } : {}) });
    return { context, close: () => browser.close() };
  } catch (error) {
    await browser.close().catch(() => undefined);
    throw error;
  }
};

async function openSunoProfileWindow(context: BrowserContext) {
  const anchor = context.pages().find(page => !page.isClosed());
  if (!anchor) return context.newPage();
  const marker = "about:blank#rainfall-suno-" + randomUUID();
  const browser = await context.newCDPSession(anchor);
  try {
    const [page] = await Promise.all([
      context.waitForEvent("page", { predicate: opened => opened.url() === marker, timeout: 5_000 }),
      browser.send("Target.createTarget", { url: marker, newWindow: true }),
    ]);
    return page;
  } finally {
    await browser.detach().catch(() => undefined);
  }
}

async function puleTabs(context?: BrowserContext) {
  const pages = context?.pages().filter(page => !page.isClosed() && page.url().startsWith(puleOrigin + "/")) ?? [];
  return Promise.all(pages.map(async page => ({ page, state: await inspectPuleSession(page) })));
}

/** Browser-owned storage stays in the account directory, outside the library and backups. */
export class PlatformBrowserSessions {
  private readonly contexts = new Map<string, Promise<BrowserContext>>();
  private readonly regularMusicTasks = new Set<string>();
  private readonly puleLoginPages = new WeakSet<Page>();
  private readonly sunoTaskPages = new WeakSet<Page>();
  private readonly taskWindows: TaskMusicWindows;
  private readonly loginReads = new Map<string, ReturnType<typeof capturePuleTaskLogin>>();

  constructor(private readonly root: string, private readonly launch = launchAccountBrowser,
    launchTask: LaunchTaskMusicWindow = launchTaskMusicWindow) {
    this.taskWindows = new TaskMusicWindows(async (scope, signal) => scope.provider === "suno_cn"
      ? this.openSunoTaskWindow(scope.accountId, signal)
      : openIsolatedPuleTaskWindow(launchTask, signal, await this.puleTaskLogin(scope.accountId)));
  }

  private async openSunoTaskWindow(accountId: string, signal: AbortSignal) {
    const alreadyOpen = this.contexts.has(accountId);
    const context = await this.openContext(accountId, "suno_cn");
    signal.throwIfAborted();
    const initial = alreadyOpen ? undefined : context.pages().find(page => !page.isClosed() && page.url() === "about:blank");
    // Suno's login refresh must be saved in the account's browser profile across executions.
    const page = initial ?? await openSunoProfileWindow(context);
    this.sunoTaskPages.add(page);
    return { page, close: () => page.close() };
  }

  private async puleTaskLogin(accountId: string) {
    const pendingRead = this.loginReads.get(accountId);
    if (pendingRead) return pendingRead;
    const canonical = this.contexts.get(accountId);
    const profile = accountBrowserDirectory(this.root, accountId);
    if (!canonical && !fs.existsSync(profile)) return;
    const read = (async () => {
      const source = await (canonical ?? this.launch(profile, "yourmusic", true));
      try {
        if (!canonical) {
          const page = source.pages()[0] ?? await source.newPage();
          await page.goto(puleOrigin, { waitUntil: "domcontentloaded", timeout: 8_000 }).catch(() => undefined);
        }
        return await capturePuleTaskLogin(source);
      } finally {
        if (!canonical) await source.close().catch(() => undefined);
      }
    })();
    this.loginReads.set(accountId, read);
    try { return await read; }
    finally { this.loginReads.delete(accountId); }
  }

  async withTaskMusicPage<T>(scope: TaskMusicWindowScope, signal: AbortSignal, run: (page: Page) => Promise<T>) {
    if (this.regularMusicTasks.has(scope.accountId)) throw Error("PULE_ACCOUNT_BUSY");
    return this.taskWindows.withPage(scope, signal, run);
  }

  closeTaskWindow(runId: string) { return this.taskWindows.closeWindow(runId); }

  closeTaskWindows() { return this.taskWindows.close(); }

  workWindow(account:PlatformAccount,artistId?:string,save=false){
    const file=path.join(scopedDirectory(this.root,'runtime','work-windows'),account.id+'.json');
    const schema=AccountWorkWindowSchema.extend({provider:AccountProviderSchema});
    if(!save){
      if(!fs.existsSync(file))return null;
      try{
        const parsed=schema.safeParse(JSON.parse(fs.readFileSync(file,'utf8')));
        return parsed.success&&parsed.data.accountId===account.id&&parsed.data.provider===account.provider?parsed.data:null;
      }catch{return null;}
    }
    const scope=schema.parse({accountId:account.id,provider:account.provider,artistId});
    fs.mkdirSync(path.dirname(file),{recursive:true});
    const temporary=file+'.'+randomUUID()+'.tmp';
    fs.writeFileSync(temporary,JSON.stringify(scope),{flag:'wx'});
    fs.renameSync(temporary,file);
    return scope;
  }

  status(accountId: string) {
    return {
      opened: this.contexts.has(accountId),
      savedProfile: fs.existsSync(
        accountBrowserDirectory(this.root, accountId),
      ),
    };
  }

  async webStatus(accountId: string, officialUrl: string) {
    const context = await this.contexts.get(accountId);
    const loginRequired = context?.pages().some(page => !page.isClosed() && isOfficialSignInRoute(page.url(), officialUrl));
    const loginState: AccountLoginState = loginRequired ? "expired" : "unknown";
    return { ...this.status(accountId), loginState };
  }

  async qishuiStatus(accountId: string) {
    const status = this.status(accountId);
    const pending = this.contexts.get(accountId);
    const context = pending ? await pending : null;
    const page = context?.pages().find(tab => !tab.isClosed() && tab.url().startsWith(qishuiOrigin+'/'));
    return { ...status, qishuiState: page ? await inspectQishuiSession(page) : "closed" as const };
  }

  async puleStatus(accountId: string) {
    const tabs = await puleTabs(await this.contexts.get(accountId));
    const status = this.status(accountId);
    if (!status.opened) return { ...status, puleState: "closed" as const };
    const puleState: PuleSessionState = tabs.find(tab => tab.state === "signed_in")?.state
      ?? tabs.find(tab => tab.state === "login_required")?.state
      ?? "unverified";
    return { ...status, puleState };
  }

  async qishuiPage(accountId:string):Promise<Page>{
    const context=await this.contexts.get(accountId);
    const pages=context?.pages().filter(p=>!p.isClosed()&&p.url().startsWith(qishuiOrigin+'/'))??[];
    if(pages.length!==1)throw Error(pages.length?'QISHUI_MULTIPLE_TABS':'QISHUI_WINDOW_REQUIRED');
    return pages[0];
  }

  async closeAccount(accountId:string){
    const pending=this.contexts.get(accountId);
    if(pending)await(await pending).close();
  }

  private openContext(accountId: string, provider: PlatformAccount["provider"]) {
    const existing = this.contexts.get(accountId);
    if (existing) return existing;
    const profile = accountBrowserDirectory(this.root, accountId);
    const loginRead = this.loginReads.get(accountId);
    const started = (loginRead ? loginRead.catch(() => undefined).then(() => this.launch(profile, provider)) : this.launch(profile, provider))
      .then(context => {
        context.on("close", () => {
          if (this.contexts.get(accountId) === started) this.contexts.delete(accountId);
        });
        return context;
      })
      .catch(error => {
        if (this.contexts.get(accountId) === started) this.contexts.delete(accountId);
        throw error;
      });
    this.contexts.set(accountId, started);
    return started;
  }

  async open(account: PlatformAccount, url: string, guard: () => void,artistId?:string) {
    guard();
    if (this.regularMusicTasks.has(account.id)) throw Error("PULE_ACCOUNT_BUSY");
    const context = await this.openContext(account.id, account.provider);
    guard();
    const origin = new URL(url).origin + "/";
    const puleLogin = account.provider === "yourmusic" && url === puleLoginUrl;
    const pages = context.pages().filter(tab => !tab.isClosed() && !this.sunoTaskPages.has(tab));
    const existing =
      pages.find((tab) => (tab.url().startsWith(origin) ||
        account.provider === "suno_cn" && tab.url().startsWith(sunoCnOrigin + "/")) &&
        (!puleLogin || tab.url() === url || this.puleLoginPages.has(tab))) ??
      pages.find(tab => tab.url() === "about:blank");
    const page = existing ??
      (account.provider === "suno_cn" && context.pages().some(tab => this.sunoTaskPages.has(tab))
        ? await openSunoProfileWindow(context) : await context.newPage());
    guard();
    if (!existing || page.url() === "about:blank")
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    guard();
    if (puleLogin) this.puleLoginPages.add(page);
    await page.bringToFront();
    return {
      ...this.status(account.id),
      workWindow: this.workWindow(account,artistId,true),
      ...(account.provider === "qishui" ? { qishuiState: await inspectQishuiSession(page) } : {}),
      ...(account.provider === "yourmusic" ? { puleState: await inspectPuleSession(page) } : {}),
    };
  }

  async withPulePage<T>(accountId: string, signal: AbortSignal, run: (page: Page) => Promise<T>) {
    if (this.regularMusicTasks.has(accountId) || this.taskWindows.usesAccount(accountId)) throw Error("PULE_ACCOUNT_BUSY");
    signal.throwIfAborted();
    const ownsWindow = !this.contexts.has(accountId);
    this.regularMusicTasks.add(accountId);
    let pending: Promise<BrowserContext> | undefined;
    let page: Page | undefined;
    const close = async () => {
      if (ownsWindow && pending) await (await pending).close();
      else if (page && !page.isClosed()) await page.close();
    };
    const abort = () => { void close().catch(() => undefined); };
    signal.addEventListener("abort", abort, { once: true });
    try {
      let context: BrowserContext;
      try {
        pending = this.openContext(accountId, "yourmusic");
        context = await pending;
      } catch {
        throw Error("PULE_BROWSER_UNAVAILABLE");
      }
      signal.throwIfAborted();
      if (!ownsWindow) {
        const signedIn = (await puleTabs(context)).find(tab => tab.state === "signed_in")?.page;
        signal.throwIfAborted();
        if (signedIn) {
          try {
            [page] = await Promise.all([
              signedIn.waitForEvent("popup", { timeout: 4_000 }),
              signedIn.evaluate(origin => {
                if (location.origin !== origin) return;
                // Chromium gives the new tab its own copy of the opener's session storage.
                const taskTab = window.open("about:blank", "_blank");
                if (taskTab) taskTab.opener = null;
              }, puleOrigin),
            ]);
          } catch {
            signal.throwIfAborted();
          }
        }
      }
      const blank = ownsWindow ? context.pages().find(tab => !tab.isClosed() && tab.url() === "about:blank") : undefined;
      page ??= blank ?? await context.newPage();
      signal.throwIfAborted();
      await page.bringToFront();
      signal.throwIfAborted();
      return await run(page);
    } finally {
      signal.removeEventListener("abort", abort);
      await close().catch(() => undefined);
      this.regularMusicTasks.delete(accountId);
    }
  }

  async withSunoCnPage<T>(accountId: string, signal: AbortSignal, run: (page: Page) => Promise<T>) {
    if (this.regularMusicTasks.has(accountId) || this.taskWindows.usesAccount(accountId)) throw Error("PULE_ACCOUNT_BUSY");
    signal.throwIfAborted();
    const ownsWindow = !this.contexts.has(accountId);
    this.regularMusicTasks.add(accountId);
    let context: BrowserContext | undefined;
    let page: Page | undefined;
    const close = () => ownsWindow ? context?.close() : page?.close();
    const abort = () => { void close()?.catch(() => undefined); };
    signal.addEventListener("abort", abort, { once: true });
    try {
      context = await this.openContext(accountId, "suno_cn").catch(() => { throw Error("SUNO_CN_BROWSER_UNAVAILABLE"); });
      signal.throwIfAborted();
      page = (ownsWindow ? context.pages().find(tab => tab.url() === "about:blank") : undefined) ?? await context.newPage();
      signal.throwIfAborted();
      return await run(page);
    } finally {
      signal.removeEventListener("abort", abort);
      await close()?.catch(() => undefined);
      this.regularMusicTasks.delete(accountId);
    }
  }

  async close() {
    await Promise.allSettled(
      [this.taskWindows.close(), ...[...this.contexts.values()].map(async (pending) => {
        await (await pending).close();
      })],
    );
  }
}
