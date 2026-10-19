import {build} from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const output=path.resolve('output/recovery-backup-longpath-20261019');
fs.mkdirSync(output,{recursive:true});
const bundle=path.join(output,'backup.cjs');
await build({stdin:{contents:"export {backup,restore,zip} from './src/core/backup';export {Repository} from './src/core/database';",resolveDir:process.cwd(),loader:'ts'},outfile:bundle,bundle:true,platform:'node',target:'node24',format:'cjs',packages:'external'});
const runtime=process.env.RAINFALL_TEST_RUNTIME==='node'?process.execPath:(await import('electron')).default;
const result=spawnSync(runtime,['--test','tests/backup-longpath.test.cjs'],{encoding:'utf8',windowsHide:true,env:{...process.env,ELECTRON_RUN_AS_NODE:'1',RAINFALL_BACKUP_LONGPATH_BUNDLE:bundle,RAINFALL_BACKUP_LONGPATH_OUTPUT:output}});
const log=(result.stdout??'')+(result.stderr??'');
fs.writeFileSync(path.join(output,process.env.RAINFALL_BACKUP_LONGPATH_LOG??'latest.log'),log);
process.stdout.write(log);
if(result.error)console.error(result.error);
process.exitCode=result.status??1;
