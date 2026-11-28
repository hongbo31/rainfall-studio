import type { Download, ElementHandle, Locator, Page } from "playwright-core";
import {
  puleCreateUrl, puleDownloadRetryLimit, puleDownloadTimeoutMs, puleOrigin,
  type PuleCharge, type PuleScope, type PuleSessionState, type PuleStart, type PuleStep, type PuleVersion,
} from "../shared/pule-browser";
import type { PuleBrowserReceiptLookup, PuleBrowserReceiptMatch } from "../shared/plan-pule";
import { inspectPuleSession, puleSignInControl, puleSignInDialog } from "./pule-session";
import { repairPuleCreateDisplay } from "./pule-page-recovery";
import { preparePuleWave, receivePuleWave } from "./pule-wav-transfer";

export type PulePageInput = PuleStart & Pick<PuleScope, "gender" | "timbre" | "timbreWeight" | "styleWeight"> & { audioPath?: string };
type PuleDownloadPhase = { kind: "download"; songIds: readonly string[]; versions: readonly PuleVersion[]; includeCovers?: true };
export type PulePagePhase = { kind: "submit" } | PuleDownloadPhase;
type UseDownloadRetry = (version: PuleVersion) => boolean;

export type PulePageHooks = {
  guard: () => void | Promise<void>;
  validateAudio: () => void;
  step: (step: PuleStep) => void;
  approveCover: (credits: number) => Promise<void>;
  beforeCharge: (kind: PuleCharge, credits?: number, beforeSongIds?: string[]) => void | Promise<void>;
  beforeGeneration?: () => Promise<void>;
  identify: (ids: string[]) => void | Promise<void>;
  useDownloadRetry?: UseDownloadRetry;
  audioProgress?: (phase: "preparing" | "downloading", version: PuleVersion) => Promise<void>;
  saveWave: (version: PuleVersion, songId: string, download: Download, title: string, deadline?: number) => Promise<void>;
  generateCover: (version: PuleVersion, songId: string, title: string) => Promise<void>;
};
type Timeouts = {
  control: number;
  form: number;
  inputSettle: number;
  afterSubmit: number;
  afterWavClick: number;
  login: number;
  processing: number;
  generation: number;
  download: number;
  poll: number;
};
const productionTimeouts: Timeouts = {
  control: 15_000, form: 45_000, inputSettle: 600, afterSubmit: 8_000, afterWavClick: 2_000,
  login: 10 * 60_000, processing: 12 * 60_000, generation: 20 * 60_000, download: puleDownloadTimeoutMs, poll: 800,
};
const createPath = new URL(puleCreateUrl).pathname;
const useTimbre = "使用此音色";
const production = /^立即制作(?:\s*[（(]\s*\d+\s*积分\s*[）)]|\s*(?:[·•]\s*)?\d+\s*积分\s*\/\s*\d+\s*首)?$/u;
const productionButtonPath =
  'xpath=//*[@id="creation-area"]/div/div[2]/div/div[2]/div/button[starts-with(normalize-space(text()[1]),"立即制作")]';
const processing = /^开始处理(?:\s*[（(]\s*\d+\s*积分\s*[）)])?$/u;
const waveDownload = /^下载\s*WAV(?:\s*音频)?$/iu;
const more = /^更多(?:操作)?$/u;
const generating = /^生成中(?:[.…]+)?$/u;
const uploading = /^版权歌曲上传中(?:[.…]+)?$/u;
const retryableDownloadErrors = new Set(["PULE_DOWNLOAD_NOT_STARTED", "PULE_DOWNLOAD_TIMEOUT", "PULE_WAV_LINK_TIMEOUT",
  "PULE_WAV_LINK_FAILED", "PULE_WAV_TRANSFER_FAILED"]);
const coverFailureCode = /^PULE_COVER_(?:GENERATION_FAILED|GENERATION_UNCONFIRMED|HTTP_4\d\d|INVALID|SAVE_FAILED)$/u;

const visible = (locator: Locator) => locator.filter({ visible: true });
const songList = (page: Page) => page.locator("#music-list");
// Within a song li, the official title is div[1]/div[2]/div[1]/a and More is div[2]/button.
const songTitlePath = ":scope > div:nth-of-type(1) > div:nth-of-type(2) > div:nth-of-type(1) > a";
const songMorePath = ":scope > div:nth-of-type(2) > button";
type SongRow = { id: string | null; title: string };
type VerifiedSong = { id: string; title: string };

function inspectSongs({ rows, titlePath }: { rows: Node[]; titlePath: string }): SongRow[] {
  return rows.map(node => {
    const row = node instanceof Element && node.isConnected ? node : null;
    const link = row?.querySelector(titlePath);
    const title = link?.getClientRects().length && getComputedStyle(link).visibility !== "hidden"
      ? link.textContent?.trim() ?? "" : "";
    const href = link?.getAttribute("href") ?? "";
    const id = row?.getAttribute("data-song-id") ?? link?.getAttribute("data-song-id")
      ?? href.match(/\/musicPlay\/([^/?#]+)/u)?.[1];
    return { id: id && /^[a-z0-9_-]{1,150}$/iu.test(id) ? id : null, title };
  });
}

// Keep DOM row positions intact even when a row has no title or More control yet.
async function withSongRows<T>(page: Page, use: (songs: SongRow[], elements: ElementHandle[]) => T | Promise<T>) {
  const rows = await songList(page).locator("ul.w-full > li").elementHandles();
  try {
    const songs = await page.evaluate<SongRow[], { rows: ElementHandle[]; titlePath: string }>(
      inspectSongs, { rows, titlePath: songTitlePath },
    );
    return await use(songs, rows);
  } finally {
    await Promise.all(rows.map(row => row.dispose()));
  }
}
const readSongs = (page: Page) => withSongRows(page, songs => songs);

function findBrowserReceipt(rows: SongRow[], { title, beforeSongIds }: PuleBrowserReceiptMatch): PuleBrowserReceiptLookup {
  const anchor = beforeSongIds.length ? rows.findIndex(row => row.id === beforeSongIds[0]) : rows.length;
  if (anchor < 0) return { state: "unavailable" };
  const known = new Set(beforeSongIds);
  const newer = rows.slice(0, anchor);
  if (newer.some(row => row.id && known.has(row.id))) return { state: "unavailable" };
  const matches = newer.flatMap((row, index) => row.title === title ? [{ ...row, index }] : []);
  if (matches.length < 2) return { state: "not_found" };
  const [a, b] = matches;
  if (matches.length !== 2 || b.index !== a.index + 1) return { state: "ambiguous" };
  if (!a.id || !b.id) return { state: "not_found" };
  if (a.id === b.id || rows.filter(row => row.id === a.id || row.id === b.id).length !== 2)
    return { state: "ambiguous" };
  return { state: "found", songIds: [a.id, b.id] };
}

/** Read the creation history using the account session. This path never presses a generation control. */
export async function readPuleBrowserReceipt(page: Page, match: PuleBrowserReceiptMatch, guard: () => void,
  { timeout = 12_000, poll = 800 } = {}): Promise<PuleBrowserReceiptLookup> {
  guard();
  const deadline = performance.now() + timeout;
  await page.goto(puleCreateUrl, { waitUntil: "domcontentloaded", timeout });
  const results = songList(page);
  const tab = visible(page.getByRole("tab", { name: "自定义模式", exact: true }));
  const busy = visible(page.locator("span").filter({ hasText: generating }));
  let opened = false;
  let lastPair: [string, string] | undefined;
  let last: PuleBrowserReceiptLookup = { state: "unavailable" };
  do {
    guard();
    const state = await inspectPuleSession(page);
    if (state === "signed_in") {
      if (!opened && !await results.isVisible() && await tab.count() === 1) {
        guard();
        await tab.click({ timeout: Math.max(1, deadline - performance.now()) });
        opened = true;
      }
      if (await results.isVisible() && !await busy.count()) {
        const result = findBrowserReceipt(await readSongs(page), match);
        guard();
        if (new URL(page.url()).pathname !== createPath || await inspectPuleSession(page) !== "signed_in")
          return { state: "unavailable" };
        if (result.state === "found") {
          if (lastPair?.[0] === result.songIds[0] && lastPair[1] === result.songIds[1]) return result;
          lastPair = result.songIds;
          last = { state: "not_found" };
        } else {
          lastPair = undefined;
          last = result;
        }
      } else lastPair = undefined;
    } else {
      lastPair = undefined;
      last = { state: state === "login_required" ? "login_required" : "unavailable" };
    }
    await page.waitForTimeout(Math.max(0, Math.min(poll, deadline - performance.now())));
  } while (performance.now() < deadline);
  guard();
  return last;
}

const coverCredits = (text: string) => {
  const match = text.match(/(\d+)\s*积分/u)?.[1];
  const value = match === undefined ? NaN : Number(match);
  if (!Number.isSafeInteger(value) || value < 0) throw Error("PULE_PRICE_UNAVAILABLE");
  return value;
};

function downloadRetryBudget(): UseDownloadRetry {
  const retries = { A: 0, B: 0 };
  return version => {
    if (retries[version] >= puleDownloadRetryLimit) return false;
    retries[version]++;
    return true;
  };
}

export async function withPuleDownloadRetry(
  runPage: (phase: PulePagePhase | undefined, useDownloadRetry: UseDownloadRetry) => Promise<void>,
  firstPhase: PulePagePhase | undefined,
  pendingDownloads: () => PuleDownloadPhase | undefined, guard: PulePageHooks["guard"],
) {
  const useDownloadRetry = downloadRetryBudget();
  let phase = firstPhase;
  for (;;) {
    try {
      await runPage(phase, useDownloadRetry);
      return;
    } catch (error) {
      if (!(error instanceof Error) || !retryableDownloadErrors.has(error.message)) throw error;
      await guard();
      const pending = pendingDownloads();
      const failedVersion = pending?.versions[0];
      if (!failedVersion || !useDownloadRetry(failedVersion)) throw error;
      // Reopen with the saved song IDs after the old page and its late download events are gone.
      phase = pending;
    }
  }
}

export async function runPuleBrowser(page: Page, input: PulePageInput, hooks: PulePageHooks,
  timeouts: Partial<Timeouts> = {}, phase?: PulePagePhase) {
  const time = { ...productionTimeouts, ...timeouts };
  page.setDefaultTimeout(time.control);
  let currentStep: PuleStep = "opening";
  const step = (value: PuleStep) => {
    currentStep = value;
    hooks.step(value);
  };
  const unavailableControlCode = () => `PULE_${currentStep.toUpperCase()}_CONTROL_UNAVAILABLE`;
  const button = (name: string | RegExp, scope: Page | Locator = page) =>
    visible(scope.getByRole("button", { name, exact: typeof name === "string" }));
  const creationArea = page.locator("#creation-area");
  const results = songList(page);
  const dialogs = page.getByRole("dialog");
  const notices = page.locator("[role=alert], [role=status], [data-sonner-toast], [data-toast]").or(dialogs);
  const notice = (pattern: RegExp) => visible(notices.filter({ hasText: pattern }).or(notices.getByText(pattern)));
  const providerFailure = notice(/^(?:歌曲)?(?:生成失败|制作失败|版权歌曲上传失败|音频处理失败|上传失败)(?:[，。:：\s].*)?$/u);
  let preparingWav = false;
  const loginDialog = puleSignInDialog(page);
  const rewardDialog = visible(dialogs.filter({ has: button("登录领取积分") }));
  const atmosphereMvAdDialog = visible(dialogs.filter({
    has: page.getByRole("heading", { name: /氛围 MV 大升级/u }),
  }));
  const dismiss = async (popup: Locator, closeName: string | RegExp) => {
    if (!await popup.count()) return false;
    await hooks.guard();
    await button(closeName, popup).click({ timeout: time.control });
    await popup.waitFor({ state: "hidden", timeout: time.control });
    return true;
  };
  const sessionState = async () => {
    await hooks.guard();
    let state = await inspectPuleSession(page);
    if (state === "closed") throw Error("PULE_WINDOW_CLOSED");
    if (new URL(page.url()).origin !== puleOrigin) return state;
    await dismiss(atmosphereMvAdDialog, "关闭");
    if (await dismiss(rewardDialog, "关闭")) state = await inspectPuleSession(page);
    if (state === "signed_in" && await dismiss(loginDialog, /^(?:close|关闭)$/iu)) {
      await page.waitForTimeout(time.poll);
      await dismiss(rewardDialog, "关闭");
      state = await inspectPuleSession(page);
    }
    return state;
  };
  const openLogin = async () => {
    if (new URL(page.url()).origin !== puleOrigin || await loginDialog.count()) return;
    const menuToggle = puleSignInControl(page);
    const accountMenu = dialogs.filter({ has: page.getByRole("heading", { name: "个人中心", exact: true }) });
    const entry = button("登录", accountMenu);
    const timeout = Math.min(time.control, 2_000);
    try {
      if (!(await entry.count())) {
        if (await menuToggle.count() !== 1) return;
        await hooks.guard();
        await menuToggle.click({ timeout });
      }
      await hooks.guard();
      if (new URL(page.url()).origin === puleOrigin && !(await loginDialog.count())) await entry.click({ timeout });
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "TimeoutError") throw error;
    }
  };
  const openCreate = async () => {
    await page.goto(puleCreateUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await repairPuleCreateDisplay(page, hooks.guard);
  };
  const waitForCreate = async (tab: Locator) => {
    let deadline = Date.now() + time.form;
    let signingIn = false;
    let reopenedCreate = false;
    let state: PuleSessionState = "unverified";
    do {
      const current = await sessionState();
      if (current === "signed_in") {
        const tabCount = await tab.count();
        if (tabCount > 1) throw Error("PULE_CREATE_TAB_AMBIGUOUS");
        if (tabCount === 1) return;
        if (!reopenedCreate && new URL(page.url()).pathname !== createPath) {
          // The official site may send the user to another page after sign-in.
          reopenedCreate = true;
          await hooks.guard();
          await openCreate();
        }
      } else if (current === "login_required" && state === current && !signingIn) {
        signingIn = true;
        deadline = Date.now() + time.login;
        step("login");
        await openLogin();
      }
      state = current;
      await page.waitForTimeout(time.poll);
    } while (Date.now() < deadline);
    await hooks.guard();
    if (state === "signed_in") throw Error("PULE_CREATE_TAB_UNAVAILABLE");
    if (signingIn && state === "login_required") throw Error("PULE_LOGIN_TIMEOUT");
    throw Error("PULE_SESSION_UNVERIFIED");
  };

  const check = async () => {
    const deadline = Date.now() + time.control;
    let state = await sessionState();
    // A form update can briefly render the signed-out account control while the session refreshes.
    while (state !== "signed_in" && Date.now() < deadline) {
      await page.waitForTimeout(time.poll);
      state = await sessionState();
    }
    await hooks.guard();
    if (state === "login_required") throw Error("PULE_LOGIN_REQUIRED");
    if (state !== "signed_in") throw Error("PULE_SESSION_UNVERIFIED");
    if (await notice(/我已阅读.{0,20}(?:协议|条款)|请先同意.{0,15}(?:协议|条款)|同意并继续/u).count())
      throw Error("PULE_AGREEMENT_REQUIRED");
    if (await notice(/^(?:当前)?(?:积分不足|余额不足|剩余积分不足).{0,60}$/u).count())
      throw Error("PULE_INSUFFICIENT_CREDITS");
    // A failure inside the WAV dialog can be cleared by its own Retry button.
    const failures = preparingWav
      ? providerFailure.and(page.locator(':not(section[role="dialog"], section[role="dialog"] *)'))
      : providerFailure;
    if (await failures.count()) throw Error("PULE_PROVIDER_FAILED");
    await hooks.guard();
  };

  const until = async <T>(read: () => Promise<T | undefined>, timeout: number, code: string): Promise<T> => {
    const deadline = Date.now() + timeout;
    do {
      await check();
      const result = await read();
      if (result !== undefined) return result;
      await page.waitForTimeout(time.poll);
    } while (Date.now() < deadline);
    await check();
    throw Error(code);
  };

  const one = (locator: Locator, code = unavailableControlCode(), timeout = time.control) =>
    until(async () => {
      const count = await locator.count();
      if (count > 1) throw Error(code);
      return count === 1 ? locator : undefined;
    }, timeout, code);
  const click = async (locator: Locator, code?: string, timeout = time.control) => {
    const action = await one(locator, code, timeout);
    await hooks.guard();
    await action.click({ timeout });
  };
  const fill = async (locator: Locator, value: string, changedCode = "PULE_FORM_VALUE_CHANGED",
    unavailableCode = unavailableControlCode()) => {
    const field = await one(visible(locator), unavailableCode, time.form);
    const expected = value.replace(/\r\n?/gu, "\n");
    await hooks.guard();
    await field.fill(expected, { timeout: time.form });
    await page.waitForTimeout(time.inputSettle);
    await until(async () => await field.count() === 1 && await field.inputValue() === expected ? true : undefined,
      time.form, changedCode);
  };

  const submit = async (kind: PuleCharge, action: Locator, prepare: () => Promise<void | string[]>) => {
    const timeout = kind === "generation" ? time.form : time.control;
    const selected = await one(action, undefined, timeout);
    const credits = kind === "processing" ? coverCredits(await selected.innerText()) : undefined;
    if (credits !== undefined) await hooks.approveCover(credits);
    await check();
    const control = await selected.elementHandle({ timeout });
    try {
      await control.click({ trial: true, timeout });
      const beforeSongIds = await prepare();
      await check();
      if (credits !== undefined && coverCredits(await control.innerText()) !== credits)
        throw Error("PULE_PRICE_CHANGED");
      await hooks.guard();
      await hooks.beforeCharge(kind, credits, beforeSongIds || undefined);
      await control.click({ timeout });
    } finally {
      await control.dispose();
    }
  };

  // Open the selected account's task page, wait for the signed-in UI and enter custom mode.
  await hooks.guard();
  await openCreate();
  const customMode = visible(page.getByRole("tab", { name: "自定义模式", exact: true }));
  await waitForCreate(customMode);
  await click(customMode, "PULE_CREATE_TAB_UNAVAILABLE", time.form);
  const createSongs = async () => {
    // For covers, attach the selected file and bind the processed upload to its new cover control.
    if (input.mode === "cover") {
      if (!input.audioPath) throw Error("PULE_AUDIO_REQUIRED");
      hooks.validateAudio();
      step("upload");
      await click(button("上传音频"));
      await click(button(/版权歌曲上传/u, dialogs));
      const choose = await one(button("选择音频文件", dialogs));
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser", { timeout: time.control }),
        choose.click(),
      ]);
      await check();
      hooks.validateAudio();
      await chooser.setFiles(input.audioPath, { timeout: time.control });
      await click(button("保存", dialogs));
      const cover = button("翻唱此歌曲");
      let previousCovers: ElementHandle[] = [];
      step("processing");
      try {
        await submit("processing", button(processing), async () => { previousCovers = await cover.elementHandles(); });
        const readyCover = await until(async () => {
          if (await visible(page.getByText(uploading)).count()) return;
          const current = await cover.elementHandles();
          let result: ElementHandle | undefined;
          try {
            const fresh = await page.evaluate(({ previous, current }) => {
              if (!previous.every(button => current.includes(button))) return [];
              return current.flatMap((button, index) => previous.includes(button) ? [] : [index]);
            }, { previous: previousCovers, current });
            if (fresh.length > 1) throw Error("PULE_COVER_RESULT_UNCLEAR");
            result = current[fresh[0]];
            return result;
          } finally {
            await Promise.all(current.filter(button => button !== result).map(button => button.dispose()));
          }
        }, time.processing, "PULE_COVER_RESULT_UNCLEAR");
        try {
          await check();
          await readyCover.click({ timeout: time.control });
        } finally {
          await readyCover.dispose();
        }
      } finally {
        await Promise.all(previousCovers.map(button => button.dispose()));
      }
    }

    // Set instrumental mode or the configured voice, then verify the form retained each input.
    step("form");
    const instrumental = await one(visible(page.getByRole("switch", { name: "纯音乐", exact: true })),
      "PULE_INSTRUMENTAL_CONTROL_UNAVAILABLE");
    if (await instrumental.isChecked() !== input.instrumental) {
      await hooks.guard();
      await instrumental.press("Space");
      if (await instrumental.isChecked() !== input.instrumental) throw Error("PULE_FORM_VALUE_CHANGED");
    }
    if (!input.instrumental && input.timbre) {
      await click(button("选择音色"));
      const palette = dialogs.filter({ has: page.getByRole("button", { name: useTimbre, exact: true }) });
      const voice = visible(palette.getByRole("option").filter({
        has: page.getByRole("heading", { name: input.timbre, exact: true }),
      }));
      await click(voice, "PULE_TIMBRE_UNAVAILABLE");
      await until(async () => await voice.getAttribute("aria-selected") === "true" ? true : undefined,
        time.control, "PULE_TIMBRE_UNAVAILABLE");
      await click(button(useTimbre, palette));
      const applied = visible(page.locator("main").getByRole("heading", { name: input.timbre, exact: true }));
      await until(async () => !(await visible(palette).count()) && await applied.count() ? true : undefined,
        time.control, "PULE_TIMBRE_UNAVAILABLE");
    }
    const title = creationArea.getByRole("textbox", { name: "标题", exact: true })
      .or(creationArea.getByPlaceholder(/^输入歌曲标题(?:（必填）)?$/u));
    await fill(title, input.title, "PULE_FORM_VALUE_CHANGED", "PULE_TITLE_CONTROL_UNAVAILABLE");
    if (!input.instrumental) await fill(creationArea.getByPlaceholder("输入您自己的歌词", { exact: true }), input.lyrics,
      "PULE_FORM_VALUE_CHANGED", "PULE_LYRICS_CONTROL_UNAVAILABLE");
    await fill(creationArea.getByPlaceholder(/^例如：流行摇滚/u), input.style,
      "PULE_FORM_VALUE_CHANGED", "PULE_STYLE_CONTROL_UNAVAILABLE");
    if (!input.instrumental) {
      const gender = input.gender === "female" ? "女声" : input.gender === "male" ? "男声" : "不限";
      const genderButton = button(gender, creationArea);
      const controls = button(/^(?:不限|男声|女声)$/u, creationArea);
      const toggles = controls.and(page.locator("[aria-pressed='true'], [aria-pressed='false']"));
      const selected = controls.and(page.locator("[aria-pressed='true'], .bg-secondary:not([aria-pressed])"));
      // The current form represents unrestricted vocals by leaving both voice buttons off.
      const clearSelection = await until(async () => {
        const count = await genderButton.count();
        if (count > 1) throw Error("PULE_FORM_CONTROL_AMBIGUOUS");
        if (count === 1) return false;
        if (gender === "不限" && await toggles.count() === 2) return true;
      }, time.form, "PULE_FORM_CONTROL_UNAVAILABLE");
      const matches = async () => clearSelection
        ? await toggles.count() === 2 && await selected.count() === 0
        : await selected.count() === 1 && await selected.and(genderButton).count() === 1;
      if (!await matches()) {
        await click(clearSelection ? selected : genderButton, undefined, time.form);
        await page.waitForTimeout(time.inputSettle);
      }
      await until(async () => await matches() ? true : undefined, time.form, "PULE_FORM_VALUE_CHANGED");
    }

    const makeAtPath = visible(page.locator(productionButtonPath));
    const makeInForm = button(production, creationArea);
    const makeSong = await until(async () => {
      if (await makeAtPath.count() === 1) return makeAtPath;
      if (await makeInForm.count() === 1) return makeInForm;
    }, time.form, "PULE_GENERATION_CONTROL_UNAVAILABLE");

    const emptyList = visible(results.getByText(/^(?:在左侧开始你的第一首歌|暂无(?:歌曲|音乐))$/u));
    const before = new Set<string>();
    let previousFirstTitle: string | undefined;
    let planBeforeSongIds: string[] | undefined;
    // Capture the first displayed title and existing song IDs immediately before submission.
    step("generation");
    await hooks.beforeGeneration?.();
    await submit("generation", makeSong, async () => {
      const snapshot = await until(async () => {
        const current = await readSongs(page);
        const first = current[0];
        if ((first?.title && (phase?.kind !== "submit" || first.id)) ||
            (!current.length && await emptyList.count())) return current;
      }, time.form, "PULE_RESULT_BASELINE_UNAVAILABLE");
      previousFirstTitle = snapshot[0]?.title;
      for (const row of snapshot) if (row.id) before.add(row.id);
      if (phase?.kind === "submit") return planBeforeSongIds = [...before].slice(0, 250);
    });

    // Confirm the official two-song prompt once, then wait eight seconds from the final submit action.
    const twoSongPrompt = visible(dialogs.or(page.getByRole("alertdialog")).filter({
      has: page.getByText(/^每次生成模型都会同时生成两首歌曲以供选择[。.]?$/u),
    }));
    let promptConfirmed = false;
    let resultsNotBefore = performance.now() + time.afterSubmit;
    const busy = visible(page.locator("span").filter({ hasText: generating }));
    return until(async (): Promise<[VerifiedSong, VerifiedSong] | undefined> => {
      if (await twoSongPrompt.count()) {
        if (!promptConfirmed) {
          await click(button(/^(?:确定|确认)$/u, twoSongPrompt));
          promptConfirmed = true;
          resultsNotBefore = performance.now() + time.afterSubmit;
        }
        return;
      }
      if (performance.now() < resultsNotBefore || await busy.count()) return;
      const rows = await readSongs(page);
      if (planBeforeSongIds) {
        if (await busy.count()) return;
        const receipt = findBrowserReceipt(rows, { title: input.title, beforeSongIds: planBeforeSongIds });
        if (receipt.state === "ambiguous") throw Error("PULE_RESULT_UNCLEAR");
        if (receipt.state === "found") return [
          { id: receipt.songIds[0], title: input.title }, { id: receipt.songIds[1], title: input.title },
        ];
        return;
      }
      const [firstRow, secondRow] = rows;
      if (!firstRow?.id || !secondRow?.id ||
          firstRow.title !== input.title || secondRow.title !== input.title ||
          before.has(firstRow.id) || before.has(secondRow.id)) return;
      if (await busy.count()) return;
      // Require the first displayed title to change before allowing any menu action.
      if (firstRow.title === previousFirstTitle) throw Error("PULE_FIRST_TITLE_UNCHANGED");
      const newMatches = rows.filter(row => row.title === input.title && row.id && !before.has(row.id));
      if (firstRow.id === secondRow.id || newMatches.length !== 2) throw Error("PULE_RESULT_UNCLEAR");
      return [{ id: firstRow.id, title: firstRow.title }, { id: secondRow.id, title: secondRow.title }];
    }, time.generation + time.afterSubmit, "PULE_RESULT_UNCLEAR");
  };

  type Take = [PuleVersion, VerifiedSong];
  const readKnownSongs = ({ songIds, versions }: PuleDownloadPhase) => until(async (): Promise<Take[] | undefined> => {
    const rows = await readSongs(page);
    const takes: Take[] = [];
    for (const version of (["A", "B"] as const).filter(version => versions.includes(version))) {
      const songId = songIds[version === "A" ? 0 : 1];
      const matches = rows.filter(row => row.id === songId);
      if (matches.length > 1) throw Error("PULE_RESULT_UNCLEAR");
      const song = matches[0];
      if (!song?.id) return;
      if (song.title !== input.title && (version !== "B" || song.title !== input.alternateTitle))
        throw Error("PULE_SAVED_SONG_TITLE_CHANGED");
      takes.push([version, { id: song.id, title: song.title }]);
    }
    return takes;
  }, time.form, "PULE_SAVED_SONGS_UNAVAILABLE");

  let takes: Take[];
  if (phase?.kind === "download") {
    takes = await readKnownSongs(phase);
  } else {
    const [first, second] = await createSongs();
    await hooks.identify([first.id, second.id]);
    if (phase?.kind === "submit") return;
    takes = [["A", first], ["B", second]];
  }

  const renameAction = visible(page.getByText("修改歌名", { exact: true }).and(page.locator("span")));
  const wavAction = visible(page.getByText(waveDownload));
  const menuActions = renameAction.or(wavAction);
  const openSongAction = async (song: VerifiedSong, action: Locator, code: string) => {
    if (await menuActions.count()) throw Error(code);
    // Use the verified song ID to find More again if the list moved since generation.
    await until(() => withSongRows(page, async (songs, elements) => {
      const matches = songs.flatMap((row, index) => row.id === song.id ? [index] : []);
      if (matches.length > 1) throw Error("PULE_RESULT_UNCLEAR");
      const [index] = matches;
      if (index === undefined || songs[index].title !== song.title) return;
      const control = await elements[index].$(songMorePath);
      if (!control) return;
      try {
        const label = await control.getAttribute("aria-label");
        if (!more.test(label?.trim() ?? "") && !more.test((await control.innerText()).trim())) return;
        await hooks.guard();
        await control.click({ timeout: time.control });
        return true;
      } finally {
        await control.dispose();
      }
    }), time.control, "PULE_RESULT_UNCLEAR");
    return one(action, code);
  };
  const closeOverlay = async (overlay: Locator, code: string, close?: Locator) => {
    if (!await overlay.count()) return;
    await check();
    const controls = close ? await close.elementHandles() : [];
    try {
      await hooks.guard();
      // The download overlay can dismiss itself while its close button is still fading out.
      if (controls.length === 1) await controls[0].click({ timeout: time.control });
      else if (await overlay.count()) await page.keyboard.press("Escape");
    } catch (error) {
      await check();
      if (await overlay.count()) throw Error(code, { cause: error });
    } finally {
      await Promise.all(controls.map(control => control.dispose()));
    }
    await until(async () => !(await overlay.count()) ? true : undefined, time.control, code);
  };

  const takeB = takes.find(([version]) => version === "B");
  if (takeB && input.alternateTitle && input.alternateTitle !== takeB[1].title) {
    const second = takeB[1];
    // Scroll the second song's menu to Rename, then confirm the same song shows the saved title.
    step("rename");
    const rename = await openSongAction(second, renameAction, "PULE_RENAME_UNAVAILABLE");
    await rename.scrollIntoViewIfNeeded({ timeout: time.control });
    await click(rename, "PULE_RENAME_UNAVAILABLE");
    const editor = visible(dialogs.filter({ has: page.getByText("修改歌名", { exact: true }) })
      .filter({ has: page.getByRole("button", { name: "保存", exact: true }) }));
    const newName = await one(visible(editor.getByRole("textbox")), "PULE_RENAME_UNAVAILABLE", time.form);
    await until(async () => (await newName.inputValue()).trim() === second.title ? true : undefined,
      time.form, "PULE_RENAME_UNAVAILABLE");
    await fill(newName, input.alternateTitle, "PULE_RENAME_UNCONFIRMED");
    await click(button("保存", editor), "PULE_RENAME_UNAVAILABLE", time.form);
    takeB[1] = await until(async () => {
      if (await editor.count()) return;
      const matches = (await readSongs(page)).filter(row => row.id === second.id);
      if (matches.length === 1 && matches[0].title === input.alternateTitle) return { id: second.id, title: matches[0].title };
    }, time.form, "PULE_RENAME_UNCONFIRMED");
    await closeOverlay(menuActions, "PULE_RENAME_UNCONFIRMED");
  }

  const downloadButton = page.locator("button").filter({ hasText: "下载文件" });
  const retryButton = page.locator("button").filter({ hasText: "重试" });
  const downloadDialog = visible(page.locator('section[role="dialog"]').filter({ has: downloadButton.or(retryButton) }));
  const fileAction = visible(downloadDialog.locator(downloadButton));
  const retryAction = visible(downloadDialog.locator(retryButton));
  const downloadClose = button(/^(?:关闭|close)$/iu, downloadDialog);

  const useDownloadRetry = hooks.useDownloadRetry ?? downloadRetryBudget();
  const prepareDownload = async (selected: Locator, version: PuleVersion) => {
    const code = "PULE_DOWNLOAD_CONFIRM_UNAVAILABLE";
    const startAttempt = async (action: Locator) => {
      await hooks.guard();
      const deadline = performance.now() + time.download;
      await action.click({ timeout: Math.min(time.control, time.download) });
      return { deadline, checkAfter: performance.now() + time.afterWavClick };
    };
    preparingWav = true;
    try {
      let attempt = await startAttempt(selected);
      for (;;) {
        await check();
        const now = performance.now();
        if (now >= attempt.deadline) return;
        if (now >= attempt.checkAfter) {
          const retries = await retryAction.count();
          if (retries > 1) throw Error(code);
          if (retries === 1) {
            if (!useDownloadRetry(version)) throw Error("PULE_DOWNLOAD_RETRIES_EXHAUSTED");
            attempt = await startAttempt(retryAction);
            continue;
          }
          const files = await fileAction.count();
          if (files > 1) throw Error(code);
          if (files === 1) return { confirm: fileAction, deadline: attempt.deadline };
        }
        await page.waitForTimeout(Math.min(time.poll, attempt.deadline - now));
      }
    } finally {
      preparingWav = false;
    }
  };

  let coverFailure: Error | undefined;
  const downloadOwners = new Map<string, string>();
  for (const [index, [version, song]] of takes.entries()) {
    step("download");
    await hooks.audioProgress?.("preparing", version);
    if (await downloadDialog.count()) throw Error("PULE_DOWNLOAD_CONFIRM_UNAVAILABLE");
    const selected = await openSongAction(song, wavAction, "PULE_DOWNLOAD_UNAVAILABLE");
    const { control: { confirm, deadline }, preparedSongId } = await preparePuleWave(page, () => prepareDownload(selected, version));
    if (preparedSongId) {
      const owner = downloadOwners.get(preparedSongId);
      const filename = visible(downloadDialog.getByText(`${song.title}.wav`, { exact: true }));
      if ((owner && owner !== song.id) || await filename.count() !== 1) throw Error("PULE_WAV_IDENTITY_UNCONFIRMED");
      downloadOwners.set(preparedSongId, song.id);
    }
    await hooks.guard();
    await hooks.audioProgress?.("downloading", version);
    await receivePuleWave(page, {
      songId: song.id, preparedSongId, deadline, poll: time.poll,
      guard: hooks.guard, receiving: () => step("receive"),
      click: remaining => confirm.click({ timeout: Math.min(time.control, remaining) }).catch(error => {
        if (error instanceof Error && error.name === "TimeoutError")
          throw Error(performance.now() >= deadline ? "PULE_DOWNLOAD_TIMEOUT" : "PULE_DOWNLOAD_CONFIRM_UNAVAILABLE");
        throw error;
      }),
      save: download => hooks.saveWave(version, song.id, download, song.title, deadline),
    }).catch(async error => {
      await hooks.guard();
      throw error;
    });
    if (phase?.kind !== "download" || phase.includeCovers) {
      step("cover");
      try {
        await hooks.generateCover(version, song.id, song.title);
      } catch (error) {
        if (!(error instanceof Error) || !coverFailureCode.test(error.message)) throw error;
        // Keep downloading the other paid recording if one cover alone failed.
        coverFailure ??= error;
      }
    }
    if (index + 1 < takes.length) {
      await closeOverlay(downloadDialog, "PULE_DOWNLOAD_CONFIRM_UNAVAILABLE", downloadClose);
      await closeOverlay(menuActions, "PULE_DOWNLOAD_UNAVAILABLE");
    }
  }
  if (coverFailure) throw coverFailure;
  // The account session closes this task page after the requested files are saved.
}
