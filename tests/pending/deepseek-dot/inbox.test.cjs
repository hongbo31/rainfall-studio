// Offline development units; isolated fake data only. Not user acceptance.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const w = require(process.env.RAINFALL_INBOX_BUNDLE);
const { draft } = require('../../fixtures/workflow.cjs');

function setup(t) {
  const root = path.resolve('output/test-runs', 'inbox-' + randomUUID());
  fs.mkdirSync(root, { recursive: true });
  const repo = new w.Repository(path.join(root, 'library.sqlite'));
  t.after(() => repo.close());
  const artistId = randomUUID();
  repo.save('artists', { id: artistId, name: '本地测试艺人', revision: 1 });
  const channel = { id: 'local-dot-channel', workspaceId: 'workspace-test',
    workspaceRef: 'rainfall-test', artistRefs: { creator: artistId }, seriesRefs: {} };
  const service = new w.InboxService(repo, channel);
  const item = { externalItemId: 'rain-series-001', revision: 1, parentRevision: null,
    artistRef: 'creator', seriesRef: null, draft: draft(),
    provenance: { producer: 'dot', model: null, promptVersion: null,
      generatedAt: '2026-10-15T09:00:00+08:00' } };
  const envelope = { schemaVersion: 1, batchId: 'batch-20261015-a',
    createdAt: '2026-10-15T09:00:00+08:00', targetWorkspaceRef: 'rainfall-test', items: [item] };
  return { root, repo, service, channel, envelope, item };
}

// Break caught: repeated delivery inserts another draft/candidate or starts generation.
test('committed package retry returns the same candidate without generation or scoring', (t) => {
  const x = setup(t);
  const first = x.service.importPackage(x.envelope);
  const second = x.service.importPackage(structuredClone(x.envelope));
  assert.equal(first.status, 'imported');
  assert.equal(second.items[0].candidateId, first.items[0].candidateId);
  assert.equal(second.items[0].draftId, first.items[0].draftId);
  assert.equal(x.repo.all('textCandidates').length, 1);
  assert.equal(x.repo.all('drafts').length, 1);
  assert.equal(first.items[0].evaluationState, 'model_pending');
  for (const table of ['operations', 'creativeTurns', 'candidates', 'dailyPlans', 'occurrences', 'workflowLedger', 'selectionEvents'])
    assert.equal(x.repo.all(table).length, 0, table);
});

// Break caught: dedup tied only to batch ID; same item in a new delivery duplicates it.
test('item identity survives a different batch and reordered object keys', (t) => {
  const x = setup(t);
  const first = x.service.importPackage(x.envelope);
  const item = { provenance: x.item.provenance, draft: x.item.draft, seriesRef: null,
    artistRef: 'creator', parentRevision: null, revision: 1, externalItemId: 'rain-series-001' };
  const next = x.service.importPackage({ ...x.envelope, batchId: 'retry-new-envelope', items: [item] });
  assert.equal(next.items[0].candidateId, first.items[0].candidateId);
  assert.equal(x.repo.all('textCandidates').length, 1);
});

// Break caught: ID/hash conflict overwrites immutable text or partially inserts the package.
test('different content under the same item revision is a transaction conflict', (t) => {
  const x = setup(t);
  const original = x.service.importPackage(x.envelope);
  const changed = { ...x.item, draft: { ...x.item.draft, title: '冲突标题' } };
  assert.throws(() => x.service.importPackage({ ...x.envelope, batchId: 'conflict',
    items: [{ ...x.item, externalItemId: 'otherwise-valid' }, changed] }), /INBOX_IDEMPOTENCY_CONFLICT/);
  assert.equal(x.repo.all('textCandidates').length, 1);
  assert.equal(x.repo.get('drafts', original.items[0].draftId).draft.title, x.item.draft.title);
});

test('reusing a batch ID for another body never acknowledges the altered package', (t) => {
  const x = setup(t);
  x.service.importPackage(x.envelope);
  assert.throws(() => x.service.importPackage({ ...x.envelope,
    items: [{ ...x.item, externalItemId: 'different-item' }] }), /INBOX_IDEMPOTENCY_CONFLICT/);
  assert.equal(x.repo.all('textCandidates').length, 1);
});

// Break caught: package-controlled references bypass the local channel's scope.
test('workspace artist and schema validation reject the entire package', (t) => {
  const x = setup(t);
  for (const invalid of [
    { ...x.envelope, targetWorkspaceRef: 'other-workspace' },
    { ...x.envelope, items: [{ ...x.item, artistRef: 'unmapped' }] },
    { ...x.envelope, execute: 'start arbitrary program' },
    { ...x.envelope, items: [{ ...x.item, draft: { ...x.item.draft,
      hook: { sectionId: 'missing-section', startLine: 0, endLine: 1 } } }] },
    { ...x.envelope, items: [x.item, x.item] },
    { ...x.envelope, items: Array.from({ length: 21 }, (_, i) => ({ ...x.item, externalItemId: 'item-' + i })) },
  ]) assert.throws(() => x.service.importPackage(invalid));
  assert.equal(x.repo.all('textCandidates').length, 0);
  assert.equal(x.repo.all('drafts').length, 0);
});

// Break caught: late old content becomes current; missing parent is silently asserted present.
test('out-of-order revisions retain history and never lower the current revision', (t) => {
  const x = setup(t);
  x.service.importPackage({ ...x.envelope, batchId: 'version-2-first',
    items: [{ ...x.item, revision: 2, parentRevision: 1, draft: { ...x.item.draft, title: '第二版' } }] });
  let rows = x.repo.all('textCandidates');
  assert.equal(rows[0].lineageState, 'lineage_pending');
  x.service.importPackage(x.envelope);
  rows = x.repo.all('textCandidates');
  assert.equal(rows.length, 2);
  assert.equal(rows.find(c => c.isCurrent).externalRevision, 2);
  assert.equal(rows.find(c => c.externalRevision === 1).isCurrent, false);
  assert.equal(x.repo.all('seriesCheckpoints').length, 0);
});

// Break caught: self-declared producer is promoted to cryptographically verified identity.
test('candidate provenance records the local channel separately from producer claims', (t) => {
  const x = setup(t);
  x.service.importPackage(x.envelope);
  const candidate = x.repo.all('textCandidates')[0];
  assert.equal(candidate.source.channelId, 'local-dot-channel');
  assert.equal(candidate.source.producerClaim, 'dot');
  assert.equal(candidate.source.verification, 'local_channel');
  assert.equal(candidate.evaluationState, 'model_pending');
  assert.equal(candidate.assetId ?? null, null);
});

// Break caught: receiver imports partial writes or requires user to press Import.
test('receiver imports a completed startup backlog automatically and emits matching receipt', async (t) => {
  const x = setup(t);
  const incoming = path.join(x.root, 'inbox', 'incoming');
  fs.mkdirSync(incoming, { recursive: true });
  fs.writeFileSync(path.join(incoming, 'still-writing.partial'), JSON.stringify(x.envelope));
  const receiver = new w.InboxReceiver(x.service, path.join(x.root, 'inbox'));
  t.after(() => receiver.stop());
  await receiver.scanOnce();
  assert.equal(x.repo.all('textCandidates').length, 0);
  fs.writeFileSync(path.join(incoming, x.envelope.batchId + '.json'), JSON.stringify(x.envelope));
  await receiver.scanOnce();
  assert.equal(x.repo.all('textCandidates').length, 1);
  const receiptPath = path.join(x.root, 'inbox', 'receipts', x.envelope.batchId + '.json');
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  assert.equal(receipt.batchId, x.envelope.batchId);
  assert.equal(receipt.workspaceId, 'workspace-test');
  assert.equal(receipt.status, 'imported');
  assert.match(receipt.packageHash, /^[a-f0-9]{64}$/);
  fs.writeFileSync(path.join(incoming, x.envelope.batchId + '.json'), JSON.stringify(x.envelope));
  await receiver.scanOnce();
  assert.equal(x.repo.all('textCandidates').length, 1);
  assert.equal(JSON.parse(fs.readFileSync(receiptPath, 'utf8')).items[0].candidateId,
    receipt.items[0].candidateId);
});

// Break caught: invalid file blocks all later deliveries or is treated as an executable.
test('malformed file is isolated while a valid text containing commands remains inert', async (t) => {
  const x = setup(t);
  const root = path.join(x.root, 'inbox');
  fs.mkdirSync(path.join(root, 'incoming'), { recursive: true });
  fs.writeFileSync(path.join(root, 'incoming', 'broken.json'), '{broken');
  const envelope = structuredClone(x.envelope);
  envelope.items[0].draft.sections[0].lines[0] = '$(Write-Output should-never-execute)';
  fs.writeFileSync(path.join(root, 'incoming', envelope.batchId + '.json'), JSON.stringify(envelope));
  const receiver = new w.InboxReceiver(x.service, root);
  t.after(() => receiver.stop());
  await receiver.scanOnce();
  assert.equal(x.repo.all('textCandidates').length, 1);
  assert.ok(fs.readdirSync(path.join(root, 'rejected')).some(name => name.endsWith('-broken.json')));
  assert.equal(x.repo.all('operations').length, 0);
});

test('content hashes retain text whitespace even when the draft parser trims display fields', t=>{
 const x=setup(t); x.service.importPackage(x.envelope);
 const changed=structuredClone(x.envelope); changed.batchId='whitespace-conflict';
 changed.items[0].draft.title=' '+changed.items[0].draft.title;
 assert.throws(()=>x.service.importPackage(changed),/INBOX_IDEMPOTENCY_CONFLICT/);
});

test('lost receipt export recovers persisted IDs after restart without another candidate', async t=>{
 const x=setup(t), root=path.join(x.root,'inbox'), incoming=path.join(root,'incoming');
 fs.mkdirSync(incoming,{recursive:true}); fs.mkdirSync(path.join(root,'receipts',x.envelope.batchId+'.json'),{recursive:true});
 fs.writeFileSync(path.join(incoming,x.envelope.batchId+'.json'),JSON.stringify(x.envelope));
 const first=new w.InboxReceiver(x.service,root); await first.scanOnce(); first.stop();
 assert.equal(x.repo.all('textCandidates').length,1); const id=x.repo.all('textCandidates')[0].id;
 assert(fs.existsSync(path.join(incoming,x.envelope.batchId+'.json')));
 fs.rmdirSync(path.join(root,'receipts',x.envelope.batchId+'.json'));
 const next=new w.InboxReceiver(new w.InboxService(x.repo,x.channel),root); t.after(()=>next.stop());
 await next.scanOnce();
 const receipt=JSON.parse(fs.readFileSync(path.join(root,'receipts',x.envelope.batchId+'.json'),'utf8'));
 assert.equal(receipt.items[0].candidateId,id); assert.equal(x.repo.all('textCandidates').length,1);
});

test('a conflicting delivery cannot overwrite the successful acknowledgement', async t=>{
 const x=setup(t),root=path.join(x.root,'inbox'),incoming=path.join(root,'incoming'); fs.mkdirSync(incoming,{recursive:true});
 const file=path.join(incoming,x.envelope.batchId+'.json'); fs.writeFileSync(file,JSON.stringify(x.envelope));
 const receiver=new w.InboxReceiver(x.service,root);t.after(()=>receiver.stop());await receiver.scanOnce();
 const ack=fs.readFileSync(path.join(root,'receipts',x.envelope.batchId+'.json'),'utf8');
 fs.writeFileSync(file,JSON.stringify({...x.envelope,items:[{...x.item,draft:{...x.item.draft,title:'冲突'}}]}));
 await receiver.scanOnce();
 assert.equal(fs.readFileSync(path.join(root,'receipts',x.envelope.batchId+'.json'),'utf8'),ack);
 assert.equal(x.repo.all('textCandidates').length,1);assert.equal(receiver.lastError,'INBOX_IDEMPOTENCY_CONFLICT');
});

test('junction directory and hard-linked files cannot become a trusted delivery', async t=>{
 const x=setup(t),outside=path.join(x.root,'outside'),root=path.join(x.root,'inbox'); fs.mkdirSync(outside);
 const target=path.join(outside,'source.json');fs.writeFileSync(target,JSON.stringify(x.envelope));
 fs.symlinkSync(outside,root,process.platform==='win32'?'junction':'dir');
 const receiver=new w.InboxReceiver(x.service,root);t.after(()=>receiver.stop());await receiver.scanOnce();
 assert.equal(receiver.lastError,'INBOX_LINK_REJECTED');assert.equal(x.repo.all('textCandidates').length,0);
 const normal=path.join(x.root,'normal');fs.mkdirSync(path.join(normal,'incoming'),{recursive:true});
 fs.linkSync(target,path.join(normal,'incoming',x.envelope.batchId+'.json'));
 const second=new w.InboxReceiver(x.service,normal);t.after(()=>second.stop());await second.scanOnce();
 assert.equal(second.lastError,'INBOX_FILE_REJECTED');assert.equal(x.repo.all('textCandidates').length,0);
 assert.equal(fs.readFileSync(target,'utf8'),JSON.stringify(x.envelope));
});

test('receiver rejects invalid UTF8 and wrong filenames without importing any candidate',async t=>{
 const x=setup(t),root=path.join(x.root,'inbox'),incoming=path.join(root,'incoming');fs.mkdirSync(incoming,{recursive:true});
 fs.writeFileSync(path.join(incoming,'wrong-name.json'),JSON.stringify(x.envelope));
 fs.writeFileSync(path.join(incoming,'invalid.json'),Buffer.from([0xff,0xfe,0xff]));
 const receiver=new w.InboxReceiver(x.service,root);t.after(()=>receiver.stop());await receiver.scanOnce();
 assert.equal(x.repo.all('textCandidates').length,0);assert.equal(fs.readdirSync(incoming).length,0);
});

test('oversized deliveries are isolated so later files are not permanently starved',async t=>{
 const x=setup(t),root=path.join(x.root,'inbox'),incoming=path.join(root,'incoming');fs.mkdirSync(incoming,{recursive:true});
 for(let i=0;i<100;i++) fs.writeFileSync(path.join(incoming,'bad-'+String(i).padStart(3,'0')+'.json'),' '.repeat(1024*1024+1));
 fs.writeFileSync(path.join(incoming,x.envelope.batchId+'.json'),JSON.stringify(x.envelope));
 const receiver=new w.InboxReceiver(x.service,root);t.after(()=>receiver.stop());
 await receiver.scanOnce();await receiver.scanOnce();
 assert.equal(x.repo.all('textCandidates').length,1);
 assert.equal(fs.readdirSync(incoming).length,0);
});

test('review: case-fold batch collisions preserve the original Windows acknowledgement',async t=>{
 const x=setup(t),root=path.join(x.root,'inbox'),incoming=path.join(root,'incoming');fs.mkdirSync(incoming,{recursive:true});
 const first={...x.envelope,batchId:'Batch'};
 fs.writeFileSync(path.join(incoming,'Batch.json'),JSON.stringify(first));
 const receiver=new w.InboxReceiver(x.service,root);t.after(()=>receiver.stop());await receiver.scanOnce();
 const ack=fs.readFileSync(path.join(root,'receipts','Batch.json'),'utf8');
 const second={...x.envelope,batchId:'batch',items:[{...x.item,externalItemId:'different-item'}]};
 fs.writeFileSync(path.join(incoming,'batch.json'),JSON.stringify(second));await receiver.scanOnce();
 assert.equal(x.repo.all('inboxBatches').length,1);
 assert.equal(x.repo.all('textCandidates').length,1);
 assert.equal(fs.readFileSync(path.join(root,'receipts','Batch.json'),'utf8'),ack);
 assert.equal(receiver.lastError,'INBOX_IDEMPOTENCY_CONFLICT');
});

test('review: rejected junction entries cannot starve the next valid package',async t=>{
 const x=setup(t),root=path.join(x.root,'inbox'),incoming=path.join(root,'incoming'),target=path.join(x.root,'untouched-target');
 fs.mkdirSync(incoming,{recursive:true});fs.mkdirSync(target);
 fs.writeFileSync(path.join(target,'sentinel.txt'),'must stay unchanged');
 for(let i=0;i<100;i++)fs.symlinkSync(target,path.join(incoming,'bad-'+String(i).padStart(3,'0')+'.json'),process.platform==='win32'?'junction':'dir');
 const envelope={...x.envelope,batchId:'zzz-valid'};
 fs.writeFileSync(path.join(incoming,'zzz-valid.json'),JSON.stringify(envelope));
 const receiver=new w.InboxReceiver(x.service,root);t.after(()=>receiver.stop());await receiver.scanOnce();await receiver.scanOnce();
 assert.equal(x.repo.all('textCandidates').length,1);
 assert.equal(fs.readdirSync(incoming).length,0);
 assert.equal(fs.readFileSync(path.join(target,'sentinel.txt'),'utf8'),'must stay unchanged');
});
