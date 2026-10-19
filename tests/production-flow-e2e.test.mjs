import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import sharp from 'sharp';
const require=createRequire(import.meta.url),w=require(process.env.RAINFALL_PRODUCTION_E2E_BUNDLE),original=require('./fixtures/workflow.cjs').draft();
function wav(hz){const length=8000,b=Buffer.alloc(44+length*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(length*2,40);for(let i=0;i<length;i++)b.writeInt16LE(Math.round(1000*Math.sin(i*2*Math.PI*hz/8000)),44+i*2);return b;}
const usage={prompt_tokens:100,completion_tokens:100,prompt_cache_hit_tokens:0,prompt_cache_miss_tokens:100};
test('offline durable whole flow: schedule → draft → scored bounded revision → work → original music/assets → scoped publication → receipt/restart',async t=>{
 const root=path.resolve('output/test-runs/production-e2e-'+randomUUID());fs.mkdirSync(root,{recursive:true});let now=new Date('2026-10-16T08:59:50Z'),s=new w.Studio(root,'production',{now:()=>now});t.after(()=>s.close());
 const artistId=s.all('artists')[0].id,textId=randomUUID(),musicId=randomUUID(),accountId=randomUUID(),termsHash='b'.repeat(64),trace=[];let generated=0,scored=0;
 for(const [id,kind,providerId,modelId]of [[textId,'text','deepseek','deepseek-flash'],[musicId,'music','yourmusic','chirp-v6']])s.save('settings',{id:'api-profile:'+id,kind,providerId,label:'OFFLINE E2E ONLY',modelId,executionEnabled:false,revision:1});
 const transport=async r=>{
  const url=new URL(r.url);trace.push({method:r.method,host:url.hostname,path:url.pathname,fixture:true});
  if(url.hostname==='api.deepseek.com'){
   const body=JSON.parse(r.body.messages[1].content);let output;
   if(body.revisionId){scored++;const value=scored===1?40:90;output={revisionId:body.revisionId,dimensions:{lyrics:value,style:value,coherence:value},findings:['歌词中的“'+body.pair.lyrics.split('\n').find(l=>l&&!l.startsWith('['))+'”与本轮主题相呼应，表达可继续打磨。']};}
   else{generated++;output={...original,title:'隔离诊断候选第'+generated+'版'};}
   return{status:200,body:{id:'fixture-text-'+trace.length,model:'deepseek-flash',usage,choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}]}};
  }
  if(url.hostname==='api.yourmusic.fun'&&r.method==='POST')return{status:202,body:{task_id:'fixture-music-task',status:'pending',songs:[{id:'original-a',status:'pending'},{id:'original-b',status:'pending'}]}};
  if(url.hostname==='api.yourmusic.fun'&&r.method==='GET')return{status:200,body:[{id:'original-b',status:'succeeded',audio_url:'https://oss.yourmusic.fun/b.wav',lyric:'诊断音没有演唱歌词'},{id:'original-a',status:'succeeded',audio_url:'https://oss.yourmusic.fun/a.wav',lyric:'诊断音没有演唱歌词'}]};
  if(url.hostname==='oss.yourmusic.fun')return{status:200,headers:{'content-type':'audio/wav'},body:wav(url.pathname==='/a.wav'?220:330)};
  throw Error('OFFLINE_FIXTURE_ROUTE_REJECTED');
 };
 const makeFlow=()=>{const base=w.createProductionFlowService(s);return new w.ProductionFlowService(s.repo,{...base.options,verifyMusicPricing:()=>true,publicationAuthority:()=>({allowed:true,termsHash,evidenceId:'OFFLINE_TEST_AUTHORITY'}),publicationMaterials:({work})=>{const a=work.assets?.audio_A,c=work.assets?.cover;return{ready:!!a&&!!c&&s.lyricService().forWork(work).alignmentConfirmed,reasons:['OFFLINE_MATERIALS_PENDING']};}});};
 let flow=makeFlow();s.productionFlowService=()=>flow;
 const rpc=async(method,input={})=>{try{const action=method.slice('internal.productionFlow.'.length);if(action==='importAudio')return{ok:true,value:await w.importProductionAudio(s,input)};return{ok:true,value:action==='context'?flow.context(input.id):flow[action](input)}}catch(e){return{ok:false,error:{code:e.message}}}};
 const credentials={apiCredentialStatus:async()=>({configured:true}),withDeepSeekAdapter:async(_i,fn,guard)=>fn(new w.DeepSeekAdapter({request:transport,credential:async()=> 'OFFLINE_NOT_A_KEY',assertActive:guard})),withMusicAdapter:async(_i,fn)=>fn(new w.YourMusicAdapter({source:'external',request:transport,credential:async()=> 'OFFLINE_NOT_A_KEY'}))};
 let submitCount=0;
 const publication={capability:()=>({available:true,reasons:[],transport:'OFFLINE_TEST_EXECUTOR',receiptSource:'fixture'}),submit:async r=>{submitCount++;trace.push({publication:'fixture_submit',payloadHash:r.payloadHash});return{type:'publication_submit',status:'accepted',externalId:'fixture-release-1'}},poll:async()=>({type:'publication_poll',status:'complete',externalId:'fixture-release-1',receipt:{externalId:'fixture-release-1',evidenceId:'OFFLINE_TEST_RECEIPT',observedAt:now.toISOString(),source:'official'}})};
 const broker=w.createProductionFlowBroker({rpc,credentials,available:()=>true,generation:()=>1,publication});
 const p=flow.savePlan({expectedRevision:null,plan:{id:randomUUID(),artistId,title:'离线整链路验收',theme:'原创雨中相识',timezone:'Etc/UTC',localTime:'09:00',candidateMode:'deepseek',scoreMode:'deepseek',text:{profileId:textId,profileRevision:1,modelId:'deepseek-flash',maxOutputTokens:2048,budgetMicros:100000,consent:true},music:{profileId:musicId,profileRevision:1,modelId:'chirp-v6',maxCostPerRequestCredits:5,budgetCredits:5,pricingEvidence:'OFFLINE_TEST_PRICE_ONLY',consent:true},publication:{target:'tme',accountId,termsHash},autoContinue:false,threshold:75,maxRevisions:2,maxRunsPerDay:1}});
 flow.enable({id:p.id,expectedRevision:p.revision});now=new Date('2026-10-16T09:00:10Z');flow.tick();let run=flow.list().runs[0];assert(run);
 const current=()=>flow.context(run.id).run;
 await broker.pump();assert.equal(current().state,'awaiting_approval');assert.equal(generated,1);assert.equal(trace.filter(r=>r.host==='api.yourmusic.fun').length,0);
 flow.approve({id:run.id,expectedRevision:current().revision,stage:'candidate',consent:true});await broker.pump();assert.equal(scored,1);await broker.pump();assert.equal(generated,2);assert.equal(current().state,'awaiting_approval');assert.equal(current().candidateApproved,false);
 flow.approve({id:run.id,expectedRevision:current().revision,stage:'candidate',consent:true});await broker.pump();assert.equal(scored,2);assert.equal(current().score.overall,90);
 await broker.pump();assert.equal(trace.filter(r=>r.method==='POST'&&r.host==='api.yourmusic.fun').length,1);assert.equal(current().musicReservedCredits,5);
 await broker.pump();assert.equal(current().assets.length,2);assert.equal(current().assets[0].providerSongId,'original-a');assert.equal(submitCount,0);
 const workId=current().workId,cover=path.join(root,'OFFLINE-original-cover.png');await sharp({create:{width:1000,height:1000,channels:3,background:'#452e57'}}).png().toFile(cover);await s.importFile(cover,'cover',workId);
 const lyrics=s.lyricService().preview(workId);s.lyricService().confirm({workId,versionId:lyrics.versionId,plainHash:lyrics.plainHash,audioHash:lyrics.audioHash,confirmed:true});
 // Production readiness must not ignore missing real author/AI metadata just because checkbox confirmations exist.
 const materialCheck=w.createProductionFlowService(s).options.publicationMaterials,realTme=s.tmeDraftService;
 const exactWork=s.get('works',workId),exactAudio=s.get('assets',exactWork.assets.audio_A);let issues=['AUTHOR_NAMES'];
 s.tmeDraftService=()=>({list:()=>[{source:'local',workId,workRevision:exactWork.revision,assets:{audio:{sha256:exactAudio.sha256}},issues}],assertCurrent:()=>true});
 assert.equal(materialCheck({run:current(),work:exactWork}).ready,false);issues=['AI_UNKNOWN'];assert.equal(materialCheck({run:current(),work:exactWork}).ready,false);issues=[];assert.equal(materialCheck({run:current(),work:exactWork}).ready,true);s.tmeDraftService=realTme;
 flow.next({id:run.id});assert.equal(current().state,'awaiting_approval');assert.equal(current().stage,'publication');assert.equal(submitCount,0);
 flow.approve({id:run.id,expectedRevision:current().revision,stage:'publication',consent:true,accountId,termsHash});await broker.pump();await broker.pump();assert.equal(current().state,'completed');assert.equal(submitCount,1);
 const operations=s.all('operations'),assets=s.all('assets');assert.equal(operations.filter(o=>o.taskType==='text_generate').length,2);assert.equal(operations.filter(o=>o.taskType==='text_score').length,2);assert.equal(assets.filter(a=>a.kind==='audio').length,2);assert.equal(current().musicReservedCredits,5);assert(current().textSpentMicros>0);
 flow=makeFlow();await broker.pump();flow.tick();assert.equal(flow.list().runs.length,1);assert.equal(submitCount,1);assert.equal(trace.filter(r=>r.method==='POST'&&r.host==='api.yourmusic.fun').length,1);
 fs.writeFileSync('output/production-flow-offline-e2e.json',JSON.stringify({passed:true,source:'isolated_offline_fixture',root,runId:run.id,workId,state:current().state,textGenerations:generated,modelScores:scored,musicFixtureSubmissions:1,publicationFixtureSubmissions:1,realHttpRequests:0,realPublicationSubmissions:0,reservedMusicCredits:5,assets:assets.map(a=>({kind:a.kind,sha256:a.sha256})),trace},null,2));
});

test('backup cannot erase production identities and restored plans cannot silently reuse paid consent',async t=>{
 const root=path.resolve('output/test-runs/production-restore-'+randomUUID());fs.mkdirSync(root,{recursive:true});const s=new w.Studio(root,'production');t.after(()=>s.close());
 let flow=s.productionFlowService();const artistId=s.all('artists')[0].id;
 const p=flow.savePlan({expectedRevision:null,plan:{id:randomUUID(),artistId,title:'Restore identity',theme:'local original',timezone:'Etc/UTC',localTime:'09:00'}});
 flow.enable({id:p.id,expectedRevision:p.revision});
 const before=path.join(root,'before.zip');await s.backup(before);
 const r=flow.trigger({planId:p.id,requestId:randomUUID()});flow.next({id:r.id});
 await assert.rejects(s.restore(before),/RESTORE_POST_SNAPSHOT_PRODUCTION_FLOW/);
 const complete=path.join(root,'after.zip');await s.backup(complete);await s.restore(complete);flow=s.productionFlowService();
 const restored=flow.context(r.id).run;assert.equal(flow.list().plans[0].enabled,false);assert.equal(restored.state,'blocked');assert.deepEqual(restored.reasons,['RESTORED_REQUIRES_REVIEW']);
 assert.throws(()=>flow.retry({id:r.id,expectedRevision:restored.revision}),/RESTORED_REQUIRES_REVIEW/);
 assert.equal(flow.next({id:r.id}).task,null);assert.equal(s.all('operations').length,0);
});
