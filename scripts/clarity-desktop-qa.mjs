import { _electron as electron, expect } from "@playwright/test";
import electronPath from "electron";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import sharp from "sharp";
import assert from "node:assert/strict";
import { build } from "esbuild";
const require = createRequire(import.meta.url),
  { Studio } = require("../build/core.cjs");
const run = path.resolve("output/playwright/clarity-" + randomUUID()),
  root = path.join(run, "data");
fs.mkdirSync(run, { recursive: true });
// Test-only Main: production source/renderer/IPC stay intact; suppress every
// window display/focus call before startup so this QA cannot take desktop focus.
const qaMain = path.resolve("build/clarity-qa-main.cjs");
await build({
  entryPoints: ["src/main/bootstrap.ts"],
  outfile: qaMain,
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  packages: "external",
  banner: { js: "globalThis.__qaSuppressedWindowCalls=[];" },
  plugins: [
    {
      name: "hidden-window-only",
      setup(builder) {
        builder.onLoad({ filter: /bootstrap\.ts$/ }, (args) => {
          let contents = fs.readFileSync(args.path, "utf8");
          assert(contents.includes("show: false"), "window must start hidden");
          let replaced = 0;
          contents = contents.replace(
            /window(?:\?)?\.(show|focus)\(\);/g,
            (_match, method) => {
              replaced++;
              return `globalThis.__qaSuppressedWindowCalls.push(${JSON.stringify(method)});`;
            },
          );
          assert.equal(
            replaced,
            5,
            "audit changed Main display paths before running",
          );
          return { contents, loader: "ts" };
        });
      },
    },
  ],
});
const tone = Buffer.alloc(44 + 32000);
tone.write("RIFF");
tone.writeUInt32LE(tone.length - 8, 4);
tone.write("WAVEfmt ", 8);
tone.writeUInt32LE(16, 16);
tone.writeUInt16LE(1, 20);
tone.writeUInt16LE(1, 22);
tone.writeUInt32LE(16000, 24);
tone.writeUInt32LE(32000, 28);
tone.writeUInt16LE(2, 32);
tone.writeUInt16LE(16, 34);
tone.write("data", 36);
tone.writeUInt32LE(32000, 40);
for (let i = 0; i < 16000; i++)
  tone.writeInt16LE(
    Math.round(Math.sin((i * 2 * Math.PI * 440) / 16000) * 500),
    44 + i * 2,
  );
const audioA = path.join(run, "fixture-a.wav"),
  audioB = path.join(run, "fixture-b.wav"),
  cover = path.join(run, "fixture.png");
fs.writeFileSync(audioA, tone);
tone.writeInt16LE(100, tone.length - 2);
fs.writeFileSync(audioB, tone);
await sharp({
  create: { width: 640, height: 640, channels: 3, background: "#716183" },
})
  .png()
  .toFile(cover);
const s = new Studio(root, "production"),
  artist = s.all("artists")[0];
const work = s.saveWork({
  title: "本地界面验收",
  artistId: artist.id,
  story: "隔离界面测试",
  lyrics: "[Verse]\n这只是本地测试歌词\n这只是本地测试歌词",
  prompt: "",
  parameters: {},
  rights: "",
  ai: "unknown",
});
const other = s.saveWork({
  ...work,
  id: undefined,
  title: "另一首待完善作品",
  lyrics: "",
  assets: undefined,
});
const a = await s.importFile(audioA, "audio_A", work.id),
  b = await s.importFile(audioB, "audio_B", work.id);
await s.importFile(cover, "cover", work.id);
const report = path.join(run, "report.csv"),
  updated = path.join(run, "report-updated.csv");
const csv =
  "platform,account,work,date,plays,favorites,comments\nqqmusic,账号甲,本地界面验收,2026-10-16,10,0,\nqqmusic,账号乙,另一首作品,2026-10-16,,0,2\nqqmusic,账号甲,本地界面验收,2026-10-15,300,9,7\nnetease,账号丙,第三首作品,2026-10-16,900,30,4\n";
fs.writeFileSync(report, csv);
fs.writeFileSync(updated, csv.replace("2026-10-16,10,0,", "2026-10-16,20,0,"));
await s.importReport(report);
s.close();
let app, page;
const screenshot=async(name)=>{const png=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined,{stayHidden:true,stayAwake:false})).toPNG().toString('base64'));assert(png.length>1000,'hidden capture must contain pixels');fs.writeFileSync(path.join(run,name),Buffer.from(png,'base64'));};
const errors = [],
  checks = [];
try {
  app = await electron.launch({
    executablePath: electronPath,
    args: [qaMain],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined,
      RAINFALL_DATA_ROOT: root,
      RAINFALL_MODE: "production",
    },
    timeout: 30000,
  });
  await app.evaluate(({ session }) => {
    globalThis.__clarityRequests = [];
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ["http://*/*", "https://*/*"] },
      (d, cb) => {
        globalThis.__clarityRequests.push(d.url);
        cb({ cancel: true });
      },
    );
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  page.on("pageerror", (e) => errors.push(e.message));
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1440, 1000),
  );
  const assertHidden = () =>
    app.evaluate(({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows();
      if (windows.some((w) => w.isVisible() || w.isFocused()))
        throw Error("QA_WINDOW_MUST_STAY_HIDDEN");
      return globalThis.__qaSuppressedWindowCalls;
    });
  await assertHidden();
  const nav = (name) =>
    page
      .locator("aside nav")
      .getByRole("button", { name, exact: true })
      .click();
  const rpc = (method, input = {}) =>
    page.evaluate(
      async ({ method, input }) => {
        const r = await window.rainfall.call(method, input);
        if (!r.ok) throw Error(r.error.code);
        return r.value;
      },
      { method, input },
    );
  await page.getByRole("button", { name: "聊聊新想法", exact: true }).waitFor();
  await expect(page.getByTestId("player-state")).toContainText("尚未选择试听");
  assert(await page.locator("#audio").isHidden());
  await screenshot('home.png');
  await page.getByRole("button", { name: "聊聊新想法", exact: true }).click();
  await page
    .getByLabel("本轮要求", { exact: true })
    .fill("只保存本地隔离想法，无需配置Key，不生成回复");
  await page.getByRole("button", { name: "保存想法", exact: true }).click();
  await expect
    .poll(async () =>
      (await rpc("conversation.list")).turns.some(
        (t) => t.instruction === "只保存本地隔离想法，无需配置Key，不生成回复",
      ),
    )
    .toBe(true);
  const conversation = await rpc("conversation.list");
  assert.equal(conversation.drafts.length, 0);
  assert.equal(conversation.turns.at(-1).state, "blocked");
  checks.push(
    "Home opens ideas; production saves idea without Key or fabricated AI output",
  );
  await nav("本地模板");
  await page
    .getByRole("heading", { name: "用本地模板起草", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "定时创建本地模板草稿", exact: true })
    .click();
  await page
    .getByRole("button", { name: "保存本地模板计划", exact: true })
    .waitFor();
  assert.equal((await rpc("snapshot")).plans.length, 0);
  checks.push(
    "Template and old scheduled-draft copy are explicit; QA enables no schedules",
  );
  await nav("作品库");
  await page.getByRole("heading", { name: work.title, exact: true }).click();
  const next = page.getByTestId("work-next-step");
  await expect(next).toContainText("试听并核对歌词与音频");
  await next
    .getByRole("button", { name: "试听并核对歌词与音频 →", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => document.activeElement.id))
    .toBe("track-lyrics");
  await page.getByTestId("work-next-step").scrollIntoViewIfNeeded();
  await screenshot('work-next-step.png');
  await page.locator("#audio").evaluate((el) => {
    el.muted = true;
  });
  await page.getByRole("button", { name: "▷ 试听 B", exact: true }).click();
  await expect(page.getByTestId("player-state")).toContainText("B版");
  await page.waitForFunction(() => {
    const el = document.getElementById("audio");
    return (
      el.readyState >= 2 && el.duration > 0 && (el.currentTime > 0 || el.ended)
    );
  });
  const publication = await rpc("publication.payload", { workId: work.id });
  assert.equal(publication.audio.assetId, a.id);
  assert.equal(publication.lyrics.alignmentConfirmed, false);
  assert.equal(
    await page.locator("#audio").getAttribute("src"),
    "media://asset/" + b.id,
  );
  checks.push(
    "Existing audio is not mislabeled missing; muted real B playback does not change publication A or lyric confirmation",
  );
  await page
    .getByRole("button", { name: "准备发布材料 →", exact: true })
    .click();
  await page
    .getByRole("button", { name: "腾讯音乐人草稿通道 →", exact: true })
    .waitFor();
  assert((await page.getByText(work.title, { exact: true }).count()) > 0);
  assert.equal(await page.getByText(other.title, { exact: true }).count(), 0);
  await page
    .getByRole("button", { name: "腾讯音乐人草稿通道 →", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "客户端浏览器连接", exact: true })
    .scrollIntoViewIfNeeded();
  await page
    .getByRole("button", { name: "只读检查浏览器连接", exact: true })
    .click();
  await page.getByText(/尚未连接用户已授权的浏览器会话/).waitFor();
  await screenshot('client-connection.png');
  checks.push(
    "Prepare carries only this work; Tencent external Chrome control is distinct from client connection, no live writes",
  );
  await nav("数据看板");
  const plays = page.getByTestId("metric-plays"),
    favorites = page.getByTestId("metric-favorites"),
    basis = page.getByRole("checkbox", {
      name: "我已核对当前报表的指标口径一致",
      exact: true,
    });
  await expect(plays.locator("strong")).toHaveText("—");
  await page.getByLabel("报表日期", { exact: true }).fill("2026-10-16");
  await page.getByLabel("统计平台", { exact: true }).selectOption("qqmusic");
  await expect(plays.locator("strong")).toHaveText("—");
  await basis.check();
  await expect(plays.locator("strong")).toHaveText("10");
  await expect(plays).toContainText("覆盖 1/2 条");
  await expect(favorites.locator("strong")).toHaveText("0");
  await page.getByLabel("报表日期", { exact: true }).fill("2026-10-15");
  await page.getByLabel("报表日期", { exact: true }).fill("2026-10-16");
  await expect(basis).not.toBeChecked();
  await basis.check();
  await page.getByLabel("统计平台", { exact: true }).selectOption("netease");
  await page.getByLabel("统计平台", { exact: true }).selectOption("qqmusic");
  await expect(basis).not.toBeChecked();
  await basis.check();
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, updated);
  await page
    .getByRole("button", { name: "＋ 导入 CSV 报表", exact: true })
    .click();
  await expect(basis).not.toBeChecked();
  await expect(plays.locator("strong")).toHaveText("—");
  await basis.check();
  await expect(plays.locator("strong")).toHaveText("20");
  await screenshot('report-coverage.png');
  await page.getByLabel("报表日期", { exact: true }).fill("2026-10-17");
  await expect(plays.locator("strong")).toHaveText("—");
  await expect(basis).toBeDisabled();
  await expect(plays).toContainText("未同步");
  checks.push(
    "Report date/platform gates, missing-vs-zero/coverage, roundtrip filters and source replacement invalidate basis confirmation",
  );
  assert.deepEqual(errors, []);
  const suppressedWindowCalls = await assertHidden();
  assert.deepEqual(suppressedWindowCalls, ["show"]);
  const requests = await app.evaluate(() => globalThis.__clarityRequests);
  assert.deepEqual(requests, []);
  fs.writeFileSync(
    path.join(run, "report.json"),
    JSON.stringify(
      {
        passed: true,
        checks,
        root,
        workId: work.id,
        rendererErrors: errors,
        observedElectronRequests: requests,
        realProviderCalls: 0,
        realPlatformUploads: 0,
        reviewSubmissions: 0,
        schedulesEnabled: 0,
        fixtureAudioMuted: true,
        hiddenWindow: true,
        suppressedWindowCalls,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, run, checks }, null, 2));
} catch (error) {
  if (page) {
    fs.writeFileSync(
      path.join(run, "failure.json"),
      JSON.stringify(
        {
          error: String(error),
          rendererErrors: errors,
          dom: await page
            .evaluate(() => ({
              title: document.title,
              content: document.getElementById("content")?.innerText,
              controls: [...document.querySelectorAll("textarea")].map(
                (el) => ({
                  ariaLabel: el.getAttribute("aria-label"),
                  labels: [...el.labels].map((label) => label.textContent),
                  value: el.value,
                }),
              ),
            }))
            .catch(() => null),
        },
        null,
        2,
      ),
    );
    await screenshot('failure.png').catch(()=>{});
  }
  console.error("QA evidence: " + run);
  throw error;
} finally {
  if (app) await app.close();
}
