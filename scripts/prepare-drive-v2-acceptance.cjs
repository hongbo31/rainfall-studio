const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto');
const blockNetwork=()=>{throw Error('ACCEPTANCE_NETWORK_FORBIDDEN');};
globalThis.fetch=blockNetwork;for(const name of ['node:http','node:https']){const module=require(name);module.request=blockNetwork;module.get=blockNetwork;}require('node:net').connect=blockNetwork;require('node:net').createConnection=blockNetwork;
const w=require(process.env.RAINFALL_DOT_ACCEPTANCE_BUNDLE);
const root=process.cwd(),folder=path.resolve('output/drive-v2-acceptance-20261019'),record=path.join(folder,'request-handoff.json');
const connection=JSON.parse(fs.readFileSync(path.resolve('output/dot-drive-connected-20261018/connection-evidence.json'),'utf8'));
const sharedRoot=path.resolve(connection.projectRoot),projectRoot=path.join(sharedRoot,'acceptance-v2-20261019');
const dataRoot=path.join(folder,'isolated-data'),inboxRoot=path.join(dataRoot,'production','inbox-v1'),dbFile=path.join(dataRoot,'production','library.sqlite');
const preflight=JSON.parse(fs.readFileSync(path.join(folder,'binding-preflight.json'),'utf8'));
assert.equal(preflight.projectRoot,sharedRoot);assert.equal(preflight.writesToDrive,0);
assert.ok(Date.now()-Date.parse(preflight.at)<30*60*1000,'Fresh binding preflight required');
assert.ok(preflight.sharedRootIsolatedOwnerConflict,'Shared root binding must have been explicitly checked');
assert.equal(path.dirname(projectRoot),sharedRoot);assert.equal(path.basename(projectRoot),'acceptance-v2-20261019');
w.assertInboxPath(projectRoot);w.assertInboxPath(dataRoot);
const existed=fs.existsSync(projectRoot);
if(existed&&!fs.existsSync(dbFile))throw Error('ACCEPTANCE_PROJECT_ALREADY_EXISTS_NO_LOCAL_OWNER');
const repo=new w.Repository(dbFile),service=new w.PlanCenterService(repo,{recoverDispatching:false});
let controller;
try{
 const saved=repo.maybe('settings','drive-v2:acceptance-workspace');
 if(existed&&(!saved||saved.projectRoot!==projectRoot))throw Error('ACCEPTANCE_PROJECT_OWNERSHIP_CONFLICT');
 if(!saved){
  assert.equal(repo.all('artists').length,0);assert.equal(service.list().plans.length,0);
  const artistId=randomUUID();repo.save('artists',{id:artistId,name:'温柔日常·隔离验收创作者'});
  repo.save('settings',{id:'drive-v2:acceptance-workspace',projectRoot,artistId,createdAt:new Date().toISOString(),autopublish:false});
 }
 const state=repo.get('settings','drive-v2:acceptance-workspace');
 if(!existed){fs.mkdirSync(projectRoot);fs.mkdirSync(path.join(projectRoot,'incoming'));fs.mkdirSync(path.join(projectRoot,'receipts'));}
 controller=new w.InboxController(repo,inboxRoot);
 if(!controller.status().configured)controller.configure({workspaceRef:'rainfall-v2-acceptance-20261019',artistRef:'acceptance-creator',artistId:state.artistId,seriesRef:null,seriesId:null,expectedRevision:0});
 let status=controller.status();
 if(!status.bridge.configured)controller.configureBridge({projectRoot,expectedRevision:0},'authorized-local-setup');
 status=controller.status();assert.equal(status.bridge.projectRoot,projectRoot);assert.equal(status.channel.artistRefs['acceptance-creator'],state.artistId);
 let plan=service.list().plans[0];
 if(!plan)plan=service.save({expectedRevision:null,plan:{id:randomUUID(),title:'把顺路走成每天',artistId:state.artistId,enabled:false,timezone:'Asia/Shanghai',schedule:{kind:'once',date:new Date().toISOString().slice(0,10),localTime:'09:00'},count:1,theme:'温柔恋爱日常故事：两个人因下雨相识，从下班顺路并肩、记住彼此咖啡口味，到把普通的一天过成轻轻的告白。写一份完整原创中文歌词与一张原创封面；情绪温暖克制、细节具体，不引用现有歌曲，不使用真实人物肖像。不生成音频，不发布。',styleTemplate:'中文温柔流行；木吉他与柔和钢琴的画面感，中慢节奏；歌词自然可唱。封面以雨后街角、两把靠近的伞、暖窗和淡紫暮色构图，方形，无字，不模仿现存专辑。',outputs:{lyrics:true,cover:true,music:false},material:{source:'dot',channel:status.channel.id,identity:'acceptance-creator'},text:{consent:false},music:{route:'manual',consent:false},publishTargets:[],authorization:{text:false,music:false,publish:false}}});
 assert.equal(service.list().plans.length,1);assert.equal(plan.enabled,false);assert.deepEqual(plan.outputs,{lyrics:true,cover:true,music:false});assert.deepEqual(plan.publishTargets,[]);assert.equal(plan.authorization.publish,false);
 if(!service.list().runs.length){const view=service.preview({id:plan.id});service.run({id:plan.id,expectedRevision:plan.revision,summaryHash:view.summaryHash,requestId:randomUUID(),source:'manual'});}
 assert.equal(service.list().runs.length,1);
 const exported=w.exportPlanDotRequests({repo,root:dataRoot,mode:'production',now:()=>new Date(),planCenterService:()=>service});
 assert.equal(exported.requestCount,1);assert.ok(['projected','unchanged'].includes(exported.bridgeProjection.state),exported.bridgeProjection.reason);
 const projection=JSON.parse(w.read(exported.bridgeProjection.file,8*1024*1024));
 const {contentHash,...body}=projection;assert.equal(w.inboxHash(body),contentHash);assert.equal(projection.requests.length,1);assert.deepEqual(projection.requests[0],exported.requests[0]);assert.equal(projection.requestStates[0].state,'pending');
 const request=exported.requests[0],{requestHash,...requestBody}=request;assert.equal(w.inboxHash(requestBody),requestHash);
 const owner=repo.all('settings').find(row=>row.id.startsWith('plan-dot:bridge-owner:'));assert.equal(owner.ownerId,projection.ownerId);
 const previous=fs.existsSync(record)?JSON.parse(fs.readFileSync(record,'utf8')):null;
 const report={at:new Date().toISOString(),kind:'real-saved-request-not-generated-output',projectRoot,sharedProjectRoot:sharedRoot,existingSharedInputsUntouched:true,isolatedChildAddedUnderSharedRoot:true,dataRoot,database:dbFile,ownerId:projection.ownerId,channel:status.channel,planId:plan.id,runId:request.runId,projection:{...exported.bridgeProjection,sequence:projection.projectionSequence,fileSha256:createHash('sha256').update(fs.readFileSync(exported.bridgeProjection.file)).digest('hex')},request,policy:{planEnabled:false,automaticSchedule:false,autopublish:false,music:false,publishTargets:[],authorization:plan.authorization,modelEvaluationAuthorized:false},counts:{plans:service.list().plans.length,runs:service.list().runs.length,requests:projection.requests.length,works:repo.all('works').length,assets:repo.all('assets').length,operations:repo.all('operations').length,ledger:repo.all('ledger').length},nativeGuiLaunched:false,originalPlansModified:false,cloudSyncReadbackVerified:previous?.cloudSyncReadbackVerified??false,...(previous?.cloud?{cloud:previous.cloud}:{}),receiverStarted:false};
 assert.equal(report.counts.works,0);assert.equal(report.counts.assets,0);assert.equal(report.counts.operations,0);assert.equal(report.counts.ledger,0);
 fs.writeFileSync(record,JSON.stringify(report,null,2)+'\n');fs.writeFileSync(path.join(folder,'real-request.json'),JSON.stringify(request,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
}finally{controller?.stop();repo.close();}
