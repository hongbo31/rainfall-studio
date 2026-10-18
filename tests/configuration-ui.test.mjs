import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { build } from "esbuild";
import { createRequire } from "node:module";
test("configuration categories and independent target form expose real defaults without legal consent fields", async () => {
  assert.ok(
    fs.existsSync("src/renderer/pages/ConfigurationCenter.tsx"),
    "configuration center is missing",
  );
  await build({
    entryPoints: ["tests/fixtures/configuration-ui.tsx"],
    outfile: "build/configuration-ui.cjs",
    bundle: true,
    platform: "node",
    format: "cjs",
    packages: "external",
  });
  const { renderConfiguration, renderPlatform } = createRequire(
    import.meta.url,
  )("../build/configuration-ui.cjs");
  const html = renderConfiguration();
  for (const text of [
    "配置中心",
    "发布平台",
    "模型 API",
    "艺人与预算",
    "诊断与历史",
  ])
    assert.ok(html.includes(text), text);
  assert.equal((html.match(/role="tab"/g) || []).length, 9);
  const platform = renderPlatform();
  for (const text of [
    "QQ 音乐配置",
    "默认账号",
    "默认艺人",
    "词作者",
    "曲作者",
    "常用专辑",
    "语言",
    "曲风",
    "AI 标注",
    "翻唱偏好",
    "保存配置",
    "腾讯本地备注",
    "QQ本地备注",
  ])
    assert.ok(platform.includes(text), text);
  for (const text of [
    "云音乐账号",
    "生成平台不应出现",
    "同意协议",
    "自动接受",
    'type="checkbox"',
  ])
    assert.ok(!platform.includes(text), text);
  assert.match(platform, /<option value="" selected="">请选择账号<\/option>/);
  const netease = renderPlatform("netease");
  assert.ok(netease.includes("云音乐账号"));
  assert.ok(!netease.includes("腾讯本地备注"));
  const { configurationCategoryCycle } = createRequire(import.meta.url)(
    "../build/configuration-ui.cjs",
  );
  assert.deepEqual(
    configurationCategoryCycle(),
    { initial: false, opened: true, left: false, returned: false },
    "returning to closed diagnostics must not mount legacy tools",
  );
});
