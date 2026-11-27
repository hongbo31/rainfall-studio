import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const built = await build({ entryPoints: ['src/renderer/snapshot-refresh.ts'], bundle: true,
  platform: 'node', format: 'esm', write: false });
const { createSnapshotRefresh } = await import('data:text/javascript;base64,' +
  Buffer.from(built.outputFiles[0].contents).toString('base64'));

test('background polls share a slow request and unchanged snapshots do not redraw', async () => {
  const pending = Promise.withResolvers(), applied = [];
  let reads = 0;
  const reader = createSnapshotRefresh(() => { reads++; return pending.promise; }, value => applied.push(value));
  const first = reader.poll();
  for (let i = 0; i < 50; i++) assert.equal(reader.poll(), first);
  pending.resolve({ mode: 'production', works: [] });
  await first;
  assert.equal(reads, 1);
  await reader.poll();
  assert.equal(reads, 2);
  assert.equal(applied.length, 1);
});

test('mutations coalesce a fresh read and suppress the response predating the mutation', async () => {
  const old = Promise.withResolvers(), fresh = Promise.withResolvers(), applied = [];
  let reads = 0;
  const reader = createSnapshotRefresh(() => ++reads === 1 ? old.promise : fresh.promise, value => applied.push(value));
  const initial = reader.poll();
  await Promise.resolve();
  const changed = reader.refresh();
  assert.equal(reader.refresh(), changed);
  assert.equal(reader.poll(), changed);
  old.resolve({ mode: 'production', works: [] });
  await initial;
  assert.deepEqual(applied, []);
  fresh.resolve({ mode: 'simulation', works: [{ id: 'new-work' }] });
  await changed;
  assert.equal(reads, 2);
  assert.deepEqual(applied, [{ mode: 'simulation', works: [{ id: 'new-work' }] }]);
});

test('a mutation during the follow-up read waits for another current result', async () => {
  const gates = Array.from({ length: 3 }, () => Promise.withResolvers()), applied = [];
  let reads = 0;
  const reader = createSnapshotRefresh(() => gates[reads++].promise, value => applied.push(value));
  const initial = reader.poll(), firstSave = reader.refresh();
  gates[0].resolve(0);
  await initial;
  // Allow the queued follow-up to start before a second save completes.
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(reads, 2);
  const secondSave = reader.refresh();
  gates[1].resolve(1);
  await firstSave;
  gates[2].resolve(2);
  await secondSave;
  assert.deepEqual(applied, [2]);
});

test('refresh after a failed in-flight read still succeeds and a fresh failure is reported', async () => {
  const pending = Promise.withResolvers();
  let reads = 0;
  const applied = [];
  const reader = createSnapshotRefresh(() => ++reads === 1 ? pending.promise : Promise.resolve('ready'), value => applied.push(value));
  const failure = assert.rejects(reader.poll(), /unavailable/);
  const changed = reader.refresh();
  pending.reject(Error('unavailable'));
  await failure;
  await changed;
  assert.deepEqual(applied, ['ready']);
  await assert.rejects(createSnapshotRefresh(() => Promise.reject(Error('failed')), () => {}).refresh(), /failed/);
});
