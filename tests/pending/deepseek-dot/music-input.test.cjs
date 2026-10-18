const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path'), { randomUUID } = require('node:crypto');
const w = require(process.env.RAINFALL_INBOX_BUNDLE);
const { draft } = require('../../fixtures/workflow.cjs');

function setup(t) {
  const studio = new w.Studio(path.resolve('output/test-runs', 'inbox-music-input-' + randomUUID()), 'production');
  t.after(() => studio.close());
  const artistId = studio.all('artists')[0].id;
  const channel = { id: 'unit-channel', workspaceId: 'unit-workspace', workspaceRef: 'unit', artistRefs: { creator: artistId }, seriesRefs: {} };
  const inbox = new w.InboxService(studio.repo, channel);
  const item = { externalItemId: 'song', revision: 1, parentRevision: null, artistRef: 'creator', seriesRef: null, draft: draft(), provenance: { producer: 'dot', model: 'declared-model', promptVersion: 'declared-v1', generatedAt: '2026-10-15T00:00:00Z' } };
  const imported = inbox.importPackage({ schemaVersion: 1, batchId: 'first', targetWorkspaceRef: 'unit', createdAt: '2026-10-15T00:00:00Z', items: [item] });
  return { studio, inbox, item, candidateId: imported.items[0].candidateId, originalId: imported.items[0].draftId };
}

test('manual inbox selection creates an immutable music input with provenance, without scoring or generation', async t => {
  const { studio: s, candidateId, originalId } = setup(t);
  const original = s.get('drafts', originalId), before = JSON.stringify(original);
  const selected = await s.call('inbox.selectMusicInput', { candidateId, confirmed: true });
  assert.notEqual(selected.id, originalId);
  assert.equal(selected.source, 'local-inbox');
  assert.equal(selected.parentDraftId, originalId);
  assert.match(selected.pairHash, /^[a-f0-9]{64}$/);
  assert.equal(selected.pair.revisionId, selected.id);
  assert.equal(selected.pair.generator.modelVersion, 'declared-unverified');
  assert.equal(selected.pair.capability.verified, false);
  assert.equal(selected.inputSelection.candidateId, candidateId);
  assert.equal(selected.inputSelection.externalRevision, 1);
  assert.equal(selected.inputSelection.provenance.producer, 'dot');
  assert.equal(selected.qualityState, 'not_evaluated');
  assert.equal(s.get('creativeSessions', selected.sessionId).draftId, selected.id);
  assert.equal(s.get('creativeTurns', selected.turnId).state, 'manual_input');
  assert.equal(JSON.stringify(s.get('drafts', originalId)), before);
  assert.equal((await s.call('inbox.listCandidates')).musicInput.id, selected.id);
  assert.equal((await s.call('inbox.selectMusicInput', { candidateId, confirmed: true })).id, selected.id);
  assert.equal(s.all('evaluations').length, 0);
  assert.equal(s.all('operations').length, 0);
  assert.equal(s.all('workflowLedger').length, 0);
  const op = await s.call('music.prepare', { requestId: randomUUID(), draftId: selected.id, expectedPairHash: selected.pairHash, accountRef: 'unconfigured', modelId: 'chirp-v6', candidateLimit: 2, budgetLimit: 0 });
  assert.equal(op.state, 'blocked');
  assert.ok(op.reasons.includes('QUALITY_NOT_PASSED'));
  assert.equal(s.externalRequests, 0);
});

test('manual inbox selection requires confirmation and rejects stale, failed or incomplete candidates', async t => {
  const { studio: s, candidateId } = setup(t);
  await assert.rejects(s.call('inbox.selectMusicInput', { candidateId, confirmed: false }));
  const candidate = s.get('textCandidates', candidateId);
  for (const patch of [{ isCurrent: false }, { lineageState: 'lineage_pending' }, { localCheck: { status: 'failed', issues: [] } }]) {
    s.save('textCandidates', { ...candidate, ...patch });
    await assert.rejects(s.call('inbox.selectMusicInput', { candidateId, confirmed: true }), /INBOX_INPUT_NOT_READY/);
  }
  assert.equal(s.all('creativeSessions').length, 0);
  assert.equal(s.all('operations').length, 0);
});

test('a later inbox revision cannot replace a manually selected version snapshot', async t => {
  const { studio: s, inbox, item, candidateId } = setup(t);
  const selected = await s.call('inbox.selectMusicInput', { candidateId, confirmed: true });
  const snapshot = JSON.stringify(selected);
  inbox.importPackage({ schemaVersion: 1, batchId: 'second', targetWorkspaceRef: 'unit', createdAt: '2026-10-15T00:00:00Z', items: [{ ...item, revision: 2, parentRevision: 1, draft: { ...item.draft, title: 'A later title' } }] });
  assert.equal(JSON.stringify((await s.call('inbox.listCandidates')).musicInput), snapshot);
  await assert.rejects(s.call('inbox.selectMusicInput', { candidateId, confirmed: true }), /INBOX_INPUT_NOT_READY/);
  assert.equal(s.all('creativeSessions').length, 1);
});

test('ordinary music download retry resets original downloads and never submits generation', async t => {
  const s = new w.Studio(path.resolve('output/test-runs', 'ordinary-download-retry-' + randomUUID()), 'production');
  t.after(() => s.close());
  let submissions = 0, downloads = 0;
  const service = s.musicService();
  service.options.adapter = { source: 'external', submit: async () => { submissions++; throw Error('MUST_NOT_SUBMIT'); }, query: async ids => ({ state: 'known', songs: ids.map(id => ({ id, status: 'succeeded', audio_url: 'https://oss.yourmusic.fun/' + id + '.wav' })) }), download: async () => { downloads++; return { bytes: Buffer.from('offline fixture'), mime: 'audio/wav' }; } };
  service.options.ingest = async () => ({ id: randomUUID() });
  const id = randomUUID(), songs = ['original-a', 'original-b'];
  s.save('operations', { id, operationKey: id, kind: 'music', state: 'polling', costState: 'settled', songIds: songs, createdAt: new Date().toISOString(), queryErrors: 0, reasons: [] });
  songs.forEach((song, ordinal) => s.save('candidates', { id: randomUUID(), operationId: id, providerOutputId: song, outputIdentity: song, ordinal, state: 'download_failed', downloadAttempts: 4 }));
  await s.call('music.retryDownloads', { id });
  for (let i = 0; i < 100 && s.all('candidates').some(c => c.state !== 'ready'); i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(submissions, 0);
  assert.equal(downloads, 2);
  assert.equal(s.all('operations').length, 1);
  assert.deepEqual(s.get('operations', id).songIds, songs);
  assert.ok(s.all('candidates').every(c => c.state === 'ready' && c.previousDownloadAttempts === 4 && c.downloadAttempts === 1));
  assert.equal(s.all('workflowLedger').length, 0);
});
