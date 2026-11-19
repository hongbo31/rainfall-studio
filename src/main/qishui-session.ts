import type { Page } from "playwright-core";
import { qishuiOrigin, type QishuiSessionState } from "../shared/qishui";

export async function inspectQishuiSession(page: Page): Promise<QishuiSessionState> {
  try {
  if (page.isClosed()) return "closed";
  const url = new URL(page.url());
  if (url.origin !== qishuiOrigin) return "unverified";

  const login = page.getByPlaceholder("请输入手机号", { exact: true });
  const loginButton = page.getByRole("button", { name: "登录/注册", exact: true });
  if (await login.isVisible() || await loginButton.isVisible()) return "login_required";
  if (url.pathname.replace(/\/$/, "") === "/console/complete-publish") {
    const heading = page.getByRole("heading", { name: "发布全曲", exact: true });
    const title = page.getByRole("textbox", { name: "歌曲标题*", exact: true });
    for (const control of [heading, title]) {
      if (await control.count() !== 1 || !(await control.isVisible())) return "unverified";
    }
    return page.url() === url.href ? "release_form" : "unverified";
  }
  if (url.pathname.replace(/\/$/, "") !== "/console/publish") return "unverified";

  // The route may render before authentication redirects complete. Require visible release UI.
  const release = page.getByRole("button", { name: /^发布全曲(?:\s+chevron_right)?$/ });
  if (await release.count() !== 1 || !(await release.isVisible())) return "unverified";
  return page.url() === url.href ? "release_page" : "unverified";
  } catch {
    // A tab can navigate or close while its controls are being inspected.
    return page.isClosed() ? "closed" : "unverified";
  }
}
