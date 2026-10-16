import { _electron as electron } from "@playwright/test";
import electronPath from "electron";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const run = path.resolve("output/playwright", "api-settings-" + randomUUID());
const root = path.join(run, "data");
fs.mkdirSync(run, { recursive: true });
const fake = "QA_FAKE_NOT_A_REAL_KEY_" + randomUUID();
const replacement = "QA_REPLACEMENT_NOT_A_REAL_KEY_" + randomUUID();
const errors = [],
  requests = [],
  logs = [],
  checks = [];
let app, page;
async function launch() {
  app = await electron.launch({
    executablePath: electronPath,
    args: ["."],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined,
      RAINFALL_DATA_ROOT: root,
      RAINFALL_MODE: "production",
    },
    timeout: 30000,
  });
  app.process().stdout?.on("data", (b) => logs.push(b.toString()));
  app.process().stderr?.on("data", (b) => logs.push(b.toString()));
  await app.evaluate(({ session }) => {
    globalThis.__qaRequests = [];
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ["http://*/*", "https://*/*"] },
      (details, callback) => {
        globalThis.__qaRequests.push(details.url);
        callback({ cancel: true });
      },
    );
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (/^https?:/.test(r.url())) requests.push(r.url());
  });
  await page.getByRole("button", { name: "账号设置", exact: true }).click();
  await page
    .getByRole("heading", { name: "API 配置", exact: true })
    .waitFor({ timeout: 10000 });
}
async function close() {
  if (!app) return;
  const closing = app;
  app = undefined;
  requests.push(
    ...(await closing
      .evaluate(() => globalThis.__qaRequests || [])
      .catch(() => [])),
  );
  await closing.close().catch(() => undefined);
}
const card = () => page.getByTestId("api-profile-card");
try {
  await launch();
  assert(await page.getByText("文本模型未配置", { exact: true }).isVisible());
  assert(
    await page.getByText("妙响 · API 接入待确认", { exact: true }).isVisible(),
  );
  assert.equal(await page.getByRole("button", { name: /测试连接/ }).count(), 0);
  await page.getByLabel("API 平台").selectOption("yourmusic");
  await page.getByLabel("配置名称").fill("个人创作 · QA");
  await page
    .getByRole("button", { name: "创建 API 配置", exact: true })
    .click();
  await card().getByRole("heading", { name: "个人创作 · QA" }).waitFor();
  await card().getByLabel("新的 API Key").fill(fake);
  assert.equal(
    await card().getByLabel("新的 API Key").getAttribute("type"),
    "password",
  );
  await card().getByRole("button", { name: "保存 Key", exact: true }).click();
  await card().getByText("已保存 · 未验证", { exact: true }).waitFor();
  assert.equal(await card().getByLabel("新的 API Key").inputValue(), "");
  assert.equal(
    await page.evaluate(() =>
      [localStorage.length, sessionStorage.length].join(","),
    ),
    "0,0",
  );
  const id = await card().getAttribute("data-profile-id");
  checks.push(
    "create profile / DPAPI write / masked input / clear input / no browser persistence",
  );
  await page
    .locator(".api-settings")
    .screenshot({ path: path.join(run, "01-api-settings-stored.png") });
  await close();
  await launch();
  await card().getByText("已保存 · 未验证", { exact: true }).waitFor();
  checks.push("encrypted credential survives actual Electron restart");

  const bypass = await page.evaluate(async (profileId) => {
    const input = { profileId, expectedRevision: 1, secret: "QA_ONLY" };
    return {
      ordinary: await window.rainfall.call("writeApiCredential", input),
      host: await window.rainfall.writeApiCredential({
        ...input,
        baseUrl: "https://unapproved.invalid",
      }),
      stale: await window.rainfall.writeApiCredential({
        ...input,
        expectedRevision: 99,
      }),
      noReadBridge: typeof window.rainfall.getApiCredential === "undefined",
    };
  }, id);
  assert.equal(bypass.ordinary.ok, false);
  assert.equal(bypass.host.ok, false);
  assert.equal(bypass.stale.ok, false);
  assert.equal(bypass.noReadBridge, true);
  const source = await app.evaluate(
    async ({ BrowserWindow }, args) => {
      const child = new BrowserWindow({
        show: false,
        webPreferences: {
          preload: args.preload,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      try {
        await child.loadURL("app://ui/index.html");
        return await child.webContents.executeJavaScript(
          "window.rainfall.apiCredentialStatus(" +
            JSON.stringify({ profileId: args.id }) +
            ")",
        );
      } finally {
        child.destroy();
      }
    },
    { id, preload: path.resolve("build/preload.cjs") },
  );
  assert.equal(source.ok, false);
  assert.equal(source.error.code, "IPC_SOURCE_REJECTED");
  checks.push(
    "ordinary RPC, arbitrary host, stale revision and untrusted window rejected",
  );

  await card().getByLabel("配置显示名称").fill("个人创作 · 已修改");
  await card()
    .getByRole("button", { name: "保存配置名称", exact: true })
    .click();
  await card().getByRole("heading", { name: "个人创作 · 已修改" }).waitFor();
  await card().getByLabel("新的 API Key").fill(replacement);
  await card().getByRole("button", { name: "保存 Key", exact: true }).click();
  await card().getByLabel("新的 API Key").waitFor();
  await page.waitForFunction(
    () => document.querySelector('[aria-label="新的 API Key"]').value === "",
  );
  const value = await app.evaluate(
    ({ safeStorage }, args) => {
      const cipher = Buffer.from(args.bytes);
      return {
        matches:
          JSON.parse(safeStorage.decryptString(cipher)).secret ===
          args.expected,
        plaintext: cipher.includes(Buffer.from(args.expected)),
      };
    },
    {
      bytes: Array.from(
        fs.readFileSync(path.join(root, "credentials", id + ".bin")),
      ),
      expected: replacement,
    },
  );
  assert.equal(value.matches, true);
  assert.equal(value.plaintext, false);
  checks.push("replace key and verify OS-encrypted bytes in isolated QA root");

  // Keyboard flow and layout at the supported minimum width.
  await page.setViewportSize({ width: 1000, height: 760 });
  await card().getByLabel("新的 API Key").fill("QA_KEYBOARD_ONLY");
  await card().getByLabel("新的 API Key").focus();
  await page.keyboard.press("Tab");
  assert.equal(
    await page.evaluate(() => document.activeElement?.textContent?.trim()),
    "保存 Key",
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: path.join(run, "02-api-settings-compact.png"),
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await card().getByRole("button", { name: "清除 Key", exact: true }).click();
  await card().getByText("未保存 Key", { exact: true }).waitFor();
  assert(!fs.existsSync(path.join(root, "credentials", id + ".bin")));
  checks.push("keyboard / minimum width / key clear");

  const mode = await page.evaluate(() => window.rainfall.setMode("simulation"));
  assert.equal(mode.ok, true);
  await page.reload();
  await page.getByRole("button", { name: "账号设置", exact: true }).click();
  assert.equal(await card().count(), 0);
  await page
    .getByText("模拟工作区不读取或保存真实 Key", { exact: true })
    .waitFor();
  const sim = await page.evaluate(
    (profileId) =>
      window.rainfall.writeApiCredential({
        profileId,
        expectedRevision: 1,
        secret: "QA_SIM",
      }),
    id,
  );
  assert.equal(sim.ok, false);
  checks.push(
    "simulation isolates profiles and cannot access production vault",
  );
  await close();
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  assert(!logs.join("").includes(fake));
  assert(!logs.join("").includes(replacement));
  fs.writeFileSync(
    path.join(run, "results.json"),
    JSON.stringify(
      {
        passed: checks.length,
        checks,
        errors,
        externalRequests: requests,
        root,
        safeStorage: "Electron safeStorage / Windows isolated QA",
        realServicesTested: false,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      {
        passed: checks.length,
        run,
        externalRequests: requests.length,
        realServicesTested: false,
      },
      null,
      2,
    ),
  );
} catch (error) {
  fs.writeFileSync(
    path.join(run, "failure.json"),
    JSON.stringify(
      {
        error: String(error),
        logs: logs.map((x) =>
          x.replaceAll(fake, "[QA]").replaceAll(replacement, "[QA]"),
        ),
      },
      null,
      2,
    ),
  );
  if (page)
    await page
      .screenshot({ path: path.join(run, "failure.png") })
      .catch(() => {});
  throw error;
} finally {
  await close();
}
