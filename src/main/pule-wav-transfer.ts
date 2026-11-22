import type { Download, Page, Request, Response } from "playwright-core";
import { puleAudioMaxBytes, puleOrigin } from "../shared/pule-browser";

const wavMediaHosts = new Set(["oss.yourmusic.fun", "storage.googleapis.com"]);
const wavMimeTypes = new Set(["audio/wav", "audio/wave", "audio/x-wav", "audio/vnd.wave"]);

function mediaUrl(value: unknown): URL | undefined {
  if (typeof value !== "string" || value.length > 8192) return;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password && !url.port && !url.hash) return url;
  } catch { /* The site may return an error instead of a URL. */ }
}

function isWaveLinkRequest(request: Request) {
  return request.method() === "POST" && request.url() === `${puleOrigin}/api/music/v2/wav/make`;
}

function waveLinkSongId(request: Request): string | undefined {
  try {
    const id = request.postDataJSON()?.songId;
    if (typeof id === "string" && /^[a-z0-9_-]{1,150}$/iu.test(id)) return id;
    if (typeof id === "number" && Number.isSafeInteger(id) && id >= 0) return String(id);
  } catch { /* The request does not identify a usable song. */ }
}

export async function preparePuleWave<T>(page: Page, prepare: () => Promise<T | undefined>) {
  // The official WAV dialog may request musicSongId instead of the row's public songId.
  const ids = new Set<string>();
  let invalid = false;
  const onRequest = (request: Request) => {
    if (!isWaveLinkRequest(request)) return;
    const id = waveLinkSongId(request);
    if (id) ids.add(id);
    else invalid = true;
  };
  page.on("request", onRequest);
  try {
    const control = await prepare();
    if (invalid || ids.size > 1) throw Error("PULE_WAV_IDENTITY_UNCONFIRMED");
    if (control === undefined) throw Error(ids.size ? "PULE_WAV_LINK_TIMEOUT" : "PULE_DOWNLOAD_CONFIRM_UNAVAILABLE");
    return { control, preparedSongId: ids.values().next().value };
  } finally { page.off("request", onRequest); }
}

function linkError(status: number) {
  if (status === 402) return "PULE_INSUFFICIENT_CREDITS";
  if (status >= 400 && status < 500 && status !== 408 && status !== 429) return "PULE_WAV_LINK_REJECTED";
  return "PULE_WAV_LINK_FAILED";
}

function originalUrl(request: Request): string {
  let source = request;
  for (let previous = source.redirectedFrom(); previous; previous = source.redirectedFrom()) source = previous;
  return source.url();
}

function knownMediaHost(hostname: string) {
  return wavMediaHosts.has(hostname) || hostname.endsWith(".storage.googleapis.com");
}

function responsePage(response: Response) {
  try { return response.frame().page(); }
  catch { return undefined; }
}

function inlineWaveUrl(response: Response, popup: Page) {
  const url = mediaUrl(response.url());
  if (!url || !knownMediaHost(url.hostname) || popup.url() !== url.href || ![200, 206].includes(response.status())) return;
  const headers = response.headers();
  const mime = headers["content-type"]?.split(";", 1)[0].trim().toLowerCase();
  if (mime && wavMimeTypes.has(mime) && !/attachment/i.test(headers["content-disposition"] ?? "")) return url.href;
}

async function saveInlineWave(popup: Page, url: string, timeout: number) {
  // Chromium can open the WAV in a media document without firing a download event.
  const result: { blobUrl?: string; error?: string } = await popup.evaluate(async ({ href, timeout, maxSize }) => {
    if (window.location.href !== href) return { error: "PULE_WAV_TRANSFER_FAILED" };
    const response = await fetch(href, { mode: "same-origin", credentials: "omit", redirect: "error", signal: AbortSignal.timeout(timeout) });
    if (response.status !== 200 || response.headers.has("content-range") || !response.body)
      return { error: "PULE_WAV_TRANSFER_FAILED" };
    if (Number(response.headers.get("content-length")) > maxSize) {
      await response.body.cancel();
      return { error: "PULE_WAV_SIZE" };
    }
    const reader = response.body.getReader();
    const chunks: ArrayBuffer[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxSize) {
          await reader.cancel();
          return { error: "PULE_WAV_SIZE" };
        }
        chunks.push(new Uint8Array(value).buffer);
      }
    } finally { reader.releaseLock(); }
    const blobUrl = URL.createObjectURL(new Blob(chunks, { type: "audio/wav" }));
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = "original.wav";
    document.documentElement.append(link);
    link.click();
    link.remove();
    return { blobUrl };
  }, { href: url, timeout, maxSize: puleAudioMaxBytes }).catch(() => ({ error: "PULE_WAV_TRANSFER_FAILED" }));
  if (!result.blobUrl) throw Error(result.error ?? "PULE_WAV_TRANSFER_FAILED");
  return result.blobUrl;
}

/** Watch the official click's link request separately from Chromium's download event. */
export async function receivePuleWave(page: Page, options: {
  songId: string;
  preparedSongId?: string;
  deadline: number;
  poll: number;
  click: (remaining: number) => Promise<void>;
  guard: () => void | Promise<void>;
  receiving: () => void;
  save: (file: Download) => Promise<void>;
}) {
  const context = page.context();
  const popups = new Set<Page>();
  const downloads: { file: Download; at: number }[] = [];
  const responses: { response: Response; at: number }[] = [];
  let url: string | undefined;
  let inlineBlobUrl: string | undefined;
  let inlineStarted = false;
  let seenLink = false;
  let unboundRequest = false;
  let active = true;
  let receiving = false;
  let failure: string | undefined;
  const remainingTime = () => Math.ceil(options.deadline - performance.now());
  const markReceiving = () => {
    if (!receiving) { receiving = true; options.receiving(); }
  };

  const resolveLink = async (request: Request) => {
    const response = await request.response();
    if (!active) return;
    if (!response || !response.ok()) { failure = linkError(response?.status() ?? 0); return; }
    if (await response.finished()) { if (active) failure = "PULE_WAV_LINK_FAILED"; return; }
    if ((await request.sizes()).responseBodySize > 32_768) return;
    const payload = await response.json();
    if (!active) return;
    if (typeof payload?.code === "number" && (payload.code < 200 || payload.code >= 300)) {
      failure = linkError(payload.code);
      return;
    }
    url = mediaUrl(payload?.data)?.href;
  };
  const onRequest = (request: Request) => {
    if (seenLink || !isWaveLinkRequest(request)) return;
    if (waveLinkSongId(request) !== (options.preparedSongId ?? options.songId)) {
      unboundRequest = true;
      return;
    }
    seenLink = true;
    void resolveLink(request).catch(() => { if (active) failure = "PULE_WAV_LINK_FAILED"; });
  };
  const onResponse = (response: Response) => {
    const request = response.request();
    const source = mediaUrl(originalUrl(request));
    if (request.method() !== "GET" || !source) return;
    const tab = responsePage(response);
    if (tab !== page && !request.isNavigationRequest()) return;
    // The first response of a popup can precede its Page-level popup event.
    if (source.href !== url && !knownMediaHost(source.hostname)) return;
    responses.push({ response, at: performance.now() });
    if (responses.length > 24) responses.shift();
  };
  const onDownload = (file: Download) => {
    downloads.push({ file, at: performance.now() });
    if (downloads.length > 24) downloads.shift();
  };
  const onPopup = (popup: Page) => {
    popups.add(popup);
    popup.on("download", onDownload);
  };

  page.on("request", onRequest);
  page.on("download", onDownload);
  page.on("popup", onPopup);
  context.on("response", onResponse);
  try {
    const clickTime = remainingTime();
    if (clickTime <= 0) throw Error("PULE_DOWNLOAD_TIMEOUT");
    await options.click(clickTime);
    while (true) {
      await options.guard();
      if (failure) throw Error(failure);
      const remaining = remainingTime();
      if (remaining <= 0) {
        if (url) throw Error("PULE_DOWNLOAD_TIMEOUT");
        if (seenLink) throw Error("PULE_WAV_LINK_TIMEOUT");
        throw Error(unboundRequest ? "PULE_WAV_IDENTITY_UNCONFIRMED" : "PULE_DOWNLOAD_NOT_STARTED");
      }
      const media = url ? responses.find(entry => {
        const tab = responsePage(entry.response);
        return !!tab && (tab === page || popups.has(tab)) && originalUrl(entry.response.request()) === url &&
          (entry.response.ok() || entry.response.status() >= 400);
      }) : undefined;
      if (media && !media.response.ok()) throw Error("PULE_WAV_TRANSFER_FAILED");
      const native = downloads.find(({ file, at }) => {
        const primary = file.page() === page;
        const downloadUrl = file.url();
        if (primary && !options.preparedSongId && !seenLink && !unboundRequest) return true;
        if (!url) return false;
        if (downloadUrl === url || downloadUrl === inlineBlobUrl || downloadUrl === media?.response.url()) return true;
        return primary && media !== undefined && responsePage(media.response) === page && at >= media.at &&
          downloadUrl.startsWith(`blob:${puleOrigin}/`);
      })?.file;
      if (native) { markReceiving(); await options.save(native); return; }
      if (media) {
        markReceiving();
        const popup = responsePage(media.response);
        const source = !inlineStarted && popup && popups.has(popup) ? inlineWaveUrl(media.response, popup) : undefined;
        if (source && popup) {
          inlineStarted = true;
          void saveInlineWave(popup, source, remaining).then(blobUrl => {
            inlineBlobUrl = blobUrl;
          }, error => { if (active) failure = error.message; });
        }
      }
      await page.waitForTimeout(Math.min(options.poll, remaining));
    }
  } finally {
    active = false;
    page.off("request", onRequest);
    page.off("download", onDownload);
    page.off("popup", onPopup);
    context.off("response", onResponse);
    await Promise.allSettled(Array.from(popups, popup => {
      popup.off("download", onDownload);
      return popup.close();
    }));
  }
}
