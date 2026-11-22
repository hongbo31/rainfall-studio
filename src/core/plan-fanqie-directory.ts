import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { fanqieDirectoryPreferencesSchema } from "../shared/fanqie-downloads";
import type { PlanCenterRun, PlanWorkflowPublicationTarget } from "../shared/plan-center";
import { isLocalPublicationWorkflow } from "../shared/plan-workflow-graph";
import { defaultFanqieAccountId, PlatformAccountIdSchema } from "../shared/platform-accounts";
import { hasPendingFanqieCleanup } from "./fanqie-download-cleanup";
import { CenterStore } from "./plan-center/storage";
import { planWorkflowPublicationIssue } from "./plan-workflow";
import type { Studio } from "./studio";

const runScope = z.strictObject({ runId: z.uuid() });
const status = runScope.extend({
  state: z.enum(["waiting", "blocked", "stopped", "completed", "failed"]),
  reason: z.string().regex(/^[A-Z0-9_]{1,120}$/).optional(),
});
const live = ["running", "waiting", "blocked"];
const retryReason = "FANQIE_DIRECTORY_RECONCILING";
const cleanupFailed = "FANQIE_DOWNLOAD_CLEANUP_FAILED";
const cleanupPending = "FANQIE_DOWNLOAD_CLEANUP_PENDING";
const disconnected = "FANQIE_BROWSER_CONNECTION_REQUIRED";
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/u);
const directoryBatch = z.object({
  id: z.uuid(),
  accountKey: fingerprint,
  configurationHash: fingerprint,
  state: z.literal("needs_review"),
  preferences: fanqieDirectoryPreferencesSchema,
});
const cleanupBatch = directoryBatch.extend({
  issue: z.literal(cleanupFailed),
  prepareContracts: z.literal(false).optional(),
  active: z.object({ materialsRecycled: z.union([z.literal(true), z.literal("after_upload")]).optional() }).optional(),
  items: z.array(z.object({ state: z.literal("uploaded"), workId: z.string().regex(/^[1-9]\d{4,24}$/u) })).nonempty(),
});
const firstRound = z.literal(1);
const trackId = z.string().min(1);
const noReceipt = z.undefined().optional();
const disconnectedBatch = directoryBatch.extend({
  issue: z.literal(disconnected),
  prepareContracts: z.boolean().optional(),
  requireSecurityVerification: z.literal(true).optional(),
  round: firstRound.optional(),
  signatureStage: noReceipt,
  active: z.object({
    number: firstRound,
    trackIds: z.array(trackId).nonempty(),
    signContract: z.literal(false).optional(),
    contractPrepared: z.literal(false).optional(),
    contractGenerationRequestedAt: noReceipt,
    materialsRecycled: noReceipt,
  }),
  items: z.array(z.object({
    id: trackId,
    title: z.string().min(1),
    state: z.literal("needs_review"),
    issue: z.literal(disconnected),
    round: firstRound.optional(),
    workId: noReceipt,
    officialStatus: noReceipt,
  })).nonempty(),
});
const downloadJobScope = z.object({ batchId: z.uuid(), id: trackId });
const uploadJobScope = z.object({ id: fingerprint, download: downloadJobScope.optional() });
const disconnectedJob = uploadJobScope.extend({
  download: downloadJobScope,
  accountKey: fingerprint,
  title: z.string().min(1),
  phase: z.literal("unknown"),
  pending: z.literal("opening-form"),
  reason: z.literal(disconnected),
  officialRecord: noReceipt,
});

function fanqieRunJournalPaths(root: string, runId: string, accountId: string) {
  runScope.parse({ runId });
  PlatformAccountIdSchema.parse({ accountId });
  const fanqie = path.join(fs.realpathSync.native(root), "production", "fanqie");
  const account = accountId === defaultFanqieAccountId ? fanqie : path.join(fanqie, "accounts", accountId);
  return { account, batch: path.join(account, "download-runs", runId), uploads: path.join(account, "uploads") };
}

function isOwnedPath(file: string) {
  return path.relative(file, fs.realpathSync.native(file)) === "";
}

function readOwnedJournal(file: string): unknown {
  if (!fs.lstatSync(file).isFile() || !isOwnedPath(file)) throw Error("FANQIE_BATCH_SCOPE_CHANGED");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function fanqieDirectoryDiagnostics(root: string, run: PlanCenterRun) {
  const workflow = run.snapshot.workflow;
  if (!run.snapshot.authorization.publish || !isLocalPublicationWorkflow(workflow?.graph)) return;
  const target = workflow?.publications?.find(row => row.platform === "fanqie");
  if (!target) return;
  try {
    const { batch } = fanqieRunJournalPaths(root, run.id, target.accountId);
    const trace = path.join(batch, "trace.jsonl");
    if (fs.lstatSync(trace).isFile() && isOwnedPath(trace)) return batch;
  } catch {
    return;
  }
}

function matchesRunScope(batch: z.infer<typeof directoryBatch>, runId: string, target: PlanWorkflowPublicationTarget) {
  return batch.id === runId && !batch.preferences.signContract &&
    (!target.accountKey || batch.accountKey === target.accountKey) &&
    (!target.configurationHash || batch.configurationHash === target.configurationHash);
}

function readCleanupBatch(root: string, run: PlanCenterRun) {
  if (run.reason !== cleanupFailed || run.prepareContract !== false || !run.snapshot.authorization.publish) return;
  const workflow = run.snapshot.workflow;
  if (!isLocalPublicationWorkflow(workflow?.graph)) return;
  const target = workflow?.publications?.find(row => row.platform === "fanqie");
  if (!target) return;
  try {
    // Read the existing account-scoped journal without reopening the publisher.
    const folders = fanqieRunJournalPaths(root, run.id, target.accountId);
    const batch = cleanupBatch.parse(readOwnedJournal(path.join(folders.batch, "batch.json")));
    if (matchesRunScope(batch, run.id, target) && new Set(batch.items.map(item => item.workId)).size === batch.items.length)
      return { batch, target };
  } catch {
    return;
  }
}

export function isFanqieDirectoryCleanupOnlyFailure(root: string, run: PlanCenterRun) {
  return !!readCleanupBatch(root, run);
}

export function fanqieDirectoryCleanupStatus(root: string, run: PlanCenterRun) {
  if (run.reason !== cleanupFailed && run.reason !== cleanupPending) return;
  const workflow = run.snapshot.workflow;
  if (!run.snapshot.authorization.publish || !isLocalPublicationWorkflow(workflow?.graph)) return;
  const target = workflow?.publications?.find(row => row.platform === "fanqie");
  if (!target) return;
  try {
    const { account } = fanqieRunJournalPaths(root, run.id, target.accountId);
    if (hasPendingFanqieCleanup(account, run.id)) return "queued";
  } catch {
    return;
  }
  if (run.reason === cleanupPending) return "recycled";
  const active = readCleanupBatch(root, run)?.batch.active;
  if (active) return active.materialsRecycled === "after_upload" ? "recycled" : "pending";
}

export function isFanqieDirectoryDisconnectedBeforeUpload(root: string, run: PlanCenterRun) {
  if (run.state !== "blocked" || run.stopRequested || run.source !== "publication_task" ||
      run.reason !== disconnected || run.prepareContract !== false || !run.snapshot.authorization.publish) return false;
  const workflow = run.snapshot.workflow;
  const target = workflow?.publications?.find(row => row.platform === "fanqie");
  if (!target || !isLocalPublicationWorkflow(workflow?.graph)) return false;
  try {
    const folders = fanqieRunJournalPaths(root, run.id, target.accountId);
    const batch = disconnectedBatch.parse(readOwnedJournal(path.join(folders.batch, "batch.json")));
    if (batch.prepareContracts && !batch.requireSecurityVerification) return false;
    if (!matchesRunScope(batch, run.id, target)) return false;
    const tracks = new Map(batch.items.map(item => [item.id, item.title]));
    const active = new Set(batch.active.trackIds);
    if (tracks.size !== batch.items.length || active.size !== batch.active.trackIds.length ||
        active.size !== tracks.size || tracks.size > batch.preferences.limit || batch.items.some(item => !active.has(item.id))) return false;
    if (fs.readdirSync(folders.batch).some(name => /^verification-\d+\.json$/iu.test(name))) return false;
    if (!fs.lstatSync(folders.uploads).isDirectory() || !isOwnedPath(folders.uploads)) return false;

    // Persisting the confirmation intent advances the job before the publisher clicks the submit button.
    for (const name of fs.readdirSync(folders.uploads).filter(file => /^[a-f0-9]{64}\.json$/u.test(file))) {
      const raw = readOwnedJournal(path.join(folders.uploads, name));
      const scope = uploadJobScope.parse(raw);
      if (name !== scope.id + ".json") return false;
      if (scope.download?.batchId !== run.id) continue;
      const job = disconnectedJob.parse(raw);
      if (job.accountKey !== batch.accountKey || tracks.get(job.download.id) !== job.title) return false;
      tracks.delete(job.download.id);
    }
    return tracks.size === 0;
  } catch {
    return false;
  }
}

export function planFanqieDirectoryAction(studio: Studio, action: string, input: unknown) {
  if (studio.mode !== "production") throw Error("PRODUCTION_REQUIRED");
  const store = new CenterStore(studio.repo);
  if (action === "list") {
    z.strictObject({}).parse(input);
    return store.all("run").filter(run => ["running", "waiting"].includes(run.state) && !run.stopRequested &&
      run.snapshot.authorization.publish && isLocalPublicationWorkflow(run.snapshot.workflow?.graph)).map(run => ({
        id: run.id, state: run.state, reconcile: run.reason === retryReason,
        target: run.snapshot.workflow!.publications![0], prepareContract: run.prepareContract,
      }));
  }
  if (action === "listCleanup") {
    z.strictObject({}).parse(input);
    return store.all("run", { field: "reason", values: [cleanupFailed] })
      .filter(run => fanqieDirectoryCleanupStatus(studio.root, run) === "pending")
      .map(run => ({ runId: run.id }));
  }
  const update = action === "record" ? status.parse(input) : undefined;
  const { runId } = update ?? runScope.parse(input);
  const run = store.get("run", runId);
  if (!run || !isLocalPublicationWorkflow(run.snapshot.workflow?.graph) || !run.snapshot.authorization.publish)
    throw Error("FANQIE_BATCH_SCOPE_CHANGED");

  if (action === "diagnostics") {
    const directory = fanqieDirectoryDiagnostics(studio.root, run);
    if (!directory) throw Error("FANQIE_DIAGNOSTICS_OPEN_FAILED");
    return { directory };
  }
  if (action === "cleanupScope") {
    const scope = readCleanupBatch(studio.root, run);
    if (!scope?.batch.active) throw Error("FANQIE_BATCH_SCOPE_CHANGED");
    const { batch, target } = scope;
    return { id: run.id, target: { ...target, accountKey: batch.accountKey, configurationHash: batch.configurationHash } };
  }
  if (update) {
    const { state, reason } = update;
    if (!live.includes(run.state) || run.stopRequested || (run.state === state && run.reason === reason)) return run;
    return store.put("run", { ...run, state, reason, updatedAt: studio.now().toISOString() });
  }
  if (run.stopRequested || !live.includes(run.state)) throw Error("STOP_REQUESTED");
  const issue = planWorkflowPublicationIssue(studio.repo, run.snapshot);
  if (issue) throw Error(issue);
  if (action === "current" && run.state !== "blocked") return { id: run.id };
  if (action === "retry" && (run.state === "waiting" || run.state === "blocked"))
    return store.put("run", { ...run, state: "running", reason: retryReason, updatedAt: studio.now().toISOString() });
  throw Error("FANQIE_RECONCILIATION_REQUIRED");
}
