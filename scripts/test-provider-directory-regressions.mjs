import {build} from 'esbuild';
import path from 'node:path';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const dir=path.resolve('output/provider-directory-regressions');
fs.mkdirSync(dir,{recursive:true});
await build({stdin:{contents:`export {Repository} from './src/core/database'; export {PlanCenterService} from './src/core/plan-center'; export {DirectoryTaskController} from './src/core/directory-tasks'; export {ProviderTextAdapter} from './src/core/workflow/provider-text'; export {nodeHttpsTransport} from './src/core/workflow/yourmusic'; export {Studio} from './src/core/studio'; export {tickPlanCenter} from './src/core/plan-center-integration';`,resolveDir:process.cwd(),loader:'ts'},outfile:path.join(dir,'review-bundle.cjs'),bundle:true,platform:'node',format:'cjs',packages:'external'});
const r=spawnSync((await import('electron')).default,[path.resolve('tests/provider-directory-regressions.cjs')],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1',RAINFALL_PROVIDER_DIRECTORY_REGRESSION_BUNDLE:path.join(dir,'review-bundle.cjs')},encoding:'utf8',windowsHide:true});
fs.writeFileSync(path.join(dir,'probe-results.log'),r.stdout+r.stderr);console.log(r.stdout+r.stderr);process.exitCode=r.status??1;
