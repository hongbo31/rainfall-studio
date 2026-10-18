import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
test("cover handoff UI identifies unconfigured image API, real-file receipt and no direct dot invocation", () => {
  const html = require("../build/cover-lyrics-ui.cjs").renderCover();
  for (const text of [
    "图片接口未配置",
    "不会直接调用当前 dot 聊天",
    "等待真实图片",
    "保存封面交接请求（不出图）",
    "下一步：把提示词或请求文件交给支持出图的会话",
    "导入结果清单",
  ])
    assert(html.includes(text), text);
  assert(!html.includes("生成成功"));
  assert(!html.includes("创建封面生成请求"));
});
test("imported cover preview keeps the image free of placeholder artist text and defaults to no-text export", () => {
  const html=require('../build/cover-lyrics-ui.cjs').renderCover(true);
  assert(!html.includes('我的艺人'));
  assert(html.includes('派生版本 · 原件保留'));
  assert(html.includes('<option value="true" selected="">无字母版</option>'));
});
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
