// Network remains blocked. Permit only the existing local media tools used by these tests.
const cp = require('node:child_process');
const execFileSync = cp.execFileSync;
require('./offline-only.cjs');
const allowed = new Set(['C:\\ffmpeg\\ffmpeg-8.1-essentials_build\\bin\\ffmpeg.exe','C:\\ffmpeg\\ffmpeg-8.1-essentials_build\\bin\\ffprobe.exe']);
cp.execFileSync = (file,args,options) => {
  if (!allowed.has(file) || !Array.isArray(args) || args.some(v=>/https?:|rtmp:|ftp:|tcp:|udp:/i.test(String(v)))) throw Error('OFFLINE_MEDIA_COMMAND_FORBIDDEN');
  return execFileSync(file,args,options);
};
