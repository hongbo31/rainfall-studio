import React, { useState } from "react";
import type { PublicationExecution, PublicationPlan, PublicationTask, PublicationTaskInput } from "../../shared/publication-tasks";
import PublicationPlanPicker from "./PublicationPlanPicker";
import LoadingIndicator from "./LoadingIndicator";

export const weekDays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
type Scheduled = Extract<PublicationExecution, { kind: "scheduled" }>;
const defaults: Record<Scheduled["unit"], Scheduled> = {
  hour: { kind: "scheduled", unit: "hour", minute: 0 },
  day: { kind: "scheduled", unit: "day", localTime: "09:00" },
  week: { kind: "scheduled", unit: "week", weekday: 1, localTime: "09:00" },
  month: { kind: "scheduled", unit: "month", day: 1, localTime: "09:00" },
};
export function publicationExecutionLabel(execution: PublicationExecution) {
  if (execution.kind === "manual") return "手动";
  switch (execution.unit) {
    case "hour": return `每小时 ${String(execution.minute).padStart(2, "0")} 分`;
    case "day": return `每天 ${execution.localTime}`;
    case "week": return `每${weekDays[execution.weekday - 1]} ${execution.localTime}`;
    case "month": return `每月 ${execution.day} 日 ${execution.localTime}`;
  }
}

export default function PublicationTaskEditor({ initial, plans, busy, error, onSave, onClose }: {
  initial?: PublicationTask;
  plans: PublicationPlan[];
  busy: boolean;
  error?: string;
  onSave: (task: PublicationTaskInput) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [execution, setExecution] = useState<PublicationExecution>(initial?.execution ?? { kind: "manual" });
  const [planIds, setPlanIds] = useState(initial?.steps[0].planIds ?? []);
  const [pickingPlans, setPickingPlans] = useState(false);
  const [consent, setConsent] = useState(!!initial?.consent && !initial.steps[1]);
  const [prepareContract, setPrepareContract] = useState(initial ? initial.prepareContract ?? true : undefined);
  const updateExecution = (next: PublicationExecution) => { setExecution(next); setConsent(false); };
  const ready = !!title.trim() && planIds.length > 0 && planIds.every(id => plans.some(plan => plan.id === id)) && consent && prepareContract !== undefined &&
    (execution.kind !== "scheduled" || execution.unit === "hour" || !!execution.localTime);
  return <div className="plan-modal-backdrop"><section className="plan-editor scroll-panel" role="dialog" aria-modal="true" aria-labelledby="publication-task-editor">
    <div className="section-title"><h2 id="publication-task-editor">{initial ? "编辑任务" : "新建任务"}</h2>
      <button type="button" onClick={onClose}>关闭</button></div>
    <form className="scroll-panel-body" onSubmit={event => {
      event.preventDefault();
      if (!ready || busy) return;
      onSave({ id: initial?.id ?? crypto.randomUUID(), title, execution, consent: true, prepareContract,
        steps: [{ kind: "plans", planIds }] });
    }}>
      <div className="form-grid">
        <label>任务名称<input required maxLength={120} value={title} onChange={event => setTitle(event.target.value)} /></label>
        <label>执行方式<select value={execution.kind} onChange={event => updateExecution(event.target.value === "scheduled" ? defaults.day : { kind: "manual" })}>
          <option value="manual">手动</option><option value="scheduled">定时</option>
        </select></label>
        {execution.kind === "scheduled" && <label>执行周期<select value={execution.unit} onChange={event => updateExecution(defaults[event.target.value as Scheduled["unit"]])}>
          <option value="hour">按小时</option><option value="day">按天</option><option value="week">按周</option><option value="month">按月</option>
        </select></label>}
        {execution.kind === "scheduled" && (execution.unit === "hour" ?
          <label>每小时的分钟<select value={execution.minute} onChange={e => updateExecution({ ...execution, minute: Number(e.target.value) })}>
            {Array.from({ length: 60 }, (_, minute) => <option key={minute} value={minute}>{minute} 分</option>)}
          </select></label> :
          <label>执行时间（北京时间）<input required type="time" value={execution.localTime} onChange={e => updateExecution({ ...execution, localTime: e.target.value })} /></label>)}
        {execution.kind === "scheduled" && execution.unit === "week" && <label>星期<select value={execution.weekday} onChange={e => updateExecution({ ...execution, weekday: Number(e.target.value) })}>
          {weekDays.map((day, index) => <option key={day} value={index + 1}>{day}</option>)}
        </select></label>}
        {execution.kind === "scheduled" && execution.unit === "month" && <label>执行日期<select value={execution.day} onChange={e => updateExecution({ ...execution, day: Number(e.target.value) })}>
          {Array.from({ length: 31 }, (_, index) => <option key={index} value={index + 1}>{index + 1} 日</option>)}
        </select><small>当月没有该日期时，月底执行。</small></label>}
        <label>是否签署合同<select aria-label="是否签署合同" aria-describedby="task-contract-detail"
          required value={prepareContract === undefined ? "" : prepareContract ? "yes" : "no"}
          onChange={event => { setPrepareContract(event.target.value === "yes"); setConsent(false); }}>
          <option value="" disabled>请选择</option><option value="yes">是</option><option value="no">否</option>
        </select>{prepareContract !== undefined && <small id="task-contract-detail">{prepareContract
          ? "番茄目录发布在官网签署确认后继续。"
          : "番茄目录发布生成待签合同后继续。"}</small>}</label>
      </div>
      <fieldset><legend>关联计划</legend>
        <button type="button" aria-haspopup="dialog" disabled={busy} onClick={() => setPickingPlans(true)}>选择关联计划</button>
        {planIds.length ? <ol className="publication-plan-summary" aria-label="计划执行顺序">
          {planIds.map(id => <li key={id}>{plans.find(plan => plan.id === id)?.title ?? "不可用计划"}</li>)}
        </ol> : <span className="muted publication-plan-placeholder">尚未选择计划</span>}
      </fieldset>
      <label className="check"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
        同意按顺序执行关联计划及其发布步骤。API 调用按配置计费，平台条款需本人确认。
      </label>
      {error && <p role="alert" className="plan-error">{error}</p>}
      <div className="plan-editor-footer"><button type="button" onClick={onClose}>取消</button>
        <button className="primary" type="submit" disabled={busy || !ready} aria-busy={busy}>
          {busy ? <LoadingIndicator label="正在保存…" /> : "保存任务"}
        </button></div>
    </form>
  </section>
    {pickingPlans && <PublicationPlanPicker plans={plans} initialIds={planIds} onClose={() => setPickingPlans(false)}
      onConfirm={ids => {
        if (ids.length !== planIds.length || ids.some((id, index) => id !== planIds[index])) {
          setPlanIds(ids);
          setConsent(false);
        }
        setPickingPlans(false);
      }} />}
  </div>;
}
