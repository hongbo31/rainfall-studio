// Permit only the installed local compiler service; every business network/native effect remains denied.
const cp=require('node:child_process'),spawn=cp.spawn;
require('./offline-only.cjs');
cp.spawn=function(command,args,options){
 if(typeof command==='string'&&/node_modules[\\/]@esbuild[\\/]win32-x64[\\/]esbuild\.exe$/i.test(command)&&Array.isArray(args)&&args.length===2&&args[0]==='--service=0.28.2'&&args[1]==='--ping')return spawn.call(this,command,args,options);
 throw Error('OFFLINE_UNIT_NATIVE_FORBIDDEN');
};
