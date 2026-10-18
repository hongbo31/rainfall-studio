const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), { randomUUID } = require('node:crypto');
const w = require(process.env.RAINFALL_INBOX_BUNDLE);
function studio(t) {
 const root = path.resolve('output/test-runs', 'inbox-state-' + randomUUID());
 const s = new w.Studio(root, 'production'); t.after(() => s.close()); return s;
}
// Break: provider catalog doesn't permit a DeepSeek Key, or grants CLI a credential channel.
test('DeepSeek profile permits user key storage without changing another provider identity', async t => {
 const s = studio(t), id = randomUUID();
 const p = await s.call('apiProfile.save', {profile:{id,kind:'text',providerId:'deepseek',label:'测试配置',modelId:null,executionEnabled:false},expectedRevision:null});
 assert.equal(w.canStoreApiCredential(p),true);
 assert.equal(w.canStoreApiCredential({...p,providerId:'codex_cli'}),false);
 assert.equal(w.canStoreApiCredential({...p,providerId:'claude_code'}),false);
 await assert.rejects(s.call('apiProfile.save',{profile:{...p,providerId:'claude_code'},expectedRevision:1}));
 const root=path.join(s.root,'fake-vault');
 const vault=new w.CredentialVault(root,{isEncryptionAvailable:()=>true,
  encryptString:v=>Buffer.from(v).map(b=>b^90),decryptString:v=>Buffer.from(v).map(b=>b^90).toString()});
 const service=new w.ApiCredentials({vault,getProfile:async()=>p,context:()=>({mode:'production',generation:1})});
 const result=await service.writeApiCredential({profileId:id,expectedRevision:1,secret:'FAKE_UNIT_SECRET_ONLY'});
 assert.deepEqual(result,{profileId:id,state:'stored_unverified',configured:true});
 assert(!JSON.stringify(s.all('settings')).includes('FAKE_UNIT_SECRET_ONLY'));
 assert.equal(s.externalRequests,0);
});
// Break: DeepSeek config saves arbitrary destination despite the official endpoint contract.
test('DeepSeek saved text metadata validates its provider and never grants execution', async t=>{
 const s=studio(t), profileId=randomUUID();
 await s.call('apiProfile.save',{profile:{id:profileId,kind:'text',providerId:'deepseek',label:'文本',modelId:null,executionEnabled:false},expectedRevision:null});
 const c={...require('../../fixtures/workflow.cjs').config(),profileId,adapterId:'deepseek',endpoint:'https://api.deepseek.com',modelId:'user-selected-model'};
 await assert.rejects(s.call('textConfig.save',{config:{...c,endpoint:'https://not-the-official-host.invalid'},expectedRevision:0}));
 const saved=await s.call('textConfig.save',{config:c,expectedRevision:0});
 assert.equal(saved.executionEnabled,false); assert.equal(s.externalRequests,0);
});
// Break: startup silently creates a real receiver / enables schedules without local setup.
test('inbox remains unconfigured without side effects until explicit local setup', async t=>{
 const s=studio(t); const status=await s.call('inbox.status');
 assert.equal(status.configured,false);
 assert(!fs.existsSync(path.join(s.root,'production','inbox-v1')));
 assert.equal(s.all('dailyPlans').length,0);
});
// Break: renderer chooses a path or changes trust identity on an established channel.
test('local inbox setup supplies a fixed path and refuses arbitrary paths or identity remap', async t=>{
 const s=studio(t), artistId=s.all('artists')[0].id;
 const config={workspaceRef:'unit-workspace',artistId,artistRef:'creator',seriesId:null,seriesRef:null,expectedRevision:0};
 await assert.rejects(s.call('inbox.configure',{...config,root:'C:/unapproved-location'}));
 const result=await s.call('inbox.configure',config);
 assert.equal(result.configured,true); assert.equal(result.channel.workspaceRef,'unit-workspace');
 assert.equal(result.root,path.join(s.root,'production','inbox-v1'));
 assert(!fs.existsSync(result.root),'configuration must not deliver or start a scan');
 await assert.rejects(s.call('inbox.configure',{...config,artistRef:'someone-else',expectedRevision:1}),/INBOX_CHANNEL_IMMUTABLE/);
 assert.equal(s.all('textCandidates').length,0);
});

test('a pre-import backup cannot erase a committed inbox identity or its receipt', async t=>{
 const s=studio(t), file=path.join(s.root,'before.zip'); await s.backup(file);
 const artistId=s.all('artists')[0].id, channel={id:'backup-channel',workspaceId:'backup-workspace',workspaceRef:'backup',artistRefs:{creator:artistId},seriesRefs:{}};
 new w.InboxService(s.repo,channel).importPackage({schemaVersion:1,batchId:'new-import',createdAt:'2026-10-15T00:00:00Z',targetWorkspaceRef:'backup',items:[{
  externalItemId:'one',revision:1,parentRevision:null,artistRef:'creator',seriesRef:null,draft:require('../../fixtures/workflow.cjs').draft(),
  provenance:{producer:'fixture',model:null,promptVersion:null,generatedAt:'2026-10-15T00:00:00Z'}}]});
 await assert.rejects(s.restore(file),/RESTORE_POST_SNAPSHOT_INBOX/);
 assert.equal(s.all('textCandidates').length,1);assert.equal(s.all('inboxReceipts').length,1);
});

test('a full backup restore preserves candidates but disables automatic receiving', async t=>{
 const s=studio(t),artistId=s.all('artists')[0].id;
 await s.call('inbox.configure',{workspaceRef:'backup',artistId,artistRef:'creator',seriesId:null,seriesRef:null,expectedRevision:0});
 const file=path.join(s.root,'same.zip');await s.backup(file);await s.restore(file);
 const status=await s.call('inbox.status');assert.equal(status.configured,true);assert.equal(status.active,false);
});
