// One bounded scan of the explicitly prepared isolated workspace. No business tick.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const blockNetwork=()=>{throw Error('ACCEPTANCE_NETWORK_FORBIDDEN');};
globalThis.fetch=blockNetwork;for(const name of ['node:http','node:https']){const module=require(name);module.request=blockNetwork;module.get=blockNetwork;}require('node:net').connect=blockNetwork;require('node:net').createConnection=blockNetwork;
const w=require(process.env.RAINFALL_DOT_ACCEPTANCE_BUNDLE);
async function main(){
 const folder=path.resolve('output/drive-v2-acceptance-20261019'),record=JSON.parse(fs.readFileSync(path.join(folder,'request-handoff.json'),'utf8'));
 const dataRoot=path.join(folder,'isolated-data'),inboxRoot=path.join(dataRoot,'production','inbox-v1');
 const connection=JSON.parse(fs.readFileSync(path.resolve('output/dot-drive-connected-20261018/connection-evidence.json'),'utf8'));
 assert.equal(record.projectRoot,path.join(path.resolve(connection.projectRoot),'acceptance-v2-20261019'));assert.equal(record.dataRoot,dataRoot);
 w.assertInboxPath(dataRoot);w.assertInboxPath(record.projectRoot);
 const dbFile=path.join(dataRoot,'production','library.sqlite');if(!fs.existsSync(dbFile))throw Error('PREPARED_ACCEPTANCE_WORKSPACE_REQUIRED');
 const repo=new w.Repository(dbFile),service=new w.PlanCenterService(repo,{recoverDispatching:false}),controller=new w.InboxController(repo,inboxRoot);
 try{
  const status=controller.status();assert.deepEqual(status.channel,record.channel);assert.equal(status.bridge.projectRoot,record.projectRoot);assert.equal(status.bridge.enabled,true);
  const plans=service.list().plans;assert.equal(plans.length,1);assert.equal(plans[0].enabled,false);assert.equal(plans[0].outputs.music,false);assert.equal(plans[0].authorization.publish,false);assert.deepEqual(plans[0].publishTargets,[]);
  const saved=w.planDotStatus({repo,root:dataRoot,mode:'production',now:()=>new Date(),planCenterService:()=>service});assert.deepEqual(saved.requests,[record.request]);
  for(let n=0;n<2;n++)await controller.scanOnce();
  const dot=w.syncPlanDot({repo,root:dataRoot,mode:'production',now:()=>new Date(),planCenterService:()=>service});
  const projection=w.exportPlanDotRequests({repo,root:dataRoot,mode:'production',now:()=>new Date(),planCenterService:()=>service});
  await controller.scanOnce();
  assert.equal(repo.all('operations').length,0);assert.equal(repo.all('ledger').length,0);assert.equal(repo.all('works').length,0);
  const current=controller.status(),states=[...(current.bridge.states??[]),...(current.packageDelivery.states??[])];
  const failed=!!current.lastError||!!current.bridge.lastError||!!current.packageDelivery.lastError||states.some(s=>s.state==='rejected');
  const deliveryReceived=dot.associations.length===1;
  const report={at:new Date().toISOString(),passed:!failed,outcome:failed?'blocked':deliveryReceived?'received':'no-delivery-yet',deliveryReceived,scope:'bounded isolated receiver + syncPlanDot; no scoring or business tick',projectRoot:record.projectRoot,dataRoot,requestId:record.request.requestId,requestHash:record.request.requestHash,channelId:record.channel.id,workspaceId:record.channel.workspaceId,associations:dot.associations,blockers:dot.blockers,projection:projection.bridgeProjection,counts:{candidates:repo.all('textCandidates').length,drafts:repo.all('drafts').length,assets:repo.all('assets').length,operations:0,ledger:0,works:0},status:current,nativeGuiLaunched:false,formalPlansModified:false,modelCalls:0,musicCalls:0,publishingCalls:0,cloudReceiptReadbackVerified:false};
  fs.writeFileSync(path.join(folder,'receive-once-latest.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
 }finally{controller.stop();repo.close();}
}
main().catch(error=>{console.error(/^[A-Z0-9_]+$/.test(error?.message??'')?error.message:'ISOLATED_RECEIVE_FAILED');process.exitCode=1;});
