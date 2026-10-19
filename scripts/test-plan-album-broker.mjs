import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const bundle=path.resolve('output/album-integration/broker-tests.cjs');
await build({stdin:{contents:'export * from "./src/main/plan-albums";export {tmeAiSubjectHash} from "./src/shared/tme-ai-prepare";',resolveDir:process.cwd()},outfile:bundle,bundle:true,platform:'node',format:'cjs',packages:'external'});
const result=spawnSync(process.execPath,['--require',path.resolve('tests/fixtures/offline-only.cjs'),'--test','tests/plan-album-broker.test.mjs'],{stdio:'inherit',env:{...process.env,RAINFALL_ALBUM_BROKER_BUNDLE:bundle}});
process.exit(result.status??1);
