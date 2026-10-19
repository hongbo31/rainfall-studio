import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

const bundle=path.resolve('output/album-integration/e2e/integration.cjs');
await build({stdin:{contents:'export {PlanAlbumService} from "./src/core/plan-albums";export {PlanCenterService} from "./src/core/plan-center";export {Repository} from "./src/core/database";export {createPlanAlbumBroker} from "./src/main/plan-albums";export {createTmeAlbumBrowserTransport} from "./src/main/tme/album-browser";export {tmeAiSubjectHash} from "./src/shared/tme-ai-prepare";',resolveDir:process.cwd()},outfile:bundle,bundle:true,platform:'node',format:'cjs',packages:'external'});
const electron=(await import('electron')).default;
const result=spawnSync(electron,['--test','tests/plan-album-e2e.test.mjs'],{stdio:'inherit',env:{...process.env,ELECTRON_RUN_AS_NODE:'1',RAINFALL_PLAN_ALBUM_E2E_BUNDLE:bundle}});
process.exit(result.status??1);
