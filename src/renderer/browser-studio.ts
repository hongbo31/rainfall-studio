import { createBridge } from "../shared/bridge";

const storageKey = "rainfall-browser-studio-session";
const keyPattern = /^[0-9a-f]{64}\.[0-9a-f]{64}$/;
let mediaKey: string | undefined;

export function connectBrowserStudio() {
  const fragment = location.hash.slice(1);
  if (fragment) history.replaceState(null, "", location.pathname + location.search);
  const credentials = fragment || sessionStorage.getItem(storageKey);
  if (!credentials || !keyPattern.test(credentials)) return false;
  sessionStorage.setItem(storageKey, credentials);
  const [key, media] = credentials.split(".");
  mediaKey = media;

  const bridge = createBridge(async (channel, ...args) => {
    try {
      const response = await fetch("/rpc", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
        body: JSON.stringify({ channel, args }),
      });
      if (!response.ok) throw Error("BROWSER_SESSION_UNAVAILABLE");
      return await response.json();
    } catch {
      return { ok: false, error: { code: "BROWSER_STUDIO_UNAVAILABLE", message: "连接已断开，请重新打开 Rainfall Studio 浏览器工作台。" } };
    }
  });
  Object.defineProperty(window, "rainfall", { value: bridge });
  return true;
}

export function isBrowserStudio() {
  return mediaKey !== undefined;
}

export function studioMediaUrl(value: string) {
  if (!mediaKey) return value;
  const prefix = "/studio-media/" + mediaKey + "/";
  if (value.startsWith("media://")) return prefix + "media/" + value.slice("media://".length);
  if (value.startsWith("material-cover://")) return prefix + "material-cover/" + value.slice("material-cover://".length);
  return value;
}
