import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const bundle=path.resolve('output/album-integration/core-tests.cjs');
await build({stdin:{contents:'export * from "./src/core/plan-albums";export * from "./src/shared/plan-albums";export {Repository} from "./src/core/database";export {PlanCenterService} from "./src/core/plan-center";',resolveDir:process.cwd()},outfile:bundle,bundle:true,platform:'node',format:'cjs',packages:'external'});
const result=spawnSync(process.execPath,['--require',path.resolve('tests/fixtures/offline-only.cjs'),'--test','tests/plan-albums.test.mjs'],{stdio:'inherit',env:{...process.env,RAINFALL_PLAN_ALBUMS_BUNDLE:bundle}});
process.exit(result.status??1);
