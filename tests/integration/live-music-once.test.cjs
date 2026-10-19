const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const core=require('../../build/core.cjs'),{ApiCredentials}=require('../../build/api-credentials.cjs');
const {draft}=require('../fixtures/workflow.cjs');
const prompt='Mandarin romantic pop, warm male vocal, piano, acoustic guitar, light drums, 88 BPM, intimate verses, soaring chorus, clear Mandarin diction';
const input=()=>({requestId:randomUUID(),profileId:randomUUID(),expectedRevision:1,lyrics:'[Verse 1]\n下班以后穿过街灯\n你在厨房等我进门\n[Pre-Chorus]\n把一天轻轻放下\n[Chorus]\n为我示例作品A\n把明天慢慢说成我们\n[Bridge]\n往后的雨晴一起等\n[Outro]\n回家的路上有我们',style:prompt,duration:210,balanceBefore:385,creditCap:385,consent:true});
function setup({unknown=false}={}){
 const root=path.resolve('output/test-runs/live-music-'+randomUUID());let posts=0;let studio;
 const adapter={source:'external',capabilities:{provider:'yourmusic',version:'openapi-1.0.0',maximumOutputs:2,lookupByClientKey:false,automaticPaid:false},submit:async()=>{posts++;const op=studio.all('operations').find(o=>o.kind==='music');assert.equal(op.state,'dispatching');assert.equal(op.maxCost,385);return unknown?{state:'unknown'}:{state:'accepted',trackingId:'provider-task',songIds:['song-a','song-b']};},query:async()=>({state:'known',songs:[]}),download:async()=>{throw Error('not used')}};
 studio=new core.Studio(root,'production',{musicAdapter:adapter});return{studio,root,posts:()=>posts,adapter};
}
test('one authorized live attempt persists before transport, pins cap and cannot submit twice',async()=>{
 assert.equal(typeof core.stageLiveMusic,'function');const x=setup(),i=input();try{
  const op=core.stageLiveMusic(x.studio,i);assert.equal(op.state,'prepared');assert.equal(op.maxCost,385);assert.equal(op.source,'external');assert.equal(op.qualityReview,'user_authorized_direction_no_automatic_score');
  assert.equal(core.stageLiveMusic(x.studio,i).id,op.id);
  assert.throws(()=>core.stageLiveMusic(x.studio,{...i,requestId:randomUUID()}),/ONE_SHOT_ALREADY_STAGED/);
  await x.studio.musicService().submit(op.id);await x.studio.musicService().submit(op.id);assert.equal(x.posts(),1);
  const result=x.studio.get('operations',op.id);assert.deepEqual(result.songIds,['song-a','song-b']);assert.equal(result.costState,'unknown');
  assert.equal(x.studio.all('workflowLedger').find(e=>e.kind==='reserve').unit,'provider_credit');
  assert.equal(x.studio.all('dailyPlans').length,0);
 }finally{x.studio.close()}
});
test('unknown live result survives restart without a second POST and rejects other authorization scopes',async()=>{
 assert.equal(typeof core.stageLiveMusic,'function');const x=setup({unknown:true}),i=input();let op;try{
  for(const change of [{consent:false},{creditCap:386},{balanceBefore:386}])assert.throws(()=>core.stageLiveMusic(x.studio,{...i,...change}));
  op=core.stageLiveMusic(x.studio,i);await x.studio.musicService().submit(op.id);assert.equal(x.studio.get('operations',op.id).state,'unknown');assert.equal(x.posts(),1);
 }finally{x.studio.close()}
 const reopened=new core.Studio(x.root,'production',{musicAdapter:x.adapter});try{await reopened.musicService().submit(op.id);assert.equal(x.posts(),1);assert.equal(core.stageLiveMusic(reopened,i).state,'unknown');assert.equal(typeof reopened.musicService().recoverAccepted,'function');reopened.musicService().recoverAccepted(op.id,{state:'accepted',trackingId:'recovered-task',songIds:['song-a','song-b']});assert.equal(reopened.get('operations',op.id).state,'accepted');await reopened.musicService().submit(op.id);assert.equal(x.posts(),1)}finally{reopened.close()}
 const simulation=new core.Studio(path.resolve('output/test-runs/live-sim-'+randomUUID()),'simulation');try{assert.throws(()=>core.stageLiveMusic(simulation,input()),/PRODUCTION_REQUIRED/)}finally{simulation.close()}
});
test('normal Main credential channel constructs adapter without exposing a key and rejects simulation',async()=>{
 assert.equal(typeof ApiCredentials.prototype.withMusicAdapter,'function');let mode='production',gets=0;const i=input();
 const profile={id:i.profileId,kind:'music',providerId:'yourmusic',label:'test',modelId:'chirp-v6',executionEnabled:false,revision:1};
 const calls=[];const service=new ApiCredentials({vault:{get:()=>{gets++;return 'FAKE_PRIVATE_KEY'},isAvailable:()=>true},context:()=>({mode,generation:1}),getProfile:async()=>profile,connectionRequest:async r=>{calls.push(r);return{status:202,body:{task_id:'task',status:'pending',songs:[{id:'a',status:'pending'},{id:'b',status:'pending'}]}}}});
 const result=await service.withMusicAdapter({profileId:i.profileId,expectedRevision:1},adapter=>adapter.submit({draft:draft(),modelId:'chirp-v6',operationId:'operation'}));
 assert.equal(result.state,'accepted');assert.equal(calls.length,1);assert.equal(calls[0].body.is_max_mode,false);assert(!JSON.stringify(result).includes('FAKE_PRIVATE_KEY'));assert.equal(gets,1);
 mode='simulation';await assert.rejects(service.withMusicAdapter({profileId:i.profileId,expectedRevision:1},async()=>null));assert.equal(gets,1);
 mode='production';await assert.rejects(service.withMusicAdapter({profileId:i.profileId,expectedRevision:1},adapter=>adapter.submit({draft:draft(),modelId:'chirp-v6',operationId:'stale'}),()=>{throw Error('STALE_CORE_GENERATION')}),/STALE_CORE_GENERATION/);assert.equal(calls.length,1);assert.equal(gets,1);
});
test('a durable dispatching attempt becomes unknown on Core restart before any status call',()=>{
 const x=setup(),i=input();const op=core.stageLiveMusic(x.studio,i);x.studio.save('operations',{...op,state:'dispatching'});x.studio.close();
 const reopened=new core.Studio(x.root,'production',{musicAdapter:x.adapter});try{assert.equal(core.liveMusicContext(reopened).operation.state,'unknown');assert.equal(x.posts(),0)}finally{reopened.close()}
});
test('Main durable dispatch marker blocks duplicate POST and stale worker source',async()=>{
 const {createLiveMusicBroker}=require('../../build/live-music.cjs');const x=setup(),i=input();let count=0;
 try{
  const op=core.stageLiveMusic(x.studio,i);x.studio.save('operations',{...op,state:'dispatching'});
  const profile={id:i.profileId,kind:'music',providerId:'yourmusic',label:'test',modelId:'chirp-v6',executionEnabled:false,revision:1};
  const credentials=new ApiCredentials({vault:{get:()=> 'FAKE_PRIVATE',isAvailable:()=>true},context:()=>({mode:'production',generation:1}),getProfile:async()=>profile,connectionRequest:async()=>{count++;return{status:202,body:{task_id:'task',status:'pending',songs:[{id:'a',status:'pending'},{id:'b',status:'pending'}]}}}});
  const broker=createLiveMusicBroker({root:x.root,credentials,available:()=>true,rpc:async()=>({ok:true,value:core.liveMusicContext(x.studio)})});
  const message={kind:'music-provider',id:randomUUID(),action:'submit',operationId:op.id};
  await assert.rejects(broker.provider(message,()=>{throw Error('STALE_CORE_GENERATION')}),/STALE_CORE_GENERATION/);assert.equal(count,0);
  const result=await broker.provider(message);assert.equal(result.state,'accepted');assert.equal(count,1);
  assert(fs.existsSync(path.join(x.root,'production/music-receipts',op.id,'dispatch.json')));
  assert(!fs.readFileSync(path.join(x.root,'production/music-receipts',op.id,'submit-result.json'),'utf8').includes('FAKE_PRIVATE'));
  await assert.rejects(broker.provider({...message,id:randomUUID()}));assert.equal(count,1);
 }finally{x.studio.close()}
});
test('read-only recovery uses actual dispatch time after a draft waits longer than five minutes',async()=>{
 const {createLiveMusicBroker}=require('../../build/live-music.cjs'),x=setup(),i=input();try{
  const op=core.stageLiveMusic(x.studio,i),sentAt=new Date().toISOString();x.studio.save('operations',{...op,state:'unknown',createdAt:new Date(Date.now()-600000).toISOString()});
  const c=core.liveMusicContext(x.studio),folder=path.join(x.root,'production/music-receipts',op.id);fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'dispatch.json'),JSON.stringify({operationId:op.id,requestId:i.requestId,at:sentAt}));
  const profile={id:i.profileId,kind:'music',providerId:'yourmusic',label:'test',modelId:'chirp-v6',executionEnabled:false,revision:1},calls=[];
  const lyrics=c.draft.draft.sections.map(s=>`[${s.kind}]\n${s.lines.join('\n')}`).join('\n\n');
  const credentials=new ApiCredentials({vault:{get:()=> 'FAKE_PRIVATE',isAvailable:()=>true},context:()=>({mode:'production',generation:1}),getProfile:async()=>profile,connectionRequest:async request=>{calls.push(request);return{status:200,body:{data:['recovered-a','recovered-b'].map(id=>({id,status:'processing',title:'示例作品A',lyric:lyrics,model_name:'chirp-v6',created_at:sentAt})),page:1,size:20,total:2,total_pages:1}}}});
  const broker=createLiveMusicBroker({root:x.root,credentials,available:()=>true,rpc:async(method,args)=>({ok:true,value:method==='internal.liveMusic.recover'?x.studio.musicService().recoverAccepted(args.id,args.result):core.liveMusicContext(x.studio)})});
  const result=await broker.ui('recover',{});assert.equal(result.state,'accepted');assert.deepEqual(result.songIds,['recovered-a','recovered-b']);assert.equal(result.trackingId,null);assert.equal(calls.length,1);assert.equal(calls[0].method,'GET');assert.equal(x.posts(),0);
 }finally{x.studio.close()}
});
