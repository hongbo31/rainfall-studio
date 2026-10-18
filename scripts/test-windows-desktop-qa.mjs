// Pure Node tests only: never launch Electron or a native GUI.
import {spawnSync} from 'node:child_process';
const result=spawnSync(process.execPath,['--test','tests/windows-desktop-qa.test.mjs'],{stdio:'inherit'});
process.exit(result.status??1);
