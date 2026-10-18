// Only the installed local ffprobe may be spawned. No browsers, HTTP, credentials or external app writes.
const cp=require('node:child_process'),execFileSync=cp.execFileSync;
require('./offline-only.cjs');
cp.execFileSync=(file,args,options)=>{
 if(file!=='C:\\ffmpeg\\ffmpeg-8.1-essentials_build\\bin\\ffprobe.exe')throw Error('OFFLINE_MEDIA_PROCESS_FORBIDDEN');
 if(args.some(v=>/^https?:/i.test(v)))throw Error('OFFLINE_MEDIA_URL_FORBIDDEN');
 return execFileSync(file,args,{...options,windowsHide:true});
};
