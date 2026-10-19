// Same offline guard, with only the shipped hidden exclusive File.Move primitive
// enabled for this suite's isolated output/test-runs sync directories.
const path=require('node:path'),assert=require('node:assert/strict'),cp=require('node:child_process');
const native=cp.execFileSync;
require('./offline-only.cjs');
cp.execFileSync=(command,args,options)=>{
 assert.equal(command,'pwsh.exe');assert.equal(options.windowsHide,true);
 assert.equal(args[4],path.resolve('output/provider-wiring/dot-rename-exclusive.ps1'));
 for(const flag of ['-Source','-Destination'])assert.ok(args[args.indexOf(flag)+1].startsWith(path.resolve('output/test-runs/plan-dot-sync-') ));
 return native(command,args,options);
};
