import test from "node:test";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { launchHeadlessChromium } from "../scripts/lib/headless-chromium.mjs";

const { outputFiles } = await build({
  entryPoints: ["src/renderer/main.tsx"],
  bundle: true,
  write: false,
  outdir: "build",
});

async function lyricPage(t) {
  const browser = await launchHeadlessChromium(chromium);
  t.after(() => browser.close());
  const page = await browser.newPage();
  page.setDefaultTimeout(6000);
  const url = "http://127.0.0.1/";
  await page.route("**/*", route => route.request().url() === url
    ? route.fulfill({ contentType: "text/html", body: '<!doctype html><meta charset="utf-8"><div id="root"></div>' })
    : route.abort());
  const mount = async () => {
    await page.goto(url);
    await page.addStyleTag({ content: outputFiles.find(file => file.path.endsWith(".css")).text });
    await page.addScriptTag({ content: outputFiles.find(file => file.path.endsWith(".js")).text });
    await page.getByRole("button", { name: "AI作词", exact: true }).click();
  };
  return { page, mount };
}

test("vocal score settings and all result actions use the adopted highest-scoring lyric", async t => {
  const { page, mount } = await lyricPage(t);
  const original = {
    id: "original", title: "等灯", alternateTitle: "夜路的光", style: "民谣", language: "中文",
    lyrics: "[主歌]\n我在窗边等你",
    review: { score: 94, languageMatches: true, rubric: { styleFit: 20, narrative: 18, naturalness: 19, singability: 19, hook: 18 },
      findings: ["加入更具体的动作"] },
  };
  const rewrite = {
    ...original, id: "rewrite", lyrics: "[主歌]\n我把门灯调亮了一格", review: null,
  };
  const startingJob = {
    id: "job", state: "ready", phase: "rewrite", songType: "vocal", title: original.title,
    profileLabel: "离线夹具", modelId: "fixture", currency: "CNY", inspiration: "雨夜归家",
    targetScore: 95, maxRewrites: 1, rewrites: 0, spentMicros: 1000, budgetMicros: 10000, versions: [original],
  };
  await page.addInitScript(job => {
    window.fixture = { job, copied: "" };
    const snapshot = {
      mode: "production", artists: [], works: [], series: [], exceptions: [], revisions: [], runs: [], assets: [],
      accountLocalArtists: [{ id: "vocal", name: "带歌词艺人", defaults: { voice: "female" } },
        { id: "instrumental", name: "纯音乐艺人", defaults: { voice: "instrumental" } }],
      resources: { finished: 0, cost: { available: 0, reserved: 0 }, candidate: { available: 0, spent: 0, reserved: 0 } },
    };
    const responses = {
      snapshot: () => snapshot, runtime: () => ({}),
      "apiProfile.list": () => [],
      "generationConfig.read": () => ({ roles: { text: null, image: null, music: null } }),
      "promptLibrary.list": () => [],
      "lyricWriting.list": () => [window.fixture.job],
      "lyricWriting.read": () => window.fixture.job,
      "creationTasks.taskStatus": () => [],
    };
    window.rainfall = {
      call: async method => {
        if (!(method in responses)) throw Error("Unexpected call: " + method);
        return { ok: true, value: responses[method]() };
      },
      exportFile: async (kind, input) => {
        window.fixture.download = { kind, input };
        return { ok: true, value: { notice: "已保存到下载目录" } };
      },
    };
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async value => { window.fixture.copied = value; } },
    });
  }, startingJob);

  await mount();
  const target = page.getByRole("spinbutton", { name: "目标评分" });
  await expect(target).toHaveCount(0);
  await page.getByRole("button", { name: "按艺人信息", exact: true }).click();
  const artist = page.getByLabel("艺人信息", { exact: true });
  await artist.selectOption("instrumental");
  await expect(target).toHaveCount(0);
  await artist.selectOption("vocal");
  await expect(target).toHaveValue("90");
  await target.fill("95");
  await page.getByRole("button", { name: "查看", exact: true }).click();
  const lyrics = page.getByRole("textbox", { name: "歌词", exact: true });
  await expect(lyrics).toHaveValue(original.lyrics);
  await expect(page.getByText(/风格贴合 20\/20.*文本可唱性 19\/20/)).toBeVisible();

  const scoring = { ...startingJob, phase: "score", rewrites: 1, versions: [original, rewrite] };
  await page.evaluate(job => { window.fixture.job = job; }, scoring);
  await expect(page.getByText("第 1 轮改写", { exact: true })).toBeVisible();
  await expect(lyrics).toHaveValue(rewrite.lyrics);

  const final = { ...rewrite, review: { score: 87, languageMatches: true, findings: ["节奏仍可调整"] } };
  await page.evaluate(job => { window.fixture.job = job; }, {
    ...scoring, state: "complete", resultVersionId: original.id, versions: [original, final],
  });
  await expect(page.getByRole("heading", { name: "作词结果", exact: true })).toBeVisible();
  await expect(page.getByText(/采用最高分稿 · 94 分 · 目标 95 分/)).toBeVisible();
  await expect(lyrics).toHaveValue(original.lyrics);

  await page.getByText("查看该版歌词", { exact: true }).click();
  await expect(page.getByRole("textbox", { name: "第 2 版歌词" })).toHaveValue(final.lyrics);
  await expect(lyrics).toHaveValue(original.lyrics);

  await page.getByRole("button", { name: "复制歌词", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.fixture.copied)).toBe(original.lyrics);
  await page.getByRole("button", { name: "下载 TXT", exact: true }).click();
  expect(await page.evaluate(() => window.fixture.download)).toEqual({
    kind: "lyricResult", input: { jobId: startingJob.id, versionId: original.id },
  });

  await page.getByRole("button", { name: "返回 AI作词", exact: true }).click();
  await page.getByRole("button", { name: "查看", exact: true }).click();
  await expect(lyrics).toHaveValue(original.lyrics);
  await page.getByRole("button", { name: "快速生成", exact: true }).click();
  const editor = page.getByRole("form", { name: "歌曲编辑器" });
  await expect(editor.getByRole("textbox", { name: "歌词", exact: true })).toHaveValue(original.lyrics);
  await expect(editor.getByRole("textbox", { name: "A 版歌名", exact: true })).toHaveValue(original.title);
  await expect(editor.getByRole("textbox", { name: "B 版歌名", exact: true })).toHaveValue(original.alternateTitle);
});

test("inspiration mode follows platform, account and artist, then shows only the three generated fields", async t => {
  const { page, mount } = await lyricPage(t);
  await page.addInitScript(() => {
    const profile = { id: "text", kind: "text", providerId: "deepseek", label: "测试文本", modelId: "fixture", revision: 1, textPricing: {} };
    const snapshot = {
      mode: "production", artists: [], works: [], series: [], exceptions: [],
      resources: { finished: 0, cost: { available: 0, reserved: 0 }, candidate: { available: 0, spent: 0, reserved: 0 } },
      accounts: [
        { id: "susu", name: "素素", provider: "fanqie" },
        { id: "other", name: "另一账号", provider: "fanqie" },
        { id: "tme", name: "腾讯账号", provider: "tme" },
      ],
      accountLocalArtists: [
        { id: "susu-artist", accountId: "susu", name: "檐音", revision: 3, promptTemplateId: "prompt",
          profile: { singer: "檐音", lyricist: "词作者", contractMode: "exclusive" },
          defaults: { voice: "female", genre: "轻民谣", seriesStory: "从晚班回家的人" } },
        { id: "other-artist", accountId: "other", name: "别人的艺人", revision: 1 },
        { id: "tme-artist", accountId: "tme", name: "月琴", revision: 1, secondSinger: { name: "雪落" },
          profile: { singer: "月琴", "创作方向": "闽南语叙事" }, defaults: { language: "闽南语", coverResolution: 2048 } },
      ],
    };
    const reply = {
      state: "ready", phase: "generate", kind: "inspiration", musicianName: "檐音",
      profileLabel: "测试文本", modelId: "fixture", currency: "CNY", versions: [],
      inspiration: "", inspirationResult: null, spentMicros: 0, stopRequested: false,
    };
    let started;
    window.rainfall = {
      apiCredentialStatus: async () => ({ ok: true, value: { profileId: profile.id, configured: true, state: "present" } }),
      call: async (method, input) => {
        const responses = {
          snapshot: () => snapshot, runtime: () => ({}),
          "apiProfile.list": () => [profile],
          "generationConfig.read": () => ({ roles: { text: profile.id } }),
          "promptLibrary.list": () => [{ id: "prompt", name: "叙事模板" }],
          "lyricWriting.list": () => started ? [started] : [],
          "lyricWriting.startInspiration": () => {
            window.inspirationRequest = input;
            return started = { ...reply, id: input.id };
          },
          "lyricWriting.read": () => ({
            ...started, state: "complete", phase: "score",
            inspirationResult: { title: "晚班归途", alternateTitle: "替你留一盏灯", inspiration: "雨停后回家的脚步穿过巷口灯影。" },
          }),
        };
        if (!(method in responses)) throw Error("Unexpected call: " + method);
        return { ok: true, value: responses[method]() };
      },
    };
  });
  await mount();
  await expect(page.getByRole("button", { name: "灵感模式", exact: true })).toBeVisible({ timeout: 2000 });
  await expect(page.getByLabel("创作灵感", { exact: true })).toHaveCount(0);
  const platform = page.getByLabel("发布平台", { exact: true });
  const account = page.getByLabel("发布账号", { exact: true });
  const artist = page.getByLabel("艺人信息", { exact: true });
  const details = page.getByRole("region", { name: "艺人资料", exact: true });
  await expect(account).toBeDisabled();
  await expect(artist).toBeDisabled();
  await platform.selectOption("fanqie");
  await expect(account.getByRole("option", { name: "腾讯账号", exact: true })).toHaveCount(0);
  await account.selectOption("susu");
  await expect(artist.getByRole("option", { name: "别人的艺人", exact: true })).toHaveCount(0);
  await artist.selectOption("susu-artist");
  for (const value of ["从晚班回家的人", "轻民谣", "叙事模板", "词作者", "独家签约"])
    await expect(details.getByText(value, { exact: true })).toBeVisible();
  const consent = page.getByRole("checkbox", { name: /同意发送创作资料/ });
  await consent.check();
  await account.selectOption("other");
  await expect(artist).toHaveValue("");
  await expect(artist.getByRole("option", { name: "檐音", exact: true })).toHaveCount(0);
  await expect(details).toHaveCount(0);
  await expect(consent).not.toBeChecked();

  await platform.selectOption("qqmusic");
  await expect(account).toHaveValue("");
  await account.selectOption("tme");
  await artist.selectOption("tme-artist");
  await expect(details.getByText("轻民谣", { exact: true })).toHaveCount(0);
  for (const value of ["雪落", "闽南语", "2048 × 2048", "闽南语叙事"])
    await expect(details.getByText(value, { exact: true })).toBeVisible();
  await platform.selectOption("fanqie");
  await account.selectOption("susu");
  await artist.selectOption("susu-artist");
  const generate = page.getByRole("button", { name: "生成并评分", exact: true });
  await expect(generate).toBeDisabled();
  await consent.check();
  await generate.click();
  const result = page.getByRole("region", { name: "灵感结果", exact: true });
  await expect(result.getByLabel("歌名 1", { exact: true })).toHaveValue("晚班归途");
  await expect(result.getByLabel("歌名 2", { exact: true })).toHaveValue("替你留一盏灯");
  const inspiration = result.getByRole("textbox", { name: "灵感内容", exact: true });
  await expect(inspiration).toHaveValue("雨停后回家的脚步穿过巷口灯影。");
  await expect(result.getByRole("textbox")).toHaveCount(3);
  await expect(page.getByRole("heading", { name: "执行步骤", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "快速生成", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.inspirationRequest)).toEqual({
    id: expect.any(String), platform: "fanqie", accountId: "susu", artistId: "susu-artist", artistRevision: 3,
    profileId: "text", profileRevision: 1, followDefault: true, consent: true,
  });
  await page.getByRole("button", { name: "返回 AI作词" }).click();
  await expect(page.getByText("晚班归途 · 已完成", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "查看", exact: true }).click();
  await expect(inspiration).toHaveValue("雨停后回家的脚步穿过巷口灯影。");
});
