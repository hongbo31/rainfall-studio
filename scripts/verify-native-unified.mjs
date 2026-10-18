import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
const dir=path.resolve('output/native-acceptance/final-logs');fs.mkdirSync(dir,{recursive:true});
const cases=[
 ['smoke',['--test','tests.mjs']],
 ['typecheck',['node_modules/typescript/bin/tsc','--noEmit']],
 ['build',['scripts/build-desktop.mjs']],
 ['integration',['scripts/run-tests.mjs']],
 ['publishing',['scripts/test-publish-cloud.mjs']],
 ['diagnostics-browser-ui',['--test','tests/workspace-lease-errors.test.mjs','tests/publication-pipeline-render.test.mjs','tests/publication-pipeline-ui.test.mjs']],
 ['actual-browser-popups',['scripts/native-overlay-browser-acceptance.mjs']],
];
const results=[];for(const [name,args]of cases){const r=spawnSync(process.execPath,args,{encoding:'utf8',env:{...process.env,RAINFALL_TEST_RUNTIME:'node'},windowsHide:true,maxBuffer:20*1024*1024});const log=(r.stdout??'')+(r.stderr??'');fs.writeFileSync(path.join(dir,name+'.log'),log);const result={name,exitCode:r.status??1,tests:[...log.matchAll(/(?:ℹ |# )(tests|pass|fail|skipped) (\d+)/g)].map(m=>({kind:m[1],count:Number(m[2])})),error:r.error?String(r.error):null};results.push(result);console.log(JSON.stringify(result));}
fs.writeFileSync(path.join(dir,'summary.json'),JSON.stringify({at:new Date().toISOString(),platform:process.platform,node:process.version,scope:'Windows offline fixtures; real Chromium local UI; no Tencent writes',results},null,2));process.exitCode=results.some(r=>r.exitCode!==0)?1:0;
