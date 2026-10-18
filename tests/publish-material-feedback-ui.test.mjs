import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { randomUUID, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { chromium } from "playwright-core";
const dir = path.resolve("output/publish-material-feedback");
fs.mkdirSync(dir, { recursive: true });
await build({
  entryPoints: ["src/core/index.ts"],
  outfile: path.join(dir, "core.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
});
await build({
  entryPoints: ["tests/fixtures/publish-material-feedback-ui.tsx"],
  outfile: path.join(dir, "fixture.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  loader: { ".css": "css" },
});
const { Studio } = createRequire(import.meta.url)(path.join(dir, "core.cjs"));
let s,
  work,
  original,
  input,
  flags = {},
  calls = 0,
  server,
  browser,
  page,
  origin,
  errors = [];
function asset(role) {
  const bytes = Buffer.from(randomUUID()),
    sha256 = createHash("sha256").update(bytes).digest("hex"),
    id = randomUUID(),
    ext = role === "cover" ? "png" : "wav",
    folder = path.join(s.root, "media/sha256", sha256.slice(0, 2));
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, sha256 + "." + ext), bytes);
  s.save("assets", {
    id,
    sha256,
    ext,
    kind: role === "cover" ? "image" : "audio",
    mime: role === "cover" ? "image/png" : "audio/wav",
    label: "已存的新作A.wav",
    bytes: bytes.length,
    metadata: {
      width: 1254,
      height: 1254,
      format: { duration: "174.813515" },
      streams: [
        { codec_type: "audio", codec_name: "pcm_s16le", sample_rate: "44100" },
      ],
    },
  });
  const w = s.get("works", work.id);
  s.save("works", { ...w, assets: { ...w.assets, [role]: id } });
}
async function reset(kind = "full", extra = {}) {
  s?.close();
  s = new Studio(path.join(dir, "fixtures", randomUUID()), "production");
  flags = { ...extra };
  calls = 0;
  const a = s.all("artists")[0];
  s.save("artists", { ...a, name: "已存艺名" });
  work = s.saveWork({
    title: "已存的新作",
    artistId: a.id,
    story: "门口告别",
    lyrics:
      kind === "missing"
        ? ""
        : "[Verse 1]\n把日子慢慢走\n\n[Chorus]\n示例作品B",
    prompt: "warm pop",
    parameters: { language: "中文", genre: "温柔流行" },
    rights: "AI来源已记录，权益待核实",
    ai: "generated",
  });
  const account = await s.call("account.save", {
      provider: "tme",
      name: "已存QQ账号",
      dailyLimit: 10,
    }),
    c = (await s.call("platformConfig.list")).find(
      (c) => c.target === "qqmusic",
    ),
    { version, revision, ...config } = c;
  await s.call("platformConfig.save", {
    config: {
      ...config,
      accountId: account.id,
      artistId: a.id,
      lyricist: "已存词作者",
      composer: "已存曲作者",
      album: "已存专辑",
    },
    expectedRevision: revision,
  });
  asset("audio_A");
  if (kind !== "missing") asset("cover");
  original = s.get("works", work.id);
  input = { workIds: [work.id], targets: ["qqmusic"], accountOverrides: {} };
  await s.call("publish.selection.save", input);
  if (kind === "return") {
    await s.call("publish.simple", input);
    s.save("works", { ...original, title: "后来的标题" });
    await s.call("publish.simple", input);
    s.save("works", original);
  }
  await page.goto(origin);
  await page.getByRole("button", { name: "发布", exact: true }).waitFor();
}
before(async () => {
  server = http.createServer(async (req, res) => {
    try {
      if (req.url === "/rpc") {
        let raw = "";
        for await (const b of req) raw += b;
        const { method, input: args } = JSON.parse(raw);
        if (
          !["snapshot", "publish.simple", "publish.selection.save"].includes(
            method,
          )
        )
          throw Error("OFFLINE_METHOD_DENIED");
        if (method === "publish.simple") {
          calls++;
          if (flags.delay) await new Promise((r) => setTimeout(r, flags.delay));
          if (flags.fail) {
            flags.fail = false;
            throw Error("本地检查暂不可用");
          }
        }
        if (method === "publish.selection.save" && flags.saveFail) {
          flags.saveFail = false;
          throw Error("选择保存失败");
        }
        const value =
          method === "snapshot"
            ? {
                ...s.snapshot(),
                ...(flags.modeOverride ? { mode: flags.modeOverride } : {}),
                fixtureId: s.root,
              }
            : await s.call(method, args);
        if (method === "publish.simple" && flags.mutateAfterCheck) {
          s.save("works", {
            ...s.get("works", work.id),
            lyrics: "changed after check",
          });
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, value }));
        return;
      }
      const files = {
        "/fixture.js": ["fixture.js", "text/javascript"],
        "/fixture.css": ["fixture.css", "text/css"],
      };
      if (files[req.url]) {
        const [file, type] = files[req.url];
        res.writeHead(200, { "content-type": type });
        res.end(fs.readFileSync(path.join(dir, file)));
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        '<!doctype html><html lang="zh-CN"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>',
      );
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  origin = "http://127.0.0.1:" + server.address().port;
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ?? ["/usr/bin/chromium", "/usr/bin/google-chrome", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"].find(p => fs.existsSync(p)),
    headless: true,
    args: ["--disable-gpu"],
  });
  page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  page.setDefaultTimeout(2000);
  await page.route("**/*", (route) =>
    route.request().url().startsWith(origin) ? route.continue() : route.abort(),
  );
  page.on("pageerror", (e) => errors.push(e.message));
});
after(async () => {
  await browser?.close();
  await new Promise((r) => server?.close(r));
  s?.close();
  assert.deepEqual(errors, []);
});
test("inline result follows background invalidation and can recheck current materials", async () => {
  await reset();
  await page.getByRole("button", { name: "发布", exact: true }).click();
  const r = page.getByRole("region", { name: "本次发布材料" });
  await r.waitFor();
  const oldId = await r
    .locator("[data-request-id]")
    .getAttribute("data-request-id");
  s.save("works", { ...original, lyrics: "background changed lyrics" });
  await page.evaluate(() => window.refreshFixture());
  await r.getByText("资料已变化", { exact: true }).waitFor();
  assert.ok(!(await r.innerText()).includes("已准备 · 未上传"));
  await r.getByRole("button", { name: "重新检查", exact: true }).click();
  await page.waitForFunction(
    (id) =>
      document
        .querySelector(".publication-current-result [data-request-id]")
        ?.getAttribute("data-request-id") !== id,
    oldId,
  );
  assert.equal(await r.getByText("资料已变化", { exact: true }).count(), 0);
});

test("a material mutation between check and refreshed response marks the inline result stale", async () => {
  await reset("full", { mutateAfterCheck: true });
  await page.getByRole("button", { name: "发布", exact: true }).click();
  const r = page.getByRole("region", { name: "本次发布材料" });
  await r.getByText("资料已变化", { exact: true }).waitFor();
  assert.equal(
    await r.getByRole("button", { name: "重新检查", exact: true }).count(),
    1,
  );
});
test("click prepares real Core materials beside action and exposes the unavailable QQ transport", async () => {
  await reset();
  await page.getByRole("button", { name: "发布", exact: true }).click();
  const result = page.getByRole("region", { name: "本次发布材料" });
  await result.waitFor();
  assert.match(await result.innerText(), /暂不能提交：QQ音乐上传未接通/);
  assert.match(await result.innerText(), /歌词已准备/);
  assert.match(await result.innerText(), /封面已准备/);
  await result.getByText("查看已准备材料", { exact: true }).click();
  for (const text of ["已存词作者", "已存曲作者", "已存艺名", "AI生成"])
    assert.ok((await result.innerText()).includes(text), text);
  const lyrics = await result
    .locator('[aria-label="发布歌词预览"]')
    .inputValue();
  assert.ok(!lyrics.includes("[Chorus]"));
  assert.ok(lyrics.includes("示例作品B"));
  assert.equal(calls, 1);
  assert.equal(s.all("operations").length, 0);
  assert.equal(s.externalRequests, 0);
  assert.equal(await result.getAttribute("aria-busy"), "false");
  await page.screenshot({
    path: path.join(dir, "publish-materials-headless.png"),
    fullPage: true,
  });
});
test("missing materials expose direct repair actions without empty manual duplicate forms", async () => {
  await reset("missing");
  await page.getByRole("button", { name: "发布", exact: true }).click();
  const r = page.getByRole("region", { name: "本次发布材料" });
  await r.waitFor();
  await r.getByRole("button", { name: "补歌词", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.lastNavigation), {
    page: "track",
    id: work.id,
  });
  assert.equal(
    await r.getByRole("button", { name: "补封面", exact: true }).count(),
    1,
  );
  assert.equal(await r.getByRole("textbox").count(), 0);
});
test("an immediate repeated click is locked until preparation completes", async () => {
  await reset("full", { delay: 400 });
  await page.getByRole("button", { name: "发布", exact: true }).click();
  const busy = page.getByRole("button", { name: "正在准备材料…", exact: true });
  assert.equal(await busy.isDisabled(), true);
  await busy.evaluate((b) => b.click());
  assert.equal(
    await page.getByRole("checkbox", { name: "发布到 QQ 音乐" }).isDisabled(),
    true,
  );
  await page.getByRole("region", { name: "本次发布材料" }).waitFor();
  assert.equal(calls, 1);
});
test("reuse displays the returned older task instead of a newer unrelated history row", async () => {
  await reset("return");
  const expected = await s.call("publish.simple", input);
  calls = 0;
  await page.getByRole("button", { name: "发布", exact: true }).click();
  const r = page.getByRole("region", { name: "本次发布材料" });
  await r.waitFor();
  assert.equal(
    await r.locator("[data-request-id]").getAttribute("data-request-id"),
    expected.requests[0].id,
  );
  assert.equal(
    s
      .all("settings")
      .filter((v) => v.id.startsWith("simple-publishing:request:")).length,
    2,
  );
  assert.ok((await r.innerText()).includes("已重新核验"));
  assert.equal(calls, 1);
});
test("changing material invalidates history and rechecks to a new snapshot", async () => {
  await reset();
  await s.call("publish.simple", input);
  s.save("works", { ...original, lyrics: "修改后的歌词" });
  await page.evaluate(() => window.refreshFixture());
  assert.ok(
    (await page.getByRole("region", { name: "发布任务" }).innerText()).includes(
      "资料已变化",
    ),
  );
  await page.getByRole("button", { name: "发布", exact: true }).click();
  const r = page.getByRole("region", { name: "本次发布材料" });
  await r.waitFor();
  await r.getByText("查看已准备材料", { exact: true }).click();
  assert.equal(
    await r.locator('[aria-label="发布歌词预览"]').inputValue(),
    "修改后的歌词",
  );
});
test("async failure stays beside action and retry succeeds without a second native operation", async () => {
  await reset("full", { fail: true });
  await page.getByRole("button", { name: "发布", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.match(
    await page.getByRole("alert").innerText(),
    /材料准备失败.*本地检查暂不可用/,
  );
  const retry = page.getByRole("button", { name: "重试准备", exact: true });
  assert.equal(await retry.isEnabled(), true);
  await retry.click();
  await page.getByRole("region", { name: "本次发布材料" }).waitFor();
  assert.equal(s.all("operations").length, 0);
});
test("selection-save failure does not dispatch preparation and is retryable", async () => {
  await reset("full", { saveFail: true });
  await page.getByRole("button", { name: "发布", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.match(await page.getByRole("alert").innerText(), /选择保存失败/);
  assert.equal(calls, 0);
  await page.getByRole("button", { name: "重试准备", exact: true }).click();
  await page.getByRole("region", { name: "本次发布材料" }).waitFor();
  assert.equal(calls, 1);
});
test("a late result after an external mode change never appears in the new workspace", async () => {
  await reset("full", { delay: 300 });
  await page.getByRole("button", { name: "发布", exact: true }).click();
  flags.modeOverride = "simulation";
  await page.evaluate(() => window.switchFixtureMode("simulation"));
  await page
    .getByRole("button", { name: "发布（模拟）", exact: true })
    .waitFor();
  await page.waitForFunction(
    () => !document.querySelector(".simple-publish-action button").disabled,
  );
  assert.equal(
    await page.getByRole("region", { name: "本次发布材料" }).count(),
    0,
  );
  assert.equal(calls, 1);
});
