import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import path from 'node:path';
const outfile = path.resolve('output/media-tool-paths/assets.cjs');
await build({entryPoints:['src/core/assets.ts'],outfile,bundle:true,platform:'node',format:'cjs',packages:'external'});
const assets = createRequire(import.meta.url)(outfile);
test('media commands use explicit platform paths rather than PATH lookup', () => {
  const expected = process.platform === 'win32'
    ? 'C:\\ffmpeg\\ffmpeg-8.1-essentials_build\\bin\\'
    : '/usr/bin/';
  const suffix = process.platform === 'win32' ? '.exe' : '';
  assert.equal(assets.ffmpeg, `${expected}ffmpeg${suffix}`);
  assert.equal(assets.ffprobe, `${expected}ffprobe${suffix}`);
});
test('fixed media path mapping preserves Windows and rejects unsupported platforms and tool names', () => {
  for (const tool of ['ffmpeg', 'ffprobe']) {
    assert.equal(assets.mediaToolPath(tool, 'win32'), `C:\\ffmpeg\\ffmpeg-8.1-essentials_build\\bin\\${tool}.exe`);
    assert.equal(assets.mediaToolPath(tool, 'linux'), `/usr/bin/${tool}`);
    assert.throws(() => assets.mediaToolPath(tool, 'darwin'), /MEDIA_TOOL_PLATFORM_UNSUPPORTED/);
  }
  assert.throws(() => assets.mediaToolPath('../sh', 'linux'), /MEDIA_TOOL_UNSUPPORTED/);
});
