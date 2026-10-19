// Compile the current component, then exercise its real handlers in an offline hook host.
// This unit test uses no DOM, browser, account library, credentials or external executor.
import {transform} from 'esbuild';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const source=path.resolve('src/renderer/components/PlanRunAssets.tsx');
const dir=path.resolve('output/plan-run-assets-ui-tests');
const bundle=path.join(dir,'PlanRunAssets.cjs');
const compiled=await transform(fs.readFileSync(source,'utf8'),{
  sourcefile:source,loader:'tsx',format:'cjs',jsx:'transform',
});
fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(bundle,compiled.code);
const result=spawnSync(process.execPath,[
  '--require',path.resolve('tests/fixtures/offline-only.cjs'),
  '--test','tests/plan-run-assets-ui.test.cjs',
],{stdio:'inherit',env:{...process.env,RAINFALL_PLAN_RUN_ASSETS_UI_BUNDLE:bundle}});
process.exit(result.status??1);
