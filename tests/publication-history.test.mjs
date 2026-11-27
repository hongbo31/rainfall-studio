import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compileFunction } from "node:vm";
import { chromium, expect } from "@playwright/test";
import { build } from "esbuild";
import { launchHeadlessChromium } from "../scripts/lib/headless-chromium.mjs";

const { outputFiles } = await build({
  stdin: { resolveDir: process.cwd(), contents: `
    export { Studio } from './src/core/studio';
    export { startBrowserStudio } from './src/main/browser-studio';
  ` },
  bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
});
const mod = { exports: {} };
compileFunction(outputFiles[0].text, ["module", "exports", "require", "__dirname"])(
  mod, mod.exports, createRequire(import.meta.url), process.cwd(),
);
const { Studio, startBrowserStudio } = mod.exports;

const now = "2026-11-27T08:00:00.000Z";
function setup(t, mode = "production") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rainfall-publication-history-"));
  const studio = new Studio(root, mode, { now: () => new Date(now) });
  t.after(() => studio.repo.close());
  const repo = studio.repo;
  const setting = (id, value) => repo.save("settings", { id, value });
  return { root, studio, repo, setting, read: (query = {}) => studio.call("publish.history", query) };
}

function json(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
}

test("Fanqie receipts join across directory, direct and planned uploads and retain their upload day when the status changes", async t => {
  const { root, repo, setting, read } = setup(t);
  const accountId = randomUUID();
  repo.save("accounts", { id: accountId, provider: "fanqie", name: "发行账号_甲" });
  const account = path.join(root, "production", "fanqie", "accounts", accountId);
  const batchId = randomUUID(), trackId = "b".repeat(64);
  const key = "c".repeat(64), firstId = "7619704199712094356";
  const first = { id: firstId, title: "晚风归来", stage: "contract_pending", createdAtText: "2026-11-26T16:03:00Z" };
  const upload = (jobId, officialRecord, download) => json(path.join(account, "uploads", jobId + ".json"), {
    id: jobId, accountKey: key, title: officialRecord?.title ?? "结果待核对", phase: "unknown", updatedAt: now,
    officialRecord, download, input: { scope: { accountId: "123456789" }, authors: { singer: "歌手_甲" }, workId: randomUUID() },
  });
  upload("a".repeat(64), first, { batchId, id: trackId });
  upload("b".repeat(64));
  json(path.join(account, "download-runs", batchId, "batch.json"), { id: batchId, accountKey: key, tracks: [
    { id: trackId, folder: "发行账号_甲_歌手_甲_台语_治愈", singer: "歌手_甲" },
  ] });
  const planId = "plan-fanqie:" + randomUUID();
  const planRow = { state: "unknown", accountId, accountKey: key, updatedAt: now,
    record: { ...first, stage: "reviewing" }, workId: randomUUID() };
  setting(planId, planRow);
  setting("plan-fanqie:" + randomUUID(), { state: "existing", accountId, accountKey: key, updatedAt: now,
    record: { ...first, id: "7619704199712094357", title: "预检查到的旧歌", stage: "published" } });
  const initial = await read({ day: "2026-11-27" });
  assert.equal(initial.total, 1);
  assert.equal(initial.today, "2026-11-27");
  assert.deepEqual(initial.rows.map(({ title, singer, promptEngine, platform, status, day }) =>
    [title, singer, promptEngine, platform, status, day]),
  [["晚风归来", "歌手_甲", "台语_治愈", "fanqie", "reviewing", "2026-11-27"]]);
  assert.equal((await read({ day: "2026-11-26" })).total, 0);
  assert.equal((await read({ platform: "fanqie", singer: "歌手_甲", promptEngine: "治愈", title: "晚风" })).total, 1);
  assert.equal((await read({ platform: "fanqie", promptEngine: "晚风" })).total, 0);
  assert.equal((await read({ singer: "治愈" })).total, 0);
  setting(planId, { ...planRow, updatedAt: "2026-11-28T01:00:00.000Z",
    record: { ...planRow.record, stage: "published", createdAtText: "-" } });
  assert.equal((await read({ day: "2026-11-27", status: "published" })).rows[0].title, "晚风归来");
  assert.equal((await read({ day: "2026-11-28" })).total, 0);

  upload("d".repeat(64), { id: "7619704199712094358", title: "今天的新歌", stage: "published", createdAtText: "2026/11/27 09:00" },
    { batchId, id: trackId, promptEngine: "流行_深夜" });
  assert.deepEqual((await read({ day: "2026-11-27" })).rows.map(row => row.title), ["今天的新歌", "晚风归来"]);
  const otherId = randomUUID(), otherJobId = "e".repeat(64);
  repo.save("accounts", { id: otherId, provider: "fanqie", name: "发行账号乙" });
  json(path.join(root, "production", "fanqie", "accounts", otherId, "uploads", "opening-history", otherJobId + "-" + randomUUID() + ".json"), {
    id: otherJobId, accountKey: "f".repeat(64), title: first.title, updatedAt: now,
    officialRecord: { ...first, id: "7619704199712094359", stage: "published", createdAtText: "2026-11-25 23:50" },
    input: { authors: { singer: "歌手乙" }, workId: "bundle:" + otherJobId },
  });
  assert.equal((await read({ title: "晚风归来" })).total, 2);
  assert.equal((await read({ day: "2026-11-25" })).rows[0].accountName, "发行账号乙");
  assert.equal((await read({ day: "2026-11-27", page: 2 })).rows.length, 0);
  assert(!JSON.stringify(await read()).includes(root));

  const simulated = new Studio(root, "simulation", { now: () => new Date(now) });
  t.after(() => simulated.repo.close());
  assert.equal((await simulated.call("publish.history", {})).total, 0);
});

test("the history uses saved singer and engine metadata for verified Tencent and confirmed Qishui submissions", async t => {
  const { repo, setting, read } = setup(t);
  const tmeAccount = randomUUID(), qishuiAccount = randomUUID(), artistId = randomUUID(), runId = randomUUID();
  const tmeWork = randomUUID(), qishuiWork = randomUUID(), pending = randomUUID();
  const subject = "d".repeat(64), sha = "f".repeat(64);
  repo.save("accounts", { id: tmeAccount, provider: "tme", name: "腾讯发行账号", remoteSubject: subject });
  repo.save("accounts", { id: qishuiAccount, provider: "qishui", name: "汽水发行账号" });
  repo.save("artists", { id: artistId, name: "当前配置艺人" });
  repo.save("works", { id: tmeWork, artistId, title: "现有别名" });
  repo.save("works", { id: qishuiWork, artistId, title: "雨后", alternateTitle: "雨后的巷口", selectedAudioVariant: "B" });
  setting("plan-center:run:" + runId, { id: runId, snapshot: { workflowSnapshot: { template: { name: "叙事民谣" } } } });
  setting("plan-center:item:" + randomUUID(), { runId, workId: tmeWork });
  setting("plan-center:item:" + randomUUID(), { runId, workId: qishuiWork });
  const receipt = { source: "official", workId: tmeWork, title: "夜路", artistName: "已发行歌手",
    state: "published", externalSongRecordId: "18281901", albumId: "123", albumTitle: "夜色",
    audioSha256: sha, termsSha256: sha, explicitUserConsentAt: now, acceptedAt: now, submittedAt: "2026-11-26T13:34:00.000Z",
    observedAt: now, submittedAtSource: "official", officialStatusText: "审核通过", platformStatusText: "QQ音乐、酷狗音乐已上架",
    subjectHash: subject, sourceUrl: "https://y.tencentmusic.com/record" };
  setting("external-publication:tme:" + tmeWork, receipt);
  setting("plan-workflow-publication:" + runId, { runId, qishui: [
    { accountId: qishuiAccount, workId: qishuiWork, variant: "B", submitted: true, submittedAt: now, credits: { performer: "B 版歌手" } },
    { accountId: qishuiAccount, workId: pending, variant: "A", submitted: false, credits: { performer: "待提交歌手" } },
  ] });

  const all = await read();
  assert.equal(all.total, 2);
  const tencent = (await read({ day: "2026-11-26", platform: "qqmusic", singer: "已发行歌手", promptEngine: "民谣" })).rows[0];
  assert.equal(tencent.status, "published");
  assert.equal(tencent.accountName, "腾讯发行账号");
  assert.equal((await read({ platform: "kugou" })).total, 1);
  const [qishui] = (await read({ platform: "qishui", day: "2026-11-27" })).rows;
  assert.deepEqual([qishui.title, qishui.singer, qishui.promptEngine, qishui.status, qishui.timeSource],
    ["雨后的巷口", "B 版歌手", "叙事民谣", "submitted", "recorded"]);
  assert.equal((await read({ day: "2026-11-27", platform: "qqmusic" })).total, 0);
});

test("the browser dashboard refreshes confirmed uploads and combines independent search fields", async t => {
  const { root, studio, repo, setting } = setup(t);
  const accountId = randomUUID(), runId = randomUUID();
  repo.save("accounts", { id: accountId, provider: "fanqie", name: "番茄账号" });
  setting("plan-center:run:" + runId, { id: runId, snapshot: { workflowSnapshot: { template: { name: "疗愈_民谣" } } } });
  const addSong = (id, title, date, singer, stage, withEngine) => setting("plan-fanqie:" + randomUUID(), {
    state: "uploaded", accountId, ...(withEngine ? { runId } : {}), workId: randomUUID(), updatedAt: now, singer,
    record: { id, title, stage, createdAtText: date },
  });
  addSong("7619704199712094351", "窗边有风", "2026-11-27 09:00", "歌手甲", "contract_pending", true);
  addSong("7619704199712094352", "昨日微雨", "2026-11-26 19:00", "歌手甲", "published", true);
  addSong("7619704199712094353", "清晨小路", "2026-11-27 07:00", "歌手乙", "published", false);
  const ui = path.join(root, "browser-ui");
  await build({ entryPoints: ["src/renderer/main.tsx"], outdir: path.join(ui, "assets"), entryNames: "app", bundle: true, format: "esm" });
  fs.writeFileSync(path.join(ui, "index.html"), `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
    <link rel="stylesheet" href="/assets/app.css"></head><body><div id="root"></div>
    <script type="module" src="/assets/app.js"></script></body></html>`);
  const server = startBrowserStudio(ui, {
    dispatch: async (channel, [method, input]) => {
      assert.equal(channel, "rainfall:call");
      if (method === "runtime") return { ok: true, value: {} };
      return { ok: true, value: await studio.call(method, input) };
    },
    media: async () => new Response(null, { status: 404 }),
  });
  t.after(() => server.close());
  const browser = await launchHeadlessChromium(chromium);
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1150, height: 880 } });
  await page.clock.install();
  await page.goto(await server.ready);
  await page.getByRole("button", { name: /数据看板/ }).click();
  const history = page.getByRole("region", { name: "歌曲上传记录" });
  await expect(history.getByRole("status")).toHaveText("共 3 条上传记录");
  await expect(history.getByRole("rowheader", { name: "2026-11-26" })).toBeVisible();
  await expect(history.getByRole("rowheader", { name: "2026-11-27" })).toBeVisible();

  addSong("7619704199712094354", "刚上传的一首歌", "2026-11-27 11:00", "歌手甲", "published", true);
  await page.clock.fastForward(8_200);
  await expect(history.getByRole("status")).toHaveText("共 4 条上传记录");
  await history.getByRole("button", { name: "今天", exact: true }).click();
  await history.getByLabel("发布平台", { exact: true }).selectOption("fanqie");
  await history.getByLabel("歌手", { exact: true }).fill("歌手甲");
  await history.getByLabel("提示词引擎", { exact: true }).fill("民谣");
  await history.getByLabel("发布状态", { exact: true }).selectOption("published");
  await expect(history.getByRole("status")).toHaveText("共 1 条上传记录");
  await expect(history.getByText("刚上传的一首歌", { exact: true })).toBeVisible();
  await history.getByLabel("歌名", { exact: true }).fill("不存在的歌");
  await expect(history.getByText("当前筛选暂无上传记录")).toBeVisible();

  const reports = page.locator("details.insights-reports");
  await expect(reports.getByRole("button", { name: "＋ 导入 CSV 报表" })).toBeHidden();
  await reports.locator("summary").filter({ hasText: "CSV 指标报表" }).click();
  await expect(reports.getByRole("button", { name: "＋ 导入 CSV 报表" })).toBeVisible();
});
