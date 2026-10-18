import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const file=path.resolve('output/native-diagnostics-tests/main.cjs');
const content=fs.existsSync('src/main/native-diagnostics.ts')?'export * from "./src/main/native-diagnostics";':'export {};';
await build({stdin:{contents:content,resolveDir:process.cwd()},outfile:file,bundle:true,platform:'node',format:'cjs',packages:'external'});
const r=spawnSync(process.execPath,['--require',path.resolve('tests/fixtures/offline-only.cjs'),'--test','tests/native-diagnostics.test.mjs'],{stdio:'inherit',env:{...process.env,RAINFALL_NATIVE_DIAGNOSTICS_BUNDLE:file}});process.exit(r.status??1);
