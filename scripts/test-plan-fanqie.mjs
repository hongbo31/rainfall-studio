import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
await build({stdin:{contents:`
  export * from './src/core/plan-fanqie';
  export * from './src/main/fanqie/plan-publisher';
  export {YourMusicAdapter} from './src/core/workflow/yourmusic';
  export {renderPlanArtwork} from './src/core/plan-artwork';
`,resolveDir:process.cwd()},outfile:'output/plan-fanqie/index.cjs',bundle:true,platform:'node',format:'cjs',packages:'external'});
const r=spawnSync(process.execPath,['--test','tests/plan-fanqie.test.cjs'],{stdio:'inherit'});process.exit(r.status??1);
