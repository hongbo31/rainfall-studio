import React from 'react';
const phases:Record<string,string>={generate:'生成歌词与提示词',score:'模型评分',rewrite:'按评分修改'};
const states:Record<string,string>={ready:'等待执行',dispatching:'执行中',complete:'文本已完成',rejected:'文本未通过',unknown:'结果未知，等待核对',stopped:'已停止',blocked:'等待处理'};
const reasons:Record<string,string>={CREDENTIAL_REQUIRED:'请在设置中保存此配置的 API Key',TEXT_PROFILE_REQUIRED:'请选择文本配置',TEXT_PRICE_REQUIRED:'请在设置中补全该模型的价格依据',TEXT_BUDGET_INSUFFICIENT:'本次文本额度不足',TEXT_PROFILE_REVISION_CHANGED:'文本配置已更新，请核对计划配置',TEXT_PLAN_REVISION_CHANGED:'计划已更新，请核对本次任务',TEXT_OUTCOME_UNKNOWN:'原请求结果未知，不会自动重发',TEXT_PROCESS_INTERRUPTED:'进程已中断，原请求需要核对',TEXT_SCORE_BELOW_THRESHOLD:'评分未达到计划阈值',TEXT_STOP_REQUESTED:'本次任务已停止'};
export default function ProviderPlanStatus({status}:{status?:{id:string;phase:string;state:string;reason?:string|null;currency:string;spentMicros:number;reservedMicros:number}}){
 if(!status)return null;
 return <div className="plan-execution-summary" aria-label="文本提供商执行状态"><strong>{phases[status.phase]??status.phase} · {states[status.state]??status.state}</strong>{status.reason&&<p role="status">{reasons[status.reason]??status.reason}</p>}<p className="muted">已计 {status.currency} {(status.spentMicros/1e6).toFixed(6)} · 预留 {(status.reservedMicros/1e6).toFixed(6)}</p></div>;
}
