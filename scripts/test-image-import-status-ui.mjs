import {build} from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const outfile=path.resolve('output/image-import-status-ui/render.cjs');
await build({stdin:{contents:"export {Context} from './src/renderer/context';export {ProfileCard} from './src/renderer/components/ApiSettings';",resolveDir:process.cwd(),loader:'tsx'},outfile,bundle:true,platform:'node',format:'cjs',packages:'external',plugins:[{name:'test-component-export',setup(b){b.onLoad({filter:/ApiSettings\.tsx$/},args=>({contents:fs.readFileSync(args.path,'utf8')+'\nexport {ProfileCard};',loader:'tsx',resolveDir:path.dirname(args.path)}))}}]});
const r=spawnSync(process.execPath,['--test','tests/image-import-status-ui.test.mjs'],{env:{...process.env,RAINFALL_IMAGE_STATUS_UI_BUNDLE:outfile},stdio:'inherit',windowsHide:true});
process.exitCode=r.status??1;
