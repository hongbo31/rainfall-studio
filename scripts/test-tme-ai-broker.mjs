import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const outfile=path.resolve('output/tme-ai-broker-tests/broker.cjs');
await build({stdin:{contents:'export * from "./src/main/tme/ai-prepare";export * from "./src/core/tme-ai-prepare";export {Repository,hash} from "./src/core/database";',resolveDir:process.cwd()},outfile,bundle:true,platform:'node',format:'cjs',packages:'external'});
const r=spawnSync(process.execPath,['--require',path.resolve('tests/fixtures/offline-only.cjs'),'--test','tests/tme-ai-broker.test.mjs'],{stdio:'inherit',env:{...process.env,RAINFALL_TME_AI_BROKER_BUNDLE:outfile}});process.exit(r.status??1);
