import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import {
  PublicationTaskDeleteSchema, PublicationTaskSaveSchema, PublicationTaskStartSchema, PublicationTaskToggleSchema,
  publicationRunActive, publicationRunKey, publicationTaskKey, publicationTaskNeedsPlanConfirmation,
  type PublicationDispatch, type PublicationExecution, type PublicationPlan, type PublicationRunState,
  type PublicationTask, type PublicationTaskList, type PublicationTaskRun,
} from "../shared/publication-tasks";
import type { Repository } from "./database";
import type { PlanCenterRun } from "../shared/plan-center";
import { workflowPublicationPlatforms } from "../shared/plan-workflow-graph";

type Ports = {
  now: () => Date;
  plans: () => PublicationPlan[];
  scheduledPlanConflicts: (planIds: readonly string[], occurrence: string) => string[];
  startPlan: (plan: PublicationPlan, requestId: string, includePlanPublication: boolean, prepareContract?: boolean) => string | null;
  observePlan: (id: string) => { state: string; detail?: string; failure?: string } | undefined;
  stopPlan: (id: string) => void;
  observePublication: (dispatch: PublicationDispatch, prepareContract?: boolean) => { state: PublicationRunState; detail: string };
};

export function publicationOwnerActive(repo: Repository, ownerId?: string) {
  if (!ownerId) return true;
  const run = repo.maybe("settings", publicationRunKey + ownerId)?.value as PublicationTaskRun | undefined;
  if (run) return publicationRunActive(run.state);
  const plan = repo.maybe("settings", "plan-center:run:" + ownerId)?.value as PlanCenterRun | undefined;
  return !!plan && !plan.stopRequested && ["running", "waiting", "blocked"].includes(plan.state) &&
    plan.snapshot.authorization.publish && workflowPublicationPlatforms(plan.snapshot.workflow?.graph).length > 0;
}

export function latestPublicationOccurrence(execution: PublicationExecution, after: string, now: string) {
  if (execution.kind === "manual") return;
  const end = DateTime.fromISO(now).setZone("Asia/Shanghai");
  let at: DateTime;
  if (execution.unit === "hour") {
    at = end.startOf("hour").set({ minute: execution.minute });
    if (at > end) at = at.minus({ hours: 1 });
  } else {
    const [hour, minute] = execution.localTime.split(":").map(Number);
    const time = { hour, minute };
    if (execution.unit === "day") {
      at = end.startOf("day").set(time);
      if (at > end) at = at.minus({ days: 1 });
    } else if (execution.unit === "week") {
      at = end.startOf("week").plus({ days: execution.weekday - 1 }).set(time);
      if (at > end) at = at.minus({ weeks: 1 });
    } else {
      const inMonth = (month: DateTime) => month.startOf("month").set({ ...time, day: Math.min(execution.day, month.daysInMonth!) });
      at = inMonth(end);
      if (at > end) at = inMonth(end.minus({ months: 1 }));
    }
  }
  return at.toMillis() > Date.parse(after) ? at.toUTC().toISO()! : undefined;
}

function errorDetail(error: unknown) {
  return error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message) ? error.message : "PUBLICATION_TASK_STEP_FAILED";
}

function describePlan(run: PublicationTaskRun, planId: string) {
  const planIds = run.snapshot.steps[0].planIds;
  const index = planIds.indexOf(planId);
  const title = run.plans.find(plan => plan.id === planId)?.title ?? "不可用计划";
  return index < 0 ? planId : `${index + 1}/${planIds.length} · ${title}`;
}

export function overlapsOccurrence(startedAt: string, finishedAt: string, occurrence: number) {
  return Date.parse(startedAt) <= occurrence && occurrence < Date.parse(finishedAt);
}

export class PublicationTaskService {
  constructor(private repo: Repository, private ports: Ports) {}
  private now() { return this.ports.now().toISOString(); }
  private definitions() {
    return this.repo.settingsByPrefix(publicationTaskKey).map(row => row.value as PublicationTask);
  }
  private runs(taskId?: string) {
    return this.repo.settingsByPrefix(publicationRunKey, taskId ? { path: "$.value.taskId", values: [taskId] } : undefined)
      .map(row => row.value as PublicationTaskRun).reverse().sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
  private putTask(task: PublicationTask) {
    this.repo.save("settings", { id: publicationTaskKey + task.id, value: task });
    return task;
  }
  private putRun(run: PublicationTaskRun) {
    this.repo.save("settings", { id: publicationRunKey + run.id, value: run });
    return run;
  }
  private task(id: string, expectedRevision?: number) {
    const task = this.repo.maybe("settings", publicationTaskKey + id)?.value as PublicationTask | undefined;
    if (!task || task.deleted) throw Error("NOT_FOUND");
    if (expectedRevision !== undefined && task.revision !== expectedRevision) throw Error("REVISION_CONFLICT");
    return task;
  }
  private resolvePlans(task: Pick<PublicationTask, "steps">) {
    const options = new Map(this.ports.plans().map(plan => [plan.id, plan]));
    return task.steps[0].planIds.flatMap(id => {
      const plan = options.get(id);
      return plan ? [plan] : [];
    });
  }

  list(): PublicationTaskList["tasks"] {
    const latest = new Map<string, PublicationTaskRun>();
    for (const run of this.runs()) if (!latest.has(run.taskId)) latest.set(run.taskId, run);
    return this.definitions().filter(task => !task.deleted).map(task => {
      const run = latest.get(task.id);
      if (!run) return { task };
      const { snapshot, logs, ...summary } = run;
      return { task, run: summary };
    });
  }
  history(id: string) { return this.runs(id); }
  save(raw: unknown) {
    const input = PublicationTaskSaveSchema.parse(raw);
    return this.repo.transaction(() => {
      const previous = this.repo.maybe("settings", publicationTaskKey + input.task.id)?.value as PublicationTask | undefined;
      if (previous?.deleted || (previous?.revision ?? null) !== input.expectedRevision) throw Error("REVISION_CONFLICT");
      if (this.history(input.task.id).some(run => publicationRunActive(run.state))) throw Error("PUBLICATION_TASK_ACTIVE");
      if (this.resolvePlans(input.task).length !== input.task.steps[0].planIds.length) throw Error("PUBLICATION_PLAN_UNAVAILABLE");
      const prepareContract = input.task.prepareContract ?? previous?.prepareContract;
      return this.putTask({ ...input.task, prepareContract, revision: (previous?.revision ?? 0) + 1, enabled: previous?.enabled ?? true, cursor: this.now() });
    });
  }
  toggle(raw: unknown) {
    const { id, expectedRevision, enabled } = PublicationTaskToggleSchema.parse(raw);
    return this.repo.transaction(() => {
      const task = this.task(id, expectedRevision);
      if (this.history(id).some(run => publicationRunActive(run.state))) throw Error("PUBLICATION_TASK_ACTIVE");
      return this.putTask({ ...task, enabled, revision: task.revision + 1, cursor: this.now() });
    });
  }
  delete(raw: unknown) {
    const { id, expectedRevision } = PublicationTaskDeleteSchema.parse(raw);
    return this.repo.transaction(() => {
      const task = this.task(id, expectedRevision);
      if (this.history(id).some(run => publicationRunActive(run.state))) throw Error("PUBLICATION_TASK_ACTIVE");
      this.putTask({ ...task, enabled: false, deleted: true, revision: task.revision + 1 });
      return { id };
    });
  }
  private startTask(task: PublicationTask, requestId: string, source: PublicationTaskRun["source"], skippedPlanIds: string[] = []) {
    if (!task.enabled) throw Error("PUBLICATION_TASK_DISABLED");
    if (this.history(task.id).some(run => publicationRunActive(run.state))) throw Error("PUBLICATION_TASK_ACTIVE");
    const at = this.now();
    const run: PublicationTaskRun = {
      id: randomUUID(), taskId: task.id, requestId, source, snapshot: task, plans: [], linked: [],
      ...(skippedPlanIds.length ? { skippedPlanIds } : {}),
      state: "running", detail: "任务已启动", startedAt: at, updatedAt: at,
      logs: [{ at, state: "running", detail: source === "manual" ? "手动启动" : "定时启动" }],
    };
    try {
      run.plans = this.resolvePlans(task);
      if (publicationTaskNeedsPlanConfirmation(task, run.plans)) throw Error("PUBLICATION_PLAN_CONFIRMATION_REQUIRED");
      return this.putRun(run);
    } catch (error) { return this.note(run, "failed", errorDetail(error)); }
  }
  start(raw: unknown) {
    const { id, requestId, expectedRevision } = PublicationTaskStartSchema.parse(raw);
    return this.repo.transaction(() => {
      const existing = this.runs().find(run => run.source === "manual" && run.requestId === requestId);
      if (existing) {
        if (existing.taskId !== id || existing.snapshot.revision !== expectedRevision) throw Error("REQUEST_ID_CONFLICT");
        return existing;
      }
      return this.startTask(this.task(id, expectedRevision), requestId, "manual");
    });
  }
  private note(run: PublicationTaskRun, state: PublicationRunState, detail: string) {
    if (run.state === state && run.detail === detail) return run;
    const at = this.now();
    return this.putRun({ ...run, state, detail, updatedAt: at, logs: [...run.logs, { at, state, detail }] });
  }
  private recordPlanFailure(run: PublicationTaskRun, planId: string, reason: string) {
    const planFailures = [...(run.planFailures ?? []), { planId, reason }];
    this.note({ ...run, planFailures }, "running", "计划失败 · " + describePlan(run, planId) + " · " + reason);
  }
  stop(id: string) {
    return this.repo.transaction(() => {
      const run = this.repo.get("settings", publicationRunKey + id).value as PublicationTaskRun;
      if (!publicationRunActive(run.state)) return run;
      const stopped = this.note(run, "stopped", "已停止后续步骤");
      for (const link of run.linked.filter(row => row.owned)) {
        const state = this.ports.observePlan(link.id)?.state;
        if (state && !["completed", "failed", "stopped"].includes(state)) this.ports.stopPlan(link.id);
      }
      return stopped;
    });
  }

  tick() {
    const now = this.now();
    for (const task of this.definitions().filter(row => row.enabled && !row.deleted)) {
      this.repo.transaction(() => {
        const current = this.task(task.id);
        const due = latestPublicationOccurrence(current.execution, current.cursor, now);
        if (!due) return;
        const occurrence = Date.parse(due), history = this.history(current.id);
        const occupied = history.some(run => publicationRunActive(run.state) ||
          run.source === "scheduled" && run.requestId === due || overlapsOccurrence(run.startedAt, run.updatedAt, occurrence));
        if (!occupied) {
          const planIds = current.steps[0].planIds;
          const skippedPlanIds = this.ports.scheduledPlanConflicts(planIds, due);
          if (skippedPlanIds.length < planIds.length) this.startTask(current, due, "scheduled", skippedPlanIds);
        }
        // Consume this occurrence even if an execution is already in progress.
        this.putTask({ ...current, cursor: due });
      });
    }
    for (const entry of this.runs().filter(run => publicationRunActive(run.state))) {
      this.repo.transaction(() => {
        const run = this.repo.get("settings", publicationRunKey + entry.id).value as PublicationTaskRun;
        if (!publicationRunActive(run.state)) return;
        try { this.advance(run); }
        catch (error) { this.note(run, "failed", errorDetail(error)); }
      });
    }
  }
  private advance(run: PublicationTaskRun) {
    if (run.dispatch) {
      const { state, detail } = this.ports.observePublication(run.dispatch, run.snapshot.prepareContract);
      this.note(run, state, detail);
      return;
    }
    const failedPlans = new Set(run.planFailures?.map(failure => failure.planId));
    const skippedPlans = new Set(run.skippedPlanIds);
    const observed = run.linked.filter(link => !failedPlans.has(link.planId))
      .map(link => ({ link, result: this.ports.observePlan(link.id) }));
    const failed = observed.find(row => !row.result || row.result.failure !== undefined || ["failed", "stopped"].includes(row.result.state));
    if (failed) {
      const result = failed.result;
      const reason = result?.failure ?? result?.detail ??
        (!result ? "找不到该计划的执行记录" : result.state === "stopped" ? "计划已停止" : "计划执行失败");
      this.recordPlanFailure(run, failed.link.planId, reason);
      return;
    }
    const blocked = observed.find(row => row.result?.state === "blocked");
    if (blocked) {
      this.note(run, "action_required", "关联计划待处理 · " + describePlan(run, blocked.link.planId) +
        (blocked.result?.detail ? " · " + blocked.result.detail : ""));
      return;
    }
    const progress = (planId: string) => "执行计划 " + describePlan(run, planId);
    const current = observed.find(row => row.result?.state !== "completed");
    if (current) {
      this.note(run, "waiting", progress(current.link.planId));
      return;
    }
    const planIds = run.snapshot.steps[0].planIds;
    const nextId = planIds.find(id => !failedPlans.has(id) && !skippedPlans.has(id) && !run.linked.some(link => link.planId === id));
    if (nextId) {
      const next = run.plans.find(plan => plan.id === nextId);
      if (!next) {
        this.recordPlanFailure(run, nextId, "PUBLICATION_PLAN_UNAVAILABLE");
        return;
      }
      try {
        this.repo.transaction(() => {
          const includePlanPublication = run.snapshot.consent === true && !run.snapshot.steps[1];
          const occupied = run.source === "scheduled" && this.ports.scheduledPlanConflicts([nextId], run.requestId).length > 0;
          const id = occupied ? null :
            this.ports.startPlan(next, "publication:" + run.id + ":" + nextId, includePlanPublication, run.snapshot.prepareContract);
          if (id === null) {
            if (run.source === "scheduled") {
              this.note({ ...run, skippedPlanIds: [...skippedPlans, nextId] }, "running",
                "定时已跳过计划 " + describePlan(run, nextId) + " · 另一次执行尚未结束");
            } else {
              this.note(run, "waiting", "等待计划 " + describePlan(run, nextId) + " · 另一次执行尚未结束");
            }
            return;
          }
          this.note({ ...run, linked: [...run.linked, { id, planId: nextId, owned: true }] }, "waiting", progress(nextId));
        });
      } catch (error) {
        this.recordPlanFailure(run, nextId, errorDetail(error));
      }
      return;
    }
    const succeeded = planIds.length - failedPlans.size - skippedPlans.size;
    if (failedPlans.size) {
      const skipped = skippedPlans.size ? ` · 跳过 ${skippedPlans.size} 个` : "";
      this.note(run, succeeded ? "partial" : "failed", `执行完毕 · 成功 ${succeeded} 个 · 失败 ${failedPlans.size} 个${skipped}`);
      return;
    }
    if (skippedPlans.size) {
      this.note(run, succeeded ? "completed" : "stopped", `定时执行 · 完成 ${succeeded} 个 · 跳过 ${skippedPlans.size} 个`);
      return;
    }
    this.note(run, "completed", "关联计划已全部完成");
  }
}
