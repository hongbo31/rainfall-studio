const test = require("node:test"),
  assert = require("node:assert/strict");
test("static UI distinguishes local scheduling, scoped model calls, manual publisher gates and fixture audio", () => {
  const { renderWorkflow, renderProductionWorkflow } = require(
    process.env.RAINFALL_WORKFLOW_UI_BUNDLE,
  );
  const production = renderWorkflow("production"),
    simulation = renderWorkflow("simulation"),
    schedule = renderProductionWorkflow("production");
  assert.ok(production.includes("DeepSeek"));
  assert.ok(production.includes("音乐创作与生成"));
  assert.ok(production.includes("准备本轮文本任务"));
  assert.ok(production.includes("本地检查 · 未评分"));
  assert.ok(production.includes("保存想法"));
  assert.ok(production.includes("版本与评分"));
  // These original assertions belong to the retained scheduler, now a separate surface.
  assert.ok(schedule.includes("每日计划"));
  assert.ok(schedule.includes("本地原创模板 · 无模型调用"));
  assert.ok(schedule.includes("保存停用计划"));
  assert.ok(schedule.includes("真实发布接入状态"));
  assert.ok(schedule.includes("不会写成客户端执行回执"));
  assert.ok(schedule.includes('value="09:00"'));
  assert.ok(schedule.includes('value="Asia/Shanghai"'));
  assert.ok(schedule.includes("UTC+08:00 / 01:00 UTC"));
  assert.ok(simulation.includes("不是 AI 歌曲"));
  assert.ok(simulation.includes("固定样本与模拟评分"));
  assert.ok(simulation.includes("候选"));
  assert.equal(
    renderProductionWorkflow("simulation"),
    "",
    "production-only scheduler stays absent in simulation",
  );
});
test("current single creation renders artist revision, separate story and three unconfigured routes without executing core", () => {
  const { renderWorkflow } = require(process.env.RAINFALL_WORKFLOW_UI_BUNDLE);
  for (const mode of ["production", "simulation"]) {
    const html = renderWorkflow(mode);
    assert.ok(html.includes("单次 AI 创作"));
    assert.ok(html.includes("已带入艺人风格 · v7"));
    assert.ok(html.includes("钢琴、木吉他"));
    assert.ok(html.includes("从相识到熟悉，最后告白"));
    assert.ok(!html.includes('aria-label="本次故事阶段"'));
    assert.ok(html.includes('aria-label="歌曲类型"'));
    assert.ok(html.includes('aria-label="本次故事"'));
    assert.ok(html.includes('maxLength="10000"'));
    for (const role of ["歌词与提示词", "封面图片", "音乐生成"]) {
      assert.match(
        html,
        new RegExp('<select[^>]*aria-label="' + role + '路由"[^>]*disabled=""'),
      );
    }
    assert.equal((html.match(/尚未配置；需要该能力时会阻塞/g) || []).length, 3);
    assert.match(
      html,
      /<input[^>]*aria-label="授权单次文本额度"[^>]*disabled=""/,
    );
    assert.ok(html.includes("需配置价格和 Key"));
  }
});
