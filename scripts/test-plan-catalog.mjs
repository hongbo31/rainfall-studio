import {build} from 'esbuild';import {spawnSync} from 'node:child_process';import path from 'node:path';
const file=path.resolve('output/plan-catalog-tests/catalog.cjs');
await build({entryPoints:['src/core/plan-center-catalog.ts'],outfile:file,bundle:true,platform:'node',format:'cjs',packages:'external'});
const r=spawnSync(process.execPath,['--require',path.resolve('tests/fixtures/offline-only.cjs'),'--test','tests/plan-catalog.test.mjs'],{stdio:'inherit',env:{...process.env,RAINFALL_PLAN_CATALOG_BUNDLE:file}});process.exit(r.status??1);
