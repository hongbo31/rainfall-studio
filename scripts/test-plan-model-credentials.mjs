// Run existing credential regression against current source without changing shared build files.
import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const dir=path.resolve('output/plan-model-credentials'),bundle=path.join(dir,'current.cjs');
await build({stdin:{contents:'export * from "./src/main/api-credentials";export {CredentialVault} from "./src/main/credentials";export {Studio} from "./src/core/studio";',resolveDir:process.cwd()},outfile:bundle,bundle:true,platform:'node',format:'cjs',packages:'external'});
const source=fs.readFileSync('tests/integration/api-credentials.test.cjs','utf8')
 .replaceAll('require("../../build/core.cjs")','require("./current.cjs")')
 .replaceAll('require("../../build/vault.cjs")','require("./current.cjs")')
 .replaceAll('require("../../build/api-credentials.cjs")','require("./current.cjs")')
 .replaceAll('path.resolve("build/api-credentials.cjs")',JSON.stringify(bundle));
const testFile=path.join(dir,'credentials.test.cjs');fs.writeFileSync(testFile,source);
const r=spawnSync(process.execPath,['--require',path.resolve('tests/fixtures/offline-only.cjs'),'--test',testFile],{stdio:'inherit',env:process.env});
process.exit(r.status??1);
