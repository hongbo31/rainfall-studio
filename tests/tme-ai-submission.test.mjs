import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
const w=createRequire(import.meta.url)(process.env.RAINFALL_TME_AI_SUBMISSION_BUNDLE);
function setup(t){
 assert.equal(typeof w.TmeAiSubmissionService,'function','submission coordinator must exist');
 const repo=new w.Repository(path.resolve('output/test-runs/ai-submit-'+randomUUID(),'db.sqlite'));t.after(()=>repo.close());
 let now=new Date('2026-10-17T09:00:00Z'),valid=true;
 const sessionId=randomUUID(),workId=randomUUID(),prepareJobId=randomUUID();
 const identity={subjectType:'official_visible_binding_fingerprint',kugouId:'1234567890',qqDisplayName:'offline account',artistName:'离线艺人',observedAt:now.toISOString(),evidenceHash:'f'.repeat(64)};
 identity.subjectHash=w.tmeAiSubjectHash(identity);
 const binding={pid:100,handle:'200',started:'2026-10-17T08:00:00Z',documentId:'bound-official-tab'};
 const metadata={title:'离线原创新歌',albumTitle:'离线原创新歌',albumDescription:'离线原创测试专辑说明',artistName:identity.artistName,lyricist:identity.artistName,composer:identity.artistName,ownLyrics:false,ownComposition:false,aiTool:'offline fixture',generatedOn:'2026-10-17',allowCover:true,genre:'流行',language:'国语',version:'完整版',releaseMode:'审核通过即发布'};
 const termsText='OFFLINE ONLY：本首作品的非独家授权模式与当前协议文字';
 const input={id:randomUUID(),workId,identity,binding,sourceAudio:{assetId:randomUUID(),sha256:'a'.repeat(64),variant:'A'},upload:{path:path.resolve('output/offline-approved.wav'),sha256:'b'.repeat(64),format:'pcm_wav',derivedFromSha256:'a'.repeat(64)},cover:{assetId:randomUUID(),sha256:'c'.repeat(64)},lyricsHash:'d'.repeat(64),metadata,consent:true};
 const prepared={job:{id:prepareJobId,workId,state:'awaiting_terms_review',terms:{termsHash:w.hash(termsText)},localAlbumSnapshot:{localVerified:true}},grant:{id:input.id,input}};
 const options={now:()=>now,resolvePrepared:id=>{assert.equal(id,prepareJobId);return prepared},verifyAssets:()=>{if(!valid)throw Error('ASSETS_CHANGED')}};
 const service=new w.TmeAiSubmissionService(repo,options);
 const snapshot=(changes={})=>({identity:{...identity,observedAt:now.toISOString()},binding,observedAt:now.toISOString(),evidenceHash:'e'.repeat(64),mode:'ai_authorization',modeText:'OFFLINE ONLY license',visibleSubmitButton:true,termsText,termsHash:w.hash(termsText),verified:{},...changes});
 const review=(contract={available:true,reasons:[],transport:'offline-fixture'})=>service.review({prepareJobId,snapshot:snapshot(),contract,sessionId});
 const authorize=row=>service.authorize({id:row.id,expectedRevision:row.revision,termsHash:row.termsHash,consent:true,rightsConfirmed:true,sessionId});
 const claim=(row,phase)=>service.claim({id:row.id,expectedRevision:row.revision,phase,snapshot:snapshot(),sessionId});
 const accept=()=>{let row=authorize(review());const c=claim(row,'accept');row=service.record({id:row.id,operationId:c.operation.id,result:{status:'accepted',snapshot:snapshot(),scopeHash:row.scopeHash}});return row};
 const receipt=row=>({source:'official-tencent-review-record',entityType:'song',remoteId:'123456789',title:metadata.title,artistName:metadata.artistName,status:'reviewing',subjectHash:identity.subjectHash,scopeHash:row.scopeHash,submittedAt:now.toISOString(),observedAt:now.toISOString(),evidenceHash:'9'.repeat(64),url:'https://y.tencentmusic.com/#/user/manage/official-fixture'});
 return{repo,service,options,prepared,sessionId,workId,prepareJobId,snapshot,review,authorize,claim,accept,receipt,invalidate:()=>valid=false,clock:s=>now=new Date(s)};
}
test('prepare-only consent cannot authorize or dispatch a formal submission',t=>{
 const x=setup(t),r=x.review();assert.equal(r.state,'reviewed');assert.equal(r.termsAccepted,false);assert.equal(r.submissionByClient,false);
 assert.throws(()=>x.claim(r,'submit'),/SUBMISSION_NOT_AUTHORIZED|PHASE_SCOPE/);assert.equal(x.repo.all('operations').length,0);
});
test('public submission scope comes from the exact prepared grant and never from row-supplied aliases',t=>{
 const x=setup(t),publicationTaskId=randomUUID(),accountId=randomUUID();
 Object.assign(x.prepared.grant.input,{publicationTaskId,accountId});x.prepared.job.grantId=x.prepared.grant.id;
 x.repo.save('settings',{id:'tme-ai-prepare:job:'+x.prepared.job.id,value:x.prepared.job});x.repo.save('settings',{id:'tme-ai-prepare:grant:'+x.prepared.grant.id,value:x.prepared.grant});
 const row=x.review();
 for(const dto of [x.service.publicById(row.id),...x.service.listPublic(x.workId),x.service.publicJob({...row,publicationTaskId:randomUUID(),accountId:randomUUID()})]){
  assert.equal(dto.publicationTaskId,publicationTaskId);assert.equal(dto.accountId,accountId);assert.equal(dto.sessionId,undefined);assert.equal(dto.snapshot,undefined);
 }
 const old=setup(t),legacy=old.review(),dto=old.service.publicJob({...legacy,publicationTaskId:randomUUID(),accountId:randomUUID()});assert.equal(dto.publicationTaskId,undefined);assert.equal(dto.accountId,undefined);
 x.prepared.job.workId=randomUUID();x.repo.save('settings',{id:'tme-ai-prepare:job:'+x.prepared.job.id,value:x.prepared.job});const mismatched=x.service.publicById(row.id);assert.equal(mismatched.publicationTaskId,undefined);assert.equal(mismatched.accountId,undefined);
 assert.equal(x.repo.all('operations').length,0);
});
test('default unavailable native executor prevents authorization even with consent',t=>{
 const x=setup(t),r=x.review({available:false,reasons:['NATIVE_AI_SUBMIT_CONTRACT_UNVERIFIED'],transport:'windows-uia'});
 assert.throws(()=>x.authorize(r),/EXECUTOR_UNAVAILABLE/);assert.equal(x.repo.all('operations').length,0);
});
test('changed terms, assets, identity or window and expired review prevent a native claim',t=>{
 for(const change of ['terms','assets','identity','binding','time']){
  const x=setup(t),r=x.authorize(x.review());
  const snap=x.snapshot();if(change==='terms'){snap.termsText+=' changed';snap.termsHash=w.hash(snap.termsText)}
  if(change==='identity')snap.identity={...snap.identity,artistName:'different'};
  if(change==='binding')snap.binding={...snap.binding,documentId:'other'};
  if(change==='assets')x.invalidate();if(change==='time')x.clock('2026-10-17T09:10:00Z');
  assert.throws(()=>x.service.claim({id:r.id,expectedRevision:r.revision,phase:'accept',snapshot:snap,sessionId:x.sessionId}));assert.equal(x.repo.all('operations').length,0);
 }
});
test('acceptance and one submit each have a durable claim; only an official scoped receipt finishes',t=>{
 const x=setup(t);let row=x.accept();assert.equal(row.state,'accepted');assert.equal(row.submissionByClient,false);
 const c=x.claim(row,'submit');assert.equal(c.job.state,'dispatching');assert.equal(x.repo.get('operations',c.operation.id).state,'dispatching');
 row=x.service.record({id:row.id,operationId:c.operation.id,result:{status:'reviewing',receipt:x.receipt(row)}});
 assert.equal(row.state,'reviewing');assert.equal(row.remoteId,'123456789');assert.equal(row.submissionByClient,true);
 assert.throws(()=>x.claim(row,'submit'),/PHASE_SCOPE|ALREADY_DISPATCHED/);assert.equal(x.repo.all('operations').length,2);
});
test('missing or mismatched receipt cannot turn a local submit counter into success',t=>{
 const x=setup(t),row=x.accept(),c=x.claim(row,'submit');
 assert.throws(()=>x.service.record({id:row.id,operationId:c.operation.id,result:{status:'reviewing'}}));
 for(const field of ['remoteId','title','artistName','subjectHash','scopeHash','url','submittedAt']){
  const receipt=x.receipt(row);receipt[field]=field==='submittedAt'?'2026-10-16T09:00:00Z':field==='remoteId'?'':'wrong';
  assert.throws(()=>x.service.record({id:row.id,operationId:c.operation.id,result:{status:'reviewing',receipt}}),field);
 }
 assert.equal(x.service.context(row.id).job.state,'dispatching');assert.equal(x.service.context(row.id).job.submissionByClient,false);
});
test('lost submit response and restart remain unknown and cannot resend; read-only receipt can reconcile',t=>{
 const x=setup(t),row=x.accept(),c=x.claim(row,'submit');
 const restarted=new w.TmeAiSubmissionService(x.repo,x.options);let current=restarted.context(row.id).job;
 assert.equal(current.state,'reconcile_required');assert.equal(x.repo.get('operations',c.operation.id).state,'unknown');
 assert.throws(()=>restarted.claim({id:current.id,expectedRevision:current.revision,phase:'submit',snapshot:x.snapshot(),sessionId:x.sessionId}),/PHASE_SCOPE|ALREADY_DISPATCHED/);
 current=restarted.reconcile({id:row.id,receipt:x.receipt(row)});assert.equal(current.state,'reviewing');assert.equal(x.repo.all('operations').length,2);
});
test('approval from another Main session and a second recording-family review cannot reset a dispatched intent',t=>{
 const x=setup(t),row=x.authorize(x.review());
 assert.throws(()=>x.service.claim({id:row.id,expectedRevision:row.revision,phase:'accept',snapshot:x.snapshot(),sessionId:randomUUID()}),/SESSION_CHANGED/);
 const accepted=x.accept();x.claim(accepted,'submit');
 assert.throws(()=>x.review(),/ALREADY_DISPATCHED/);
});
test('renderer inputs cannot supply a receipt, identity, executor or skip explicit rights confirmation',t=>{
 assert.equal(typeof w.TmeAiSubmissionActions,'object');
 const id=randomUUID(),base={id,expectedRevision:1,termsHash:'a'.repeat(64),consent:true,rightsConfirmed:true};
 for(const extra of [{receipt:{}},{identity:{}},{executor:true},{rightsConfirmed:false},{consent:false}])assert.throws(()=>w.TmeAiSubmissionActions.authorizeAndSubmit.parse({...base,...extra}));
 assert.throws(()=>w.TmeAiSubmissionActions.reconcile.parse({id,receipt:{}}));
});
test('missing new-song audio and cover stop preflight before any native observation',async t=>{
 const x=setup(t),calls=[];
 const broker=w.createTmeAiSubmissionBroker({root:path.resolve('output/test-runs/preflight-'+randomUUID()),available:()=>true,generation:()=>1,observe:async()=>{calls.push('native');throw Error('MUST_NOT_RUN')},rpc:async(method,input)=>({ok:true,value:{workId:input.workId,title:'尚无音频的新歌',readyForNative:false,reasons:['AUDIO_REQUIRED','COVER_REQUIRED','PREPARATION_REQUIRED']}})});
 const r=await broker.ui('preflight',{workId:x.workId});assert.equal(r.ready,false);assert.ok(r.reasons.includes('AUDIO_REQUIRED'));assert.deepEqual(calls,[]);
 assert.equal(r.capability.available,false);assert.ok(r.capability.reasons.includes('NATIVE_AI_SUBMIT_CONTRACT_UNVERIFIED'));
});
test('an unverified live adapter cannot be enabled by a renderer request',async t=>{
 const x=setup(t);let writes=0;
 const broker=w.createTmeAiSubmissionBroker({root:path.resolve('output/test-runs/preflight-'+randomUUID()),available:()=>true,generation:()=>1,observe:async()=>x.snapshot(),rpc:async()=>{writes++;throw Error('UNEXPECTED_RPC')}});
 await assert.rejects(()=>broker.ui('authorizeAndSubmit',{id:randomUUID(),expectedRevision:1,termsHash:'a'.repeat(64),consent:true,rightsConfirmed:true}),/EXECUTOR_UNAVAILABLE/);assert.equal(writes,0);
});
test('real Core preflight describes an existing new draft without creating works, jobs or operations',t=>{
 assert.equal(typeof w.inspectTmeAiSubmissionWork,'function','client preflight must exist');
 const s=new w.Studio(path.resolve('output/test-runs/ai-preflight-'+randomUUID()),'production');t.after(()=>s.close());
 const artist=s.all('artists')[0],work=s.saveWork({artistId:artist.id,title:'尚无音频的新歌',lyrics:'本轮原创草稿',prompt:'warm romance',parameters:{voice:'male'},rights:'音乐与封面尚未生成，商用依据待确认',ai:'assisted'});
 const before={works:s.all('works'),operations:s.all('operations'),settings:s.all('settings')};
 const result=w.inspectTmeAiSubmissionWork(s,work.id);
 assert.equal(result.readyForNative,false);for(const reason of ['AUDIO_REQUIRED','COVER_REQUIRED','PREPARATION_REQUIRED','RIGHTS_UNCONFIRMED'])assert.ok(result.reasons.includes(reason),reason);
 assert.deepEqual({works:s.all('works'),operations:s.all('operations'),settings:s.all('settings')},before);
 assert.throws(()=>w.executeTmeAiSubmission(s,'recordFromRenderer',{}),/METHOD_NOT_ALLOWED/);
});
test('renderer panel exposes actual preflight blockers and never offers an enabled submit before review',()=>{
 assert.equal(typeof w.renderSubmissionPanel,'function','preflight panel must exist');
 const html=w.renderSubmissionPanel();assert.match(html,/提交前检查/);assert.match(html,/需要音频/);assert.match(html,/需要封面/);
 const button=[...html.matchAll(/<button\b([^>]*)>(.*?)<\/button>/gs)].find(m=>m[2]==='确认授权并提交审核');assert.ok(button);assert.match(button[1],/disabled/);
 assert.ok(!html.includes('非独家授权 3 年'));assert.ok(!html.includes('正式提交：1'));assert.ok(!html.includes('尚无音频的新歌已提交'));
 assert.ok(!html.includes('我已阅读并同意以上本首歌曲条款'),'unavailable terms must not solicit consent');
});
function brokerFixture(t){
 const x=setup(t),calls=[],root=path.resolve('output/test-runs/ai-submit-broker-'+randomUUID());let generation=1,failSubmit=false,afterClaim=null;
 const executor={capability:()=>({available:true,reasons:[],transport:'offline-fixture'}),accept:async context=>{calls.push('accept');return{status:'accepted',snapshot:x.snapshot(),scopeHash:context.job.scopeHash}},submit:async context=>{calls.push('submit');if(failSubmit)throw Error('FIXTURE_RESPONSE_LOST');return{status:'reviewing',receipt:x.receipt(context.job)}},readReceipt:async context=>{calls.push('readReceipt');return x.receipt(context.job)}};
 const rpc=async(method,input)=>{
  const action=method.replace('internal.tmeAiSubmission.','');let value;
  if(action==='inspectWork')value={workId:x.workId,title:'离线原创新歌',readyForNative:true,reasons:[],prepareJobId:x.prepareJobId};
  else if(action==='preparedContext')value=x.prepared;
  else if(action==='publicJob')value=x.service.publicById(input.id);
  else if(action==='context')value=x.service.context(input.id);
  else if(action==='receiptContext')value=x.service.receiptContext(input.id);
  else if(action==='externalContext')value=null;
  else if(action==='listPublic')value=x.service.listPublic(input.workId);
  else value=x.service[action](input);
  if(action==='claim')afterClaim?.(input);
  return{ok:true,value};
 };
 const broker=w.createTmeAiSubmissionBroker({root,available:()=>true,generation:()=>generation,observe:async()=>x.snapshot(),executor,rpc});
 const input=row=>({id:row.id,expectedRevision:row.revision,termsHash:row.termsHash,consent:true,rightsConfirmed:true});
 return{...x,root,broker,calls,input,fail:()=>failSubmit=true,switchAfterClaim:()=>afterClaim=()=>generation++};
}
test('Main executes a full offline scoped round once; a lost submit response reconciles without a resend',async t=>{
 const x=brokerFixture(t),review=await x.broker.ui('preflight',{workId:x.workId});x.fail();
 await assert.rejects(()=>x.broker.ui('authorizeAndSubmit',x.input(review.job)),/FIXTURE_RESPONSE_LOST/);
 assert.deepEqual(x.calls,['accept','submit']);const current=x.service.context(review.job.id).job;assert.equal(current.state,'reconcile_required');
 await assert.rejects(()=>x.broker.ui('authorizeAndSubmit',x.input(current)));assert.deepEqual(x.calls,['accept','submit']);
 const reconciled=await x.broker.ui('reconcile',{id:current.id});assert.equal(reconciled.state,'reviewing');assert.deepEqual(x.calls,['accept','submit','readReceipt']);
});
test('Main rejects an old durable submission marker before any acceptance or submission action',async t=>{
 const x=brokerFixture(t),review=await x.broker.ui('preflight',{workId:x.workId}),row=x.service.context(review.job.id).job;
 const dir=path.join(x.root,'production','tme-ai-submission-intents');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,row.familyKey+'.json'),'prior-dispatch-intent');
 await assert.rejects(()=>x.broker.ui('authorizeAndSubmit',x.input(review.job)),/SUBMISSION_ALREADY_DISPATCHED/);assert.deepEqual(x.calls,[]);
 const fresh=await x.broker.ui('preflight',{workId:x.workId});assert.equal(fresh.ready,false);assert.ok(fresh.reasons.includes('SUBMISSION_ALREADY_DISPATCHED'));
});
test('a workspace switch after the durable claim prevents every native mutation',async t=>{
 const x=brokerFixture(t),review=await x.broker.ui('preflight',{workId:x.workId});x.switchAfterClaim();
 await assert.rejects(()=>x.broker.ui('authorizeAndSubmit',x.input(review.job)),/WORKSPACE_CHANGED/);assert.deepEqual(x.calls,[]);
 const restarted=new w.TmeAiSubmissionService(x.repo,x.options);assert.equal(restarted.context(review.job.id).job.state,'reconcile_required');
});
test('historical official receipts reconcile after local materials change or the preparation is suspended',t=>{
 const x=setup(t),row=x.accept(),claim=x.claim(row,'submit'),receipt=x.receipt(row);
 x.invalidate();x.prepared.grant.suspended=true;x.prepared.grant.input.metadata.title='本地已改名';x.prepared.grant.input.cover.sha256='7'.repeat(64);
 const restarted=new w.TmeAiSubmissionService(x.repo,x.options);
 const done=restarted.reconcile({id:row.id,receipt});assert.equal(done.state,'reviewing');assert.equal(done.title,'离线原创新歌');assert.equal(done.remoteId,receipt.remoteId);
 assert.equal(x.repo.all('operations').length,2);assert.equal(x.repo.get('operations',claim.operation.id).state,'complete');
 const bad={...receipt,title:'本地已改名'};assert.throws(()=>restarted.reconcile({id:row.id,receipt:bad}),/OFFICIAL_RECEIPT_SCOPE/);
 x.options.resolvePrepared=()=>{throw Error('PREPARATION_REMOVED')};assert.equal(restarted.receiptContext(row.id).receiptScope.title,'离线原创新歌');assert.equal(restarted.publicById(row.id).remoteId,receipt.remoteId);
});
test('official receipt explicitly identifies a song, never an album or an unlabeled record',t=>{
 const x=setup(t),row=x.accept(),c=x.claim(row,'submit');
 const missing={...x.receipt(row)};delete missing.entityType;
 for(const receipt of [{...x.receipt(row),entityType:'album'},missing])assert.throws(()=>x.service.record({id:row.id,operationId:c.operation.id,result:{status:'reviewing',receipt}}));
});
