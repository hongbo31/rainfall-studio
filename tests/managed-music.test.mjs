import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
const require=createRequire(import.meta.url),w=require(process.env.RAINFALL_MANAGED_MUSIC_BUNDLE);
const {draft}=require('./fixtures/workflow.cjs');
const existingCreditPolicy={mode:'existing_credits',noRecharge:true,actualCostUnknown:true,consent:true};
function setup(t,modelId='chirp-v6'){
  const root=path.resolve('output/test-runs/managed-music-'+randomUUID());
  const s=new w.Studio(root,'production',{now:()=>new Date('2026-10-19T01:00:00Z')});
  t.after(()=>s.repo.close());
  const artistId=s.all('artists')[0].id,textProfile=randomUUID(),musicProfile=randomUUID(),channelId=randomUUID(),candidateId=randomUUID(),draftId=randomUUID();
  for(const [id,kind,providerId]of[[textProfile,'text','deepseek'],[musicProfile,'music','yourmusic']])s.repo.save('settings',{id:'api-profile:'+id,kind,providerId,label:'offline fixture',revision:1,modelId:null,executionEnabled:false});
  s.repo.save('settings',{id:'inbox-channel',enabled:true,channel:{id:channelId,artistRefs:{author:artistId}}});
  s.repo.save('drafts',{id:draftId,artistId,seriesId:null,source:'local-inbox',draft:draft()});
  s.repo.save('textCandidates',{id:candidateId,draftId,artistId,seriesId:null,isCurrent:true,lineageState:'complete',localCheck:{status:'pending'},source:{channelId,provenance:{model:null,promptVersion:null}},itemHash:'b'.repeat(64)});
  const service=s.productionFlowService();
  const evaluation=service.startManagedInboxEvaluation({ownerKey:'score:'+randomUUID(),candidateId,artistId,text:{profileId:textProfile,profileRevision:1,modelId:'deepseek-flash',maxOutputTokens:2048,budgetMicros:100000,consent:true}});
  const n=service.next({id:evaluation.id}),c=service.claim({id:evaluation.id,expectedRevision:n.run.revision}),request=c.task.request;
  const phrase=request.pair.lyrics.split('\n').find(s=>s.length>=4&&!s.startsWith('['));
  service.record({id:evaluation.id,operationId:c.operation.id,result:{type:'text_score',result:{operationId:c.operation.id,revisionId:request.revisionId,requestedModelId:'deepseek-flash',status:'complete',providerRequestId:'fixture-score',providerModel:'deepseek-flash',finishReason:'stop',usage:{prompt_tokens:100,completion_tokens:200,prompt_cache_hit_tokens:0,prompt_cache_miss_tokens:100},estimatedCostMicros:270,priceVersion:'deepseek-peak-usd-2026-10-16',score:{revisionId:request.revisionId,dimensions:{lyrics:80,style:80,coherence:80},overall:80,findings:['[lyrics] "'+phrase+'" grounds the scene with consistent concrete detail.'],threshold:75,passed:true,source:'model-scored',calibration:'not_human_calibrated'},reasons:[],httpStatus:200}}});
  const input={ownerKey:'music:'+randomUUID(),budgetScope:'unified-plan:offline',artistId,evaluationRunId:evaluation.id,music:{profileId:musicProfile,profileRevision:1,modelId,budgetCredits:10,maxCostPerRequestCredits:10,creditPolicy:existingCreditPolicy,consent:true}};
  return{s,service,input,candidateId,evaluationId:evaluation.id};
}
function wav(seed){
  const samples=8000,b=Buffer.alloc(44+samples*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(samples*2,40);for(let i=0;i<samples;i++)b.writeInt16LE(Math.round(Math.sin(i*seed)*500),44+i*2);return b;
}
function broker(x,request){
  const adapter=new w.YourMusicAdapter({source:'fixture',credential:async()=>'offline-never-a-real-secret',request});
  const credentials={apiCredentialStatus:async()=>({configured:true}),withMusicAdapter:async(_identity,fn,guard)=>{guard();return fn(adapter)},withDeepSeekAdapter:async()=>{throw Error('TEXT_MUST_NOT_RUN')}};
  return w.createProductionFlowBroker({credentials,available:()=>true,generation:()=>1,publication:{capability:()=>({available:false,reasons:['NO_PUBLICATION']})},rpc:async(method,input)=>{
    try{const action=method.split('.').at(-1);const value=action==='importAudio'?await w.importProductionAudio(x.s,input):x.service[action](input);return{ok:true,value}}
    catch(e){return{ok:false,error:{code:e.message}}}
  }});
}

for(const model of ['chirp-v6','chirp-v6-wild','chirp-v6-mini'])test('original broker and adapter submit/query/download/import both '+model+' outputs offline',async t=>{
  const x=setup(t,model),run=x.service.startManagedMusic(x.input),events=[];
  const b=broker(x,async req=>{
    events.push({method:req.method,url:req.url,body:req.body,authorization:!!req.headers?.Authorization});
    if(req.method==='POST'){
      const c=x.service.context(run.id);assert.equal(c.operation.state,'dispatching');assert.equal(c.operation.requestHash.length,64);assert.equal(req.body.model,model);
      assert.deepEqual(req.body.lyrics,c.run.candidate.pair.lyrics);
      x.service.stopManagedMusic(x.input.ownerKey);
      return{status:202,body:{task_id:'fixture-task',status:'pending',songs:[{id:'song-A',status:'pending'},{id:'song-B',status:'pending'}]}};
    }
    if(req.url.includes('/query?')){
      assert(req.url.endsWith('song-A%2Csong-B'));
      return{status:200,body:['song-B','song-A'].map((id,i)=>({id,status:'succeeded',audio_url:'https://oss.yourmusic.fun/'+id+'.wav',title:'fixture',duration:1,lyric:'provider lyric '+i}))};
    }
    return{status:200,headers:{'content-type':'audio/wav'},body:wav(req.url.includes('song-A')?0.3:0.5)};
  });
  await b.pump();assert.equal(x.service.context(run.id).run.stage,'assets');
  await b.pump();await b.pump();
  const done=x.service.context(run.id).run,work=x.s.get('works',done.workId);
  assert.equal(done.state,'completed');assert.equal(done.managedStopped,true);
  assert.equal(work.audioVersions.length,2);assert.equal(work.audioVersions[0].providerSongId,'song-A');
  assert.equal(work.audioVersions[0].providerMetadata.lyric,'provider lyric 1');
  assert.equal(events.filter(e=>e.method==='POST').length,1);
  assert.equal(events.filter(e=>e.url.includes('oss.yourmusic.fun')).length,2);
  assert(events.filter(e=>e.url.includes('oss.yourmusic.fun')).every(e=>!e.authorization));
  for(const v of work.audioVersions){assert(fs.existsSync(x.s.locate(v.assetId).file));assert.equal(x.s.get('assets',v.assetId).sha256,v.sha256)}
  assert.equal(x.s.all('works').length,1);
});

test('actual adapter history recovery requires exact explicit model and never proves unsent',async()=>{
  const d=draft(),lyrics=d.sections.map(s=>`[${s.kind}]\n${s.lines.join('\n')}`).join('\n\n'),at='2026-10-19T01:00:00Z';
  let model='chirp-v6-mini',calls=0;
  const adapter=new w.YourMusicAdapter({source:'fixture',credential:async()=>'fixture',request:async req=>{calls++;assert.equal(req.method,'GET');assert(req.url.includes('/history?'));return{status:200,body:{data:['A','B'].map(id=>({id,status:'succeeded',title:d.title,model_name:model,lyric:lyrics,created_at:at}))}}}});
  assert.equal((await adapter.recoverRecent({draft:d,createdAt:at})).state,'not_established');assert.equal(calls,0);
  assert.equal((await adapter.recoverRecent({draft:d,createdAt:at,expectedModel:'chirp-v6-mini'})).state,'accepted');
  assert.equal((await adapter.recoverRecent({draft:d,createdAt:at,expectedModel:'chirp-v6'})).state,'not_established');
  model='chirp-v6-wild';assert.equal((await adapter.recoverRecent({draft:d,createdAt:at,expectedModel:model})).state,'accepted');
});

test('plan music helper binds the scored item to the same original child work and asset versions',async t=>{
  const x=setup(t),run={id:'plan-run-fixture',planId:'plan-fixture',stopRequested:false,snapshot:{artistId:x.input.artistId,authorization:{music:true},music:{...x.input.music,route:'yourmusic'}}};
  const item={id:'plan-item-fixture',runId:run.id,material:{candidateId:x.candidateId}},attempt={id:'plan-music-attempt-fixture',runId:run.id,itemId:item.id,stage:'music_submit'};
  x.s.planCenterService=()=>({list:()=>({stageAttempts:[{runId:run.id,itemId:item.id,stage:'text_score',state:'succeeded',result:{evaluationRunId:x.evaluationId}}]})});
  const first=w.startPlanMusic(x.s,run,item,attempt),again=w.startPlanMusic(x.s,run,item,attempt);
  assert.equal(again.childRunId,first.childRunId);assert.equal(again.workId,first.workId);assert.equal(first.versions.length,0);
  assert.throws(()=>w.startPlanMusic(x.s,run,{...item,material:{candidateId:randomUUID()}},attempt),/MANAGED_MUSIC_ITEM_SCOPE/);
  assert.throws(()=>w.startPlanMusic(x.s,run,item,{...attempt,id:'other-attempt'}),/MANAGED_MUSIC_ITEM_CONFLICT/);
  const b=broker(x,async req=>{
    if(req.method==='POST')return{status:202,body:{task_id:'helper-task',status:'pending',songs:[{id:'h-A',status:'pending'},{id:'h-B',status:'pending'}]}};
    if(req.url.includes('/query?'))return{status:200,body:['h-A','h-B'].map(id=>({id,status:'succeeded',audio_url:'https://oss.yourmusic.fun/'+id+'.wav'}))};
    return{status:200,headers:{'content-type':'audio/wav'},body:wav(req.url.includes('h-A')?0.2:0.4)};
  });
  await b.pump();w.stopPlanMusic(x.s,{...run,stopRequested:true},item);await b.pump();
  const result=w.syncPlanMusic(x.s,run,item);
  assert.equal(result.state,'completed');assert.equal(result.stopped,true);assert.equal(result.costUnknown,true);
  assert.deepEqual(result.versions.map(v=>[v.version,v.externalId]),[['A','h-A'],['B','h-B']]);
  const work=x.s.get('works',result.workId);x.s.save('works',{...work,assets:{...work.assets,audio_A:work.assets.audio_B}});
  assert.throws(()=>w.syncPlanMusic(x.s,run,item),/MANAGED_MUSIC_ASSET_SCOPE/);
});

test('adapter timeout remains unknown under repeated original broker pumps and restart',async t=>{
  const x=setup(t),run=x.service.startManagedMusic(x.input);let posts=0;
  const b=broker(x,async()=>{posts++;throw Error('fixture timeout')});
  await b.pump();await b.pump();
  assert.equal(x.service.context(run.id).run.state,'unknown');
  const restarted=new w.ProductionFlowService(x.s.repo,x.service.options);
  assert.equal(restarted.startManagedMusic(x.input).state,'unknown');
  assert.equal(posts,1);assert.throws(()=>restarted.retry({id:run.id,expectedRevision:restarted.context(run.id).run.revision}),/OUTCOME_UNKNOWN/);
});

function planChild(x){
  const run={id:'stop-run',planId:'stop-plan',stopRequested:false,snapshot:{artistId:x.input.artistId,authorization:{music:true},music:{...x.input.music,route:'yourmusic'}}};
  const item={id:'stop-item',runId:run.id,material:{candidateId:x.candidateId}},attempt={id:'stop-attempt',runId:run.id,itemId:item.id,stage:'music_submit'};
  x.s.planCenterService=()=>({list:()=>({stageAttempts:[{runId:run.id,itemId:item.id,stage:'text_score',state:'succeeded',result:{evaluationRunId:x.evaluationId}}]})});
  return{run,item,child:w.startPlanMusic(x.s,run,item,attempt)};
}

for(const damage of ['work-artist','candidate-hash'])test('stop persists before damaged '+damage+' artifact checks and prevents any new POST',async t=>{
  const x=setup(t),{run,item,child}=planChild(x),work=x.s.get('works',child.workId);
  if(damage==='work-artist'){
    const artist=x.s.get('artists',work.artistId),id=randomUUID();x.s.save('artists',{...artist,id,name:'second fixture artist'});
    x.s.save('works',{...work,artistId:id});
  }else x.s.save('works',{...work,productionCandidateHash:'damaged'});
  assert.throws(()=>w.syncPlanMusic(x.s,run,item),/MANAGED_MUSIC_WORK_SCOPE/);
  const stopped=x.s.repo.transaction(()=>w.stopPlanMusic(x.s,{...run,stopRequested:true},item));
  assert.equal(x.service.context(child.childRunId).run.managedStopped,true);
  assert.equal(stopped.stopped,true);assert.equal(stopped.artifactError,'MANAGED_MUSIC_WORK_SCOPE');
  let posts=0;const b=broker(x,async()=>{posts++;throw Error('POST must not run')});await b.pump();
  assert.equal(posts,0);
});

test('damaged asset metadata cannot roll back a completed child stop',async t=>{
  const x=setup(t),{run,item,child}=planChild(x);
  const b=broker(x,async req=>req.method==='POST'?{status:202,body:{task_id:'asset-task',status:'pending',songs:[{id:'a',status:'pending'},{id:'b',status:'pending'}]}}:req.url.includes('/query?')?{status:200,body:['a','b'].map(id=>({id,status:'succeeded',audio_url:'https://oss.yourmusic.fun/'+id+'.wav'}))}:{status:200,headers:{'content-type':'audio/wav'},body:wav(req.url.endsWith('a.wav')?0.2:0.4)});
  await b.pump();await b.pump();
  const complete=x.service.context(child.childRunId).run,asset=x.s.get('assets',complete.assets[0].assetId);
  x.s.save('assets',{...asset,sha256:'0'.repeat(64)});
  const stopped=x.s.repo.transaction(()=>w.stopPlanMusic(x.s,{...run,stopRequested:true},item));
  assert.equal(stopped.artifactError,'MANAGED_MUSIC_ASSET_SCOPE');assert.deepEqual(stopped.versions,[]);
  assert.equal(x.service.context(child.childRunId).run.managedStopped,true);
});

test('damaged work does not stop collection of an already inflight original submit',async t=>{
  const x=setup(t),{run,item,child}=planChild(x);let posts=0;
  const b=broker(x,async req=>{
    if(req.method==='POST'){
      posts++;const work=x.s.get('works',child.workId);x.s.save('works',{...work,productionCandidateHash:'damaged-inflight'});
      const stopped=w.stopPlanMusic(x.s,{...run,stopRequested:true},item);assert.equal(stopped.artifactError,'MANAGED_MUSIC_WORK_SCOPE');
      return{status:202,body:{task_id:'inflight-original',status:'pending',songs:[{id:'original-a',status:'pending'},{id:'original-b',status:'pending'}]}};
    }
    if(req.url.includes('/query?')){assert(req.url.endsWith('original-a%2Coriginal-b'));return{status:200,body:['original-a','original-b'].map(id=>({id,status:'succeeded',audio_url:'https://oss.yourmusic.fun/'+id+'.wav'}))}};
    return{status:200,headers:{'content-type':'audio/wav'},body:wav(req.url.endsWith('original-a.wav')?0.3:0.5)};
  });
  await b.pump();await b.pump();await b.pump();
  const after=x.service.context(child.childRunId).run;
  assert.equal(after.managedStopped,true);assert.equal(after.state,'completed');assert.equal(after.assets.length,2);assert.equal(posts,1);
  assert.throws(()=>w.syncPlanMusic(x.s,run,item),/MANAGED_MUSIC_WORK_SCOPE/);
});

for(const edit of ['artist','lyrics','candidate-hash'])test('payable claim rechecks child work '+edit+' after user edit without stop',async t=>{
  const x=setup(t),{child}=planChild(x),work=x.s.get('works',child.workId);
  if(edit==='artist'){
    const artist=x.s.get('artists',work.artistId),id=randomUUID();x.s.save('artists',{...artist,id,name:'new author'});
    x.s.saveWork({...work,expected:work.revision,artistId:id});
  }else if(edit==='lyrics')x.s.saveWork({...work,expected:work.revision,lyrics:'User replaced the scored lyrics'});
  else x.s.save('works',{...work,productionCandidateHash:'corrupt'});
  let posts=0;const b=broker(x,async()=>{posts++;throw Error('no paid request authorized')});
  await b.pump();
  const after=x.service.context(child.childRunId).run;
  assert.equal(posts,0);assert.equal(after.state,'blocked');assert.deepEqual(after.reasons,['MANAGED_MUSIC_WORK_SCOPE']);
  assert.equal(x.s.all('operations').filter(o=>o.runId===after.id).length,0);
});
