// Run with the candidate executable in ELECTRON_RUN_AS_NODE=1 mode; never loads Main.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(process.argv[2]),app=path.join(root,'resources','app'),manifest=JSON.parse(fs.readFileSync(path.join(root,'candidate-manifest.json'),'utf8'));
assert.equal(process.versions.electron,'44.7.2');assert.equal(manifest.unifiedPlanCenter,true);assert.equal(manifest.dataRootPolicy,'portable-relative-candidate-data');assert.equal(manifest.accepted,false);assert.equal(manifest.installedOrDesktopReplaced,false);
assert.equal(JSON.parse(fs.readFileSync(path.join(app,'package.json'),'utf8')).version,manifest.version);
if(manifest.albumServiceImplemented){assert(manifest.integrity?.length>=14);for(const record of manifest.integrity){const file=path.resolve(root,record.path);assert(file.startsWith(root+path.sep));assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),record.sha256,'PACKAGED_PROGRAM_HASH_MISMATCH');}}
const isolated=path.resolve('output','portable-package-core-'+Date.now()),relocated=path.join(isolated,'relocated-package'),fakeProcess={env:{},resourcesPath:path.join(relocated,'resources')};
const banner=fs.readFileSync(path.join(app,'build','main.cjs'),'utf8').split('\n')[0];
assert.match(banner,/^process\.env\.RAINFALL_PREVIEW_DATA_ROOT=/);vm.runInNewContext(banner,{process:fakeProcess,require:name=>{assert.equal(name,'node:path');return path}});assert.equal(fakeProcess.env.RAINFALL_PREVIEW_DATA_ROOT,path.join(relocated,'candidate-data'));
const {Studio}=require(path.join(app,'build','core.cjs'));let s=new Studio(path.join(isolated,'data'),'production');
const albumChecks=[];
try{
 const center=s.planCenterService(),p=center.save({plan:{id:crypto.randomUUID(),title:'Offline packaged Core check',artistId:s.all('artists')[0].id,enabled:true,count:2,schedule:{kind:'daily',localTime:'09:00'},material:{source:'dot',channel:'isolated',identity:'author'},text:{},music:{route:'manual'}},expectedRevision:null}),preview=center.preview({id:p.id}),run=center.run({id:p.id,expectedRevision:p.revision,summaryHash:preview.summaryHash,requestId:crypto.randomUUID(),source:'manual'});
 assert.equal(center.list().items.length,2);assert.equal(center.list().occurrences.length,0);center.stop({runId:run.id});assert.equal(center.list().plans[0].enabled,true);assert.equal(s.all('operations').length,0);s.close();s=new Studio(path.join(isolated,'data'),'production');assert.equal(s.planCenterService().list().runs.length,1);assert.equal(s.all('operations').length,0);
 if(manifest.albumServiceImplemented){
  assert.equal(s.planAlbumService().allowsFixture,false);
  const account=s.save('accounts',{id:crypto.randomUUID(),provider:'tme',remoteSubject:'f'.repeat(64),identitySource:'isolated-package-validation'}),albums=s.planAlbumService(),pc=s.planCenterService();
  const plan=pc.save({plan:{id:crypto.randomUUID(),title:'Packaged album operation',artistId:s.all('artists')[0].id,count:1,schedule:{kind:'daily',localTime:'10:00'},material:{source:'manual'},text:{},music:{route:'manual'},authorization:{publish:true},publishTargets:[{platform:'qqmusic',accountId:account.id,enabled:true,album:{mode:'new',title:'Isolated package album'}}]},expectedRevision:null}),pv=pc.preview({id:plan.id}),r=pc.run({id:plan.id,expectedRevision:plan.revision,summaryHash:pv.summaryHash,requestId:crypto.randomUUID(),source:'debug'}),op=albums.prepareCreate({runId:r.id,platform:'qqmusic',accountId:account.id});
  assert.equal(op.state,'prepared');assert.equal(op.onlineVerified,false);assert.equal(albums.bindingForRun({runId:r.id,platform:'qqmusic',accountId:account.id}),null);
  s.close();s=new Studio(path.join(isolated,'data'),'production');assert.equal(s.planAlbumService().status().operations.find(row=>row.id===op.id).state,'prepared');assert.equal(s.all('operations').length,0);
  for(const name of ['album-service-design.md','album-service-status.md','dot-drive-protocol.md','album-service-release.md','end-to-end-checklist.md','login-session-reuse.md','cover-recovery-design.md',...(manifest.lyricsOnlyDirectoryDeliverySupported?['production-album-mapping.md','native-minimum-operations.md','dot-lyrics-only-protocol.md','drive-v2-real-request-handoff.md','drive-v2-release.md']:[])])assert.equal(fs.existsSync(path.join(root,'docs',name)),true);
  albumChecks.push('Packaged album service retains production fixture guard','Unsent account-scoped album operation persists without creating a remote binding or external operation','Album design, precise capability status and dot protocol ship in portable package');
 }
}finally{s.close()}
let uiRestartProof;
if(manifest.albumServiceImplemented){
 const latest=JSON.parse(fs.readFileSync('output/plan-center-headless-latest.json','utf8'));
 assert.equal(latest.passed,true);
 const fixtureRoot=path.resolve(latest.out,'data'),outputRoot=path.resolve('output');
 assert(fixtureRoot.startsWith(outputRoot+path.sep+'plan-center-headless-'));
 assert.equal(fs.lstatSync(fixtureRoot).isSymbolicLink(),false);
 assert.equal(fs.realpathSync(fixtureRoot).toLowerCase(),fixtureRoot.toLowerCase());
 for(const relative of ['production','production/library.sqlite']){const file=path.join(fixtureRoot,relative);assert.equal(fs.lstatSync(file).isSymbolicLink(),false);assert.equal(fs.realpathSync(file).toLowerCase(),file.toLowerCase());}
 const prior=new Studio(fixtureRoot,'production');
 try{
  const state=prior.planCenterService().list(),item=state.items.find(row=>row.selectedVersion==='B'&&row.materials?.audioAssetId);
  assert(item,'HEADLESS_UI_SELECTED_B_REQUIRED');
  const work=prior.get('works',item.workId);
  assert.equal(item.materials.audioAssetId,work.assets.audio_B);
  assert.equal(state.runs.find(row=>row.id===item.runId).state,'completed');
  const media=[];
  for(const id of [item.materials.audioAssetId,item.materials.coverAssetId]){
   const asset=prior.get('assets',id),location=prior.locate(id);
   assert(fs.realpathSync(location.file).toLowerCase().startsWith(fixtureRoot.toLowerCase()+path.sep));
   assert.equal(crypto.createHash('sha256').update(fs.readFileSync(location.file)).digest('hex'),asset.sha256);
   media.push({kind:asset.kind,sha256:asset.sha256});
  }
  assert.equal(prior.all('operations').length,0);
  uiRestartProof={passed:true,scope:'packaged Core in a separate process reopens prior headless UI synthetic data; file integrity, not native media protocol playback',dataRoot:fixtureRoot,runId:item.runId,itemId:item.id,workId:item.workId,selectedVersion:item.selectedVersion,media,externalOperations:0};
  albumChecks.push('Packaged Core in a separate process restores prior actual React A/B selection, completed material run and original audio/cover hashes');
 }finally{prior.close()}
}
assert.equal(fs.existsSync(manifest.defaultDataRoot),false);
const required=['RainfallStudioCandidate.exe','resources/app/build/main.cjs','resources/app/build/core.cjs','resources/app/build/preload.cjs','resources/app/build/ui/index.html','resources/app/node_modules/better-sqlite3/prebuilds/win32-x64.node'];
const files=required.map(name=>{const file=path.join(root,name);assert.equal(fs.existsSync(file),true,name);return{name,bytes:fs.statSync(file).size,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}});
const dependencyPaths=Object.keys(require.cache).filter(file=>file.includes(path.sep+'node_modules'+path.sep));assert(dependencyPaths.length>0);assert(dependencyPaths.every(file=>file.startsWith(app+path.sep)),'DEPENDENCY_ESCAPES_PORTABLE_PACKAGE');
const report={dependencyModules:dependencyPaths.length,nativeModulePaths:dependencyPaths.filter(file=>file.endsWith('.node')),passed:true,sourceCommit:manifest.sourceCommit,version:manifest.version,packageRoot:root,checks:['Relocation resolves data root beside executable','Packaged SQLite native ABI loads','Packaged Core persists two independent manual items across reopen','Stop keeps future plan enabled','No scheduled occurrence or external operation created','Default preview data root remains unused',...albumChecks],files,uiRestartProof,electron:process.versions.electron,node:process.versions.node,nativeGuiLaunched:false,formalDataTouched:false,mainLoaded:false};
const reportIndex=process.argv.indexOf('--report'),reportPath=path.resolve(reportIndex<0?(manifest.albumServiceImplemented?'output/album-package-validation.json':'output/unified-plan-package-validation.json'):process.argv[reportIndex+1]??'');
assert(reportPath.startsWith(path.resolve('output')+path.sep),'ISOLATED_REPORT_PATH_REQUIRED');fs.mkdirSync(path.dirname(reportPath),{recursive:true});fs.writeFileSync(reportPath,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
