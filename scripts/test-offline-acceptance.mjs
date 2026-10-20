import {build} from 'esbuild';import {spawnSync} from 'node:child_process';
await build({stdin:{contents:"export {offlineAcceptanceEnabled,offlineAcceptanceInvocationAllowed} from './src/shared/offline-acceptance';export {nodeHttpsTransport} from './src/core/workflow/yourmusic';",resolveDir:process.cwd(),loader:'ts'},outfile:'build/offline-acceptance.cjs',bundle:true,platform:'node',format:'cjs',packages:'external'});
const r=spawnSync(process.execPath,['--test','tests/offline-acceptance.test.cjs'],{stdio:'inherit'});process.exit(r.status??1);
