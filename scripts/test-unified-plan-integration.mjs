import {build} from 'esbuild';import {spawnSync} from 'node:child_process';import path from 'node:path';
const file=path.resolve('output/unified-plan-integration/core.cjs');
await build({stdin:{contents:'export {Studio} from "./src/core/studio"; export {tickPlanCenter} from "./src/core/plan-center-integration"; export {backup,restore} from "./src/core/backup";',resolveDir:process.cwd()},outfile:file,bundle:true,platform:'node',format:'cjs',packages:'external'});
const r=spawnSync(process.execPath,['--require',path.resolve('tests/fixtures/offline-only.cjs'),'--test','tests/unified-plan-integration.test.mjs'],{stdio:'inherit',env:{...process.env,RAINFALL_UNIFIED_PLAN_BUNDLE:file}});process.exit(r.status??1);
