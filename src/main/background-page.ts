import type { Page } from "playwright-core";

/** Opens a background tab in the same browser context as the supplied page. */
export async function openBackgroundOfficialPage(primary: Page): Promise<Page> {
  const context = primary.context();
  const browser = context.browser();
  if (!browser) throw Error("BROWSER_BACKGROUND_PAGE_REQUIRED");

  const source = await context.newCDPSession(primary);
  let browserSession: Awaited<ReturnType<typeof browser.newBrowserCDPSession>> | undefined;
  let targetId: string | undefined;
  try {
    const { targetInfo } = await source.send("Target.getTargetInfo");
    browserSession = await browser.newBrowserCDPSession();
    ({ targetId } = await browserSession.send("Target.createTarget", {
      url: "about:blank",
      background: true,
      ...(targetInfo.browserContextId ? { browserContextId: targetInfo.browserContextId } : {}),
    }));
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      for (const page of context.pages()) {
        if (page === primary) continue;
        const candidate = await context.newCDPSession(page);
        try {
          if ((await candidate.send("Target.getTargetInfo")).targetInfo.targetId === targetId)
            return page;
        } finally {
          await candidate.detach();
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw Error("BROWSER_BACKGROUND_PAGE_REQUIRED");
  } catch (error) {
    if (targetId && browserSession)
      await browserSession.send("Target.closeTarget", { targetId }).catch(() => {});
    throw error;
  } finally {
    await source.detach().catch(() => {});
    await browserSession?.detach().catch(() => {});
  }
}
