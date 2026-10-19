const test=require('node:test'),assert=require('node:assert/strict');
test('static UI distinguishes local scheduling, scoped model calls, manual publisher gates and fixture audio',()=>{
 const {renderWorkflow}=require(process.env.RAINFALL_WORKFLOW_UI_BUNDLE);
 const production=renderWorkflow('production'),simulation=renderWorkflow('simulation');
 assert.ok(production.includes("DeepSeek"));assert.ok(production.includes("音乐创作与生成"));assert.ok(production.includes("准备本轮文本任务"));assert.ok(production.includes('每日计划'));assert.ok(production.includes('本地原创模板 · 无模型调用'));assert.ok(production.includes('本地检查 · 未评分'));assert.ok(production.includes('保存停用计划'));assert.ok(production.includes('真实发布接入状态'));assert.ok(production.includes('不会写成客户端执行回执'));assert.ok(production.includes('保存想法'));assert.ok(production.includes('版本与评分'));assert.ok(production.includes('value="09:00"'));assert.ok(production.includes('value="Asia/Shanghai"'));assert.ok(production.includes('UTC+08:00 / 01:00 UTC'));
 assert.ok(simulation.includes('不是 AI 歌曲'));assert.ok(simulation.includes('固定样本与模拟评分'));assert.ok(simulation.includes('候选'));
});
