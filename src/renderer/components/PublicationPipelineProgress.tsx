import PublicationBrowserConnection from "./PublicationBrowserConnection";
import React, { useState } from "react";
import { Badge, names } from "../context";
import type { PlatformTarget } from "../../shared/platform-config";
import TmeAiSubmissionWorkspace from "./TmeAiSubmissionWorkspace";
import TmeAiPrepareWorkspace from "./TmeAiPrepareWorkspace";
import PublicationMetadataForm, {
  metadataLocked,
} from "./PublicationMetadataForm";

const states: Record<string, string> = {
  needs_configuration: "待配置账号",
  needs_materials: "待补材料",
  queued: "等待准备",
  preparing: "正在准备官网材料",
  awaiting_authorization: "待确认材料准备",
  awaiting_confirmation: "待确认条款并提交",
  blocked: "已暂停",
  reconcile_required: "结果待核对，请勿重复提交",
  reviewing: "官方审核中",
  published: "官方已发布",
  rejected: "官方已驳回",
};
const actionableReasons: Record<string, string> = {
  TME_TARGET_MATERIALS_CONFLICT: "QQ 与酷狗的投稿资料不同，请统一配置后重试。",
  WINDOWS_REQUIRED: "请在 Windows 客户端继续准备官网材料。",
  AI_PREPARATION_NOT_APPLICABLE: "此歌曲需走原创投稿，不能使用 AI 授权流程。",
  PLATFORM_EXECUTOR_UNAVAILABLE: "此平台尚未接通投稿。",
  PROTECTED_PUBLISHED_WORK: "此作品已由你提交，请查看官网原审核记录。",
  PREPARATION_INTERRUPTED: "准备曾中断，请先核对官网现有材料。",
  CLOUD_PREPARE_CONTRACT_UNVERIFIED: "官网上传步骤尚待校准，材料已保留。",
  CLOUD_BROWSER_SESSION_REQUIRED: "请先连接已登录的腾讯音乐页面。",
  SUBMISSION_ALREADY_DISPATCHED: "已有提交记录，请先核对官方回执。",
};
export default function PublicationPipelineProgress({
  jobs,
  data,
  onRefresh,
  onTrack,
  onConfigure,
  onReconcile,
}: {
  jobs: any[];
  data: any;
  onRefresh: () => Promise<void>;
  onTrack: (workId: string) => void;
  onConfigure: (target: PlatformTarget) => void;
  onReconcile?: (id: string) => Promise<unknown>;
}) {
  const [error, setError] = useState("");
  return (
    <section className="panel simple-request-list" aria-label="发布进度">
      <div className="section-title">
        <h2>发布进度</h2>
        {data.mode === "production" && <PublicationBrowserConnection />}
        <button
          onClick={() =>
            void onRefresh()
              .then(() => setError(""))
              .catch(() => setError("刷新失败，请稍后重试"))
          }
        >
          刷新进度
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {jobs.map((job) => (
        <article
          className="simple-request"
          key={job.id}
          data-pipeline-id={job.id}
        >
          <div className="simple-request-heading">
            <b>
              {job.title} ·{" "}
              {(job.targets ?? [])
                .map((target: string) => names[target] ?? target)
                .join(" / ")}
            </b>
            <Badge>
              {["reviewing", "published", "rejected"].includes(job.state) &&
              !job.receipt
                ? "官方回执待核对"
                : (states[job.state] ?? "状态待核对")}
            </Badge>
          </div>
          {job.reason && actionableReasons[job.reason] && (
            <p role="status">{actionableReasons[job.reason]}</p>
          )}
          {job.reason?.startsWith("TME_AI_METADATA_REQUIRED") && (
            <p role="status">
              请展开投稿资料，补齐署名、权属、AI 工具与生成日期。
            </p>
          )}
          {!metadataLocked(job) &&
            (job.targets ?? []).some((target: string) =>
              ["qqmusic", "kugou"].includes(target),
            ) &&
            (data.works ?? []).some((work: any) => work.id === job.workId) && (
              <PublicationMetadataForm
                key={`${job.id}:${job.workId}:${job.accountId ?? ""}`}
                work={data.works.find((work: any) => work.id === job.workId)}
                data={data}
                job={job}
              />
            )}
          {job.state === "reconcile_required" && onReconcile && (
            <button
              onClick={() =>
                void onReconcile(job.id)
                  .then(() => onRefresh())
                  .catch(() =>
                    setError("尚未核实结果，保留原记录；请查看诊断。"),
                  )
              }
            >
              核对官网结果
            </button>
          )}
          {job.state === "needs_materials" && (
            <button onClick={() => onTrack(job.workId)}>补齐素材</button>
          )}
          {job.state === "needs_configuration" && (
            <button onClick={() => onConfigure(job.targets[0])}>
              配置账号
            </button>
          )}
          {(job.state === "awaiting_authorization" || (!job.dispatchedAt && job.state === "blocked" && (job.targets ?? []).some((t:string) => ["qqmusic","kugou"].includes(t)) && !["PROTECTED_PUBLISHED_WORK","AI_PREPARATION_NOT_APPLICABLE"].includes(job.reason))) && (
            <TmeAiPrepareWorkspace
              compact
              key={job.workId}
              data={data}
              initialWorkId={job.workId}
              notify={() =>
                void onRefresh().catch(() => setError("刷新失败，请稍后重试"))
              }
            />
          )}
          {[
            "awaiting_confirmation",
            "reconcile_required",
            "reviewing",
            "published",
            "rejected",
          ].includes(job.state) && (
            <TmeAiSubmissionWorkspace
              key={`${job.workId}:${job.state}:${job.submissionJobId ?? ""}`}
              data={data}
              initialWorkId={job.workId}
              expanded={
                job.state === "awaiting_confirmation" ||
                job.state === "reconcile_required"
              }
            />
          )}
          {job.reason && (
            <details>
              <summary>诊断</summary>
              <p>{job.reason}</p>
            </details>
          )}
        </article>
      ))}
    </section>
  );
}
