const test=require('node:test'),assert=require('node:assert/strict');
const {createPlanFanqiePublisher,recoverPlanFanqie,planFanqieAction}=require('../output/plan-fanqie/index.cjs');
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
test('Core restart preserves uncertain intent rather than returning it to ready',()=>{
 const rows=[{id:'plan-fanqie:one',value:{id:'one',state:'dispatching'}},{id:'plan-fanqie:two',value:{id:'two',state:'uploaded'}}];
 const s={repo:{all:()=>rows},save:(_,row)=>{rows[rows.findIndex(x=>x.id===row.id)]=row;}};
 recoverPlanFanqie(s);assert.equal(rows[0].value.state,'unknown');assert.equal(rows[1].value.state,'uploaded');
});
test('Core rejects fabricated completion without official work ID',()=>{
 const s={mode:'production',repo:{get:()=>({value:{state:'dispatching'}})}};
 assert.throws(()=>planFanqieAction(s,'record',{id:'one',state:'uploaded',record:{stage:'contract_pending'}}),/FANQIE_SAVED_WORK_READBACK_REQUIRED/);
});
