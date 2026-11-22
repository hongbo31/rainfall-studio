import React, { useCallback, useRef, useState } from "react";
import { PageHead, useStudio, useStudioRequest } from "../context";
import LoadingIndicator from "../components/LoadingIndicator";
import { useCenterQuery } from "../use-center-query";
import PublicationTaskEditor, { publicationExecutionLabel } from "../components/PublicationTaskEditor";
import PublicationTaskProgress from "../components/PublicationTaskProgress";
import { planExecutionMessage } from "../plan-execution-labels";
import { publicationRunActive, publicationTaskNeedsPlanConfirmation, type PublicationTask, type PublicationTaskInput,
  type PublicationTaskList, type PublicationTaskRun } from "../../shared/publication-tasks";
import "../publication-tasks.css";

const states = {
  pending: "待执行", disabled: "已停用", running: "执行中", waiting: "等待计划",
  action_required: "待处理", completed: "已完成", partial: "部分失败", failed: "失败", stopped: "已停止",
};
const reasons: Record<string, string> = {
  PUBLICATION_TASK_ACTIVE: "任务正在执行，请先停止。",
  PUBLICATION_TASK_DISABLED: "请先启用任务。",
  PUBLICATION_PLAN_UNAVAILABLE: "有关联计划不可用，请编辑任务。",
  PUBLICATION_PLAN_RUN_MISSING: "找不到关联计划的执行记录。",
  PUBLICATION_PLAN_CHANGED: "计划配置已修改，请在计划中心核对。",
  PUBLICATION_PLAN_BUSY: "关联计划正在停止，或正在按其他配置执行。",
  PUBLICATION_PLAN_SCHEDULE_SKIPPED: "计划已有未结束的执行，本次定时已跳过。",
  PUBLICATION_PLAN_CONFIRMATION_REQUIRED: "请编辑任务并确认关联计划的发布步骤。",
  PUBLICATION_PLAN_WORK_MISSING: "关联计划执行完成，但缺少可发布的作品。",
  PUBLICATION_ACCOUNT_REQUIRED: "缺少所选平台的发布账号。",
  PUBLICATION_QUEUE_RECORD_MISSING: "找不到已登记的上传记录。",
  PUBLICATION_TASK_STEP_FAILED: "当前工作流步骤执行失败。",
  REVISION_CONFLICT: "任务已更新，请刷新后重试。",
  PRODUCTION_REQUIRED: "请在真实本地库中维护发布任务。",
  RESTORED_REQUIRES_REVIEW: "从备份恢复后暂停执行，请核对任务。",
  FANQIE_CONFIGURATION_CHANGED: "番茄配置有变，请重新核对账号。",
  FANQIE_RECONCILIATION_REQUIRED: "请核对番茄官网的原投稿记录。",
};
const localStamp = (at: string) => new Date(at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
const details = (value: string) => value.split(" · ").map(part => reasons[part] ?? planExecutionMessage(part)).join(" · ");
const errorMessage = (error: unknown, fallback: string) => {
  if (!(error instanceof Error)) return fallback;
  const code = (error as Error & { code?: string }).code;
  return code && reasons[code] ? reasons[code] : details(error.message);
};

export default function PublishCenter({ browser = false }: { browser?: boolean } = {}) {
  const { data, go } = useStudio();
  const call = useStudioRequest();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [editor, setEditor] = useState<{ task?: PublicationTask }>();
  const [deleting, setDeleting] = useState<PublicationTask>();
  const [recordId, setRecordId] = useState("");
  const [expandedTaskId, setExpandedTaskId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const acting = useRef(false);
  const production = data.mode === "production";
  const readDashboard = useCallback((): Promise<PublicationTaskList> => call("publicationTasks.list",
    expandedTaskId ? { expandedTaskId } : {}), [call, expandedTaskId]);
  const readHistory = useCallback((): Promise<PublicationTaskRun[]> => call("publicationTasks.history", { id: recordId }), [call, recordId]);
  const dashboardQuery = useCenterQuery(readDashboard, { key: data.mode });
  const historyQuery = useCenterQuery(recordId ? readHistory : null);
  const dashboard = dashboardQuery.value, history = historyQuery.value;

  const act = async (operation: () => Promise<unknown>) => {
    if (acting.current) return;
    acting.current = true; setBusy(true); setError("");
    try { await operation(); await dashboardQuery.refresh(); }
    catch (e) { setError(errorMessage(e, "任务操作失败")); }
    finally { acting.current = false; setBusy(false); }
  };
  const save = (task: PublicationTaskInput) => void act(async () => {
    await call("publicationTasks.save", { task, expectedRevision: editor?.task?.revision ?? null });
    setEditor(undefined);
  });
  const togglePlans = (taskId: string) => setExpandedTaskId(current => current === taskId ? "" : taskId);
  const execute = (task: PublicationTask, activeRunId?: string) => void act(() => activeRunId
    ? call("publicationTasks.stop", { id: activeRunId })
    : call("publicationTasks.start", { id: task.id, requestId: crypto.randomUUID(), expectedRevision: task.revision }));
  const availablePlans = dashboard?.plans ?? [];
  const linkablePlans = new Map(availablePlans.map(plan => [plan.id, plan.title]));
  const rows = (dashboard?.tasks ?? []).map(row => ({
    ...row, result: row.run && publicationRunActive(row.run.state) ? row.run.state :
      !row.task.enabled ? "disabled" as const : row.run?.state ?? ("pending" as const),
    planNames: row.task.steps[0].planIds.map(id => linkablePlans.get(id) ?? "不可用计划"),
    plansUnavailable: row.task.steps[0].planIds.some(id => !linkablePlans.has(id)),
    needsPlanConfirmation: publicationTaskNeedsPlanConfirmation(row.task, availablePlans),
  })).filter(row => (!status || row.result === status) && [row.task.title, ...row.planNames].join(" ").toLowerCase().includes(query.trim().toLowerCase()));

  return <div className="publication-tasks">
    <PageHead title="任务中心" action={
      <button className="primary" type="button" disabled={!production || !dashboard || busy}
        onClick={() => { setError(""); setEditor({}); }}>＋ 新建任务</button>} />
    <section className="publication-task-panel" aria-label="任务列表" aria-busy={dashboardQuery.loading}>
      <div className="publication-task-toolbar">
        <div className="publication-task-filters">
          <label>查询任务<input type="search" placeholder="任务名称或关联计划" value={query} onChange={e => setQuery(e.target.value)} /></label>
          <label>执行结果<select value={status} onChange={e => setStatus(e.target.value)}>
            <option value="">全部状态</option>
            {Object.entries(states).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></label>
        </div>
        {dashboard && <span className="publication-task-count">{rows.length} 项任务</span>}
      </div>
      {error && !editor && !deleting && <p role="alert" className="plan-error">{error}</p>}
      <div className="publication-task-table">
        <table><thead><tr>
          <th scope="col">任务名称</th><th scope="col">执行结果</th><th scope="col">执行方式</th><th scope="col">关联计划</th><th scope="col">操作</th>
        </tr></thead><tbody>
          {rows.map(({ task, run, result, planNames, planProgress, plansUnavailable, needsPlanConfirmation }) => {
            const activeRunId = publicationRunActive(run?.state) ? run?.id : undefined;
            const open = expandedTaskId === task.id;
            const panelId = `task-plans-${task.id}`;
            const locked = !production || busy;
            return <React.Fragment key={task.id}>
              <tr className="publication-task-row" data-expanded={open}>
                <th scope="row"><button type="button" className="publication-task-name" aria-expanded={open}
                  aria-controls={open ? panelId : undefined} onClick={() => togglePlans(task.id)}>{task.title}</button></th>
                <td data-label="执行结果"><span className="publication-task-state" data-state={result}>{states[result]}</span>
                  {run && <small>{details(run.detail)}</small>}
                </td>
                <td data-label="执行方式"><span className="publication-task-execution">{publicationExecutionLabel(task.execution)}</span></td>
                <td data-label="关联计划"><strong>{planNames.length} 个计划</strong>
                  <small className="publication-task-plan-names" title={planNames.join(" → ")}>{planNames.join(" → ")}</small>
                  {needsPlanConfirmation && !activeRunId ? <small>{reasons.PUBLICATION_PLAN_CONFIRMATION_REQUIRED}</small> :
                    plansUnavailable && <small>可编辑任务并重新关联不可用计划。</small>}
                </td>
                <td className="publication-task-row-actions"><div className="publication-task-actions">
                  <button type="button" className="publication-task-command" data-stop={!!activeRunId}
                    disabled={locked || (!activeRunId && (!task.enabled || needsPlanConfirmation))}
                    onClick={() => execute(task, activeRunId)}>{activeRunId ? "停止" : "立即执行"}</button>
                  <button type="button" disabled={locked || !!activeRunId} onClick={() => { setEditor({ task }); setError(""); }}>编辑</button>
                  <button type="button" disabled={locked || !!activeRunId} onClick={() => void act(() =>
                    call("publicationTasks.toggle", { id: task.id, expectedRevision: task.revision, enabled: !task.enabled }))}>
                    {task.enabled ? "停用" : "启用"}
                  </button>
                  <button type="button" onClick={() => setRecordId(task.id)}>记录</button>
                  <button type="button" disabled={locked || !!activeRunId} onClick={() => { setError(""); setDeleting(task); }}>删除</button>
                </div></td>
              </tr>
              {open && <tr className="publication-task-expanded"><td colSpan={5}>
                <section id={panelId} className="publication-task-plans" aria-label={`${task.title}的关联计划`}>
                  <div className="publication-task-plans-head">
                    <h3>{run ? activeRunId ? "本次执行" : "最近一次执行" : "关联计划"}</h3>
                    {run && <time dateTime={run.startedAt}>{localStamp(run.startedAt)}</time>}
                  </div>
                  {planProgress ? <PublicationTaskProgress plans={planProgress} formatIssue={details}
                    openPlan={browser ? undefined : id => go("plans", id)} /> :
                    !dashboardQuery.error && <p role="status" className="publication-task-reading">
                      <LoadingIndicator label="正在读取计划状态…" />
                    </p>}
                </section>
              </td></tr>}
            </React.Fragment>;
          })}
        </tbody></table>
      </div>
      {!!dashboardQuery.error && <p role="alert" className="plan-error">
        {errorMessage(dashboardQuery.error, "读取任务失败")} <button type="button" onClick={() => void dashboardQuery.refresh()}>重试</button>
      </p>}
      {dashboardQuery.loading && <p role="status" className="publication-task-empty"><LoadingIndicator label="正在读取任务…" /></p>}
      {dashboard && !rows.length && <p role="status" className="publication-task-empty">{query || status ? "没有符合条件的任务" : "暂无任务"}</p>}
    </section>
    {editor && <PublicationTaskEditor key={editor.task?.id ?? "new"} initial={editor.task} plans={availablePlans}
      busy={busy} error={error} onSave={save} onClose={() => { setEditor(undefined); setError(""); }} />}
    {deleting && <div className="plan-modal-backdrop"><section role="dialog" aria-modal="true" aria-label="删除任务" className="plan-confirm">
      <h2>删除任务</h2><p>确认删除「{deleting.title}」？</p>
      {error && <p role="alert" className="plan-error">{error}</p>}
      <div className="plan-editor-footer"><button type="button" onClick={() => { setDeleting(undefined); setError(""); }}>取消</button>
        <button type="button" className="primary" disabled={busy} onClick={() => void act(async () => {
          await call("publicationTasks.delete", { id: deleting.id, expectedRevision: deleting.revision });
          setDeleting(undefined);
        })}>确认删除</button>
      </div></section></div>}
    {!!recordId && <div className="plan-modal-backdrop"><section role="dialog" aria-modal="true" aria-label="执行记录" className="plan-editor scroll-panel">
      <div className="section-title"><h2>执行记录</h2><button type="button" onClick={() => setRecordId("")}>关闭</button></div>
      <div className="scroll-panel-body">
      {!!historyQuery.error && <p role="alert">{errorMessage(historyQuery.error, "执行记录读取失败")}</p>}
      {historyQuery.loading && <p role="status"><LoadingIndicator label="正在读取记录…" /></p>}
      {history?.length === 0 && <p role="status">暂无执行记录</p>}
      {history?.map((run, index) => <details key={run.id} open={index === 0 ? true : undefined}>
        <summary>{localStamp(run.startedAt)} · {run.source === "manual" ? "手动" : "定时"} · {states[run.state]}</summary>
        {run.snapshot?.prepareContract !== undefined && <p>是否签署合同 · {run.snapshot.prepareContract ? "是" : "否"}</p>}
        <ol className="publication-task-log">
          {run.logs.map((log, index) => <li key={index}><time dateTime={log.at}>{localStamp(log.at)}</time>
            <span>{details(log.detail)}</span></li>)}
        </ol>
        {!browser && run.linked.length > 0 && <div className="publication-task-actions">
          {run.linked.map(link => <button type="button" key={link.id}
            onClick={() => go("plans", link.id)}>{run.plans.find(plan => plan.id === link.planId)?.title ?? "查看关联计划"}</button>)}
        </div>}
      </details>)}
      </div>
    </section></div>}
  </div>;
}
