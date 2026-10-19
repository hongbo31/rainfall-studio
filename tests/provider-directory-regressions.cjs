const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto'),{EventEmitter}=require('node:events');
// Probes have no sockets, no vault, and only fresh disposable databases.
require('node:net').Socket.prototype.connect=function(){throw Error('REVIEW_NETWORK_FORBIDDEN')};
const m=require(process.env.RAINFALL_PROVIDER_DIRECTORY_REGRESSION_BUNDLE);
const root=path.resolve('output/provider-directory-regressions/data',randomUUID());fs.mkdirSync(root,{recursive:true});
function providerFixture(){
 const s=new m.Studio(path.join(root,'provider-'+randomUUID()),'production'),p=randomUUID(),artistId=s.all('artists')[0].id;
 s.save('settings',{id:'api-profile:'+p,kind:'text',providerId:'doubao',label:'Offline review',revision:1,modelId:'fixture-doubao',executionEnabled:false,textPricing:{currency:'CNY',modelId:'fixture-doubao',inputMicrosPerMillionTokens:1000,outputMicrosPerMillionTokens:1000,source:'offline review fixture',version:'fixture',responseModelIds:['fixture-doubao']}});
 const c=s.planCenterService(),plan=c.save({plan:{id:randomUUID(),artistId,title:'Offline review',theme:'rain',styleTemplate:'acoustic',enabled:false,schedule:{kind:'daily',localTime:'09:00'},outputs:{lyrics:true,cover:false,music:false},material:{source:'provider'},text:{profileId:p,profileRevision:1,budgetMicros:100000,maxOutputTokens:2048,consent:true,threshold:75,maxRewrites:1,maxScoreRetries:1},music:{route:'manual'},authorization:{text:true,music:false,publish:false}},expectedRevision:null});
 const run=c.run({id:plan.id,expectedRevision:plan.revision,summaryHash:c.preview({id:plan.id}).summaryHash,requestId:randomUUID(),source:'manual'});m.tickPlanCenter(s);
 return{s,c,run,text:s.providerTextService(),job:()=>s.providerTextService().list()[0]};
}
async function stopDuringDns(){
 const x=providerFixture(),claim=x.text.claim({id:x.job().id}),dns=require('node:dns'),https=require('node:https'),oldDns=dns.promises.lookup,oldRequest=https.request;
 let sent=0,dispatchChecks=0,stopObserved=false;
 dns.promises.lookup=async()=>{await x.s.call('planCenter.stop',{runId:x.run.id});stopObserved=x.c.list().runs.find(r=>r.id===x.run.id).stopRequested;assert.equal(x.text.context(x.job().id).dispatchAllowed,false);return[{address:'8.8.8.8',family:4}];};
 https.request=()=>{sent++;const r=new EventEmitter();r.setTimeout=()=>r;r.write=()=>true;r.end=()=>queueMicrotask(()=>r.emit('error',Error('OFFLINE_SEND_OBSERVED')));return r;};
 try{const adapter=new m.ProviderTextAdapter({request:m.nodeHttpsTransport,credential:async()=>'offline-placeholder',assertActive:()=>{}});await adapter.invoke(claim.request,async()=>{dispatchChecks++;assert.equal(x.text.context(x.job().id).dispatchAllowed,true);});assert.equal(sent,0);assert.equal(x.job().operations.length,1);assert.equal(x.text.context(x.job().id).dispatchAllowed,false);console.log(JSON.stringify({probe:'stop-during-dns',stopObserved,dispatchChecks,httpRequestsStartedAfterStop:sent}));}
 finally{dns.promises.lookup=oldDns;https.request=oldRequest;x.s.close();}
}
async function directoryStarvation(){
 const base=path.join(root,'directory'),tasks=path.join(base,'tasks'),data=path.join(base,'data');fs.mkdirSync(tasks,{recursive:true});const repo=new m.Repository(path.join(data,'library.sqlite'));let clock=Date.now();const now=()=>new Date(clock),center=new m.PlanCenterService(repo,{now,recoverDispatching:false});
 const plan=center.save({plan:{id:randomUUID(),artistId:randomUUID(),title:'Offline directory',enabled:false,schedule:{kind:'daily',localTime:'09:00'},material:{source:'manual'},text:{},music:{route:'manual'}},expectedRevision:null});
 const ctl=new m.DirectoryTaskController(repo,{dataRoot:data,now,center:()=>center,fileAttributes:()=>0});let source=ctl.configureDirectory({root:tasks,expectedRevision:null});source=ctl.save({id:source.id,expectedRevision:source.revision,planId:plan.id,planRevision:1,intervalSeconds:5,readiness:'stable-json'});source=ctl.resume({id:source.id,expectedRevision:source.revision});
 for(let n=0;n<101;n++)fs.writeFileSync(path.join(tasks,String(n).padStart(3,'0')+'.rainfall-request.json'),JSON.stringify({schemaVersion:1,requestId:'review-'+n,revision:1,planId:plan.id,planRevision:1}));
 const counts=[];for(let n=0;n<5;n++){await ctl.scanNow({id:source.id,expectedRevision:source.revision});counts.push(ctl.status().requests.length);clock+=3000;}
 assert.equal(counts.at(-1),101);assert.equal(ctl.status().requests.some(r=>r.request.requestId==='review-100'),true);assert.equal(ctl.status().sources[0].error,undefined);console.log(JSON.stringify({probe:'directory-batch-starvation',files:101,acceptedPerScan:counts,lastSourceError:ctl.status().sources[0].error}));repo.close();
}
async function providerRetry(){
 const x=providerFixture();try{const cl=x.text.claim({id:x.job().id});x.text.record({id:cl.job.id,operationId:cl.operation.id,result:{operationId:cl.operation.id,providerId:cl.job.providerId,requestedModelId:cl.job.modelId,status:'invalid',providerRequestId:'offline-id',providerModel:cl.job.modelId,finishReason:'length',httpStatus:200,usage:{promptTokens:10,completionTokens:10,cachedTokens:0},content:null,reason:'TEXT_RESPONSE_METADATA_INVALID'}});m.tickPlanCenter(x.s);
 const failed=x.c.list().stageAttempts.find(a=>a.stage==='text_generate');assert.equal(failed.state,'failed');const stages=x.c.list().stageAttempts.length;await assert.rejects(()=>x.s.call('planCenter.retry',{attemptId:failed.id}),/PROVIDER_TEXT_RETRY_REQUIRES_NEW_RUN/);for(let n=0;n<4;n++)m.tickPlanCenter(x.s);assert.equal(x.c.list().stageAttempts.length,stages);assert.equal(x.text.list().length,1);assert.equal(x.job().operations.length,1);console.log(JSON.stringify({probe:'provider-generation-retry',retryBlocked:true,additionalAttempts:0,providerOperations:1}));
 }finally{x.s.close();}
}
(async()=>{let failed=0;for(const probe of [stopDuringDns,directoryStarvation,providerRetry]){try{await probe();}catch(e){failed++;console.error(probe.name,e);}}if(failed)throw Error('REGRESSIONS_FAILED:'+failed);})().catch(e=>{console.error(e);process.exitCode=1});
