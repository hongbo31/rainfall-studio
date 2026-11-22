import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { compileFunction } from "node:vm";
import { build } from "esbuild";

const bundle = await build({
  entryPoints: ["tests/fixtures/configuration-ui.tsx"],
  write: false,
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
});
const fixture = { exports: {} };
compileFunction(bundle.outputFiles[0].text, ["module", "exports", "require"])(
  fixture, fixture.exports, createRequire(import.meta.url),
);
const { renderConfiguration, renderAccountManagement, configurationCategoryCycle } = fixture.exports;

test("configuration center only exposes the five remaining categories", () => {
  const html = renderConfiguration();
  assert.match(html, /配置中心/);
  assert.deepEqual([...html.matchAll(/role="tab"[^>]*id="category-[^"]+"[^>]*>([^<]+)<\/button>/g)].map(match => match[1]),
    ["模型 API", "提示词管理", "下载目录", "诊断与历史", "外观"]);
  assert.match(html, /id="category-models"[^>]*aria-selected="true"/);
  assert.match(renderConfiguration("inbox"), /id="category-inbox"[^>]*aria-selected="true"/);
  assert.doesNotMatch(html, /发布平台配置|番茄发布规则|艺人资料与创作默认值|category-(?:artists|platforms)/);
  assert.deepEqual(configurationCategoryCycle(), { initial: false, opened: true, left: false, returned: false });
});

test("account management retains artist editing, default accounts and scoped Fanqie upload authorization", () => {
  const accounts = renderAccountManagement();
  assert.match(accounts, /<select[^>]*aria-label="账号平台"/);
  for (const text of ["新增艺人", "默认发布账号", 'aria-label="QQ 音乐默认账号"', 'aria-label="酷狗音乐默认账号"', "打开专属登录窗口"])
    assert.ok(accounts.includes(text), text);
  assert.doesNotMatch(accounts, /账号资料|发布艺人绑定|>平台配置<|番茄上传授权/);
  const fanqie = renderAccountManagement("fanqie");
  assert.match(fanqie, /<summary>番茄上传授权<\/summary>/);
  assert.doesNotMatch(fanqie, /规则适用账号|>平台配置</);
});
