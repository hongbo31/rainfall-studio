import { launchHeadlessChromium } from "../scripts/lib/headless-chromium.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright-core";
test("existing publish center ready list, explicit version, selection and unavailable targets", async () => {
  const dir = path.resolve("output/publication-music-ui");
  fs.mkdirSync(dir, { recursive: true });
  await build({
    entryPoints: ["tests/fixtures/publication-music-ui.tsx"],
    outfile: path.join(dir, "fixture.js"),
    bundle: true,
    platform: "browser",
    loader: { ".css": "css" },
  });
  const server = http.createServer((req, res) => {
    res.setHeader(
      "content-type",
      req.url === "/fixture.js" ? "application/javascript" : "text/html",
    );
    res.end(
      req.url === "/fixture.js"
        ? fs.readFileSync(path.join(dir, "fixture.js"))
        : '<div id="root"></div><script src="/fixture.js"></script>',
    );
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  let browser;
  try {
    browser = await launchHeadlessChromium(chromium, {
      });
    const page = await browser.newPage();
    await page.goto("http://127.0.0.1:" + server.address().port);
    await page.getByRole("checkbox", { name: "选择歌曲 Ready Song" }).check();
    assert.equal(
      await page.locator('[data-work-id="work-ready"] input').isChecked(),
      true,
    );
    assert.equal(await page.locator('[data-work-id="work-empty"]').count(), 0);
    assert.equal(await page.locator("audio").count(), 2);
    await page.getByLabel("Ready Song 发布版本").selectOption("B");
    await page.waitForFunction(
      () => window.lastCall?.method === "work.selectAudioVersion",
    );
    assert.deepEqual(await page.evaluate(() => window.lastCall.input), {
      workId: "work-ready",
      version: "B",
      expectedRevision: 1,
    });
    assert.equal(
      await page.locator(".simple-target input:disabled").count(),
      3,
    );
    assert.equal(await page.getByLabel("发布到 番茄音乐").isEnabled(), true);
    await page.getByLabel("歌曲状态平台").selectOption("netease");
    assert.equal(await page.locator('[data-work-id="work-ready"]').count(), 1);
    await page.getByLabel("歌曲发布状态").selectOption("published");
    assert.equal(await page.locator('[data-work-id="work-ready"]').count(), 0);
  } finally {
    await browser?.close();
    await new Promise((r) => server.close(r));
  }
});
