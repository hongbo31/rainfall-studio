import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const bundle=path.resolve('output/fanqie-tests/core.cjs');
await build({stdin:{contents:`export * from './src/main/fanqie/form';export * from './src/core/fanqie';export * from './src/core/publication-foundation';export {UnifiedPublicationService} from './src/core/unified-publication';export * from './src/shared/fanqie';export {Repository} from './src/core/database';`,resolveDir:process.cwd()},outfile:bundle,bundle:true,platform:'node',format:'cjs',packages:'external'});
const result=spawnSync((await import('electron')).default,['--require',path.resolve('tests/fixtures/offline-media.cjs'),'--test','tests/fanqie.test.cjs','tests/publication-foundation.test.cjs'],{stdio:'inherit',env:{...process.env,ELECTRON_RUN_AS_NODE:'1',RAINFALL_FANQIE_BUNDLE:bundle}});
process.exit(result.status??1);
