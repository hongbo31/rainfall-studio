import { createHash } from "node:crypto";
import type { Page, Response } from "playwright-core";
import { openBackgroundOfficialPage } from "./official-catalog-pagination";

const origin = "https://y.tencentmusic.com";
const userInfoPath = "/v2/v2/user/getUserInfo";
const profileUrl = origin + "/#/user/musician/edit";
const headerSelector = ".mod_top_login .top_login__links .name";
const timeout = 15_000;
export type StableIdentityView = {
  artistNames: string[];
  loadedAccountId: unknown;
  loadedArtistId: unknown;
  loadedArtistName: unknown;
  loadedHeadAccountId?: unknown;
  loadedHeadArtistId?: unknown;
};
export type OfficialStableIdentity = {
  provider: "tme";
  namespace: "tme-musician";
  remoteAccountId: string;
  remoteArtistId: string;
  accountDisplayName: string;
  artistDisplayName: string;
  observedAt: string;
  platformArtists: Array<{
    platform: "qqmusic" | "kugou";
    namespace: "qqmusic-singer" | "kugou-singer";
    remoteArtistId: string;
    mid?: string;
  }>;
  source: {
    kind: "official-page-own-response";
    origin: typeof origin;
    path: typeof userInfoPath;
    method: "GET";
  };
  evidenceHash: string;
};
function id(value: unknown) {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0)
      throw Error("BROWSER_STABLE_IDENTITY_ID_INVALID");
    return String(value);
  }
  if (typeof value !== "string" || !/^[1-9]\d{0,29}$/.test(value))
    throw Error("BROWSER_STABLE_IDENTITY_ID_INVALID");
  return value;
}
function name(value: unknown) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 200 ||
    value !== value.trim()
  )
    throw Error("BROWSER_STABLE_IDENTITY_NAME_INVALID");
  return value;
}

/** This is a calibrated read of the official site's own response, not a public API claim.
 * Extra/private fields are deliberately not returned, hashed or persisted. */
export function parseOfficialStableIdentity(
  raw: unknown,
  view: StableIdentityView,
  observedAt: string,
): OfficialStableIdentity {
  const payload = raw as Record<string, any> | null;
  if (
    !payload ||
    payload.code !== "0" ||
    payload.success !== true ||
    !payload.data ||
    typeof payload.data !== "object" ||
    Array.isArray(payload.data)
  )
    throw Error("BROWSER_STABLE_IDENTITY_RESPONSE_INVALID");
  if (!Number.isFinite(Date.parse(observedAt)))
    throw Error("BROWSER_STABLE_IDENTITY_TIME_INVALID");
  const singer = payload.data.singerInfo;
  if (!singer || typeof singer !== "object" || Array.isArray(singer))
    throw Error("BROWSER_STABLE_IDENTITY_RESPONSE_INVALID");
  const remoteAccountId = id(singer.accountId),
    remoteArtistId = id(singer.id),
    artistDisplayName = name(singer.name);
  const loaded = validateView(view);
  if (
    loaded.accountId !== remoteAccountId ||
    loaded.artistId !== remoteArtistId ||
    loaded.artistName !== artistDisplayName
  )
    throw Error("BROWSER_STABLE_IDENTITY_SCOPE");
  const rows = singer.platformInfos;
  if (!Array.isArray(rows) || rows.length > 20)
    throw Error("BROWSER_PLATFORM_ARTIST_SCHEMA");
  const platformArtists: OfficialStableIdentity["platformArtists"] = [];
  for (const mapping of [
    {
      label: "QQ音乐",
      platform: "qqmusic",
      namespace: "qqmusic-singer",
      key: "qyin",
    },
    {
      label: "酷狗",
      platform: "kugou",
      namespace: "kugou-singer",
      key: "kugou",
    },
  ] as const) {
    // Never infer a target from an undocumented numeric platformType or matching name.
    const matches = rows.filter((r) => r && r.platformName === mapping.label);
    if (matches.length > 1) throw Error("BROWSER_PLATFORM_ARTIST_AMBIGUOUS");
    if (!matches.length) continue;
    let platformId: string;
    try {
      platformId = id(matches[0].platformId);
      if (id(payload.data.platformIds?.[mapping.key]) !== platformId)
        throw Error("BROWSER_PLATFORM_ARTIST_SCOPE");
    } catch {
      throw Error("BROWSER_PLATFORM_ARTIST_SCOPE");
    }
    let mid: string | undefined;
    if (
      mapping.platform === "qqmusic" &&
      singer.qyinSingerMid !== undefined &&
      singer.qyinSingerMid !== null &&
      singer.qyinSingerMid !== ""
    ) {
      if (
        typeof singer.qyinSingerMid !== "string" ||
        !/^[A-Za-z0-9]{1,100}$/.test(singer.qyinSingerMid)
      )
        throw Error("BROWSER_PLATFORM_ARTIST_SCOPE");
      mid = singer.qyinSingerMid;
    }
    if (
      mapping.platform === "qqmusic" &&
      singer.qqmusicSingerId !== undefined &&
      singer.qqmusicSingerId !== null &&
      id(singer.qqmusicSingerId) !== platformId
    )
      throw Error("BROWSER_PLATFORM_ARTIST_SCOPE");
    platformArtists.push({
      platform: mapping.platform,
      namespace: mapping.namespace,
      remoteArtistId: platformId,
      ...(mid ? { mid } : {}),
    });
  }
  const identity: Omit<OfficialStableIdentity, "evidenceHash"> = {
    provider: "tme",
    namespace: "tme-musician",
    remoteAccountId,
    remoteArtistId,
    accountDisplayName: "TME 账号 · " + remoteAccountId,
    artistDisplayName,
    observedAt,
    platformArtists,
    source: {
      kind: "official-page-own-response",
      origin,
      path: userInfoPath,
      method: "GET",
    },
  };
  return {
    ...identity,
    evidenceHash: createHash("sha256")
      .update(JSON.stringify(identity))
      .digest("hex"),
  };
}

function assertOrigin(page: Page) {
  let url: URL;
  try {
    url = new URL(page.url());
  } catch {
    throw Error("BROWSER_OFFICIAL_ORIGIN_REQUIRED");
  }
  if (url.origin !== origin || url.username || url.password)
    throw Error("BROWSER_OFFICIAL_ORIGIN_REQUIRED");
}
async function view(page: Page): Promise<StableIdentityView> {
  assertOrigin(page);
  const current = await page.evaluate((selector) => {
    const visible = (el: Element) => {
      if (!el.isConnected || !el.getClientRects().length) return false;
      for (let p: Element | null = el; p; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (
          s.display === "none" ||
          s.visibility === "hidden" ||
          s.visibility === "collapse" ||
          Number(s.opacity) === 0 ||
          p.getAttribute("aria-hidden") === "true"
        )
          return false;
      }
      return true;
    };
    const names = Array.from(document.querySelectorAll(selector))
      .filter(visible)
      .map((el) => el.textContent?.trim() ?? "");
    // Read only already loaded official identity fields, never cookies, storage or auth objects.
    const state = (document.querySelector("#app") as any)?.__vue__?._data
      ?.state;
    const singer = state?.userInfo?.singerInfo,
      head = state?.headInfo;
    return {
      artistNames: names,
      loadedAccountId: singer?.accountId,
      loadedArtistId: singer?.id,
      loadedArtistName: singer?.name,
      ...(head?.accountInfo?.id !== undefined
        ? { loadedHeadAccountId: head.accountInfo.id }
        : {}),
      ...(head?.singerInfo?.id !== undefined
        ? { loadedHeadArtistId: head.singerInfo.id }
        : {}),
    };
  }, headerSelector);
  assertOrigin(page);
  if (current.artistNames.length !== 1) throw Error("BROWSER_LOGIN_REQUIRED");
  return current;
}
function identityResponse(response: Response) {
  try {
    const url = new URL(response.url());
    return (
      url.origin === origin &&
      url.pathname === userInfoPath &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password &&
      response.request().method() === "GET"
    );
  } catch {
    return false;
  }
}
function validateView(v: StableIdentityView) {
  const accountId = id(v.loadedAccountId),
    artistId = id(v.loadedArtistId),
    artistName = name(v.loadedArtistName);
  if (
    !Array.isArray(v.artistNames) ||
    v.artistNames.length !== 1 ||
    name(v.artistNames[0]) !== artistName ||
    (v.loadedHeadAccountId !== undefined &&
      id(v.loadedHeadAccountId) !== accountId) ||
    (v.loadedHeadArtistId !== undefined &&
      id(v.loadedHeadArtistId) !== artistId)
  )
    throw Error("BROWSER_STABLE_IDENTITY_SCOPE");
  return { accountId, artistId, artistName };
}
function same(a: StableIdentityView, b: StableIdentityView) {
  const x = validateView(a),
    y = validateView(b);
  return (
    x.accountId === y.accountId &&
    x.artistId === y.artistId &&
    x.artistName === y.artistName
  );
}

/** Main-only local recheck of already loaded official fields. No navigation or request. */
export async function readLoadedOfficialStableIdentity(page:Page){
  return validateView(await view(page));
}

/** Existing approved context only. Opens/closes one background read page, preserves the
 * user's original page, does not call an API directly and never creates a binding. */
export async function readFreshOfficialStableIdentity(
  primary: Page,
): Promise<OfficialStableIdentity> {
  const initialUrl = primary.url(),
    initial = await view(primary),
    initialPages = primary.context().pages();
  // Reject stale/ambiguous primary state before any navigation or new target.
  validateView(initial);
  let temporary: Page | undefined;
  try {
    temporary = await openBackgroundOfficialPage(primary);
    const responsePromise = temporary.waitForResponse(identityResponse, {
      timeout,
    });
    responsePromise.catch(() => {});
    await temporary.goto(profileUrl, {
      waitUntil: "domcontentloaded",
      timeout,
    });
    assertOrigin(temporary);
    const response = await responsePromise;
    if (
      response.status() !== 200 ||
      response.frame().page() !== temporary ||
      new URL(response.frame().url()).origin !== origin
    )
      throw Error("BROWSER_STABLE_IDENTITY_RESPONSE_SCOPE");
    const contentType = await response.headerValue("content-type"),
      length = Number((await response.headerValue("content-length")) ?? 0);
    if (
      !contentType?.toLowerCase().includes("application/json") ||
      length > 1_048_576
    )
      throw Error("BROWSER_STABLE_IDENTITY_RESPONSE_INVALID");
    const bytes = await response.body();
    if (bytes.length > 1_048_576)
      throw Error("BROWSER_STABLE_IDENTITY_RESPONSE_INVALID");
    let payload: unknown;
    try {
      payload = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw Error("BROWSER_STABLE_IDENTITY_RESPONSE_INVALID");
    }
    await temporary.waitForFunction(
      () => {
        const state = (document.querySelector("#app") as any)?.__vue__?._data
          ?.state;
        return (
          !!state?.userInfo?.singerInfo?.id &&
          !!state?.userInfo?.singerInfo?.accountId
        );
      },
      undefined,
      { timeout },
    );
    const current = await view(temporary),
      parsed = parseOfficialStableIdentity(
        payload,
        current,
        new Date().toISOString(),
      );
    if (
      !same(initial, current) ||
      primary.url() !== initialUrl ||
      !same(initial, await view(primary))
    )
      throw Error("ACCOUNT_CHANGED");
    return parsed;
  } finally {
    if (temporary) await temporary.close();
    const finalPages = primary.context().pages();
    if (
      primary.url() !== initialUrl ||
      initialPages.length !== finalPages.length ||
      !initialPages.every((p) => finalPages.includes(p))
    )
      throw Error("BROWSER_PRIMARY_CHANGED");
  }
}
