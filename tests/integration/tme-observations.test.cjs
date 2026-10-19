const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { Studio, cleanTmeLyrics } = require('../../build/core.cjs');

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rainfall-observation-'));
  const s = new Studio(root, 'production');
  const account = s.save('accounts', { id: randomUUID(), provider: 'tme', name: 'Local remark', authStatus: 'not_connected', remoteSubject: null });
  const work = s.saveWork({ title: 'Original A', artistId: s.all('artists')[0].id, story: 'Fixture', lyrics: 'Original lyrics', prompt: '', parameters: {}, rights: 'Fixture rights', ai: 'generated' });
  const bytes = Buffer.from('Synthetic source A audio identity');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const dir = path.join(root, 'media', 'sha256', sha256.slice(0, 2));
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, sha256 + '.m4a'), bytes);
  const audio = s.save('assets', { id: randomUUID(), sha256, mime: 'audio/mp4', kind: 'audio', ext: 'm4a', bytes: bytes.length });
  work.assets.audio_A = audio.id;
  s.save('works', work);
  const input = {
    workId: work.id, accountId: account.id, visibleAccount: 'Observed official nickname',
    remoteId: null, status: 'prepared', officialUrl: 'https://y.tencentmusic.com/#/user/manage/aiChoose/add',
    observedAt: new Date(Date.now() - 60000).toISOString(),
    evidence: { summary: 'Official page displays populated form only; no submit acknowledgement.', reference: 'output/fixture-observation.png', sha256: 'b'.repeat(64) },
    audioEvidence: { sourceASha256: audio.sha256, pcmSha256: 'c'.repeat(64), derivation: 'pcm_format_compatibility', note: '48 kHz stereo PCM24 conversion of source A; not a new generation.' },
  };
  return { root, s, account, work, input };
}

test('official observation persists absent remote ID and preserves factual status without granting submission authority', async () => {
  const x = setup(); let reopened;
  try {
    const result = await x.s.call('tme.observations.record', x.input);
    assert.equal(result.remoteId, null);
    assert.equal(result.status, 'prepared');
    assert.equal(result.submissionByClient, false);
    assert.equal(result.verification, 'user_report');
    assert.equal(result.source, 'official_page_observation');
    assert.deepEqual(result.audioEvidence, x.input.audioEvidence);
    assert.equal(result.workRevision, x.work.revision);
    assert.equal(x.s.get('accounts', x.account.id).authStatus, 'not_connected');
    for (const table of ['batches', 'units', 'claims', 'ledger', 'targets']) assert.equal(x.s.all(table).length, 0);
    assert.equal(x.s.externalRequests, 0);
    x.s.close(); reopened = new Studio(x.root, 'production');
    assert.equal((await reopened.call('tme.observations.list', { workId: x.work.id }))[0].id, result.id);
  } finally { (reopened || x.s).close(); }
});

test('same evidence is idempotent across repeat clicks and conflicting reuse is rejected', async () => {
  const x = setup(); try {
    const first = await x.s.call('tme.observations.record', x.input);
    const second = await x.s.call('tme.observations.record', { ...x.input, observedAt: new Date(Date.parse(x.input.observedAt) + 1000).toISOString() });
    assert.equal(second.id, first.id);
    assert.equal(second.observedAt, x.input.observedAt);
    await assert.rejects(x.s.call('tme.observations.record', { ...x.input, status: 'released' }), /OBSERVATION_EVIDENCE_CONFLICT/);
    const other = x.s.save('accounts', { ...x.account, id: randomUUID(), name: 'Another local remark' });
    await assert.rejects(x.s.call('tme.observations.record', { ...x.input, accountId: other.id }), /OBSERVATION_EVIDENCE_CONFLICT/);
    assert.equal((await x.s.call('tme.observations.list', {})).length, 1);
  } finally { x.s.close(); }
});

test('page states stay distinct and records append instead of inventing review or release success', async () => {
  const x = setup(); try {
    for (const [index, status] of ['draft', 'prepared', 'submitted', 'reviewing', 'released', 'rejected', 'unknown'].entries()) {
      const r = await x.s.call('tme.observations.record', { ...x.input, status, remoteId: index > 1 ? 'official-song-17' : null, evidence: { ...x.input.evidence, sha256: String(index + 1).repeat(64) } });
      assert.equal(r.status, status); assert.equal(r.submissionByClient, false);
    }
    assert.equal((await x.s.call('tme.observations.list', {})).length, 7);
    assert.equal(x.s.all('claims').length, 0);
  } finally { x.s.close(); }
});

test('observation rejects forged authority, missing evidence, unofficial URL, invalid time and unrelated source A', async () => {
  const x = setup(); try {
    for (const input of [
      { ...x.input, submissionByClient: true }, { ...x.input, evidence: undefined },
      { ...x.input, observedAt: 'not a time' }, { ...x.input, observedAt: '2999-01-01T00:00:00.000Z' },
      { ...x.input, officialUrl: 'https://example.com/#/user/manage/aiChoose/add' },
      { ...x.input, officialUrl: 'https://secret@y.tencentmusic.com/' },
      { ...x.input, audioEvidence: { ...x.input.audioEvidence, sourceASha256: 'd'.repeat(64) } },
      { ...x.input, audioEvidence: { ...x.input.audioEvidence, pcmSha256: x.input.audioEvidence.sourceASha256 } },
    ]) await assert.rejects(x.s.call('tme.observations.record', input));
    assert.equal((await x.s.call('tme.observations.list', {})).length, 0);
  } finally { x.s.close(); }
});

test('a backup cannot erase official observations recorded after its snapshot', async () => {
  const x = setup(); try {
    const archive = path.join(x.root, 'before-observation.zip');
    await x.s.backup(archive);
    await x.s.call('tme.observations.record', x.input);
    await assert.rejects(x.s.restore(archive), /RESTORE_POST_SNAPSHOT_TME_OBSERVATION/);
    assert.equal((await x.s.call('tme.observations.list', {})).length, 1);
  } finally { x.s.close(); }
});

test('numbered chorus and pre-chorus section lines are removed without altering inline lyrics or unknown brackets', () => {
  const raw = '[Chorus 1]\nFirst lyric\n[Pre-Chorus 2]\nSecond lyric\n[Final Chorus 3 - full band]\nInline [Chorus 1] lyric\n[Unknown Chorus 4]';
  const result = cleanTmeLyrics(raw);
  assert.equal(result.raw, raw);
  assert.equal(result.cleaned, 'First lyric\nSecond lyric\nInline [Chorus 1] lyric\n[Unknown Chorus 4]');
  assert.equal(result.removed.length, 3);
  assert.equal(result.warnings.length, 2);
});
