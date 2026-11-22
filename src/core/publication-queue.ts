import { randomUUID } from "node:crypto";
import type { PublicationDispatch } from "../shared/publication-tasks";
import type { PlanWorkflowPublicationTarget } from "../shared/plan-center";
import { pendingFanqieContractId } from "../shared/fanqie-catalog";
import { publicationWorkflowHandler } from "../shared/platform-directory";
import { archivePublicationDownloads } from "./download-archive";
import { resolveFanqieWork } from "./fanqie-work";
import { planFanqieBatchSettled, planFanqieJobs } from "./plan-fanqie";
import { publicationOwnerActive } from "./publication-tasks";
import { publishSimple } from "./simple-publication";
import type { Studio } from "./studio";
import { unifiedPublicationService } from "./unified-publication-integration";

export function observeDispatch(s: Studio, dispatch: PublicationDispatch, prepareContract?: boolean, continueAfterContract = false) {
  const qq = dispatch.tmeIds.length ? unifiedPublicationService(s).list().filter(job => dispatch.tmeIds.includes(job.id)) : [];
  const allFanqie = dispatch.fanqieIds.length ? planFanqieJobs(s) : [];
  const fanqie = allFanqie.filter(job => dispatch.fanqieIds.includes(job.id));
  if (qq.length !== dispatch.tmeIds.length || fanqie.length !== dispatch.fanqieIds.length) {
    return { state: "failed" as const, detail: "PUBLICATION_QUEUE_RECORD_MISSING" };
  }
  if (qq.some(job => job.state === "rejected") || fanqie.some(job => job.record?.stage === "rejected")) {
    return { state: "failed" as const, detail: "平台审核未通过" };
  }
  const tmeAction = qq.find(job => ["awaiting_authorization", "awaiting_confirmation", "reconcile_required", "blocked", "needs_configuration", "needs_materials"].includes(job.state));
  if (tmeAction) return { state: "action_required" as const, detail: [tmeAction.title, tmeAction.summary, tmeAction.reason].filter(Boolean).join(" · ") };
  const uploadedWithoutContract = (job: { state: string; record?: { stage?: string } }) =>
    prepareContract === false && job.state === "uploaded" && job.record?.stage === "contract_pending";
  const acceptDraft = prepareContract === undefined && continueAfterContract;
  const generatedBatches = new Set<string>();
  if (acceptDraft) {
    for (const batchId of new Set(fanqie.filter(job => pendingFanqieContractId(job.record)).map(job => job.runId))) {
      if (planFanqieBatchSettled(allFanqie.filter(job => job.runId === batchId), true)) generatedBatches.add(batchId);
    }
  }
  const hasGeneratedContract = (job: typeof fanqie[number]) => job.state === "uploaded" &&
    generatedBatches.has(job.runId) && !!pendingFanqieContractId(job.record);
  const fanqieAction = fanqie.find(job => ["blocked", "unknown"].includes(job.state) ||
    job.state === "uploaded" && !uploadedWithoutContract(job) && !hasGeneratedContract(job) &&
      !["reviewing", "published"].includes(job.record?.stage));
  if (fanqieAction) {
    const title = s.repo.maybe("works", fanqieAction.workId)?.title ?? "番茄音乐";
    return { state: "action_required" as const, detail: title + " · " +
      (fanqieAction.reason ?? (fanqieAction.record?.stage === "contract_pending"
        ? acceptDraft ? "待核对番茄合同生成结果" : "待签署番茄合同"
        : "待核对平台收件")) };
  }
  const submitted = qq.filter(job => ["reviewing", "published"].includes(job.state)).length +
    fanqie.filter(job => ["uploaded", "existing"].includes(job.state) && ["reviewing", "published"].includes(job.record?.stage)).length;
  const total = qq.length + fanqie.length;
  const unsignedUploads = fanqie.filter(uploadedWithoutContract).length;
  const generatedContracts = fanqie.filter(hasGeneratedContract).length;
  if (total && submitted + unsignedUploads + generatedContracts === total) return {
    state: "completed" as const, unsignedUploads: unsignedUploads + generatedContracts,
    detail: [
      unsignedUploads ? `番茄已上传 ${unsignedUploads} 项并跳过签约` : "",
      generatedContracts ? `番茄已生成待签合同，涉及 ${generatedContracts} 首` : "",
      submitted ? `平台已接收 ${submitted} 项投稿` : "",
    ].filter(Boolean).join(" · "),
  };
  return { state: "running" as const, detail: `正在上传及发布 · 平台已接收 ${submitted}/${total}` };
}

export function queuePublications(s: Studio, step: { targets: readonly PlanWorkflowPublicationTarget[]; useVersionMetadata?: true; prepareContract?: boolean },
  workIds: string[], ownerId: string): PublicationDispatch {
  const tme = step.targets.filter(target => publicationWorkflowHandler(target.platform) === "tme");
  const fanqie = step.targets.find(target => publicationWorkflowHandler(target.platform) === "fanqie");
  const fanqieIds: string[] = [];
  if (fanqie) {
    if (!fanqie.accountKey || !fanqie.configurationHash) throw Error("WORKFLOW_FANQIE_ACCOUNT_REQUIRED");
    const previous = planFanqieJobs(s);
    const sources = workIds.flatMap(workId => {
      const work = s.repo.get("works", workId);
      const variant = work.selectedAudioVariant === "B" ? "B" : "A";
      const existing = previous.find(job => job.workId === workId && job.variant === variant &&
        job.accountKey === fanqie.accountKey && (["dispatching", "uploaded", "existing", "unknown"].includes(job.state) ||
          job.state === "ready" && (!!job.publicationRunId && publicationOwnerActive(s.repo, job.publicationRunId))));
      if (existing) { fanqieIds.push(existing.id); return []; }
      const selection = { workId, variant, ...(step.useVersionMetadata ? { useVersionMetadata: step.useVersionMetadata } : {}) };
      return [{ ...selection, fingerprint: resolveFanqieWork(s, selection).fingerprint }];
    });
    archivePublicationDownloads(s, sources.map(source => ({ workId: source.workId, accountId: fanqie.accountId })));
    const limit = Math.min(fanqie.fanqieBatch?.limit ?? 20, 20);
    const continueAfterContract = step.prepareContract === undefined && fanqie.fanqieBatch?.signContract === false;
    let previousBatchId: string | undefined;
    for (let offset = 0; offset < sources.length; offset += limit) {
      const batchId = randomUUID(), items = sources.slice(offset, offset + limit);
      items.forEach((source, index) => {
        const id = batchId + ":" + source.workId;
        fanqieIds.push(id);
        s.repo.save("settings", { id: "plan-fanqie:" + id, value: {
          id, runId: batchId, publicationRunId: ownerId, ...source, batchSize: items.length, ordinal: index + 1,
          accountId: fanqie.accountId, accountKey: fanqie.accountKey, configurationHash: fanqie.configurationHash,
          prepareContract: step.prepareContract,
          ...(previousBatchId ? { previousBatchId } : {}),
          ...(continueAfterContract ? { continueAfterContract: true } : {}),
          state: "ready", createdAt: s.now().toISOString(),
        } });
      });
      if (fanqie.fanqieBatch) previousBatchId = batchId;
    }
  }
  const tmeIds = tme.length ? publishSimple(s, {
    workIds, targets: tme.map(target => target.platform),
    accountOverrides: Object.fromEntries(tme.map(target => [target.platform, target.accountId])),
  }, true, ownerId).pipeline.map(job => job.id as string) : [];
  return { tmeIds: [...new Set(tmeIds)], fanqieIds };
}

