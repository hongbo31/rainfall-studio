import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import {expect} from "@playwright/test";
test("unified publication progress polls and keeps selected-song authorization and submission gates", async () => {
  const bundle = await build({
    entryPoints: ["tests/fixtures/publication-pipeline-ui.tsx"],
    bundle: true,
    write: false,
    platform: "browser",
  });
  const server = http.createServer((req, res) => {
    res.setHeader(
      "Content-Type",
      req.url === "/app.js" ? "text/javascript" : "text/html",
    );
    res.end(
      req.url === "/app.js"
        ? bundle.outputFiles[0].text
        : '<div id="root"></div><script src="/app.js"></script>',
    );
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const executablePath =
    process.env.CHROME_PATH ??
    [
      "/usr/bin/chromium",
      "/usr/bin/google-chrome",
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    ].find((p) => fs.existsSync(p));
  const browser = await chromium
    .launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox"],
      env: { ...process.env, HOME: "/tmp" },
    })
    .catch(async (e) => {
      await new Promise((r) => server.close(r));
      throw e;
    });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole("button", { name: "发布", exact: true }).click();
    const progress = page.getByRole("region", { name: "发布进度" });
    await progress.waitFor();
    assert.ok((await progress.innerText()).includes("等待准备"));
    await page.waitForFunction(() => window.refreshCount > 0);
    assert.equal(
      await page.evaluate(
        () => window.calls.filter((c) => c.method === "publish.simple").length,
      ),
      1,
    );
    await page.evaluate(() => window.setStage("awaiting_authorization"));
    await progress.getByRole("button", { name: "核对投稿账号" }).click();
    assert.deepEqual(
      await page.evaluate(
        () => window.calls.find((c) => c.action === "inspect").input,
      ),
      { workId: "new-cloud-work" },
    );
    const authorize = progress.getByRole("button", { name: "确认并继续准备" });
    assert.equal(await authorize.isDisabled(), true);
    await progress.getByRole("checkbox").check();
    await authorize.click();
    assert.deepEqual(
      await page.evaluate(
        () => window.calls.find((c) => c.action === "register").input,
      ),
      { workId: "new-cloud-work", consent: true, authorizationNonce: "offline-inspection-nonce" },
    );
    assert.equal(
      await progress.getByRole("button", { name: "开始准备" }).count(),
      0,
    );
    await page.evaluate(() => window.setStage("awaiting_confirmation"));
    const submit = progress.getByRole("button", { name: "确认授权并提交审核" });
    assert.equal(await submit.isDisabled(), true);
    await progress
      .getByRole("button", { name: "提交前检查", exact: true })
      .click();
    assert.deepEqual(
      await page.evaluate(
        () => window.calls.find((c) => c.action === "preflight").input,
      ),
      { workId: "new-cloud-work" },
    );
    assert.equal(await submit.isDisabled(), true);
    await progress.getByRole("checkbox").nth(0).check();
    assert.equal(await submit.isDisabled(), true);
    await progress.getByRole("checkbox").nth(1).check();
    assert.equal(await submit.isEnabled(), true);
    assert.equal(
      await page.evaluate(
        () =>
          window.calls.filter((c) => c.action === "authorizeAndSubmit").length,
      ),
      0,
    );
    await page.evaluate(() => window.setStage("reconcile_required"));
    await expect(progress).toContainText("结果待核对，请勿重复提交");
    assert.equal(await submit.isDisabled(), true);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
});
