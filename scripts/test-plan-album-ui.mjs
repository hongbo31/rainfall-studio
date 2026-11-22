import { launchHeadlessChromium } from "./lib/headless-chromium.mjs";
// Real production React controls in headless Chrome, with every request intercepted.
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const out = path.resolve("output/album-integration/ui");
fs.mkdirSync(out, { recursive: true });
const checks = [],
  calls = [],
  requests = [],
  errors = [],
  operations = [],
  bindings = [];
let appendAvailable = false,
  createAvailable = true;
const hash = "a".repeat(64),
  scope = {
    platform: "qqmusic",
    accountId: "fixture-account",
    accountFingerprint: "fixture-subject",
  };
const catalog = {
  id: "fixture-catalog",
  scope,
  source: "offline-fixture",
  onlineVerified: false,
  completeness: "partial",
  observedAt: "2026-10-19T08:00:00Z",
  expiresAt: "2099-10-19T09:00:00Z",
  entries: [
    { key: "remote-one", id: "fixture-album-1", title: "Observed album" },
    { key: "title-only", id: null, title: "Visible without ID" },
  ],
};
const result = await build({
  entryPoints: ["tests/fixtures/plan-album-ui-entry.tsx"],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  outdir: out,
});
const js = result.outputFiles.find((f) => f.path.endsWith(".js")).text,
  css = result.outputFiles.find((f) => f.path.endsWith(".css")).text;
const rpc = async (method, input) => {
  calls.push({ method, input });
  if (method === "planAlbums.catalog")
    return input.accountId === "fixture-account" ? catalog : null;
  if (method === "planAlbums.refresh") return { catalogs: [catalog] };
  if (method === "planAlbums.capabilities")
    return {
      query: { implemented: true, available: true, reasons: [] },
      create: {
        implemented: true,
        available: createAvailable,
        reasons: createAvailable
          ? []
          : [
              "ALBUM_CREATE_CONTRACT_UNCALIBRATED",
              "CLOUD_BROWSER_SESSION_REQUIRED",
            ],
        source: "offline-fixture",
      },
      append: {
        implemented: true,
        available: appendAvailable,
        reasons: appendAvailable ? [] : ["ALBUM_APPEND_CONTRACT_UNCALIBRATED"],
      },
    };
  if (method === "planAlbums.status")
    return {
      catalogs: [catalog],
      bindings: structuredClone(bindings),
      operations: structuredClone(operations),
    };
  if (method === "planAlbums.select") {
    assert.deepEqual(input, {
      runId: "fixture-run",
      platform: "qqmusic",
      accountId: "fixture-account",
      catalogId: "fixture-catalog",
      entryKey: "remote-one",
    });
    const binding = {
      id: "fixture-binding",
      createdByRunId: "fixture-run",
      scope,
      albumId: "fixture-album-1",
      source: "offline-fixture",
      onlineVerified: false,
    };
    bindings.push(binding);
    return binding;
  }
  if (method === "planAlbums.prepareCreate") {
    assert.equal(input.runId, "fixture-run");
    const op = {
      id: "fixture-operation",
      operationId: "fixture-operation",
      kind: "create",
      runId: "fixture-run",
      planId: "fixture-plan",
      scope,
      selection: {
        mode: "new",
        title: "Fixture new album",
        description: "Fixture description",
      },
      state: "prepared",
      source: "offline-fixture",
      onlineVerified: false,
      requestHash: hash,
      idempotencyKey: "fixture-idempotency",
      createdAt: "2026-10-19T08:00:00Z",
      updatedAt: "2026-10-19T08:00:00Z",
    };
    const prior = operations.findIndex(row=>row.id===op.id);
    if(prior<0)operations.push(op);else operations[prior]=op;
    return op;
  }
  if (method === "planAlbums.prepareAppend") {
    assert.deepEqual(input, {
      runId: "fixture-run",
      platform: "qqmusic",
      accountId: "fixture-account",
      itemId: "fixture-item",
    });
    const op = {
      ...operations[0],
      id: "fixture-append",
      operationId: "fixture-append",
      kind: "append",
      itemId: "fixture-item",
      materialFingerprint: hash,
      selection: { mode: "existing", albumId: "fixture-album-1" },
      state: "prepared",
      reason: undefined,
    };
    const prior = operations.findIndex(row=>row.id===op.id);
    if(prior<0)operations.push(op);else operations[prior]=op;
    return op;
  }
  if (method === "planAlbums.preview")
    return {
      operation: structuredClone(
        operations.find((o) => o.operationId === input.operationId),
      ),
      summaryHash: hash,
    };
  if (method === "planAlbums.confirm") {
    assert.deepEqual(input, {
      operationId: input.operationId,
      summaryHash: hash,
      confirmed: true,
    });
    const op = operations.find((o) => o.operationId === input.operationId);
    op.state = op.kind === "create" ? "unknown" : "dispatching";
    op.reason =
      op.kind === "create"
        ? "FIXTURE_TIMEOUT_AFTER_WRITE"
        : "AWAITING_ORIGINAL_PUBLICATION";
    if (op.kind === "append") op.publicationTaskId = "fixture-original-task";
    if (op.kind === "create") throw Error("FIXTURE_UNKNOWN_RESPONSE");
    return structuredClone(op);
  }
  if (method === "planAlbums.reconcile") {
    assert.deepEqual(input, { operationId: "fixture-operation" });
    operations[0].reason = "FIXTURE_STILL_PENDING";
    return structuredClone(operations[0]);
  }
  throw Error("UNEXPECTED_FIXTURE_RPC " + method);
};
let browser;
try {
  browser = await launchHeadlessChromium(chromium, {
    args: [
      "--no-startup-window",
      "--disable-background-networking",
      "--disable-sync",
      "--no-first-run",
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 1300, height: 1150 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    requests.push(url);
    if (url === "https://album-fixture.invalid/")
      await route.fulfill({
        contentType: "text/html",
        body: '<!DOCTYPE html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"></head><body style="padding:32px"><div id="root"></div><script src="/fixture.js"></script></body></html>',
      });
    else if (url === "https://album-fixture.invalid/fixture.js")
      await route.fulfill({ contentType: "text/javascript", body: js });
    else if (url === "https://album-fixture.invalid/fixture.css")
      await route.fulfill({ contentType: "text/css", body: css });
    else await route.abort();
  });
  await page.exposeFunction("__albumRpc", rpc);
  await page.goto("https://album-fixture.invalid/");
  const albums = page.getByLabel("真实专辑列表 1", { exact: true });
  await expect(albums).toBeEnabled();
  await expect(albums.locator('option[value="fixture-album-1"]')).toHaveText(
    /Observed album/,
  );
  await expect(
    albums.locator("option").filter({ hasText: "Visible without ID" }),
  ).toHaveAttribute("disabled", "");
  await albums.selectOption("fixture-album-1");
  await expect(page.getByLabel("Selected album snapshot")).toContainText(
    '"albumId":"fixture-album-1"',
  );
  checks.push(
    "Cached account catalog permits real remote ID and disables title-only candidates",
  );
  await page
    .getByRole("button", { name: "只读刷新专辑目录", exact: true })
    .click();
  await expect
    .poll(() => calls.filter((c) => c.method === "planAlbums.refresh").length)
    .toBe(1);
  assert.deepEqual(calls.find((c) => c.method === "planAlbums.refresh").input, {
    platform: "qqmusic",
    accountId: "fixture-account",
  });
  await page
    .getByRole("button", { name: "绑定已选专辑 ID", exact: true })
    .click();
  await expect(
    page.getByText(/已绑定 qqmusic \/ fixture-account/),
  ).toBeVisible();
  checks.push(
    "Read-only refresh preserves exact scope; run binding sends catalog ID and observed entry key",
  );
  await page.screenshot({ path: path.join(out, "01-catalog.png") });
  await page.getByLabel("Fixture account").selectOption("fixture-account-b");
  await expect(albums.locator('option[value="fixture-album-1"]')).toHaveCount(
    0,
  );
  await expect(page.getByLabel("Selected album snapshot")).toContainText(
    '"albumId":""',
  );
  await page.getByLabel("Fixture account").selectOption("fixture-account");
  await expect(albums.locator('option[value="fixture-album-1"]')).toHaveCount(
    1,
  );
  checks.push(
    "Account change clears stale catalog choices and selected album ID",
  );
  await page.getByLabel("专辑方式 1", { exact: true }).selectOption("new");
  await page
    .getByLabel("新专辑名称 1", { exact: true })
    .fill("Fixture new album");
  await page
    .getByLabel("新专辑描述 1", { exact: true })
    .fill("Fixture description");
  await page.getByRole("button", { name: "准备新建专辑", exact: true }).click();
  catalog.id = 'fixture-catalog-refreshed';
  await page.getByRole('button', {name:'重新准备',exact:true}).click();
  await expect.poll(()=>calls.filter(c=>c.method==='planAlbums.prepareCreate').length).toBe(2);
  assert.equal(calls.filter(c=>c.method==='planAlbums.confirm').length,0);
  checks.push('An undispatched operation exposes explicit reprepare after catalog refresh without retaining consent or performing a write');

  await page.getByRole("button", { name: "预览操作", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "确认专辑操作" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('label.check')).toHaveCSS('color','rgb(36, 60, 99)');
  await expect(dialog).toContainText("Fixture new album");
  await expect(dialog).toContainText("fixture-account");
  await expect(dialog).toContainText("线上未验证");
  assert.equal(
    calls.filter((c) => c.method === "planAlbums.confirm").length,
    0,
  );
  await page.screenshot({ path: path.join(out, "02-create-confirmation.png") });
  await dialog.getByLabel("我已核对本次专辑操作").check();
  await dialog
    .getByRole("button", { name: "确认执行本次操作", exact: true })
    .click();
  await expect(
    page.getByText("新建专辑 · 结果未知，仅可核对原操作", { exact: true }),
  ).toBeVisible({ timeout: 1000 });
  await expect(
    page.getByRole("button", { name: "预览操作", exact: true }),
  ).toHaveCount(0);
  checks.push(
    "Create requires exact operation preview and explicit summary acknowledgement before fixture confirm",
  );
  await expect(page.getByRole('button',{name:'重新准备',exact:true})).toHaveCount(0);
  const createBefore = calls.filter(
    (c) => c.method === "planAlbums.prepareCreate",
  ).length;
  await page
    .getByRole("button", { name: "只读核对原操作", exact: true })
    .click();
  await expect(
    page.getByText("FIXTURE_STILL_PENDING", { exact: true }),
  ).toBeVisible();
  assert.equal(
    calls.filter((c) => c.method === "planAlbums.prepareCreate").length,
    createBefore,
  );
  assert.equal(
    calls.filter((c) => c.method === "planAlbums.confirm").length,
    1,
  );
  checks.push(
    "Unknown operation offers only original-operation reconciliation and cannot redispatch",
  );
  await page.screenshot({
    path: path.join(out, "03-unknown-reconciliation.png"),
  });
  operations[0].state = "succeeded";
  operations[0].reason = undefined;
  operations[0].albumId = "fixture-album-1";
  appendAvailable = true;
  await page.reload();
  await expect(albums).toBeEnabled();
  await albums.selectOption("fixture-album-1");
  await page
    .getByRole("button", { name: "准备追加第 1 首", exact: true })
    .click();
  await page.getByRole("button", { name: "预览操作", exact: true }).click();
  await expect(dialog).toContainText("fixture-item");
  await expect(dialog).toContainText("不会代替版权、条款确认或正式提交");
  await dialog.getByLabel("我已核对本次专辑操作").check();
  await dialog
    .getByRole("button", { name: "确认执行本次操作", exact: true })
    .click();
  await expect(
    page.getByText("AWAITING_ORIGINAL_PUBLICATION", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("原发布任务：fixture-original-task", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "预览操作", exact: true }),
  ).toHaveCount(0);
  assert.equal(
    calls.filter((c) => c.method === "planAlbums.prepareAppend").length,
    1,
  );
  checks.push(
    "Append confirmation prepares the original publication task and retains dispatching, rights and terms gates",
  );
  await page.screenshot({
    path: path.join(out, "04-append-preparation.png"),
    fullPage: true,
  });
  createAvailable = false;
  await page.reload();
  await expect(albums).toBeEnabled();
  await albums.selectOption("fixture-album-1");
  await page.locator(".plan-album-capabilities summary").first().click();
  await expect(
    page
      .getByText("ALBUM_CREATE_CONTRACT_UNCALIBRATED", { exact: true })
      .first(),
  ).toBeVisible();
  await expect(
    page.getByText("CLOUD_BROWSER_SESSION_REQUIRED", { exact: true }).first(),
  ).toBeVisible();
  checks.push(
    "Capability details distinguish implemented code from missing create calibration and missing session",
  );
  await page.screenshot({
    path: path.join(out, "05-capability-gaps.png"),
    fullPage: true,
  });
  await page.getByRole('button',{name:'Fixture unsupported platform',exact:true}).click();
  await expect(page.getByLabel('专辑方式 1',{exact:true})).toBeDisabled();
  await expect(albums).toBeDisabled();
  await expect(page.getByRole('button',{name:'只读刷新专辑目录',exact:true})).toBeDisabled();
  await expect(page.getByText('此平台专辑适配器未实现，目录、新建和追加已禁用。',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'绑定已选专辑 ID',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'准备追加第 1 首',exact:true})).toBeDisabled();
  checks.push('A saved unsupported platform explicitly disables directory refresh, album selection and create-mode controls');
  await page.screenshot({path:path.join(out,'06-unsupported-disabled.png'),fullPage:true});
  assert.deepEqual(errors, []);
  assert(
    requests.every((url) => url.startsWith("https://album-fixture.invalid/")),
  );
  checks.push(
    "Every browser request intercepted; no account, external platform, native GUI, install or real write",
  );
  const report = {
    passed: true,
    checks,
    errors,
    requests,
    calls,
    source: "offline-fixture",
    onlineVerified: false,
    nativeGuiLaunched: false,
    externalWrites: false,
  };
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2),
  );
  fs.writeFileSync(
    path.resolve("output/album-integration/ui-report.md"),
    "# Album UI fixture verification\n\nPassed " +
      checks.length +
      " headless checks. Actual production React components; synthetic RPC fixture only. Online verification: false.\n\n" +
      checks.map((c) => "- " + c).join("\n") +
      "\n\nScreenshots: `ui/01-catalog.png`, `ui/02-create-confirmation.png`, `ui/03-unknown-reconciliation.png`, `ui/04-append-preparation.png`, `ui/05-capability-gaps.png`.\n",
  );
  console.log(JSON.stringify({ passed: true, checks, out }));
} catch (error) {
  if (browser) {
    const page = browser.contexts()[0]?.pages()[0];
    if (page) {
      fs.writeFileSync(
        path.join(out, "failure.txt"),
        await page.locator("body").innerText(),
      );
      await page
        .screenshot({ path: path.join(out, "failure.png") })
        .catch(() => {});
    }
  }
  throw error;
} finally {
  await browser?.close();
}
