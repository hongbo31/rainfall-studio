import type { Page } from "playwright-core";
import { puleOrigin } from "../shared/pule-browser";

type Guard = () => void | Promise<void>;

function puleCreatePageUsable() {
  const area = document.querySelector("#creation-area");
  const visible = (element: Element | undefined | null) => {
    if (!element || element.getAttribute("aria-hidden") === "true") return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  };
  const customModeVisible = [...document.querySelectorAll('[role="tab"]')].some(element =>
    element.textContent?.trim() === "自定义模式" && visible(element));
  const formControlVisible = [...(area?.querySelectorAll("button,[role=button],[role=textbox],input,textarea") ?? [])]
    .some(visible);
  return visible(area) && customModeVisible && formControlVisible;
}

/** Restore the create page only when its actual form shell never appears. */
export async function repairPuleCreateDisplay(page: Page, guard: Guard = () => undefined) {
  const current = new URL(page.url());
  if (current.origin !== puleOrigin || current.pathname !== "/create") return;

  await guard();
  await page.keyboard.press("Control+0").catch(() => undefined);

  // Do not reload a healthy creation form: it may contain unsaved user input.
  // Give the SPA time to hydrate before bypassing its cache; slower sessions should not be
  // interrupted by an early reload that restarts asset and API requests.
  const usable = await page.waitForFunction(puleCreatePageUsable, undefined, { timeout: 12_000 })
    .then(() => true).catch(() => false);
  await guard();
  if (usable) return;

  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Network.enable");
    await session.send("Network.setCacheDisabled", { cacheDisabled: true });
    await session.send("Network.setBypassServiceWorker", { bypass: true });
    await guard();
    const navigation = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 12_000 })
      .then(() => true).catch(() => false);
    await session.send("Page.reload", { ignoreCache: true });
    await navigation;
    const recovered = await page.waitForFunction(puleCreatePageUsable, undefined, { timeout: 12_000 })
      .then(() => true).catch(() => false);
    await guard();
    if (!recovered) throw Error("PULE_CREATE_PAGE_UNAVAILABLE");
  } catch (error) {
    await guard();
    if (error instanceof Error && error.message === "PULE_CREATE_PAGE_UNAVAILABLE") throw error;
    throw Error("PULE_CREATE_PAGE_UNAVAILABLE", { cause: error });
  } finally {
    await session.send("Network.setCacheDisabled", { cacheDisabled: false }).catch(() => undefined);
    await session.send("Network.setBypassServiceWorker", { bypass: false }).catch(() => undefined);
    await session.detach().catch(() => undefined);
  }
}
