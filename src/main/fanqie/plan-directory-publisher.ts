import type { FanqieDownloadBatch } from "../../shared/fanqie-downloads";
import type { PlanWorkflowPublicationTarget } from "../../shared/plan-center";
import type { FanqieUploadBroker } from "./upload-broker";

type Job = {
  id: string;
  state: "running" | "waiting";
  target: PlanWorkflowPublicationTarget;
  reconcile: boolean;
  prepareContract?: boolean;
};
type Options = {
  rpc: (method: string, input?: unknown) => Promise<any>;
  forAccount: (id: string) => Promise<Pick<FanqieUploadBroker, "publishPlanDirectory">>;
  available: () => boolean;
  generation: () => number;
};
const emptyReason = "FANQIE_DOWNLOADS_EMPTY";
const failedReason = "FANQIE_DIRECTORY_RUN_FAILED";
const cleanupPending = "FANQIE_DOWNLOAD_CLEANUP_PENDING";
const reasonOf = (error: unknown) => error instanceof Error && /^[A-Z0-9_]{1,120}$/.test(error.message)
  ? error.message : failedReason;

function outcome(batch: FanqieDownloadBatch) {
  if (batch.state === "awaiting_signature" && !batch.issue)
    return { state: "waiting", reason: batch.preferences?.signContract === false
      ? "FANQIE_DIRECTORY_CONTRACT_GENERATION_PENDING" : "FANQIE_DIRECTORY_CONTRACT_PENDING" };
  if (batch.state !== "complete")
    return { state: "blocked", reason: batch.issue ?? "FANQIE_RECONCILIATION_REQUIRED" };
  const issue = batch.issue ?? batch.items.find(item => item.state === "failed")?.issue;
  if (issue || batch.items.some(item => item.state === "failed"))
    return { state: "failed", reason: issue ?? failedReason };
  return batch.items.some(item => item.state === "uploaded")
    ? { state: "completed", reason: batch.cleanupPending ? cleanupPending : undefined }
    : { state: "stopped", reason: emptyReason };
}

/** Local publication uses the account's directory uploader and its original receipt journal. */
export function createPlanFanqieDirectoryPublisher(options: Options) {
  let busy = false;
  let recovering = false;
  const call = async (action: string, input: unknown = {}) => {
    const result = await options.rpc("internal.planFanqieDirectory." + action, input);
    if (!result.ok) throw Error(result.error?.code ?? failedReason);
    return result.value;
  };
  async function retryCleanup(input: unknown) {
    if (!options.available()) throw Error("PRODUCTION_REQUIRED");
    const generation = options.generation();
    const check = async () => {
      if (!options.available() || generation !== options.generation()) throw Error("WORKSPACE_CHANGED");
    };
    const { id, target }: Pick<Job, "id" | "target"> = await call("cleanupScope", input);
    await check();
    const upload = await options.forAccount(target.accountId);
    const { accountKey, configurationHash } = target;
    const batch = await upload.publishPlanDirectory({ id, accountKey, configurationHash, prepareContract: false }, "cleanup", check);
    await check();
    await call("record", { runId: id, state: "completed", reason: batch.cleanupPending ? cleanupPending : undefined });
    return { runId: id };
  }
  async function recoverLegacyCleanup() {
    if (recovering || busy || !options.available()) return;
    recovering = true;
    try {
      const jobs: { runId: string }[] = await call("listCleanup");
      await Promise.allSettled(jobs.map(retryCleanup));
    } finally { recovering = false; }
  }
  return { retryCleanup, recoverLegacyCleanup, async pump() {
    if (busy || !options.available()) return;
    busy = true;
    const generation = options.generation();
    const current = () => options.available() && options.generation() === generation;
    try {
      const jobs: Job[] = await call("list");
      await Promise.allSettled(jobs.map(async ({ id, target, state, reconcile, prepareContract }) => {
        const scope = { runId: id };
        const check = async () => {
          if (!current()) throw Error("WORKSPACE_CHANGED");
          await call("current", scope);
          if (!current()) throw Error("WORKSPACE_CHANGED");
        };
        let result;
        try {
          await check();
          const { accountId, accountKey, configurationHash, fanqieBatch } = target;
          const upload = await options.forAccount(accountId);
          const batch = await upload.publishPlanDirectory({
            id, accountKey, configurationHash, preferences: fanqieBatch, prepareContract,
          }, reconcile ? "reconcile" : state === "waiting" ? "observe" : "start", check);
          result = outcome(batch);
        } catch (error) {
          const reason = reasonOf(error);
          if (["FANQIE_BROWSER_BUSY", "WORKSPACE_CHANGED", "STOP_REQUESTED"].includes(reason)) return;
          result = { state: reason === emptyReason ? "stopped" : "failed", reason };
        }
        if (current()) await call("record", { ...scope, ...result });
      }));
    } finally { busy = false; }
  } };
}
