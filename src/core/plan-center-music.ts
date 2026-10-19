import type { Studio } from "./studio";
import type { Row } from "./database";
import { hashValue } from "./quality/scoring";
import { FlowManagedMusicGrantSchema } from "../shared/production-flow";
import {providerPlanFinal} from './provider-plan-text';

const key = (itemId: string) => "plan-center-music:" + itemId;

/** Local orchestration only; Main's ProductionFlowBroker owns every provider call. */
export function startPlanMusic(s: Studio, run: Row, item: Row, attempt: Row) {
  if (s.mode !== "production") throw Error("PRODUCTION_REQUIRED");
  if (run.stopRequested) throw Error("STOP_REQUESTED");
  if (
    item.runId !== run.id ||
    attempt.runId !== run.id ||
    attempt.itemId !== item.id ||
    attempt.stage !== "music_submit"
  )
    throw Error("MANAGED_MUSIC_ITEM_SCOPE");
  if (!run.snapshot.authorization.music || !run.snapshot.music.consent)
    throw Error("MUSIC_AUTHORIZATION_REQUIRED");
  if (!["yourmusic", "pule"].includes(run.snapshot.music.route))
    throw Error("MUSIC_ROUTE_UNSUPPORTED");
  const score = s
    .planCenterService()
    .list()
    .stageAttempts.filter(
      (a) =>
        a.itemId === item.id &&
        a.runId === run.id &&
        a.stage === "text_score" &&
        a.state === "succeeded",
    )
    .at(-1);
  const evaluationRunId = score?.result?.evaluationRunId;
  const provider=run.snapshot.material.source==='provider'?providerPlanFinal(s.repo,run as any,item as any):null;
  if (!provider&&typeof evaluationRunId !== "string")
    throw Error("MANAGED_MUSIC_EVALUATION_REQUIRED");
  const evaluation = provider?null:s.productionFlowService().context(evaluationRunId as string).run;
  if (
    !provider&&(evaluation!.inboxCandidateId !== item.material?.candidateId ||
    evaluation!.artistId !== run.snapshot.artistId)
  )
    throw Error("MANAGED_MUSIC_ITEM_SCOPE");
  const music = run.snapshot.music;
  const grant = FlowManagedMusicGrantSchema.parse({
    profileId: music.profileId,
    profileRevision: music.profileRevision,
    modelId: music.modelId,
    maxCostPerRequestCredits: music.maxCostPerRequestCredits,
    budgetCredits: music.budgetCredits,
    creditPolicy: music.creditPolicy,
    consent: music.consent,
  });
  return s.repo.transaction(() => {
    const prior = s.repo.maybe("settings", key(item.id));
    const input = {
      ownerKey: attempt.id,
      budgetScope: "unified-plan:" + run.planId,
      artistId: run.snapshot.artistId,
      ...(provider?{parentRunId:run.id,itemId:item.id,providerJobId:provider.job.id}:{evaluationRunId}),
      music: grant,
    };
    if (
      prior &&
      (prior.runId !== run.id ||
        prior.ownerKey !== attempt.id ||
        prior.inputHash !== hashValue(input))
    )
      throw Error("MANAGED_MUSIC_ITEM_CONFLICT");
    const child = provider?s.productionFlowService().startManagedMusicFromVerifiedText(input):s.productionFlowService().startManagedMusic(input);
    s.repo.save("settings", {
      id: key(item.id),
      runId: run.id,
      itemId: item.id,
      ownerKey: attempt.id,
      childRunId: child.id,
      inputHash: hashValue(input),
      ...(provider?{providerJobId:provider.job.id}:{evaluationRunId}),
      artistId: run.snapshot.artistId,
    });
    s.productionFlowService().next({ id: child.id });
    return syncPlanMusic(s, run, item)!;
  });
}

/** Ownership checks deliberately exclude mutable work/files: cancellation must
 * remain possible when those artifacts are damaged. */
function managedMusicContext(s: Studio, run: Row, item: Row) {
  const binding = s.repo.maybe("settings", key(item.id));
  if (!binding) return null;
  if (
    binding.runId !== run.id ||
    binding.itemId !== item.id ||
    item.runId !== run.id ||
    binding.artistId !== run.snapshot.artistId
  )
    throw Error("MANAGED_MUSIC_ITEM_SCOPE");
  const flow = s.productionFlowService(),
    context = flow.context(binding.childRunId),
    child = context.run;
  if (
    !child.managedMusic ||
    !context.plan.managedByPlanCenter ||
    !context.plan.managedMusic ||
    context.plan.managedOwnerKey !== binding.ownerKey ||
    context.plan.managedBudgetScope !== "unified-plan:" + run.planId ||
    flow.managedMusic(binding.ownerKey)?.id !== child.id ||
    child.artistId !== binding.artistId ||
    (binding.providerJobId
      ? child.managedProviderText?.providerJobId!==binding.providerJobId||child.managedProviderText?.parentRunId!==run.id||child.managedProviderText?.itemId!==item.id
      : child.managedEvaluationRunId !== binding.evaluationRunId)
  )
    throw Error("MANAGED_MUSIC_ITEM_SCOPE");
  return { binding, context };
}

/** Returns original provider/asset evidence. Caller persists its own stage status. */
export function planMusicExternalOutcome(s:Studio,run:Row,item:Row){
 const owned=managedMusicContext(s,run,item);if(!owned)return null;
 const child=owned.context.run,operation=owned.context.operations.find(o=>o.id===child.musicSubmissionOperationId)??owned.context.operations.filter(o=>o.taskType==='music_submit').at(-1);
 return{childRunId:child.id,operationId:operation?.id??null,unknown:child.state==='unknown'||operation?.state==='unknown'};
}
/** Returns original provider/asset evidence. Caller persists its own stage status. */
export function syncPlanMusic(s: Studio, run: Row, item: Row) {
  const owned = managedMusicContext(s, run, item);
  if (!owned) return null;
  const { binding, context } = owned,
    child = context.run;
  const operation =
    context.operations.find((o) => o.id === child.musicSubmissionOperationId) ??
    context.operations.filter((o) => o.taskType === "music_submit").at(-1);
  const work = child.workId ? s.repo.get("works", child.workId) : null;
  if (
    work &&
    (work.artistId !== child.artistId ||
      work.productionFlowRunId !== child.id ||
      work.productionCandidateHash !== child.candidate.pairHash)
  )
    throw Error("MANAGED_MUSIC_WORK_SCOPE");
  const versions = child.assets.map((asset: Row) => {
    const version = work?.audioVersions?.find(
      (v: Row) => v.ordinal === asset.ordinal,
    );
    const stored = s.repo.get("assets", asset.assetId);
    if (
      !version ||
      version.providerSongId !== child.songIds[asset.ordinal] ||
      version.assetId !== asset.assetId ||
      version.sha256 !== asset.sha256 ||
      work?.assets?.[asset.ordinal === 0 ? "audio_A" : "audio_B"] !==
        asset.assetId ||
      stored.kind !== "audio" ||
      stored.sha256 !== asset.sha256
    )
      throw Error("MANAGED_MUSIC_ASSET_SCOPE");
    s.locate(asset.assetId);
    return {
      ...version,
      version: asset.ordinal === 0 ? "A" : "B",
      externalId: asset.providerSongId,
    };
  });
  return {
    childRunId: child.id,
    workId: child.workId,
    ownerKey: binding.ownerKey,
    operationId: operation?.id ?? null,
    currentOperationId: child.operationId,
    state: child.state,
    stage: child.stage,
    stopped: !!child.managedStopped,
    songIds: [...child.songIds],
    trackingId: child.trackingId,
    versions,
    reasons: [...child.reasons],
    costUnknown: operation?.costState === "unknown",
  };
}

export function stopPlanMusic(s: Studio, run: Row, item: Row) {
  const owned = managedMusicContext(s, run, item);
  if (!owned) return null;
  const { binding } = owned,
    flow = s.productionFlowService();
  const stopped = flow.stopManagedMusic(binding.ownerKey)!;
  try {
    return syncPlanMusic(s, run, item);
  } catch (error) {
    // Artifact errors are collection evidence, never a failed cancellation. Do
    // not throw: callers may be in a transaction or stopping several children.
    const artifactError =
      error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
        ? error.message
        : "MANAGED_MUSIC_ARTIFACT_INVALID";
    const operation =
      owned.context.operations.find(
        (o) => o.id === stopped.musicSubmissionOperationId,
      ) ??
      owned.context.operations
        .filter((o) => o.taskType === "music_submit")
        .at(-1);
    return {
      childRunId: stopped.id,
      workId: stopped.workId,
      ownerKey: binding.ownerKey,
      operationId: operation?.id ?? null,
      currentOperationId: stopped.operationId,
      state: stopped.state,
      stage: stopped.stage,
      stopped: true,
      songIds: [...stopped.songIds],
      trackingId: stopped.trackingId,
      versions: [],
      reasons: [...stopped.reasons, artifactError],
      costUnknown: operation?.costState === "unknown",
      artifactError,
    };
  }
}
