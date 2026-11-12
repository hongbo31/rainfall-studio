const test=require('node:test'),assert=require('node:assert/strict');
const {createPlanFanqiePublisher,recoverPlanFanqie,planFanqieAction,YourMusicAdapter,renderPlanArtwork}=require('../output/plan-fanqie/index.cjs');
function harness(){
 const jobs=[1,2].map(i=>({id:'item'+i,workId:'work'+i,variant:'A',accountKey:'a'.repeat(64),configurationHash:'b'.repeat(64),fingerprint:'c'.repeat(64),state:'ready'}));
 const calls=[];let writes=0,fail=false,stopped=false,epoch=1;
 const rpc=async(method,input)=>{
  calls.push(method.split('.').at(-1));
  if(method.endsWith('.list'))return{ok:true,value:jobs.map(j=>({...j}))};
  const j=jobs.find(j=>j.id===input.id);
  if(method.endsWith('.current'))return stopped?{ok:false,error:{code:'STOP_REQUESTED'}}:{ok:true,value:j};
  if(method.endsWith('.claim')){assert.equal(j.state,'ready');j.state='dispatching';return{ok:true,value:{...j}};}
  assert.equal(j.state,'dispatching');Object.assign(j,input);return{ok:true,value:j};
 };
 const upload={status:()=>({busy:false}),publishScheduled:async(input,check)=>{await check();if(fail)throw Error('FANQIE_UPLOAD_READBACK_TIMEOUT');writes++;return{result:{uploaded:true,officialRecord:{id:'900'+writes,stage:'contract_pending'}}};}};
 return{jobs,calls,rpc,upload,get writes(){return writes},get epoch(){return epoch},stop(){stopped=true},fail(){fail=true},switch(){epoch++}};
}
test('scheduled publisher drains two distinct works once and never replays receipts',async()=>{
 const h=harness(),p=createPlanFanqiePublisher({rpc:h.rpc,upload:h.upload,available:()=>true,generation:()=>h.epoch});
 await p.pump();await p.pump();assert.equal(h.writes,2);assert.deepEqual(h.jobs.map(j=>j.state),['uploaded','uploaded']);
});
test('scheduled publisher sends explicitly scoped jobs to that account and preserves the legacy default',async()=>{
 const h=harness(),accountId='00000000-0000-4000-8000-000000000013',routed=[];
 h.jobs[1].accountId=accountId;
 const other={status:()=>({busy:false}),publishScheduled:async(input,check)=>{
  await check();routed.push(input.workId);
  return {result:{uploaded:true,officialRecord:{id:'8001',stage:'contract_pending'}}};
 }};
 const p=createPlanFanqiePublisher({rpc:h.rpc,upload:h.upload,available:()=>true,generation:()=>h.epoch,
  forAccount:async id=>{assert.equal(id,accountId);return other;}});
 await p.pump();
 assert.equal(h.writes,1);
 assert.deepEqual(routed,['work2']);
 assert.deepEqual(h.jobs.map(j=>j.state),['uploaded','uploaded']);
});
test('uncertain upload pauses remaining works; restart does not dispatch unknown intent',async()=>{
 const h=harness();h.fail();const options={rpc:h.rpc,upload:h.upload,available:()=>true,generation:()=>h.epoch};
 await createPlanFanqiePublisher(options).pump();assert.deepEqual(h.jobs.map(j=>j.state),['unknown','ready']);
 await createPlanFanqiePublisher(options).pump();assert.equal(h.writes,0);assert.deepEqual(h.jobs.map(j=>j.state),['unknown','ready']);
});
test('stop check is executed before browser writes',async()=>{
 const h=harness();h.stop();await createPlanFanqiePublisher({rpc:h.rpc,upload:h.upload,available:()=>true,generation:()=>h.epoch}).pump();
 assert.equal(h.writes,0);assert.equal(h.jobs[0].reason,'STOP_REQUESTED');
});
test('manual publisher lock prevents scheduled claims',async()=>{
 const h=harness();h.upload.status=()=>({busy:true});await createPlanFanqiePublisher({rpc:h.rpc,upload:h.upload,available:()=>true,generation:()=>h.epoch}).pump();
 assert.equal(h.calls.length,0);assert.equal(h.writes,0);
});
test('concurrent timer ticks share a single publisher and do not double claim',async()=>{
 const h=harness(),p=createPlanFanqiePublisher({rpc:h.rpc,upload:h.upload,available:()=>true,generation:()=>h.epoch});
 await Promise.all([p.pump(),p.pump()]);assert.equal(h.writes,2);
});
test('a ten-song occurrence waits for all materials and prepares exactly one scoped contract',async()=>{
 const accountId='00000000-0000-4000-8000-000000000013',runId='scheduled-run';
 const accountKey='a'.repeat(64),configurationHash='b'.repeat(64),fingerprint='c'.repeat(64);
 const jobs=Array.from({length:10},(_,i)=>({
  ordinal:i+1,workId:'work'+(i+1),variant:'A',fingerprint,batchSize:10,runId,accountId,accountKey,configurationHash,state:'ready',
 }));
 const selection=jobs.map(({workId,variant,fingerprint})=>({workId,variant,fingerprint}));
 let prepared=9,claims=0,contracts=0;
 const rpc=async(method,input)=>{
  switch(method.split('.').at(-1)){
   case 'list':return {ok:true,value:jobs.slice(0,prepared)};
   case 'claimBatch':
    assert.deepEqual(input,{runId});
    claims++;
    for(const job of jobs)job.state='dispatching';
    return {ok:true,value:{accountKey,configurationHash,items:selection}};
   case 'currentBatch':
    assert.equal(input.runId,runId);
    assert.ok(selection.some(work=>work.workId===input.workId));
    return {ok:true};
   case 'recordBatch':
    assert.equal(input.runId,runId);
    assert.equal(input.reason,undefined);
    assert.equal(input.receipts.length,10);
    assert.ok(input.receipts.every(receipt=>receipt.authorization==='awaiting_signature'));
    assert.equal(new Set(input.receipts.map(receipt=>receipt.record.id)).size,10);
    for(const job of jobs)job.state='uploaded';
    return {ok:true};
   default:assert.fail('Individual submission cannot consume a batch job');
  }
 };
 const upload={status:()=>({busy:false}),publishScheduled:()=>assert.fail('Individual upload dispatched')};
 const publisher=createPlanFanqiePublisher({rpc,upload,available:()=>true,generation:()=>1,
  forAccount:async id=>{
   assert.equal(id,accountId);
   return {...upload,publishScheduledBatch:async(input,check)=>{
    assert.deepEqual(input,{runId,accountKey,configurationHash,items:selection});
    contracts++;
    for(const work of input.items)await check(work.workId);
    const records=jobs.map(job=>({id:String(9000+job.ordinal),stage:'contract_pending'}));
    return {batch:{state:'complete',items:jobs.map((job,index)=>({
     workId:job.workId,result:{result:{officialRecord:records[index]}},
    })),authorization:records.map(record=>({id:record.id,phase:'awaiting_signature'}))}};
   }};
  },
 });
 await publisher.pump();
 assert.equal(claims,0);
 prepared=10;
 await Promise.all([publisher.pump(),publisher.pump()]);
 await publisher.pump();
 assert.equal(claims,1);
 assert.equal(contracts,1);
});
test('Core restart preserves uncertain intent rather than returning it to ready',()=>{
 const rows=[{id:'plan-fanqie:one',value:{id:'one',state:'dispatching'}},{id:'plan-fanqie:two',value:{id:'two',state:'uploaded'}}];
 const s={repo:{all:()=>rows},save:(_,row)=>{rows[rows.findIndex(x=>x.id===row.id)]=row;}};
 recoverPlanFanqie(s);assert.equal(rows[0].value.state,'unknown');assert.equal(rows[1].value.state,'uploaded');
});
test('Core rejects fabricated completion without official work ID',()=>{
 const s={mode:'production',repo:{get:()=>({value:{state:'dispatching'}})}};
 assert.throws(()=>planFanqieAction(s,'record',{id:'one',state:'uploaded',record:{stage:'contract_pending'}}),/FANQIE_SAVED_WORK_READBACK_REQUIRED/);
});
test('prompt submissions accept a verified 2xx receipt and preserve uncertain outputs without replay',async()=>{
 let requests=0,scoped=0;
 const receipt={task_id:'receipt',status:'pending',songs:[{id:'song-a'},{id:'song-b'}]};
 const adapter=new YourMusicAdapter({source:'fixture',credential:async()=>'fixture',request:async input=>{
  assert.equal(new URL(input.url).pathname,'/v1/suno/generate/prompt');
  await input.assertDispatch();
  requests++;
  return {status:201,body:requests===1?receipt:{...receipt,songs:[{id:'song-a'},{id:'song-a'}]}};
 }});
 const input={modelId:'chirp-v6',prompt:'恋爱风，雨后街角'};
 const check=async()=>{scoped++;};
 assert.deepEqual(await adapter.submitPrompt(input,check),{state:'accepted',trackingId:'receipt',songIds:['song-a','song-b']});
 assert.deepEqual(await adapter.submitPrompt(input,check),{state:'unknown',reason:'DUPLICATE_REMOTE_ID'});
 assert.equal(requests,2);
 assert.equal(scoped,2);
});
test('local artwork is a deterministic square release image with per-song variation',async()=>{
 const first=await renderPlanArtwork('恋爱','first');
 const metadata=await require('sharp')(first).metadata();
 assert.deepEqual([metadata.format,metadata.width,metadata.height],['jpeg',1440,1440]);
 assert.deepEqual(await renderPlanArtwork('恋爱','first'),first);
 assert.notDeepEqual(await renderPlanArtwork('恋爱','second'),first);
});
