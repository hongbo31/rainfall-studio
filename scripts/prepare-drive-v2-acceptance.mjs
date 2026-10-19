// Explicitly authorized one-request handoff. No GUI, model, music or publishing worker.
import fs from 'node:fs';
import path from 'node:path';
import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
const root=process.cwd(),folder=path.resolve('output/drive-v2-acceptance-20261019');
const candidateIndex=process.argv.indexOf('--electron');
if(candidateIndex<0)throw Error('EXPLICIT_EXISTING_ELECTRON_REQUIRED');
const electron=path.resolve(process.argv[candidateIndex+1]);
if(!electron.startsWith(path.join(root,'out')+path.sep)||!fs.existsSync(electron))throw Error('EXISTING_CANDIDATE_REQUIRED');
fs.mkdirSync(folder,{recursive:true});
const lock=path.join(folder,'acceptance-operation.lock'),lockFd=fs.openSync(lock,'wx');
try{
fs.writeFileSync(lockFd,String(process.pid));
const bundle=path.join(folder,'acceptance-core.cjs');
await build({stdin:{contents:[
 'export {Repository} from "./src/core/database";',
 'export {PlanCenterService} from "./src/core/plan-center";',
 'export {InboxController} from "./src/core/inbox/controller";',
 'export {inboxHash} from "./src/core/inbox/service";',
 'export {syncPlanDot,planDotStatus,exportPlanDotRequests} from "./src/core/plan-center-dot";',
 'export {assertInboxPath} from "./src/core/inbox/receiver";',
 'export {read} from "./src/core/inbox/dot-delivery-files";'
].join('\n'),resolveDir:root},outfile:bundle,bundle:true,platform:'node',format:'cjs',packages:'external'});
for(const name of ['dot-rename-exclusive.ps1','dot-volume-facts.ps1'])fs.copyFileSync(path.join(root,'src/core/inbox',name),path.join(folder,name));
const child=process.argv.includes('--receive-once')?'scripts/receive-drive-v2-acceptance.cjs':'scripts/prepare-drive-v2-acceptance.cjs';
const result=spawnSync(electron,[path.resolve(child)],{stdio:'inherit',windowsHide:true,env:{...process.env,ELECTRON_RUN_AS_NODE:'1',RAINFALL_DOT_ACCEPTANCE_BUNDLE:bundle}});
process.exitCode=result.status??1;
}finally{fs.closeSync(lockFd);fs.unlinkSync(lock);}
