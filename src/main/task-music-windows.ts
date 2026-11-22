import type { BrowserContext, Page } from "playwright-core";
import { z } from "zod";
import { puleOrigin } from "../shared/pule-browser";
import { inspectPuleSession } from "./pule-session";

const scopeSchema = z.strictObject({ runId: z.uuid(), accountId: z.uuid(), provider: z.enum(["yourmusic", "suno_cn"]) });
export type TaskMusicWindowScope = z.infer<typeof scopeSchema>;
export type MusicWindowProvider = TaskMusicWindowScope["provider"];
export type BrowserLoginState = Awaited<ReturnType<BrowserContext["storageState"]>>;
type TaskLogin = { storageState: BrowserLoginState; sessionStorage: [string, string][] };
export type LaunchTaskMusicWindow = (provider: MusicWindowProvider, state?: BrowserLoginState) =>
  Promise<{ context: BrowserContext; close: () => Promise<void> }>;
type TaskWindow = { page: Page; close: () => Promise<void> };
type Opening = {
  scope: TaskMusicWindowScope;
  window: Promise<TaskWindow>;
  busy: boolean;
  idle?: ReturnType<typeof setTimeout>;
};

export async function capturePuleTaskLogin(context: BrowserContext): Promise<TaskLogin> {
  const host = new URL(puleOrigin).hostname;
  const state = await context.storageState({ indexedDB: true });
  const scopedCookies = state.cookies.filter(cookie => {
    const domain = cookie.domain.replace(/^\./u, "");
    return host === domain || cookie.domain.startsWith(".") && host.endsWith("." + domain);
  });
  const pages = context.pages().filter(page => !page.isClosed() && page.url().startsWith(puleOrigin + "/"));
  const states = await Promise.all(pages.map(inspectPuleSession));
  const tab = pages[states.indexOf("signed_in")] ?? pages[0];
  const sessionStorage = tab ? await tab.evaluate(expected => location.origin === expected
    ? Object.entries(window.sessionStorage) : [], puleOrigin).catch(() => []) : [];
  return { storageState: { cookies: scopedCookies, origins: state.origins.filter(row => row.origin === puleOrigin) }, sessionStorage };
}

export async function openIsolatedPuleTaskWindow(launch: LaunchTaskMusicWindow, signal: AbortSignal, login?: TaskLogin): Promise<TaskWindow> {
  signal.throwIfAborted();
  const opened = await launch("yourmusic", login?.storageState);
  try {
    signal.throwIfAborted();
    const page = await opened.context.newPage();
    if (login?.sessionStorage.length) {
      await page.addInitScript(({ origin, values }) => {
        if (window !== window.top || location.origin !== origin) return;
        const restored = "__rainfall_task_session_restored__";
        if (sessionStorage.getItem(restored)) return;
        for (const [key, value] of values) if (sessionStorage.getItem(key) === null) sessionStorage.setItem(key, value);
        sessionStorage.setItem(restored, "1");
      }, { origin: puleOrigin, values: login.sessionStorage });
    }
    return { page, close: () => opened.close() };
  } catch (error) {
    await opened.close().catch(() => undefined);
    throw error;
  }
}

/** Each plan execution owns one window and can close it independently. */
export class TaskMusicWindows {
  private readonly windows = new Map<string, Opening>();
  constructor(private readonly open: (scope: TaskMusicWindowScope, signal: AbortSignal) => Promise<TaskWindow>) {}

  usesAccount(id: string) {
    return [...this.windows.values()].some(entry => entry.scope.accountId === id);
  }

  private async launchWindow(scope: TaskMusicWindowScope, signal: AbortSignal, isCurrent: () => boolean): Promise<TaskWindow> {
    const check = () => {
      signal.throwIfAborted();
      if (!isCurrent()) throw Error("STOP_REQUESTED");
    };
    check();
    const opened = await this.open(scope, signal).catch(error => {
      check();
      throw Error("WORKFLOW_MUSIC_WINDOW_UNAVAILABLE", { cause: error });
    });
    try {
      check();
      opened.page.once("close", () => {
        if (isCurrent()) void this.closeWindow(scope.runId).catch(() => undefined);
      });
      return opened;
    } catch (error) {
      await opened.close().catch(() => undefined);
      throw error;
    }
  }

  async withPage<T>(input: TaskMusicWindowScope, signal: AbortSignal, run: (page: Page) => Promise<T>) {
    const scope = scopeSchema.parse(input);
    signal.throwIfAborted();
    let owner = this.windows.get(scope.runId);
    if (owner && (owner.scope.accountId !== scope.accountId || owner.scope.provider !== scope.provider))
      throw Error("WORKFLOW_MUSIC_WINDOW_SCOPE_CHANGED");
    if (owner?.busy) throw Error("WORKFLOW_MUSIC_WINDOW_BUSY");
    if (!owner) {
      const current = () => this.windows.get(scope.runId) === owner;
      owner = { scope, window: this.launchWindow(scope, signal, current), busy: false };
      this.windows.set(scope.runId, owner);
    }
    const entry = owner;
    clearTimeout(entry.idle);
    entry.busy = true;
    const abort = () => { void this.closeWindow(scope.runId).catch(() => undefined); };
    signal.addEventListener("abort", abort, { once: true });
    try {
      const { page } = await entry.window;
      signal.throwIfAborted();
      if (this.windows.get(scope.runId) !== entry || page.isClosed()) throw Error("WORKFLOW_MUSIC_WINDOW_CLOSED");
      return await run(page);
    } catch (error) {
      if (this.windows.get(scope.runId) === entry) await this.closeWindow(scope.runId).catch(() => undefined);
      throw error;
    } finally {
      signal.removeEventListener("abort", abort);
      entry.busy = false;
      if (this.windows.get(scope.runId) === entry)
        entry.idle = setTimeout(() => void this.closeWindow(scope.runId).catch(() => undefined), 60_000).unref();
    }
  }

  async closeWindow(runId: string) {
    const entry = this.windows.get(runId);
    if (!entry) return;
    this.windows.delete(runId);
    clearTimeout(entry.idle);
    const window = await entry.window.catch(() => undefined);
    await window?.close();
  }

  async close() {
    await Promise.allSettled([...this.windows.keys()].map(id => this.closeWindow(id)));
  }
}
