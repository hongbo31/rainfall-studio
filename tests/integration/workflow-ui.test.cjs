const test = require("node:test"),
  assert = require("node:assert/strict");
test("the scheduler retains local scheduling and manual publication gates", () => {
  const { renderProductionWorkflow } = require(
    process.env.RAINFALL_WORKFLOW_UI_BUNDLE,
  );
  const schedule = renderProductionWorkflow("production");
  assert.ok(schedule.includes("每日计划"));
  assert.ok(schedule.includes("本地原创模板 · 无模型调用"));
  assert.ok(schedule.includes("保存停用计划"));
  assert.ok(schedule.includes("真实发布接入状态"));
  assert.ok(schedule.includes("不会写成客户端执行回执"));
  assert.ok(schedule.includes('value="09:00"'));
  assert.ok(schedule.includes('value="Asia/Shanghai"'));
  assert.ok(schedule.includes("UTC+08:00 / 01:00 UTC"));
  assert.equal(
    renderProductionWorkflow("simulation"),
    "",
    "production-only scheduler stays absent in simulation",
  );
});
test("creation center renders the song editor and artwork, without the old dialogue and task panel", () => {
  const { renderWorkflow } = require(process.env.RAINFALL_WORKFLOW_UI_BUNDLE);
  for (const mode of ["production", "simulation"]) {
    const html = renderWorkflow(mode);
    for (const label of ["创作中心", "AI作词", "歌曲编辑器", "封面图片创作", "音乐生成", "创建任务"]) {
      assert.ok(html.includes(label), label);
    }
    assert.match(html, /<h2>作品<\/h2>/);
    for (const label of ["封面图片创作", "音乐生成"]) {
      const checkbox = html.match(new RegExp(`(<input\\b[^>]*>)${label}</label>`))?.[1] ?? "";
      assert.match(checkbox, / type="checkbox"/, label);
      assert.match(checkbox, / checked=""/, `${label} should be checked by default in ${mode}`);
    }
    assert.doesNotMatch(html, /创作对话与历史任务|历史对话|单次 AI 创作|准备本轮文本任务/);
  }
});
