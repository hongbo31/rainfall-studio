import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const file=path.resolve('output/plan-cover-recovery/core.cjs');
await build({stdin:{contents:'export {Studio} from "./src/core/studio";export {tickPlanCenter} from "./src/core/plan-center-integration";export {flowCandidate} from "./src/core/production-flow-local";export {planCoverImage,scanCoverInbox} from "./src/core/cover-inbox";export {ApiCredentials} from "./src/main/api-credentials";export {createPlanCoverImageRunner} from "./src/main/plan-cover-image";export {nodeHttpsTransport} from "./src/core/workflow/yourmusic";',resolveDir:process.cwd()},outfile:file,bundle:true,platform:'node',format:'cjs',packages:'external'});
const r=spawnSync(process.execPath,['--require',path.resolve('tests/fixtures/offline-only.cjs'),'--test','tests/plan-cover-recovery.test.cjs'],{windowsHide:true,stdio:'inherit',env:{...process.env,RAINFALL_COVER_RECOVERY_BUNDLE:file}});process.exit(r.status??1);
