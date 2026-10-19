import type { Repository, Row } from "./database";
import { flowCandidate } from "./production-flow-local";
import { hashValue } from "./quality/scoring";

export function inboxEvaluationSource(repo: Repository, plan: Row, id: string) {
  const candidate = repo.get("textCandidates", id);
  const channel = repo.maybe("settings", "inbox-channel");
  const draft = repo.get("drafts", candidate.draftId);
  if (
    !channel?.enabled ||
    !candidate.isCurrent ||
    candidate.lineageState !== "complete" ||
    candidate.localCheck?.status === "failed" ||
    candidate.artistId !== plan.artistId ||
    candidate.source?.channelId !== channel.channel.id ||
    !Object.values(channel.channel.artistRefs).includes(candidate.artistId) ||
    draft.source !== "local-inbox" ||
    draft.artistId !== candidate.artistId ||
    draft.seriesId !== candidate.seriesId
  )
    throw Error("INBOX_EVALUATION_SOURCE_CHANGED");
  return {
    candidate,
    draft,
    sourceHash: hashValue({
      itemHash: candidate.itemHash,
      draftId: draft.id,
      draft: draft.draft,
      source: candidate.source,
      artistId: candidate.artistId,
      seriesId: candidate.seriesId,
    }),
  };
}

export function importedFlowCandidate(repo: Repository, run: Row, id: string) {
  const { candidate, draft } = inboxEvaluationSource(repo, run.plan, id);
  const value = flowCandidate(run, draft.draft, "local-inbox", {
    providerModel: candidate.source.provenance.model ?? "external-unspecified",
    promptVersion:
      candidate.source.provenance.promptVersion ?? "external-unspecified",
    importedCandidateId: id,
    sourceDraftId: draft.id,
    verification: "producer-declared-unverified",
  });
  return value;
}

// Receipt files remain immutable import acknowledgements. Current quality is separate DB state.
export function syncInboxEvaluation(repo: Repository, run: Row) {
  if (!run.inboxCandidateId) return;
  const candidate = repo.get("textCandidates", run.inboxCandidateId);
  let state = "model_pending";
  if (
    run.state === "completed" &&
    run.score?.source === "model-scored" &&
    run.score.passed
  )
    state = "model_passed";
  else if (run.state === "failed")
    state =
      run.score?.passed === false && run.reasons.includes("REVISION_LIMIT")
        ? "model_failed"
        : "model_error";
  else if (run.state === "unknown") state = "model_unknown";
  else if (run.state === "blocked") state = "model_blocked";
  else if (run.state === "dispatching") state = "model_evaluating";
  const versions = (run.versions ?? []).map((version: Row) => {
    const id = version.id;
    if (!repo.maybe("drafts", id))
      repo.save("drafts", {
        id,
        artistId: candidate.artistId,
        seriesId: candidate.seriesId,
        source: "inbox-evaluation",
        draft: version.draft,
        pair: version.pair,
        parentDraftId: version.parentCandidateId ?? candidate.draftId,
        evaluationRunId: run.id,
        revision: version.revision,
      });
    return { id, revision: version.revision, source: version.source };
  });
  repo.save("textCandidates", {
    ...candidate,
    evaluationState: state,
    evaluation: {
      runId: run.id,
      state,
      reasons: run.reasons,
      score: run.score,
      versions,
      currentDraftId: run.candidate?.id ?? null,
      coverState: run.revisionCount > 0 ? "refresh_required" : "original",
      revisionCount: run.revisionCount,
      scoreRetries: run.scoreRetries,
      textSpentMicros: run.textSpentMicros,
      textReservedMicros: run.textReservedMicros,
      updatedAt: run.updatedAt ?? run.createdAt,
    },
  });
}

export function inboxEvaluationStatus(repo: Repository) {
  const plans = repo
    .all("settings")
    .filter(
      (r) =>
        r.id.startsWith("production-flow:plan:") && r.value?.inboxEvaluation,
    )
    .map((r) => r.value);
  const unified=repo.all('settings').filter(r=>r.id.startsWith('plan-center:plan:')&&r.value?.authorization?.text&&r.value?.text?.consent).map(r=>({id:r.value.id,artistId:r.value.artistId,enabled:r.value.enabled,authorizationRevision:r.value.revision,revision:r.value.revision,threshold:r.value.text.threshold,maxRevisions:r.value.text.maxRewrites,maxScoreRetries:r.value.text.maxScoreRetries}));
  plans.push(...unified);
  const channelActive = !!repo.maybe("settings", "inbox-channel")?.enabled;
  return {
    state: !plans.length
      ? "configuration_required"
      : channelActive &&
          plans.some((p) => p.enabled && p.authorizationRevision === p.revision)
        ? "configured"
        : "paused",
    plans: plans.map((p) => ({
      id: p.id,
      artistId: p.artistId,
      enabled: p.enabled,
      threshold: p.threshold,
      maxRevisions: p.maxRevisions,
      maxScoreRetries: p.maxScoreRetries,
    })),
  };
}
