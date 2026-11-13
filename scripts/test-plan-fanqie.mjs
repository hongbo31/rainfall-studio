import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
await build({stdin:{contents:`
  export * from './src/core/plan-fanqie';
  export * from './src/main/fanqie/plan-publisher';
  export {YourMusicAdapter} from './src/core/workflow/yourmusic';
  export {Studio} from './src/core/studio';
  export {planPuleAction} from './src/core/plan-pule';
  export {tickPlanCenter} from './src/core/plan-center-integration';
  export {planCoverImage,scanCoverInbox,recoverCoverImages} from './src/core/cover-inbox';
  export {createPlanCoverImageRunner} from './src/main/plan-cover-image';
  export {ApiCredentials} from './src/main/api-credentials';
  export {openAiCoverModel} from './src/shared/api-profiles';
`,resolveDir:process.cwd()},outfile:'output/plan-fanqie/index.cjs',bundle:true,platform:'node',format:'cjs',packages:'external'});
const r=spawnSync(process.execPath,['--require','./tests/fixtures/offline-media-only.cjs','--test','tests/plan-fanqie.test.cjs'],{windowsHide:true,stdio:'inherit'});process.exit(r.status??1);
