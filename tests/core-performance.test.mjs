import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { compileFunction } from 'node:vm';
import test from 'node:test';
import { build } from 'esbuild';

const compiled = await build({
  stdin: { resolveDir: process.cwd(), contents: `
    export { Studio } from './src/core/studio';
    export { tickPlanCenter } from './src/core/plan-center-integration';
    export { listApiProfiles } from './src/core/api-profiles';
    export { createCoreRequestQueue } from './src/core/request-queue';
  ` },
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
});
const mod = { exports: {} };
compileFunction(compiled.outputFiles[0].text, ['module', 'exports', 'require', '__dirname'])(
  mod, mod.exports, createRequire(import.meta.url), process.cwd(),
);
const { Studio, tickPlanCenter, listApiProfiles, createCoreRequestQueue } = mod.exports;

test('slow timer checks coalesce both while queued and running so user requests can proceed', async () => {
  const queue = createCoreRequestQueue(), blocked = Promise.withResolvers(), checking = Promise.withResolvers();
  const events = [];
  const first = queue.enqueue(() => blocked.promise);
  const tick = () => { events.push('tick'); return checking.promise; };
  const scheduled = queue.tick(tick);
  for (let i = 0; i < 30; i++) assert.equal(queue.tick(tick), scheduled);
  const userRequest = queue.enqueue(() => events.push('user'));
  blocked.resolve();
  await first;
  await Promise.resolve();
  assert.deepEqual(events, ['tick']);
  for (let i = 0; i < 30; i++) assert.equal(queue.tick(tick), scheduled);
  checking.resolve();
  await userRequest;
  assert.deepEqual(events, ['tick', 'user']);
  await queue.tick(() => events.push('next tick'));
  assert.deepEqual(events, ['tick', 'user', 'next tick']);
});

test('failed requests and timer checks do not block subsequent work', async () => {
  const queue = createCoreRequestQueue();
  await assert.rejects(queue.enqueue(() => { throw Error('FAILED_REQUEST'); }), /FAILED_REQUEST/);
  await assert.rejects(queue.tick(() => { throw Error('FAILED_CHECK'); }), /FAILED_CHECK/);
  assert.equal(await queue.enqueue(() => 'ready'), 'ready');
  let checked = false;
  await queue.tick(() => { checked = true; });
  assert.equal(checked, true);
});

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rainfall-performance-'));
  const studio = new Studio(root, 'production');
  t.after(() => studio.repo.close());
  return studio;
}

test('model selection reads only profiles even with large unrelated history', t => {
  const studio = setup(t);
  studio.repo.transaction(() => {
    for (let i = 0; i < 500; i++) studio.save('settings', { id: 'unrelated-history:' + i, value: 'x'.repeat(4096) });
  });
  const all = studio.repo.all.bind(studio.repo);
  t.mock.method(studio.repo, 'all', table => {
    assert.notEqual(table, 'settings', 'model checks must not decode unrelated history');
    return all(table);
  });
  assert.deepEqual(listApiProfiles(studio.repo), []);
});

test('stopped plan history does not cause a full dashboard read for every item', t => {
  const studio = setup(t), center = studio.planCenterService();
  const artistId = studio.all('artists')[0].id;
  for (let i = 0; i < 12; i++) {
    const plan = center.save({ expectedRevision: null, plan: {
      id: randomUUID(), title: '后台检查样本', artistId, enabled: false,
      schedule: { kind: 'daily', localTime: '09:00' }, count: 2, theme: '晚风',
      material: { source: 'dot', channel: 'fixture', identity: 'fixture' },
      text: { threshold: 75, maxRewrites: 2, maxScoreRetries: 2 },
      music: { route: 'manual', versionPolicy: 'first' }, publishTargets: [],
      catchUp: { mode: 'latest', limit: 1 },
    } });
    const preview = center.preview({ id: plan.id });
    const run = center.run({ id: plan.id, expectedRevision: plan.revision, summaryHash: preview.summaryHash,
      requestId: randomUUID(), source: 'manual' });
    center.stop({ runId: run.id });
  }
  const before = center.list();
  const list = center.list.bind(center);
  let dashboardReads = 0;
  t.mock.method(center, 'list', () => { dashboardReads++; return list(); });
  tickPlanCenter(studio);
  assert.ok(dashboardReads < 12, `one tick read the entire plan dashboard ${dashboardReads} times`);
  assert.deepEqual(list(), before, 'checking settled history must not change it');
});
