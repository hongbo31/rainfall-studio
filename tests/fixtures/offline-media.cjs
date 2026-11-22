// Network remains blocked. Permit only the existing local media tools used by these tests.
const cp = require('node:child_process');
const execFileSync = cp.execFileSync;
const fixtureMediaTool = require("./media-tool-path.cjs");
require("./offline-only.cjs");
const allowed = new Set([fixtureMediaTool("ffmpeg"), fixtureMediaTool("ffprobe")]);
cp.execFileSync = (file,args,options) => {
  if (!allowed.has(file) || !Array.isArray(args) || args.some(v=>/https?:|rtmp:|ftp:|tcp:|udp:/i.test(String(v)))) throw Error('OFFLINE_MEDIA_COMMAND_FORBIDDEN');
  return execFileSync(file,args,options);
};
