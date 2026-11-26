import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { compileFunction } from "node:vm";
import test from "node:test";
import { buildSync } from "esbuild";

const code = buildSync({ stdin: { contents: `
  export { Repository } from './src/core/database';
  export { PublicationTaskService, latestPublicationOccurrence } from './src/core/publication-tasks';
  export { callPublicationTasks, tickPublicationTasks } from './src/core/publication-task-integration';
  export { executePlanCenter } from './src/core/plan-center-integration';
  export { PlanCenterService } from './src/core/plan-center';
  export { CenterStore } from './src/core/plan-center/storage';
  export { planFanqieAction } from './src/core/plan-fanqie';
  export { queuePublications } from './src/core/publication-queue';
  export { UnifiedPublicationService } from './src/core/unified-publication';
  export { startPublishWorkbench } from './src/main/publish-workbench';
`, resolveDir: process.cwd() }, bundle: true, write: false, platform: "node", packages: "external", format: "cjs" });
const mod = { exports: {} };
compileFunction(code.outputFiles[0].text, ["module", "exports", "require", "__dirname"])(
  mod, mod.exports, createRequire(import.meta.url), process.cwd(),
);
const { Repository, PublicationTaskService, latestPublicationOccurrence } = mod.exports;

function fixture(t, planCount = 2) {
  const repo = new Repository(":memory:");
  t.after(() => repo.close());
  const plans = Array.from({ length: planCount }, (_, index) => ({ id: randomUUID(), revision: 1, title: "计划 " + (index + 1) }));
  const runs = [], stopped = [], uploads = [];
  let time = new Date("2026-11-19T03:00:00Z");
  const ports = {
    now: () => time, plans: () => plans, scheduledPlanConflicts: () => [],
    startPlan(plan, requestId, includePlanPublication) {
      const run = { id: randomUUID(), planId: plan.id, requestId, includePlanPublication, state: "running" };
      runs.push(run);
      return run.id;
    },
    observePlan: id => runs.find(r => r.id === id),
    stopPlan: id => stopped.push(id),
    enqueue(step, workIds, ownerId) {
      uploads.push({ step, workIds, ownerId });
      return { tmeIds: [randomUUID()], fanqieIds: [] };
    },
    observePublication: () => assert.fail("new tasks do not have a separate upload dispatch"),
  };
  const service = new PublicationTaskService(repo, ports);
  const task = { id: randomUUID(), title: "每天发布", execution: { kind: "manual" }, consent: true,
    steps: [{ kind: "plans", planIds: plans.map(p => p.id) }],
  };
  return { repo, service, plans, runs, stopped, uploads, task, ports, restart: () => new PublicationTaskService(repo, ports),
    clock: next => { time = new Date(next); } };
}

test("publication tasks finish linked plans in order without a separate upload", t => {
  const f = fixture(t);
  const order = f.task.steps[0].planIds.reverse();
  const task = f.service.save({ task: f.task, expectedRevision: null });
  const request = { id: task.id, requestId: randomUUID(), expectedRevision: task.revision };
  const run = f.service.start(request);
  assert.equal(f.service.start(request).id, run.id);
  assert.equal(f.runs.length, 0);
  f.service.tick();
  assert.deepEqual(f.runs.map(row => row.planId), order.slice(0, 1));
  assert.equal(f.runs[0].includePlanPublication, true);
  const resumed = f.restart();
  resumed.tick();
  assert.equal(f.runs.length, 1);
  f.runs[0].state = "blocked";
  resumed.tick();
  assert.equal(resumed.history(task.id)[0].state, "action_required");
  assert.equal(f.runs.length, 1);
  f.runs[0].state = "completed";
  resumed.tick();
  assert.deepEqual(f.runs.map(row => row.planId), order);
  assert.deepEqual(f.uploads, []);
  f.runs[1].state = "completed";
  f.service.tick();
  f.service.tick();
  assert.deepEqual(f.uploads, []);
  assert.equal(f.service.list()[0].run.dispatch, undefined);
  assert.equal(f.service.list()[0].run.state, "completed");
});

test("a failed or individually stopped plan leaves the later plans running in order", async t => {
  for (const state of ["failed", "stopped"]) {
    await t.test(state, t => {
      const f = fixture(t, 4);
      const task = f.service.save({ task: f.task, expectedRevision: null });
      f.service.start({ id: task.id, requestId: randomUUID(), expectedRevision: task.revision });
      f.service.tick();
      f.runs[0].state = "completed";
      f.service.tick();
      assert.deepEqual(f.runs.map(run => run.planId), task.steps[0].planIds.slice(0, 2));
      f.runs[1].state = state;
      f.runs[1].detail = "FIXTURE_PLAN_ERROR";
      f.service.tick();
      const afterError = f.service.history(task.id)[0];
      assert.notEqual(afterError.state, "failed");
      assert.deepEqual(afterError.planFailures, [{ planId: f.plans[1].id, reason: "FIXTURE_PLAN_ERROR" }]);

      const resumed = f.restart();
      resumed.tick();
      resumed.tick();
      assert.deepEqual(f.runs.map(run => run.planId), task.steps[0].planIds.slice(0, 3));
      f.runs[2].state = "completed";
      resumed.tick();
      assert.deepEqual(f.runs.map(run => run.planId), task.steps[0].planIds);
      f.runs[3].state = "completed";
      resumed.tick();
      const finished = resumed.history(task.id)[0];
      assert.equal(finished.state, "partial");
      assert.match(finished.detail, /成功 3 个.*失败 1 个/);
      assert.equal(finished.logs.filter(log => log.detail.includes("FIXTURE_PLAN_ERROR")).length, 1);
      assert.ok(finished.logs.some(log => log.detail.includes("计划 2") && log.detail.includes("FIXTURE_PLAN_ERROR")));
      resumed.tick();
      assert.equal(f.runs.length, 4);
      assert.deepEqual(f.stopped, []);
      assert.deepEqual(f.uploads, []);
    });
  }
});

test("a scheduled task skips a plan it cannot start and commits each later run once", t => {
  const f = fixture(t, 3);
  const attempts = [];
  const originalStartPlan = f.ports.startPlan;
  f.ports.startPlan = (plan, requestId, includesPublication) => {
    attempts.push(plan.id);
    if (plan.id === f.plans[1].id) {
      f.repo.save("settings", { id: "fixture-partial-start", value: plan.id });
      throw Error("DOWNLOAD_ROOT_REQUIRED");
    }
    return originalStartPlan(plan, requestId, includesPublication);
  };
  const task = f.service.save({ task: { ...f.task, execution: { kind: "scheduled", unit: "hour", minute: 15 } },
    expectedRevision: null });
  f.clock("2026-11-19T03:15:01Z");
  f.service.tick();
  assert.equal(f.runs[0].planId, f.plans[0].id);
  f.runs[0].state = "completed";
  f.service.tick();
  assert.equal(f.repo.maybe("settings", "fixture-partial-start"), undefined);

  const resumed = f.restart();
  resumed.tick();
  resumed.tick();
  assert.deepEqual(attempts, task.steps[0].planIds);
  assert.deepEqual(f.runs.map(run => run.planId), [f.plans[0].id, f.plans[2].id]);
  f.runs[1].state = "completed";
  resumed.tick();
  const [finished, ...otherRuns] = resumed.history(task.id);
  assert.deepEqual(otherRuns, []);
  assert.equal(finished.source, "scheduled");
  assert.equal(finished.state, "partial");
  assert.deepEqual(finished.planFailures, [{ planId: f.plans[1].id, reason: "DOWNLOAD_ROOT_REQUIRED" }]);
});

test("all linked plans can fail with the same name and error without being retried or counted as completed", t => {
  const f = fixture(t);
  f.plans.forEach(plan => { plan.title = "同名计划"; });
  const attempts = [];
  f.ports.startPlan = plan => { attempts.push(plan.id); throw Error("ROUTE_PROFILE_CHANGED"); };
  const task = f.service.save({ task: f.task, expectedRevision: null });
  f.service.start({ id: task.id, requestId: randomUUID(), expectedRevision: task.revision });
  for (let index = 0; index < 4; index++) f.service.tick();
  assert.deepEqual(attempts, task.steps[0].planIds);
  const [finished] = f.service.history(task.id);
  assert.equal(finished.state, "failed");
  assert.match(finished.detail, /成功 0 个.*失败 2 个/);
  assert.equal(finished.logs.filter(log => log.detail.includes("ROUTE_PROFILE_CHANGED")).length, 2);
});

test("stored legacy tasks retain history and require renewed consent for plan publishers", t => {
  const f = fixture(t);
  const legacy = { ...f.task, revision: 1, enabled: true, cursor: "2026-11-19T03:00:00.000Z",
    steps: [...f.task.steps, { kind: "publish", targets: [{ platform: "qqmusic", accountId: randomUUID() }] }] };
  assert.throws(() => f.service.save({ task: { ...f.task, steps: legacy.steps }, expectedRevision: null }));
  f.repo.save("settings", { id: "publication-task:definition:" + legacy.id, value: legacy });
  const start = revision => f.service.start({ id: legacy.id, expectedRevision: revision, requestId: randomUUID() });
  const oldRun = start(1);
  for (let index = 0; index < f.plans.length; index++) {
    f.service.tick();
    assert.equal(f.runs[index].includePlanPublication, false);
    f.runs[index].state = "completed";
  }
  f.service.tick();
  assert.deepEqual(f.uploads, []);
  assert.equal(f.service.history(legacy.id).find(row => row.id === oldRun.id).state, "completed");
  f.plans[0].publishes = true;
  assert.equal(start(1).detail, "PUBLICATION_PLAN_CONFIRMATION_REQUIRED");
  f.service.tick();
  assert.equal(f.runs.length, 2);
  const updated = f.service.save({ task: f.task, expectedRevision: 1 });
  start(updated.revision);
  f.service.tick();
  assert.equal(f.runs[2].includePlanPublication, true);
  assert.equal(f.service.history(legacy.id).find(row => row.id === oldRun.id).snapshot.steps.length, 2);
});

test("stop halts only owned plans and disable and deletion retain execution records", t => {
  const f = fixture(t);
  const task = f.service.save({ task: f.task, expectedRevision: null });
  const run = f.service.start({ id: task.id, requestId: randomUUID(), expectedRevision: task.revision });
  f.service.tick();
  assert.throws(() => f.service.delete({ id: task.id, expectedRevision: task.revision }), /PUBLICATION_TASK_ACTIVE/);
  f.service.stop(run.id);
  assert.deepEqual(f.stopped, [f.runs[0].id]);
  f.service.tick();
  assert.deepEqual(f.uploads, []);
  const disabled = f.service.toggle({ id: task.id, expectedRevision: task.revision, enabled: false });
  assert.throws(() => f.service.start({ id: task.id, requestId: randomUUID(), expectedRevision: disabled.revision }), /PUBLICATION_TASK_DISABLED/);
  f.service.delete({ id: task.id, expectedRevision: disabled.revision });
  assert.deepEqual(f.service.list(), []);
  assert.equal(f.service.history(task.id)[0].state, "stopped");
});

test("hourly, daily, weekly, and month-end schedules calculate one latest Beijing occurrence", t => {
  const before = "2026-02-01T00:00:00Z", now = "2026-02-28T06:00:00Z";
  const scheduled = options => ({ kind: "scheduled", ...options });
  assert.equal(latestPublicationOccurrence(scheduled({ unit: "hour", minute: 30 }), before, now), "2026-02-28T05:30:00.000Z");
  assert.equal(latestPublicationOccurrence(scheduled({ unit: "day", localTime: "09:00" }), before, now), "2026-02-28T01:00:00.000Z");
  assert.equal(latestPublicationOccurrence(scheduled({ unit: "week", localTime: "09:00", weekday: 1 }), before, now), "2026-02-23T01:00:00.000Z");
  assert.equal(latestPublicationOccurrence(scheduled({ unit: "month", localTime: "09:00", day: 31 }), before, now), "2026-02-28T01:00:00.000Z");
  const f = fixture(t);
  const task = f.service.save({ task: { ...f.task, execution: scheduled({ unit: "hour", minute: 15 }) }, expectedRevision: null });
  f.clock("2026-11-19T03:15:01Z");
  f.service.tick();
  f.service.tick();
  assert.equal(f.service.history(task.id).length, 1);
  assert.equal(f.service.history(task.id)[0].source, "scheduled");
});

test("a manual task consumes the overlapping scheduled occurrence without a catch-up run", async t => {
  for (const tickOnTime of [true, false]) await t.test(tickOnTime ? "scheduler ticks on time" : "scheduler wakes after stop", t => {
    const f = fixture(t, 1);
    const task = f.service.save({ task: { ...f.task, execution: { kind: "scheduled", unit: "hour", minute: 15 } },
      expectedRevision: null });
    f.clock("2026-11-19T03:12:00Z");
    const manual = f.service.start({ id: task.id, expectedRevision: task.revision, requestId: randomUUID() });
    f.service.tick();
    f.clock("2026-11-19T03:15:01Z");
    if (tickOnTime) f.service.tick();

    f.clock("2026-11-19T03:16:00Z");
    if (tickOnTime) {
      f.runs[0].state = "completed";
      f.service.tick();
    } else {
      f.service.stop(manual.id);
    }
    const resumed = f.restart();
    resumed.tick();
    resumed.tick();
    assert.deepEqual(resumed.history(task.id).map(run => run.id), [manual.id]);
    assert.equal(resumed.list()[0].task.cursor, "2026-11-19T03:15:00.000Z");
    assert.equal(f.runs.length, 1);

    f.clock("2026-11-19T04:15:01Z");
    resumed.tick();
    assert.equal(resumed.history(task.id)[0].requestId, "2026-11-19T04:15:00.000Z");
    assert.equal(resumed.history(task.id)[0].source, "scheduled");
    assert.equal(f.runs.length, 2);
  });
});

function planLinkFixture(t) {
  const { callPublicationTasks, tickPublicationTasks, PlanCenterService, CenterStore } = mod.exports;
  const repo = new Repository(":memory:");
  t.after(() => repo.close());
  let time = new Date("2026-11-20T04:30:00Z");
  const now = () => time, center = new PlanCenterService(repo, { now });
  const store = new CenterStore(repo);
  const artistId = randomUUID(), accountId = randomUUID();
  repo.save("artists", { id: artistId, name: "Plan artist", defaults: {}, revision: 1 });
  repo.save("accounts", { id: accountId, provider: "tme", name: "Offline account" });
  const studio = { mode: "production", repo, now, planCenterService: () => center };
  const send = (method, input = {}) => callPublicationTasks(studio, "publicationTasks." + method, input);
  const plan = (title, patch = {}) => center.save({ expectedRevision: null, plan: {
    id: randomUUID(), title, artistId, schedule: { kind: "once", date: "2026-11-21", localTime: "09:00" },
    material: { source: "manual" }, outputs: { lyrics: true, music: true, cover: false },
    music: { route: "manual" }, text: {}, ...patch,
  } });
  const task = planIds => ({ id: randomUUID(), title: "Offline publication", consent: true, execution: { kind: "manual" },
    steps: [{ kind: "plans", planIds }] });
  return { repo, center, store, send, plan, task, studio, tick: () => tickPublicationTasks(studio), clock: next => { time = new Date(next); } };
}

function fixturePlanStage(f, run, itemId, stage, state, reason) {
  const id = randomUUID();
  f.store.put("stage", { id, runId: run.id, itemId, stage, ordinal: 1, idempotencyKey: id, requestHash: id, state,
    reason, createdAt: run.createdAt, updatedAt: run.updatedAt });
  f.center.refreshPublication(run.id);
  return id;
}

test("publication may link Plan Center definitions but rejects current and legacy song creation records", t => {
  const f = planLinkFixture(t);
  const proper = f.plan("Scheduled material plan", {origin: "plan"});
  const existing = f.plan("Existing plan with no origin field");
  const legacy = f.plan("Single song from the former template", {origin: "manual"});
  const song = f.plan("Song title from Creation Center", {
    material: {source: "creation"}, songType: "vocal",
    creationDraft: {title: "Song title from Creation Center", lyrics: "fixture lyrics", style: "folk"},
  });
  assert.deepEqual(f.send("list").plans.map(plan => plan.id).sort(), [proper.id, existing.id].sort());
  assert.ok(f.center.listCreationTasks().some(task => task.planId === song.id));
  for (const plan of [legacy, song]) {
    const {summaryHash} = f.center.preview({id: plan.id});
    assert.throws(() => f.center.runForPublication({id: plan.id, expectedRevision: plan.revision, summaryHash,
      requestId: randomUUID()}, true), /PUBLICATION_PLAN_UNAVAILABLE/);
    const task = f.task([plan.id]);
    assert.throws(() => f.send("save", {task, expectedRevision: null}), /PUBLICATION_PLAN_UNAVAILABLE/);
    f.repo.save("settings", {id: "publication-task:definition:" + task.id, value: {
      ...task, enabled: true, revision: 1, cursor: "2026-11-20T04:30:00.000Z",
    }});
    f.send("start", {id: task.id, expectedRevision: 1, requestId: randomUUID()});
    f.tick();
    f.tick();
    const [stale] = f.send("history", { id: task.id });
    assert.equal(stale.state, "failed");
    assert.deepEqual(stale.planFailures, [{ planId: plan.id, reason: "PUBLICATION_PLAN_UNAVAILABLE" }]);
  }
  f.tick();
  assert.equal(f.center.list().runs.length, 0);
});

test("two tasks sharing a plan have distinct executions and stop their own run", t => {
  const f = planLinkFixture(t), plan = f.plan("共用计划");
  const tasks = ["任务甲", "任务乙"].map(title => f.send("save", {
    task: { ...f.task([plan.id]), title }, expectedRevision: null,
  }));
  const start = task => f.send("start", { id: task.id, expectedRevision: task.revision, requestId: randomUUID() });
  const first = start(tasks[0]);
  f.tick();
  const firstChild = f.send("history", { id: tasks[0].id })[0].linked[0].id;
  const second = start(tasks[1]);
  f.tick();
  assert.deepEqual(f.send("history", { id: tasks[1].id })[0].linked, []);
  assert.throws(() => mod.exports.executePlanCenter(f.studio, "planCenter.stop", { runId: firstChild }), /PLAN_TASK_OWNED_RUN/);

  f.send("stop", { id: first.id });
  f.tick();
  const secondRun = f.send("history", { id: tasks[1].id })[0];
  assert.equal(secondRun.id, second.id);
  assert.equal(secondRun.linked.length, 1);
  assert.notEqual(secondRun.linked[0].id, firstChild);
  assert.equal(f.store.get("run", firstChild).state, "stopped");
  assert.equal(f.store.get("run", secondRun.linked[0].id).stopRequested, false);
});

for (const first of ["task", "plan"]) test(`cross-center start reuses or rejects the active plan run when the ${first} starts first`, t => {
  const f = planLinkFixture(t), plan = f.plan("两个中心共用的计划");
  const task = f.send("save", { task: f.task([plan.id]), expectedRevision: null });
  const planCommand = (method, input) => mod.exports.executePlanCenter(f.studio, "planCenter." + method, input);
  const request = { id: plan.id, expectedRevision: plan.revision, source: "manual", requestId: randomUUID(),
    summaryHash: f.center.preview({ id: plan.id }).summaryHash };
  const startTask = () => {
    const parent = f.send("start", { id: task.id, expectedRevision: task.revision, requestId: randomUUID() });
    f.tick();
    const child = f.send("history", { id: task.id })[0].linked[0];
    assert.ok(child);
    return { parent, child: f.store.get("run", child.id) };
  };
  const earlierTask = first === "task" ? startTask() : undefined;
  const earlierPlan = first === "plan" ? planCommand("run", request) : undefined;
  const { parent, child } = earlierTask ?? startTask();
  const activeRun = earlierTask ? child : earlierPlan;
  assert.equal(child.id, activeRun.id);
  assert.equal(child.planId, plan.id);
  assert.equal(f.center.list().runs.filter(run => run.planId === plan.id && ["running", "waiting", "blocked", "stopping"].includes(run.state)).length, 1);
  assert.deepEqual(planCommand("history", { id: plan.id }).runs.map(run => run.id), [activeRun.id]);
  assert.equal(planCommand("dashboard", {})[0].active.id, activeRun.id);
  assert.equal(f.send("list", { expandedTaskId: task.id }).tasks[0].planProgress[0].runId, activeRun.id);
  if (first === "task") {
    let conflict;
    try { planCommand("run", { ...request, requestId: randomUUID() }); } catch (error) { conflict = error; }
    assert.equal(conflict?.message, "ACTIVE_RUN");
    assert.equal(conflict?.activeRunId, activeRun.id);
    assert.ok(f.send("history", { id: task.id })[0].linked[0].owned);
    assert.throws(() => planCommand("stop", { runId: activeRun.id }), /PLAN_TASK_OWNED_RUN/);
    f.send("stop", { id: parent.id });
    assert.equal(f.store.get("run", activeRun.id).state, "stopped");
  } else {
    assert.equal(f.send("history", { id: task.id })[0].linked[0].owned, false);
    f.send("stop", { id: parent.id });
    assert.deepEqual(f.store.get("run", activeRun.id), activeRun);
  }
});

test("starting a task leaves a blocked standalone plan run available for its own retry", t => {
  const f = planLinkFixture(t), plan = f.plan("单独执行的共用计划");
  const { summaryHash } = f.center.preview({ id: plan.id });
  const direct = f.center.run({ id: plan.id, expectedRevision: plan.revision, summaryHash, source: "manual", requestId: randomUUID() });
  const { itemId, stage } = f.center.next({ runId: direct.id });
  fixturePlanStage(f, direct, itemId, stage, "failed", "LYRIC_REVIEW_INVALID");
  const snapshot = f.store.get("run", direct.id);
  const task = f.send("save", { task: f.task([plan.id]), expectedRevision: null });
  f.send("start", { id: task.id, expectedRevision: task.revision, requestId: randomUUID() });
  f.tick();
  assert.deepEqual(f.store.get("run", direct.id), snapshot);
  assert.equal(f.send("history", { id: task.id })[0].linked.length, 1);
});

test("a scheduled task skips a plan already running independently in Plan Center", t => {
  const f = planLinkFixture(t), plan = f.plan("独立执行与定时执行共用的计划");
  const { summaryHash } = f.center.preview({ id: plan.id });
  const direct = f.center.run({ id: plan.id, expectedRevision: plan.revision, summaryHash, source: "manual", requestId: randomUUID() });
  const task = f.send("save", { task: { ...f.task([plan.id]),
    execution: { kind: "scheduled", unit: "hour", minute: 31 } }, expectedRevision: null });
  f.clock("2026-11-20T04:31:01Z");
  f.tick();
  f.tick();
  const [run] = f.send("history", { id: task.id });
  assert.equal(run.source, "scheduled");
  assert.deepEqual(run.linked, []);
  assert.deepEqual(run.skippedPlanIds, [plan.id]);
  assert.deepEqual(f.store.get("run", direct.id), direct);
});

test("a scheduled task skips a plan when the atomic start detects a late active-run conflict", t => {
  const f = planLinkFixture(t), plan = f.plan("事务竞争中的计划");
  const activeRunId = randomUUID();
  f.center.runForPublication = () => {
    const error = new Error("ACTIVE_RUN");
    error.activeRunId = activeRunId;
    throw error;
  };
  const task = f.send("save", { task: { ...f.task([plan.id]),
    execution: { kind: "scheduled", unit: "hour", minute: 31 } }, expectedRevision: null });
  f.clock("2026-11-20T04:31:01Z");
  f.tick();
  const [run] = f.send("history", { id: task.id });
  assert.deepEqual(run.linked, []);
  assert.deepEqual(run.skippedPlanIds, [plan.id]);
  assert.match(run.detail, /定时已跳过计划/);
});

test("a scheduled task skips a plan occupied by another task and runs its other plans in order", t => {
  const f = planLinkFixture(t);
  const first = f.plan("独立计划一"), shared = f.plan("任务中心正在执行的计划"), last = f.plan("独立计划三");
  const { summaryHash } = f.center.preview({ id: shared.id });
  const occupied = f.center.runForPublication({ id: shared.id, expectedRevision: shared.revision, summaryHash, requestId: randomUUID() }, true);
  const task = f.send("save", { task: { ...f.task([first.id, shared.id, last.id]),
    execution: { kind: "scheduled", unit: "hour", minute: 31 } }, expectedRevision: null });
  const history = () => f.send("history", { id: task.id });

  f.clock("2026-11-20T04:31:01Z");
  f.tick();
  assert.deepEqual(history()[0].linked.map(link => link.planId), [first.id]);
  const [{ planProgress }] = f.send("list", { expandedTaskId: task.id }).tasks;
  assert.deepEqual(planProgress.find(row => row.planId === shared.id), {
    planId: shared.id, title: shared.title, state: "skipped", reason: "PUBLICATION_PLAN_SCHEDULE_SKIPPED", items: [],
  });
  assert.deepEqual(f.store.get("run", occupied.id), occupied);

  f.clock("2026-11-20T04:33:00Z");
  f.center.stop({ runId: occupied.id });
  const firstRunId = history()[0].linked[0].id;
  f.store.put("run", { ...f.store.get("run", firstRunId), updatedAt: f.studio.now().toISOString(), state: "completed" });
  f.tick();
  f.tick();
  assert.deepEqual(history()[0].linked.map(link => link.planId), [first.id, last.id]);
  assert.deepEqual(f.store.all("run").filter(run => run.planId === shared.id).map(run => run.id), [occupied.id]);
  const lastRunId = history()[0].linked.at(-1).id;
  f.store.put("run", { ...f.store.get("run", lastRunId), updatedAt: f.studio.now().toISOString(), state: "completed" });
  f.tick();
  assert.equal(history()[0].state, "completed");
  assert.equal(history()[0].planFailures, undefined);
});

test("a timed occurrence with only busy plans stays out of the queue and an existing queued occurrence settles", t => {
  const f = planLinkFixture(t), plan = f.plan("已被任务中心占用的计划");
  const { summaryHash } = f.center.preview({ id: plan.id });
  const occupied = f.center.runForPublication({ id: plan.id, expectedRevision: plan.revision, summaryHash, requestId: randomUUID() }, true);
  const task = f.send("save", { task: { ...f.task([plan.id]),
    execution: { kind: "scheduled", unit: "hour", minute: 31 } }, expectedRevision: null });
  const due = "2026-11-20T04:31:00.000Z";
  f.clock("2026-11-20T04:31:01Z");
  f.tick();
  assert.deepEqual(f.send("history", { id: task.id }), []);
  assert.equal(f.send("list").tasks[0].task.cursor, due);

  const queued = { id: randomUUID(), taskId: task.id, requestId: due, source: "scheduled", snapshot: task,
    state: "waiting", plans: f.send("list").plans, linked: [], detail: "等待上一轮结束",
    startedAt: due, updatedAt: due, logs: [] };
  f.repo.save("settings", { id: "publication-task:run:" + queued.id, value: queued });
  f.tick();
  f.tick();
  const [resolved] = f.send("history", { id: task.id });
  assert.equal(resolved.id, queued.id);
  assert.equal(resolved.state, "stopped");
  assert.deepEqual(resolved.linked, []);
  assert.deepEqual(f.store.all("run"), [occupied]);
});

test("a linked one-time plan runs its first step anew instead of reusing a previously generated work", t => {
  const f = planLinkFixture(t);
  const plan = f.plan("A reusable plan definition", {origin: "plan"});
  const preview = f.center.preview({id: plan.id});
  const previous = f.center.run({id: plan.id, expectedRevision: plan.revision, summaryHash: preview.summaryHash,
    source: "manual", requestId: randomUUID()});
  f.store.put("run", {...previous, state: "completed"});
  const item = f.center.list().items.find(item => item.runId === previous.id);
  f.store.put("item", {...item, state: "completed", workId: randomUUID()});
  const task = f.send("save", {task: f.task([plan.id]), expectedRevision: null});
  f.send("start", {id: task.id, expectedRevision: task.revision, requestId: randomUUID()});
  f.tick();
  const linked = f.send("list").tasks[0].run.linked[0];
  assert.notEqual(linked.id, previous.id);
  assert.equal(linked.owned, true);
  assert.equal(f.store.get("run", linked.id).source, "publication_task");
  assert.equal(f.center.next({runId: linked.id}).stage, "dot");
});

for (const source of ["manual", "scheduled"]) test(`a new ${source} execution starts all plans in order after a blocked failure`, t => {
  const f = planLinkFixture(t);
  const [first, second, third] = [f.plan("创作"), f.plan("封面"), f.plan("发布")];
  const planIds = [first.id, third.id, second.id];
  const definition = f.task(planIds);
  const task = f.send("save", { task: { ...definition,
    ...(source === "scheduled" ? { execution: { kind: "scheduled", unit: "hour", minute: 31 } } : {}),
  }, expectedRevision: null });
  const start = () => f.send("start", { id: task.id, expectedRevision: task.revision, requestId: randomUUID() });
  const originalRun = start();
  const history = () => f.send("history", { id: task.id });
  f.tick();
  const blocked = f.store.get("run", history()[0].linked[0].id);
  const next = f.center.next({ runId: blocked.id });
  const failedAttemptId = fixturePlanStage(f, blocked, next.itemId, next.stage, "failed", "LYRIC_REVIEW_INVALID");
  f.tick();
  assert.deepEqual(history()[0].planFailures, [{ planId: first.id, reason: "LYRIC_REVIEW_INVALID" }]);
  for (const id of planIds.slice(1)) {
    f.tick();
    const { id: linkedId, planId } = history()[0].linked.at(-1);
    assert.equal(planId, id);
    f.store.put("run", { ...f.store.get("run", linkedId), state: "completed" });
  }
  f.tick();
  const previous = history()[0];
  assert.equal(previous.state, "partial");
  assert.equal(f.store.get("run", blocked.id).state, "blocked");

  f.clock("2026-11-20T04:31:01Z");
  if (source === "manual") start();
  f.tick();
  const current = () => history()[0];
  assert.notEqual(current().id, originalRun.id);
  assert.equal(current().source, source);
  const oldLinks = new Set(previous.linked.map(link => link.id));
  for (const [index, planId] of planIds.entries()) {
    assert.deepEqual(current().linked.map(link => link.planId), planIds.slice(0, index + 1));
    const link = current().linked[index];
    assert.equal(link.owned, true);
    assert.equal(oldLinks.has(link.id), false);
    const newRun = f.store.get("run", link.id);
    assert.equal(newRun.planId, planId);
    assert.equal(newRun.source, "publication_task");
    assert.equal(newRun.requestId, `publication:${current().id}:${planId}`);
    assert.equal(f.center.next({ runId: newRun.id }).attemptId, undefined);
    f.tick();
    assert.equal(current().linked.length, index + 1);
    f.store.put("run", { ...newRun, state: "completed" });
    f.tick();
  }
  assert.equal(current().state, "completed");
  assert.deepEqual(history()[1], previous);
  assert.equal(f.store.get("run", blocked.id).state, "failed");
  assert.equal(f.store.get("run", blocked.id).updatedAt, blocked.updatedAt);
  assert.equal(f.store.get("item", next.itemId).reason, "LYRIC_REVIEW_INVALID");
  assert.equal(f.store.get("stage", failedAttemptId).state, "failed");
  assert.throws(() => f.center.retry({ attemptId: failedAttemptId }), /STOP_REQUESTED/);
});

test("a fresh task waits for the prior task's unresolved plan attempt", t => {
  const f = planLinkFixture(t);
  const first = f.plan("创作", { count: 2 }), second = f.plan("发布");
  const preview = f.center.preview({ id: first.id });
  const prior = f.center.runForPublication({ id: first.id, expectedRevision: first.revision, summaryHash: preview.summaryHash,
    requestId: randomUUID() }, true);
  const items = f.store.all("item").filter(item => item.runId === prior.id);
  fixturePlanStage(f, prior, items[0].id, "dot", "failed", "FIXTURE_SOURCE_FAILED");
  const pending = fixturePlanStage(f, prior, items[1].id, "dot", "unknown", "FIXTURE_RECEIPT_PENDING");

  const task = f.send("save", { task: f.task([first.id, second.id]), expectedRevision: null });
  f.send("start", { id: task.id, expectedRevision: task.revision, requestId: randomUUID() });
  const current = () => f.send("history", { id: task.id })[0];
  for (let tick = 0; tick < 4; tick++) f.tick();
  assert.equal(current().state, "waiting");
  assert.deepEqual(current().linked, []);
  assert.equal(current().planFailures, undefined);
  assert.equal(f.store.get("run", prior.id).state, "blocked");
  assert.equal(f.store.get("run", prior.id).stopRequested, false);
  assert.equal(f.store.get("stage", pending).state, "unknown");
  assert.equal(f.store.all("run").length, 1);

  f.center.reconcile({ attemptId: pending, status: "failed", evidenceId: "fixture-receipt-checked" });
  f.tick();
  assert.deepEqual(current().linked.map(link => link.planId), [first.id]);
  assert.notEqual(current().linked[0].id, prior.id);
  assert.equal(f.store.get("stage", pending).evidenceId, "fixture-receipt-checked");
});

for (const source of ["manual", "scheduled"]) test(`a ${source} rerun starts both plans fresh after its Fanqie upload ended with receipts to review`, t => {
  const f = planLinkFixture(t);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rainfall-fanqie-task-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  f.studio.root = root;
  const accountId = randomUUID(), accountKey = "a".repeat(64), configurationHash = "b".repeat(64);
  f.repo.save("accounts", { id: accountId, provider: "fanqie", name: "Offline Fanqie account" });
  const first = f.plan("日常"), upload = f.plan("番茄目录上传", {
    artistId: "", material: { source: "workflow" }, outputs: { lyrics: false, cover: false, music: false },
    workflow: { accountId, platform: "fanqie", mode: "musician", inspiration: "", maxRewrites: 0,
      graph: { nodes: ["publish:fanqie"], edges: [] },
      publications: [{ platform: "fanqie", accountId, accountKey, configurationHash }] },
  });
  const task = f.send("save", {
    task: { ...f.task([first.id, upload.id]), prepareContract: false,
      ...(source === "scheduled" ? { execution: { kind: "scheduled", unit: "hour", minute: 40 } } : {}),
    }, expectedRevision: null,
  });
  const history = () => f.send("history", { id: task.id });
  const start = () => f.send("start", { id: task.id, expectedRevision: task.revision, requestId: randomUUID() });
  const completeFirst = () => {
    f.tick();
    const current = f.store.get("run", history()[0].linked[0].id);
    return f.store.put("run", { ...current, state: "completed" });
  };

  const previousTask = start();
  completeFirst();
  f.tick();
  const previousUpload = f.store.get("run", history()[0].linked[1].id);
  const initialIssue = "FANQIE_RECONCILIATION_REQUIRED";
  const issue = "FANQIE_BROWSER_CONNECTION_REQUIRED";
  const blocked = f.store.put("run", { ...previousUpload, state: "blocked", reason: initialIssue });
  f.tick();
  f.tick();
  const finishedTask = history()[0];
  assert.equal(finishedTask.id, previousTask.id);
  assert.equal(finishedTask.state, "partial");

  f.clock("2026-11-20T04:40:01Z");
  const updatedAt = f.studio.now().toISOString();
  f.store.put("run", { ...blocked, reason: issue, updatedAt });
  if (source === "manual") start();
  const firstRun = completeFirst();
  const currentTask = history()[0];
  assert.notEqual(currentTask.id, finishedTask.id);
  assert.equal(currentTask.source, source);
  assert.notEqual(firstRun.id, finishedTask.linked[0].id);
  assert.deepEqual(history()[0].linked.map(row => row.planId), [first.id]);
  const folder = path.join(root, "production", "fanqie", "accounts", accountId, "download-runs", blocked.id);
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, "batch.json");
  const received = { id: "recording-1", state: "uploaded", workId: "70001" };
  const batch = { id: blocked.id, accountKey, configurationHash, state: "needs_review", issue,
    preferences: { limit: 10, signContract: false }, items: [received, { id: "recording-2", state: "needs_review", issue }] };
  fs.writeFileSync(file, JSON.stringify(batch));
  f.tick();
  const current = history()[0];
  assert.equal(current.id, currentTask.id);
  assert.deepEqual(current.linked.map(row => row.planId), [first.id, upload.id]);
  assert.equal(current.linked[0].id, firstRun.id);
  assert.notEqual(current.linked[1].id, blocked.id);
  const fresh = f.store.get("run", current.linked[1].id);
  assert.equal(fresh.prepareContract, false);
  assert.equal(fresh.state, "running");
  assert.equal(fresh.requestId, `publication:${currentTask.id}:${upload.id}`);
  assert.equal(fresh.snapshot.workflow.publications[0].accountId, accountId);
  assert.equal(current.planFailures, undefined);
  assert.equal(current.skippedPlanIds, undefined);
  assert.equal(f.store.get("run", blocked.id).state, "failed");
  assert.equal(f.store.get("run", blocked.id).stopRequested, true);
  assert.equal(f.store.get("run", blocked.id).reason, issue);
  assert.equal(f.store.get("run", blocked.id).updatedAt, updatedAt);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), batch);
  assert.deepEqual(history()[1], finishedTask);
});

test("the next task starts Fanqie after a previous download batch lost its browser before submission", t => {
  const f = planLinkFixture(t);
  const temp = fs.realpathSync.native(os.tmpdir());
  const root = fs.mkdtempSync(path.join(temp, "rainfall-fanqie-connection-"));
  t.after(() => {
    assert.equal(path.dirname(fs.realpathSync.native(root)), temp);
    fs.rmSync(root, { recursive: true, force: true });
  });
  f.studio.root = root;
  const accountId = randomUUID(), accountKey = "a".repeat(64), configurationHash = "b".repeat(64);
  f.repo.save("accounts", { id: accountId, name: "番茄账号", provider: "fanqie" });
  const create = f.plan("日常"), upload = f.plan("番茄音乐平台上传", {
    artistId: "", material: { source: "workflow" }, outputs: { lyrics: false, cover: false, music: false },
    workflow: { accountId, platform: "fanqie", mode: "musician", inspiration: "", maxRewrites: 0,
      graph: { nodes: ["publish:fanqie"], edges: [] },
      publications: [{ platform: "fanqie", accountId, accountKey, configurationHash }] },
  });
  const { summaryHash } = f.center.preview({ id: upload.id });
  const old = f.center.runForPublication({ id: upload.id, expectedRevision: upload.revision, summaryHash, requestId: randomUUID() }, true, false);
  const issue = "FANQIE_BROWSER_CONNECTION_REQUIRED";
  f.store.put("run", { ...old, state: "blocked", reason: issue });
  const folder = path.join(root, "production", "fanqie", "accounts", accountId);
  const runPath = path.join(folder, "download-runs", old.id);
  const jobId = "c".repeat(64), itemId = "d".repeat(64);
  fs.mkdirSync(runPath, { recursive: true });
  fs.mkdirSync(path.join(folder, "uploads"), { recursive: true });
  const batch = { id: old.id, state: "needs_review", issue, accountKey, configurationHash, round: 1,
    preferences: { limit: 10, signContract: false }, active: { number: 1, trackIds: [itemId], signContract: false },
    items: [{ id: itemId, title: "窗边的灯", round: 1, state: "needs_review", issue }] };
  const batchFile = path.join(runPath, "batch.json");
  fs.writeFileSync(batchFile, JSON.stringify(batch));
  const jobFile = path.join(folder, "uploads", jobId + ".json");
  const job = { id: jobId, title: "窗边的灯", accountKey, phase: "unknown", pending: "opening-form", reason: issue,
    baselineIds: [], download: { batchId: old.id, id: itemId, audioSha256: "e".repeat(64), sourceIdentity: "fixture-source" } };
  fs.writeFileSync(jobFile, JSON.stringify({ ...job, pending: "first-step:confirm-upload" }));
  const task = f.send("save", { task: { ...f.task([create.id, upload.id]), prepareContract: false }, expectedRevision: null });
  f.send("start", { id: task.id, expectedRevision: task.revision, requestId: randomUUID() });
  const current = () => f.send("history", { id: task.id })[0];
  f.tick();
  const first = f.store.get("run", current().linked[0].id);
  const firstItem = f.center.next({ runId: first.id });
  fixturePlanStage(f, first, firstItem.itemId, firstItem.stage, "failed", "PULE_AUDIO_SIZE");
  f.tick();
  f.tick();
  assert.match(current().detail, /另一次执行尚未结束/u);
  assert.deepEqual(current().linked.map(link => link.id), [first.id]);

  fs.writeFileSync(jobFile, JSON.stringify(job));
  f.tick();
  assert.deepEqual(current().planFailures, [{ planId: first.planId, reason: "PULE_AUDIO_SIZE" }]);
  assert.deepEqual(current().linked.map(link => link.planId), [create.id, upload.id]);
  assert.notEqual(current().linked[1].id, old.id);
  assert.equal(f.store.get("run", old.id).state, "failed");
  assert.deepEqual(JSON.parse(fs.readFileSync(jobFile, "utf8")), job);
  assert.deepEqual(JSON.parse(fs.readFileSync(batchFile, "utf8")), batch);
});

for (const hasReceipt of [true, false]) test(`Suno CN ${hasReceipt ? "with missing WAVs" : "without an old receipt"} preserves evidence and advances the task`, t => {
  const f = planLinkFixture(t);
  const music = f.plan("苏诺之音素素任务"), next = f.plan("后续上传计划");
  const task = f.send("save", { task: f.task([music.id, next.id]), expectedRevision: null });
  f.send("start", { id: task.id, expectedRevision: task.revision, requestId: randomUUID() });
  const current = () => f.send("history", { id: task.id })[0];
  f.tick();
  const run = f.store.get("run", current().linked[0].id);
  const item = f.store.all("item", { field: "runId", values: [run.id] })[0];
  const accountId = randomUUID(), requestId = randomUUID(), attemptId = randomUUID();
  const reason = "WORKFLOW_SUNO_CN_BROWSER_RECEIPT_UNKNOWN";
  const workflow = { accountId, mode: "musician", inspiration: "", maxRewrites: 0,
    graph: { nodes: ["lyrics", "music:suno_cn"], edges: [{ from: "lyrics", to: "music:suno_cn" }] },
    browserMusic: { provider: "suno_cn", accountId, inputs: { title: "title", style: "style", lyrics: "lyrics" } } };
  f.store.put("run", { ...run, state: "blocked", snapshot: { ...run.snapshot, workflow,
    material: { ...run.snapshot.material, source: "workflow" }, outputs: { ...run.snapshot.outputs, cover: true },
    routing: { text: { source: "default" }, image: { source: "default" }, music: { source: "default" } },
  } });
  f.store.put("item", { ...item, state: "unknown", reason });
  const receipt = { trackingId: "suno-cn:" + requestId, songIds: [requestId + ":A", requestId + ":B"] };
  const retained = f.store.put("stage", { id: attemptId, idempotencyKey: attemptId, requestHash: attemptId,
    runId: run.id, itemId: item.id, stage: "music_submit", ordinal: 1, state: "unknown", reason,
    ...(hasReceipt ? { result: receipt } : {}), createdAt: run.createdAt, updatedAt: run.updatedAt });
  f.tick();
  f.tick();
  assert.deepEqual(current().linked.map(link => link.planId), [music.id, next.id]);
  assert.equal(current().planFailures[0].reason, hasReceipt ? "WORKFLOW_SUNO_CN_WAV_RECOVERY_REQUIRED" : "WORKFLOW_SUNO_CN_BROWSER_RECEIPT_UNKNOWN");
  assert.deepEqual(f.store.get("stage", attemptId), retained);
  assert.equal(f.store.all("stage", { field: "runId", values: [run.id] }).length, 1);
});

test("an exhausted Pule receipt check lets the next plan run while preserving the unknown paid attempt", t => {
  const f = planLinkFixture(t);
  const music = f.plan("谱乐创作"), upload = f.plan("番茄音乐上传");
  const task = f.send("save", { task: f.task([music.id, upload.id]), expectedRevision: null });
  f.send("start", { id: task.id, expectedRevision: task.revision, requestId: randomUUID() });
  const current = () => f.send("history", { id: task.id })[0];
  f.tick();
  const run = f.store.get("run", current().linked[0].id);
  const item = f.store.all("item", { field: "runId", values: [run.id] })[0];
  const accountId = randomUUID(), attemptId = randomUUID();
  const workflow = { accountId, mode: "musician", inspiration: "", maxRewrites: 0,
    graph: { nodes: ["lyrics", "music:yourmusic"], edges: [{ from: "lyrics", to: "music:yourmusic" }] },
    browserMusic: { provider: "yourmusic", accountId, inputs: { title: "title", style: "style", lyrics: "lyrics" } } };
  f.store.put("run", { ...run, state: "blocked", snapshot: { ...run.snapshot, workflow,
    material: { ...run.snapshot.material, source: "workflow" }, outputs: { ...run.snapshot.outputs, cover: true },
    routing: { text: { source: "default" }, image: { source: "default" }, music: { source: "default" } } } });
  const reason = "WORKFLOW_PULE_BROWSER_RECEIPT_UNKNOWN";
  f.store.put("item", { ...item, state: "unknown", reason });
  const attempt = f.store.put("stage", { id: attemptId, idempotencyKey: attemptId, requestHash: attemptId,
    runId: run.id, itemId: item.id, stage: "music_submit", ordinal: 1, state: "unknown", reason,
    createdAt: run.createdAt, updatedAt: run.updatedAt });
  f.tick();
  assert.equal(current().state, "action_required");

  const unconfirmed = "PULE_BROWSER_HISTORY_NOT_FOUND";
  const evidence = f.store.put("stage", { ...attempt, reason: unconfirmed,
    result: { beforeSongIds: ["old-a", "old-b"], browserRecoveryExhausted: true } });
  f.store.put("item", { ...item, state: "unknown", reason: unconfirmed });
  f.tick();
  f.tick();
  assert.deepEqual(current().linked.map(link => link.planId), [music.id, upload.id]);
  assert.deepEqual(current().planFailures, [{ planId: music.id, reason: unconfirmed }]);
  assert.deepEqual(f.store.get("stage", attemptId), evidence);
});

test("a start failure preserves the old failed execution for recovery and advances the new task", t => {
  const f = planLinkFixture(t);
  const first = f.plan("创作"), second = f.plan("发布");
  const preview = f.center.preview({ id: first.id });
  const original = f.center.runForPublication({ id: first.id, expectedRevision: first.revision, summaryHash: preview.summaryHash,
    requestId: randomUUID() }, true);
  const next = f.center.next({ runId: original.id });
  fixturePlanStage(f, original, next.itemId, next.stage, "failed", "FIXTURE_SOURCE_FAILED");
  const blocked = f.store.get("run", original.id);
  f.center.options.prepareDownloads = plan => {
    if (plan.id === first.id) throw Error("DOWNLOAD_ROOT_REQUIRED");
    return [];
  };
  const task = f.send("save", { task: f.task([first.id, second.id]), expectedRevision: null });
  f.send("start", { id: task.id, expectedRevision: task.revision, requestId: randomUUID() });
  const current = () => f.send("history", { id: task.id })[0];
  f.tick();
  assert.deepEqual(current().planFailures, [{ planId: first.id, reason: "DOWNLOAD_ROOT_REQUIRED" }]);
  assert.deepEqual(f.store.get("run", original.id), blocked);
  assert.equal(f.store.all("run").length, 1);
  f.tick();
  assert.deepEqual(current().linked.map(link => link.planId), [second.id]);
});

test("a plan missing at startup is recorded in order and the remaining plans run", t => {
  const f = planLinkFixture(t);
  const removed = f.plan("已删除的计划"), remaining = f.plan("仍可执行的计划");
  const task = f.send("save", { task: f.task([removed.id, remaining.id]), expectedRevision: null });
  f.store.remove("plan", removed.id);
  f.send("start", { id: task.id, expectedRevision: task.revision, requestId: randomUUID() });
  const current = () => f.send("history", { id: task.id })[0];
  f.tick();
  assert.deepEqual(current().planFailures, [{ planId: removed.id, reason: "PUBLICATION_PLAN_UNAVAILABLE" }]);
  assert.deepEqual(current().linked, []);
  f.tick();
  const next = f.store.get("run", current().linked[0].id);
  assert.equal(next.planId, remaining.id);
  f.store.put("run", { ...next, state: "completed" });
  f.tick();
  assert.equal(current().state, "partial");
  assert.match(current().detail, /成功 1 个.*失败 1 个/);
  const progress = f.send("list", { expandedTaskId: task.id }).tasks[0].planProgress;
  assert.deepEqual(progress.map(plan => [plan.planId, plan.state]), [[removed.id, "failed"], [remaining.id, "completed"]]);
});

test("publication keeps advancing after a failed Plan Center stage and a removed queued plan", t => {
  const f = planLinkFixture(t);
  const plans = [1, 2, 3, 4].map(number => f.plan("计划 " + number));
  const task = f.send("save", { task: f.task(plans.map(plan => plan.id)), expectedRevision: null });
  const progress = () => f.send("list", { expandedTaskId: task.id }).tasks[0].planProgress;
  f.send("start", { id: task.id, requestId: randomUUID(), expectedRevision: task.revision });
  const current = () => f.send("history", { id: task.id })[0];
  f.tick();
  const first = f.store.get("run", current().linked[0].id);
  f.store.put("run", { ...first, state: "completed" });
  f.tick();
  const second = f.store.get("run", current().linked[1].id);
  const next = f.center.next({ runId: second.id });
  assert.equal(f.send("list").tasks[0].planProgress, undefined);
  assert.deepEqual(progress().map(plan => plan.state), ["completed", "waiting", "queued", "queued"]);
  const attemptId = fixturePlanStage(f, second, next.itemId, next.stage, "failed", "FIXTURE_STAGE_FAILED");
  assert.equal(f.store.get("run", second.id).state, "blocked");
  f.tick();
  assert.deepEqual(current().planFailures, [{ planId: plans[1].id, reason: "FIXTURE_STAGE_FAILED" }]);

  f.store.remove("plan", plans[2].id);
  f.tick();
  f.tick();
  assert.deepEqual(current().linked.map(link => link.planId), [plans[0].id, plans[1].id, plans[3].id]);
  assert.equal(f.store.get("run", second.id).stopRequested, false);
  assert.equal(f.store.get("stage", attemptId).reason, "FIXTURE_STAGE_FAILED");
  const fourth = f.store.get("run", current().linked[2].id);
  f.store.put("run", { ...fourth, state: "completed" });
  f.tick();
  assert.equal(current().state, "partial");
  assert.deepEqual(current().planFailures, [
    { planId: plans[1].id, reason: "FIXTURE_STAGE_FAILED" },
    { planId: plans[2].id, reason: "PUBLICATION_PLAN_UNAVAILABLE" },
  ]);
  const view = progress();
  assert.deepEqual(view.map(plan => [plan.title, plan.state]), [
    ["计划 1", "completed"], ["计划 2", "failed"], ["计划 3", "failed"], ["计划 4", "completed"],
  ]);
  assert.equal(view[1].runId, second.id);
  assert.equal(view[1].reason, "FIXTURE_STAGE_FAILED");
  assert.deepEqual(view[1].items[0].stages.map(({ stage, state, reason }) => ({ stage, state, reason })),
    [{ stage: "dot", state: "failed", reason: "FIXTURE_STAGE_FAILED" }]);
  assert.equal(view[2].reason, "PUBLICATION_PLAN_UNAVAILABLE");

  const edited = f.send("save", { task: f.task([plans[3].id]), expectedRevision: null });
  assert.deepEqual(f.send("list", { expandedTaskId: edited.id }).tasks.find(row => row.task.id === edited.id).planProgress
    .map(({ title, state }) => [title, state]), [["计划 4", "pending"]]);
});

test("task plan progress keeps the execution snapshot and shows which plans were skipped after stop", t => {
  const f = planLinkFixture(t);
  const first = f.plan("原计划甲"), second = f.plan("原计划乙"), third = f.plan("后续计划");
  const task = f.send("save", { task: f.task([first.id, second.id]), expectedRevision: null });
  const run = f.send("start", { id: task.id, requestId: randomUUID(), expectedRevision: task.revision });
  f.tick();
  const linked = f.send("history", { id: task.id })[0].linked;
  f.send("stop", { id: run.id });
  f.tick();
  f.send("save", { task: { ...f.task([third.id]), id: task.id }, expectedRevision: task.revision });
  const result = f.send("list", { expandedTaskId: task.id }).tasks[0];
  assert.equal(result.run.state, "stopped");
  assert.equal(f.center.list().runs.length, 1);
  assert.deepEqual(result.planProgress.map(({ title, state, runId }) => [title, state, runId]), [
    ["原计划甲", "stopped", linked[0].id], ["原计划乙", "skipped", undefined],
  ]);
});

test("an already queued legacy Fanqie dispatch keeps tracking its original platform receipt", t => {
  const { callPublicationTasks, tickPublicationTasks, PlanCenterService, CenterStore, planFanqieAction, queuePublications } = mod.exports;
  const repo = new Repository(":memory:");
  t.after(() => repo.close());
  const now = () => new Date("2026-11-19T03:00:00Z"), center = new PlanCenterService(repo, { now });
  const artistId = randomUUID(), accountId = randomUUID(), planId = randomUUID();
  repo.save("artists", { id: artistId, name: "作词人", defaults: {}, revision: 1 });
  repo.save("accounts", { id: accountId, provider: "fanqie", name: "测试账号" });
  center.save({ expectedRevision: null, plan: {
    id: planId, title: "计划一", artistId, schedule: { kind: "daily", localTime: "09:00" },
    material: { source: "manual" }, outputs: { lyrics: true, music: true, cover: true },
    music: { route: "manual" }, text: {}, authorization: { publish: true },
  } });
  const studio = { mode: "production", now, repo, planCenterService: () => center,
    get: repo.get.bind(repo), save: repo.save.bind(repo), locate: id => ({ file: "fixture/" + id }),
    lyricService: () => ({ forWork: work => ({ cleaned: work.lyrics }) }),
  };
  const send = (method, body = {}) => callPublicationTasks(studio, "publicationTasks." + method, body);
  const fanqie = (action, body = {}) => planFanqieAction(studio, action, body);
  const id = randomUUID(), accountKey = "a".repeat(64);
  const upload = { kind: "publish", targets: [{ platform: "fanqie", accountId, accountKey, configurationHash: "b".repeat(64) }] };
  repo.save("settings", { id: "publication-task:definition:" + id, value: { id, title: "发布任务", consent: true,
    execution: { kind: "manual" }, steps: [{ kind: "plans", planIds: [planId] }, upload],
    enabled: true, revision: 1, cursor: now().toISOString() } });
  const taskRun = send("start", { id, requestId: randomUUID(), expectedRevision: 1 });
  tickPublicationTasks(studio);
  const [planRun] = center.list().runs;
  assert.equal(planRun.source, "publication_task");
  assert.equal(planRun.snapshot.authorization.publish, false);
  assert.deepEqual(fanqie("list"), []);
  const audio = { id: randomUUID(), kind: "audio", bytes: 100, sha256: "c".repeat(64) };
  const cover = { id: randomUUID(), kind: "image", bytes: 100, sha256: "d".repeat(64) };
  const work = { id: randomUUID(), title: "测试歌曲", artistId, assets: { audio_A: audio.id, cover: cover.id }, ai: "generated", lyrics: "测试歌词" };
  repo.save("assets", audio); repo.save("assets", cover); repo.save("works", work);
  const store = new CenterStore(repo);
  store.put("run", { ...planRun, state: "completed" });
  store.put("item", { ...center.list().items[0], state: "completed", workId: work.id });
  const runKey = "publication-task:run:" + taskRun.id;
  const existing = repo.get("settings", runKey).value;
  const dispatch = queuePublications(studio, upload, [work.id], taskRun.id);
  repo.save("settings", { id: runKey, value: { ...existing, dispatch } });
  tickPublicationTasks(studio);
  const [job] = fanqie("list");
  assert.equal(job.workId, work.id);
  const scope = { runId: job.runId };
  assert.equal(fanqie("claimBatch", scope).accountId, accountId);
  assert.equal(fanqie("currentBatch", scope).items.length, 1);
  const record = { id: "987654", title: work.title, stage: "contract_pending", officialStatus: "待签约" };
  fanqie("recordBatch", { ...scope, receipts: [{ workId: work.id, record, authorization: "awaiting_signature" }] });
  tickPublicationTasks(studio);
  assert.equal(send("list").tasks[0].run.state, "action_required");
  fanqie("observeAuthorization", {
    accountId, accountKey, records: [{ ...record, stage: "reviewing", officialStatus: "审核中",
      createdAtText: "", publishedAtText: "" }],
  });
  tickPublicationTasks(studio);
  assert.equal(send("list").tasks[0].run.state, "completed");
});

test("the browser publishing workbench exposes task actions within its existing session boundary", async t => {
  const seen = [];
  const server = mod.exports.startPublishWorkbench(process.cwd(), async request => {
    seen.push(request.method);
    return { ok: true, value: { tasks: [], plans: [] } };
  });
  t.after(() => server.close());
  const url = new URL(await server.ready);
  const request = (method, token) => fetch(url.origin + "/rpc", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: url.origin, Authorization: "Bearer " + token },
    body: JSON.stringify({ channel: "call", method, input: {} }),
  });
  assert.equal((await request("publicationTasks.list", "")).status, 403);
  assert.equal((await request("publicationTasks.list", url.hash.slice(1))).status, 200);
  assert.equal((await request("internal.planFanqie.claimBatch", url.hash.slice(1))).status, 403);
  assert.deepEqual(seen, ["publicationTasks.list"]);
});

test("stopping a workflow prevents its queued Tencent job from claiming a write", t => {
  const { UnifiedPublicationService } = mod.exports;
  const repo = new Repository(":memory:");
  t.after(() => repo.close());
  const service = new UnifiedPublicationService(repo, { verify: () => {} });
  const owner = randomUUID(), ownerKey = "publication-task:run:" + owner;
  repo.save("settings", { id: ownerKey, value: { state: "running" } });
  const request = { workId: randomUUID(), accountId: randomUUID(), title: "测试歌曲", target: "qqmusic",
    state: "unavailable", materialSnapshot: { ai: "generated" } };
  const [job] = service.enqueue([request], owner);
  assert.equal(job.state, "queued");
  assert.equal(service.assertWorkflowCurrent(job.id), true);
  repo.save("settings", { id: ownerKey, value: { state: "stopped" } });
  assert.equal(service.list()[0].reason, "PUBLICATION_TASK_STOPPED");
  assert.throws(() => service.claim({ id: job.id, expectedRevision: job.revision }), /STOP_REQUESTED/);
  const nextOwner = randomUUID();
  repo.save("settings", { id: "publication-task:run:" + nextOwner, value: { state: "running" } });
  assert.equal(service.enqueue([request], nextOwner)[0].id, job.id);
  assert.equal(service.list().length, 1);
  assert.equal(service.assertWorkflowCurrent(job.id), true);
});
