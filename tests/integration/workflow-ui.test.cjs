const test=require('node:test'),assert=require('node:assert/strict');
test('static UI identifies fixture audio, production blocks, version controls and disabled null schedule',()=>{
 const {renderWorkflow}=require(process.env.RAINFALL_WORKFLOW_UI_BUNDLE);
 const production=renderWorkflow('production'),simulation=renderWorkflow('simulation');
 assert.ok(production.includes("DeepSeek"));assert.ok(production.includes("真实生成与模型评分仍未启用"));assert.ok(production.includes('保存请求并检查配置'));assert.ok(production.includes('版本与评分'));assert.ok(production.includes('默认禁用'));assert.ok(production.includes('自动执行')||production.includes('不启用日程'));assert.ok(!production.includes('value="09:00"'));
 assert.ok(simulation.includes('不是 AI 歌曲'));assert.ok(simulation.includes('固定样本与模拟评分'));assert.ok(simulation.includes('候选'));
});
