// Background-only verification. SQLite uses Electron's Node mode, never Main.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const out=path.resolve('output/album-integration/final-verification');fs.mkdirSync(out,{recursive:true});
const electron=path.resolve('node_modules/electron/dist/electron.exe');
const checks=[
 ['unit',false,['--test','tests.mjs']],
 ['typecheck',false,['node_modules/typescript/bin/tsc','--noEmit']],
 ...['plan-center','production-flow','managed-music','plan-models','plan-model-credentials','plan-dot','plan-publication','plan-assets','plan-catalog','unified-plan-integration','tme-ai-scope','tme-ai-prepare','tme-ai-submission','unified-publish','cover-lyrics'].map(name=>[name,name!=='tme-ai-scope',['scripts/test-'+name+'.mjs']]),
 ...['plan-pipeline','plan-run-assets-ui','simple-publishing','publication-scope-contract','tme-ai-prepare-ui','simple-publishing-ui'].map(name=>[name,false,['scripts/test-'+name+'.mjs']]),
 ['unified-publish-main',true,['--test','tests/unified-publish-main.test.mjs']],
 ['publication-scope-headless',false,['--test','tests/publication-scope-ui.test.mjs']],
 ['publication-pipeline-legacy-ui',false,['--test','tests/publication-pipeline-ui.test.mjs']],
 ['album-core',true,['scripts/test-plan-albums.mjs']],
 ['album-core-integration',true,['scripts/test-plan-albums-integration.mjs']],
 ['album-review-regressions',true,['scripts/test-plan-album-review-fixes.mjs']],
 ['album-main-broker',false,['scripts/test-plan-album-broker.mjs']],
 ['album-browser',true,['--test','tests/album-browser.test.mjs','tests/ai-existing-album-browser.test.mjs','tests/existing-album-core.test.mjs']],
 ['album-real-e2e',false,['scripts/test-plan-album-e2e.mjs']],
 ['album-main-legacy',false,['--test','tests/main-existing-album-prepare.test.mjs','tests/tme-intake-fields.test.mjs']],
 ['album-prepare-broker-legacy',false,['scripts/test-tme-ai-broker.mjs']],
 ['album-ui',false,['scripts/test-plan-album-ui.mjs']],
 ['desktop-build',false,['scripts/build-desktop.mjs']],
 ['plan-center-headless',false,['scripts/test-plan-center-headless.mjs']],
];
const reportFile=path.join(out,'report.json');
const previous=process.argv.includes('--resume')&&fs.existsSync(reportFile)?JSON.parse(fs.readFileSync(reportFile,'utf8')).results:[];
const results=[];
for(const prior of previous){if(!prior.passed)break;results.push(prior);}
for(const [name,nodeMode,args] of checks.slice(results.length)){
 const at=Date.now(),run=spawnSync(nodeMode?electron:process.execPath,args,{cwd:process.cwd(),windowsHide:true,encoding:'utf8',timeout:180000,maxBuffer:32*1024*1024,env:{...process.env,...(nodeMode?{ELECTRON_RUN_AS_NODE:'1'}:{})}});
 const log=path.join(out,name+'.log'),body=(run.stdout??'')+(run.stderr??'')+(run.error?'\n'+run.error.stack:'');fs.writeFileSync(log,body);
 const record={name,passed:run.status===0,status:run.status,durationMs:Date.now()-at,log};results.push(record);console.log(JSON.stringify(record));
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({passed:results.every(x=>x.passed),results,nativeGuiLaunched:false,formalDataTouched:false,externalWrites:'fixture-only'},null,2));
 if(!record.passed){console.error(body.slice(-6000));process.exit(1)}
}
