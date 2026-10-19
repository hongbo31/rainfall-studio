import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const file=path.resolve('output/provider-wiring/publication-scope-contract.cjs');
await build({stdin:{contents:'export {preparationInput,preparationRows} from "./src/renderer/components/TmeAiPrepareWorkspace"; export {submissionResult} from "./src/renderer/components/TmeAiSubmissionWorkspace";',resolveDir:process.cwd()},outfile:file,bundle:true,platform:'node',format:'cjs',packages:'external'});
const result=spawnSync(process.execPath,['--require',path.resolve('tests/fixtures/offline-only.cjs'),'--test','tests/publication-scope-contract.test.mjs'],{stdio:'inherit',windowsHide:true,env:{...process.env,RAINFALL_PUBLICATION_SCOPE_BUNDLE:file}});process.exit(result.status??1);
