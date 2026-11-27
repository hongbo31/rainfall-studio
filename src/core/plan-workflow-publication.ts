import { z } from "zod";
import { accountSupportsTarget } from "../shared/platform-accounts";
import { publicationWorkflowHandler } from "../shared/platform-directory";
import { workRecordingSinger } from "../shared/local-artist";
import { workVersionTitle } from "../shared/work-versions";
import { PlanWorkflowFanqieAccountSchema, PlanWorkflowQishuiScopeSchema, PlanWorkflowQishuiSubmittedSchema, type PlanWorkflowPublicationStatus,
  type PlanWorkflowQishuiJob } from "../shared/plan-workflow-publication";
import type { PlanCenterItem, PlanCenterRun } from "../shared/plan-center";
import { isLocalPublicationWorkflow } from "../shared/plan-workflow-graph";
import type { Repository } from "./database";
import { archivePublicationDownloads } from "./download-archive";
import { CenterStore } from "./plan-center/storage";
import { planWorkflowPublicationIssue } from "./plan-workflow";
import { observeDispatch, queuePublications } from "./publication-queue";
import type { Studio } from "./studio";

const prefix = "plan-workflow-publication:";
const fanqieConnecting = "WORKFLOW_FANQIE_ACCOUNT_CONNECTING";
const terminalRuns = new Set(["completed", "failed", "stopped"]);
const fanqieAccountRequest = z.strictObject({ runId: z.uuid(), accountId: z.uuid() });
const fanqieAccountResult = fanqieAccountRequest.extend(PlanWorkflowFanqieAccountSchema.shape).or(
  fanqieAccountRequest.extend({ reason: z.string().regex(/^[A-Z0-9_]{1,120}$/u) }),
);

export function readWorkflowPublication(repo: Repository, runId: string): PlanWorkflowPublicationStatus | undefined {
  return repo.maybe("settings", prefix + runId)?.value;
}

export function listWorkflowPublications(repo: Repository): PlanWorkflowPublicationStatus[] {
  return repo.settingsByPrefix(prefix).map(row => row.value);
}

function savePublication(repo: Repository, state: PlanWorkflowPublicationStatus) {
  repo.save("settings", { id: prefix + state.runId, value: state });
}

function unboundFanqieTarget(run: PlanCenterRun) {
  if (!run.snapshot.authorization.publish || !run.snapshot.workflow?.graph ||
    isLocalPublicationWorkflow(run.snapshot.workflow.graph) || run.stopRequested || terminalRuns.has(run.state)) return;
  const target = run.snapshot.workflow.publications?.find(row => row.platform === "fanqie");
  if (target && (!target.accountKey || !target.configurationHash)) return target;
}

/** Main supplies the selected account's verified identity. Existing dispatches keep their original binding. */
export function workflowFanqieAccountAction(s: Studio, action: "list" | "record", input: unknown) {
  const store = new CenterStore(s.repo);
  const pending = (run: PlanCenterRun) => {
    const target = unboundFanqieTarget(run);
    const saved = target && readWorkflowPublication(s.repo, run.id);
    if (!target || !saved || saved.dispatch || saved.fanqieAccount || planWorkflowPublicationIssue(s.repo, run.snapshot)) return;
    return { target, saved };
  };
  if (action === "list") {
    z.strictObject({}).parse(input);
    return store.all("run").flatMap(run => {
      const request = pending(run);
      return request ? [{ runId: run.id, accountId: request.target.accountId }] : [];
    });
  }
  const { runId, ...result } = fanqieAccountResult.parse(input);
  return s.repo.transaction(() => {
    const run = store.get("run", runId);
    const request = run && pending(run);
    if (!request || request.target.accountId !== result.accountId) throw Error("FANQIE_BATCH_SCOPE_CHANGED");
    const { target, saved } = request;
    if ("reason" in result) {
      if (saved.state !== "action_required" || saved.detail !== result.reason) {
        savePublication(s.repo, { ...saved, state: "action_required", detail: result.reason });
      }
    } else {
      if (target.accountKey && target.accountKey !== result.accountKey) throw Error("FANQIE_BATCH_SCOPE_CHANGED");
      if (target.configurationHash && target.configurationHash !== result.configurationHash) throw Error("FANQIE_CONFIGURATION_CHANGED");
      savePublication(s.repo, { ...saved, state: "running", detail: "WORKFLOW_PUBLICATION_PENDING", fanqieAccount: result });
    }
    s.planCenterService().refreshPublication(runId);
  });
}

function qishuiJobs(s: Studio, run: PlanCenterRun, items: PlanCenterItem[], accountId: string): PlanWorkflowQishuiJob[] {
  const artist = run.snapshot.workflowSnapshot?.artist;
  if (!artist) throw Error("WORKFLOW_ARTIST_CHANGED");
  const currentArtist = s.repo.get("artists", run.snapshot.artistId);
  return items.map(item => {
    const work = s.repo.get("works", item.workId!);
    const variant = item.selectedVersion ?? (work.selectedAudioVariant === "B" ? "B" : "A");
    const performer = workRecordingSinger(work, currentArtist, variant);
    if (!performer || !work.assets?.[`audio_${variant}`]) throw Error("WORKFLOW_PUBLICATION_MATERIALS_CHANGED");
    return { runId: run.id, accountId, workId: work.id, variant, submitted: false,
      credits: { performer, composer: artist.composer, lyricist: artist.lyricist } };
  });
}

function enqueue(s: Studio, run: PlanCenterRun, items: PlanCenterItem[],
  fanqieAccount?: PlanWorkflowPublicationStatus["fanqieAccount"]): PlanWorkflowPublicationStatus {
  const issue = planWorkflowPublicationIssue(s.repo, run.snapshot);
  if (issue) throw Error(issue);
  const targets = run.snapshot.workflow!.publications!.map(target =>
    target.platform === "fanqie" && target.accountId === fanqieAccount?.accountId ? { ...target, ...fanqieAccount } : target);
  const workIds = items.map(item => {
    const work = s.repo.get("works", item.workId!);
    const selected = work.selectedAudioVariant ?? "A";
    const recording = item.versions.find(version => version.version === item.selectedVersion);
    if (!recording?.assetId || selected !== item.selectedVersion ||
      work.assets?.[`audio_${selected}`] !== recording.assetId) throw Error("WORKFLOW_PUBLICATION_MATERIALS_CHANGED");
    return work.id as string;
  });
  const qishui = targets.find(target => publicationWorkflowHandler(target.platform) === "qishui");
  const qishuiQueue = qishui ? qishuiJobs(s, run, items, qishui.accountId) : [];
  if (qishui) archivePublicationDownloads(s, qishuiQueue.map(({ accountId, workId }) => ({ accountId, workId })));
  const dispatch = queuePublications(s, { targets, useVersionMetadata: true, prepareContract: run.prepareContract }, workIds, run.id);
  return { runId: run.id, state: "running", detail: "WORKFLOW_PUBLICATION_PENDING", dispatch, qishui: qishuiQueue };
}

function observe(s: Studio, queued: PlanWorkflowPublicationStatus, run: PlanCenterRun): PlanWorkflowPublicationStatus {
  const dispatch = queued.dispatch!;
  let uploadedOnly = "";
  if (dispatch.tmeIds.length || dispatch.fanqieIds.length) {
    const fanqie = run.snapshot.workflow?.publications?.find(target => target.platform === "fanqie");
    const observation = observeDispatch(s, dispatch, run.prepareContract, fanqie?.fanqieBatch?.signContract === false);
    if (observation.state !== "completed") return { ...queued,
      state: observation.state,
      detail: observation.detail,
    };
    if (observation.unsignedUploads) uploadedOnly = observation.detail;
  }
  if (queued.qishui.some(item => !item.submitted)) return { ...queued, state: "action_required", detail: "WORKFLOW_QISHUI_USER_REQUIRED" };
  return { ...queued, state: "completed", detail: uploadedOnly || (queued.qishui.length ? "WORKFLOW_QISHUI_USER_RECORDED" : "WORKFLOW_PUBLICATION_SUBMITTED") };
}

export function syncWorkflowPublications(s: Studio) {
  if (s.mode !== "production") return;
  const store = new CenterStore(s.repo), center = s.planCenterService();
  const rows = center.list();
  const ready = new Set(rows.stageAttempts.filter(step => step.stage === "materials" && step.state === "succeeded").map(step => step.itemId));
  for (const run of rows.runs) {
    if (!run.snapshot.workflow?.graph || isLocalPublicationWorkflow(run.snapshot.workflow.graph) ||
      !run.snapshot.authorization.publish || run.stopRequested ||
      terminalRuns.has(run.state)) continue;
    const items = rows.items.filter(item => item.runId === run.id);
    if (items.length !== run.snapshot.count || !items.every(item => item.workId && ready.has(item.id))) continue;
    s.repo.transaction(() => {
      if (store.get("run", run.id)?.stopRequested) return;
      const saved = readWorkflowPublication(s.repo, run.id);
      let next: PlanWorkflowPublicationStatus = saved ?? { runId: run.id, state: "running", detail: "WORKFLOW_PUBLICATION_PENDING", qishui: [] };
      try {
        if (!next.dispatch && !next.fanqieAccount && unboundFanqieTarget(run) && !planWorkflowPublicationIssue(s.repo, run.snapshot)) {
          if (!saved) savePublication(s.repo, { ...next, detail: fanqieConnecting });
          center.refreshPublication(run.id);
          return;
        }
        // A queue identity is committed with its jobs. Provider observations never enqueue it again.
        if (!next.dispatch) next = s.repo.transaction(() => enqueue(s, run, items, next.fanqieAccount));
        next = observe(s, next, run);
      } catch (error) {
        next = { ...next, state: "action_required",
          detail: error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message) ? error.message : "WORKFLOW_PUBLICATION_PREPARE_FAILED" };
      }
      if (JSON.stringify(saved) !== JSON.stringify(next)) savePublication(s.repo, next);
      center.refreshPublication(run.id);
    });
  }
}

export function workflowQishuiScope(s: Studio, input: unknown, readOnly = false) {
  const { runId, accountId, workId } = PlanWorkflowQishuiScopeSchema.parse(input);
  const run = new CenterStore(s.repo).get("run", runId);
  const state = readWorkflowPublication(s.repo, runId);
  const item = state?.qishui.find(job => job.accountId === accountId && job.workId === workId);
  if (s.mode !== "production" || !run?.snapshot.authorization.publish || !state || !item ||
    !accountSupportsTarget(s.repo.maybe("accounts", accountId)?.provider, "qishui")) throw Error("WORKFLOW_QISHUI_SCOPE");
  if (!readOnly && (run.stopRequested || ["stopped", "failed"].includes(run.state) || item.submitted)) throw Error("STOP_REQUESTED");
  return item;
}

export function recordWorkflowQishuiSubmission(s: Studio, input: unknown) {
  const { runId, accountId, workId } = PlanWorkflowQishuiSubmittedSchema.parse(input);
  return s.repo.transaction(() => {
    const item = workflowQishuiScope(s, { runId, accountId, workId }, true);
    const state = readWorkflowPublication(s.repo, runId)!;
    if (item.submitted) return state;
    workflowQishuiScope(s, { runId, accountId, workId });
    const run = new CenterStore(s.repo).get("run", runId);
    if (!run) throw Error("WORKFLOW_QISHUI_SCOPE");
    const work = s.repo.maybe("works", workId);
    const submittedTitle = work?.title ? workVersionTitle({ title: work.title, alternateTitle: work.alternateTitle }, `audio_${item.variant}`) : undefined;
    const next = observe(s, { ...state, qishui: state.qishui.map(job =>
      job.accountId === accountId && job.workId === workId
        ? { ...job, submitted: true, submittedAt: s.now().toISOString(), submittedTitle } : job) }, run);
    savePublication(s.repo, next);
    s.planCenterService().refreshPublication(runId);
    return next;
  });
}
