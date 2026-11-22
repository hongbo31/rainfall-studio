import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compileFunction } from "node:vm";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import sharp from "sharp";
import { launchHeadlessChromium } from "../scripts/lib/headless-chromium.mjs";

const { outputFiles } = await build({
  stdin: { resolveDir: process.cwd(), contents: `
    export { Repository } from './src/core/database';
    export { saveGenerationConfig } from './src/core/generation-config';
    export { resolveFanqieArtistCreation } from './src/core/fanqie-artist';
    export { createFanqieArtists } from './src/main/fanqie/artist-creation';
    export { FanqieCatalogSession } from './src/main/fanqie/catalog-session';
    export { FanqieUploadBroker } from './src/main/fanqie/upload-broker';
  ` }, bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
});
const mod = { exports: {} };
compileFunction(outputFiles[0].text, ["module", "exports", "require", "__dirname"])(
  mod, mod.exports, createRequire(import.meta.url), process.cwd(),
);
const { Repository, saveGenerationConfig, resolveFanqieArtistCreation,
  createFanqieArtists, FanqieCatalogSession, FanqieUploadBroker } = mod.exports;

const origin = "https://www.novelfm.com";
const rosterPath = "/creator/music/account/artist";
const listPath = "/api/author/home/get_owned_artist_list/v0/";
const addPath = "/api/author/home/add_artist_v2/v0/";
const accountId = "123456789";
const rosterForm = `<meta charset="utf-8"><style>
  .arco-checkbox { display:inline-block; position:relative; padding:4px }
  .arco-checkbox > input[type="checkbox"] { position:absolute; width:0; height:0; opacity:0 }
  </style><header class="page-header"><button id="new"><span>新增艺人</span></button></header>
  <input placeholder="请输入艺人名"><div class="list-content"></div>
  <div class="pagination-container"><button class="arco-pagination-item-next">下一页</button></div>
  <section role="dialog" class="arco-modal" hidden><h2>添加自定义艺人</h2>
    <div class="avatar-upload-container"><button class="image-upload-btn">上传封面 1:1</button><div class="upload-img-item"></div></div>
    <input placeholder="请输入艺人名称">
    <label class="arco-checkbox"><input type="checkbox" value="1"><span>词曲作者</span></label>
    <label class="arco-checkbox"><input type="checkbox" value="3"><span>制作人</span></label>
    <label class="arco-checkbox"><input type="checkbox" value="2"><span>歌手</span></label>
    <button id="add" disabled>确认添加</button>
  </section>
  <script>
    const modal = document.querySelector('.arco-modal'), search = document.querySelector('[placeholder="请输入艺人名"]');
    const preview = modal.querySelector('.upload-img-item'), name = modal.querySelector('[placeholder="请输入艺人名称"]');
    const add = modal.querySelector('#add');
    let timer, pageNumber = 0;
    async function load(index) {
      pageNumber = index;
      const query = new URLSearchParams({ name_like: search.value, page_no: index });
      const reply = await (await fetch('${listPath}?' + query)).json();
      document.querySelector('.list-content').textContent = reply.data?.artist_list.map(row => row.name).join(',') || '暂无艺人';
    }
    search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => load(0), 150); });
    name.oninput = () => { add.disabled = !name.value.trim(); };
    document.querySelector('.arco-pagination-item-next').onclick = () => load(pageNumber + 1);
    document.querySelector('#new').onclick = () => {
      name.value = ''; add.disabled = true; preview.replaceChildren(); modal.hidden = false;
      modal.querySelectorAll('input[type=checkbox]').forEach(role => role.checked = false);
    };
    modal.querySelector('.image-upload-btn').onclick = () => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/jpeg,image/png,image/jpg';
      input.onchange = async () => {
        const local = URL.createObjectURL(input.files[0]);
        const mask = document.createElement('div');
        mask.className = 'upload-img-item-mask'; mask.textContent = '上传中...';
        const image = document.createElement('img');
        image.src = local;
        preview.append(mask, image);
        const reply = await (await fetch('/fixture/avatar', { method: 'POST', body: input.files[0] })).json();
        if (reply.code !== 0) { mask.textContent = '上传失败'; return; }
        image.src = reply.data.avatar_url;
        mask.remove();
        URL.revokeObjectURL(local);
      };
      input.click();
    };
    add.onclick = async () => {
      const image = preview.querySelector('img');
      const submitted = { name: name.value, avatar_uri: image?.src,
        musician_type_list: [...modal.querySelectorAll('input:checked')].map(role => Number(role.value)) };
      const avatarReady = image?.complete && image.naturalWidth > 0 && image.src.startsWith('https:') &&
        !preview.querySelector('.upload-img-item-mask');
      await fetch('/fixture/artist-confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...submitted, avatarReady }) });
      const reply = await (await fetch('${addPath}', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submitted) })).json();
      if (reply.code === 0) { modal.hidden = true; await load(0); }
    };
  </script>`;

test("artist creation uses the selected image model and the shared artist voice", t => {
  const repo = new Repository(":memory:");
  t.after(() => repo.close());
  const account = randomUUID(), other = randomUUID(), artist = randomUUID();
  const defaultProfile = randomUUID(), selectedProfile = randomUUID();
  repo.save("accounts", { id: account, provider: "fanqie", name: "番茄账号" });
  repo.save("accounts", { id: other, provider: "fanqie", name: "另一账号" });
  const row = { id: artist, name: "本地副本", accountId: account, revision: 2,
    profile: { singer: "歌手甲", gender: "male" }, secondSinger: { name: "歌手乙" },
    defaults: { coverResolution: 1360, voice: "female" } };
  repo.save("accountLocalArtists", row);
  repo.save("settings", { id: "api-profile:" + defaultProfile, kind: "image", label: "默认图片 API", providerId: "zhipu_image",
    modelId: "cogview-3-flash", executionEnabled: false, revision: 1 });
  repo.save("settings", { id: "api-profile:" + selectedProfile, kind: "image", label: "方舟图片 API", providerId: "doubao_image",
    modelId: "doubao-seedream-5-5-261028", executionEnabled: false, revision: 3 });
  saveGenerationConfig(repo, { role: "image", profileId: defaultProfile, expectedRevision: 0 });
  const studio = { repo, mode: "production" };
  const identity = { accountId: account, artistId: artist, expectedRevision: 2, confirmed: true };
  const avatarImage = { profileId: selectedProfile, expectedRevision: 3,
    providerId: "doubao_image", modelId: "doubao-seedream-5-0-pro-260628" };
  const request = { ...identity, avatarImage };
  assert.deepEqual(resolveFanqieArtistCreation(studio, request), {
    singers: [{ version: "A", name: "歌手甲" }, { version: "B", name: "歌手乙" }], coverResolution: 1360,
    avatarVoice: "male",
    avatarProfile: { profileId: selectedProfile, expectedRevision: 3, modelId: avatarImage.modelId },
  });
  assert.equal(repo.get("settings", "api-profile:" + selectedProfile).modelId, "doubao-seedream-5-5-261028");
  assert.throws(() => resolveFanqieArtistCreation(studio, { ...request, accountId: other }), /ARTIST_ACCOUNT_MISMATCH/);
  assert.throws(() => resolveFanqieArtistCreation(studio, { ...request, expectedRevision: 1 }), /REVISION_CONFLICT/);
  assert.throws(() => resolveFanqieArtistCreation(studio, { ...request, confirmed: false }));
  assert.throws(() => resolveFanqieArtistCreation(studio, identity));
  assert.throws(() => resolveFanqieArtistCreation(studio, { ...identity, avatarImage: { ...avatarImage, expectedRevision: 2 } }), /REVISION_CONFLICT/);
  assert.throws(() => resolveFanqieArtistCreation(studio, { ...identity, avatarImage: { ...avatarImage, providerId: "zhipu_image" } }), /IMAGE_PROFILE_REQUIRED/);
  assert.throws(() => resolveFanqieArtistCreation(studio, { ...identity, avatarImage: { ...avatarImage, modelId: "glm-image" } }), /IMAGE_MODEL_REQUIRED/);
  repo.save("accountLocalArtists", { ...row, profile: { singer: "歌手甲" } });
  assert.equal(resolveFanqieArtistCreation(studio, request).avatarVoice, "female");
  repo.save("accountLocalArtists", { ...row, profile: { ...row.profile, gender: "other" } });
  assert.throws(() => resolveFanqieArtistCreation(studio, request), /FANQIE_ARTIST_AVATAR_VOICE_REQUIRED/);
});

test("the dedicated browser searches both versions, uploads only missing avatars, verifies receipts and closes its tab", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rainfall-fanqie-artist-"));
  const browser = await launchHeadlessChromium(chromium);
  t.after(() => browser.close());
  const context = await browser.newContext({ serviceWorkers: "block" });
  const picture = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#843aa0" } }).jpeg().toBuffer();
  const singers = ["歌手甲外传", "现有歌手合唱", "现有歌手"];
  const generated = [], searches = [], uploaded = [], submitted = [], confirms = [], waits = [], loginUrls = [];
  let searchError = false, deferRoster = false, verifyUid = accountId, menuSelections = 0;
  let menuCovered = false, rosterLoginRequired = false;
  let avatarPreviewUrl = origin + "/fixture/uploaded.jpg";
  let uploadFails = false, uncheckBeforeConfirm = false;
  const home = `<div class="user-box" style="position:fixed;bottom:16px;left:16px;width:180px;padding:12px">账号</div>
    <div class="user-box-menu" hidden style="position:fixed;bottom:16px;left:230px;padding:12px">
      <div class="user-box-menu-item"><a href="${rosterPath}">艺人信息</a></div>
    </div><script>
      const account = document.querySelector('.user-box');
      const menu = document.querySelector('.user-box-menu');
      let enter, leave;
      account.onmouseenter = () => { clearTimeout(leave); enter = setTimeout(() => { menu.hidden = false; }, 100); };
      account.onmouseleave = () => { clearTimeout(enter); leave = setTimeout(() => { menu.hidden = true; }, 100); };
      menu.onmouseenter = () => clearTimeout(leave);
      menu.onmouseleave = () => { menu.hidden = true; };
      menu.querySelector('a').onclick = async event => {
        event.preventDefault();
        await fetch('/fixture/artist-menu');
        location.href = '${rosterPath}';
      };
    </script>`;
  const homepage = () => home + (menuCovered ? '<div style="position:fixed;inset:0;z-index:10">首页引导</div>' : '');
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    const html = body => route.fulfill({ contentType: "text/html; charset=utf-8", body });
    if (url.pathname === "/creator/music/login") {
      loginUrls.push(url.href);
      return html(url.searchParams.has("invite_code")
        ? "<script>setTimeout(() => history.replaceState(null, '', '/creator/music/home'), 150)</script>" + homepage()
        : '<input placeholder="请输入手机号"><input placeholder="请输入验证码"><button>登录/注册</button>');
    }
    if (url.pathname === "/creator/music/home") return html(homepage());
    if (url.pathname === "/fixture/artist-menu") {
      menuSelections++;
      return route.fulfill({ status: 204 });
    }
    if (url.pathname === "/creator/music/account/profile") return html('<div class="profile-desc"><span>UID</span> ' + verifyUid + '</div>');
    if (url.pathname === rosterPath) {
      if (rosterLoginRequired) return route.fulfill({ status: 302, headers: { location: origin + "/creator/music/login" } });
      return html(rosterForm);
    }
    if (url.pathname === listPath) {
      const name = url.searchParams.get("name_like"), index = Number(url.searchParams.get("page_no"));
      searches.push([name, index]);
      const rows = singers.filter(singer => singer.includes(name));
      return route.fulfill({ json: searchError ? { code: 1 } :
        { code: 0, data: { artist_list: rows.slice(index, index + 1).map(name => ({ name })), total_count: String(rows.length) } } });
    }
    if (url.pathname === "/fixture/avatar") {
      uploaded.push(await sharp(route.request().postDataBuffer()).metadata());
      return route.fulfill({ json: uploadFails ? { code: 1 } : { code: 0, data: { avatar_url: avatarPreviewUrl } } });
    }
    if (url.pathname === "/fixture/uploaded.jpg") {
      await new Promise(resolve => setTimeout(resolve, 300));
      return route.fulfill({ contentType: "image/jpeg", body: picture });
    }
    if (url.pathname === "/fixture/artist-confirm") {
      confirms.push(route.request().postDataJSON());
      return route.fulfill({ status: 204 });
    }
    if (url.pathname === addPath) {
      const body = route.request().postDataJSON();
      submitted.push(body);
      if (!deferRoster) singers.unshift(body.name);
      return route.fulfill({ json: { code: 0 } });
    }
    return route.abort();
  });
  const accountKey = createHash("sha256").update("fanqie:" + accountId).digest("hex");
  const options = { root, available: () => true, generation: () => 1 };
  const catalog = new FanqieCatalogSession({ ...options, launch: async () => context,
    verifyAccount: key => { if (key !== accountKey) throw Error("FANQIE_ACCOUNT_IDENTITY_MISMATCH"); } });
  const broker = new FanqieUploadBroker({ ...options, session: catalog });
  await catalog.ui("open");
  context.on("page", page => { if (menuCovered) page.setDefaultTimeout(1_500); });
  const originalPage = context.pages()[0];
  const avatarProfile = { profileId: randomUUID(), expectedRevision: 2, modelId: "doubao-seedream-5-0-pro-260628" };
  const scope = { coverResolution: 1360, avatarVoice: "male", avatarProfile,
    singers: [{ version: "A", name: "歌手甲" }, { version: "B", name: "现有歌手" }] };
  const run = (draft = scope) => broker.withArtistCreation(page => createFanqieArtists(draft, {
    ...page, assertSelection: async () => {},
    async verifyAccount() {
      const key = await page.verifyAccount();
      if (uncheckBeforeConfirm) {
        const modal = page.page.locator(".arco-modal");
        if (await modal.locator("input:checked").count() === 3) {
          await modal.locator('label').filter({ hasText: "歌手" }).click();
        }
      }
      return key;
    },
    credentials: { apiCredentialStatus: async () => ({ configured: true }), async generatePlanCover(profile, prompt, beforeSend, guard, resolution) {
      await beforeSend(); guard();
      generated.push({ profile, prompt, resolution });
      return picture;
    } },
    wait: async ms => { waits.push(ms); },
  }));

  assert.deepEqual(await run(), { artists: [
    { version: "A", name: "歌手甲", status: "created" }, { version: "B", name: "现有歌手", status: "existing" },
  ] });
  assert.equal(loginUrls[0], origin + "/creator/music/login?invite_code=ZZYFID");
  assert.equal(menuSelections, 1);
  assert.deepEqual(generated.map(({ profile, resolution }) => [profile, resolution]), [[avatarProfile, 1360]]);
  assert.match(generated[0].prompt, /成年男性.*头肩肖像/u);
  assert.doesNotMatch(generated[0].prompt, /成年女性|自然风景|无人物/u);
  assert.deepEqual(uploaded.map(({ width, height, format }) => [width, height, format]), [[1360, 1360, "jpeg"]]);
  assert.deepEqual(submitted.map(({ name, musician_type_list }) => [name, musician_type_list]), [["歌手甲", [1, 3, 2]]]);
  assert.deepEqual(confirms, [{ ...submitted[0], avatarReady: true }]);
  assert.deepEqual(waits, [10_000]);
  assert.deepEqual(context.pages(), [originalPage]);

  menuCovered = true;
  const searchedBeforeFallback = searches.length;
  assert((await run()).artists.every(artist => artist.status === "existing"));
  assert.equal(menuSelections, 1);
  assert.deepEqual(searches.slice(searchedBeforeFallback), [["歌手甲", 0], ["现有歌手", 0], ["现有歌手", 1]]);
  assert.deepEqual(context.pages(), [originalPage]);
  assert.equal(generated.length, 1);

  rosterLoginRequired = true;
  const searchedBeforeLogin = searches.length;
  await assert.rejects(run(), /FANQIE_ARTIST_LOGIN_REQUIRED/);
  assert.equal(searches.length, searchedBeforeLogin);
  assert.equal(generated.length, 1);
  assert.equal(submitted.length, 1);
  assert(context.pages().some(page => page.url() === origin + "/creator/music/login"));
  rosterLoginRequired = false;
  menuCovered = false;

  searchError = true;
  await assert.rejects(run(), /FANQIE_ARTIST_SEARCH_UNVERIFIED/);
  assert.equal(submitted.length, 1);
  searchError = false;
  deferRoster = true;
  avatarPreviewUrl = "/fixture/uploaded.jpg";
  const alternate = { ...scope, singers: [{ version: "A", name: "待回执的新艺人" }] };
  await assert.rejects(run(alternate), /FANQIE_ARTIST_CREATE_UNCONFIRMED/);
  assert.equal(generated.at(-1).prompt, generated[0].prompt);
  await assert.rejects(run(alternate), /FANQIE_ARTIST_CREATE_UNCONFIRMED/);
  assert.equal(generated.length, 2);
  assert.equal(submitted.length, 2);
  singers.push(alternate.singers[0].name);
  assert.equal((await run(alternate)).artists[0].status, "existing");
  assert.equal(submitted.length, 2);
  verifyUid = "999999999";
  await assert.rejects(run(), /FANQIE_ACCOUNT_IDENTITY_MISMATCH/);
  assert.equal(generated.length, 2);
  assert(searches.some(([name, page]) => name === "现有歌手" && page === 1));

  verifyUid = accountId;
  deferRoster = false;
  const newVersions = { ...scope, avatarVoice: "female",
    singers: [{ version: "A", name: "新歌手甲" }, { version: "B", name: "新歌手乙" }] };
  await assert.rejects(run({ ...newVersions, coverResolution: 800 }), /FANQIE_ARTIST_AVATAR_RESOLUTION/);
  assert.equal(generated.length, 2);
  assert.deepEqual((await run(newVersions)).artists.map(({ status }) => status), ["created", "created"]);
  assert.deepEqual(submitted.slice(-2).map(({ name }) => name), ["新歌手甲", "新歌手乙"]);
  for (const image of generated.slice(-2)) {
    assert.deepEqual(image.profile, avatarProfile);
    assert.match(image.prompt, /成年女性.*头肩肖像/u);
    assert.doesNotMatch(image.prompt, /成年男性|自然风景|无人物/u);
  }

  const incomplete = { ...scope, singers: [{ version: "A", name: "待核对艺人" }] };
  uploadFails = true;
  await assert.rejects(run(incomplete), /FANQIE_ARTIST_AVATAR_UPLOAD/);
  uploadFails = false;
  uncheckBeforeConfirm = true;
  await assert.rejects(run(incomplete), /FANQIE_ARTIST_FORM_CHANGED/);
  assert.deepEqual(confirms, submitted.map(artist => ({ ...artist, avatarReady: true })));
  const draft = context.pages().at(-1).locator(".arco-modal");
  assert.equal(await draft.getByPlaceholder("请输入艺人名称").inputValue(), incomplete.singers[0].name);
  assert.equal(await draft.locator("input:checked").count(), 2);
  assert.deepEqual(fs.readdirSync(path.join(root, "production", "fanqie", "artist-creation")), []);
});
