// Permit only the installed media validator; all network and other child process
// creation remains denied. No browser, Electron GUI or external provider can run.
const cp=require('node:child_process'),validate=cp.execFileSync;
require('./offline-only.cjs');
cp.execFileSync=(file,args,options)=>{
  if(file!=='C:\\ffmpeg\\ffmpeg-8.1-essentials_build\\bin\\ffprobe.exe'&&file!=='/usr/bin/ffprobe')
    throw Error('OFFLINE_UNIT_PROCESS_FORBIDDEN');
  if(!Array.isArray(args)||args[args.indexOf('-protocol_whitelist')+1]!=='file,pipe'||args.includes('http'))
    throw Error('OFFLINE_UNIT_PROCESS_FORBIDDEN');
  return validate(file,args,{...options,windowsHide:true});
};
