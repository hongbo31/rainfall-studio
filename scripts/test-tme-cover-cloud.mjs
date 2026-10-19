// Cloud-local regression entrypoint. No native Windows or live-platform claim.
import {spawnSync} from 'node:child_process';
const checks=[
 ['--test','tests.mjs'],
 ['scripts/test-tme-ai-prepare.mjs'],
 ['scripts/test-tme-ai-broker.mjs'],
 ['scripts/test-tme-ai-submission.mjs'],
 ['scripts/test-tme-ai-prepare-ui.mjs'],
 ['--test','tests/tme-cover-readback.test.mjs'],
 ['--test','tests/tme-overlay-policy.test.mjs','tests/tme-page-overlays.test.mjs','tests/tme-ui-port.test.mjs'],
];
for(const args of checks){
 console.log('\nCLOUD OFFLINE CHECK:',args.join(' '));
 const result=spawnSync(process.execPath,args,{stdio:'inherit'});
 if(result.status!==0)process.exit(result.status??1);
}
console.log('\nCloud offline checks passed. Windows UIA, foreground interaction, real login and remote submission were not tested.');
