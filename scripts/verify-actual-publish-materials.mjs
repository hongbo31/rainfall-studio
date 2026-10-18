// Optional local acceptance against existing work; SQLite is opened read-only.
// All publish/selection writes below go only to in-memory Maps, never to Studio/runtime.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { build } from "esbuild";
import Database from "better-sqlite3";
import { chromium } from "playwright-core";
const outputArg = process.argv.indexOf("--output");
const uiArg = process.argv.indexOf("--ui-root");
const uiRoot = uiArg < 0 ? null : path.resolve(process.argv[uiArg + 1]);
const appVersion = uiRoot
  ? JSON.parse(
      fs.readFileSync(path.resolve(uiRoot, "../../package.json"), "utf8"),
    ).version
  : null;
const dir = path.resolve(
    outputArg < 0
      ? "output/publish-material-feedback"
      : process.argv[outputArg + 1],
  ),
  root = path.resolve(
    "out/tme-readiness-f98b20328ab4-1792145753240/candidate-data",
  ),
  workId = "00000000-0000-4000-8000-000000000001";
await build({
  stdin: {
    contents:
      'export {publishSimple,savePublishSelection,listSimplePublicationRequests} from "./src/core/simple-publication";export {listPlatformConfigurations} from "./src/core/platform-config";export {LyricService} from "./src/core/lyrics";export {locate} from "./src/core/assets";export {inspectPcmWav} from "./src/shared/pcm-wav";export {inspectTmeAiSubmissionWork} from "./src/core/tme-ai-submission-integration";',
    resolveDir: process.cwd(),
  },
  outfile: path.join(dir, "readonly-actual.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
});
await build({
  entryPoints: ["tests/fixtures/publish-material-feedback-ui.tsx"],
  outfile: path.join(dir, "actual-ui.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  loader: { ".css": "css" },
});
const lib = createRequire(import.meta.url)(
    path.join(dir, "readonly-actual.cjs"),
  ),
  db = new Database(path.join(root, "production/library.sqlite"), {
    readonly: true,
    fileMustExist: true,
  });
const read = (table) =>
  db
    .prepare(`SELECT data FROM ${table}`)
    .all()
    .map((r) => JSON.parse(r.data));
const work = read("works").find((w) => w.id === workId);
assert.ok(work);
const tables = new Map();
for (const table of ["works", "artists", "assets", "accounts", "settings"]) {
  let rows = read(table);
  if (table === "works") rows = [work];
  if (table === "settings")
    rows = rows.filter(
      (r) =>
        r.id.startsWith("simple-publishing:") ||
        (r.kind === "lyrics-version" && r.version?.workId === workId) ||
        (r.id.startsWith("tme-ai-prepare:") &&
          (r.value?.workId === workId || r.value?.input?.workId === workId)),
    );
  if (table === "accounts")
    rows = rows.map((a) => ({
      id: a.id,
      provider: a.provider,
      name: a.name,
      authStatus: a.authStatus,
      remoteSubject: a.remoteSubject,
    }));
  tables.set(table, new Map(rows.map((r) => [r.id, structuredClone(r)])));
}
db.close();
let memoryWrites = 0,
  selection = { workIds: [workId], targets: ["qqmusic"], accountOverrides: {} };
const repo = {
  all: (t) => [...(tables.get(t)?.values() ?? [])],
  get(t, id) {
    const r = tables.get(t)?.get(id);
    if (!r) throw Error("NOT_FOUND");
    return r;
  },
  maybe(t, id) {
    return tables.get(t)?.get(id);
  },
  save(t, row) {
    memoryWrites++;
    tables.get(t).set(row.id, structuredClone(row));
  },
  transaction: (fn) => fn(),
};
const s = {
  root,
  mode: "production",
  repo,
  now: () => new Date(),
  get: (...a) => repo.get(...a),
  all: (t) => repo.all(t),
  save: (t, row) => repo.save(t, row),
  locate: (id) => lib.locate(s, id),
  lyricService: () => lyrics,
};
const lyrics = new lib.LyricService(s);
const snapshot = () => ({
  fixtureId: workId,
  mode: "production",
  works: [work],
  assets: repo.all("assets"),
  artists: repo.all("artists"),
  accounts: repo.all("accounts"),
  platformConfigurations: lib.listPlatformConfigurations(repo),
  publicationRequests: lib.listSimplePublicationRequests(s),
  publicationPendingTerms: [],
  publishSelection: selection,
  // Only used to mount the full packaged renderer before navigating to Publish.
  // No budget/analytics claims are made by this scoped acceptance fixture.
  resources: {
    finished: 0,
    cost: { available: 0, reserved: 0 },
    candidate: { available: 0, spent: 0, reserved: 0 },
  },
  series: [],
  plans: [],
  exceptions: [],
});
let returned,
  requests = 0,
  server,
  browser;
const errors = [];
try {
  server = http.createServer(async (req, res) => {
    try {
      if (req.url === "/rpc") {
        let raw = "";
        for await (const b of req) raw += b;
        const x = JSON.parse(raw);
        let value;
        if (x.method === "runtime")
          value = { appVersion, packaged: true, headlessAcceptance: true };
        else if (x.method === "snapshot") value = snapshot();
        else if (x.method === "publish.selection.save") {
          selection = x.input;
          value = lib.savePublishSelection(s, selection);
        } else if (x.method === "publish.simple") {
          requests++;
          returned = lib.publishSimple(s, x.input);
          value = returned;
        } else throw Error("READ_ONLY_FIXTURE_SCOPE");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, value }));
        return;
      }
      if (uiRoot) {
        const file = path.resolve(
          uiRoot,
          "." +
            (req.url === "/"
              ? "/index.html"
              : decodeURIComponent(req.url.split("?")[0])),
        );
        if (!file.startsWith(uiRoot + path.sep))
          throw Error("STATIC_PATH_SCOPE");
        res.writeHead(200, {
          "content-type": file.endsWith(".js")
            ? "text/javascript"
            : file.endsWith(".css")
              ? "text/css"
              : "text/html; charset=utf-8",
        });
        res.end(fs.readFileSync(file));
        return;
      }
      const f =
        req.url === "/fixture.js"
          ? ["actual-ui.js", "text/javascript"]
          : req.url === "/fixture.css"
            ? ["actual-ui.css", "text/css"]
            : null;
      if (f) {
        res.writeHead(200, { "content-type": f[1] });
        res.end(fs.readFileSync(path.join(dir, f[0])));
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        '<html lang="zh-CN"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>',
      );
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = "http://127.0.0.1:" + server.address().port;
  browser = await chromium.launch({
    executablePath:
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: true,
    args: ["--disable-gpu"],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  if (uiRoot)
    await page.exposeFunction("__acceptanceCall", async (method, input) => {
      const r = await fetch(origin + "/rpc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method, input }),
      });
      return r.json();
    });
  if (uiRoot)
    await page.addInitScript(() => {
      const blocked = async () => ({
        ok: false,
        error: { message: "无头验收不执行原生操作" },
      });
      window.rainfall = {
        call: (method, input = {}) => window.__acceptanceCall(method, input),
        tmeAiSubmission: blocked,
        pickImport: blocked,
        exportFile: blocked,
        setMode: blocked,
      };
    });
  page.setDefaultTimeout(5000);
  await page.route("**/*", (r) =>
    r.request().url().startsWith(origin) ? r.continue() : r.abort(),
  );
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin);
  if (uiRoot) {
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "发布中心", exact: true })
      .click()
      .catch(async (e) => {
        fs.writeFileSync(
          path.join(dir, "full-renderer-diagnostic.json"),
          JSON.stringify(
            { errors, body: await page.locator("body").innerText() },
            null,
            2,
          ),
        );
        throw e;
      });
    assert.equal(
      await page.getByLabel("客户端版本", { exact: true }).innerText(),
      "v" + appVersion,
    );
    await page.evaluate(() => {
      const note = document.createElement("div");
      note.textContent = "无头验收 · 只读资料 / 内存接口 · 未运行原生客户端";
      note.style.cssText =
        "position:fixed;right:20px;top:3px;font-size:11px;z-index:9999;color:#d3b7ef";
      document.body.appendChild(note);
    });
  }
  await page.getByRole("button", { name: "发布", exact: true }).click();
  const region = page.getByRole("region", { name: "本次发布材料" });
  await region.waitFor();
  const m = returned.requests[0].materialSnapshot;
  const pcm = lib.inspectPcmWav(s.locate(m.audio.assetId).file);
  assert.ok(Math.abs(pcm.durationSeconds - m.audio.durationSeconds) < 0.001);
  const localPreflight = lib.inspectTmeAiSubmissionWork(s, workId);
  const authorArg = process.argv.indexOf("--expect-author");
  if (authorArg >= 0) {
    const expectedAuthor = process.argv[authorArg + 1];
    assert.equal(m.metadata.lyricist, expectedAuthor);
    assert.equal(m.metadata.composer, expectedAuthor);
    assert.equal(
      await region.getByRole("button", { name: "补署名", exact: true }).count(),
      0,
    );
  }
  assert.equal(m.workId, workId);
  assert.equal(m.audio.assetId, work.assets.audio_A);
  assert.equal(m.cover.assetId, work.assets.cover);
  assert.equal(m.audio.format, "wav");
  assert.equal(m.audio.codec, "pcm_s16le");
  assert.equal(m.ai, "generated");
  assert.equal(m.lyrics.alignmentConfirmed, false);
  assert.ok(!m.lyrics.plainText.includes("[Chorus]"));
  assert.ok(m.lyrics.plainText.includes("示例作品B"));
  assert.ok(m.provenance.statement.includes("33f917a4"));
  assert.match(await region.innerText(), /暂不能提交：QQ音乐上传未接通/);
  await region.getByText("查看已准备材料", { exact: true }).click();
  assert.equal(
    await region.locator("textarea").inputValue(),
    m.lyrics.plainText,
  );
  assert.deepEqual(errors, []);
  if (uiRoot)
    await page.evaluate(() => {
      const action = document.querySelector(".simple-publish-action");
      window.scrollTo(
        0,
        action.getBoundingClientRect().top + window.scrollY - 95,
      );
    });
  await page.screenshot({
    path: path.join(dir, "actual-new-song-materials-headless.png"),
    fullPage: !uiRoot,
  });
  fs.writeFileSync(
    path.join(dir, "actual-new-song-verification.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        workId,
        title: work.title,
        workRevision: work.revision,
        sqliteReadOnly: true,
        productionWrites: 0,
        memoryWrites,
        localPrepareRequests: requests,
        externalPlatformRequests: 0,
        nativeActions: 0,
        packagedRendererRoot: uiRoot,
        appVersion,
        fixtureScope:
          "current work and actual saved metadata; scoped in-memory publishing; no native actions or analytics acceptance",
        submitted: false,
        result: returned,
        pcm,
        localPreflight,
        errors,
        screenshot: "actual-new-song-materials-headless.png",
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      verified: true,
      title: work.title,
      workRevision: work.revision,
      audio: m.audio,
      cover: m.cover,
      metadata: m.metadata,
      lyricsPrepared: true,
      alignmentConfirmed: false,
      localPrepareRequests: requests,
      productionWrites: 0,
      nativeActions: 0,
    }),
  );
} finally {
  await browser?.close();
  if (server) await new Promise((r) => server.close(r));
}
