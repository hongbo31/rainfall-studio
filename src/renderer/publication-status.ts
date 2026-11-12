import type { FanqieCatalogRow } from "../shared/fanqie-catalog";
import type { TmeObservation } from "../shared/tme-observations";

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

const fanqieStatuses = {
  contract_pending: "待授权",
  reviewing: "审核中",
  published: "已上架",
  rejected: "未通过",
  withdrawn: "已下架",
};
type FanqieState = keyof typeof fanqieStatuses;
export type FanqiePublicationJob = {
  workId: string;
  updatedAt?: string;
  state?: string;
  record?: FanqieCatalogRow;
  officialRecord?: FanqieCatalogRow;
};
const observedTmeStates = {
  submitted: "已提交",
  reviewing: "审核中",
  released: "已发行",
  rejected: "已驳回",
} as const;

type LibraryPublication = {
  target: string;
  state: FanqieState | "unknown" | "submitted";
  label: string;
  observedAt?: string;
  official: boolean;
};

export function libraryPublicationIndex(
  data: {
    publicationPipelineJobs?: PipelineJob[];
    externalTmePublications?: {
      workId: string;
      state: OfficialState;
      observedAt: string;
    }[];
    tmeObservations?: TmeObservation[];
  },
  fanqieJobs: FanqiePublicationJob[],
) {
  const index = new Map<string, Map<string, LibraryPublication>>();
  const record = (workId: string, status: LibraryPublication) => {
    const statuses = index.get(workId) ?? new Map<string, LibraryPublication>();
    const previous = statuses.get(status.target);
    const time = (value?: string) => Date.parse(value ?? "") || 0;
    if (
      !previous ||
      (status.official && !previous.official) ||
      (status.official === previous.official &&
        time(status.observedAt) >= time(previous.observedAt))
    ) {
      statuses.set(status.target, status);
      index.set(workId, statuses);
    }
  };

  for (const job of data.publicationPipelineJobs ?? []) {
    const state = pipelinePublicationState(job);
    if (state === "unpublished") continue;
    for (const target of job.targets ?? [job.target]) {
      if (target)
        record(job.workId, {
          target,
          state,
          label: publicationStates[state],
          observedAt: receiptFor(job)?.observedAt ?? job.updatedAt,
          official: state !== "unknown",
        });
    }
  }
  for (const job of fanqieJobs) {
    const receipt = job.officialRecord ?? job.record;
    // The old plan runner also stored duplicate-title matches as "existing".
    if (
      job.state === "existing" ||
      !job.workId ||
      !receipt ||
      typeof receipt.id !== "string" ||
      !/^[1-9]\d{4,24}$/.test(receipt.id)
    )
      continue;
    if (!Object.hasOwn(fanqieStatuses, receipt.stage)) continue;
    const state = receipt.stage as FanqieState;
    record(job.workId, {
      target: "fanqie",
      state,
      label: fanqieStatuses[state],
      observedAt: job.updatedAt,
      official: true,
    });
  }
  for (const receipt of data.externalTmePublications ?? []) {
    record(receipt.workId, {
      target: "tme",
      state: receipt.state,
      label: publicationStates[receipt.state],
      observedAt: receipt.observedAt,
      official: true,
    });
  }
  for (const observation of data.tmeObservations ?? []) {
    if (!Object.hasOwn(observedTmeStates, observation.status)) continue;
    const state = observation.status as keyof typeof observedTmeStates;
    record(observation.workId, {
      target: "tme",
      state: state === "released" ? "published" : state,
      label: observedTmeStates[state] + "（手工记录）",
      observedAt: observation.observedAt,
      official: false,
    });
  }
  return index;
}
