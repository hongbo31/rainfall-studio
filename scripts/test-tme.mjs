import {build} from 'esbuild';import fs from 'node:fs';import {spawnSync} from 'node:child_process';
fs.mkdirSync('build',{recursive:true});
await build({entryPoints:['tests/fixtures/tme-ui.tsx'],outfile:'build/tme-ui.cjs',bundle:true,platform:'node',target:'node24',format:'cjs',packages:'external'});
const r=spawnSync(process.execPath,['--test','tests/integration/tme-drafts.test.cjs','tests/tme-browser.test.mjs','tests/tme-ui-port.test.mjs','tests/tme-ui.test.mjs'],{stdio:'inherit'});process.exit(r.status??1);
