import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { Locator, Page, Request, Response } from "playwright-core";
import sharp from "sharp";
import { z } from "zod";
import { COVER_IMAGE_POLICY } from "../../shared/cover-handoff";
import {
  fanqieArtistAvatarMaxBytes, fanqieArtistAvatarMinEdge, type FanqieArtistCreationResult, type FanqieArtistCreationScope,
} from "../../shared/fanqie-artist";
import { fanqieOrigin } from "../../shared/fanqie";
import type { ApiCredentials } from "../api-credentials";
import { isOfficialSignInRoute } from "../browser-accounts";
import { fanqieArtistUrl } from "./directory-page";

const loginUrl = fanqieOrigin + "/creator/music/login?invite_code=ZZYFID";
const searchPlaceholder = "请输入艺人名";
const listPath = "/api/author/home/get_owned_artist_list/v0/";
const addPath = "/api/author/home/add_artist_v2/v0/";
const stageTimeout = 30_000;
const menuTimeout = 4_000;
const roles = [
  { name: "词曲作者", value: 1 },
  { name: "制作人", value: 3 },
  { name: "歌手", value: 2 },
] as const;
const serviceCode = z.union([z.number().int(), z.string().regex(/^[0-9]+$/).transform(Number)]);
const artistReply = z.object({ code: serviceCode, data: z.object({
  artist_list: z.array(z.object({ name: z.string().trim().min(1), author_id: z.unknown().optional() })).nullish(),
  total_count: serviceCode,
}) });
export const fanqieRosterNameKey = (name: string) => name.trim().normalize("NFC");
const nameKey = fanqieRosterNameKey;
const rosterId = z.string().regex(/^[1-9]\d{4,24}$/u);
const searchUnverified = "FANQIE_ARTIST_SEARCH_UNVERIFIED";
const atArtistRoster = (url: URL) => url.origin + url.pathname === fanqieArtistUrl;
export type FanqieDirectorySinger = { artistId: string } | {
  issue: "FANQIE_ARTIST_NAME_NOT_FOUND" | "FANQIE_ARTIST_NAME_AMBIGUOUS" | typeof searchUnverified;
};

export type FanqieArtistPage = {
  page: Page;
  stateDirectory: string;
  guard: () => void;
  verifyAccount: () => Promise<string>;
  mark: (step: string) => void;
  close: () => Promise<void>;
};

type Options = FanqieArtistPage & {
  assertSelection: () => Promise<void>;
  credentials: Pick<ApiCredentials, "apiCredentialStatus" | "generatePlanCover">;
  wait?: (milliseconds: number) => Promise<unknown>;
};

function creatorPage(page: Page, guard: () => void) {
  guard();
  const url = new URL(page.url());
  if (page.isClosed() || url.origin !== fanqieOrigin) throw Error("FANQIE_PAGE_SCOPE_CHANGED");
  if (isOfficialSignInRoute(url.href, fanqieOrigin)) throw Error("FANQIE_ARTIST_LOGIN_REQUIRED");
  if (!/^\/creator\/music(?:\/|$)/u.test(url.pathname)) throw Error("FANQIE_PAGE_SCOPE_CHANGED");
  return url;
}

async function openArtistRoster({ page, guard, mark }: FanqieArtistPage) {
  mark("正在打开番茄登录入口");
  guard();
  await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: stageTimeout });
  // A saved session may return to the dashboard only after the login page has loaded.
  await page.waitForURL(url => !isOfficialSignInRoute(url.href, fanqieOrigin),
    { waitUntil: "domcontentloaded", timeout: stageTimeout }).catch(error => {
    creatorPage(page, guard);
    throw error;
  });
  const landing = creatorPage(page, guard);
  if (!atArtistRoster(landing)) {
    mark("正在从番茄账号菜单打开艺人信息");
    try {
      // The account menu is a hover popover in the creator dashboard.
      await page.locator("div.user-box").filter({ visible: true }).hover({ timeout: menuTimeout });
      if (creatorPage(page, guard).href !== landing.href) throw Error("FANQIE_PAGE_SCOPE_CHANGED");
      await page.locator(".user-box-menu").getByText("艺人信息", { exact: true }).filter({ visible: true })
        .click({ timeout: menuTimeout });
      await page.waitForURL(atArtistRoster, { waitUntil: "domcontentloaded", timeout: menuTimeout });
    } catch (error) {
      const current = creatorPage(page, guard);
      if (!(error instanceof Error) || error.name !== "TimeoutError") throw error;
      if (!atArtistRoster(current)) {
        if (current.href !== landing.href) throw Error("FANQIE_PAGE_SCOPE_CHANGED");
        // Home may have an overlay or a menu that disappears when moving to its item.
        mark("正在打开番茄官网艺人列表");
        await page.goto(fanqieArtistUrl, { waitUntil: "domcontentloaded", timeout: stageTimeout });
      }
    }
  }
  if (!atArtistRoster(creatorPage(page, guard))) throw Error("FANQIE_ARTIST_ROSTER_UNAVAILABLE");
  await page.getByPlaceholder(searchPlaceholder, { exact: true }).waitFor({ state: "visible", timeout: stageTimeout })
    .catch(error => {
      if (!atArtistRoster(creatorPage(page, guard))) throw Error("FANQIE_PAGE_SCOPE_CHANGED");
      if (error instanceof Error && error.name === "TimeoutError") throw Error("FANQIE_ARTIST_ROSTER_UNAVAILABLE");
      throw error;
    });
}

function responseOnPage(response: Response, page: Page, method: string, pathname: string) {
  const request = response.request();
  const url = new URL(response.url());
  if (request.method() !== method || url.origin !== fanqieOrigin || url.pathname !== pathname || request.serviceWorker()) return false;
  try { return request.frame() === page.mainFrame(); } catch { return false; }
}

async function scanArtistRoster(page: Page, name: string, guard: () => void, cooperative: boolean,
  accept: (artists: NonNullable<z.infer<typeof artistReply>["data"]["artist_list"]>) => boolean) {
  const assertRoster = () => {
    if (!atArtistRoster(creatorPage(page, guard))) throw Error("FANQIE_PAGE_SCOPE_CHANGED");
  };
  assertRoster();
  const search = page.getByPlaceholder(searchPlaceholder, { exact: true });
  await search.waitFor({ state: "visible", timeout: stageTimeout }).catch(error => {
    assertRoster();
    throw Error(searchUnverified, { cause: error });
  });
  // React may cache a previous name. Reload before requesting another read for the same filter.
  if (await search.inputValue() === name) {
    await page.reload({ waitUntil: "domcontentloaded", timeout: stageTimeout });
    assertRoster();
  }
  let totalSeen = 0;
  let expectedTotal: number | undefined;
  let bindTypes: string | undefined;
  let pageSize: number | undefined;
  for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
    assertRoster();
    const requested = new WeakSet<Request>();
    const rememberRequest = (request: Request) => { requested.add(request); };
    page.on("request", rememberRequest);
    const response = await Promise.all([
      page.waitForResponse(reply => {
        if (!requested.has(reply.request()) || !responseOnPage(reply, page, "GET", listPath)) return false;
        const query = new URL(reply.url()).searchParams;
        if (query.get("name_like") !== name || (query.get("page_no") ?? "0") !== String(pageNumber)) return false;
        // The fresh roster page starts on 合作艺人, whose three bind types differ from the single AI type.
        const binding = query.get("bind_types")?.split(",");
        return !cooperative || !!binding && binding.length === 3 && new Set(binding).size === 3 && binding.every(type => /^\d+$/u.test(type));
      }, { timeout: stageTimeout }),
      pageNumber === 0 ? search.fill(name, { timeout: stageTimeout }) :
        page.locator(".pagination-container .arco-pagination-item-next").click({ timeout: stageTimeout }),
    ]).then(([reply]) => reply).catch(error => {
      assertRoster();
      throw Error(searchUnverified, { cause: error });
    }).finally(() => page.off("request", rememberRequest));
    assertRoster();
    const raw = await response.text().then(text => JSON.parse(text, (key, value: unknown, context?: { source: string }) =>
      key === "author_id" && typeof value === "number" ? context?.source ?? "" : value)).catch(() => null);
    assertRoster();
    const parsed = artistReply.safeParse(raw);
    if (!response.ok() || !parsed.success || parsed.data.code !== 0) throw Error(searchUnverified);
    const { total_count: total, artist_list: artists } = parsed.data.data;
    const names = artists ?? [];
    if (!Number.isSafeInteger(total) || total < totalSeen + names.length ||
      (expectedTotal !== undefined && total !== expectedTotal) || (!names.length && totalSeen < total))
      throw Error(searchUnverified);
    if (cooperative) {
      const query = new URL(response.url()).searchParams;
      const size = Number(query.get("page_size"));
      const binding = query.get("bind_types")!;
      bindTypes ??= binding;
      pageSize ??= size;
      if (binding !== bindTypes || !Number.isSafeInteger(size) || size < 1 || size !== pageSize ||
          names.length !== Math.min(size, total - totalSeen)) throw Error(searchUnverified);
    }
    if (accept(names)) return true;
    expectedTotal = total;
    totalSeen += names.length;
    if (totalSeen === total) return false;
  }
  throw Error(searchUnverified);
}

function findArtist(page: Page, name: string, guard: () => void) {
  return scanArtistRoster(page, name, guard, false, names => names.some(artist => nameKey(artist.name) === nameKey(name)));
}

export async function searchFanqieDirectorySinger(page: Page, name: string, guard: () => void): Promise<FanqieDirectorySinger> {
  const ids = new Set<string>();
  try {
    await scanArtistRoster(page, name, guard, true, artists => {
      for (const artist of artists) {
        if (nameKey(artist.name) !== name) continue;
        const id = rosterId.safeParse(artist.author_id);
        if (!id.success) throw Error(searchUnverified);
        ids.add(id.data);
      }
      return false;
    });
  } catch (error) {
    if (error instanceof Error && error.message === searchUnverified) return { issue: searchUnverified };
    throw error;
  }
  if (!ids.size) return { issue: "FANQIE_ARTIST_NAME_NOT_FOUND" };
  if (ids.size !== 1) return { issue: "FANQIE_ARTIST_NAME_AMBIGUOUS" };
  return { artistId: [...ids][0] };
}

function pendingFile(directory: string, accountKey: string, name: string) {
  const key = createHash("sha256").update(accountKey + "\0" + nameKey(name)).digest("hex");
  return path.join(directory, "artist-creation", key + ".pending");
}

function clearPending(file: string) {
  fs.rmSync(file, { force: true });
}

async function generateArtistAvatar(scope: FanqieArtistCreationScope, options: Options, guard: () => void) {
  const { coverResolution: resolution, avatarProfile, avatarVoice } = scope;
  if (resolution < fanqieArtistAvatarMinEdge) throw Error("FANQIE_ARTIST_AVATAR_RESOLUTION");
  const subject = avatarVoice === "male" ? "成年男性" : "成年女性";
  const prompt = `用于音乐人资料的方形头像照片。一位${subject}的头肩肖像，人物正面、面部清晰、主体居中。背景简洁，适合圆形裁切。无文字、标志和水印。`;
  await options.assertSelection();
  const credential = await options.credentials.apiCredentialStatus({ profileId: avatarProfile.profileId });
  if (!credential.configured) throw Error(credential.failureCode ?? "CREDENTIAL_NOT_CONFIGURED");
  guard();
  const bytes = await options.credentials.generatePlanCover(avatarProfile, prompt, async () => {
    await options.assertSelection();
    guard();
  }, guard, resolution);
  const image = sharp(bytes, { limitInputPixels: COVER_IMAGE_POLICY.maxPixels }).rotate()
    .resize(resolution, resolution, { fit: "cover", position: "attention" }).flatten({ background: "#ffffff" });
  const full = await image.clone().jpeg({ quality: 85, mozjpeg: true }).toBuffer();
  const output = full.length <= fanqieArtistAvatarMaxBytes ? full : await image.jpeg({ quality: 60, mozjpeg: true }).toBuffer();
  if (output.length > fanqieArtistAvatarMaxBytes) throw Error("FANQIE_ARTIST_AVATAR_UPLOAD");
  guard();
  return output;
}

async function fillArtistFields(modal: Locator, input: Locator, name: string, guard: () => void) {
  try {
    await input.fill(name, { timeout: stageTimeout });
    for (const role of roles) {
      const control = modal.page().locator(`input[type="checkbox"][value="${role.value}"]`);
      const label = modal.locator("label").filter({
        visible: true, has: control, hasText: new RegExp(`^\\s*${role.name}\\s*$`, "u"),
      });
      await label.waitFor({ state: "visible", timeout: stageTimeout });
      guard();
      // Arco gives the native input no visible area. Click its label and read the actual input state.
      const checkbox = label.locator(control);
      if (!await checkbox.isEnabled()) throw Error("FANQIE_ARTIST_FORM_CHANGED");
      if (!await checkbox.isChecked()) await label.click({ timeout: stageTimeout });
    }
  } catch (error) {
    guard();
    throw Error("FANQIE_ARTIST_FORM_CHANGED", { cause: error });
  }
}

function artistAvatarSource(modal: Locator) {
  return modal.locator(".avatar-upload-container .upload-img-item > img").filter({ visible: true }).evaluateAll(elements => {
    if (elements.length !== 1) return undefined;
    const image = elements[0] as HTMLImageElement;
    // currentSrc resolves relative URLs. The upload in progress only displays a local blob.
    if (!image.complete || !image.naturalWidth || !/^https?:\/\//u.test(image.currentSrc) ||
        image.closest(".upload-img-item")?.querySelector(".upload-img-item-mask")) return undefined;
    return image.currentSrc;
  });
}

async function waitForArtistAvatar(page: Page, modal: Locator, guard: () => void) {
  const deadline = performance.now() + stageTimeout;
  const uploadFailed = page.getByText("上传失败", { exact: true }).filter({ visible: true });
  while (performance.now() < deadline) {
    guard();
    const source = await artistAvatarSource(modal);
    if (source) return source;
    if (await uploadFailed.count()) break;
    await delay(200);
  }
  throw Error("FANQIE_ARTIST_AVATAR_UPLOAD");
}

function hasAllArtistRoles(values: unknown) {
  return Array.isArray(values) && values.length === roles.length && roles.every(role => values.includes(role.value));
}

function matchesAdd(reply: Response, page: Page, name: string) {
  if (!responseOnPage(reply, page, "POST", addPath)) return false;
  try {
    const data = reply.request().postDataJSON();
    return data?.name === name && typeof data.avatar_uri === "string" && !!data.avatar_uri &&
      hasAllArtistRoles(data.musician_type_list);
  } catch {
    return false;
  }
}

/** Runs the official form in the selected account's dedicated tab. Lookups and receipts come from UI-triggered requests. */
export async function createFanqieArtists(scope: FanqieArtistCreationScope, options: Options): Promise<FanqieArtistCreationResult> {
  const { page, mark } = options;
  const guard = () => {
    if (!atArtistRoster(creatorPage(page, options.guard))) throw Error("FANQIE_PAGE_SCOPE_CHANGED");
  };
  await openArtistRoster(options);
  guard();
  mark("正在核对番茄登录账号");
  const accountKey = await options.verifyAccount();
  guard();
  const verified = new Set<string>();
  const artists: FanqieArtistCreationResult["artists"] = [];

  for (const singer of scope.singers) {
    const { version, name } = singer;
    const file = pendingFile(options.stateDirectory, accountKey, name);
    mark(`正在查找 ${version} 版艺人`);
    if (verified.has(nameKey(name)) || await findArtist(page, name, guard)) {
      if (fs.existsSync(file)) {
        if (await options.verifyAccount() !== accountKey) throw Error("FANQIE_ACCOUNT_IDENTITY_MISMATCH");
        clearPending(file);
      }
      verified.add(nameKey(name));
      artists.push({ ...singer, status: "existing" });
      continue;
    }
    if (fs.existsSync(file)) throw Error("FANQIE_ARTIST_CREATE_UNCONFIRMED");

    // The page also shows a second “新增艺人” in its empty state. Use the header action.
    guard();
    await page.locator(".page-header").getByText("新增艺人", { exact: true }).click();
    const modal = page.locator(".arco-modal").filter({ visible: true, has: page.getByText("添加自定义艺人", { exact: true }) });
    const input = modal.getByPlaceholder("请输入艺人名称", { exact: true });
    const upload = modal.locator(".avatar-upload-container .image-upload-btn");
    await upload.waitFor({ state: "visible", timeout: stageTimeout });
    mark(`正在生成 ${version} 版艺人头像`);
    const avatar = await generateArtistAvatar(scope, options, guard);
    if (await options.verifyAccount() !== accountKey) throw Error("FANQIE_ACCOUNT_IDENTITY_MISMATCH");
    guard();
    mark(`正在上传 ${version} 版艺人头像`);
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: stageTimeout }), upload.click({ timeout: stageTimeout }),
    ]).catch(() => { throw Error("FANQIE_ARTIST_AVATAR_UPLOAD"); });
    guard();
    const accept = await chooser.element().getAttribute("accept");
    if (chooser.isMultiple() || !accept?.includes("image/jpeg")) throw Error("FANQIE_ARTIST_AVATAR_UPLOAD");
    await chooser.setFiles({ name: "avatar.jpg", mimeType: "image/jpeg", buffer: avatar });

    guard();
    mark(`正在填写 ${version} 版艺人名称和角色`);
    await fillArtistFields(modal, input, name, guard);
    mark(`正在核对 ${version} 版头像上传结果`);
    const avatarSource = await waitForArtistAvatar(page, modal, guard);
    const add = modal.getByRole("button", { name: "确认添加", exact: true });
    // Check actionability without clicking or reserving the name.
    await add.click({ trial: true, timeout: stageTimeout }).catch(error => {
      guard();
      throw Error("FANQIE_ARTIST_FORM_CHANGED", { cause: error });
    });
    await options.assertSelection();
    if (await options.verifyAccount() !== accountKey) throw Error("FANQIE_ACCOUNT_IDENTITY_MISMATCH");
    guard();
    const [filledName, checkedRoles, currentAvatar] = await Promise.all([
      input.inputValue({ timeout: stageTimeout }),
      modal.locator('input[type="checkbox"]:checked').evaluateAll(elements => elements.map(element => Number((element as HTMLInputElement).value))),
      artistAvatarSource(modal),
    ]);
    if (filledName !== name || !hasAllArtistRoles(checkedRoles) || currentAvatar !== avatarSource || !await add.isEnabled())
      throw Error("FANQIE_ARTIST_FORM_CHANGED");
    guard();

    mark(`正在提交并核对 ${version} 版艺人`);
    // A lost reply keeps this name reserved. A later run clears it only when the artist is found.
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, new Date().toISOString(), { flag: "wx" });
    const [response] = await Promise.all([
      page.waitForResponse(reply => matchesAdd(reply, page, name), { timeout: stageTimeout }),
      add.click({ timeout: stageTimeout }),
    ]).catch(() => { throw Error("FANQIE_ARTIST_CREATE_UNCONFIRMED"); });
    const reply = z.object({ code: serviceCode }).safeParse(await response.json().catch(() => null));
    if (!response.ok() || !reply.success) throw Error("FANQIE_ARTIST_CREATE_UNCONFIRMED");
    if (reply.data.code !== 0) {
      clearPending(file);
      throw Error("FANQIE_ARTIST_CREATE_REJECTED");
    }
    await modal.waitFor({ state: "hidden", timeout: stageTimeout });
    if (!await findArtist(page, name, guard)) throw Error("FANQIE_ARTIST_CREATE_UNCONFIRMED");
    clearPending(file);
    verified.add(nameKey(name));
    artists.push({ ...singer, status: "created" });
  }

  mark("艺人已核对，等待关闭页面");
  await (options.wait ?? delay)(10_000);
  if (!page.isClosed() && atArtistRoster(new URL(page.url()))) await options.close();
  return { artists };
}
