import React, { useState } from "react";
import { highestScoredLyricVersion, legacyLyricTargetScore, lyricResultVersion, type LyricJob, type LyricReviewIssue } from "../../shared/lyric-writing";
import { useStudioRequest } from "../context";
import { planExecutionMessage } from "../plan-execution-labels";
import LyricReviewNotes from "./LyricReviewNotes";

const reviewIssueLabels: Record<LyricReviewIssue, string> = {
  json: "评分结果无法解析为 JSON。",
  fields: "评分返回的字段不符合要求。",
  score: "评分分值必须是 0 到 100 的整数。",
  rubric: "五项评分需各填 0 到 20 的整数。",
  languageMatches: "语种核对字段格式错误。",
  findings: "评审意见字段格式错误。",
  revision: "评分对应的稿件版本不匹配。",
};
const textPhases: Record<LyricJob["phase"], string> = { generate: "初稿", score: "评分", rewrite: "改写", prompt: "提示词" };

export default function PlanLyricReview({ jobId }: { jobId: string }) {
  const call = useStudioRequest();
  const [job, setJob] = useState<LyricJob | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const selected = job && (job.resultVersionId ? lyricResultVersion(job) : highestScoredLyricVersion(job.versions));
  const textIssue = job?.textIssue;

  const load = async () => {
    if (loading || job) return;
    setLoading(true);
    setError(false);
    try { setJob(await call("lyricWriting.read", { id: jobId })); }
    catch { setError(true); }
    finally { setLoading(false); }
  };

  return <details className="plan-lyric-review" onToggle={event => {
    if (event.target === event.currentTarget && event.currentTarget.open) void load();
  }}>
    <summary>查看作词评分</summary>
    {loading && <p role="status">正在读取评分…</p>}
    {error && <p role="alert">暂时无法读取评分。收起再展开可重试。</p>}
    {job && <>
      {job.reviewIssue && <p>{reviewIssueLabels[job.reviewIssue]}</p>}
      {textIssue && <p>最近一次模型异常 · {textPhases[textIssue.phase]} · {planExecutionMessage(textIssue.reason)}
        {textIssue.httpStatus !== null && ` · HTTP ${textIssue.httpStatus}`}
        {textIssue.finishReason && ` · ${textIssue.finishReason}`}
        {textIssue.httpStatus === 200 && !textIssue.hasReceipt && textIssue.reason !== "TEXT_RESPONSE_RECEIPT_MISSING" && " · 缺少回执编号"}
        {textIssue.completionTokens !== null && ` · 输出 ${textIssue.completionTokens}${textIssue.maxOutputTokens ? `/${textIssue.maxOutputTokens}` : ""} token`}
      </p>}
      {selected?.review ? <p>《{selected.title}》 · {job.state === "complete" ? "采用稿" : "最高分稿"} {selected.review.score} 分 · 目标 {job.targetScore ?? legacyLyricTargetScore} 分 · 改写 {job.rewrites}/{job.maxRewrites} 次</p>
        : <p>本次暂无评分记录。</p>}
      {job.versions.map((version, index) => {
        if (!version.review) return version.reviewIssue
          ? <p key={version.id}>第 {index + 1} 稿 · {reviewIssueLabels[version.reviewIssue]}</p>
          : null;
        return <details key={version.id} open={version.id === selected?.id}>
          <summary>第 {index + 1} 稿 · {version.review.score} 分{version.review.languageMatches ? "" : " · 语种不符"}</summary>
          <LyricReviewNotes review={version.review} />
        </details>;
      })}
    </>}
  </details>;
}
