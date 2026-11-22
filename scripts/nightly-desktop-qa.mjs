// Offline packaged GUI regression. Only an isolated copy of the real library is used.
import { _electron as electron, expect } from "@playwright/test";
import { openCreationWork } from "./lib/open-creation-work.mjs";
import electronPath from "electron";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
const require = createRequire(import.meta.url),
  fixtureDraft = require("../tests/fixtures/workflow.cjs").draft();
const packageFile = process.argv[2],
  pkg = packageFile ? JSON.parse(fs.readFileSync(packageFile, "utf8")) : null;
const run = path.resolve("output/playwright/nightly-" + Date.now()),
  root = path.join(run, "data");
fs.mkdirSync(path.join(root, "production"), { recursive: true });
const backup = JSON.parse(
  fs.readFileSync("output/nightly-backup.json", "utf8"),
);
fs.copyFileSync(
  path.join(backup.backup, "production-library.sqlite"),
  path.join(root, "production/library.sqlite"),
);
await fs.promises.cp(
  path.join(backup.backup, "media"),
  path.join(root, "media"),
  { recursive: true },
);
const checks = [],
  screens = [],
  errors = [],
  intercepted = [];
let app, page, profile, account, work, jobId;
const rpc = async (method, input = {}) =>
  page.evaluate(
    async ({ method, input }) => {
      const r = await window.rainfall.call(method, input);
      if (!r.ok) throw Error(r.error.code);
      return r.value;
    },
    { method, input },
  );
async function open() {
  app = await electron.launch({
    executablePath: pkg?.executable ?? electronPath,
    args: pkg ? [] : ["."],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined,
      RAINFALL_DATA_ROOT: root,
      RAINFALL_MODE: "production",
    },
    timeout: 30000,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  page.on("pageerror", (e) => errors.push(e.message));
  await app.evaluate(
    ({ BrowserWindow, session }, { draft }) => {
      BrowserWindow.getAllWindows()[0].setContentSize(1440, 1000);
      globalThis.__qaRequests = [];
      globalThis.__qaResponseMode = "valid";
      globalThis.__qaDraft = draft;
      const https = process.getBuiltinModule("node:https"),
        dns = process.getBuiltinModule("node:dns"),
        { EventEmitter } = process.getBuiltinModule("node:events"),
        { Readable } = process.getBuiltinModule("node:stream");
      dns.promises.lookup = async (host) => {
        if (host !== "api.deepseek.com") throw Error("QA_EXTERNAL_DNS_BLOCKED");
        return [{ address: "93.184.216.34", family: 4 }];
      };
      https.request = (url, options, callback) => {
        if (
          url.hostname !== "api.deepseek.com" ||
          url.pathname !== "/chat/completions"
        )
          throw Error("QA_EXTERNAL_HTTP_BLOCKED");
        const req = new EventEmitter();
        req.setTimeout = () => req;
        req.write = () => true;
        req.destroy = (e) => {
          queueMicrotask(() => req.emit("error", e ?? Error("QA_ABORT")));
          return req;
        };
        req.end = () => {
          globalThis.__qaRequests.push({
            method: options.method,
            url: url.href,
            source: "intercepted_offline_fixture",
          });
          if (globalThis.__qaResponseMode === "unknown") {
            queueMicrotask(() =>
              req.emit("error", Error("QA_OUTCOME_UNKNOWN")),
            );
            return;
          }
          const payload = {
            id: "qa-completion-" + globalThis.__qaRequests.length,
            model: "deepseek-flash",
            choices: [
              {
                finish_reason: "stop",
                message: {
                  content:
                    globalThis.__qaResponseMode === "invalid"
                      ? "{invalid"
                      : JSON.stringify(globalThis.__qaDraft),
                },
              },
            ],
            usage: {
              prompt_tokens: 1000,
              completion_tokens: 500,
              prompt_cache_hit_tokens: 0,
              prompt_cache_miss_tokens: 1000,
            },
          };
          queueMicrotask(() => {
            const res = Readable.from([Buffer.from(JSON.stringify(payload))]);
            res.statusCode = 200;
            res.headers = {};
            callback(res);
          });
        };
        return req;
      };
      session.defaultSession.webRequest.onBeforeRequest(
        { urls: ["http://*/*", "https://*/*"] },
        (_d, cb) => cb({ cancel: true }),
      );
    },
    { draft: fixtureDraft },
  );
  await page
    .getByRole("button", { name: "AI 聊天创作", exact: true })
    .waitFor();
}
async function shot(name, locator) {
  const file = path.join(run, name + ".png");
  if (locator) await locator.screenshot({ path: file });
  else await page.screenshot({ path: file, fullPage: true });
  screens.push(file);
}
async function close() {
  if (!app) return;
  intercepted.push(...(await app.evaluate(() => globalThis.__qaRequests)));
  await app.close();
  app = null;
}
try {
  await open();
  let snapshot = await rpc("snapshot");
  assert.equal(snapshot.works.length, 1);
  assert.equal(snapshot.assets.length, 4);
  work = snapshot.works[0];
  await openCreationWork(page, work.id);
  await page.getByRole("button", { name: "▷ 试听 A", exact: true }).click();
  await expect
    .poll(() => page.locator("audio").evaluate((a) => a.currentTime), {
      timeout: 12000,
    })
    .toBeGreaterThan(1);
  await page.locator("audio").evaluate((a) => a.pause());
  await shot("01-original-A-intact");
  checks.push(
    "Original work, four asset identities and actual local A playback retained in isolated consistent backup copy",
  );
  await page.getByRole("button", { name: "AI 聊天创作", exact: true }).click();
  let panel = page.getByRole("region", { name: "DeepSeek真实文本工作区" });
  await expect(
    panel.getByRole("button", { name: "准备本轮文本任务", exact: true }),
  ).toBeDisabled();
  await expect(panel.getByText(/尚无已保存 Key/)).toBeVisible();
  checks.push("No credential means no new live text task or call");
  profile = await rpc("apiProfile.save", {
    profile: {
      id: randomUUID(),
      kind: "text",
      providerId: "deepseek",
      label: "QA离线专用配置",
      modelId: "deepseek-flash",
      executionEnabled: false,
    },
    expectedRevision: null,
  });
  const secretResult = await page.evaluate(
    async (profileId) =>
      window.rainfall.writeApiCredential({
        profileId,
        expectedRevision: 1,
        secret: "QA_FAKE_NOT_A_REAL_KEY",
      }),
    profile.id,
  );
  assert(secretResult.ok);
  await page.getByRole("button", { name: "总览", exact: true }).click();
  await page.getByRole("button", { name: "AI 聊天创作", exact: true }).click();
  await expect(panel.getByLabel("文本账号配置")).toHaveValue(profile.id);
  await panel
    .getByLabel("故事、曲风与创作要求")
    .fill("仅供离线界面回归：雨中相识，中文叙事，温柔民谣。");
  await panel.getByLabel("本轮文本预算（美元）").fill("0.020");
  await panel.getByLabel("本轮最多改写次数").selectOption("2");
  await panel.getByRole("checkbox", { name: "确认本轮文本调用预算" }).check();
  await panel
    .getByRole("button", { name: "准备本轮文本任务", exact: true })
    .click();
  await expect(
    panel.getByRole("button", {
      name: "按已确认预算调用一次 DeepSeek",
      exact: true,
    }),
  ).toBeVisible();
  assert.equal((await app.evaluate(() => globalThis.__qaRequests)).length, 0);
  checks.push(
    "Explicit prepare persists budget/model/revision without invoking any provider",
  );
  await panel
    .getByRole("button", { name: "按已确认预算调用一次 DeepSeek", exact: true })
    .click();
  await expect(panel.getByText(/实际模型：deepseek-flash/)).toBeVisible();
  await expect(panel.getByText(/输入\/输出 token：1000\/500/)).toBeVisible();
  await shot("02-text-fixture-result", panel);
  checks.push(
    "Offline transport fixture traversed actual renderer/preload/Main credential broker/Core/adapter/record path and displayed usage/estimated cost, not a live service result",
  );
  await panel
    .getByLabel("改写反馈")
    .fill("仅测试无效JSON结果保留原稿和已用预算。");
  await app.evaluate(() => (globalThis.__qaResponseMode = "invalid"));
  await panel
    .getByRole("button", { name: "按本轮剩余预算明确改写一次", exact: true })
    .click();
  await expect(
    panel.getByText("TEXT_DRAFT_INVALID", { exact: true }),
  ).toBeVisible();
  checks.push(
    "Invalid model JSON retains first draft and nonzero token estimate instead of claiming success or zero fee",
  );
  await app.evaluate(() => (globalThis.__qaResponseMode = "unknown"));
  await panel
    .getByRole("button", { name: "按本轮剩余预算明确改写一次", exact: true })
    .click();
  await expect(
    panel
      .getByRole("status")
      .getByText(/结果或费用未知，禁止重发/)
      .first(),
  ).toBeVisible();
  jobId = await panel.getByLabel("持久文本任务").inputValue();
  assert(jobId);
  assert.equal((await app.evaluate(() => globalThis.__qaRequests)).length, 3);
  await shot("03-unknown-frozen", panel);
  checks.push(
    "Ambiguous transport outcome freezes original task and keeps reservation; no auto retry",
  );
  account = await rpc("account.save", {
    provider: "tme",
    name: "QA官方页面观察备注",
    dailyLimit: 0,
  });
  const observation = {
    workId: work.id,
    accountId: account.id,
    visibleAccount: "QA测试昵称",
    remoteId: null,
    status: "prepared",
    officialUrl: "https://y.tencentmusic.com/#/user/manage/aiChoose/add",
    observedAt: new Date().toISOString(),
    evidence: {
      summary: "QA离线合成证据：仅资料准备，未提交、未审核、未发行。",
      reference: "QA-fixture-only",
      sha256: "e".repeat(64),
    },
  };
  const first = await rpc("tme.observations.record", observation),
    second = await rpc("tme.observations.record", observation);
  assert.equal(first.id, second.id);
  assert.equal(first.submissionByClient, false);
  snapshot = await rpc("snapshot");
  assert.equal(snapshot.tmeObservations.length, 1);
  assert.equal(snapshot.units.length, 0);
  checks.push(
    "Observation without remote ID persists idempotently and never becomes a publication unit or client submission",
  );
  await page.getByRole("button", { name: "发布中心", exact: true }).click();
  await page.getByText("腾讯官方页面进度与证据", { exact: true }).click();
  await page.getByLabel("关联本地腾讯账户备注").selectOption(account.id);
  await expect(page.getByText(/未显示远端 ID/)).toBeVisible();
  await shot("04-official-observation-no-false-submit");
  await close();
  await open();
  await page.getByRole("button", { name: "AI 聊天创作", exact: true }).click();
  panel = page.getByRole("region", { name: "DeepSeek真实文本工作区" });
  await expect(panel.getByLabel("持久文本任务")).toHaveValue(jobId);
  await expect(
    panel
      .getByRole("status")
      .getByText(/结果或费用未知，禁止重发/)
      .first(),
  ).toBeVisible();
  assert.equal((await app.evaluate(() => globalThis.__qaRequests)).length, 0);
  snapshot = await rpc("snapshot");
  assert.equal(snapshot.works.length, 1);
  assert.equal(snapshot.assets.length, 4);
  assert.equal(snapshot.tmeObservations.length, 1);
  checks.push(
    "Actual application restart retains task/unknown freeze and observation, performs no transport replay, and preserves work/media",
  );
  await shot("05-restarted-task");
  await close();
  assert.equal(errors.length, 0);
  const result = {
    at: new Date().toISOString(),
    sourceCommit: pkg?.sourceCommit ?? null,
    executable: pkg?.executable ?? electronPath,
    version: "0.6.0-nightly.1",
    run,
    root,
    checks,
    screens,
    rendererErrors: errors,
    interceptedFixtureCalls: intercepted,
    realHttpRequests: 0,
    realProviderCalls: 0,
    realPlatformSubmissions: 0,
    realCredentialsRead: false,
    originalDataModified: false,
  };
  fs.writeFileSync(
    "output/nightly-gui-verification.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} catch (e) {
  fs.writeFileSync(
    "output/nightly-gui-failure.json",
    JSON.stringify({ error: e.stack, run, checks, screens, errors }, null, 2),
  );
  console.error(e);
  process.exitCode = 1;
} finally {
  await close();
}
