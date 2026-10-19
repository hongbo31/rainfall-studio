import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { renderAccountBinding } = require(
  process.env.RAINFALL_ACCOUNT_BINDING_UI_BUNDLE,
);
test("TME binding starts with explicit existing-session connection and a separate mapping confirmation", () => {
  const html = renderAccountBinding();
  assert.match(html, /已有官方会话/);
  assert.match(html, /aria-label="官方浏览器端口"/);
  assert.match(html, /连接已有会话/);
  assert.match(html, /读取账号身份/);
  assert.match(html, /不创建新登录/);
  assert.doesNotMatch(html, /缺少可验证的远端艺人 ID/);
  assert.doesNotMatch(html, /确认此账号与艺人映射/);
  assert.match(html, /先连接已有官方会话/);
});
test("unsupported platforms cannot show a TME connection as their own verified identity", () => {
  const html = renderAccountBinding("netease");
  assert.doesNotMatch(html, /aria-label="官方浏览器端口"/);
  assert.doesNotMatch(html, /连接已有会话/);
  assert.match(html, /身份适配器待接入/);
});
