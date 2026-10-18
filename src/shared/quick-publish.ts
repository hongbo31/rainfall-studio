export type RecordingSelection = { workId: string; slot: 'audio_A' | 'audio_B' };
export type QuickPublishInput = {
  workIds: string[];
  targets: string[];
  recordings: RecordingSelection[];
  accountOverrides: Record<string, string>;
};
type Workspace = { mode: string; works: any[]; accounts: any[]; bindings: any[] };
// Pure local resolution, shared by UI and Core. It never grants authorization.
export function resolveQuickPublish(data: Workspace, input: QuickPublishInput) {
  const issues: string[] = [], destinations: any[] = [];
  const ids = [...new Set(input.workIds)].sort();
  const works = ids.map(id => data.works.find(w => w.id === id)).filter(Boolean);
  if (!ids.length) issues.push('请选择音乐。');
  if (works.length !== ids.length) issues.push('所选音乐已不存在，请重新选择。');
  const artistIds = new Set(works.map(w => w.artistId));
  if (artistIds.size > 1) issues.push('同批请选择同一艺人的音乐。');
  const targets = [...new Set(input.targets)].sort();
  if (!targets.length) issues.push('请选择发布平台。');
  for (const r of input.recordings) {
    const w = works.find(w => w.id === r.workId);
    if (!w || !w.assets?.[r.slot]) issues.push('所选录音不存在或不属于本批音乐。');
  }
  const recordings: RecordingSelection[] = [];
  for (const w of works) {
    const slots = [...new Set(input.recordings.filter(r => r.workId === w.id).map(r => r.slot))].sort();
    if (!slots.length && w.assets?.audio_B) issues.push(`《${w.title}》请选择录音 A、B 或两版。`);
    else for (const slot of slots.length ? slots : ['audio_A' as const]) recordings.push({workId:w.id,slot});
  }
  const options: Record<string, { account: any; binding: any; eligible: boolean }[]> = {};
  for (const target of targets) {
    const candidates = data.bindings.filter(b => b.artistId === works[0]?.artistId && b.status !== 'revoked' && b.targets.includes(target))
      .map(binding => ({binding, account:data.accounts.find(a => a.id === binding.accountId)}))
      .filter(({account}) => account && (account.provider === target || (account.provider === 'tme' && ['qqmusic','kugou'].includes(target))))
      .map(c => ({...c, eligible:data.mode === 'simulation'
        ? c.account.authStatus === 'simulation'
        : c.account.authStatus === 'connected' && !!c.account.remoteSubject}));
    options[target] = candidates;
    const override = input.accountOverrides[target];
    const available = candidates.filter(c => c.eligible);
    const match = override ? candidates.find(c => c.account.id === override) : available.length === 1 ? available[0] : undefined;
    if (artistIds.size !== 1) continue;
    if (match?.eligible) destinations.push({target,accountId:match.account.id,bindingId:match.binding.id,kind:target === 'douyin' ? 'video_post' : 'audio_distribution'});
    else if (!override && available.length > 1) issues.push(`${target} 有多个有效账号，请在页面内选择。`);
    else issues.push(`${target} 缺少已核实授权与艺人绑定的账号，请检查授权状态。`);
  }
  return {issues:[...new Set(issues)],destinations,recordings,options};
}
