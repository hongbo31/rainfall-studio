import {build} from 'esbuild';import {spawnSync} from 'node:child_process';import electron from 'electron';
await build({entryPoints:['src/core/index.ts'],outfile:'build/core.cjs',bundle:true,platform:'node',format:'cjs',packages:'external'});
const r=spawnSync(electron,['--test','tests/integration/material-routing.test.cjs'],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:'inherit'});process.exit(r.status??1);
