import test from "node:test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { compileFunction } from "node:vm";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { launchHeadlessChromium } from "../scripts/lib/headless-chromium.mjs";
import { scrollWithPinnedClose } from "./fixtures/pinned-close.mjs";

test("account management scopes the artist roster and edits it in a right panel", async t => {
  const [core, renderer] = await Promise.all([
    build({
      stdin: {
        contents: "export {Studio, baseDefaults} from './src/core/studio'; export {Repository} from './src/core/database';",
        resolveDir: process.cwd(),
      },
      bundle: true, write: false, platform: "node", packages: "external", format: "cjs",
    }),
    build({ entryPoints: ["src/renderer/main.tsx"], bundle: true, write: false, outdir: "build" }),
  ]);
  const compiled = { exports: {} };
  compileFunction(core.outputFiles[0].text, ["module", "exports", "require", "__dirname"])(
    compiled, compiled.exports, createRequire(import.meta.url), path.resolve("build"),
  );
  const { Studio, Repository, baseDefaults } = compiled.exports;
  const studio = Object.create(Studio.prototype);
  studio.repo = new Repository(":memory:");
  studio.mode = "simulation";
  t.after(() => studio.repo.close());
  const call = studio.call.bind(studio);
  const addAccount = (name, provider = "fanqie") => call("account.save", { name, provider, dailyLimit: 3 });
  const first = await addAccount("素素");
  const second = await addAccount("其他账号");
  const pule = await addAccount("谱乐原账号", "yourmusic");
  const openedAccounts = [];
  const deletedAccounts = [];
  const createdProfiles = [];
  const avatarProfiles = [
    { id: randomUUID(), kind: "image", providerId: "zhipu_image", label: "默认图像 API",
      modelId: "cogview-3-flash", revision: 1, executionEnabled: false },
    { id: randomUUID(), kind: "image", providerId: "doubao_image", label: "方舟图像 API",
      modelId: "doubao-seedream-5-5-261028", revision: 3, executionEnabled: false },
  ];
  const loginStates = new Map([[first.id, "valid"], [second.id, "expired"]]);
  await call("platformConfig.setAccount", { target: "fanqie", accountId: second.id, expectedRevision: 0 });
  await call("downloadArchive.setAccount", { accountId: second.id, expectedRevision: 0 });
  const uploadSettings = new Map();
  const addArtist = (singer, accountId) => call("accountLocalArtist.save", {
    defaults: baseDefaults,
    profile: { lyricist: "词作者甲", composer: "曲作者乙", singer, contractMode: "non_exclusive" },
    promptTemplateId: null,
    ...(accountId ? { accountId } : {}),
  });
  await addArtist("素素的歌手", first.id);
  const secondArtist = await addArtist("另一位歌手", second.id);
  const retainedCredits = { [secondArtist.id]: { lyricist: "原词作者", composer: "原曲作者", singer: "原歌手" } };
  uploadSettings.set(second.id, { version: 1, authors: retainedCredits[secondArtist.id], artistAuthors: retainedCredits,
    publicationConsent: true, useWorkMaterials: true });
  const legacy = await addArtist("未关联的旧艺人");
  const puleArtist = await addArtist("谱乐原有艺人", pule.id);

  const browser = await launchHeadlessChromium(chromium);
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1663, height: 900 } });
  page.setDefaultTimeout(4500);
  await page.exposeFunction("fanqieFixtureUpload", (action, { accountId, ...input }) => {
    if (action === "saveConfiguration") uploadSettings.set(accountId, input);
    return { ok: true, value: { configuration: uploadSettings.get(accountId) ?? null } };
  });
  await page.exposeFunction("artistFixtureCredentialStatus", ({ profileId }) => {
    const configured = profileId === avatarProfiles[1].id;
    return { ok: true, value: { profileId, configured, state: configured ? "stored_unverified" : "absent" } };
  });
  await page.exposeFunction("artistFixtureCall", async (method, input = {}) => {
    if (method === "runtime") return { ok: true, value: {} };
    if (method === "fanqie.artistCreate") {
      createdProfiles.push(input);
      return { ok: true, value: { artists: [
        { version: "A", name: "素素的歌手", status: "existing" },
        { version: "B", name: "B 版演唱者", status: "created" },
      ] } };
    }
    if (method === "accountSession.open" || method === "accountSession.status") {
      if (method === "accountSession.open") openedAccounts.push(input);
      const opened = openedAccounts.some(entry => entry.accountId === input.accountId);
      return { ok: true, value: { opened, savedProfile: opened,
        loginState: loginStates.get(input.accountId),
        ...(studio.get("accounts", input.accountId).provider === "yourmusic" ?
          { puleState: opened ? input.accountId === pule.id ? "signed_in" : "login_required" : "closed" } : {}) } };
    }
    if (method === "apiProfile.list" || method === "textConfig.list") return { ok: true, value: [] };
    if (method === "generationConfig.get") return { ok: true, value: { roles: {}, revision: 0 } };
    if (method === "snapshot") return { ok: true, value: {
      mode: "production", accounts: studio.all("accounts"), works: [], series: [], exceptions: [],
      resources: { finished: 0, cost: { available: 0, reserved: 0 }, candidate: { available: 0, reserved: 0, spent: 0 } },
      accountLocalArtists: await call("accountLocalArtist.list"), artists: studio.all("artists"),
      platformConfigurations: await call("platformConfig.list"),
      platformWorkflow: { profiles: avatarProfiles, defaults: { image: avatarProfiles[0].id } },
    } };
    try {
      if (!method.startsWith("accountLocalArtist.") && !["account.save", "account.delete", "promptLibrary.list"].includes(method))
        throw Error("Unexpected fixture call");
      if (method === "account.delete") deletedAccounts.push(input);
      return { ok: true, value: await call(method, input) };
    } catch (error) {
      return { ok: false, error: { code: error.message, message: error.message } };
    }
  });
  const url = "http://127.0.0.1/";
  await page.route("**/*", route => route.request().url() === url
    ? route.fulfill({ contentType: "text/html; charset=utf-8", body: '<!doctype html><html lang="zh-CN"><div id="root"></div></html>' })
    : route.abort());
  await page.addInitScript(() => { window.rainfall = { call: window.artistFixtureCall, fanqieUpload: window.fanqieFixtureUpload,
    apiCredentialStatus: window.artistFixtureCredentialStatus }; });
  await page.goto(url);
  await page.addStyleTag({ content: renderer.outputFiles.find(file => file.path.endsWith(".css")).text });
  await page.addScriptTag({ content: renderer.outputFiles.find(file => file.path.endsWith(".js")).text });
  await page.getByRole("button", { name: "配置中心", exact: true }).click();
  const tabs = page.getByRole("tablist", { name: "配置分类" }).getByRole("tab");
  await expect(tabs).toHaveText(["模型 API", "提示词管理", "下载目录", "诊断与历史", "外观"]);
  await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "账号管理", exact: true }).click();

  const roster = page.getByRole("region", { name: "艺人信息", exact: true });
  const accountList = page.getByRole("region", { name: "平台账号列表" });
  const drawer = page.getByRole("region", { name: "艺人编辑", exact: true });
  await expect(accountList.getByRole("heading", { name: "平台账号", exact: true })).toBeVisible();
  await expect(accountList.getByRole("button", { name: "＋ 添加账号", exact: true })).toBeVisible();
  const accountDot = name => accountList.getByRole("button", { name, exact: true }).locator(".account-login-dot");
  await expect(accountDot("素素")).toHaveAttribute("data-state", "valid");
  await expect(accountDot("其他账号")).toHaveAttribute("data-state", "expired");
  const activeColor = await accountDot("素素").evaluate(dot => getComputedStyle(dot).backgroundColor);
  const expiredColor = await accountDot("其他账号").evaluate(dot => getComputedStyle(dot).backgroundColor);
  expect(activeColor).not.toEqual(expiredColor);
  await expect(roster.getByText("素素的歌手", { exact: true })).toBeVisible({ timeout: 2000 });
  await expect(roster.getByText("另一位歌手", { exact: true })).toHaveCount(0);
  await expect(roster.getByText("未关联的旧艺人", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "平台配置", exact: true })).toHaveCount(0);
  const openUploadAuthorization = () => page.getByText("番茄上传授权", { exact: true }).click();
  const saveUploadAuthorization = page.getByRole("button", { name: "保存上传授权", exact: true });
  await openUploadAuthorization();
  await expect(page.getByLabel("备用歌手")).toHaveValue("素素的歌手");
  await expect(saveUploadAuthorization).toBeDisabled();
  await page.getByRole("checkbox", { name: /允许上传已核对/ }).check();
  await saveUploadAuthorization.click();
  await expect(page.getByText("已保存上传授权", { exact: true })).toBeVisible();
  expect(uploadSettings.get(first.id).authorizationPreference.confirmContractManually).toBe(true);
  await openUploadAuthorization();

  await roster.getByRole("button", { name: "编辑 素素的歌手" }).click();
  const editor = drawer.getByRole("form", { name: /编辑艺人信息/ });
  await expect(editor).toBeVisible();
  const musicType = editor.getByRole("combobox", { name: "音乐类型", exact: true });
  await expect(musicType.locator("option")).toHaveText(["原创", "翻唱"]);
  await expect(musicType).toHaveValue("original");
  await musicType.selectOption("cover");
  await editor.getByRole("textbox", { name: "原唱", exact: true }).fill("原艺人");
  const songAttribute = editor.getByRole("combobox", { name: "歌曲属性", exact: true });
  const aiWork = editor.getByRole("combobox", { name: "是否为 AI 作品", exact: true });
  await expect(songAttribute.locator("option")).toHaveText(["请选择", "原版歌曲", "多版本歌曲"]);
  await expect(aiWork.locator("option")).toHaveText(["请选择", "是", "否"]);
  await expect(songAttribute).toHaveValue("");
  await expect(aiWork).toHaveValue("");
  await songAttribute.selectOption({ label: "多版本歌曲" });
  await editor.getByRole("textbox", { name: "关联原作品 ID", exact: true }).fill("987654321012345678");
  await aiWork.selectOption({ label: "是" });
  const copyrightProof = editor.getByRole("combobox", { name: "版权证明", exact: true });
  await expect(copyrightProof.locator("option")).toHaveText(["请选择", "是", "否"]);
  await expect(copyrightProof).toHaveValue("");
  await copyrightProof.selectOption({ label: "是" });
  const drawerBounds = await drawer.boundingBox();
  expect(drawerBounds.x + drawerBounds.width).toBe(1663);
  const timbre = await editor.getByLabel("音色", { exact: true }).boundingBox();
  const author = await editor.getByLabel("默认词作者", { exact: true }).boundingBox();
  expect(timbre.height).toBeLessThanOrEqual(author.height + 4);
  await editor.getByLabel("歌手数量").selectOption("2");
  await expect(editor.getByLabel("A 版歌手", { exact: true })).toHaveValue("素素的歌手");
  await editor.getByLabel("B 版歌手", { exact: true }).fill("B 版演唱者");
  await expect(editor.getByLabel(/性别/u)).toHaveCount(1);
  await editor.getByRole("combobox", { name: "性别", exact: true }).selectOption("female");
  await expect(editor.getByLabel(/^(音色|声线人设)$/u)).toHaveCount(1);
  await editor.getByLabel("音色", { exact: true }).fill("清亮");
  const timbreWeight = editor.getByRole("spinbutton", { name: "音色权重", exact: true });
  const styleWeight = editor.getByRole("spinbutton", { name: "风格权重", exact: true });
  await expect(timbreWeight).toHaveValue("");
  await expect(styleWeight).toHaveValue("");
  await timbreWeight.fill("-1");
  await styleWeight.fill("101");
  expect(await timbreWeight.evaluate(input => input.validity.rangeUnderflow)).toBe(true);
  expect(await styleWeight.evaluate(input => input.validity.rangeOverflow)).toBe(true);
  await timbreWeight.fill("0");
  await styleWeight.fill("72.5");
  await editor.getByRole("button", { name: "保存艺人信息", exact: true }).click();
  await expect(drawer).toHaveCount(0);
  await roster.getByRole("button", { name: "编辑 素素的歌手" }).click();
  await expect(musicType).toHaveValue("cover");
  await expect(songAttribute).toHaveValue("multi_version");
  await expect(editor.getByRole("textbox", { name: "原唱", exact: true })).toHaveValue("原艺人");
  await expect(editor.getByRole("textbox", { name: "关联原作品 ID", exact: true })).toHaveValue("987654321012345678");
  await expect(aiWork).toHaveValue("true");
  await expect(copyrightProof).toHaveValue("true");
  await expect(timbreWeight).toHaveValue("0");
  await expect(styleWeight).toHaveValue("72.5");
  const viewport = page.viewportSize();
  await page.setViewportSize({ ...viewport, height: 560 });
  const closeEditor = await scrollWithPinnedClose(styleWeight, editor.getByRole("button", { name: "关闭", exact: true }));
  await page.mouse.click(closeEditor.x, closeEditor.y);
  await expect(drawer).toHaveCount(0);
  await page.setViewportSize(viewport);

  await roster.getByRole("button", { name: "复制 素素的歌手", exact: true }).click();
  await expect(roster.getByText("素素的歌手（副本）", { exact: true })).toBeVisible();
  const copy = studio.all("accountLocalArtists").find(row => row.name === "素素的歌手（副本）");
  expect(copy.musicType).toBe("cover");
  expect(copy).toMatchObject({ songAttribute: "multi_version", isAiWork: true,
    originalSinger: "原艺人", originalWorkId: "987654321012345678" });
  expect(copy.hasCopyrightProof).toBe(true);
  expect(studio.get("artists", copy.id).musicType).toBe("cover");
  expect(copy.secondSinger).toEqual({ name: "B 版演唱者" });
  expect(copy.profile).toMatchObject({
    singer: "素素的歌手", gender: "female", voicePersona: "清亮", timbreWeight: 0, styleWeight: 72.5,
  });
  const original = studio.all("accountLocalArtists").find(row => row.name === "素素的歌手");
  const createProfile = roster.getByRole("button", { name: "艺人创建 素素的歌手", exact: true });
  await createProfile.click();
  const creation = page.getByRole("dialog", { name: "番茄艺人创建" });
  await expect(creation.getByText("A 版 · 素素的歌手", { exact: true })).toBeVisible();
  await expect(creation.getByText("B 版 · B 版演唱者", { exact: true })).toBeVisible();
  await expect(creation.getByText("女性头像", { exact: true })).toBeVisible();
  const model = creation.getByRole("combobox", { name: "图像模型", exact: true });
  const confirmCreation = creation.getByRole("button", { name: "确认创建", exact: true });
  await expect(model).toHaveValue("");
  await expect(confirmCreation).toBeDisabled();
  await model.selectOption("cogview-3-flash");
  await expect(creation.getByText(/保存该提供商的 API Key/)).toBeVisible();
  await expect(confirmCreation).toBeDisabled();
  expect(createdProfiles).toEqual([]);
  await model.selectOption("doubao-seedream-5-0-pro-260628");
  await confirmCreation.click();
  await expect(roster.getByRole("status")).toContainText("A 版已存在 · B 版已创建");
  expect(createdProfiles).toEqual([{ accountId: first.id, artistId: original.id, expectedRevision: original.revision, confirmed: true,
    avatarImage: { profileId: avatarProfiles[1].id, expectedRevision: 3, providerId: "doubao_image",
      modelId: "doubao-seedream-5-0-pro-260628" } }]);
  await accountList.getByRole("button", { name: "其他账号", exact: true }).click();
  await expect(roster.getByText("另一位歌手", { exact: true })).toBeVisible();
  await expect(roster.getByText("素素的歌手（副本）", { exact: true })).toHaveCount(0);
  await openUploadAuthorization();
  await expect(page.getByLabel("备用歌手")).toHaveValue("原歌手");
  await page.getByLabel("账号签约偏好").selectOption("nonexclusive");
  await saveUploadAuthorization.click();
  await expect(page.getByText("已保存上传授权", { exact: true })).toBeVisible();
  expect(uploadSettings.get(second.id).artistAuthors).toEqual(retainedCredits);
  expect(uploadSettings.get(first.id).authors.singer).toBe("素素的歌手");
  await openUploadAuthorization();

  await roster.getByRole("button", { name: "关联已有艺人", exact: true }).click();
  await drawer.getByRole("button", { name: "关联 未关联的旧艺人", exact: true }).click();
  await expect(roster.getByText("未关联的旧艺人", { exact: true })).toBeVisible();
  expect(studio.get("accountLocalArtists", legacy.id).accountId).toBe(second.id);

  await roster.getByRole("button", { name: /新增艺人/ }).click();
  const newArtist = drawer.getByRole("form", { name: "新增艺人信息", exact: true });
  const newMusicType = newArtist.getByRole("combobox", { name: "音乐类型", exact: true });
  await expect(newMusicType).toHaveValue("original");
  await newMusicType.selectOption("cover");
  const newSongAttribute = newArtist.getByRole("combobox", { name: "歌曲属性", exact: true });
  const newAiWork = newArtist.getByRole("combobox", { name: "是否为 AI 作品", exact: true });
  await newSongAttribute.selectOption({ label: "原版歌曲" });
  await newAiWork.selectOption({ label: "否" });
  const newCopyrightProof = newArtist.getByRole("combobox", { name: "版权证明", exact: true });
  await expect(newCopyrightProof).toHaveValue("");
  await newCopyrightProof.selectOption({ label: "否" });
  await newArtist.getByLabel("默认词作者").fill("词作者新");
  await newArtist.getByLabel("默认曲作者").fill("曲作者新");
  await newArtist.getByLabel("默认歌手", { exact: true }).fill("新增歌手");
  await newArtist.getByLabel("签约模式").selectOption("non_exclusive");
  const newTimbreWeight = newArtist.getByRole("spinbutton", { name: "音色权重", exact: true });
  const newStyleWeight = newArtist.getByRole("spinbutton", { name: "风格权重", exact: true });
  await expect(newTimbreWeight).toHaveValue("");
  await expect(newStyleWeight).toHaveValue("");
  await newTimbreWeight.fill("37.5");
  await newStyleWeight.fill("100");
  await newArtist.getByRole("button", { name: "保存艺人信息", exact: true }).click();
  await expect(roster.getByText("新增歌手", { exact: true })).toBeVisible();
  const createdArtist = studio.all("accountLocalArtists").find(row => row.name === "新增歌手");
  expect(createdArtist.musicType).toBe("cover");
  expect(createdArtist).toMatchObject({ songAttribute: "original", isAiWork: false });
  expect(createdArtist.hasCopyrightProof).toBe(false);
  expect(createdArtist.profile).toMatchObject({ timbreWeight: 37.5, styleWeight: 100 });
  await roster.getByRole("button", { name: /新增艺人/ }).click();
  await newArtist.getByRole("button", { name: "复制上一位艺人", exact: true }).click();
  await expect(newMusicType).toHaveValue("cover");
  await expect(newSongAttribute).toHaveValue("original");
  await expect(newAiWork).toHaveValue("false");
  await expect(newCopyrightProof).toHaveValue("false");
  await expect(newTimbreWeight).toHaveValue("37.5");
  await expect(newStyleWeight).toHaveValue("100");
  await newArtist.getByRole("button", { name: "取消", exact: true }).click();
  await roster.getByRole("button", { name: "编辑 新增歌手", exact: true }).click();
  await expect(copyrightProof).toHaveValue("false");
  await expect(timbreWeight).toHaveValue("37.5");
  await expect(styleWeight).toHaveValue("100");
  await timbreWeight.fill("");
  await musicType.selectOption("original");
  await editor.getByRole("button", { name: "保存艺人信息", exact: true }).click();
  await expect(drawer).toHaveCount(0);
  const editedArtist = studio.get("accountLocalArtists", createdArtist.id);
  expect(editedArtist.musicType).toBe("original");
  expect(editedArtist.profile.timbreWeight).toBeUndefined();
  expect(editedArtist.profile.styleWeight).toBe(100);
  await accountList.getByRole("button", { name: "素素", exact: true }).click();
  await expect(roster.getByText("新增歌手", { exact: true })).toHaveCount(0);

  const provider = page.getByRole("combobox", { name: "账号平台" });
  const session = page.getByRole("region", { name: "账号会话" });
  const login = session.getByRole("button", { name: "打开专属登录窗口" });
  await provider.selectOption("yourmusic");
  await expect(session.getByRole("heading")).toHaveText("谱乐原账号");
  await expect(roster).toHaveCount(0);
  await login.click();
  await expect(session.getByText("登录有效", { exact: true })).toBeVisible();
  await expect(accountDot("谱乐原账号")).toHaveAttribute("data-state", "valid");

  await accountList.getByRole("button", { name: "＋ 添加账号", exact: true }).click();
  await accountList.getByLabel("新账号备注").fill("谱乐新账号");
  await accountList.getByRole("button", { name: "保存账号", exact: true }).click();
  await expect(accountList.getByText("2 个账号", { exact: true })).toBeVisible();
  await expect(session.getByRole("heading")).toHaveText("谱乐新账号");
  await expect(session.getByText("窗口未打开", { exact: true })).toBeVisible();
  await expect(accountDot("谱乐新账号")).toHaveAttribute("data-state", "unknown");
  await expect(roster).toHaveCount(0);
  await login.click();
  await expect(session.getByText("请在窗口登录", { exact: true })).toBeVisible();
  await expect(accountDot("谱乐新账号")).toHaveAttribute("data-state", "expired");

  const added = studio.all("accounts").find(account => account.name === "谱乐新账号");
  expect(added.provider).toBe("yourmusic");
  expect(openedAccounts).toEqual([{ accountId: pule.id }, { accountId: added.id }]);
  expect(await call("accountLocalArtist.list", { accountId: added.id })).toEqual([]);
  expect(studio.get("accountLocalArtists", puleArtist.id).accountId).toBe(pule.id);
  await accountList.getByRole("button", { name: "谱乐原账号", exact: true }).click();
  await expect(session.getByText("登录有效", { exact: true })).toBeVisible();
  await provider.selectOption("fanqie");
  await expect(roster.getByText("素素的歌手", { exact: true })).toBeVisible();

  const remove = accountList.getByRole("button", { name: "删除账号 其他账号", exact: true });
  const confirmation = page.getByRole("dialog", { name: "删除平台账号" });
  await remove.click();
  await confirmation.getByRole("button", { name: "取消", exact: true }).click();
  expect(deletedAccounts).toEqual([]);
  await accountList.getByRole("button", { name: "其他账号", exact: true }).click();
  await remove.click();
  await confirmation.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(accountList.getByRole("button", { name: "其他账号", exact: true })).toHaveCount(0);
  await expect(session.getByRole("heading")).toHaveText("素素");
  expect(deletedAccounts).toEqual([{ accountId: second.id, confirmed: true }]);
  expect(studio.repo.maybe("accounts", second.id)).toBeUndefined();
  expect(studio.get("accountLocalArtists", secondArtist.id).accountId).toBeUndefined();
  expect(studio.get("artists", secondArtist.id).accountId).toBeUndefined();
  expect((await call("platformConfig.list")).find(row => row.target === "fanqie").accountId).toBeNull();
  expect((await call("downloadArchive.read")).accountId).toBeNull();
});
