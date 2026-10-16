const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {Studio}=require(process.env.RAINFALL_CORE_BUNDLE??'../../build/core.cjs');
test('Core chat -> quality -> two managed original diagnostic assets uses no external requests',async()=>{
 const root=path.resolve('output/test-runs','workflow-client-'+randomUUID()),s=new Studio(root,'simulation');
 try{const artist=s.all('artists')[0],sessionId=randomUUID();let t=await s.call('conversation.generate',{requestId:randomUUID(),sessionId,artistId:artist.id,expectedRevision:0,instruction:'雨里初次相识',parentDraftId:null,lockedQuotes:[],profileId:null,seriesId:null,budgetLimit:100});await s.creationService().execute(t.id); // same execution is already active; wait below on the real stored state
  for(let n=0;n<100&&['queued','running'].includes(s.get('creativeTurns',t.id).state);n++)await new Promise(r=>setTimeout(r,5));
  t=s.get('creativeTurns',t.id);assert.equal(t.state,'ready_for_review');const d=s.get('drafts',t.draftId);const op=await s.call('music.prepare',{requestId:randomUUID(),draftId:d.id,expectedPairHash:d.pairHash,accountRef:'fixture-account',modelId:'chirp-v6',candidateLimit:2,budgetLimit:10});
  for(let n=0;n<100&&(s.all('candidates').length!==2||!s.all('candidates').every(c=>c.state==='ready'));n++)await new Promise(r=>setTimeout(r,10));
  assert.equal(s.all('candidates').length,2);assert.ok(s.all('candidates').every(c=>c.state==='ready'));for(const c of s.all('candidates')){const asset=s.get('assets',c.assetId);assert.equal(asset.kind,'audio');assert.ok(fs.existsSync(s.locate(asset.id).file));assert.equal(c.source,'fixture');}
  assert.equal(s.externalRequests,0);assert.equal(s.get('operations',op.id).state,'assets_verified');
 }finally{s.close();}
});
test('review: daily music limit is shared across every pair in the occurrence',async()=>{
 const root=path.resolve('output/test-runs','workflow-planbudget-'+randomUUID()),s=new Studio(root,'simulation');try{const p={id:randomUUID(),artistId:s.all('artists')[0].id,seriesId:null,textBudget:21,musicBudget:2,candidateLimit:4,textProfileId:null,timezone:'Etc/UTC'};s.save('dailyPlans',p);const occurrence={id:randomUUID(),source:'fixture',intendedLocalDate:'2026-10-15',budgetDate:'2026-10-15'};await s.dispatchDailyOccurrence(p,occurrence);const spent=s.all('workflowLedger').filter(e=>e.scope==='music'&&e.kind==='settle').reduce((n,e)=>n+e.amount,0);assert.equal(spent,2);assert.equal(s.all('candidates').length,2);}finally{s.close();}
});
test('review: older backup cannot erase post-snapshot unknown operations or reservations',async()=>{
 const root=path.resolve('output/test-runs','workflow-restore-'+randomUUID()),s=new Studio(root,'simulation');try{const backup=path.join(root,'before.zip');await s.backup(backup);const id=randomUUID();s.save('operations',{id,operationKey:id,kind:'music',state:'unknown',costState:'unknown'});s.save('workflowLedger',{id:randomUUID(),eventKey:'post-backup-risk',kind:'reserve',amount:21,unit:'fixture_credit',date:'2026-10-15'});await assert.rejects(async()=>s.restore(backup),/RESTORE_RECONCILIATION_REQUIRED/);assert.equal(s.get('operations',id).state,'unknown');assert.equal(s.all('workflowLedger')[0].amount,21);}finally{s.close();}
});
test('self review: failed restore keeps the original workspace usable',async()=>{
 const root=path.resolve('output/test-runs','workflow-badrestore-'+randomUUID()),s=new Studio(root,'simulation');try{s.creationService();const file=path.join(root,'invalid.zip');fs.writeFileSync(file,'not a zip');await assert.rejects(async()=>s.restore(file));const turn=await s.call('conversation.generate',{requestId:randomUUID(),sessionId:randomUUID(),artistId:s.all('artists')[0].id,expectedRevision:0,instruction:'继续创作',parentDraftId:null,lockedQuotes:[],profileId:null,seriesId:null,budgetLimit:100});assert.equal(turn.state,'queued');for(let n=0;n<100&&s.get('creativeTurns',turn.id).state==='running';n++)await new Promise(r=>setTimeout(r,5));}finally{s.close();}
});
