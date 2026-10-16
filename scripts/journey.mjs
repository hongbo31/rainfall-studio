import { _electron as electron, expect } from "@playwright/test";
import electronPath from "electron";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
const packaged = process.argv.includes("--packaged"),
  root = path.resolve(
    "output/journey-" + (packaged ? "packaged" : "dev") + "-" + Date.now(),
  ),
  shots = path.resolve("output/desktop-screenshots");
fs.mkdirSync(root, { recursive: true });
fs.mkdirSync(shots, { recursive: true });
const executable = packaged
  ? path.resolve("out/RainfallStudio-win32-x64/RainfallStudio.exe")
  : electronPath;
let app, page;
const errors = [],
  external = [],
  results = [];
const title = "雨停以后 · QA原创测试 " + Date.now();
const audioA = path.join(root, "original-A.wav"),
  audioB = path.join(root, "original-B.wav"),
  cover = path.join(root, "original-cover.png"),
  coverOut = path.join(root, "typeset-cover.png"),
  backup = path.join(root, "journey.rainfall-backup.zip");
function wav(file, hz) {
  const rate = 16000,
    n = rate * 6,
    b = Buffer.alloc(44 + n * 2);
  b.write("RIFF");
  b.writeUInt32LE(36 + n * 2, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++)
    b.writeInt16LE(Math.sin((i * 2 * Math.PI * hz) / rate) * 3000, 44 + i * 2);
  fs.writeFileSync(file, b);
}
wav(audioA, 440);
wav(audioB, 523.25);
await sharp(
  Buffer.from(
    '<svg width="1000" height="1000"><defs><linearGradient id="a" x2="1" y2="1"><stop stop-color="#2d3048"/><stop offset="1" stop-color="#aa7f92"/></linearGradient></defs><rect width="1000" height="1000" fill="url(#a)"/><circle cx="700" cy="280" r="145" fill="#e4c8c5" fill-opacity=".45"/><path d="M0 800 Q300 570 550 800T1000 780V1000H0" fill="#251f35"/><path d="M100 100L20 500M300 0L200 600M500 100L400 700M750 40L620 650M980 100L850 700" stroke="#dfcbe5" stroke-opacity=".18" stroke-width="3"/><text x="80" y="920" fill="#d5c1df" font-family="Segoe UI" font-size="25">ORIGINAL QA ART · LOCAL TEST ASSET</text></svg>',
  ),
)
  .png()
  .toFile(cover);
async function launch() {
  app = await electron.launch({
    executablePath: executable,
    args: packaged ? [] : ["."],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined,
      RAINFALL_DATA_ROOT: root,
      RAINFALL_MODE: "simulation",
    },
    timeout: 30000,
  });
  app.process().stderr?.on("data", (b) => process.stderr.write(b));
  page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (/^https?:/.test(r.url())) external.push(r.url());
  });
  await page.getByRole("heading", { name: "让故事，成为下一首歌。" }).waitFor();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1440, 1000),
  );
}
async function snapshot() {
  return page.evaluate(async () => {
    const r = await window.rainfall.call("snapshot");
    if (!r.ok) throw Error(r.error.message);
    return r.value;
  });
}
async function openFile(file) {
  await app.evaluate(({ dialog }, f) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] });
  }, file);
}
async function saveFile(file) {
  await app.evaluate(({ dialog }, f) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: f });
  }, file);
}
async function nav(name) {
  await page.getByRole("button", { name, exact: true }).click();
}
async function track() {
  await nav("作品库");
  await page.getByRole("heading", { name: title, exact: true }).click();
  await page.getByRole("heading", { name: title, exact: true }).waitFor();
}
try {
  await launch();
  await page.screenshot({
    path: path.join(shots, packaged ? "packaged-overview.png" : "overview.png"),
  });
  const dpapi = await app.evaluate(
    ({ safeStorage }, args) => {
      const req = process.getBuiltinModule("module").createRequire(args.module);
      const { CredentialVault } = req(args.module);
      const fs = req("node:fs");
      const vault = new CredentialVault(args.folder, safeStorage);
      const binding = {
        accountId: "11111111-1111-4111-8111-111111111111",
        providerId: "qa",
        remoteSubject: "synthetic-qa",
      };
      const secret = "QA_ONLY_NOT_A_REAL_CREDENTIAL";
      vault.put(binding, secret);
      const encrypted = fs.readFileSync(
        req("node:path").join(args.folder, binding.accountId + ".bin"),
      );
      const result = {
        available: safeStorage.isEncryptionAvailable(),
        roundtrip: vault.get(binding) === secret,
        plaintextAbsent: !encrypted.includes(Buffer.from(secret)),
      };
      let rejected = false;
      try {
        vault.get({ ...binding, remoteSubject: "other" });
      } catch {
        rejected = true;
      }
      vault.delete(binding);
      return { ...result, wrongIdentityRejected: rejected };
    },
    {
      module: path.resolve(
        packaged
          ? "out/RainfallStudio-win32-x64/resources/app.asar/build/vault.cjs"
          : "build/vault.cjs",
      ),
      folder: path.join(root, "qa-secret-test"),
    },
  );
  assert.ok(Object.values(dpapi).every(Boolean));
  results.push(
    "DPAPI real encrypted roundtrip / identity binding / delete (synthetic secret only)",
  );
  await nav("创作向导");
  await page.getByLabel("歌名", { exact: true }).fill(title);
  await page
    .getByLabel("故事", { exact: true })
    .fill("原创QA验证：雨停以后，在街角再次遇见。");
  await page
    .getByRole("button", { name: "生成本地歌词与提示词 →", exact: true })
    .click();
  await page.getByRole("heading", { name: title, exact: true }).waitFor();
  const workId = (await snapshot()).works.find((w) => w.title === title).id;
  await page
    .getByLabel("编辑歌词")
    .fill("这是原创QA测试歌词\n雨停以后，你仍在这里");
  await page
    .getByLabel("授权依据")
    .fill(
      "原创QA测试音：程序生成正弦波；程序绘制图像；原创测试文字，仅供本地软件验收。",
    );
  await page.getByLabel("AI 参与声明").selectOption("none");
  await expect
    .poll(async () => (await snapshot()).works.find((w) => w.id === workId).ai)
    .toBe("none");
  await openFile(audioA);
  await page.getByRole("button", { name: "导入音频 A", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await snapshot()).works.find((w) => w.id === workId).assets.audio_A,
    )
    .toBeTruthy();
  await openFile(audioB);
  await page.getByRole("button", { name: "导入音频 B", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await snapshot()).works.find((w) => w.id === workId).assets.audio_B,
    )
    .toBeTruthy();
  await page.getByRole("button", { name: "▷ 试听 A", exact: true }).click();
  await expect
    .poll(() => page.locator("audio").evaluate((a) => a.duration))
    .toBeGreaterThan(5);
  await expect
    .poll(() => page.locator("audio").evaluate((a) => a.currentTime))
    .toBeGreaterThan(0.1);
  await page.getByRole("button", { name: "▷ 试听 B", exact: true }).click();
  await expect.poll(() => page.locator("#now").innerText()).toContain("B版");
  results.push("UI create/edit/autosave, native import A/B, actual playback");
  await page.getByRole("button", { name: "保存版本", exact: true }).click();
  await page.getByRole("button", { name: "封面工作室 →", exact: true }).click();
  await openFile(cover);
  await page
    .getByRole("button", { name: "＋ 导入本地封面", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await snapshot()).works.find((w) => w.id === workId).assets.cover,
    )
    .toBeTruthy();
  await page
    .getByRole("button", { name: "生成封面提示词 · 本地", exact: true })
    .click();
  assert.ok(
    (await page.getByLabel("封面任务文本").inputValue()).includes(
      "没有内置免费Codex图像API",
    ),
  );
  await saveFile(coverOut);
  await page
    .getByRole("button", { name: "导出 PNG 并保存派生版本", exact: true })
    .click();
  await expect.poll(() => fs.existsSync(coverOut)).toBe(true);
  assert.equal((await sharp(coverOut).metadata()).width, 3000);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator("#toast.show").waitFor({ state: "hidden" });
  await page.screenshot({ path: path.join(shots, "cover-studio.png") });
  results.push("cover task / native import / 3000px typeset export / versions");
  await nav("账号设置");
  await page.getByLabel("平台", { exact: true }).selectOption("netease");
  await page.getByLabel("账号备注名").fill("QA发行账号 " + workId.slice(0, 6));
  await page
    .getByRole("button", { name: "保存本地账号资料", exact: true })
    .click();
  const account = (await snapshot()).accounts.at(-1);
  await page.getByLabel("平台账号", { exact: true }).selectOption(account.id);
  await page.getByRole("button", { name: "建立本地绑定", exact: true }).click();
  await expect
    .poll(async () =>
      (await snapshot()).bindings.some((b) => b.accountId === account.id),
    )
    .toBe(true);
  await nav("作品库");
  await page.getByLabel("选择 " + title, { exact: true }).check();
  await page
    .getByRole("button", { name: "准备批量发布 →", exact: true })
    .click();
  await page
    .locator(".destination")
    .filter({ hasText: "网易云音乐" })
    .getByRole("checkbox")
    .check();
  await page
    .getByLabel("网易云音乐账号", { exact: true })
    .selectOption(account.id);
  await page
    .getByRole("button", { name: "生成批次并预检 →", exact: true })
    .click();
  await page.getByRole("button", { name: "确认演练范围", exact: true }).click();
  await page.getByRole("dialog").getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "开始已确认演练", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await snapshot()).units.find((u) => u.workId === workId)?.state,
      { timeout: 20000 },
    )
    .toBe("SUBMITTED");
  const unit = (await snapshot()).units.find((u) => u.workId === workId);
  assert.equal(unit.review, "pending");
  assert.equal(unit.publication, "unknown");
  await expect(
    page.locator("tbody").getByText("已提交", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: path.join(shots, "publish-center.png") });
  results.push(
    "UI account + binding / selected work / preflight / scoped simulation approval / independent review & live",
  );
  await saveFile(backup);
  await page.getByRole("button", { name: "↗ 备份导出", exact: true }).click();
  await expect.poll(() => fs.existsSync(backup)).toBe(true);
  await snapshot();
  await app.close();
  app = null;
  fs.unlinkSync(audioA);
  fs.unlinkSync(audioB);
  fs.unlinkSync(cover);
  await launch();
  await track();
  await page.getByRole("button", { name: "▷ 试听 A", exact: true }).click();
  await expect
    .poll(() => page.locator("audio").evaluate((a) => a.duration))
    .toBeGreaterThan(5);
  await expect
    .poll(() =>
      page
        .locator(".cover img")
        .first()
        .evaluate((i) => i.naturalWidth),
    )
    .toBeGreaterThan(0);
  results.push(
    "close/reopen after deleting source files: persistent A/B audio & cover",
  );
  await nav("账号设置");
  await openFile(backup);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "从备份恢复", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await snapshot()).accounts.find((a) => a.id === account.id)
          ?.authStatus,
    )
    .toBe("reauth_required");
  assert.equal(
    (await snapshot()).units.find((u) => u.id === unit.id).state,
    "SUBMITTED",
  );
  results.push(
    "native ZIP restore keeps receipt/media and invalidates authorization",
  );
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1280, 720),
  );
  await nav("发布中心");
  await page.screenshot({ path: path.join(shots, "low-height-publish.png") });
  const clipped = await page
    .locator("nav button")
    .evaluateAll((nodes) =>
      nodes.some(
        (n) => n.getBoundingClientRect().bottom > window.innerHeight - 90,
      ),
    );
  assert.equal(clipped, false);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setContentSize(1440, 1000);
    w.webContents.setZoomFactor(1.5);
  });
  await nav("封面工作室");
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await app.evaluate(
    async ({ BrowserWindow }, file) => {
      const captured = await BrowserWindow.getAllWindows()[0].capturePage();
      process.getBuiltinModule("fs").writeFileSync(file, captured.toPNG());
    },
    path.join(shots, "zoom150-cover.png"),
  );
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1),
  );
  results.push("1280x720 navigation / 150% text visual capture");
  await page.getByLabel("工作区模式").selectOption("production");
  await expect
    .poll(
      async () => {
        try {
          return (await snapshot()).mode;
        } catch {
          return "switching";
        }
      },
      { timeout: 30000 },
    )
    .toBe("production");
  assert.equal((await snapshot()).works.length, 0);
  results.push("production/simulation physically isolated");
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(
    JSON.stringify(
      {
        packaged,
        passed: results.length,
        results,
        errors,
        externalRequests: 0,
      },
      null,
      2,
    ),
  );
} catch (error) {
  if (page) {
    await page
      .screenshot({ path: path.join(shots, "journey-failure.png") })
      .catch(() => {});
    fs.writeFileSync(
      path.join(shots, "journey-failure.html"),
      await page.content().catch(() => ""),
    );
  }
  throw error;
} finally {
  if (app) await app.close();
  fs.writeFileSync(
    path.join(shots, packaged ? "packaged-journey.json" : "journey.json"),
    JSON.stringify(
      {
        packaged,
        results,
        errors,
        externalRequests: external,
        finishedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}
