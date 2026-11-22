// Only the installed local ffprobe may be spawned. No browsers, HTTP, credentials or external app writes.
const cp=require('node:child_process'),execFileSync=cp.execFileSync;
const fixtureMediaTool = require("./media-tool-path.cjs");
require("./offline-only.cjs");
cp.execFileSync=(file,args,options)=>{
 if(file!==fixtureMediaTool("ffprobe"))throw Error("OFFLINE_MEDIA_PROCESS_FORBIDDEN");
 if(args.some(v=>/^https?:/i.test(v)))throw Error('OFFLINE_MEDIA_URL_FORBIDDEN');
 return execFileSync(file,args,{...options,windowsHide:true});
};
