import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { launchHeadlessChromium } from "../scripts/lib/headless-chromium.mjs";

const { outputFiles } = await build({
  stdin: { resolveDir: path.resolve(import.meta.dirname, ".."),
    contents: "export { FanqieCatalogSession } from './src/main/fanqie/catalog-session';" },
  bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
});
const mod = { exports: {} };
new Function("require", "module", outputFiles[0].text)(createRequire(import.meta.url), mod);
const { FanqieCatalogSession } = mod.exports;
const origin = "https://www.novelfm.com";
const rosterPath = "/creator/music/account/artist";
const listPath = "/api/author/home/get_owned_artist_list/v0/";
const accountId = "123456789";
const accountKey = createHash("sha256").update("fanqie:" + accountId).digest("hex");
const firstId = "9000000000000000002";
const secondId = "9000000000000000003";

async function fixture(t, { account = () => accountId } = {}) {
  const browser = await launchHeadlessChromium(chromium);
  t.after(() => browser.close());
  const context = await browser.newContext({ serviceWorkers: "block" });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rainfall-fanqie-singers-"));
  const searches = [];
  let rosterOpens = 0, accountReads = 0;
  const roster = `<meta charset="utf-8"><input placeholder="请输入艺人名">
    <div class="pagination-container"><button class="arco-pagination-item-next">下一页</button></div>
    <script>
      const input = document.querySelector('input');
      let page = 0;
      function load(index, name = input.value, bind = '1,2,3') {
        return fetch('${listPath}?' + new URLSearchParams({name_like: name, page_no: index, page_size: 1, bind_types: bind}));
      }
      input.oninput = async () => {
        page = 0;
        if (input.value === '过滤') {
          await load(0, '错误的旧查询');
          await load(1);
          await load(0, input.value, '9');
        }
        await load(0);
      };
      document.querySelector('button').onclick = () => load(++page);
    </script>`;
  await context.route("**/*", async route => {
    const { origin: host, pathname, searchParams } = new URL(route.request().url());
    if (host !== origin || route.request().method() !== "GET") return route.abort();
    const html = body => route.fulfill({ contentType: "text/html; charset=utf-8", body });
    if (pathname === "/creator/music/login") return route.fulfill({ status: 302, headers: { location: origin + "/creator/music/home" } });
    if (pathname === "/creator/music/home") return html("fixture");
    if (pathname === "/creator/music/account/profile")
      return html('<div class="profile-desc"><span>UID</span> ' + account(++accountReads) + '</div>');
    if (pathname === rosterPath) {
      rosterOpens++;
      return html(roster);
    }
    if (pathname !== listPath) return route.abort();
    const name = searchParams.get("name_like");
    const page = Number(searchParams.get("page_no"));
    const bind = searchParams.get("bind_types");
    searches.push([name, page, bind]);
    const row = (label, rawId) => `{"name":${JSON.stringify(label)},"author_id":${rawId}}`;
    const rows = name === "二页" ? [row("二页合唱", "12345"), row("二页", firstId)] :
      name === "同名" ? [row("同名", firstId), row("同名", JSON.stringify(secondId))] :
        name === "é" ? [row("e\u0301", firstId), row("é", JSON.stringify(firstId))] :
          name === "断页" ? [row("断页", firstId)] :
            name === "过滤" && page === 0 && bind === "1,2,3" ? [row("过滤", secondId)] :
              name === "过滤" || name === "错误的旧查询" ? [row("过滤", firstId)] : [];
    const total = name === "断页" ? 2 : rows.length;
    return route.fulfill({ contentType: "application/json", body:
      `{"code":0,"data":{"total_count":${total},"artist_list":[${rows[page] ?? ""}]}}` });
  });
  const catalog = new FanqieCatalogSession({ root, available: () => true, generation: () => 1, launch: async () => context });
  await catalog.ui("open");
  const originalPage = context.pages()[0];
  return {
    searches, originalPage, context, rosterOpens: () => rosterOpens,
    resolve: (names, expected = accountKey) => catalog.run((active, guard) =>
      catalog.resolveDirectorySingers(active, guard, expected, names)),
  };
}

test("directory artist lookup reads every page, preserves long IDs and separates each outcome", async t => {
  const x = await fixture(t);
  const before = x.originalPage.url();
  const result = await x.resolve([" 二页 ", "同名", "e\u0301", "é", "不存在", "断页", "过滤"]);
  assert.deepEqual([...result], [
    ["二页", { artistId: firstId }], ["同名", { issue: "FANQIE_ARTIST_NAME_AMBIGUOUS" }],
    ["é", { artistId: firstId }], ["不存在", { issue: "FANQIE_ARTIST_NAME_NOT_FOUND" }],
    ["断页", { issue: "FANQIE_ARTIST_SEARCH_UNVERIFIED" }], ["过滤", { artistId: secondId }],
  ]);
  assert.deepEqual(x.searches.filter(([name]) => name === "é"), [["é", 0, "1,2,3"], ["é", 1, "1,2,3"]]);
  assert.equal(x.rosterOpens(), 1);
  assert.equal(x.originalPage.url(), before);
  assert.deepEqual(x.context.pages(), [x.originalPage]);
});

test("directory artist lookup rejects a different starting account without opening the roster", async t => {
  const x = await fixture(t);
  await assert.rejects(x.resolve(["二页"], "f".repeat(64)), /FANQIE_CATALOG_SCOPE_CHANGED/);
  assert.equal(x.rosterOpens(), 0);
  assert.deepEqual(x.searches, []);
});

test("directory artist lookup discards verified IDs if the account changes before returning", async t => {
  const x = await fixture(t, { account: ordinal => ordinal === 1 ? accountId : "987654321" });
  await assert.rejects(x.resolve(["二页"]), /FANQIE_CATALOG_SCOPE_CHANGED/);
  assert.deepEqual(x.searches, [["二页", 0, "1,2,3"], ["二页", 1, "1,2,3"]]);
  assert.deepEqual(x.context.pages(), [x.originalPage]);
});
