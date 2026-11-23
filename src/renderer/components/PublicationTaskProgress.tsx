import React from "react";
import type { PublicationPlanProgress, PublicationPlanStage } from "../../shared/publication-tasks";
import { names } from "../context";
import { musicAssetProgressLabel, planExecutionMessage, planStageLabels } from "../plan-execution-labels";

const planStates: Record<PublicationPlanProgress["state"], string> = {
  pending: "未执行", queued: "排队中", running: "执行中", waiting: "等待中", blocked: "待处理",
  stopping: "停止中", stopped: "已停止", completed: "已完成", failed: "失败", skipped: "未执行",
};
const stageLabel = (stage: PublicationPlanStage) => stage.stage === "publication"
  ? (names[stage.platform] ?? stage.platform) + "发布" : planStageLabels[stage.stage] ?? stage.stage;
const shortTime = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export default function PublicationTaskProgress({ plans, formatIssue, openPlan }: {
  plans: PublicationPlanProgress[];
  formatIssue: (code: string) => string;
  openPlan?: (runId: string) => void;
}) {
  return <ol className="publication-task-plan-list">
    {plans.map(plan => {
      const steps = plan.items.flatMap(item => item.stages);
      const active = ["running", "waiting", "blocked"].includes(plan.state);
      const stage = plan.reason ? steps.find(step => step.reason === plan.reason) :
        active && steps.find(step => ["dispatching", "waiting", "unknown"].includes(step.state));
      const assetProgress = stage && stage.stage === "music_assets" && musicAssetProgressLabel(stage.reason);
      const detail = [stage && stageLabel(stage), assetProgress || (plan.reason && formatIssue(plan.reason))].filter(Boolean).join(" · ");
      const { runId } = plan;
      return <li key={plan.planId}>
        <article className="publication-plan-card" aria-label={plan.title} data-state={plan.state}>
          <div className="publication-plan-card-head">
            <h4>{plan.title}</h4>
            <span className="publication-task-state" data-state={plan.state}>{planStates[plan.state]}</span>
            {plan.owned === false && <span className="publication-plan-following">沿用已有执行</span>}
            {plan.updatedAt && <time dateTime={plan.updatedAt} title="状态更新时间">{shortTime.format(new Date(plan.updatedAt))}</time>}
          </div>
          {detail && <p className="publication-plan-reason">{detail}</p>}
          {(plan.items.length > 0 || runId && openPlan) && <div className="publication-plan-card-actions">
            {plan.items.length > 0 && <details className="publication-plan-stages">
              <summary>阶段明细</summary>
              {plan.items.map(item => <div className="publication-plan-item" key={item.id}>
                <div className="publication-plan-item-head">
                  <strong>{item.title || `第 ${item.ordinal} 轮`}</strong>
                  <span>{planExecutionMessage(item.state)}</span>
                </div>
                {item.reason && item.reason !== plan.reason && !item.stages.some(step => step.reason === item.reason) &&
                  <p>{formatIssue(item.reason)}</p>}
                {item.stages.length > 0 && <ul className="publication-plan-stage-list">
                  {item.stages.map(step => {
                    const progress = step.stage === "music_assets" && step.state === "waiting" && musicAssetProgressLabel(step.reason);
                    return <li key={step.id} data-state={step.state}>
                      <span>{stageLabel(step)}</span><span>{progress || planExecutionMessage(step.state)}</span>
                      {!progress && step.reason && step.reason !== plan.reason && <small>{formatIssue(step.reason)}</small>}
                    </li>;
                  })}
                </ul>}
              </div>)}
            </details>}
            {runId && openPlan && <button type="button" className="publication-plan-open" onClick={() => openPlan(runId)}>
              查看执行
            </button>}
          </div>}
        </article>
      </li>;
    })}
  </ol>;
}
