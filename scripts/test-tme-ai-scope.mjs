import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const bundle=path.resolve('output/tme-ai-scope-tests/core.cjs');
await build({stdin:{contents:'export * from "./src/core/tme-ai-scope";export {verifyCurrentTmeAiScope} from "./src/core/tme-ai-prepare-integration";export {createTmeAiPrepareBroker} from "./src/main/tme/ai-prepare";',resolveDir:process.cwd()},outfile:bundle,bundle:true,platform:'node',format:'cjs',packages:'external'});
const r=spawnSync(process.execPath,['--require',path.resolve('tests/fixtures/offline-only.cjs'),'--test','tests/tme-ai-scope.test.mjs'],{stdio:'inherit',env:{...process.env,RAINFALL_TME_AI_SCOPE_BUNDLE:bundle}});process.exit(r.status??1);
