import { isPlanCenterDefinition, planRunBlocksDeletion,
  type PlanCenterHistory, type PlanCenterItem, type PlanCenterRun, type PlanCenterRunDetail,
  type PlanDashboardRow, type PlanRunSummary } from '../shared/plan-center';
import { isLocalPublicationWorkflow } from '../shared/plan-workflow-graph';
import { planAssetsCatalog, planMaterialPreview } from './plan-center-assets';
import { planCatalog } from './plan-center-catalog';
import { planDotStatus } from './plan-center-dot';
import { syncPlanMusic } from './plan-center-music';
import { planPublicationStatus } from './plan-center-publication';
import { CenterStore, digest } from './plan-center/storage';
import { planFanqieJobsForRun } from './plan-fanqie';
import { fanqieDirectoryCleanupStatus, fanqieDirectoryDiagnostics } from './plan-fanqie-directory';
import { refreshPlanArtist } from './plan-workflow';
import { listWorkflowPublications, readWorkflowPublication } from './plan-workflow-publication';
import { providerTextService } from './provider-plan-text';
import type { Studio } from './studio';

function runSummary({ id, state, source, createdAt, stopRequested }: PlanCenterRun): PlanRunSummary {
  return { id, state, source, createdAt, stopRequested };
}

function newestFirst(runs: PlanCenterRun[]) {
  return runs.reverse().sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

export function readPlanDashboard(store: CenterStore): PlanDashboardRow[] {
  const plans = store.all('plan').filter(isPlanCenterDefinition);
  const runs = newestFirst(store.all('run', { field: 'planId', values: plans.map(plan => plan.id) }));
  const blocked = runs.filter(run => run.state === 'blocked').map(run => run.id);
  const scope = { field: 'runId' as const, values: blocked };
  const activity = {
    stageAttempts: store.all('stage', scope),
    publishAttempts: store.all('publish', scope),
    albumBindings: store.all('album', { field: 'createdByRunId', values: blocked }),
  };
  const rows = new Map(plans.map(plan => [plan.id, {
    plan: refreshPlanArtist(store.repo, plan), deleteBlocked: false, stopsOnDelete: false,
  } as PlanDashboardRow]));
  for (const run of runs) {
    const row = rows.get(run.planId);
    if (!row) continue;
    row.latest ??= runSummary(run);
    const blocksDeletion = planRunBlocksDeletion(run, activity);
    if (blocksDeletion) row.active ??= runSummary(run);
    if (run.state === 'blocked') row.stopsOnDelete = true;
    if (blocksDeletion) row.deleteBlocked = true;
  }
  return [...rows.values()];
}

export function readPlanHistory(store: CenterStore, id: string): PlanCenterHistory {
  const runs = newestFirst(store.all('run', { field: 'planId', values: [id] }));
  const completed = new Map<string, number>();
  for (const item of store.all('item', { field: 'runId', values: runs.map(run => run.id) })) {
    if (item.state === 'completed') completed.set(item.runId, (completed.get(item.runId) ?? 0) + 1);
  }
  const legacy = store.all('migration').at(-1)?.entries.find(entry => entry.planId === id);
  return { runs: runs.map(run => ({ ...runSummary(run), count: run.snapshot.count, completed: completed.get(run.id) ?? 0,
    local: isLocalPublicationWorkflow(run.snapshot.workflow?.graph) })), legacyHistory: legacy?.history ?? {} };
}

export function readPlanExecutionStatus(s: Studio, runs: PlanCenterRun[], items: PlanCenterItem[], selected?: PlanCenterRun) {
  const byId = new Map(runs.map(run => [run.id, run]));
  const materialSource = selected?.snapshot.material.source;
  const workflowPublication = selected && readWorkflowPublication(s.repo, selected.id);
  const text = !selected || materialSource === 'provider' ? providerTextService(s).list(selected?.id) : [];
  const legacyMaterials = !selected || ((selected.snapshot.outputs.music || selected.snapshot.authorization.publish) &&
    !selected.snapshot.workflow && materialSource !== 'creation' &&
    (materialSource !== 'pule_prompt' || !selected.snapshot.fanqie || !selected.snapshot.authorization.publish));
  return {
    workflowPublications: selected ? (workflowPublication ? [workflowPublication] : []) : listWorkflowPublications(s.repo),
    providerText: text.map(({ id, runId, itemId, phase, state, reason, currency, spentMicros, reservedMicros, versions, draftId }) => ({
      id, runId, itemId, phase, state, reason, currency, spentMicros, reservedMicros,
      versions: versions.map(version => ({ id: version.id, title: version.draft.title, scene: version.draft.storyBeat,
        lyrics: version.pair.lyrics, score: version.score?.overall, final: state === 'complete' && version.id === draftId })),
    })),
    dot: !selected || materialSource === 'dot' ? planDotStatus(s, selected?.id) : undefined,
    publication: planPublicationStatus(s, selected?.id),
    music: items.flatMap<Record<string, unknown>>(item => {
      try {
        const state = syncPlanMusic(s, byId.get(item.runId)!, item);
        return state ? [{ itemId: item.id, ...state }] : [];
      } catch (error) { return [{ itemId: item.id, reason: error instanceof Error ? error.message : 'MUSIC_SCOPE_INVALID' }]; }
    }),
    materials: legacyMaterials ? items.flatMap<Record<string, unknown>>(item => {
      if (!item.workId) return [];
      try { return [{ itemId: item.id, ...planMaterialPreview(s, item.id) }]; }
      catch (error) { return [{ itemId: item.id, reason: error instanceof Error ? error.message : 'MATERIALS_INVALID' }]; }
    }) : [],
    ...(selected && { fanqie: planFanqieJobsForRun(s, selected.id, workflowPublication?.dispatch?.fanqieIds) }),
  };
}

export function readPlanRunDetail(s: Studio, store: CenterStore, runId: string): PlanCenterRunDetail {
  const run = store.get('run', runId);
  if (!run) throw Error('NOT_FOUND');
  const scope = { field: 'runId' as const, values: [runId] };
  const items = store.all('item', scope);
  const execution = readPlanExecutionStatus(s, [run], items, run);
  const fanqieCleanup = s.mode === 'production' ? fanqieDirectoryCleanupStatus(s.root, run) : undefined;
  const fanqieDiagnostics = s.mode === 'production' && !!fanqieDirectoryDiagnostics(s.root, run);
  const workPicker = run.snapshot.outputs.music && run.snapshot.music.route === 'manual' && items.some(item => !item.workId);
  const catalog = execution.publication.length ? planCatalog(s.repo) : undefined;
  const stageAttempts=store.all('stage',scope).map(attempt=>({...attempt,observations:attempt.observations?.map(observation=>({...observation,evidenceId:redactPlanEvidenceId(observation.evidenceId)}))}));
  return { run, items, execution, fanqieCleanup, fanqieDiagnostics, stageAttempts, publishAttempts: store.all('publish', scope),
    catalog: workPicker ? { ...catalog, works: planAssetsCatalog(s, run.snapshot.artistId) } : catalog };
}

function redactPlanEvidenceId(value:string) {
  const normalized=value.trim();
  if(!normalized)return '…';
  return `sha256:${digest(normalized).slice(0,16)}…${normalized.slice(-4)}`;
}
