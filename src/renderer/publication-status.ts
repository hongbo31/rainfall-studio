export const publicationStates = {
  unpublished: "未发布",
  reviewing: "审核中",
  published: "已发布",
  rejected: "已拒绝",
  unknown: "待核对",
};

type OfficialState = "reviewing" | "published" | "rejected";
type PipelineJob = {
  workId: string;
  targets?: string[];
  target?: string;
  state: string;
  updatedAt?: string;
  receipt?: { source: string; observedAt?: string };
  task?: { receipt?: PipelineJob["receipt"] };
};
const officialState = (state: string): state is OfficialState =>
  state === "reviewing" || state === "published" || state === "rejected";
const receiptFor = (job: PipelineJob) => (job.task ?? job).receipt;

export function pipelinePublicationState(
  job?: PipelineJob,
): keyof typeof publicationStates {
  if (!job) return "unpublished";
  if (officialState(job.state)) {
    const source = receiptFor(job)?.source;
    return source === "official" || source === "official-tencent-review-record"
      ? job.state
      : "unknown";
  }
  return job.state === "reconcile_required" || job.state === "unknown"
    ? "unknown"
    : "unpublished";
}

export function publicationState(
  data: { publicationPipelineJobs?: PipelineJob[] },
  workId: string,
  target: string,
) {
  return pipelinePublicationState(
    data.publicationPipelineJobs?.findLast(
      (job) =>
        job.workId === workId && (job.targets ?? [job.target]).includes(target),
    ),
  );
}
