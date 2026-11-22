import { PublicationTaskIdSchema, PublicationTaskListSchema, publicationRunActive, publicationRunKey,
  type PublicationPlan, type PublicationPlanProgress, type PublicationPlanStage, type PublicationTaskList,
  type PublicationTaskRun } from "../shared/publication-tasks";
import {
  isPublicationPlan, planRunActive, planRunHasOutstandingWork, planStageCancelsOnStop,
  type PlanCenterItem, type PlanCenterList, type PlanCenterPlan, type PlanCenterRun, type PlanCenterStageAttempt,
} from "../shared/plan-center";
import { planPuleReceipt } from "../shared/plan-pule";
import { workflowBrowserMusic } from "../shared/plan-workflow-fields";
import { isLocalPublicationWorkflow, workflowPublicationPlatforms } from "../shared/plan-workflow-graph";
import { fanqieDownloadIssues } from "../shared/fanqie-downloads";
import { stopPlanExecution } from "./plan-center-integration";
import { CenterStore } from "./plan-center/storage";
import { fanqieDirectoryCleanupStatus, isFanqieDirectoryCleanupOnlyFailure, isFanqieDirectoryDisconnectedBeforeUpload } from "./plan-fanqie-directory";
import { readWorkflowPublication } from "./plan-workflow-publication";
import { overlapsOccurrence, PublicationTaskService } from "./publication-tasks";
import { observeDispatch } from "./publication-queue";
import type { Studio } from "./studio";

function planIncludesPublication(plan: PlanCenterPlan) {
  return workflowPublicationPlatforms(plan.workflow?.graph).length > 0 ||
    (plan.authorization.publish && (!!plan.fanqie || plan.publishTargets.some(target => target.enabled)));
}

function completedWithoutDownloads(run: PlanCenterRun) {
  return run.state === "stopped" && !run.stopRequested && run.reason === "FANQIE_DOWNLOADS_EMPTY" &&
    isLocalPublicationWorkflow(run.snapshot.workflow?.graph);
}

function blockedPlanFailure(items: PlanCenterItem[], publication: ReturnType<typeof readWorkflowPublication>) {
  const failed = items.find(item => ["failed", "not_found", "blocked"].includes(item.state));
  if (failed) return failed.reason ?? "PUBLICATION_TASK_STEP_FAILED";
  // A dispatched publication can still require receipt reconciliation or the user's confirmation.
  if (publication?.state === "action_required" && !publication.dispatch && !publication.qishui?.length) return publication.detail;
}

function confirmedSunoDownloadFailure(run: PlanCenterRun, items: PlanCenterItem[], attempts: PlanCenterStageAttempt[]) {
  if (run.source !== "publication_task" || run.snapshot.authorization.publish ||
    workflowBrowserMusic(run.snapshot.workflow)?.provider !== "suno_cn") return;
  const item = items.find(row => row.state === "unknown");
  if (!item) return;
  const latest = attempts.filter(row => row.runId === run.id && row.itemId === item.id && row.stage === "music_submit")
    .sort((a, b) => b.ordinal - a.ordinal)[0];
  if (!latest || latest.state !== "unknown") return;
  const receipt = planPuleReceipt.safeParse(latest.result);
  if (!receipt.success) return;
  const requestId = /^suno-cn:([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/u.exec(receipt.data.trackingId ?? "")?.[1];
  if (!requestId || receipt.data.songIds[0] !== requestId + ":A" || receipt.data.songIds[1] !== requestId + ":B") return;
  const reason = latest.reason && latest.reason !== "WORKFLOW_SUNO_CN_BROWSER_RECEIPT_UNKNOWN"
    ? latest.reason : "WORKFLOW_SUNO_CN_WAV_RECOVERY_REQUIRED";
  return { attemptId: latest.id, reason };
}

function settledPlanFailure(store: CenterStore, run: PlanCenterRun, rows: PlanCenterList, root: string) {
  if (run.state !== "blocked" || run.stopRequested) return;
  const items = rows.items.filter(item => item.runId === run.id);
  const downloadFailure = confirmedSunoDownloadFailure(run, items, rows.stageAttempts);
  const activity = downloadFailure ? { ...rows, stageAttempts: rows.stageAttempts.filter(row => row.id !== downloadFailure.attemptId) } : rows;
  if (planRunHasOutstandingWork(run, activity) || activity.stageAttempts.some(attempt => attempt.runId === run.id && planStageCancelsOnStop(run, attempt))) return;
  if (isLocalPublicationWorkflow(run.snapshot.workflow?.graph)) {
    return isFanqieDirectoryCleanupOnlyFailure(root, run) || isFanqieDirectoryDisconnectedBeforeUpload(root, run)
      ? run.reason : undefined;
  }
  const publication = readWorkflowPublication(store.repo, run.id);
  if (publication?.dispatch || publication?.qishui?.length) return;
  if (run.snapshot.fanqie && items.some(item => {
    const job = store.repo.maybe("settings", "plan-fanqie:" + item.id)?.value;
    return ["dispatching", "unknown"].includes(job?.state) ||
      job?.state === "uploaded" && job.record?.stage === "contract_pending" && (job.prepareContract ?? run.prepareContract ?? true);
  })) return;
  return blockedPlanFailure(items, publication) ?? downloadFailure?.reason;
}

type ReleasedPlan = { state: "failed" | "stopped"; reason?: string };

function taskPlanOwnership(store: CenterStore, run: PlanCenterRun) {
  if (run.source !== "publication_task") return;
  const [prefix, taskRunId] = run.requestId.split(":", 2);
  if (prefix !== "publication" || !taskRunId || run.requestId !== `publication:${taskRunId}:${run.planId}`) return;
  const parent = store.repo.maybe("settings", publicationRunKey + taskRunId)?.value as PublicationTaskRun | undefined;
  if (!parent?.linked?.some(link => link.id === run.id && link.planId === run.planId && link.owned)) return;
  const failure = parent.planFailures?.find(row => row.planId === run.planId);
  const settledAt = failure || !publicationRunActive(parent.state) ? parent.updatedAt : undefined;
  return { failure, settledAt };
}

function releasePreviousTaskPlan(store: CenterStore, run: PlanCenterRun, readLegacyRows: () => PlanCenterList, root: string,
  owner: ReturnType<typeof taskPlanOwnership>): ReleasedPlan | undefined {
  if (run.source !== "publication_task") return;
  if (owner) {
    if (!owner.settledAt) return;
    // Release scheduling ownership. The old attempt and publisher journals still guard the original works.
    return { state: owner.failure || run.state === "blocked" ? "failed" : "stopped", reason: run.reason ?? owner.failure?.reason };
  }
  if (run.state !== "blocked" || run.stopRequested) return;
  const reason = settledPlanFailure(store, run, readLegacyRows(), root);
  return reason ? { state: "failed", reason } : undefined;
}

function planProgress(store: CenterStore, { task, run }: PublicationTaskList["tasks"][number], options: PublicationPlan[], root: string): PublicationPlanProgress[] {
  const frozen = run?.plans ?? [];
  const stored = run ? store.repo.maybe("settings", publicationRunKey + run.id)?.value as PublicationTaskRun | undefined : undefined;
  const planIds = stored?.snapshot?.steps[0].planIds ?? (frozen.length ? frozen.map(plan => plan.id) : task.steps[0].planIds);
  const links = new Map(run?.linked.map(link => [link.planId, link]));
  const scope = { field: "runId" as const, values: run?.linked.map(link => link.id) ?? [] };
  const items = store.all("item", scope);
  const attempts = store.all("stage", scope);
  const publications = store.all("publish", scope);
  const byAttempt = (a: { ordinal: number; createdAt: string }, b: { ordinal: number; createdAt: string }) =>
    a.ordinal - b.ordinal || a.createdAt.localeCompare(b.createdAt);

  return planIds.map(planId => {
    const current = options.find(plan => plan.id === planId);
    const title = frozen.find(plan => plan.id === planId)?.title ?? current?.title ?? store.get("plan", planId)?.title ?? "不可用计划";
    const link = links.get(planId);
    const child = link && store.get("run", link.id);
    const failure = run?.planFailures?.find(entry => entry.planId === planId)?.reason;
    const result: PublicationPlanProgress = { planId, title, state: "pending", items: [] };
    if (child) {
      result.runId = child.id;
      result.owned = link.owned;
      result.updatedAt = child.updatedAt;
      result.state = completedWithoutDownloads(child) ? "completed" : child.state;
      result.reason = child.reason;
      result.items = items.filter(item => item.runId === child.id).sort((a, b) => a.ordinal - b.ordinal).map(item => {
        const stages = new Map<string, PublicationPlanStage>();
        for (const { id, stage, state, reason } of attempts.filter(attempt => attempt.itemId === item.id).sort(byAttempt))
          stages.set(stage, { id, stage, state, reason });
        for (const { id, platform, accountId, state, reason } of publications.filter(attempt => attempt.itemId === item.id).sort(byAttempt))
          stages.set(`publish:${platform}:${accountId}`, { id, stage: "publication", platform, state, reason });
        const title = typeof item.material?.title === "string" ? item.material.title : child.snapshot.creationDraft?.title;
        return { id: item.id, ordinal: item.ordinal, title, state: item.state, reason: item.reason, stages: [...stages.values()] };
      });
    } else if (link) {
      result.state = "failed";
      result.reason = "PUBLICATION_PLAN_RUN_MISSING";
    } else if (run?.skippedPlanIds?.includes(planId)) {
      result.state = "skipped";
      result.reason = "PUBLICATION_PLAN_SCHEDULE_SKIPPED";
    } else if (!current && (!run || run.detail === "PUBLICATION_PLAN_UNAVAILABLE")) {
      result.state = "failed";
      result.reason = "PUBLICATION_PLAN_UNAVAILABLE";
    } else if (run) {
      result.state = publicationRunActive(run.state) ? "queued" : "skipped";
    }
    if (failure) {
      result.state = "failed";
      result.reason = failure;
    } else if (child && !result.reason && ["blocked", "failed"].includes(result.state)) {
      result.reason = result.items.find(item => item.reason && ["blocked", "failed", "not_found"].includes(item.state))?.reason;
    }
    const cleanup = child && fanqieDirectoryCleanupStatus(root, child);
    if (cleanup === "queued") result.reason = "FANQIE_DOWNLOAD_CLEANUP_PENDING";
    if (cleanup === "recycled") result.reason = "FANQIE_DOWNLOAD_CLEANUP_RECOVERED";
    return result;
  });
}

function taskService(s: Studio) {
  const store = new CenterStore(s.repo);
  const taskRunsForPlans = (planIds: readonly string[]) =>
    store.all("run", { field: "planId", values: planIds }).filter(run => run.source === "publication_task");
  const plans = () => store.all("plan").filter(isPublicationPlan)
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")).map(plan => ({
    id: plan.id, revision: plan.revision, title: plan.title, updatedAt: plan.updatedAt,
    artistName: plan.artistSnapshot?.name ?? s.repo.maybe("artists", plan.artistId)?.name, publishes: planIncludesPublication(plan),
  }));
  return { plans, store, service: new PublicationTaskService(s.repo, {
    now: s.now, plans,
    scheduledPlanConflicts(planIds, occurrence) {
      const at = Date.parse(occurrence);
      let legacyRows: PlanCenterList | undefined;
      const loadLegacyRows = () => legacyRows ??= s.planCenterService().list();
      const conflicts = taskRunsForPlans(planIds).filter(run => {
        const owner = taskPlanOwnership(store, run);
        if (planRunActive(run) && !releasePreviousTaskPlan(store, run, loadLegacyRows, s.root, owner)) return true;
        // The child may receive a later update after its task has released ownership.
        return overlapsOccurrence(run.createdAt, run.updatedAt, at) && (!owner?.settledAt || at < Date.parse(owner.settledAt));
      });
      return [...new Set(conflicts.map(run => run.planId))];
    },
    startPlan(plan, requestId, includePlanPublication, prepareContract) {
      const current = store.get("plan", plan.id), center = s.planCenterService();
      if (!current || !isPublicationPlan(current)) throw Error("PUBLICATION_PLAN_UNAVAILABLE");
      if (current.revision !== plan.revision) throw Error("PUBLICATION_PLAN_CHANGED");
      const { summaryHash, summary } = center.preview({ id: plan.id });
      if (summary.routeIssue) throw Error(summary.routeIssue);
      const runs = taskRunsForPlans([plan.id]);
      if (!runs.some(run => run.requestId === requestId)) {
        let legacyRows: PlanCenterList | undefined;
        const loadLegacyRows = () => legacyRows ??= center.list();
        const released: { run: PlanCenterRun; outcome: ReleasedPlan }[] = [];
        for (const run of runs.filter(planRunActive)) {
          const outcome = releasePreviousTaskPlan(store, run, loadLegacyRows, s.root, taskPlanOwnership(store, run));
          if (!outcome) return null;
          released.push({ run, outcome });
        }
        for (const { run, outcome } of released) {
          store.put("run", { ...run, ...outcome, stopRequested: true });
          s.repo.audit("planCenter.taskRun.released", run.id, { planId: plan.id, ...outcome });
        }
      }
      const run = center.runForPublication({ id: plan.id, expectedRevision: plan.revision, summaryHash, requestId }, includePlanPublication, prepareContract);
      return run.id;
    },
    observePlan(id) {
      const run = store.get("run", id);
      if (!run) return;
      if (isLocalPublicationWorkflow(run.snapshot.workflow?.graph)) {
        const detail = run.reason && (fanqieDownloadIssues[run.reason] ?? run.reason);
        return {
          state: completedWithoutDownloads(run) ? "completed" : run.state,
          detail, failure: run.state === "blocked" ? detail ?? "番茄上传待核对" : undefined,
        };
      }
      const scope = { field: "runId" as const, values: [id] };
      const items = store.all("item", scope);
      const downloadFailure = run.state === "blocked" && workflowBrowserMusic(run.snapshot.workflow)?.provider === "suno_cn"
        ? confirmedSunoDownloadFailure(run, items, store.all("stage", scope)) : undefined;
      return { state: run.stopRequested ? "stopped" : run.state,
        detail: run.reason ?? items.find(item => item.reason)?.reason,
        failure: run.state === "blocked" ? blockedPlanFailure(items, readWorkflowPublication(s.repo, id)) ?? downloadFailure?.reason : undefined };
    },
    stopPlan: id => { if (store.get("run", id)?.source === "publication_task") stopPlanExecution(s, id); },
    observePublication: (dispatch, prepareContract) => observeDispatch(s, dispatch, prepareContract),
  }) };
}

export function tickPublicationTasks(s: Studio) {
  if (s.mode === "production") taskService(s).service.tick();
}

export function callPublicationTasks(s: Studio, method: string, input: unknown) {
  const { service, plans, store } = taskService(s);
  if (method === "publicationTasks.list") {
    const { expandedTaskId } = PublicationTaskListSchema.parse(input ?? {});
    const options = plans(), tasks = service.list();
    const expanded = expandedTaskId && tasks.find(row => row.task.id === expandedTaskId);
    if (expanded) expanded.planProgress = planProgress(store, expanded, options, s.root);
    return { tasks, plans: options } satisfies PublicationTaskList;
  }
  if (method === "publicationTasks.history") return service.history(PublicationTaskIdSchema.parse(input).id);
  if (s.mode !== "production") throw Error("PRODUCTION_REQUIRED");
  switch (method) {
    case "publicationTasks.save": return service.save(input);
    case "publicationTasks.start": return service.start(input);
    case "publicationTasks.stop": return service.stop(PublicationTaskIdSchema.parse(input).id);
    case "publicationTasks.toggle": return service.toggle(input);
    case "publicationTasks.delete": return service.delete(input);
    default: throw Error("METHOD_NOT_ALLOWED");
  }
}
