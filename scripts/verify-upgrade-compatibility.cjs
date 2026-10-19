'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const workspace=path.resolve(__dirname,'..'),output=path.join(workspace,'output');
const readJson=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const writeJson=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2));
const assertIsolated=root=>{
 const resolved=path.resolve(root);
 assert.equal(path.dirname(resolved),output,'ISOLATED_UPGRADE_ROOT_REQUIRED');
 assert.match(path.basename(resolved),/^upgrade-compatibility-[A-Za-z0-9_-]+$/,'ISOLATED_UPGRADE_ROOT_REQUIRED');
 for(let entry=resolved;;entry=path.dirname(entry)){
  if(fs.existsSync(entry))assert.equal(fs.lstatSync(entry).isSymbolicLink(),false,'SYMLINK_UPGRADE_ROOT_REJECTED');
  if(entry===workspace)break;
  assert.notEqual(entry,path.dirname(entry),'UPGRADE_ROOT_ESCAPED_WORKSPACE');
 }
 for(const rel of ['data','data/production','data/production/library.sqlite']){const entry=path.join(resolved,rel);if(fs.existsSync(entry))assert.equal(fs.lstatSync(entry).isSymbolicLink(),false,'SYMLINK_UPGRADE_ROOT_REJECTED');}
};

async function child(stage,coreFile,runRoot,childOptions={}){
 assertIsolated(runRoot);
 // The preloaded repository guard forbids both networking and subprocesses before Core loads.
 assert.equal(process.env.ELECTRON_RUN_AS_NODE,'1');
 const attempts={network:0,subprocess:0};
 const deny=kind=>()=>{attempts[kind]++;throw Error('UPGRADE_OFFLINE_EXTERNAL_OPERATION_FORBIDDEN');};
 globalThis.fetch=deny('network');for(const n of ['node:http','node:https']){const m=require(n);m.request=deny('network');m.get=deny('network');}
 require('node:net').Socket.prototype.connect=deny('network');require('node:dgram').createSocket=deny('network');
 for(const key of ['exec','execSync','execFile','execFileSync','spawn','spawnSync','fork'])require('node:child_process')[key]=deny('subprocess');
 const {Studio}=require(coreFile);assert.equal(typeof Studio,'function');
 const dataRoot=path.join(runRoot,'data');let now='2026-10-19T00:59:00.000Z';
 const studio=new Studio(dataRoot,'production',{now:()=>new Date(now)});
 const tables=['artists','accounts','bindings','works','revisions','assets','series','plans','settings','operations','ledger','units','batches','runs'];
 const rows=()=>Object.fromEntries(tables.map(t=>[t,studio.all(t)]));
 try{
  if(stage==='old-create'){
   const artist=studio.all('artists')[0];
   await studio.call('artist.save',{id:artist.id,expected:artist.revision,name:'Synthetic upgrade artist',defaults:{...artist.defaults,genre:'Pop'}});
   await studio.call('budget.save',{costLimit:4321,candidateLimit:3});
   const account=await studio.call('account.save',{provider:'tme',name:'Synthetic legacy TME account',dailyLimit:7});
   const binding=await studio.call('binding.save',{artistId:artist.id,accountId:account.id,targets:['qqmusic','kugou']});
   const profile=await studio.call('apiProfile.save',{profile:{id:crypto.randomUUID(),kind:'music',providerId:'yourmusic',label:'Synthetic disabled legacy music configuration',modelId:'synthetic-upgrade-model',executionEnabled:false},expectedRevision:null});
   const work=await studio.call('work.save',{title:'Synthetic upgrade work',artistId:artist.id,story:'Isolated upgrade compatibility fixture',lyrics:'Synthetic local lyric line one\nSynthetic local lyric line two',prompt:'Synthetic disabled generation prompt',parameters:{},rights:'Synthetic local author',ai:'none'});
   await studio.call('work.version',{id:work.id});
   const sources=path.join(runRoot,'synthetic-sources');fs.mkdirSync(sources,{recursive:true});
   const cover=path.join(sources,'synthetic-cover.png'),document=path.join(sources,'synthetic-lyrics.txt');
   fs.writeFileSync(cover,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8JkAAAAASUVORK5CYII=','base64'));fs.writeFileSync(document,work.lyrics);
   const coverAsset=await studio.importFile(cover,'cover',work.id),documentAsset=await studio.importFile(document,'lyrics_document');
   const plan=await studio.call('plan.save',{artistId:artist.id,title:'Synthetic enabled old schedule',story:'Must require review after migration',timezone:'Asia/Shanghai',time:'09:00',enabled:true,candidateLimit:2,finishedGoal:1,costLimit:222,overrides:{},checkpoints:{lyrics:'manual',candidate:'manual',cover:'manual',finished:'manual',publish:'manual'}});
   const snapshot=await studio.call('snapshot');assert.equal(snapshot.mode,'production');
   const files=[cover,document,studio.locate(coverAsset.id).file,studio.locate(documentAsset.id).file].map(file=>({relative:path.relative(runRoot,file),sha256:sha(fs.readFileSync(file)),bytes:fs.statSync(file).size}));
   writeJson(path.join(runRoot,'old-created.json'),{source:'offline-synthetic-created-by-old-studio',coreSha256:sha(fs.readFileSync(coreFile)),schemaVersion:studio.db.pragma('user_version',{simple:true}),ids:{artist:artist.id,account:account.id,binding:binding.id,profile:profile.id,work:work.id,plan:plan.id,coverAsset:coverAsset.id,documentAsset:documentAsset.id},rows:rows(),snapshot,files,attempts});
  }else{
   const baseline=readJson(path.join(runRoot,'old-created.json'));
   for(const file of baseline.files){const actual=path.join(runRoot,file.relative);assert.equal(sha(fs.readFileSync(actual)),file.sha256,'ORIGINAL_MEDIA_SHA_CHANGED');assert.equal(fs.statSync(actual).size,file.bytes);}
   assert.equal(studio.db.pragma('integrity_check',{simple:true}),'ok');assert.equal(studio.db.pragma('user_version',{simple:true}),baseline.schemaVersion,'SCHEMA_VERSION_INCOMPATIBLE');
   if(stage==='new-upgrade'){
    for(const [table,records] of Object.entries(baseline.rows))for(const record of records)assert.deepEqual(studio.get(table,record.id),record,'LEGACY_ROW_CHANGED:'+table+':'+record.id);
    const migrated=await studio.call('planCenter.list');assert.equal(migrated.migration.state,'applied');assert.equal(migrated.migration.entries.length,1);
    const old=studio.get('plans',baseline.ids.plan),entry=migrated.migration.entries[0],plan=migrated.plans.find(p=>p.id===entry.planId);
    assert.equal(old.id,baseline.ids.plan);assert.equal(old.enabled,false);assert.equal(old.scheduleOwner,'plan-center');assert.deepEqual(entry.original,baseline.rows.plans[0]);
    assert.ok(plan.needsConfiguration.includes('LEGACY_CONFIGURATION_REVIEW_REQUIRED'));assert.deepEqual(plan.publishTargets,[]);assert.equal(plan.music.route,'manual');assert.equal(migrated.runs.length,0);
    now='2026-10-19T01:01:00.000Z';await studio.tick();
    assert.equal(studio.all('ledger').length,baseline.rows.ledger.length,'AUTOMATIC_SPENDING_AFTER_UPGRADE');assert.equal(studio.all('operations').length,baseline.rows.operations.length,'AUTOMATIC_GENERATION_AFTER_UPGRADE');assert.equal(studio.all('units').length,0,'AUTOMATIC_SUBMISSION_AFTER_UPGRADE');
    const saved=await studio.call('planCenter.save',{expectedRevision:null,plan:{id:crypto.randomUUID(),title:'Synthetic new manual plan after upgrade',artistId:baseline.ids.artist,enabled:false,schedule:{kind:'daily',localTime:'10:00'},count:1,material:{source:'manual'},text:{},music:{route:'manual'},authorization:{publish:false},publishTargets:[]}});
    writeJson(path.join(runRoot,'new-upgraded.json'),{source:'offline-synthetic-upgrade',coreSha256:sha(fs.readFileSync(coreFile)),schemaVersion:studio.db.pragma('user_version',{simple:true}),newPlanId:saved.id,migratedPlanId:plan.id,rows:rows(),planCenter:await studio.call('planCenter.list'),attempts});
   }else if(stage==='new-reopen'){
    const upgraded=readJson(path.join(runRoot,'new-upgraded.json'));
    for(const [table,records] of Object.entries(upgraded.rows))assert.deepEqual(studio.all(table).sort((a,b)=>a.id.localeCompare(b.id)),[...records].sort((a,b)=>a.id.localeCompare(b.id)),'REOPEN_ADDED_OR_CHANGED_ROWS:'+table);
    for(const [table,records] of Object.entries(upgraded.rows))for(const record of records)assert.deepEqual(studio.get(table,record.id),record,'REOPEN_ROW_CHANGED:'+table+':'+record.id);
    const current=await studio.call('planCenter.list');assert.deepEqual(current,upgraded.planCenter,'MIGRATION_NOT_IDEMPOTENT');assert.ok(current.plans.some(p=>p.id===upgraded.newPlanId&&p.enabled===false));
    if(childOptions.writeReport!==false)writeJson(path.join(runRoot,'new-reopened.json'),{source:'offline-synthetic-upgrade',reopenPreserved:true,migrationIdempotent:true,mediaShaPreserved:true,oldIdsPreserved:true,oldConfigurationPreserved:true,attempts});
   }else throw Error('UNKNOWN_UPGRADE_STAGE');
  }
  assert.deepEqual(attempts,{network:0,subprocess:0});
 }finally{studio.close();}
 assert.deepEqual(attempts,{network:0,subprocess:0});
 if(stage==='old-create')fs.copyFileSync(path.join(dataRoot,'production','library.sqlite'),path.join(runRoot,'old-library-before-upgrade.sqlite'));
 if(!childOptions.quiet)console.log(JSON.stringify({stage,passed:true,attempts}));
 return{stage,passed:true,attempts};
}

async function reopenOnly(){
 assert.equal(process.env.ELECTRON_RUN_AS_NODE,'1','ELECTRON_NODE_MODE_REQUIRED');
 const args=process.argv.slice(2);assert.equal(args[0],'--reopen-only');assert.ok(args[1]);
 assert.ok(args.length===2||args.length===4&&args[2]==='--new-core','UPGRADE_ARGUMENT_INVALID');
 const dataRoot=path.resolve(args[1]),runRoot=path.dirname(dataRoot);assertIsolated(runRoot);
 assert.equal(path.dirname(runRoot),output);assert.match(path.basename(runRoot),/^upgrade-compatibility-[A-Za-z0-9_-]+$/);assert.equal(path.basename(dataRoot),'data');
 for(let entry=dataRoot;;entry=path.dirname(entry)){assert.ok(!fs.lstatSync(entry).isSymbolicLink(),'SYMLINK_UPGRADE_ROOT_REJECTED');if(entry===workspace)break;assert.notEqual(entry,path.dirname(entry),'UPGRADE_ROOT_ESCAPED_WORKSPACE');}
 const markerPath=path.join(runRoot,'upgrade-fixture-marker.json');assert.ok(!fs.lstatSync(markerPath).isSymbolicLink());const marker=readJson(markerPath);
 assert.equal(marker.marker,'rainfall-upgrade-compatibility-v1');assert.equal(marker.runRoot,runRoot);assert.equal(marker.dataRoot,dataRoot);assert.equal(marker.source,'offline-synthetic-upgrade');
 const manifestNames=['old-created.json','new-upgraded.json','new-reopened.json','result.json'];assert.deepEqual(Object.keys(marker.expected).sort(),manifestNames.sort());
 for(const name of manifestNames){const file=path.join(runRoot,name);assert.ok(!fs.lstatSync(file).isSymbolicLink());assert.equal(sha(fs.readFileSync(file)),marker.expected[name],'UPGRADE_EXPECTED_MANIFEST_CHANGED:'+name);}
 const original=readJson(path.join(runRoot,'result.json'));assert.equal(original.passed,true);const newCore=path.resolve(args[3]??original.newCore);assert.equal(path.basename(newCore),'core.cjs');assert.equal(sha(fs.readFileSync(newCore)),original.newCoreSha256,'REOPEN_CORE_MISMATCH');
 const database=path.join(dataRoot,'production','library.sqlite');for(const file of [path.dirname(database),database])assert.ok(!fs.lstatSync(file).isSymbolicLink(),'UPGRADE_DATABASE_SYMLINK_REJECTED');
 const before={databaseSha256:sha(fs.readFileSync(database)),expectedManifest:marker.expected['new-upgraded.json']};
 const report={at:new Date().toISOString(),source:'offline-synthetic-upgrade',operation:'reopen-only',runRoot,dataRoot,newCore,processId:process.pid,executable:process.execPath,semanticReadOnly:true,isolatedRootMayBeInitialized:true,newFixtureCreated:false,guiStarted:false,realDataRead:false,before,passed:false};
 try{const checked=await child('new-reopen',newCore,runRoot,{quiet:true,writeReport:false});report.passed=true;report.attempts=checked.attempts;report.after={databaseSha256:sha(fs.readFileSync(database)),expectedManifest:sha(fs.readFileSync(path.join(runRoot,'new-upgraded.json')))};assert.equal(report.after.expectedManifest,before.expectedManifest);report.originalRowsIdsConfigurationAndMediaPreserved=true;report.noNewOperationsLedgerOrRuns=true;}
 catch(error){report.error=error.message;process.exitCode=1;}
 finally{report.completedAt=new Date().toISOString();writeJson(path.join(runRoot,'reopen-only-result.json'),report);writeJson(path.join(output,'upgrade-compatibility-reopen-latest.json'),report);console.log(JSON.stringify(report,null,2));}
}

if(process.argv[2]==='--reopen-only')reopenOnly().catch(error=>{console.error(error.stack);process.exitCode=1;});
else if(process.argv[2]==='--child')child(process.argv[3],process.argv[4],process.argv[5]).catch(error=>{console.error(error.stack);process.exitCode=1;});
else{
 const args=process.argv.slice(2),options={};for(let i=0;i<args.length;i+=2){assert.ok(['--old-core','--new-core','--electron'].includes(args[i])&&args[i+1],'UPGRADE_ARGUMENT_INVALID');options[args[i]]=args[i+1];}
 const oldCore=path.resolve(options['--old-core']??path.join(workspace,'out/dot-delivery-bridge-227738d09f8c-1792350328559/resources/app/build/core.cjs')),newCore=path.resolve(options['--new-core']??path.join(workspace,'build/core.cjs')),electron=path.resolve(options['--electron']??path.join(workspace,'node_modules/electron/dist/electron.exe'));
 for(const file of [oldCore,newCore,electron])assert.ok(fs.statSync(file).isFile());assert.equal(path.basename(oldCore),'core.cjs');assert.equal(path.basename(newCore),'core.cjs');assert.notEqual(oldCore,newCore);
 fs.mkdirSync(output,{recursive:true});const runRoot=fs.mkdtempSync(path.join(output,'upgrade-compatibility-'));assertIsolated(runRoot);
 const versionFor=core=>{const file=path.resolve(path.dirname(core),'..','package.json');return fs.existsSync(file)?readJson(file).version:null;};
 const report={at:new Date().toISOString(),source:'offline-synthetic-upgrade',runRoot,oldCore,newCore,oldVersion:versionFor(oldCore),newVersion:versionFor(newCore),oldCoreSha256:sha(fs.readFileSync(oldCore)),newCoreSha256:sha(fs.readFileSync(newCore)),networkAllowed:false,guiStarted:false,realDataRead:false,stages:[],passed:false};
 const {spawnSync}=require('node:child_process');
 try{
  for(const stage of ['old-create','new-upgrade','new-reopen']){
   const result=spawnSync(electron,['--require',path.join(workspace,'tests/fixtures/offline-only.cjs'),__filename,'--child',stage,stage==='old-create'?oldCore:newCore,runRoot],{cwd:workspace,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,encoding:'utf8',timeout:120000,maxBuffer:2*1024*1024});
   fs.writeFileSync(path.join(runRoot,stage+'.log'),(result.stdout??'')+(result.stderr??''));report.stages.push({stage,processId:result.pid,executable:electron,passed:result.status===0,status:result.status,error:result.error?.message});if(result.status!==0)throw Error('UPGRADE_STAGE_FAILED:'+stage+':'+(result.stderr??result.error?.message??''));
  }
  report.passed=true;report.assertions=readJson(path.join(runRoot,'new-reopened.json'));const baseline=readJson(path.join(runRoot,'old-created.json'));report.oldSchemaVersion=baseline.schemaVersion;report.newSchemaVersion=readJson(path.join(runRoot,'new-upgraded.json')).schemaVersion;report.sampleCounts=Object.fromEntries(Object.entries(baseline.rows).map(([k,v])=>[k,v.length]));report.mediaFilesVerified=baseline.files.length;
 }catch(error){report.error=error.message;process.exitCode=1;}
 finally{
  report.completedAt=new Date().toISOString();writeJson(path.join(runRoot,'result.json'),report);writeJson(path.join(output,'upgrade-compatibility-latest.json'),report);
  if(report.passed){const names=['old-created.json','new-upgraded.json','new-reopened.json','result.json'];writeJson(path.join(runRoot,'upgrade-fixture-marker.json'),{marker:'rainfall-upgrade-compatibility-v1',source:'offline-synthetic-upgrade',runRoot,dataRoot:path.join(runRoot,'data'),expected:Object.fromEntries(names.map(name=>[name,sha(fs.readFileSync(path.join(runRoot,name)))]))});}
  console.log(JSON.stringify(report,null,2));
 }
}
