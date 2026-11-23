import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import {launchHeadlessChromium} from '../scripts/lib/headless-chromium.mjs';
import {installFanqieDirectorySite} from './fixtures/fanqie-directory-site.mjs';

const project = path.resolve(import.meta.dirname, '..');
const {outputFiles} = await build({
  stdin: {
    contents: `
      export {Repository} from './src/core/database';
      export {setDownloadDirectory} from './src/core/download-archive';
      export {readFanqieDownloadArchive} from './src/core/fanqie-downloads';
      export {FanqieCatalogSession} from './src/main/fanqie/catalog-session';
      export {readFanqieDirectoryCatalog} from './src/main/fanqie/catalog-lookup';
      export {FanqieUploadBroker} from './src/main/fanqie/upload-broker';
      export {checkFanqieNewUpload} from './src/shared/fanqie-catalog';
    `, resolveDir: project,
  },
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
});
const bundled = {exports: {}};
new Function('require', 'module', '__dirname', outputFiles[0].text)(
  createRequire(import.meta.url), bundled, path.join(project, 'output'),
);
const {
  Repository, setDownloadDirectory, readFanqieDownloadArchive, FanqieCatalogSession, readFanqieDirectoryCatalog,
  FanqieUploadBroker, checkFanqieNewUpload,
} = bundled.exports;
const origin = 'https://www.novelfm.com';
const catalogPath = '/creator/music/finished/ugc';
const listPath = '/api/author/book/music/ugc_product_list/v0/';
const cover = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aivsAAAAASUVORK5CYII=', 'base64');
const artist = '锤七叶';
const singerArtistId = '9876543210123456781';
const rosterListPath = '/api/author/home/get_owned_artist_list/v0/';
const newTitle = '本批首次上传';
const oldTitle = '已经提交的歌曲';
const newId = '9876543210987654321';

test('a paused directory run uploads once and verifies its new ID without opening the 2,876-page catalog', {timeout: 120000}, async t => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rainfall-scoped-catalog-')));
  const downloads = path.join(root, 'downloads');
  const folder = path.join(downloads, '番茄测试账号_' + artist + '_提示词');
  fs.mkdirSync(folder, {recursive: true});
  for (const title of [newTitle, oldTitle]) {
    fs.writeFileSync(path.join(folder, title + '.wav'), 'Synthetic audio: ' + title);
    fs.writeFileSync(path.join(folder, title + '.txt'), '隔离测试歌词');
    fs.writeFileSync(path.join(folder, title + '.png'), cover);
  }
  const repo = new Repository(':memory:');
  t.after(() => repo.close());
  const accountId = randomUUID();
  repo.save('accounts', {id: accountId, name: '番茄测试账号', provider: 'fanqie'});
  setDownloadDirectory(repo, {root: downloads, expectedRevision: 0});

  const browser = await launchHeadlessChromium(chromium, {chromiumSandbox: true});
  t.after(() => browser.close());
  const context = await browser.newContext({serviceWorkers: 'block'});
  let submitted = false;
  const openedPages = [];
  context.on('page', page => openedPages.push(page));
  const order = [];
  context.on('request', request => {
    if (new URL(request.url()).pathname === '/creator/music/finished/ugc/uploadProduct') order.push('open-form');
  });
  const site = await installFanqieDirectorySite(context, {
    cover, account: () => '12345678', nestedCover: true,
    artistNames: [{lyricist_id_list: artist, composer_id_list: artist, singer_id_list: artist}],
    singerOptions: {[artist]: [{id: '9876543210123456782'}, {id: singerArtistId}]},
    beforeEvent: event => { if (event.kind === 'confirm') submitted = true; },
  });
  let rosterVisits = 0;
  await context.route(origin + '/creator/music/account/artist', route => {
    rosterVisits++;
    return route.fulfill({contentType: 'text/html; charset=utf-8',
      body: `<input placeholder="请输入艺人名">
      <div class="pagination-container"><button class="arco-pagination-item-next">下一页</button></div><script>
        const field = document.querySelector('input');
        const search = page => {
          const query = new URLSearchParams({
            author_id: '12345678', page_no: page, page_size: '1', name_like: field.value, bind_types: '1,5,8',
          });
          void fetch('${rosterListPath}?' + query);
        };
        field.addEventListener('input', () => search('0'));
        document.querySelector('button').addEventListener('click', () => search('1'));
      </script>`});
  });
  const rosterRequests = [];
  await context.route(url => url.origin === origin && url.pathname === rosterListPath, route => {
    const params = new URL(route.request().url()).searchParams;
    const request = {author: params.get('author_id'), page: params.get('page_no'), name: params.get('name_like')};
    rosterRequests.push(request);
    if (request.name === artist) order.push('roster-page-' + request.page);
    const artists = request.name === artist ? [
      request.page === '0' ? {author_id: '9876543210123456782', name: artist + '合作'} : {author_id: singerArtistId, name: artist},
    ] : [];
    const body = JSON.stringify({code: 0, data: {artist_list: artists, total_count: artists.length ? '2' : '0'}})
      .replace(/("author_id":)"(\d+)"/gu, '$1$2');
    return route.fulfill({contentType: 'application/json', body});
  });
  let ignoringFilter = true, postReads = 0, released = false, catalogVisits = 0;
  const requests = [];
  const fuzz = Array.from({length: 10}, (_, index) => ({
    product_id: String(1234567890 + index), name: oldTitle + ' 现场版 ' + index, music_ugc_product_status: 7,
  }));
  await context.route(origin + catalogPath, route => { catalogVisits++; return route.abort(); });
  await context.route(url => url.origin === origin && url.pathname === listPath, async route => {
    const request = route.request(), params = new URL(request.url()).searchParams;
    const title = params.get('name'), id = params.get('product_id'), index = Number(params.get('page_index'));
    assert.equal(request.method(), 'GET');
    assert([newTitle, oldTitle].includes(title), 'every request has a title filter');
    assert.equal(params.get('page_count'), '10');
    requests.push({title, id, index, submitted});
    let total = 0, list = [];
    if (ignoringFilter) [total, list] = [28756, fuzz];
    else if (title === oldTitle) [total, list] = [11, index === 0 ? fuzz : [
      {product_id: '1234567890987654321', name: oldTitle, music_ugc_product_status: 4},
    ]];
    else if (submitted && (++postReads > 1 || id)) [total, list] = [1, [
      {product_id: newId, name: newTitle, music_ugc_product_status: released ? 7 : 0},
    ]];
    const json = JSON.stringify({code: 0, data: {total_count: total, music_ugc_product_list: list}})
      .replace(/("product_id":)"(\d+)"/gu, '$1$2');
    return route.fulfill({contentType: 'application/json', body: json});
  });
  const session = new FanqieCatalogSession({root, generation: () => 1, available: () => true, launch: async () => context});
  const broker = new FanqieUploadBroker({
    root, session, generation: () => 1, available: () => true,
    downloads: async scope => readFanqieDownloadArchive({repo, mode: 'production'}, {accountId, scope}),
    materials: async (_root, {audio, cover: image}) => {
      const file = path.join(folder, path.parse(audio.file).name + '.txt');
      const contents = fs.readFileSync(file);
      return {audio, cover: image, lyrics: {file, bytes: contents.length, sha256: createHash('sha256').update(contents).digest('hex')}};
    },
    verify: async () => {},
    authorize: async (_root, _session, _account, ids, _preference, _guard, _state, _wholeBatch, {uploadedPage}) => {
      assert.deepEqual(ids, [newId]);
      assert.equal(uploadedPage, openedPages[0]);
      return [{id: newId, title: newTitle, phase: 'awaiting_signature', status: '等待合同确认'}];
    },
  });
  await broker.ui('saveConfiguration', {version: 1, useWorkMaterials: true, publicationConsent: true,
    authors: {lyricist: artist, composer: artist, singer: artist}, directoryPreferences: {limit: 100, signContract: false},
    authorizationPreference: {mode: 'nonexclusive', platforms: ['fanqie_music'], confirmContractManually: true}});
  const {fingerprint} = await broker.ui('previewDownloads');
  const paused = await broker.ui('publishDownloads', {fingerprint, consent: true});
  assert.equal(paused.state, 'needs_review');
  assert.equal(paused.issue, 'FANQIE_CATALOG_LOOKUP_TOO_BROAD');
  assert.equal(paused.remaining, 2);
  assert.equal(requests.length, 1, 'an ignored filter stops within its first result page');
  assert.equal(site.events.length, 0);
  assert.equal(openedPages[0].isClosed(), false, 'the workspace is available while the run needs review');

  ignoringFilter = false;
  const batch = await broker.ui('reconcileDownloads');
  assert.equal(batch.state, 'awaiting_signature', batch.issue);
  assert.equal(batch.items.find(item => item.title === oldTitle).state, 'skipped');
  assert.equal(batch.items.find(item => item.title === newTitle).workId, newId);
  assert.deepEqual(site.events.filter(event => event.kind === 'credit').map(({role, name}) => [role, name]), [
    ['lyricist_id_list', '锤七叶'], ['composer_id_list', '锤七叶'], ['singer_id_list', '锤七叶'],
  ]);
  assert.deepEqual(site.events.filter(event => event.kind === 'credit' && event.role === 'singer_id_list')
    .map(event => event.artistId), [singerArtistId]);
  assert.equal(site.events.filter(event => event.kind === 'confirm').length, 1);
  assert.equal(openedPages[0].isClosed(), false, 'pending authorization keeps the working tab open');
  assert(requests.some(request => request.title === oldTitle && request.index === 1), 'a filtered second result page still guards against duplicates');
  assert.equal(postReads, 2, 'a delayed receipt is polled by title');

  released = true;
  const review = await broker.ui('reconcileDownloads');
  assert.equal(review.state, 'complete');
  assert.equal(review.items.find(item => item.title === newTitle).officialStatus, '已上架');
  assert.deepEqual(requests.at(-1), {title: newTitle, id: newId, index: 0, submitted: true});
  assert.equal(catalogVisits, 0);
  assert(rosterVisits > 0);
  assert.deepEqual(rosterRequests.filter(request => request.name), [
    {author: '12345678', page: '0', name: artist}, {author: '12345678', page: '1', name: artist},
  ]);
  assert(order.indexOf('open-form') > order.indexOf('roster-page-1'), 'both roster pages precede navigation to the upload form');
  assert.equal(fs.existsSync(path.join(root, 'production/fanqie/catalog.json')), false);
  assert.equal(openedPages.length, 2, 'the roster lookup uses a separate tab from the upload and reconciliation');
  assert.equal(openedPages[1].isClosed(), true, 'the roster tab is closed after lookup');
  assert.equal(openedPages[0].isClosed(), true, 'verified completion closes the working tab');
  assert.equal(session.status().connected, false, 'an otherwise empty account window closes with it');
  assert.equal(site.events.some(event => event.kind === 'sign'), false);
  assert.deepEqual(site.refused, []);
});

test('a complete title lookup proves absence only for titles it searched', () => {
  const catalog = {source: 'browser', url: origin + catalogPath, complete: true, total: 0, rows: [], searchedTitles: [newTitle]};
  assert.equal(checkFanqieNewUpload(catalog, newTitle).allowed, true);
  assert.equal(checkFanqieNewUpload(catalog, oldTitle).reason, 'FANQIE_CATALOG_INCOMPLETE');
});

test('scoped receipts distinguish uncreated and existing contracts without rounding their IDs', async () => {
  const rows = {
    '未生成合同': '{"product_id":9876543210123456780,"name":"未生成合同","music_ugc_product_status":0}',
    '已经有合同': '{"product_id":9876543210123456781,"name":"已经有合同","music_ugc_product_status":1,"contract_id":9876543210123456789}',
  };
  const account = {
    url: () => origin + '/creator/music/account/profile',
    locator: () => ({
      evaluate: async (_read, {request}) => {
        const title = new URL(request, origin).searchParams.get('name');
        return '{"code":0,"data":{"total_count":1,"music_ugc_product_list":[' + rows[title] + ']}}';
      },
    }),
  };
  const catalog = await readFanqieDirectoryCatalog(account, () => {}, Object.keys(rows).map(title => ({title})));
  assert.deepEqual(catalog.rows.map(({id, stage, contract}) => [id, stage, contract]), [
    ['9876543210123456780', 'contract_pending', {state:'not_created'}],
    ['9876543210123456781', 'contract_pending', {state:'awaiting_signature', id:'9876543210123456789'}],
  ]);
});
