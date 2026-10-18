import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
const entry='src/core/unified-publication.ts';
await build({stdin:{contents:'export {Repository} from "./src/core/database";'+(fs.existsSync(entry)?'export * from "./'+entry+'";':''),resolveDir:process.cwd()},outfile:'output/unified-tests/core.cjs',bundle:true,platform:'node',format:'cjs',packages:'external'});
process.exit(spawnSync(process.execPath,['--test','tests/unified-publication.test.mjs'],{stdio:'inherit'}).status??1);
