import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const compiled = await build({
  entryPoints: ['src/main/browser-studio.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { startBrowserStudio } = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].contents).toString('base64')
);

test('the full browser workbench authorizes its own session and preserves the bridge response', async t => {
  assert.equal(typeof startBrowserStudio, 'function', 'full browser service must be available');
  const base = process.env.RAINFALL_TEST_UI ?? 'src/renderer';
  const server = startBrowserStudio(base, {
    dispatch: async (channel, args) => ({ ok: true, value: { channel, args } }),
    media: async request => new Response(request.headers.get('range'), { status: 206, headers: { 'Content-Type': 'audio/wav' } }),
  });
  t.after(() => server.close());
  const url = new URL(await server.ready);
  const [key, mediaKey] = url.hash.slice(1).split('.');
  const origin = url.origin;
  const post = (channel, args, headers = {}) => fetch(origin + '/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ channel, args }),
  });
  const credentials = { Origin: origin, Authorization: 'Bearer ' + key };

  const html = await fetch(origin);
  assert.equal(html.status, 200);
  assert.match(await html.text(), /name="rainfall-browser-studio"/);
  assert.equal((await post('rainfall:call', ['snapshot', {}])).status, 403);
  assert.equal((await post('rainfall:call', ['snapshot', {}], { ...credentials, Origin: 'https://other.invalid' })).status, 403);
  assert.equal((await post('rainfall:unknown', [], credentials)).status, 403);
  assert.equal((await post('rainfall:sms-inbox', ['status', {}], credentials)).status, 403);
  const connection = await post('rainfall:remote-assist-connection', ['status', {}], credentials);
  assert.deepEqual(await connection.json(), { ok: true, value: { channel: 'rainfall:remote-assist-connection', args: ['status', {}] } });
  const call = await post('rainfall:call', ['snapshot', {}], credentials);
  assert.deepEqual(await call.json(), { ok: true, value: { channel: 'rainfall:call', args: ['snapshot', {}] } });
  const selection = { workId: '00000000-0000-4000-8000-000000000002', version: 'B', assetId: '00000000-0000-4000-8000-000000000001' };
  assert.equal((await post('rainfall:export', ['workAudio', selection])).status, 403);
  const download = await post('rainfall:export', ['workAudio', selection], credentials);
  assert.deepEqual(await download.json(), { ok: true, value: { channel: 'rainfall:export', args: ['workAudio', selection] } });

  const asset = '/studio-media/' + mediaKey + '/media/asset/00000000-0000-4000-8000-000000000001';
  assert.equal((await fetch(origin + asset.replace(mediaKey, key))).status, 403);
  const media = await fetch(origin + asset, { headers: { Range: 'bytes=3-6' } });
  assert.equal(media.status, 206);
  assert.equal(await media.text(), 'bytes=3-6');
});
