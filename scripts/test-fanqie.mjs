import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const bundle=path.resolve('output/fanqie-tests/core.cjs');
await build({entryPoints:['src/main/fanqie/catalog-session.ts'],outfile:path.resolve('output/fanqie-tests/session.cjs'),bundle:true,platform:'node',format:'cjs',packages:'external'});
await build({stdin:{contents:`export * from './src/main/fanqie/batch';export * from './src/main/fanqie/authorize-records';export * from './src/main/fanqie/upload-broker';export * from './src/main/fanqie/native-upload';`,resolveDir:process.cwd()},outfile:path.resolve('output/fanqie-tests/upload.cjs'),bundle:true,platform:'node',format:'cjs',packages:'external'});
await build({stdin:{contents:`export * from './src/main/fanqie/form';export * from './src/main/fanqie/first-step';export * from './src/main/fanqie/catalog';export * from './src/main/fanqie/identity';export * from './src/core/fanqie';export * from './src/core/fanqie-work';export * from './src/core/publication-foundation';export {UnifiedPublicationService} from './src/core/unified-publication';export * from './src/shared/fanqie';export {Repository} from './src/core/database';`,resolveDir:process.cwd()},outfile:bundle,bundle:true,platform:'node',format:'cjs',packages:'external'});
const result=spawnSync((await import('electron')).default,['--require',path.resolve('tests/fixtures/offline-media.cjs'),'--test','tests/fanqie.test.cjs','tests/fanqie-upload-broker.cjs','tests/publication-foundation.test.cjs'],{stdio:'inherit',env:{...process.env,ELECTRON_RUN_AS_NODE:'1',RAINFALL_FANQIE_BUNDLE:bundle}});
if(result.status!==0)process.exit(result.status??1);
// Real headless browser, synthetic pages only: all requests are intercepted locally.
const native=spawnSync(process.execPath,['--test','tests/fanqie-native-adapter.test.mjs','tests/fanqie-authorization.test.mjs'],{stdio:'inherit',env:process.env});
process.exit(native.status??1);
