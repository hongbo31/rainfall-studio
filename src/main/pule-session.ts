import type { Page } from "playwright-core";
import { puleOrigin, type PuleSessionState } from "../shared/pule-browser";

const signInLabel = /^登录\s*[·•]\s*更多$/u;
const accountControl = (page: Page) =>
  page.locator('aside button[aria-haspopup="dialog"][aria-label$="更多"]').filter({ visible: true });

export const puleSignInControl = (page: Page) =>
  accountControl(page).and(page.getByRole("button", { name: signInLabel }));

export const puleSignInDialog = (page: Page) => page.getByRole("dialog").filter({
  has: page.getByRole("heading", { name: "继续你的音乐创作", exact: true }),
  visible: true,
});

export async function inspectPuleSession(page: Page): Promise<PuleSessionState> {
  if (page.isClosed()) return "closed";
  try {
    const url = new URL(page.url());
    if (url.origin !== puleOrigin) return "unverified";
    if (/^\/(?:login|auth|signin)(?:\/|$)/u.test(url.pathname)) return "login_required";

    // The official account control remains in the DOM behind other dialogs.
    const labels = await accountControl(page).evaluateAll(buttons =>
      buttons.map(button => button.getAttribute("aria-label") ?? ""));
    if (page.url() !== url.href) return "unverified";
    if (labels.length === 1) {
      if (signInLabel.test(labels[0])) return "login_required";
      if (/^.+\s*[·•]\s*更多$/u.test(labels[0])) return "signed_in";
    }
    return await puleSignInDialog(page).count() && page.url() === url.href ? "login_required" : "unverified";
  } catch {
    return page.isClosed() ? "closed" : "unverified";
  }
}
