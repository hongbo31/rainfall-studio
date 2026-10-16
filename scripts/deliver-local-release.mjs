import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {execFileSync} from 'node:child_process';import {randomUUID} from 'node:crypto';
import {approveRelease,catalogRelease,verifyRelease,deliver,applyPending,rollback,atomicJSON,readJSON,digest,withManagerLock,assertPlainPath} from '../src/updater/local-release.mjs';
import {backupProduction,migrateBackup,assertSourceUnchanged,inspectDatabase} from '../src/updater/production-data.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),args=process.argv.slice(2);
const get=(key,fallback)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1];};
const manager=path.resolve(get('--manager',path.join(process.env.LOCALAPPDATA,'RainfallStudioLauncher'))),ps=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
const stamp=()=>new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8);
const psRun=(script,args=[])=>execFileSync(ps,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,...args],{encoding:'utf8',windowsHide:true,timeout:15000});
function isRunning(){return execFileSync(ps,['-NoProfile','-NonInteractive','-Command',"if (@(Get-Process -Name RainfallStudio -ErrorAction SilentlyContinue).Count -gt 0) { 'running' } else { 'idle' }"],{encoding:'utf8',windowsHide:true,timeout:10000}).trim()==='running';}
function contained(base,target){const r=path.relative(path.resolve(base),path.resolve(target));return r!==''&&!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r);}
async function initialize(){
 if(fs.existsSync(path.join(manager,'delivery-config.json')))throw Error('ALREADY_INITIALIZED');
 const legacyPackage=path.resolve(get('--legacy-package',path.join(root,'out/RainfallStudio-win32-x64'))),legacyData=path.resolve(get('--legacy-data',path.join(process.env.APPDATA,'RainfallStudio')));
 if(inspectDatabase(path.join(legacyData,'production/library.sqlite')).schema!==1)throw Error('LEGACY_SCHEMA');
 const legacy=catalogRelease(legacyPackage,{id:'legacy-0.2.0',version:'0.2.0-original',sourceCommit:'0'.repeat(40),schemas:[1]});verifyRelease(legacy);
 await withManagerLock(manager,async()=>{
  for(const file of ['scripts/deliver-local-release.mjs','src/updater/local-release.mjs','src/updater/production-data.mjs','launcher/migrate.cjs','launcher/Install-Shortcut.ps1']){const target=path.join(manager,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,file),target);}
  for(const [source,target] of [['launcher/Launch.ps1','Launch.ps1'],['launcher/Install-Shortcut.ps1','launcher/Install-Shortcut.ps1']])fs.writeFileSync(path.join(manager,target),'\uFEFF'+fs.readFileSync(path.join(root,source),'utf8').replace(/^\uFEFF/,''));
  const catalogFile=path.join(manager,'catalogs/legacy-0.2.0.json');atomicJSON(catalogFile,legacy);
  atomicJSON(path.join(manager,'current.json'),{format:1,current:{releaseId:legacy.id,catalogFile,catalogHash:digest(catalogFile),dataRoot:legacyData,schema:1,activatedAt:new Date().toISOString()},previous:null});
  atomicJSON(path.join(manager,'delivery-config.json'),{format:1,nodeExecutable:process.execPath,nodeHash:digest(process.execPath),legacyData,dataBase:path.resolve(get('--data-base',path.join(process.env.APPDATA,'RainfallStudioManaged/data'))),desktopLink:path.resolve(get('--desktop-link',path.join(process.env.USERPROFILE,'Desktop/Rainfall Studio 音乐客户端.lnk'))),remoteUpdateSource:null});
 });
}
async function prepare(previous,c){
 if(!previous)throw Error('EXISTING_DATA_REQUIRED');const config=readJSON(path.join(manager,'delivery-config.json')),source=previous.dataRoot;assertPlainPath(source);assertPlainPath(config.dataBase);assertPlainPath(manager);
 if(path.resolve(source)!==config.legacyData&&!contained(config.dataBase,source))throw Error('PRODUCTION_SOURCE_REJECTED');
 if(/[\\/]output[\\/]|[\\/]simulation(?:[\\/]|$)|[\\/]journey-/i.test(source))throw Error('QA_SOURCE_REJECTED');
 const id=stamp(),backupRoot=path.join(manager,'backups',id),dataRoot=path.join(config.dataBase,c.id+'-'+id),snapshot=await backupProduction(source,backupRoot);
 const migration=await migrateBackup(backupRoot,dataRoot,{migrate:async target=>execFileSync(path.join(c.root,c.exe),[path.join(manager,'launcher/migrate.cjs'),c.root,target],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},encoding:'utf8',windowsHide:true,timeout:30000,stdio:['ignore','pipe','pipe']})});
 atomicJSON(path.join(manager,'operations',id+'.json'),{source,backupRoot,dataRoot,releaseId:c.id,original:snapshot.database,migrated:migration.database,oldRowsPreserved:true});
 return{dataRoot,schema:migration.database.schema,backupPath:backupRoot,assertUnchanged:()=>assertSourceUnchanged(source,snapshot)};
}
function installShortcut(){
 const config=readJSON(path.join(manager,'delivery-config.json')),state=readJSON(path.join(manager,'current.json')),catalog=readJSON(state.current.catalogFile);verifyRelease(catalog);
 const link=config.desktopLink,id=stamp();fs.mkdirSync(path.dirname(link),{recursive:true});
 if(fs.existsSync(link)){const backup=path.join(manager,'entry-backups',id+'.lnk');fs.mkdirSync(path.dirname(backup),{recursive:true});fs.copyFileSync(link,backup,fs.constants.COPYFILE_EXCL);atomicJSON(path.join(manager,'entry-backups',id+'.json'),{original:link,backup,sha256:digest(link)});}
 const request={temporary:path.join(path.dirname(link),'.Rainfall-'+randomUUID()+'.lnk'),target:ps,arguments:'-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+path.join(manager,'Launch.ps1')+'"',workingDirectory:manager,icon:path.join(catalog.root,catalog.exe)+',0'},requestFile=path.join(manager,'shortcut-request.json');
 atomicJSON(requestFile,request);const validation=JSON.parse(psRun(path.join(manager,'launcher/Install-Shortcut.ps1'),['-RequestFile',requestFile]).replace(/^\uFEFF/,''));fs.renameSync(request.temporary,link);
 atomicJSON(path.join(manager,'desktop-entry.json'),{path:link,...validation,activeRelease:state.current.releaseId,exe:path.join(catalog.root,catalog.exe),dataRoot:state.current.dataRoot,updatedAt:new Date().toISOString()});
 const rollbackRequest=path.join(manager,'rollback-shortcut-request.json');atomicJSON(rollbackRequest,{...request,temporary:path.join(manager,'回退到上一版本.lnk'),arguments:request.arguments+' -Previous'});psRun(path.join(manager,'launcher/Install-Shortcut.ps1'),['-RequestFile',rollbackRequest]);return readJSON(path.join(manager,'desktop-entry.json'));
}
try{
 let catalog;
 if(!args.includes('--apply-pending')&&!args.includes('--rollback')){const release=path.resolve(get('--release','')),evidence=readJSON(path.resolve(get('--evidence',''))),build=readJSON(path.join(release,'package-verification.json'));catalog=approveRelease(release,evidence,{id:build.version+'-'+evidence.exeHash.slice(0,12),version:build.version});}
 if(args.includes('--initialize'))await initialize();if(!fs.existsSync(path.join(manager,'delivery-config.json')))throw Error('MANAGER_NOT_INITIALIZED');
 const options={isRunning,prepare},result=args.includes('--apply-pending')?await applyPending(manager,options):args.includes('--rollback')?await rollback(manager,options):await deliver(manager,catalog,options);
 const entry=['activated','already_current','rolled_back','pending'].includes(result.status)?installShortcut():undefined,report={...result,entry,manager,completedAt:new Date().toISOString(),remoteUpdateSource:null};atomicJSON(path.join(manager,'last-delivery.json'),report);console.log(JSON.stringify(report,null,2));
}catch(e){fs.mkdirSync(manager,{recursive:true});atomicJSON(path.join(manager,'last-error.json'),{error:String(e.message),at:new Date().toISOString(),currentPreserved:fs.existsSync(path.join(manager,'current.json'))});console.error(e.message);process.exitCode=1;}
