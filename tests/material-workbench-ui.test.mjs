import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";
const folder = path.resolve("output/material-workbench-ui");
fs.mkdirSync(folder, { recursive: true });
await build({
  entryPoints: ["tests/fixtures/material-workbench-ui.tsx"],
  outfile: path.join(folder, "fixture.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
});
fs.writeFileSync(
  path.join(folder, "index.html"),
  '<meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><div id="root"></div><script src="fixture.js"></script>',
);
let browser;
before(async () => {
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ??
      [
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
        "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
        "/usr/bin/chromium",
      ].find((p) => fs.existsSync(p)),
    headless: true,
    args: ["--disable-background-networking", "--no-first-run", "--no-sandbox"],
  });
});
after(async () => browser?.close());
async function fixture(t) {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.route("**/*", (r) =>
    r.request().url().startsWith("file:") ? r.continue() : r.abort(),
  );
  await page.goto(pathToFileURL(path.join(folder, "index.html")).href);
  await page.getByText("Pending one", { exact: true }).waitFor();
  return page;
}
test("pending is default; failed and unknown stay actionable; generated remains in all/history", async (t) => {
  const p = await fixture(t);
  assert.equal(
    await p.getByText("Generated three", { exact: true }).count(),
    0,
  );
  assert.equal(await p.getByText("Failed four", { exact: true }).count(), 1);
  assert.equal(await p.getByText("Unknown five", { exact: true }).count(), 1);
  await p.getByLabel("显示范围").selectOption("all");
  assert.equal(
    await p.getByText("Generated three", { exact: true }).count(),
    1,
  );
});
test("filtering and rescanning preserve hidden selection; generated success clears only that stable ID", async (t) => {
  const p = await fixture(t);
  await p.getByLabel("选择 Pending one", { exact: true }).check();
  await p.getByLabel("选择 Pending two", { exact: true }).check();
  await p.getByLabel("搜索素材").fill("two");
  await p.getByRole("button", { name: "扫描目录", exact: true }).click();
  await p
    .getByRole("dialog", { name: "素材导入预览" })
    .getByRole("button", { name: "取消导入", exact: true })
    .click();
  await p.getByLabel("搜索素材").fill("");
  assert.equal(
    await p.getByLabel("选择 Pending one", { exact: true }).isChecked(),
    true,
  );
  await p.evaluate(() => window.fixture.complete("Pending one"));
  await p.getByRole("button", { name: "刷新状态", exact: true }).click();
  assert.equal(await p.getByText("Pending one", { exact: true }).count(), 0);
  assert.equal(
    await p.getByLabel("选择 Pending two", { exact: true }).isChecked(),
    true,
  );
  await p.getByLabel("显示范围").selectOption("all");
  assert.equal(
    await p.getByLabel("选择 Pending one", { exact: true }).isChecked(),
    false,
  );
});
test("directory selection does not scan and fee gate blocks enqueue", async (t) => {
  const p = await fixture(t);
  await p.getByRole("button", { name: "选择素材目录", exact: true }).click();
  assert.equal(
    await p.evaluate(
      () =>
        window.fixture.calls.filter((c) =>
          [
            "materials.scan",
            "materials.previewScan",
            "materials.confirmImport",
          ].includes(c[0]),
        ).length,
    ),
    0,
  );
  await p.getByLabel("选择 Pending one", { exact: true }).check();
  assert.equal(
    await p
      .getByRole("button", { name: "加入生成队列", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await p.evaluate(
      () =>
        window.fixture.calls.filter((c) => c[0] === "materials.enqueue").length,
    ),
    0,
  );
});
test("matched cover thumbnail opens dimensions, source path and frozen revision in details", async (t) => {
  const p = await fixture(t);
  await p
    .getByRole("button", { name: "查看 Pending one 封面", exact: true })
    .click();
  const dialog = p.getByRole("dialog");
  assert.equal(
    await dialog.getByText("1024 × 1024", { exact: true }).count(),
    1,
  );
  assert.equal(
    await dialog.getByText("fixture/source", { exact: true }).count(),
    1,
  );
  assert.equal(
    await dialog.getByText("封面修订 1", { exact: true }).count(),
    1,
  );
  await p.keyboard.press("Escape");
  assert.equal(await p.getByRole("dialog").count(), 0);
});
test("explicit consent sends selected revisions and configuration, never through list or filter", async (t) => {
  const p = await fixture(t);
  await p.evaluate(() => window.fixture.setAvailable());
  await p.getByRole("button", { name: "刷新状态", exact: true }).click();
  await p.getByLabel("选择 Pending one", { exact: true }).check();
  await p.getByLabel("生成艺人").selectOption("artist");
  await p.getByLabel("音乐 API 配置").selectOption("music");
  await p.getByLabel("预算额度").fill("5");
  assert.equal(
    await p
      .getByRole("button", { name: "加入生成队列", exact: true })
      .isDisabled(),
    true,
  );
  await p.getByLabel("我确认按所选配置和预算执行付费生成").check();
  await p.getByRole("button", { name: "加入生成队列", exact: true }).click();
  const calls = await p.evaluate(() =>
    window.fixture.calls.filter((c) => c[0] === "materials.enqueue"),
  );
  assert.equal(calls.length, 1);
  const input = calls[0][1];
  assert.deepEqual(input.materialIds, ["Pending one"]);
  assert.deepEqual(input.expectedRevisions, { "Pending one": 1 });
  assert.equal(input.profileId, "music");
  assert.equal(input.profileRevision, 1);
  assert.equal(input.modelId, "fixture-model");
  assert.equal(input.artistId, "artist");
  assert.equal(input.budgetCredits, 5);
  assert.equal(input.consent, true);
  assert.equal(input.regenerate, undefined);
});
test("each of 100 rows uses its individual backend cover association", async (t) => {
  const p = await fixture(t);
  await p.evaluate(() => window.fixture.setMany());
  await p.getByRole("button", { name: "刷新状态", exact: true }).click();
  const images = p.locator("tbody img");
  assert.equal(await images.count(), 100);
  assert.equal(
    await images.evaluateAll(
      (nodes) => new Set(nodes.map((n) => n.getAttribute("src"))).size,
    ),
    100,
  );
  await p
    .getByRole("button", { name: "查看 Material 100 封面", exact: true })
    .click();
  assert.equal(
    await p
      .getByRole("dialog")
      .getByText("fixture/cover-100.png", { exact: true })
      .count(),
    1,
  );
});
test("regeneration requires a separate explicit confirmation and retains prior versions", async (t) => {
  const p = await fixture(t);
  await p.evaluate(() => window.fixture.setAvailable());
  await p.getByRole("button", { name: "刷新状态", exact: true }).click();
  await p.getByLabel("生成艺人").selectOption("artist");
  await p.getByLabel("音乐 API 配置").selectOption("music");
  await p.getByLabel("预算额度").fill("5");
  await p.getByLabel("我确认按所选配置和预算执行付费生成").check();
  await p.getByLabel("显示范围").selectOption("generated");
  await p.getByRole("button", { name: "重新生成", exact: true }).click();
  assert.equal(
    await p.evaluate(
      () =>
        window.fixture.calls.filter((c) => c[0] === "materials.enqueue").length,
    ),
    0,
  );
  await p.getByRole("button", { name: "确认重新生成", exact: true }).click();
  const input = await p.evaluate(
    () => window.fixture.calls.find((c) => c[0] === "materials.enqueue")[1],
  );
  assert.equal(input.regenerate, true);
  assert.deepEqual(input.materialIds, ["Generated three"]);
  assert.equal(
    await p
      .getByRole("dialog")
      .getByText(/版本 A/)
      .count(),
    1,
  );
});
