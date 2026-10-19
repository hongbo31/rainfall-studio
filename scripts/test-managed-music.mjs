import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const file=path.resolve('output/provider-wiring/managed-music.cjs');
await build({stdin:{contents:[
  'export {Studio} from "./src/core/studio";',
  'export {ProductionFlowService} from "./src/core/production-flow";',
  'export {importProductionAudio} from "./src/core/production-integration";',
  'export {createProductionFlowBroker} from "./src/main/production-flow";',
  'export {YourMusicAdapter} from "./src/core/workflow/yourmusic";',
  'export * from "./src/core/plan-center-music";',
].join('\n'),resolveDir:process.cwd()},outfile:file,bundle:true,platform:'node',format:'cjs',packages:'external'});
const workflow=path.resolve('output/provider-wiring/music-workflow.cjs'),quality=path.resolve('output/provider-wiring/music-quality.cjs');
await Promise.all([
  build({entryPoints:['src/core/workflow/index.ts'],outfile:workflow,bundle:true,platform:'node',format:'cjs',packages:'external'}),
  build({entryPoints:['src/core/quality/index.ts'],outfile:quality,bundle:true,platform:'node',format:'cjs',packages:'external'}),
]);
const result=spawnSync(process.execPath,['--require',path.resolve('tests/fixtures/managed-music-offline.cjs'),'--test','tests/managed-music.test.mjs','tests/integration/workflow-music.test.cjs'],{
  stdio:'inherit',windowsHide:true,env:{...process.env,RAINFALL_MANAGED_MUSIC_BUNDLE:file,RAINFALL_WORKFLOW_BUNDLE:workflow,RAINFALL_QUALITY_BUNDLE:quality}});
process.exit(result.status??1);
