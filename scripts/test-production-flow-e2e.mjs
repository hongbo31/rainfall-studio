import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const bundle=path.resolve('output/production-flow-e2e/core.cjs');
await build({stdin:{contents:`export {Studio} from './src/core/studio';export {ProductionFlowService} from './src/core/production-flow';export {createProductionFlowService,importProductionAudio} from './src/core/production-integration';export {DeepSeekAdapter} from './src/core/workflow/deepseek';export {YourMusicAdapter} from './src/core/workflow/yourmusic';export {createProductionFlowBroker} from './src/main/production-flow';`,resolveDir:process.cwd()},outfile:bundle,bundle:true,platform:'node',format:'cjs',packages:'external'});
const result=spawnSync(process.execPath,['--require',path.resolve('tests/fixtures/offline-media-only.cjs'),'--test','tests/production-flow-e2e.test.mjs'],{stdio:'inherit',env:{...process.env,RAINFALL_PRODUCTION_E2E_BUNDLE:bundle}});process.exit(result.status??1);
