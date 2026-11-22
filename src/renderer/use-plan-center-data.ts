import { useCallback } from 'react';
import type { PlanCenterHistory, PlanCenterRunDetail, PlanDashboardRow } from '../shared/plan-center';
import { useStudio, useStudioRequest } from './context';
import { useCenterQuery } from './use-center-query';

export function usePlanCenterData(planId: string | undefined, runId: string) {
  const request = useStudioRequest();
  const { data } = useStudio();
  const list = useCallback((): Promise<PlanDashboardRow[]> => request('planCenter.dashboard'), [request, data.mode]);
  const loadHistory = useCallback((): Promise<PlanCenterHistory> => request('planCenter.history', { id: planId }), [request, planId, data.mode]);
  const loadRun = useCallback((): Promise<PlanCenterRunDetail> => request('planCenter.runDetail', { runId }), [request, runId, data.mode]);
  const dashboard = useCenterQuery(list);
  const history = useCenterQuery(planId ? loadHistory : null, { interval: runId ? 0 : 4000 });
  const run = useCenterQuery(runId ? loadRun : null);
  const refresh = () => Promise.all([dashboard.refresh(), history.refresh(), run.refresh()]);
  return { dashboard, history, run, refresh };
}
