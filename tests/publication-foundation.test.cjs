const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const w=require(process.env.RAINFALL_FANQIE_BUNDLE);
const hash=x=>crypto.createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const policies={tme:w.tmePreparationPhases,fanqie:w.fanqiePreparationPhases};
for(const platform of ['tme','fanqie']){
 test(platform+': shared checkpoint rejects stale revisions and records one increment',()=>{
  const old={id:'job',revision:3,state:'ready'};assert.throws(()=>w.nextPublicationCheckpoint(old,{state:'changed'},2),/REVISION_CONFLICT/);
  assert.deepEqual(w.nextPublicationCheckpoint(old,{state:'changed'},3),{id:'job',revision:4,state:'changed'});assert.equal(old.revision,3);
 });
 test(platform+': interrupted writes normalize to unknown, never prepared',()=>{
  const active=platform==='tme'?'dispatching':'uploading',unknown=platform==='tme'?'reconcile_required':'unknown';
  assert.equal(w.interruptedPublicationState(active,policies[platform],unknown),unknown);
  assert.equal(w.publicationPhase(unknown,policies[platform]),'unknown');assert.equal(w.publicationPhase('unrecognized-status',policies[platform]),'unknown');
  const contract=platform==='tme'?'awaiting_terms_review':'contract_pending';assert.equal(w.publicationPhase(contract,policies[platform]),'contract_pending');
 });
 test(platform+': only matching upload receipts advance local evidence',()=>{
  const sha='a'.repeat(64);w.assertPublicationUploadReceipt({remoteId:'remote-1',sha256:sha},sha,'UPLOAD_UNVERIFIED');
  for(const r of [undefined,{remoteId:' ',sha256:sha},{remoteId:'remote-1',sha256:'b'.repeat(64)}])assert.throws(()=>w.assertPublicationUploadReceipt(r,sha,'UPLOAD_UNVERIFIED'),/UPLOAD_UNVERIFIED/);
 });
 test(platform+': read recovery is bounded and unsupported recovery sends no second read',async()=>{
  let reads=0,reclaims=0;await assert.rejects(w.readPublicationAfterRecovery(async()=>{reads++;throw Error('timeout')}),/timeout/);assert.equal(reads,1);
  reads=0;assert.equal(await w.readPublicationAfterRecovery(async()=>{if(++reads===1)throw Error('timeout');return'known'},{reclaim:async()=>{reclaims++},retryable:()=>true}),'known');assert.equal(reads,2);assert.equal(reclaims,1);
 });
 test(platform+': shared file verifier detects changed bytes with platform-specific errors',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'publication-contract-')),file=path.join(root,'material');fs.writeFileSync(file,'original');
  const asset={file,sha256:hash('original'),bytes:8};w.assertPublicationFile(asset,{error:platform+'_ASSET_CHANGED'});fs.writeFileSync(file,'modified');assert.throws(()=>w.assertPublicationFile(asset,{error:platform+'_ASSET_CHANGED'}),new RegExp(platform+'_ASSET_CHANGED'));
 });
 test(platform+': shared audit schema cannot log local paths or arbitrary error text',()=>{
  const calls=[];w.auditPublicationTransition({audit:(...a)=>calls.push(a)},{platform,id:'job-id',state:'unknown',revision:4,reason:'C:/private/lyrics.txt'});
  assert.equal(calls.length,1);assert.equal(calls[0][2].platform,platform);assert.ok(!JSON.stringify(calls).includes('private'));
 });
}
test('recording families preserve Tencent history and isolate Fanqie namespace',()=>{
 const sha='a'.repeat(64),tme=w.publicationRecordingKey('tme','account',sha),fanqie=w.publicationRecordingKey('fanqie','account',sha,'artist');
 assert.equal(tme,hash(['account',sha]));assert.equal(fanqie,hash(['fanqie','account','artist',sha]));assert.notEqual(tme,fanqie);
 assert.equal(w.publicationRecordingKey('fanqie','account',sha,'artist'),fanqie);
 assert.throws(()=>w.publicationRecordingKey('fanqie','account',sha),/SCOPE_REQUIRED/);
});
