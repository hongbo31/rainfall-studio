import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const bundle=path.resolve('output/plan-model-tests/models.cjs');
const entries=['export {Repository} from "./src/core/database";','export {ApiCredentials} from "./src/main/api-credentials";','export {CredentialVault} from "./src/main/credentials";'];
for(const file of ['src/shared/plan-models.ts','src/core/plan-center-models.ts','src/main/plan-center-models.ts'])
 if(fs.existsSync(file))entries.push(`export * from "./${file}";`);
await build({stdin:{contents:entries.join('\n'),resolveDir:process.cwd()},outfile:bundle,bundle:true,platform:'node',format:'cjs',packages:'external'});
const r=spawnSync(process.execPath,['--require',path.resolve('tests/fixtures/offline-only.cjs'),'--test','tests/plan-models.test.mjs'],{stdio:'inherit',env:{...process.env,RAINFALL_PLAN_MODEL_BUNDLE:bundle}});
process.exit(r.status??1);
