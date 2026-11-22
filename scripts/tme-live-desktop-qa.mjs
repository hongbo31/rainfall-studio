import { _electron as electron, expect } from "@playwright/test";
import electronPath from "electron";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createOwnedQaRun } from "./qa-owned-cleanup.mjs";
if (!process.argv.includes("--visible"))
  throw Error(
    "Use --visible; hidden capturePage QA is retired after a compositor hang.",
  );
const require = createRequire(import.meta.url),
  { Studio } = require("../build/core.cjs");
const runId = randomUUID();
const run = path.resolve("output/playwright/tme-live-" + runId),
  root = path.join(run, "data");
fs.mkdirSync(run, { recursive: true });
const main = path.resolve("build/tme-live-qa-" + runId + ".cjs");
const owned = createOwnedQaRun({runDirectory: run, entryPath: main, executablePath: electronPath});
await build({
  entryPoints: ["src/main/bootstrap.ts"],
  outfile: main,
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  banner: {js: owned.bootstrapBanner()},
});
const s = new Studio(root, "production"),
  artist = s.all("artists")[0],
  account = s.save("accounts", {
    id: randomUUID(),
    provider: "tme",
    name: "本地隔离验收备注",
    authStatus: "not_connected",
  });
const works = ["本地批次可用项", "本地批次待完善项"].map((title) =>
  s.saveWork({
    title,
    artistId: artist.id,
    story: "仅本地验收",
    lyrics: "原创接口测试歌词\n只在隔离测试中使用",
    prompt: "",
    parameters: {},
    rights: "测试原创",
    ai: "generated",
  }),
);
const wav = Buffer.alloc(44 + 32000);
wav.write("RIFF");
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(16000, 24);
wav.writeUInt32LE(32000, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(32000, 40);
const audio = path.join(run, "silent-fixture.wav");
fs.writeFileSync(audio, wav);
await s.importFile(audio, "audio_A", works[0].id);
const svc = s.tmeDraftService(),
  metadata = {
    lyricist: "fixture",
    composer: "fixture",
    ownLyricist: true,
    ownComposer: true,
    aiMusic: "yes",
    aiTool: "Suno",
    generatedOn: "2026-10-15",
    statement: "",
    proofAssetId: "",
    existingRemoteId: "",
    authorizationMode: "",
    lyrics: works[0].lyrics,
    albumId: "100",
    coverPolicy: "preserve_album",
  },
  input = {
    workId: works[0].id,
    accountId: account.id,
    metadata,
    confirmations: {},
  };
const p = svc.preview(input);
svc.prepare({
  ...input,
  confirmations: {
    rights: true,
    authors: true,
    ai: true,
    lyricsHash: p.lyricsHash,
    recordingHash: p.audio.sha256,
    reviewHash: p.reviewHash,
  },
});
s.close();
let app, page;
const errors = [],
  checks = [];
const report = { run, checks, errors, realReadOnly: false, platformWrites: 0 };
const unbindSignals=owned.bindSignals({close:()=>app?.close(),onCancel:signal=>{report.result="cancelled";report.failure=signal;}});
try {
  owned.markLaunching();
  try {
  app = await electron.launch({
    executablePath: electronPath,
    args: [main, ...owned.ownerArgs],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined,
      RAINFALL_DATA_ROOT: root,
      RAINFALL_MODE: "production",
    },
    timeout: 30000,
  });
  } finally { owned.markLaunched(); }
  report.ownership=await owned.capture();
  await app.evaluate(({ session }) => {
    globalThis.__qaNetwork = [];
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ["http://*/*", "https://*/*"] },
      (d, cb) => {
        globalThis.__qaNetwork.push(d.url);
        cb({ cancel: true });
      },
    );
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => errors.push(e.message));
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1440, 1000),
  );
  const shot = async (name) => {
    assert(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isVisible(),
      ),
    );
    await page.screenshot({ path: path.join(run, name), timeout: 10000 });
  };
  await page
    .locator("aside nav")
    .getByRole("button", { name: "创作中心", exact: true })
    .click();
  await page.getByRole("button", { name: "多选", exact: true }).click();
  await page.getByRole("checkbox", { name: "选择当前筛选的作品", exact: true }).check();
  await page
    .getByRole("button", { name: "批量发布", exact: true })
    .click();
  await page
    .getByRole("button", { name: "打开逐首资料工具", exact: true })
    .click();
  await page
    .getByLabel("腾讯账号备注", { exact: true })
    .selectOption(account.id);
  await expect(page.getByTestId("tme-live-studio")).toContainText("尚未连接");
  await page
    .getByRole("button", { name: "为所选作品建立批次", exact: true })
    .click();
  await expect(page.getByText("等待本首上传", { exact: true })).toBeVisible();
  await expect(page.getByText("资料需处理", { exact: true })).toBeVisible();
  checks.push(
    "Library two-work selection creates persistent mixed ready/blocked batch; no platform action",
  );
  await page
    .getByLabel("腾讯上传批次", { exact: true })
    .evaluate((el) => el.closest("section").scrollIntoView({ block: "start" }));
  await shot("selected-batch.png");
  await page
    .getByRole("button", { name: "取消批次后续歌曲", exact: true })
    .click();
  await expect(page.getByLabel("腾讯上传批次", { exact: true })).toContainText(
    "已取消",
  );
  checks.push("Batch cancellation persists without starting any upload");
  await page
    .locator("aside nav")
    .getByRole("button", { name: "总览", exact: true })
    .click();
  await page
    .locator("aside nav")
    .getByRole("button", { name: "发布中心", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "腾讯音乐人上传工作台 →", exact: true }),
  ).toBeVisible();
  checks.push(
    "Publish center remount after a Tencent batch does not crash or render specialized units as generic units",
  );
  await shot("publish-remount.png");
  await page
    .getByRole("button", { name: "腾讯音乐人上传工作台 →", exact: true })
    .click();
  await page
    .getByTestId("tme-live-studio")
    .evaluate((el) => el.scrollIntoView({ block: "start" }));
  await expect(page.getByTestId("tme-live-studio")).toContainText(
    "真实上传、协议接受和提交审核均已阻断",
  );
  await shot("readonly-gate.png");
  checks.push(
    "Candidate UI visibly blocks real writes for nickname-only identity",
  );
  if (
    process.argv.includes("--real-readonly") &&
    process.env.RAINFALL_TME_READONLY_EVIDENCE
  ) {
    const evidence = JSON.parse(
        fs
          .readFileSync(process.env.RAINFALL_TME_READONLY_EVIDENCE, "utf8")
          .replace(/^\uFEFF/, ""),
      ),
      snap = evidence.value;
    assert(evidence.ok && snap.binding.account);
    const target = snap.rows.find((r) => r.status === "reviewing");
    assert(target);
    await page
      .getByLabel("腾讯官网可见昵称", { exact: true })
      .fill(snap.binding.account);
    await page
      .getByRole("button", { name: "只读识别此官网窗口", exact: true })
      .click();
    await expect(page.getByTestId("tme-live-studio")).toContainText(
      "已核对本次窗口",
    );
    await page.getByLabel("腾讯只读歌名", { exact: true }).fill(target.title);
    await page.getByLabel("腾讯只读专辑ID", { exact: true }).fill(snap.albumId);
    await page
      .getByRole("button", { name: "只读同步当前列表状态", exact: true })
      .click();
    await expect(page.getByTestId("tme-live-observation")).toContainText(
      "审核中",
    );
    await expect(page.getByTestId("tme-live-observation")).toContainText(
      "官网可见页面未提供",
    );
    await page
      .getByTestId("tme-live-studio")
      .evaluate((el) => el.scrollIntoView({ block: "start" }));
    await shot("real-readonly-status.png");
    report.realReadOnly = true;
    checks.push(
      "Actual renderer → trusted IPC → Main → normal Windows UIA reads current Tencent review row with unknown song ID; no clicks in Tencent",
    );
  }
  report.network = await app.evaluate(() => globalThis.__qaNetwork);
  assert.deepEqual(report.network, []);
  assert.deepEqual(errors, []);
  report.result = "passed";
} catch (e) {
  report.result = owned.cancelled ? "cancelled" : "failed";
  report.failure = owned.cancelled ? "QA_CANCELLED" : String(e);
  if(!owned.cancelled)throw e;
} finally {
  fs.writeFileSync(
    path.join(run, "report.json"),
    JSON.stringify(report, null, 2),
  );
  try {
    report.cleanup=await owned.finish({reason:owned.cancelled?"cancel":report.result==="passed"?"normal":/Timeout/.test(report.failure||"")?"timeout":"failed",close:()=>app?.close()});
    if(!["cleaned","absent"].includes(report.cleanup.state)){
      report.result="failed";report.cleanupFailure=true;process.exitCode=1;
    }
  } catch {
    report.result="failed";report.cleanupFailure=true;process.exitCode=1;
  } finally {
    unbindSignals();
    fs.writeFileSync(path.join(run,"report.json"),JSON.stringify(report,null,2));
  }
  console.log(
    JSON.stringify({
      report: path.join(run, "report.json"),
      result: report.result,
      checks: checks.length,
      realReadOnly: report.realReadOnly,
    }),
  );
}
