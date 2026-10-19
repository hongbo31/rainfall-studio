// Background-only verification. SQLite uses Electron's Node mode, never Main.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const out=path.resolve('output/provider-wiring/final-verification');fs.mkdirSync(out,{recursive:true});
const electron=path.resolve('node_modules/electron/dist/electron.exe');
const checks=[
 ['unit',false,['--test','tests.mjs']],
 ['typecheck',false,['node_modules/typescript/bin/tsc','--noEmit']],
 ...['plan-center','production-flow','managed-music','plan-models','plan-model-credentials','plan-dot','plan-publication','plan-assets','plan-catalog','unified-plan-integration','tme-ai-scope','tme-ai-prepare','tme-ai-submission','unified-publish','cover-lyrics'].map(name=>[name,name!=='tme-ai-scope',['scripts/test-'+name+'.mjs']]),
 ...['plan-pipeline','plan-run-assets-ui','simple-publishing','publication-scope-contract','tme-ai-prepare-ui','simple-publishing-ui'].map(name=>[name,false,['scripts/test-'+name+'.mjs']]),
 ['unified-publish-main',true,['--test','tests/unified-publish-main.test.mjs']],
 ['publication-scope-headless',false,['--test','tests/publication-scope-ui.test.mjs']],
 ['publication-pipeline-legacy-ui',false,['--test','tests/publication-pipeline-ui.test.mjs']],
 ['desktop-build',false,['scripts/build-desktop.mjs']],
 ['plan-center-headless',false,['scripts/test-plan-center-headless.mjs']],
];
const results=[];
for(const [name,nodeMode,args] of checks){
 const at=Date.now(),run=spawnSync(nodeMode?electron:process.execPath,args,{cwd:process.cwd(),windowsHide:true,encoding:'utf8',timeout:180000,maxBuffer:32*1024*1024,env:{...process.env,...(nodeMode?{ELECTRON_RUN_AS_NODE:'1'}:{})}});
 const log=path.join(out,name+'.log'),body=(run.stdout??'')+(run.stderr??'')+(run.error?'\n'+run.error.stack:'');fs.writeFileSync(log,body);
 const record={name,passed:run.status===0,status:run.status,durationMs:Date.now()-at,log};results.push(record);console.log(JSON.stringify(record));
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({passed:results.every(x=>x.passed),results,nativeGuiLaunched:false,formalDataTouched:false,externalWrites:'fixture-only'},null,2));
 if(!record.passed){console.error(body.slice(-6000));process.exit(1)}
}
