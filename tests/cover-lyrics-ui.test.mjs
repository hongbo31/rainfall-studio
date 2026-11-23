import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
test("lyric publication UI keeps explicit audio match unchecked and exposes plain text with original source", () => {
  const html = require("../build/cover-lyrics-ui.cjs").renderLyrics();
  for (const text of [
    "歌词发布预览",
    "导入歌词 TXT",
    "没有同步时间戳",
    "已试听选定音频",
  ])
    assert(html.includes(text), text);
  assert(!html.includes('checked=""'));
});
