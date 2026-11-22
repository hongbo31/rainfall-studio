import { setTimeout as delay } from "node:timers/promises";
import type { ElementHandle, Locator, Page } from "playwright-core";
import { platformPageUrls, sunoCnOrigin } from "../shared/platform-directory";
import type { PuleVersion } from "../shared/pule-browser";
import type { PulePageHooks, PulePageInput } from "./pule-browser-page";

const timeouts = { control: 15_000, generation: 20 * 60_000, download: 5 * 60_000, downloadStart: 30_000, poll: 750 };
const listSelector = ".create-list-panel";
const titleSelector = ".song-title";
const itemSelector = ".create-list-scroll > .song-item";
const moreSelector = '.icon-more, button[aria-label="更多操作"]';
const pendingSelector = /^\s*(?:进行中|排队中|生成中|正在生成)[.。…]*\s*$/u;
const createSelector = /^创作(?:\s*[·｜|（(].*)?$/u;
const wavMenuLabel = /^\s*下载\s*WAV\s*音频\s*$/iu;
const visible = (locator: Locator) => locator.filter({ visible: true });

async function keepWorkspaceInView(model: Locator) {
  await model.evaluate(element => {
    const shell = element.closest(".create-pc-workspace")?.closest(".main-shell");
    if (!(shell instanceof HTMLElement) || getComputedStyle(shell).overflow !== "hidden") return;
    // Chromium scrolls hidden overflow during a click. Only the inner form and song list should scroll.
    shell.scrollTo({ top: 0, left: 0, behavior: "instant" });
    shell.style.minHeight = "0";
    shell.style.minWidth = "0";
    shell.style.overflow = "clip";
  });
}

async function readyPair(page: Page, rows: Locator, baseline: ElementHandle[], title: string) {
  const candidates = await rows.elementHandles();
  const pair = candidates.slice(0, 2);
  let ready = false;
  try {
    if (pair.length !== 2) return;
    ready = await page.evaluate(({ pair, baseline, title, listSelector, itemSelector, titleSelector, moreSelector }) => {
      const current = document.querySelector(listSelector)?.querySelectorAll(itemSelector);
      return pair.every((row, index) => row instanceof Element && row === current?.[index] && !baseline.includes(row) &&
        row.querySelector(titleSelector)?.textContent?.trim() === title && !!row.querySelector(moreSelector));
    }, { pair, baseline, title, listSelector, itemSelector, titleSelector, moreSelector });
    if (ready) return pair;
  } finally {
    await Promise.all(candidates.slice(ready ? 2 : 0).map(row => row.dispose()));
  }
}

async function setWeight(slider: Locator, weight: number | undefined, timeout: number) {
  if (weight === undefined) return;
  await slider.waitFor({ state: "visible", timeout });
  const read = () => slider.evaluate(element => Number(element.getAttribute("aria-valuenow") ?? (element as HTMLInputElement).value));
  const target = Math.round(weight);
  // The site sliders use 0–1 values with a step of 0.01.
  const current = Math.round(await read() * 100);
  if (!Number.isFinite(current) || current < 0 || current > 100) throw Error("SUNO_CN_WEIGHT_UNAVAILABLE");
  for (let remaining = Math.abs(target - current); remaining > 0; remaining--) {
    await slider.press(target > current ? "ArrowRight" : "ArrowLeft", { timeout });
  }
  if (Math.round(await read() * 100) !== target) throw Error("SUNO_CN_WEIGHT_UNAVAILABLE");
}

export async function runSunoCnBrowser(page: Page, input: PulePageInput, hooks: PulePageHooks,
  options: Partial<typeof timeouts> & { versions?: readonly PuleVersion[] } = {}) {
  const { control, generation, download, downloadStart, poll } = { ...timeouts, ...options };
  const entry = new URL(platformPageUrls.suno_cn);
  const create = new URL(entry.pathname, sunoCnOrigin);
  const params = new URLSearchParams(entry.hash.split("?")[1]);
  params.set("model", "suno");
  create.hash = "/create?" + params;
  const guard = async () => {
    await hooks.guard();
    if (new URL(page.url()).origin !== sunoCnOrigin) throw Error("SUNO_CN_PAGE_CHANGED");
  };
  const click = async (locator: Locator) => {
    await guard();
    await visible(locator).click({ timeout: control });
  };
  const login = visible(page.getByRole("button", { name: "登录", exact: true }));
  const signedIn = async (restoring = false) => {
    if (restoring && await login.count()) {
      await login.first().waitFor({ state: "hidden", timeout: control }).catch(error => {
        if (!(error instanceof Error) || error.name !== "TimeoutError") throw error;
      });
      await guard();
    }
    if (await login.count()) throw Error("SUNO_CN_LOGIN_REQUIRED");
  };
  await hooks.guard();
  await page.goto(create.href, { waitUntil: "domcontentloaded", timeout: control });
  await guard();
  const model = page.locator(".create-model .current-model");
  hooks.step("form");
  const form = page.locator(".c-suno");
  const list = page.locator(listSelector);
  try {
    await visible(model).waitFor({ state: "visible", timeout: control });
    await guard();
    await keepWorkspaceInView(model);
    const promo = visible(page.getByRole("dialog", { name: "新人签到赠送", exact: true }));
    const dismiss = promo.getByRole("button", { name: "关闭此对话框", exact: true });
    if (await dismiss.count() === 1) await click(dismiss);
    await signedIn(true);
    if (!(await model.innerText()).includes("苏诺模型")) {
      await click(model);
      await click(page.locator(".model-dropdown-list").getByText("苏诺模型", { exact: true }));
    }
    await click(form.getByText("自定义模式", { exact: true }));
    const title = visible(form.getByPlaceholder("请输入歌曲名称", { exact: true }));
    const style = visible(form.locator(".custom-style-area textarea"));
    const pureMusic = form.locator('.custom-vocal-row [role="switch"]');
    await pureMusic.waitFor({ state: "attached", timeout: control });
    if ((await pureMusic.getAttribute("aria-checked")) !== String(input.instrumental))
      await click(form.locator(".custom-vocal-row .el-switch__core"));
    if ((await pureMusic.getAttribute("aria-checked")) !== String(input.instrumental)) throw Error("SUNO_CN_FORM_VALUE_CHANGED");
    await title.fill(input.title, { timeout: control });
    await style.fill(input.style, { timeout: control });
    const voice = input.gender === "female" ? "女声" : input.gender === "male" ? "男声" : "随机";
    const voiceOption = form.locator(".custom-vocal-segment").getByRole("button", { name: voice, exact: true });
    if (!input.instrumental) {
      const lyrics = visible(form.locator('[aria-labelledby="suno-custom-lyrics-heading"] textarea'));
      await lyrics.fill(input.lyrics, { timeout: control });
      await click(voiceOption);
      if (await lyrics.inputValue() !== input.lyrics.replace(/\r\n?/gu, "\n")) throw Error("SUNO_CN_FORM_VALUE_CHANGED");
    }
    if (input.timbre && !input.instrumental) {
      const advanced = form.locator('button[aria-controls="suno-custom-advanced-content"]');
      await advanced.waitFor({ state: "visible", timeout: control });
      if (await advanced.getAttribute("aria-expanded") !== "true") await click(advanced);
      const section = form.locator(".persona-select-section");
      await click(section.getByText("选择音色", { exact: true }));
      const dialog = visible(page.locator(".persona-list-content"));
      try {
        const names = visible(dialog.locator(".mine-list"));
        const sound = visible(names.getByText(input.timbre, { exact: true }));
        const next = visible(dialog.locator(".pagination-wrapper .btn-next"));
        await names.waitFor({ state: "visible", timeout: control });
        while (await sound.count() === 0 && await next.count() === 1 && await next.isEnabled()) {
          const previous = await names.innerText();
          await click(next);
          await page.waitForFunction(text => {
            const list = document.querySelector<HTMLElement>(".persona-list-content .mine-list");
            return !!list?.innerText && list.innerText !== text;
          }, previous, { timeout: control });
        }
        await click(sound);
      } catch (error) {
        await guard();
        throw Error("SUNO_CN_TIMBRE_UNAVAILABLE", { cause: error });
      }
      await dialog.waitFor({ state: "hidden", timeout: control });
      const weights = form.locator("#suno-custom-advanced-content");
      await setWeight(weights.locator(".audio-weight-section").getByRole("slider"), input.timbreWeight, control);
      await setWeight(weights.getByRole("slider", { name: "风格参考度", exact: true }), input.styleWeight, control);
    }
    if (await title.inputValue() !== input.title || await style.inputValue() !== input.style.replace(/\r\n?/gu, "\n") ||
        (!input.instrumental && !await voiceOption.evaluate(option => option.classList.contains("is-active")))) {
      throw Error("SUNO_CN_FORM_VALUE_CHANGED");
    }
  } catch (error) {
    await guard();
    if (error instanceof Error && error.message.startsWith("SUNO_CN_")) throw error;
    if (await visible(page.getByText(/请先登录|手机号登录|扫码登录/u)).count()) throw Error("SUNO_CN_LOGIN_REQUIRED");
    throw Error("SUNO_CN_CONTROL_UNAVAILABLE");
  }

  const rows = list.locator(itemSelector);
  const empty = list.getByText(/^\s*暂无作品[~～]?\s*$/u);
  const pending = visible(list.getByText(pendingSelector).and(list.locator(":not(.song-title)")));
  try {
    await visible(rows.first().locator(titleSelector).or(empty).or(pending)).first().waitFor({ state: "visible", timeout: control });
  } catch (error) {
    await guard();
    await signedIn();
    throw Error("SUNO_CN_LIST_UNAVAILABLE", { cause: error });
  }
  await hooks.beforeGeneration?.();
  await guard();
  if (await pending.count()) throw Error("SUNO_CN_EXISTING_GENERATION");
  const baseline = await rows.elementHandles();
  try {
    const previousTitle = await baseline[0]?.evaluate((row, selector) =>
      row instanceof Element ? row.querySelector(selector)?.textContent?.trim() : undefined, titleSelector);
    if (baseline.length && !previousTitle) throw Error("SUNO_CN_LIST_UNAVAILABLE");
    const submit = visible(form.getByRole("button", { name: createSelector }).and(form.locator(".suno-custom-create-action")));
    await submit.click({ trial: true, timeout: control }).catch(async error => {
      await guard();
      await signedIn();
      throw Error("SUNO_CN_SUBMIT_UNAVAILABLE", { cause: error });
    });
    await guard();
    await signedIn();
    if (await pending.count()) throw Error("SUNO_CN_EXISTING_GENERATION");
    hooks.step("generation");
    await hooks.beforeCharge("generation");
    await click(submit).catch(async error => {
      await guard();
      throw Error("SUNO_CN_SUBMIT_UNCONFIRMED", { cause: error });
    });

    const started = Date.now();
    const lyricChecks = [".lyrics-preflight-dialog", ".pronunciation-preview-dialog"]
      .map(selector => visible(page.locator(selector)).getByRole("button", { name: "提交原歌词", exact: true }));
    const approved = new Set<Locator>();
    let pair: ElementHandle[] | undefined;
    while (Date.now() - started < generation) {
      await guard();
      if (await visible(page.getByRole("dialog", { name: /^(积分不足|人声设定冲突)$/u })).count())
        throw Error("SUNO_CN_PROVIDER_REVIEW_REQUIRED");
      for (const original of lyricChecks) {
        if (!approved.has(original) && await visible(original).count() === 1) {
          approved.add(original);
          await click(original).catch(async error => {
            await guard();
            if (await visible(original).count()) throw Error("SUNO_CN_LYRICS_CONFIRM_UNAVAILABLE", { cause: error });
          });
        }
      }
      if (!await pending.count()) {
        pair = await readyPair(page, rows, baseline, input.title);
        if (pair) break;
      }
      await delay(poll);
    }
    if (!pair) throw Error("SUNO_CN_RESULT_UNCLEAR");
    try {
      if (input.title === previousTitle) throw Error("SUNO_CN_FIRST_TITLE_UNCHANGED");
      const titles = [input.title, input.alternateTitle ?? input.title];
      const ids = [input.requestId + ":A", input.requestId + ":B"];
      await hooks.identify(ids);

      const menuItem = async (row: ElementHandle, expected: string, heading: string,
        label: string | RegExp, failure: string) => {
        await guard();
        const matches = await row.evaluate((node, title) =>
          node instanceof Element && node.isConnected && node.querySelector(".song-title")?.textContent?.trim() === title, expected);
        if (!matches) throw Error("SUNO_CN_RESULT_UNCLEAR");
        const more = await row.$(moreSelector);
        if (!more) throw Error(failure);
        try {
          await more.click({ timeout: control });
          const menu = visible(page.locator(".menu_popover:not(.menu_popover_sub)")).getByText(heading, { exact: true });
          await visible(menu).hover({ timeout: control });
          await click(page.locator(".menu_popover_sub").getByText(label, { exact: true }));
        } catch (error) {
          await guard();
          throw Error(failure, { cause: error });
        } finally { await more.dispose(); }
      };
      if (titles[1] !== input.title) {
        hooks.step("rename");
        await menuItem(pair[1], input.title, "编辑管理", "修改歌曲名称", "SUNO_CN_RENAME_MENU_UNAVAILABLE");
        const rename = visible(page.locator('[role="dialog"], .el-dialog').filter({
          has: page.getByText("修改歌曲名称", { exact: true }),
        }));
        await rename.getByRole("textbox").fill(titles[1], { timeout: control });
        await click(rename.getByRole("button", { name: /^(确定|确认)$/u }));
        await page.waitForFunction(({ row, title }) =>
          row instanceof Element && row.isConnected && row.querySelector(".song-title")?.textContent?.trim() === title,
          { row: pair[1], title: titles[1] }, { timeout: control }).catch(() => { throw Error("SUNO_CN_RENAME_UNCONFIRMED"); });
      }

      const dialog = visible(page.locator(".download-dialog-body").filter({
        has: page.getByText("WAV 音频下载", { exact: true }),
      }));
      const wave = visible(dialog.locator(".download-dialog-ready").getByRole("button", { name: /^下载\s*WAV$/iu }));
      const timeoutNotice = visible(page.getByText(/^\s*获取\s*WAV\s*文件超时[，,]\s*请稍后重试\s*[。！!]?\s*$/iu));

      const prepareWave = async (row: ElementHandle, title: string, deadline: number) => {
        // The site checks the existing conversion when its download menu is reopened.
        for (let attempt = 0; attempt < 2; attempt++) {
          await guard();
          if (await dialog.count()) throw Error("SUNO_CN_WAV_PREPARE_FAILED");
          const priorNotices = await timeoutNotice.elementHandles();
          try {
            await menuItem(row, title, "下载导出", wavMenuLabel, "SUNO_CN_WAV_MENU_UNAVAILABLE");
            await dialog.waitFor({ state: "visible", timeout: control }).catch(async error => {
              await guard();
              throw Error("SUNO_CN_WAV_PREPARE_FAILED", { cause: error });
            });
            while (performance.now() < deadline) {
              await guard();
              if (await wave.count() === 1) return;
              if (!await dialog.count()) break;
              await delay(poll);
            }
            if (performance.now() >= deadline) throw Error("SUNO_CN_WAV_UNAVAILABLE");
            const retryable = await timeoutNotice.evaluateAll((notices, prior) =>
              notices.some(notice => !prior.includes(notice)), priorNotices);
            if (!retryable) throw Error("SUNO_CN_WAV_PREPARE_FAILED");
          } finally { await Promise.all(priorNotices.map(notice => notice.dispose())); }
        }
        throw Error("SUNO_CN_WAV_UNAVAILABLE");
      };

      for (const [index, version] of (["A", "B"] as const).entries()) {
        if (options.versions && !options.versions.includes(version)) continue;
        hooks.step("download");
        await prepareWave(pair[index], titles[index], performance.now() + download);
        const deadline = performance.now() + download;
        const receive = async (startWait: number) => {
          await guard();
          const remaining = Math.ceil(deadline - performance.now());
          if (remaining <= 0) throw Error("SUNO_CN_DOWNLOAD_NOT_STARTED");
          const [file] = await Promise.all([
            page.waitForEvent("download", { timeout: Math.min(remaining, startWait) }).catch(error => {
              if (error instanceof Error && error.name === "TimeoutError") throw Error("SUNO_CN_DOWNLOAD_NOT_STARTED", { cause: error });
              throw error;
            }),
            click(wave).catch(async error => {
              await guard();
              throw Error("SUNO_CN_WAV_CONFIRM_UNAVAILABLE", { cause: error });
            }),
          ]);
          return file;
        };
        const file = await receive(downloadStart).catch(async error => {
          if (!(error instanceof Error) || error.message !== "SUNO_CN_DOWNLOAD_NOT_STARTED" || performance.now() >= deadline) throw error;
          await guard();
          if (!await dialog.count()) await prepareWave(pair[index], titles[index], deadline);
          return receive(download);
        });
        hooks.step("receive");
        await hooks.saveWave(version, ids[index], file, titles[index]);
        await dialog.waitFor({ state: "hidden", timeout: control }).catch(async error => {
          await guard();
          throw Error("SUNO_CN_WAV_DIALOG_STILL_OPEN", { cause: error });
        });
      }
      hooks.step("cover");
      for (const [index, version] of (["A", "B"] as const).entries()) {
        if (!options.versions || options.versions.includes(version)) await hooks.generateCover(version, ids[index], titles[index]);
      }
    } finally { await Promise.all(pair.map(row => row.dispose())); }
  } finally { await Promise.all(baseline.map(row => row.dispose())); }
}
