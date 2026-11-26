import { randomUUID } from "node:crypto";
import { CreationTaskDraftSchema } from "../shared/generation-config";
import { artistProfileSchema, artistSongType, secondSingerSchema } from "../shared/local-artist";
import { bestLyricVersion, canResumeLyricResponse, lyricResultVersion, meetsLyricTarget, type LyricJob } from "../shared/lyric-writing";
import { accountSupportsTarget } from "../shared/platform-accounts";
import { publicationWorkflowHandler, workflowNodesCatalog } from "../shared/platform-directory";
import { isLocalPublicationWorkflow, workflowProvider, workflowPublicationPlatforms } from "../shared/plan-workflow-graph";
import { withoutWorkflowLyrics, workflowBrowserMusic, workflowPuleInputsComplete } from "../shared/plan-workflow-fields";
import { puleSongFields } from "../shared/pule-browser";
import { z } from "zod";
import { isPlanCenterDefinition, type PlanCenterItem, type PlanCenterPlan, type PlanCenterRun } from "../shared/plan-center";
import type { Repository, Row } from "./database";
import { withArtistSnapshot } from "./generation-config";
import type { Studio } from "./studio";

const workflowArtistDetails = z.object({ profile: artistProfileSchema, secondSinger: secondSingerSchema.nullish() });

function withWorkflowArtist(repo: Repository, plan: PlanCenterPlan, artist: Row, accountName: string,
  { profile, secondSinger }: z.infer<typeof workflowArtistDetails>): PlanCenterPlan {
  const songType = artistSongType(artist.defaults);
  const template = artist.promptTemplateId ? repo.maybe("promptTemplates", artist.promptTemplateId) : null;
  return { ...withArtistSnapshot(plan, { ...artist, profile, secondSinger, accountLocalArtist: true }),
    songType, outputs: { ...plan.outputs, lyrics: songType === "vocal" },
    workflowSnapshot: { accountName, artist: profile, secondSinger: secondSinger ?? undefined,
      template: template ? { id: template.id, name: template.name, revision: template.revision } : null },
  };
}

export function freezePlanWorkflow(repo: Repository, plan: PlanCenterPlan): PlanCenterPlan {
  const workflow = plan.workflow;
  if (!workflow) return plan;
  const account = repo.get("accounts", workflow.accountId);
  if (workflow.platform && !accountSupportsTarget(account.provider, workflow.platform)) throw Error("ACCOUNT_PROVIDER_MISMATCH");
  const scopedTarget = workflow.publications?.find(target => target.platform === workflow.platform);
  if (scopedTarget && scopedTarget.accountId !== account.id) throw Error("WORKFLOW_PUBLICATION_ACCOUNT_MISMATCH");
  if (isLocalPublicationWorkflow(workflow.graph)) return plan;
  const artist = repo.get("accountLocalArtists", plan.artistId);
  if (artist.accountId && artist.accountId !== account.id) throw Error("ARTIST_ACCOUNT_MISMATCH");
  const saved = withWorkflowArtist(repo, plan, artist, account.name, workflowArtistDetails.parse(artist));
  if (!workflow.graph && workflow.mode === "musician" && !saved.workflowSnapshot?.template) throw Error("WORKFLOW_TEMPLATE_REQUIRED");
  return saved;
}

/** Resolve artist data for a definition before showing it or starting an execution. */
export function refreshPlanArtist(repo: Repository, plan: PlanCenterPlan): PlanCenterPlan {
  if (!plan.artistId || !plan.routing || !isPlanCenterDefinition(plan)) return plan;
  const artist = repo.maybe("accountLocalArtists", plan.artistId);
  const saved = plan.artistSnapshot;
  if (!artist || saved && saved.id === artist.id && saved.revision === artist.revision) return plan;
  if (!plan.workflow) return withArtistSnapshot(plan, { ...artist, accountLocalArtist: true });
  if (!plan.workflowSnapshot || artist.accountId && artist.accountId !== plan.workflow.accountId) return plan;
  const details = workflowArtistDetails.safeParse(artist);
  return details.success ? withWorkflowArtist(repo, plan, artist, plan.workflowSnapshot.accountName, details.data) : plan;
}

/** Resolve inputs for the run's song type while preserving the saved mappings. */
export function withWorkflowMusicInputs(plan: PlanCenterPlan): PlanCenterPlan {
  const { workflow } = plan;
  if (!workflow) return plan;
  const music = workflow.browserMusic ?? workflow.pule;
  if (!music) return plan;
  const inputs = plan.songType === "instrumental" ? withoutWorkflowLyrics(music.inputs) :
    music.inputs.lyrics ? music.inputs : { ...music.inputs, lyrics: "lyrics" as const };
  if (inputs === music.inputs) return plan;
  if (workflow.browserMusic)
    return { ...plan, workflow: { ...workflow, browserMusic: { ...workflow.browserMusic, inputs } } };
  return { ...plan, workflow: { ...workflow, pule: { ...music, inputs } } };
}

export function planWorkflowMusicIssue(repo: Repository, plan: PlanCenterPlan) {
  const music = workflowBrowserMusic(plan.workflow);
  if (!music) return;
  if (!music.accountId || repo.maybe("accounts", music.accountId)?.provider !== music.provider)
    return music.provider === "yourmusic" ? "WORKFLOW_PULE_ACCOUNT_REQUIRED" : "WORKFLOW_SUNO_CN_ACCOUNT_REQUIRED";
  if (!workflowPuleInputsComplete(music.inputs, plan.songType === "instrumental"))
    return plan.workflow?.pule ? "WORKFLOW_PULE_INPUTS_REQUIRED" : "WORKFLOW_MUSIC_INPUTS_REQUIRED";
}

export function authorizeGraphPlanExecution(plan: PlanCenterPlan, publish = false): PlanCenterPlan {
  if (isLocalPublicationWorkflow(plan.workflow?.graph)) return { ...plan, authorization: { ...plan.authorization, publish } };
  return { ...plan, authorization: { text: true, music: true, publish }, text: { ...plan.text, consent: true },
    music: { ...plan.music, consent: true, budgetCredits: plan.music.budgetCredits ?? 1,
      maxCostPerRequestCredits: plan.music.maxCostPerRequestCredits ?? 1,
      creditPolicy: { mode: 'uncapped_existing_credits', noRecharge: true, actualCostUnknown: true, consent: true } },
  };
}

export function planWorkflowIssue(repo: Repository, plan: PlanCenterPlan, source: "definition" | "run" = "definition") {
  if (!plan.workflow) return;
  if (isLocalPublicationWorkflow(plan.workflow.graph)) return planWorkflowPublicationIssue(repo, plan);
  const account = repo.maybe("accounts", plan.workflow.accountId);
  if (!account || (plan.workflow.platform && !accountSupportsTarget(account.provider, plan.workflow.platform)) || account.name !== plan.workflowSnapshot?.accountName)
    return "WORKFLOW_ACCOUNT_CHANGED";
  const artist = repo.maybe("accountLocalArtists", plan.artistId);
  const snapshot = plan.artistSnapshot;
  if (!artist || !snapshot || snapshot.id !== artist.id || (artist.accountId && artist.accountId !== account.id) ||
      (source === "definition" && artist.revision !== snapshot.revision)) return "WORKFLOW_ARTIST_CHANGED";
  const template = plan.workflowSnapshot?.template;
  if (!plan.workflow.graph && plan.workflow.mode === "musician" && !template) return "WORKFLOW_TEMPLATE_REQUIRED";
  if (template && repo.maybe("promptTemplates", template.id)?.revision !== template.revision) return "WORKFLOW_TEMPLATE_CHANGED";
  const graph = plan.workflow.graph;
  if (graph?.nodes.some(id => !workflowNodesCatalog.some(node => node.id === id && node.available))) return "WORKFLOW_NODE_UNAVAILABLE";
  const textProvider = workflowProvider(graph, "text"), musicProvider = workflowProvider(graph, "music");
  if (textProvider && plan.routeSnapshot?.text.providerId !== textProvider) return "WORKFLOW_TEXT_PROVIDER_REQUIRED";
  if (musicProvider && plan.routeSnapshot?.music.providerId !== musicProvider) return "WORKFLOW_MUSIC_PROVIDER_REQUIRED";
  const textId = plan.routeSnapshot?.text.profileId;
  if (plan.workflow.graph && textId && !repo.maybe('settings', 'api-profile:' + textId)?.textPricing)
    return 'TEXT_PROFILE_OR_PRICE_REQUIRED';
  return planWorkflowMusicIssue(repo, plan) ?? planWorkflowPublicationIssue(repo, plan);
}

export function planWorkflowPublicationIssue(repo: Repository, plan: PlanCenterPlan) {
  const platforms = workflowPublicationPlatforms(plan.workflow?.graph);
  if (!platforms.length) return;
  if (!plan.outputs.cover && !isLocalPublicationWorkflow(plan.workflow?.graph)) return "WORKFLOW_PUBLICATION_COVER_REQUIRED";
  for (const platform of platforms) {
    const handler = publicationWorkflowHandler(platform);
    if (!handler) return "WORKFLOW_NODE_UNAVAILABLE";
    const target = plan.workflow?.publications?.find(row => row.platform === platform);
    if (!target || !accountSupportsTarget(repo.maybe("accounts", target.accountId)?.provider, target.platform))
      return "WORKFLOW_PUBLICATION_ACCOUNT_REQUIRED";
  }
}

export function verifiedPlanLyrics(repo: Repository, attemptId: string, jobId: string, plan: PlanCenterPlan) {
  const job = repo.maybe("lyricJobs", jobId) as (LyricJob & { planAttemptId?: string }) | undefined;
  const version = job && (job.resultVersionId ? lyricResultVersion(job) : bestLyricVersion(job.versions));
  if (!job || job.planAttemptId !== attemptId || job.state !== "complete" || !version || job.songType !== plan.songType ||
      (job.targetScore !== undefined && (!job.resultVersionId || version.review?.revisionId !== version.id || !version.lyrics)))
    throw Error("WORKFLOW_LYRICS_EVIDENCE_REQUIRED");
  const material = { source: "workflow", title: version.title, alternateTitle: version.alternateTitle,
    musicPrompt: version.style, ...(plan.songType !== "instrumental" ? { lyrics: version.lyrics ?? "" } : {}),
    lyricJobId: jobId, lyricVersionId: version.id };
  // Validate mapped values while recording the lyric result, before a music attempt can be claimed.
  const music = workflowBrowserMusic(plan.workflow);
  if (music) mappedMusicDraft(plan, music.inputs, material);
  return material;
}

const puleDraftSchema = z.strictObject(puleSongFields);
function mappedMusicDraft(plan: PlanCenterPlan, inputs: NonNullable<ReturnType<typeof workflowBrowserMusic>>["inputs"], material: Record<string, unknown>) {
  const instrumental = plan.songType === "instrumental";
  if (!workflowPuleInputsComplete(inputs, instrumental))
    throw Error(plan.workflow?.pule ? "WORKFLOW_PULE_INPUTS_REQUIRED" : "WORKFLOW_MUSIC_INPUTS_REQUIRED");
  const fields = { title: material.title, alternateTitle: material.alternateTitle, style: material.musicPrompt, lyrics: material.lyrics };
  const draft = puleDraftSchema.safeParse({
    title: fields[inputs.title!],
    ...(inputs.alternateTitle ? { alternateTitle: fields[inputs.alternateTitle] } : {}),
    style: fields[inputs.style!],
    lyrics: instrumental ? "" : fields[inputs.lyrics!],
  });
  if (!draft.success || !instrumental && !draft.data.lyrics.trim())
    throw Error(plan.workflow?.pule ? "WORKFLOW_PULE_INPUT_VALUE_INVALID" : "WORKFLOW_MUSIC_INPUT_VALUE_INVALID");
  return draft.data;
}

function alignBrowserVocalStyle(style: string, gender: "male" | "female") {
  const differentVoice = gender === "male" ? /女(?=声|[高中低]音|主唱|歌手|性人声)/gu : /男(?=声|[高中低]音|主唱|歌手|性人声)/gu;
  const differentEnglishVoice = gender === "male"
    ? /\bfemale[\s_-]*(?=(?:vocals?|voice|lead|singer|soprano|mezzo|alto)\b)/giu
    : /\bmale[\s_-]*(?=(?:vocals?|voice|lead|singer|rap|rapper|tenor|baritone|bass)\b)/giu;
  return style.split(/([,，;；\n]+)/u).map(part => {
    // Keep exclusions as written. The selected lead vocal is sent separately from these tags.
    if (/^\s*(?:-|(?:no|avoid|without)\b|不使用|不要|避免|排除|禁止)/iu.test(part)) return part;
    return part.replace(differentVoice, gender === "male" ? "男" : "女").replace(differentEnglishVoice, "");
  }).join("");
}

export function workflowCreationDraft(run: PlanCenterRun, item: PlanCenterItem) {
  if (run.snapshot.material.source !== "workflow") return run.snapshot.creationDraft;
  const material = item.material;
  if (material?.source !== "workflow") throw Error("WORKFLOW_LYRICS_EVIDENCE_REQUIRED");
  const gender = run.snapshot.workflowSnapshot?.artist.gender ??
    (run.snapshot.workflow?.graph ? run.snapshot.artistSnapshot?.defaults.voice : undefined);
  const music = workflowBrowserMusic(run.snapshot.workflow);
  const fields = music ? mappedMusicDraft(run.snapshot, music.inputs, material) : {
    title: material.title, lyrics: run.snapshot.songType === "instrumental" ? "" : material.lyrics, style: material.musicPrompt,
    ...(material.alternateTitle ? { alternateTitle: material.alternateTitle } : {}),
  };
  const vocalGender = run.snapshot.songType === "vocal" && (gender === "male" || gender === "female") ? gender : undefined;
  return CreationTaskDraftSchema.parse({
    ...fields,
    ...(vocalGender ? { vocalGender } : {}),
    ...(music && vocalGender && typeof fields.style === "string" ? { style: alignBrowserVocalStyle(fields.style, vocalGender) } : {}),
  });
}

export function tickPlanLyrics(s: Studio, run: PlanCenterRun, item: PlanCenterItem, next: { state: string; attemptId?: string }) {
  const center = s.planCenterService();
  const existing = next.attemptId ? center.list().stageAttempts.find(row => row.id === next.attemptId) : undefined;
  if (run.stopRequested && existing && !existing.externalTaskId) {
    if (existing.state === "unknown") center.reconcile({
      attemptId: existing.id, status: "not_found", evidenceId: existing.id, source: "system", actor: "plan-workflow",
    });
    else if (existing.state === "dispatching") center.record({
      attemptId: existing.id, status: "failed", reason: "WORKFLOW_LYRICS_STOPPED",
    });
    return;
  }
  if (existing?.externalTaskId) {
    if (!["dispatching", "waiting", "unknown"].includes(existing.state)) return;
    const lyricService = s.lyricWritingService();
    const job = run.stopRequested ? lyricService.stop(existing.externalTaskId) : lyricService.read(existing.externalTaskId);
    const record = { attemptId: existing.id, evidenceId: job.id };
    if (job.state === "complete" && !run.stopRequested) {
      const reason = job.targetScore !== undefined && !meetsLyricTarget(lyricResultVersion(job)?.review, job.targetScore)
        ? "LYRIC_BEST_DRAFT_ADOPTED" : undefined;
      if (existing.state === "unknown") center.reconcile({ ...record, status: "succeeded", reason, source: "provider", actor: "lyric-writing" });
      else center.record({ ...record, status: "succeeded", reason });
    } else if (job.state === "unknown") {
      if (existing.state !== "unknown") center.record({ attemptId: existing.id, status: "unknown", reason: job.reason ?? "TEXT_OUTCOME_UNKNOWN" });
    } else if (["blocked", "rejected", "stopped", "complete"].includes(job.state)) {
      const reason = job.reason ?? (run.stopRequested || job.state === "stopped" ? "WORKFLOW_LYRICS_STOPPED" : "LYRIC_SCORE_BELOW_THRESHOLD");
      if (existing.state === "unknown") center.reconcile({ ...record, status: "failed", reason, source: "provider", actor: "lyric-writing" });
      else center.record({ ...record, status: "failed", reason });
    }
    return;
  }
  if (run.stopRequested || !["ready", "dispatching"].includes(next.state)) return;
  const workflow = run.snapshot.workflow!;
  s.repo.transaction(() => {
    const attempt = existing ?? center.claim({ runId: run.id, itemId: item.id, stage: "lyric_write" });
    if (!("id" in attempt) || typeof attempt.id !== "string" || !("ordinal" in attempt) ||
        typeof attempt.ordinal !== "number" || attempt.state !== "dispatching") return;
    const { id: attemptId, ordinal } = attempt;
    try {
      const issue = planWorkflowIssue(s.repo, run.snapshot, "run");
      if (issue) throw Error(issue);
      const { artistSnapshot, workflowSnapshot, routeSnapshot } = run.snapshot;
      const text = routeSnapshot!.text;
      const previous = ordinal > 1
        ? center.list().stageAttempts.findLast(row => row.runId === run.id && row.itemId === item.id &&
          row.stage === "lyric_write" && row.ordinal < ordinal && row.externalTaskId)
        : undefined;
      const retrySource = previous?.externalTaskId && previous.state === "failed" &&
        (previous.reason === "LYRIC_SCORE_BELOW_THRESHOLD" || previous.reason === "LYRIC_REVIEW_INVALID" ||
          run.snapshot.songType === "vocal" && canResumeLyricResponse(previous.reason))
        ? { jobId: previous.externalTaskId, attemptId: previous.id } : undefined;
      s.repo.transaction(() => {
        const job = s.lyricWritingService().startForPlan({
          id: randomUUID(), mode: workflow.mode, inspiration: workflow.inspiration, artistId: run.snapshot.artistId,
          expectedSongType: run.snapshot.songType, profileId: text.profileId, profileRevision: text.profileRevision,
          maxRewrites: workflow.maxRewrites, targetScore: workflow.targetScore, consent: true,
        }, attemptId, retrySource, {
          ...artistSnapshot!, profile: workflowSnapshot!.artist,
          promptTemplateId: workflowSnapshot!.template?.id,
        });
        center.record({ attemptId, status: "waiting", externalTaskId: job.id });
      });
    } catch (error) {
      const reason = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "TEXT_CONFIGURATION_REQUIRED";
      center.record({ attemptId, status: "failed", reason });
    }
  });
}
