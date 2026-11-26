import React from "react";
import type { PublicationPlanProgress, PublicationPlanStage } from "../../shared/publication-tasks";
import { names, useStudio } from "../context";
import { musicAssetProgressLabel, needsOutcomeCheck, noStageReason, planExecutionMessage, planStageLabels, planStageStatus,
  showsStageDiagnostics, textProviderCreditsRequired } from "../plan-execution-labels";

const planStates: Record<PublicationPlanProgress["state"], string> = {
  pending: "未执行", queued: "排队中", running: "执行中", waiting: "等待中", blocked: "待处理",
  stopping: "停止中", stopped: "已停止", completed: "已完成", failed: "失败", skipped: "未执行",
};
const stageLabel = (stage: PublicationPlanStage) => stage.stage === "publication"
  ? (names[stage.platform] ?? stage.platform) + "发布" : planStageLabels[stage.stage] ?? stage.stage;
const shortTime = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const stageTime = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const runSources: Record<NonNullable<PublicationPlanProgress["source"]>, string> = {
  manual: "手动执行", debug: "调试执行", scheduled: "定时执行", directory: "目录执行", publication_task: "任务中心执行",
};

export default function PublicationTaskProgress({ plans, formatIssue, openPlan }: {
  plans: PublicationPlanProgress[];
  formatIssue: (code: string) => string;
  openPlan?: (runId: string) => void;
}) {
  const { go } = useStudio();
  return <ol className="publication-task-plan-list">
    {plans.map(plan => {
      const steps = plan.items.flatMap(item => item.stages);
      const creditsStage = steps.find(step => step.reason === textProviderCreditsRequired);
      const creditsRequired = !!creditsStage || plan.reason === textProviderCreditsRequired ||
        plan.items.some(item => item.reason === textProviderCreditsRequired);
      const active = ["running", "waiting", "blocked"].includes(plan.state);
      const checkStage = steps.find(step => needsOutcomeCheck(step.state, step.reason) || step.reason === "TEXT_USAGE_UNKNOWN");
      const checkPlan = !creditsRequired && (!!checkStage || needsOutcomeCheck(plan.state, plan.reason) || plan.reason === "TEXT_USAGE_UNKNOWN");
      const stage = creditsRequired ? creditsStage : checkStage ?? (plan.reason ? steps.find(step => step.reason === plan.reason) :
        active ? steps.find(step => ["dispatching", "waiting", "submitted", "reviewing"].includes(step.state)) : undefined);
      const assetProgress = stage && stage.stage === "music_assets" && musicAssetProgressLabel(stage.reason);
      const statusState = stage?.state ?? plan.state;
      const statusReason = creditsRequired ? textProviderCreditsRequired : stage ? stage.reason : plan.reason;
      const stageStatus = planStageStatus(statusState, statusReason, stage?.stage);
      const showStageStatus = stageStatus !== planExecutionMessage(statusState);
      const issue = plan.reason && formatIssue(plan.reason);
      const missingPlanReason = !creditsRequired && !checkPlan && !plan.reason && ["blocked", "failed"].includes(plan.state);
      const detail = [
        stage && stageLabel(stage),
        (checkPlan ? stageStatus : assetProgress) || (showStageStatus && stageStatus) || issue || (missingPlanReason && noStageReason),
      ].filter(Boolean).join(" · ");
      const { runId } = plan;
      const sourceLabel = plan.source && runSources[plan.source];
      return <li key={plan.planId}>
        <article className="publication-plan-card" aria-label={plan.title} data-state={plan.state}>
          <div className="publication-plan-card-head">
            <h4>{plan.title}</h4>
            <span className="publication-task-state" data-state={plan.state}>{planStates[plan.state]}</span>
            {plan.owned === true && <span className="publication-plan-following">本任务创建</span>}
            {plan.owned === false && <span className="publication-plan-following">沿用已有执行</span>}
            {runId && <span className="publication-plan-following">{sourceLabel ? `来源：${sourceLabel}` : "来源未记录"}</span>}
            {plan.items.length > 0 && <span className="publication-plan-following">已记录 {plan.items.length} 项</span>}
            {plan.updatedAt && Number.isFinite(Date.parse(plan.updatedAt)) &&
              <time dateTime={plan.updatedAt} title="本地记录更新时间">{shortTime.format(new Date(plan.updatedAt))}</time>}
          </div>
          {detail && <p className="publication-plan-reason" data-kind={checkPlan ? "check" : creditsRequired ? "credits" : undefined}>
            {detail}
          </p>}
          {creditsRequired && <button type="button" className="publication-plan-config"
            onClick={() => go("accounts", "models")}>
            核对文本 API 余额与配置
          </button>}
          {(plan.items.length > 0 || runId && openPlan) && <div className="publication-plan-card-actions">
            {plan.items.length > 0 && <details className="publication-plan-stages">
              <summary>阶段明细</summary>
              {plan.items.map(item => <div className="publication-plan-item" key={item.id}>
                <div className="publication-plan-item-head">
                  <strong>{item.title || `第 ${item.ordinal} 轮`}</strong>
                  <span>{item.reason === textProviderCreditsRequired ? planStageStatus(item.state, item.reason) : planExecutionMessage(item.state)}</span>
                </div>
                {item.reason && item.reason !== plan.reason && !item.stages.some(step => step.reason === item.reason) &&
                  <p>{formatIssue(item.reason)}</p>}
                {item.stages.length > 0 && <ul className="publication-plan-stage-list">
                  {item.stages.map(step => {
                    const progress = step.stage === "music_assets" && step.state === "waiting" && musicAssetProgressLabel(step.reason);
                    return <li key={step.id} data-state={step.state}>
                      <span>{stageLabel(step)}</span><span>{progress || planStageStatus(step.state, step.reason, step.stage)}</span>
                      {!progress && step.reason && (step.reason !== plan.reason || checkPlan || showStageStatus && !creditsRequired) &&
                        <small>{formatIssue(step.reason)}</small>}
                      {!step.reason && showsStageDiagnostics(step.state) && <small>{noStageReason}</small>}
                      <small>本地记录更新 {step.updatedAt && Number.isFinite(Date.parse(step.updatedAt))
                        ? <time dateTime={step.updatedAt} title="北京时间">{stageTime.format(new Date(step.updatedAt))}</time> : "未记录"}</small>
                      <small>{step.stage === "publication" ? "投稿 ID" : "外部任务 ID"} {step.externalIdHint ?? "未记录"}</small>
                    </li>;
                  })}
                </ul>}
              </div>)}
            </details>}
            {runId && openPlan && <button type="button" className="publication-plan-open" onClick={() => openPlan(runId)}>
              {checkPlan ? "查看核对详情" : "查看执行"}
            </button>}
          </div>}
        </article>
      </li>;
    })}
  </ol>;
}
