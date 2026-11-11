import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";
const folder = path.resolve("output/material-import-ui");
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
  page.setDefaultTimeout(4000);
  t.after(() => page.close());
  await page.route("**/*", (r) =>
    r.request().url().startsWith("file:") ? r.continue() : r.abort(),
  );
  await page.goto(pathToFileURL(path.join(folder, "index.html")).href);
  await page.getByText("Pending one", { exact: true }).waitFor();
  return page;
}
test("scan stages actual content and paths without mutating materials; cancel cannot commit", async (t) => {
  const p = await fixture(t);
  await p.getByRole("button", { name: "扫描目录", exact: true }).click();
  const preview = p.getByRole("dialog", { name: "素材导入预览" });
  await preview.waitFor();
  assert.equal(
    await preview.getByText("Preview actual lyrics", { exact: true }).count(),
    1,
  );
  assert.equal(
    await preview.getByText("Preview actual style", { exact: true }).count(),
    1,
  );
  assert.equal(
    await preview
      .getByRole("img", { name: "Suggested title 封面预览" })
      .count(),
    1,
  );
  assert.equal(
    await preview.getByLabel("歌词路径 row-one", { exact: true }).inputValue(),
    "song/lyrics.txt",
  );
  assert.equal(
    await p.evaluate(() =>
      window.fixture.calls.some((c) => c[0] === "materials.scan"),
    ),
    false,
  );
  assert.equal(
    await p.evaluate(() =>
      window.fixture.calls.some((c) => c[0] === "materials.confirmImport"),
    ),
    false,
  );
  await preview.getByRole("button", { name: "取消导入", exact: true }).click();
  assert.equal(await p.getByRole("dialog").count(), 0);
  assert.equal(await p.getByText("Pending one", { exact: true }).count(), 1);
});
test("repair title and role paths, acknowledge duplicates, then explicitly import checked rows", async (t) => {
  const p = await fixture(t);
  await p.getByRole("button", { name: "扫描目录", exact: true }).click();
  const preview = p.getByRole("dialog", { name: "素材导入预览" });
  await preview
    .getByLabel("标题 row-one", { exact: true })
    .fill("Confirmed title");
  await preview.getByText("选择候选封面", { exact: true }).click();
  await preview
    .getByLabel("候选封面 row-one", { exact: true })
    .selectOption("song/alternate.jpg");
  assert.equal(
    await preview
      .getByRole("button", { name: "确认导入", exact: true })
      .isDisabled(),
    true,
  );
  await preview
    .getByRole("button", { name: "保存并重新校验 row-one", exact: true })
    .click();
  await preview.getByLabel("我确认所选素材的标题和文件对应关系").check();
  assert.equal(
    await preview
      .getByRole("button", { name: "确认导入", exact: true })
      .isDisabled(),
    true,
  );
  await preview.getByLabel("我确认导入重复素材，保留独立记录和历史").check();
  await preview.getByRole("button", { name: "确认导入", exact: true }).click();
  await preview.waitFor({ state: "detached" });
  const updates = await p.evaluate(() =>
    window.fixture.calls.filter((c) => c[0] === "materials.updatePreview"),
  );
  assert.equal(updates.length, 1);
  assert.equal(updates[0][1].title, "Confirmed title");
  assert.equal(updates[0][1].coverPath, "song/alternate.jpg");
  const commits = await p.evaluate(() =>
    window.fixture.calls.filter((c) => c[0] === "materials.confirmImport"),
  );
  assert.equal(commits.length, 1);
  assert.deepEqual(commits[0][1], {
    previewId: "preview-one",
    rowIds: ["row-one"],
    confirmTitles: true,
    acceptDuplicates: true,
  });
});
test("missing cover can be repaired with explicit relative path; invalid rows block confirmation", async (t) => {
  const p = await fixture(t);
  await p.evaluate(() => window.fixture.previewMissing());
  await p.getByRole("button", { name: "扫描目录", exact: true }).click();
  const preview = p.getByRole("dialog", { name: "素材导入预览" });
  assert.equal(
    await preview
      .locator(".material-error")
      .getByText("cover_missing", { exact: true })
      .count(),
    1,
  );
  await preview.getByLabel("我确认所选素材的标题和文件对应关系").check();
  assert.equal(
    await preview
      .getByRole("button", { name: "确认导入", exact: true })
      .isDisabled(),
    true,
  );
  await preview
    .getByLabel("封面路径 row-one", { exact: true })
    .fill("song/manual.png");
  await preview
    .getByRole("button", { name: "保存并重新校验 row-one", exact: true })
    .click();
  assert.equal(
    await preview
      .locator(".material-error")
      .getByText("cover_missing", { exact: true })
      .count(),
    0,
  );
  assert.equal(
    await preview.getByLabel("我确认所选素材的标题和文件对应关系").isChecked(),
    false,
  );
});
test("root rebind opens a clearly marked preview and cancel never changes committed source", async (t) => {
  const p = await fixture(t);
  await p.getByRole("button", { name: "重新绑定目录", exact: true }).click();
  const preview = p.getByRole("dialog", { name: "素材导入预览" });
  await preview.waitFor();
  assert.equal(
    await preview.getByText("重新绑定预览", { exact: true }).count(),
    1,
  );
  assert.equal(
    await preview.getByText("fixture/moved-source", { exact: true }).count(),
    1,
  );
  await preview.getByRole("button", { name: "取消导入", exact: true }).click();
  const calls = await p.evaluate(() =>
    window.fixture.calls.filter(
      (c) => c[0] === "materials.chooseRebindDirectory",
    ),
  );
  assert.deepEqual(calls, [
    ["materials.chooseRebindDirectory", { sourceId: "source" }],
  ]);
  assert.equal(
    await p.evaluate(() =>
      window.fixture.calls.some((c) => c[0] === "materials.confirmImport"),
    ),
    false,
  );
});

test("new configured source becomes active; canceled native rebind opens no preview", async (t) => {
  const p = await fixture(t);
  await p.evaluate(() => window.fixture.chooseNewSource());
  await p.getByRole("button", { name: "选择素材目录", exact: true }).click();
  assert.equal(await p.getByLabel("扫描来源").inputValue(), "new-source");
  assert.equal(
    await p.evaluate(() =>
      window.fixture.calls.some((c) => c[0] === "materials.previewScan"),
    ),
    false,
  );
  await p.evaluate(() => window.fixture.cancelRebind());
  await p.getByRole("button", { name: "重新绑定目录", exact: true }).click();
  assert.equal(await p.getByRole("dialog").count(), 0);
  assert.equal(
    await p.evaluate(() =>
      window.fixture.calls.some((c) => c[0] === "materials.confirmImport"),
    ),
    false,
  );
});
test("source changes rejected at confirmation remain visible without closing preview or claiming success", async (t) => {
  const p = await fixture(t);
  await p.evaluate(() => window.fixture.rejectConfirm());
  await p.getByRole("button", { name: "扫描目录", exact: true }).click();
  const preview = p.getByRole("dialog", { name: "素材导入预览" });
  await preview.getByLabel("我确认所选素材的标题和文件对应关系").check();
  await preview.getByLabel("我确认导入重复素材，保留独立记录和历史").check();
  await preview.getByRole("button", { name: "确认导入", exact: true }).click();
  await preview
    .getByRole("alert")
    .getByText("源文件已变化，请取消预览后重新扫描", { exact: true })
    .waitFor();
  assert.equal(await p.getByText("素材已导入", { exact: true }).count(), 0);
  assert.equal(await p.getByText("Pending one", { exact: true }).count(), 1);
});
test("duplicates within a first import still require explicit acknowledgment", async (t) => {
  const p = await fixture(t);
  await p.evaluate(() => window.fixture.previewInternalDuplicate());
  await p.getByRole("button", { name: "扫描目录", exact: true }).click();
  const preview = p.getByRole("dialog", { name: "素材导入预览" });
  await preview.getByLabel("我确认所选素材的标题和文件对应关系").check();
  assert.equal(
    await preview
      .getByRole("button", { name: "确认导入", exact: true })
      .isDisabled(),
    true,
  );
  await preview.getByLabel("我确认导入重复素材，保留独立记录和历史").check();
  assert.equal(
    await preview
      .getByRole("button", { name: "确认导入", exact: true })
      .isEnabled(),
    true,
  );
  assert.equal(
    await preview.getByText("other-preview-row", { exact: true }).count(),
    1,
  );
});
test("import issues show Chinese repair guidance and visible paths while raw details stay expandable", async (t) => {
  const p = await fixture(t);
  for (const [code, expected] of [
    [
      "IMPORT_ROLE_MISSING_OR_AMBIGUOUS",
      "文件缺失或有多个候选，请明确选择文件",
    ],
    ["IMPORT_FILE_UNREADABLE", "文件无法读取，请检查权限或更换文件"],
    ["IMPORT_PATH_OUTSIDE_ROOT", "路径必须位于所选目录内，请重新选择"],
    ["IMPORT_LINK_REJECTED", "不支持链接或重定向路径，请选择目录内的实际文件"],
    ["IMPORT_SOURCE_BYTES_CHANGED", "源文件已变化，请取消预览后重新扫描"],
    [
      "IMPORT_DUPLICATE_REQUIRES_ACKNOWLEDGMENT",
      "检测到重复素材，请核对后勾选重复导入确认",
    ],
    ["IMPORT_FILE_SIZE_LIMIT", "文件过大，请缩小文件后重新扫描"],
    ["IMPORT_DEPTH_LIMIT", "目录层级过深，请将素材移到较浅的目录"],
    [
      "IMPORT_LEGACY_INDEX_SCHEMA",
      "旧版索引格式不正确，请检查索引或改用每首歌一个文件夹",
    ],
    [
      "IMPORT_MANIFEST_SCHEMA",
      "素材清单格式不正确，请检查清单中的标题和相对路径",
    ],
  ]) {
    const message = code + ": song/problem.png";
    await p.evaluate(
      (message) => window.fixture.previewIssue(message),
      message,
    );
    await p.getByRole("button", { name: "扫描目录", exact: true }).click();
    const preview = p.getByRole("dialog", { name: "素材导入预览" }),
      field = preview
        .locator(".material-import-role")
        .filter({ has: p.getByLabel("封面路径 row-one", { exact: true }) });
    assert.equal(
      await field.getByText(expected, { exact: true }).isVisible(),
      true,
    );
    assert.equal(
      await field.getByText("song/problem.png", { exact: true }).isVisible(),
      true,
    );
    assert.equal(
      await field.getByText(message, { exact: true }).isVisible(),
      false,
    );
    await field.getByText("查看原始错误", { exact: true }).click();
    assert.equal(
      await field.getByText(message, { exact: true }).isVisible(),
      true,
    );
    await preview
      .getByRole("button", { name: "取消导入", exact: true })
      .click();
  }
});

test("100-row preview confirmation stays inside the viewport and receives normal clicks with full app styles", async (t) => {
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 900, height: 600 },
    { width: 390, height: 844 },
  ]) {
    const p = await fixture(t);
    await p.setViewportSize(viewport);
    await p.evaluate(() => window.fixture.previewMany());
    await p.getByRole("button", { name: "扫描目录", exact: true }).click();
    assert.equal(await p.locator(".material-import-row").count(), 100);
    await p
      .locator(".material-import-footer input[type=checkbox]")
      .first()
      .check();
    const button = p.getByRole("button", { name: "确认导入", exact: true });
    await button.click();
    await p
      .getByRole("dialog", { name: "素材导入预览" })
      .waitFor({ state: "detached" });
    assert.equal(
      await p.evaluate(
        () =>
          window.fixture.calls.filter((c) => c[0] === "materials.confirmImport")
            .length,
      ),
      1,
    );
  }
});
test("a changed source suggestion is visible but only explicit use edits the saved title draft", async (t) => {
  const p = await fixture(t);
  await p.evaluate(() => window.fixture.previewSuggestedTitle());
  await p.getByRole("button", { name: "扫描目录", exact: true }).click();
  const preview = p.getByRole("dialog", { name: "素材导入预览" }),
    title = preview.locator(".material-import-title input");
  assert.equal(await title.inputValue(), "Previously confirmed title");
  assert.equal(
    await preview
      .getByText("来源建议标题：Changed source title", { exact: true })
      .isVisible(),
    true,
  );
  await preview
    .locator(".material-import-footer input[type=checkbox]")
    .first()
    .check();
  await preview
    .getByRole("button", { name: "使用建议标题", exact: true })
    .click();
  assert.equal(await title.inputValue(), "Changed source title");
  assert.equal(
    await preview
      .locator(".material-import-footer input[type=checkbox]")
      .first()
      .isChecked(),
    false,
  );
  assert.equal(
    await preview
      .getByRole("button", { name: "确认导入", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await p.evaluate(
      () =>
        window.fixture.calls.filter(
          (c) =>
            c[0] === "materials.updatePreview" ||
            c[0] === "materials.confirmImport",
        ).length,
    ),
    0,
  );
  await preview
    .getByRole("button", { name: "保存并重新校验 row-one", exact: true })
    .click();
  const saved = await p.evaluate(
    () =>
      window.fixture.calls.find((c) => c[0] === "materials.updatePreview")[1],
  );
  assert.equal(saved.title, "Changed source title");
  assert.equal(
    await preview
      .locator(".material-import-footer input[type=checkbox]")
      .first()
      .isChecked(),
    false,
  );
  assert.equal(
    await p.evaluate(() =>
      window.fixture.calls.some((c) => c[0] === "materials.confirmImport"),
    ),
    false,
  );
});
test("100-row content stays present while bulk candidate and history options mount only when requested", async (t) => {
  const p = await fixture(t);
  await p.evaluate(() => window.fixture.previewMany(true));
  await p.getByRole("button", { name: "扫描目录", exact: true }).click();
  const preview = p.getByRole("dialog", { name: "素材导入预览" });
  assert.equal(
    await preview.getByText("Preview actual lyrics", { exact: true }).count(),
    100,
  );
  assert.equal(
    await preview.getByText("Preview actual style", { exact: true }).count(),
    100,
  );
  assert.equal(
    await preview.locator(".material-import-cover img").count(),
    100,
  );
  assert.equal(await preview.locator('select[aria-label^="候选"]').count(), 0);
  assert.equal(
    await preview.locator('select[aria-label^="历史素材 ID"]').count(),
    0,
  );
  const row = preview.locator(".material-import-row").first();
  await row.getByText("选择候选封面", { exact: true }).click();
  assert.equal(
    await row
      .getByLabel("候选封面 row-0", { exact: true })
      .locator("option")
      .count(),
    101,
  );
  await row
    .getByLabel("候选封面 row-0", { exact: true })
    .selectOption("song-5/cover.png");
  assert.equal(
    await row.getByLabel("封面路径 row-0", { exact: true }).inputValue(),
    "song-5/cover.png",
  );
  await row.getByText("历史素材对应关系", { exact: true }).click();
  assert.equal(
    await row
      .getByLabel("历史素材 ID row-0", { exact: true })
      .locator("option")
      .count(),
    6,
  );
  assert.equal(await preview.locator('select[aria-label^="候选"]').count(), 1);
});
