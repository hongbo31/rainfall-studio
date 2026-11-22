import test from "node:test";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { launchHeadlessChromium } from "../scripts/lib/headless-chromium.mjs";
import { scrollWithPinnedClose } from "./fixtures/pinned-close.mjs";

test("creation center lists recordings without parent rows and opens each version's details", async (t) => {
  const { outputFiles } = await build({
    entryPoints: ["src/renderer/main.tsx"],
    bundle: true,
    write: false,
    outdir: "build",
  });
  const browser = await launchHeadlessChromium(chromium);
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1338, height: 1110 } });
  page.setDefaultTimeout(4000);
  const url = "http://rainfall.test/";
  await page.route("**/*", route => route.request().url() === url
    ? route.fulfill({ contentType: "text/html; charset=utf-8", body: '<!doctype html><html lang="zh-CN"><div id="root"></div></html>' })
    : route.abort());

  await page.addInitScript(() => {
    const audioB = "00000000-0000-4000-8000-000000000001";
    const certificate = "00000000-0000-4000-8000-000000000002";
    const audioA = "00000000-0000-4000-8000-000000000003";
    const work = {
      artistId: "artist", revision: 1, prompt: "民谣", rights: "", story: "", ai: "unknown",
      config: { genre: "民谣", voice: "female" }, assets: {}, assetHistory: [],
    };
    const data = {
      mode: "production",
      artists: [{ id: "artist", name: "测试音乐人", defaults: {} }],
      works: [
        { ...work, id: "generated", title: "雨中来信", alternateTitle: "晚风回信", lyrics: "等你回来", provider: "yourmusic",
          assets: { audio_A: audioA, audio_B: audioB, cover: "cover-a", cover_B: "cover-b", certificate },
          artistSnapshot: { id: "artist", defaults: { recordingSingers: { A: "歌手甲", B: "歌手乙" } } },
          audioVersions: [{ assetId: audioA, actualLyrics: { text: "A 版实际歌词" } }, { assetId: audioB, actualLyrics: { text: "B 版实际歌词" } }] },
        { ...work, id: "existing", title: "晨光练习", lyrics: "走过清晨", assets: { audio_B: "legacy-b", cover: "legacy-cover" } },
        { ...work, id: "draft-only", title: "无音频草稿", lyrics: "创作中" },
      ],
      resources: { finished: 0, cost: { available: 0, reserved: 0 }, candidate: { available: 0, spent: 0, reserved: 0 } },
      series: [], exceptions: [], revisions: [], runs: [], accounts: [], bindings: [], batches: [], units: [], targets: [],
      assets: [audioA, audioB].map(id => ({ id, kind: "audio", ext: "wav", metadata: { duration: "90" } })),
    };
    const replies = {
      snapshot: data,
      runtime: {},
      "apiProfile.list": [],
      "generationConfig.read": { roles: { image: null, music: null } },
      "creationTasks.taskStatus": [
        { planId: "completed", workId: "generated", title: "雨中来信", style: "民谣", state: "completed" },
        { planId: "pending", title: "等待生成", style: "民谣", state: "pending" },
      ],
      "lyrics.preview": null,
    };
    window.rainfall = {
      call: async (method, input) => {
        if (method === "publish.selection.save") {
          window.testPublishSelection = input;
          return { ok: true, value: input };
        }
        if (method === "series.save") {
          window.testSeriesInput = input;
          const series = { ...input, id: "new-series" };
          data.series.push(series);
          return { ok: true, value: series };
        }
        if (method === "work.save") {
          const saved = data.works.find(item => item.id === input.id);
          if (saved.revision !== input.expected) throw Error("REVISION_CONFLICT");
          Object.assign(saved, input, { revision: input.expected + 1 });
          return { ok: true, value: saved };
        }
        if (!(method in replies)) throw Error(`Unexpected call: ${method}`);
        return { ok: true, value: replies[method] };
      },
      exportFile: async (kind, input) => {
        window.testWorkExport = { kind, input };
        return { ok: true, value: { notice: "已保存文件" } };
      },
      openOfficial: async provider => {
        window.testOfficialPage = provider;
        return { ok: true, value: true };
      },
      pickImport: async (role, workId) => {
        window.testWorkImport = { role, workId };
        return { ok: true, value: null };
      },
    };
    Object.defineProperty(navigator, "clipboard", { value: {
      writeText: async text => {
        if (window.testClipboardDenied) throw Error("Clipboard unavailable");
        window.testAnalysisText = text;
      },
    } });
  });

  await page.goto(url);
  await page.addStyleTag({ content: outputFiles.find(file => file.path.endsWith(".css")).text });
  await page.addScriptTag({ content: outputFiles.find(file => file.path.endsWith(".js")).text });
  await page.getByRole("button", { name: "查看全部 →", exact: true }).click();
  await expect(page.getByRole("button", { name: "作品库", exact: true })).toHaveCount(0);

  const heading = page.getByRole("heading", { name: "创作中心", exact: true });
  const draftTitle = page.getByRole("form", { name: "歌曲编辑器" }).getByLabel("歌名", { exact: true });
  const list = page.getByRole("region", { name: "作品列表" });
  const search = list.getByLabel("搜索作品");
  const generatedA = list.getByRole("button", { name: "查看 A 版 雨中来信", exact: true });
  const generatedB = list.getByRole("button", { name: "查看 B 版 晚风回信", exact: true });
  const existing = list.getByRole("button", { name: "查看 B 版 晨光练习", exact: true });
  const detail = page.getByRole("region", { name: "作品详情", exact: true });
  await draftTitle.fill("还在写的新歌");
  await search.fill("民谣");
  await expect(list.getByText("等待生成")).toBeVisible();
  await expect(list.getByRole("button", { name: /等待生成/ })).toHaveCount(0);
  await expect(list.getByText("雨中来信", { exact: true })).toHaveCount(1);
  await expect(list.getByText("晚风回信", { exact: true })).toHaveCount(1);
  const legacyDraft = list.getByRole("button", { name: /无音频草稿/ });
  await expect(legacyDraft).toBeVisible();
  await legacyDraft.click();
  await expect(detail.getByRole("heading", { name: "无音频草稿", exact: true })).toBeVisible();
  await expect(detail.getByRole("button", { name: "导入音频 A", exact: true })).toBeVisible();
  await detail.getByRole("button", { name: "关闭详情", exact: true }).click();
  await expect(list.getByRole("button", { name: "查看 A 版 晨光练习", exact: true })).toHaveCount(0);
  await search.fill("晚风");
  await expect(generatedA).toHaveCount(0);
  await expect(generatedB).toBeVisible();
  await search.fill("民谣");
  await expect(detail).toHaveCount(0);

  await list.getByRole("button", { name: "更换封面 B 版 晚风回信", exact: true }).click();
  expect(await page.evaluate(() => window.testWorkImport)).toEqual({ role: "cover_B", workId: "generated" });
  await expect(detail).toHaveCount(0);

  await generatedA.click();
  await expect(heading).toBeVisible({ timeout: 2000 });
  await expect(detail.getByRole("heading", { name: "雨中来信", exact: true })).toBeVisible();
  await expect(detail.getByRole("img", { name: "雨中来信 封面" })).toHaveAttribute("src", /cover-a$/);
  await expect(detail.getByText("歌手甲", { exact: true })).toBeVisible();
  await detail.getByRole("button", { name: "试听", exact: true }).click();
  await expect(page.getByTestId("player-state")).toContainText("雨中来信 · A版");
  await expect(page.locator("#audio")).toHaveAttribute("src", /00000000-0000-4000-8000-000000000003$/);
  await generatedB.click();
  await expect(generatedA).toHaveAttribute("aria-expanded", "false");
  await expect(generatedB).toHaveAttribute("aria-expanded", "true");
  await expect(detail.getByRole("heading", { name: "晚风回信", exact: true })).toBeVisible();
  await expect(detail.getByRole("img", { name: "晚风回信 封面" })).toHaveAttribute("src", /cover-b$/);
  await expect(detail.getByText("歌手乙", { exact: true })).toBeVisible();
  await expect(detail.getByLabel("编辑歌名", { exact: true })).toHaveValue("晚风回信");
  await detail.getByRole("button", { name: "试听", exact: true }).click();
  await expect(page.getByTestId("player-state")).toContainText("晚风回信 · B版");
  await expect(page.locator("#audio")).toHaveAttribute("src", /00000000-0000-4000-8000-000000000001$/);
  await expect(detail.getByText("B 版实际歌词", { exact: true })).toBeVisible();
  await expect(detail.getByText("A 版实际歌词", { exact: true })).toHaveCount(0);
  await expect(detail.getByLabel("编辑歌词", { exact: true })).toHaveValue("等你回来");
  const listBounds = await list.boundingBox();
  const detailBounds = await detail.boundingBox();
  expect(detailBounds.x).toBeGreaterThanOrEqual(listBounds.x + listBounds.width);

  await detail.getByText("分享给 AI", { exact: true }).click();
  await expect(detail.getByRole("button", { name: "下载 A 版", exact: true })).toHaveCount(0);
  await detail.getByRole("button", { name: "下载 B 版", exact: true }).click();
  expect(await page.evaluate(() => window.testWorkExport)).toEqual({
    kind: "workAudio",
    input: { workId: "generated", version: "B", assetId: "00000000-0000-4000-8000-000000000001" },
  });
  await detail.getByRole("button", { name: "复制分析资料", exact: true }).click();
  const analysis = await page.evaluate(() => window.testAnalysisText);
  expect(analysis).toContain("晚风回信.wav");
  expect(analysis).not.toContain("雨中来信.wav");
  expect(analysis).toContain("等你回来");
  expect(analysis).toContain("音量");
  expect(analysis).toContain("音高");
  await page.evaluate(() => { window.testClipboardDenied = true; });
  await detail.getByRole("button", { name: "复制分析资料", exact: true }).click();
  await expect(detail.getByRole("textbox", { name: "分析资料 · 请手动复制" })).toHaveValue(analysis);

  await detail.getByRole("button", { name: "谱乐我的作品", exact: true }).click();
  expect(await page.evaluate(() => window.testOfficialPage)).toBe("yourmusicWorks");
  await detail.getByRole("button", { name: "下载已导入证书", exact: true }).click();
  expect(await page.evaluate(() => window.testWorkExport)).toEqual({
    kind: "workCertificate",
    input: { workId: "generated", assetId: "00000000-0000-4000-8000-000000000002" },
  });

  await existing.click();
  await expect(detail.getByRole("heading", { name: "晨光练习", exact: true })).toBeVisible();
  await expect(detail.getByRole("img", { name: "晨光练习 封面" })).toHaveAttribute("src", /legacy-cover$/);
  await expect(detail.getByLabel("编辑歌词", { exact: true })).toHaveValue("走过清晨");
  await expect(detail.getByRole("button", { name: "下载已导入证书", exact: true })).toHaveCount(0);
  await detail.getByText("分享给 AI", { exact: true }).click();
  await expect(detail.getByText("暂无可分享音频", { exact: true })).toBeVisible();
  await detail.getByRole("button", { name: "关闭详情", exact: true }).click();
  await expect(detail).toHaveCount(0);
  await expect(existing).toBeFocused();
  await expect(draftTitle).toHaveValue("还在写的新歌");
  await expect(search).toHaveValue("民谣");

  await generatedB.press("Enter");
  const close = detail.getByRole("button", { name: "关闭详情", exact: true });
  await expect(close).toBeFocused();
  await close.press("Escape");
  await expect(detail).toHaveCount(0);
  await expect(generatedB).toBeFocused();

  await page.setViewportSize({ width: 1000, height: 520 });
  await generatedB.click();
  await expect(close).toBeVisible();
  const compactBounds = await detail.boundingBox();
  const playerBounds = await page.getByRole("contentinfo").boundingBox();
  expect(compactBounds.x + compactBounds.width).toBe(1000);
  expect(compactBounds.y + compactBounds.height).toBeLessThanOrEqual(playerBounds.y);
  await detail.getByLabel("编辑歌名", { exact: true }).fill("晚风的新名字");
  await detail.getByRole("button", { name: "立即保存", exact: true }).click();
  await expect(detail.getByRole("heading", { name: "晚风的新名字", exact: true })).toBeVisible();
  const closeDetail = await scrollWithPinnedClose(detail.getByLabel("编辑歌名", { exact: true }), close);
  await page.mouse.click(closeDetail.x, closeDetail.y);
  await expect(detail).toHaveCount(0);
  await expect(generatedA).toBeVisible();
  await expect(list.getByRole("button", { name: "查看 B 版 晚风的新名字", exact: true })).toBeVisible();
  await expect(draftTitle).toHaveValue("还在写的新歌");
  await generatedA.click();
  await detail.getByRole("button", { name: "作品资料", exact: true }).click();
  await expect(detail.getByRole("button", { name: "准备发布材料 →", exact: true })).toBeVisible();
  const audioHelp = detail.getByRole("button", { name: "A/B 试听说明", exact: true });
  await audioHelp.focus();
  await expect(detail.getByRole("tooltip").filter({ visible: true })).toBeVisible();
  await audioHelp.press("Escape");
  await expect(detail).toBeVisible();
  await expect(detail.getByRole("tooltip").filter({ visible: true })).toHaveCount(0);
  await close.click();
  await list.getByRole("button", { name: "多选", exact: true }).click();
  await expect(list.getByRole("checkbox", { name: "选择 雨中来信", exact: true })).toHaveCount(1);
  await list.getByRole("checkbox", { name: "选择 雨中来信", exact: true }).check();
  await list.getByRole("checkbox", { name: "选择 无音频草稿", exact: true }).check();
  await expect(list.getByText("已选 2 首", { exact: true })).toBeVisible();
  await list.getByRole("button", { name: "批量发布", exact: true }).click();
  await expect(page.getByRole("region", { name: "选择音乐并发布" })).toBeVisible();
  expect(await page.evaluate(() => window.testPublishSelection.workIds)).toEqual(["generated", "draft-only"]);
  await page.getByRole("button", { name: "总览", exact: true }).click();
  await page.getByText("管理系列", { exact: true }).click();
  await page.getByLabel("新系列 / 专辑名", { exact: true }).fill("雨天系列");
  await page.getByLabel("故事线", { exact: true }).fill("从雨中到晴天");
  await page.getByRole("button", { name: "按当前选择顺序建立系列", exact: true }).click();
  await expect(page.getByText("雨中来信 → 无音频草稿", { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => window.testSeriesInput)).toEqual({
    title: "雨天系列", story: "从雨中到晴天", workIds: ["generated", "draft-only"],
  });
});
