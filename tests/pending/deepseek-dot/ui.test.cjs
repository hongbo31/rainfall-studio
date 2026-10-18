const test = require('node:test'), assert = require('node:assert/strict');
// Break: default UI points at another provider or promises automatic model scores/paid generation.
test('server rendering exposes DeepSeek default and distinct pending inbox/model states without effects',()=>{
 const { renderInboxSettings }=require(process.env.RAINFALL_INBOX_UI_BUNDLE);
 const html=renderInboxSettings();
 assert.match(html,/<option value="deepseek" selected=""/);
 for(const label of ['Codex CLI / SDK','Claude Code / SDK','自动收件箱','待模型评分','下次正常启动','本地通道']) assert.ok(html.includes(label),label);
 assert(!html.includes('已打通'));
});
