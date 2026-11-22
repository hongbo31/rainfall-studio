const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {offlineAcceptanceEnabled,nodeHttpsTransport}=require('../build/offline-acceptance.cjs');
test('offline IPC allowlist excludes native, cloud, credentials, terms, generation and unknown actions',()=>{
 const {offlineAcceptanceInvocationAllowed:allowed}=require('../build/offline-acceptance.cjs');
 for(const channel of ['rainfall:tme-ai-submission','rainfall:tme-ai-prepare','rainfall:tme:live','rainfall:tme:run','rainfall:api-credential:write','rainfall:live-music','rainfall:mode','rainfall:official'])assert.equal(allowed(channel,['submit',{}]),false,channel);
 for(const method of ['publish.reconcile','publish.qishui.fill','unifiedPublish.submit','planAlbum.create','accountIdentity.connect','materials.enqueue','liveMusic.submit','publish.acceptTerms','unknown.method'])assert.equal(allowed('rainfall:call',[method,{}]),false,method);
 for(const method of ['snapshot','runtime','materials.scan','work.selectAudioVersion','publish.preview','publish.simple','publish.selection.save','platformConfig.setAccount'])assert.equal(allowed('rainfall:call',[method,{}]),true,method);
 assert.equal(allowed('rainfall:call',['planCenter.fanqieStatus',{}]),true);
 assert.equal(allowed('rainfall:fanqie-upload',['status',{}]),true);
 for(const action of ['upload','publishBatch','publishConfigured','reconcile'])assert.equal(allowed('rainfall:fanqie-upload',[action,{}]),false);
});
test('offline acceptance refuses non-temporary roots and requires an explicit marker',()=>{
 const prior={flag:process.env.RAINFALL_OFFLINE_ACCEPTANCE,root:process.env.RAINFALL_DATA_ROOT},root=fs.mkdtempSync(path.join(os.tmpdir(),'rainfall-offline-acceptance-'));
 try{process.env.RAINFALL_OFFLINE_ACCEPTANCE='1';delete process.env.RAINFALL_DATA_ROOT;assert.throws(offlineAcceptanceEnabled,/ROOT_REQUIRED/);process.env.RAINFALL_DATA_ROOT=process.cwd();assert.throws(offlineAcceptanceEnabled,/TEMP_ROOT_REQUIRED/);process.env.RAINFALL_DATA_ROOT=root;assert.throws(offlineAcceptanceEnabled,/TEMP_ROOT_REQUIRED/);fs.writeFileSync(path.join(root,'offline-acceptance.marker'),'fixture');assert.equal(offlineAcceptanceEnabled(),true);}finally{for(const[k,v]of Object.entries({RAINFALL_OFFLINE_ACCEPTANCE:prior.flag,RAINFALL_DATA_ROOT:prior.root})){if(v===undefined)delete process.env[k];else process.env[k]=v;}fs.rmSync(root,{recursive:true});}
});
test('offline provider transport stops before DNS or HTTPS even with explicit request input',async()=>{
 const dns=require('node:dns'),https=require('node:https'),lookup=dns.lookup,request=https.request,prior=process.env.RAINFALL_OFFLINE_ACCEPTANCE;let attempts=0;dns.lookup=()=>{attempts++;throw Error('unexpected DNS');};https.request=()=>{attempts++;throw Error('unexpected HTTPS');};process.env.RAINFALL_OFFLINE_ACCEPTANCE='1';
 try{await assert.rejects(nodeHttpsTransport({method:'GET',url:'https://api.yourmusic.fun/v1/music/generations/history',headers:{}}),/OFFLINE_ACCEPTANCE_NETWORK_DISABLED/);assert.equal(attempts,0);}finally{dns.lookup=lookup;https.request=request;if(prior===undefined)delete process.env.RAINFALL_OFFLINE_ACCEPTANCE;else process.env.RAINFALL_OFFLINE_ACCEPTANCE=prior;}
});
