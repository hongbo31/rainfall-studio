import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import test from 'node:test';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import {launchHeadlessChromium} from '../scripts/lib/headless-chromium.mjs';
import {installFanqieDirectorySite} from './fixtures/fanqie-directory-site.mjs';

const repo = path.resolve(import.meta.dirname, '..');
const buildRoot = path.resolve(repo, process.env.RAINFALL_BUILD_ROOT || path.join('..', path.basename(repo) + '-build'));
const cover = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aivsAAAAASUVORK5CYII=', 'base64');
const scope = {accountId: '12345678', artistId: '123456789', sessionId: 'directory-fixture'};

async function loadDirectoryForm(clock = performance) {
  const entry = path.join(repo, 'src/main/fanqie/directory-form.ts');
  assert.ok(fs.existsSync(entry), 'The native multi-song form component is available');
  const result = await build({entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false});
  const module = {exports: {}};
  const load = new Function('require', 'module', '__dirname', 'performance', result.outputFiles[0].text);
  load(createRequire(import.meta.url), module, path.dirname(entry), clock);
  return module.exports.executeFanqieDirectoryForm;
}

const execute = await loadDirectoryForm();

async function setup(t, options = {}) {
  fs.mkdirSync(buildRoot, {recursive: true});
  const directory = fs.mkdtempSync(path.join(buildRoot, 'fanqie-directory-form-'));
  const files = [];
  t.after(() => {
    for (const file of files) fs.rmSync(file, {force: true});
    fs.rmdirSync(directory);
  });
  const asset = (name, data) => {
    const file = path.join(directory, name);
    fs.writeFileSync(file, data);
    files.push(file);
    return {file, bytes: Buffer.byteLength(data), sha256: createHash('sha256').update(data).digest('hex')};
  };
  const first = {
    workId: 'first', title: '目录翻唱', scope, musicType: 'cover', songAttribute: 'multi_version', ai: true,
    originalSinger: '合成原唱', originalWorkId: '246813579012345678',
    rightsConfirmed: true, lyricsMatchConfirmed: true,
    authors: {lyricist: '合成词作者', composer: '合成曲作者', singer: '目录歌手一'},
    assets: {audio: asset('take-1.wav', 'synthetic WAV bytes'), lyrics: asset('sidecar-1.txt', '合成歌词'), cover: asset('cover-1.png', cover)},
    copyrightProof: asset('proof-1.pdf', '%PDF synthetic proof'),
  };
  const second = {
    workId: 'second', title: '目录原创', scope, musicType: 'original', songAttribute: 'original', ai: false, instrumental: true,
    rightsConfirmed: true, lyricsMatchConfirmed: true,
    authors: {lyricist: '', composer: '器乐作者', singer: '目录歌手二'},
    assets: {audio: asset('take-2.mp3', 'synthetic MP3 bytes'), cover: asset('cover-2.png', Buffer.concat([cover, Buffer.from('second fixture')]))},
  };
  if (options.secondWithLyricsAndProof) {
    delete second.instrumental;
    second.authors.lyricist = '第二首词作者';
    second.assets.lyrics = asset('sidecar-2.txt', '第二份合成歌词');
    second.copyrightProof = asset('proof-2.zip', 'synthetic ZIP fixture');
  }
  const songs = [first, second];
  for (let index = 2; index < (options.songCount ?? 2); index++) {
    songs.push({
      ...second,
      workId: `song-${index + 1}`, title: `虚拟列表第 ${index + 1} 首`,
      instrumental: true, copyrightProof: undefined,
      authors: {lyricist: '', composer: `器乐曲作者${index + 1}`, singer: `目录歌手${index + 1}`},
      assets: {audio: asset(`take-${index + 1}.mp3`, `synthetic bytes ${index + 1}`), cover: asset(`cover-${index + 1}.png`, cover)},
    });
  }
  const browser = await launchHeadlessChromium(chromium, {chromiumSandbox: true});
  t.after(() => browser.close());
  const context = await browser.newContext({serviceWorkers: 'block'});
  const timeline = [];
  const site = await installFanqieDirectorySite(context, {
    cover,
    artistNames: songs.map(({authors}) => ({
      lyricist_id_list: authors.lyricist, composer_id_list: authors.composer, singer_id_list: authors.singer,
    })),
    account: () => scope.accountId,
    ...options,
    beforeEvent(event) {
      timeline.push({...event, at: performance.now()});
      options.beforeEvent?.(event);
    },
  });
  const callbacks = {
    guard() {},
    async intent(step, songIndex) {
      timeline.push({kind: 'intent', step, songIndex, at: performance.now()});
      await options.onIntent?.(originalPage, step, songIndex);
    },
    trace(step, phase, page, songIndex, error, details) {
      timeline.push({kind: 'trace', step, phase, page, songIndex, error, details, at: performance.now()});
    },
    watch(page) {
      timeline.push({kind: 'watch', page});
      return () => timeline.push({kind: 'unwatch', page});
    },
  };
  const originalPage = await context.newPage();
  const openedPages = [];
  context.on('page', page => openedPages.push(page));
  return {context, originalPage, openedPages, first, second, songs, timeline, site, callbacks};
}

test('native directory form uses four scoped temporary file choosers for each of two songs', {timeout: 120_000}, async t => {
  const {context, originalPage, openedPages, first, second, timeline, site, callbacks} = await setup(t, {nestedCover: true, secondWithLyricsAndProof: true});
  const page = await execute(context, [first, second], callbacks);
  assert.equal(page, originalPage);
  assert.deepEqual(context.pages(), [originalPage]);
  assert.deepEqual(openedPages, [], 'the upload form and account checks reuse the original tab');
  assert.deepEqual(site.requests.filter(url => ['/creator/music/home', '/creator/music/publishWorks',
    '/creator/music/finished/ugc/uploadProduct'].includes(url)), [
    '/creator/music/home', '/creator/music/publishWorks', '/creator/music/finished/ugc/uploadProduct',
  ]);
  assert.deepEqual(await page.locator('.auth-rights-list .song-name').allTextContents(), ['目录翻唱', '目录原创']);
  assert.deepEqual(site.events.filter(event => event.kind === 'add').map(event => event.index), [0, 1]);
  assert.deepEqual(site.events.filter(event => ['next', 'confirm', 'sign'].includes(event.kind)).map(event => event.kind), ['next', 'confirm']);
  assert.deepEqual(site.events.filter(event => ['type', 'attribute', 'ai'].includes(event.kind)).map(({kind, index, value}) => [kind, index, value]), [
    ['type', 0, '翻唱'], ['attribute', 0, '多版本歌曲'], ['ai', 0, '是'],
  ]);
  assert.deepEqual(site.events.filter(event => ['original-singer', 'original-work'].includes(event.kind)).map(({kind, index, value}) => [kind, index, value]), [
    ['original-singer', 0, first.originalSinger], ['original-work', 0, first.originalWorkId],
  ]);
  assert.deepEqual(site.events.filter(event => event.kind === 'credit').map(({index, role, name}) => [index, role, name]), [
    [0, 'lyricist_id_list', '合成词作者'], [0, 'composer_id_list', '合成曲作者'], [0, 'singer_id_list', '目录歌手一'],
    [1, 'lyricist_id_list', '第二首词作者'], [1, 'composer_id_list', '器乐作者'], [1, 'singer_id_list', '目录歌手二'],
  ]);
  assert.equal(site.events.some(event => event.kind === 'wrong-credit'), false);
  assert.deepEqual(site.events.filter(event => ['file', 'receipt', 'title', 'crop'].includes(event.kind)).map(event =>
    [event.index, event.kind, event.role ?? null]), [
    [0, 'file', 'audio'], [0, 'receipt', 'audio'], [0, 'file', 'lyrics'], [0, 'receipt', 'lyrics'], [0, 'title', null],
    [0, 'file', 'cover'], [0, 'crop', null], [0, 'receipt', 'cover'], [0, 'file', 'proof'], [0, 'receipt', 'proof'],
    [1, 'file', 'audio'], [1, 'receipt', 'audio'], [1, 'file', 'lyrics'], [1, 'receipt', 'lyrics'], [1, 'title', null],
    [1, 'file', 'cover'], [1, 'crop', null], [1, 'receipt', 'cover'], [1, 'file', 'proof'], [1, 'receipt', 'proof'],
  ]);
  for (const event of site.events.filter(event => event.kind === 'file')) {
    const song = [first, second][event.index];
    const selected = event.role === 'proof' ? song.copyrightProof : song.assets[event.role];
    assert.deepEqual(event.files, [{name: path.basename(selected.file), sha256: selected.sha256}]);
    assert.equal(event.titleAtTransfer, ['audio', 'lyrics'].includes(event.role) ? '' : song.title);
  }
  const commits = timeline.filter(event => event.kind === 'intent' && event.step === 'first-step:confirm-upload');
  assert.equal(commits.length, 1);
  const confirm = timeline.find(event => event.kind === 'confirm');
  const preflight = timeline.find(event => event.kind === 'intent' && event.step === 'first-step:preflight');
  assert.ok(timeline.find(event => event.kind === 'next').at <= preflight.at && preflight.at < commits[0].at);
  assert.ok(commits[0].at <= confirm.at);
  assert.ok(timeline.some(event => event.kind === 'trace' && event.step === 'open-home' && event.phase === 'begin' && event.page === page),
    'the home trace identifies the owned tab');
  const uploadClick = timeline.filter(event => event.kind === 'trace' && event.step === 'first-step:confirm-upload:click');
  assert.deepEqual(uploadClick.map(event => event.phase), ['begin', 'ok']);
  assert.ok(uploadClick[0].at <= commits[0].at && commits[0].at <= uploadClick[1].at);
  assert.deepEqual(uploadClick[1].details, {batchSize: 2});
  const accepted = timeline.find(event => event.kind === 'trace' && event.step === 'first-step:authorization-readback' && event.phase === 'ok');
  assert.ok(accepted.at - confirm.at >= 3_000);
  assert.deepEqual(accepted.details, {batchSize: 2});
  for (const phase of ['search', 'preview', 'confirm']) {
    const results = timeline.filter(event => event.kind === 'trace' && event.step === `credit:singer:${phase}` && event.phase === 'ok');
    assert.deepEqual(results.map(event => event.songIndex), [0, 1]);
  }
  assert.equal(timeline.filter(event => event.kind === 'trace' && event.phase === 'error').length, 0);
  assert.deepEqual(timeline.filter(event => event.kind === 'trace' && event.step === 'upload:audio').map(({phase, songIndex}) => [phase, songIndex]), [
    ['begin', 0], ['ok', 0], ['begin', 1], ['ok', 1],
  ]);
  assert.equal(timeline.filter(event => event.kind === 'watch' && event.page === page).length, 1);
  assert.equal(timeline.filter(event => event.kind === 'unwatch' && event.page === page).length, 1);
  assert.deepEqual(site.refused, []);
});

test('directory form logs a missing live credit at its song and field before confirmation', {timeout: 40_000}, async t => {
  const {context, first, site, timeline, callbacks} = await setup(t);
  first.authors.singer = '搜不到的歌手';
  await assert.rejects(execute(context, [first], callbacks), /FANQIE_AUTHOR_NOT_FOUND/u);
  assert.ok(timeline.some(event => event.step === 'credit:singer:search' && event.songIndex === 0 && event.phase === 'error'));
  assert.equal(site.events.some(event => event.kind === 'next' || event.kind === 'confirm' || event.name === '目录歌手一' && event.role === 'singer_id_list'), false);
});

test('directory form selects the preflight singer ID even if another same-name option appears first', {timeout: 40_000}, async t => {
  const otherId = '9876543210123456781', ownedId = '9876543210123456782';
  const {context, second, site, callbacks} = await setup(t, {
    singerOptions: {'目录歌手二': [{id: otherId}, {id: ownedId, delayMs: 400}]},
  });
  await execute(context, [{...second, singerArtistId: ownedId}], callbacks);
  assert.deepEqual(site.events.filter(event => event.role === 'singer_id_list').map(event => event.artistId), [ownedId]);
  assert.deepEqual(site.events.filter(event => ['next', 'confirm', 'sign'].includes(event.kind)).map(event => event.kind), ['next', 'confirm']);
  assert.ok(site.requests.includes('/api/author/home/get_song_list/v0/'));
  assert.deepEqual(site.refused, []);
});

test('directory form checks the singer details and selected ID before submitting', {timeout: 55_000}, async t => {
  const otherId = '9876543210123456781', ownedId = '9876543210123456782';
  for (const {name, candidate, afterNext, selected} of [
    {name: 'artist details refer to a different ID', candidate: {id: ownedId, detailId: otherId}, selected: false},
    {name: 'the selected tag has a different ID', candidate: {id: ownedId, selectedId: otherId}, selected: true},
    {name: 'the tag changes to a different same-name ID after Next', candidate: {id: ownedId}, selected: true, afterNext: true},
  ]) await t.test(name, async t => {
    const {context, second, site, callbacks, timeline} = await setup(t, {
      singerOptions: {'目录歌手二': [candidate]}, tamperSingerAfterNext: afterNext ? otherId : undefined,
    });
    await assert.rejects(execute(context, [{...second, singerArtistId: ownedId}], callbacks), /FANQIE_SINGER_ID_UNVERIFIED/);
    assert.equal(site.events.some(event => event.role === 'singer_id_list'), selected);
    assert.equal(site.events.some(event => event.kind === 'next'), !!afterNext);
    assert.equal(site.events.some(event => event.kind === 'confirm' || event.kind === 'sign'), false);
    assert.equal(timeline.some(event => event.kind === 'intent' && event.step === 'first-step:confirm-upload'), false);
  });
});

test('native directory form stops when the added card count jumps unexpectedly', {timeout: 30_000}, async t => {
  const {context, first, second, timeline, site, callbacks} = await setup(t, {extraCard: true});
  await assert.rejects(execute(context, [first, second], callbacks), /FANQIE_SONG_COUNT_UNVERIFIED/);
  assert.deepEqual(site.events.map(event => event.kind), ['add']);
  assert.ok(timeline.some(event => event.phase === 'error' && event.step === 'add-song' && event.songIndex === 0));
});

test('native directory form uploads original songs when the account has no song attribute selector', {timeout: 30_000}, async t => {
  const {context, first, site, callbacks} = await setup(t, {noSongAttributes: true});
  const original = {...first, musicType: 'original', songAttribute: 'original'};
  const page = await execute(context, [original], callbacks);
  assert.deepEqual(await page.locator('.auth-rights-list .song-name').allTextContents(), [original.title]);
  assert.deepEqual(site.events.filter(event => ['attribute', 'original-singer', 'original-work', 'confirm'].includes(event.kind))
    .map(event => event.kind), ['confirm']);
});

test('native directory form stops before transfers when two official results have the requested original ID', {timeout: 30_000}, async t => {
  const {context, first, site, timeline, callbacks} = await setup(t, {duplicateOriginalWork: true});
  await assert.rejects(execute(context, [first], callbacks), /FANQIE_ORIGINAL_WORK_UNVERIFIED/);
  assert.deepEqual(site.events.filter(event => ['original-work', 'file', 'next', 'confirm'].includes(event.kind)), []);
  const failure = timeline.find(event => event.step === 'select-original-work:search' && event.phase === 'error');
  assert.equal(failure?.error.message, 'FANQIE_ORIGINAL_WORK_UNVERIFIED');
  assert.equal(failure.songIndex, 0);
});

test('native directory form refuses a selection that resolves to a different original work', {timeout: 30_000}, async t => {
  const {context, first, site, callbacks} = await setup(t, {wrongResolvedWork: true});
  await assert.rejects(execute(context, [first], callbacks), /FANQIE_ORIGINAL_WORK_UNVERIFIED/);
  assert.deepEqual(site.events.filter(event => ['original-work', 'file', 'next', 'confirm'].includes(event.kind))
    .map(event => [event.kind, event.value]), [['original-work', first.originalWorkId]]);
});

test('native directory form fills and reads back rows unmounted by the virtual list', {timeout: 120_000}, async t => {
  const {context, originalPage, songs, timeline, site, callbacks} = await setup(t, {virtualized: true, songCount: 9});
  const page = await execute(context, songs, callbacks);
  const indices = songs.map((_, index) => index);
  assert.equal(page, originalPage);
  assert.deepEqual(context.pages(), [page]);
  assert.deepEqual(site.events.filter(event => event.kind === 'add').map(event => event.index), indices);
  assert.deepEqual(site.events.filter(event => event.kind === 'file' && event.role === 'audio').map(event => [event.index, event.files[0].sha256]),
    songs.map((song, index) => [index, song.assets.audio.sha256]));
  const tail = site.events.findIndex(event => event.kind === 'viewport' && !event.mounted.includes(0) && event.mounted.includes(8));
  assert.ok(tail >= 0);
  assert.ok(site.events.slice(tail + 1).some(event => event.kind === 'viewport' && event.mounted.includes(0) && !event.mounted.includes(8)));
  assert.deepEqual(timeline.filter(event => event.step === 'first-step:readback' && event.phase === 'ok').map(event => event.songIndex),
    [...indices, ...indices]);
  for (const step of ['upload:lyrics:skipped-instrumental', 'credit:lyricist:skipped-instrumental', 'upload:copyright-proof:skipped']) {
    assert.deepEqual(timeline.filter(event => event.step === step && event.phase === 'ok').map(event => event.songIndex), indices.slice(1));
  }
  assert.deepEqual(await page.locator('.auth-rights-list .song-name').allTextContents(), songs.map(song => song.title));
  assert.deepEqual(site.events.filter(event => ['next', 'confirm', 'sign'].includes(event.kind)).map(event => event.kind), ['next', 'confirm']);
  assert.deepEqual(site.refused, []);
});

test('directory upload brings lazy remounted covers into view before checking them', {timeout: 120_000}, async t => {
  const {context, songs, site, timeline, callbacks} = await setup(t, {virtualized: true, lazyRevisitedCovers: true, songCount: 6});
  const page = await execute(context, songs, callbacks);
  assert(site.events.some(event => event.kind === 'cover-visible' && event.index === 1), 'the second cover reloads when the form is revisited');
  assert.equal(timeline.filter(event => event.step === 'first-step:readback' && event.phase === 'ok').length, 2 * songs.length);
  assert.deepEqual(site.events.filter(event => ['next', 'confirm'].includes(event.kind)).map(event => event.kind), ['next', 'confirm']);
  assert.deepEqual(await page.locator('.auth-rights-list .song-name').allTextContents(), songs.map(song => song.title));
  assert.deepEqual(site.refused, []);
});

test('directory upload replaces only the song whose audio fails the official Next validation', {timeout: 120_000}, async t => {
  const {context, songs, site, timeline, callbacks} = await setup(t, {
    virtualized: true, songCount: 5, secondWithLyricsAndProof: true,
    validationFailures: [{index: 1, fields: ['songFile']}],
  });
  const page = await execute(context, songs, callbacks);
  const second = songs[1];
  assert.deepEqual(site.events.filter(event => event.kind === 'delete').map(({index, title}) => [index, title]), [[1, second.title]]);
  assert.deepEqual(site.events.filter(event => event.kind === 'file' && event.role === 'audio').map(event => event.files[0].sha256),
    [...songs, second].map(song => song.assets.audio.sha256));
  assert.deepEqual(await page.locator('.auth-rights-list .song-name').allTextContents(),
    [songs[0], ...songs.slice(2), second].map(song => song.title));
  assert.deepEqual(site.events.filter(event => ['next', 'confirm'].includes(event.kind)).map(event => event.kind), ['next', 'next', 'confirm']);
  assert.ok(timeline.some(event => event.phase === 'error' && event.step === 'first-step:validation:audio' && event.songIndex === 1));
  assert.equal(timeline.filter(event => event.kind === 'intent' && event.step === 'upload:audio' && event.songIndex === 1).length, 2);
});

test('directory upload fills the six missing fields reported for one song after Next', {timeout: 120_000}, async t => {
  const {context, songs, second, site, timeline, callbacks} = await setup(t, {
    secondWithLyricsAndProof: true, virtualized: true, songCount: 4,
    validationFailures: [{index: 1, fields: ['lyricFile', 'name', 'lyricist_id_list', 'composer_id_list', 'singer_id_list', 'coverImage']}],
  });
  const page = await execute(context, songs, callbacks);
  assert.deepEqual(await page.locator('.auth-rights-list .song-name').allTextContents(), songs.map(song => song.title));
  assert.deepEqual(site.events.filter(event => event.kind === 'delete'), []);
  assert.deepEqual(site.events.filter(event => event.kind === 'file' && event.role === 'audio').map(event => event.files[0].sha256),
    songs.map(song => song.assets.audio.sha256));
  const firstNext = site.events.findIndex(event => event.kind === 'next');
  assert.deepEqual(site.events.slice(firstNext).filter(event => event.kind === 'file').map(({role, files}) => [role, files[0].sha256]),
    [['lyrics', second.assets.lyrics.sha256], ['cover', second.assets.cover.sha256]]);
  assert.deepEqual(site.events.slice(firstNext).filter(event => event.kind === 'credit').map(event => event.name), Object.values(second.authors));
  assert.deepEqual(timeline.filter(event => event.phase === 'error' && event.step?.startsWith('first-step:validation:'))
    .map(({songIndex, step}) => [songIndex, step.slice(step.lastIndexOf(':') + 1)]).sort(),
  ['lyrics', 'title', 'lyricist', 'composer', 'singer', 'cover'].map(field => [1, field]).sort());
  assert.deepEqual(site.events.filter(event => ['next', 'confirm'].includes(event.kind)).map(event => event.kind), ['next', 'next', 'confirm']);
});

test('directory upload bounds repair of a persistent error in a single-song form', {timeout: 120_000}, async t => {
  const {context, first, site, timeline, callbacks} = await setup(t, {
    validationFailures: [{index: 0, fields: ['songFile']}], repeatValidation: true,
  });
  await assert.rejects(execute(context, [first], callbacks), /FANQIE_DIRECTORY_REPAIR_LIMIT/);
  assert.deepEqual(site.events.filter(event => ['add', 'next', 'delete', 'minimum-one', 'confirm'].includes(event.kind)).map(event => event.kind),
    ['add', 'next', 'add', 'delete', 'next', 'add', 'delete', 'next']);
  assert.ok(timeline.some(event => event.phase === 'error' && event.error?.message === 'FANQIE_DIRECTORY_REPAIR_LIMIT' && event.songIndex === 0));
});

test('directory upload records a frontend error after final confirmation without clicking again', {timeout: 60_000}, async t => {
  const {context, first, site, timeline, callbacks} = await setup(t, {confirmError: true});
  await assert.rejects(execute(context, [first], callbacks), /FANQIE_UPLOAD_PAGE_ERROR/);
  assert.deepEqual(site.events.filter(event => ['next', 'confirm', 'delete'].includes(event.kind)).map(event => event.kind), ['next', 'confirm']);
  assert.ok(timeline.some(event => event.phase === 'error' && event.step === 'first-step:authorization-readback' && event.page));
});

test('directory upload replaces a draft rejected before its other fields are filled', {timeout: 60_000}, async t => {
  const {context, first, site, callbacks} = await setup(t, {earlyAudioFailure: true});
  const page = await execute(context, [first], callbacks);
  assert.deepEqual(await page.locator('.auth-rights-list .song-name').allTextContents(), [first.title]);
  assert.deepEqual(site.events.filter(event => ['file', 'delete', 'next', 'confirm'].includes(event.kind)).map(event => event.role ?? event.kind),
    ['audio', 'delete', 'audio', 'lyrics', 'cover', 'proof', 'next', 'confirm']);
});

test('directory audio accepts a verified receipt after the former two-minute deadline', {timeout: 30_000}, async t => {
  let offset = 0;
  let clockJump;
  t.after(() => clearTimeout(clockJump));
  const executeWithClock = await loadDirectoryForm({now: () => performance.now() + offset});
  const {context, first, site, callbacks} = await setup(t, {
    audioReceiptDelay: 2_000,
    beforeEvent(event) {
      if (event.kind === 'file' && event.role === 'audio') {
        clockJump = setTimeout(() => { offset = 130_000; }, 600);
      }
      if (event.kind === 'receipt' && event.role === 'audio') assert.equal(offset, 130_000);
    },
  });
  await executeWithClock(context, [first], callbacks);
  assert.deepEqual(site.events.filter(event => event.role === 'audio').map(event => event.kind), ['file', 'receipt']);
  assert.deepEqual(site.events.filter(event => ['next', 'confirm'].includes(event.kind)).map(event => event.kind), ['next', 'confirm']);
});

test('directory audio cancels promptly while its receipt is still pending', {timeout: 15_000}, async t => {
  let stopped = false;
  const {context, first, site, callbacks, timeline} = await setup(t, {
    audioReceiptDelay: 10_000,
    beforeEvent(event) {
      if (event.kind === 'file' && event.role === 'audio') stopped = true;
    },
  });
  await assert.rejects(execute(context, [first], {...callbacks, guard() {
    if (stopped) throw Error('STOP_REQUESTED');
  }}), /STOP_REQUESTED/);
  assert.deepEqual(site.events.filter(event => ['file', 'receipt', 'next', 'confirm'].includes(event.kind)).map(event => event.kind), ['file']);
  assert.ok(timeline.some(event => event.step === 'upload:audio' && event.phase === 'error'));
});

test('directory audio times out at the ten-minute limit if its receipt never arrives', {timeout: 15_000}, async t => {
  let offset = 0;
  const jumps = [];
  t.after(() => jumps.forEach(clearTimeout));
  const executeWithClock = await loadDirectoryForm({now: () => performance.now() + offset});
  const {context, first, site, callbacks} = await setup(t, {
    audioReceiptDelay: 10_000,
    beforeEvent(event) {
      if (event.kind !== 'file' || event.role !== 'audio') return;
      jumps.push(setTimeout(() => { offset = 590_000; }, 600));
      jumps.push(setTimeout(() => { offset = 600_000; }, 1_300));
    },
  });
  await assert.rejects(executeWithClock(context, [first], callbacks), /FANQIE_UPLOAD_READBACK_TIMEOUT/);
  assert.equal(offset, 600_000, 'the waiter survives the first jump and stops only at its ten-minute limit');
  assert.deepEqual(site.events.filter(event => ['file', 'receipt', 'next', 'confirm'].includes(event.kind)).map(event => event.kind), ['file']);
});

test('directory audio polls the plan stop state before a pending receipt arrives', {timeout: 15_000}, async t => {
  let fileSent = false;
  const checks = [];
  const {context, first, site, callbacks, timeline} = await setup(t, {
    audioReceiptDelay: 5_000,
    beforeEvent(event) {
      if (event.kind === 'file' && event.role === 'audio') fileSent = true;
    },
  });
  await assert.rejects(execute(context, [first], {...callbacks, async checkStopped() {
    if (!fileSent) return;
    checks.push(performance.now());
    if (checks.length === 2) throw Error('STOP_REQUESTED');
  }}), /STOP_REQUESTED/);
  assert.equal(checks.length, 2);
  assert.ok(checks[1] - checks[0] >= 1_900, 'stop lookups are spaced instead of running every receipt poll');
  assert.deepEqual(site.events.filter(event => ['file', 'receipt', 'next', 'confirm'].includes(event.kind)).map(event => event.kind), ['file']);
  assert.ok(timeline.some(event => event.step === 'upload:audio' && event.phase === 'error'));
});

test('native directory form refuses extra virtual slots outside the mounted window', {timeout: 30_000}, async t => {
  const {context, first, site, callbacks} = await setup(t, {virtualized: true, extraVirtualCards: 8});
  await assert.rejects(execute(context, [first], callbacks), /FANQIE_SONG_COUNT_UNVERIFIED/);
  assert.deepEqual(site.events.filter(event => event.kind !== 'viewport').map(event => event.kind), ['add']);
});

test('native directory form rereads a virtual card changed after Next before confirming the group', {timeout: 60_000}, async t => {
  const {context, songs, site, callbacks} = await setup(t, {virtualized: true, tamperAfterNext: true});
  await assert.rejects(execute(context, songs, callbacks), /FANQIE_METADATA_READBACK_REQUIRED/);
  assert.deepEqual(site.events.filter(event => ['next', 'confirm'].includes(event.kind)).map(event => event.kind), ['next']);
});

test('native directory form refuses an ambiguous add control shared by two forms', {timeout: 30_000}, async t => {
  const {context, first, site, callbacks} = await setup(t, {duplicateForm: true});
  await assert.rejects(execute(context, [first], callbacks), /FANQIE_ADD_SONG_CONTROL_UNVERIFIED/);
  assert.deepEqual(site.events, []);
});

test('native directory form stops when the editor is replaced at the same URL before an add', {timeout: 30_000}, async t => {
  const {context, first, site, callbacks} = await setup(t, {
    virtualized: true,
    async onIntent(page, step) {
      if (step === 'add-song') await page.locator('.upload-form form').evaluate(form => form.replaceWith(form.cloneNode(true)));
    },
  });
  await assert.rejects(execute(context, [first], callbacks), /FANQIE_FORM_UNVERIFIED/);
  assert.deepEqual(site.events, []);
});

test('native directory form refuses a second card mounted in a different form', {timeout: 120_000}, async t => {
  const {context, first, second, timeline, site, callbacks} = await setup(t, {splitForms: true});
  await assert.rejects(execute(context, [first, second], callbacks), /FANQIE_SONG_COUNT_UNVERIFIED/);
  assert.deepEqual(site.events.filter(event => ['add', 'next', 'confirm'].includes(event.kind)).map(event => [event.kind, event.index]), [['add', 0], ['add', 1]]);
  assert.equal(site.events.some(event => event.kind === 'file' && event.index === 1), false);
  assert.ok(timeline.some(event => event.phase === 'error' && event.step === 'add-song' && event.songIndex === 1));
});

test('native directory form stops when a visible audio receipt belongs to a different file', {timeout: 30_000}, async t => {
  const {context, first, timeline, site, callbacks} = await setup(t, {mismatchedAudio: true});
  await assert.rejects(execute(context, [first], callbacks), /FANQIE_UPLOAD_READBACK_REQUIRED/);
  assert.deepEqual(site.events.filter(event => ['file', 'title', 'confirm'].includes(event.kind)).map(event => event.role), ['audio']);
  assert.ok(timeline.some(event => event.phase === 'error' && event.step === 'upload:audio' && event.songIndex === 0));
});

test('native directory form sends no bytes when the audio control triggers another role’s chooser', {timeout: 30_000}, async t => {
  const {context, first, timeline, site, callbacks} = await setup(t, {wrongChooser: true});
  await assert.rejects(execute(context, [first], callbacks), /FANQIE_FILE_CHOOSER_SCOPE_CHANGED/);
  assert.equal(site.events.some(event => event.kind === 'file'), false);
  assert.ok(timeline.some(event => event.phase === 'error' && event.step === 'upload:audio' && event.songIndex === 0));
});

test('native directory form sends no bytes to a pre-existing chooser with the same accept list', {timeout: 30_000}, async t => {
  const {context, first, site, callbacks} = await setup(t, {staleChooser: true});
  await assert.rejects(execute(context, [first], callbacks), /FANQIE_FILE_CHOOSER_SCOPE_CHANGED/);
  assert.equal(site.events.some(event => ['file', 'wrong-file'].includes(event.kind)), false);
});

test('native directory form stops on a failed cover even after a local preview appears', {timeout: 30_000}, async t => {
  const {context, first, second, site, timeline, callbacks} = await setup(t, {coverFailure: true});
  await assert.rejects(execute(context, [first, second], callbacks), /FANQIE_COVER_UPLOAD_FAILED/);
  assert.deepEqual(site.events.filter(event => event.kind === 'file').map(event => event.role), ['audio', 'lyrics', 'cover']);
  assert.deepEqual(site.events.filter(event => ['add', 'next'].includes(event.kind)).map(event => event.kind), ['add']);
  assert.ok(timeline.some(event => event.phase === 'error' && event.step === 'upload:cover' && event.songIndex === 0));
});

test('native directory form rechecks account UID before the next file chooser', {timeout: 30_000}, async t => {
  let uid = scope.accountId;
  const {context, first, second, timeline, site, callbacks} = await setup(t, {
    account: () => uid,
    beforeEvent(event) { if (event.kind === 'receipt' && event.role === 'audio') uid = '87654321'; },
  });
  await assert.rejects(execute(context, [first, second], callbacks), /FANQIE_CATALOG_SCOPE_CHANGED/);
  assert.deepEqual(site.events.filter(event => ['file', 'confirm'].includes(event.kind)).map(event => event.role), ['audio']);
  assert.ok(timeline.some(event => event.phase === 'error' && event.step === 'upload:lyrics' && event.songIndex === 0));
});

test('native directory form reports an incorrect authorization group and never repeats confirmation', {timeout: 120_000}, async t => {
  const {context, first, second, timeline, site, callbacks} = await setup(t, {changeTitle: true});
  await assert.rejects(execute(context, [first, second], callbacks), /FANQIE_AUTHORIZATION_WORK_MISMATCH/);
  assert.deepEqual(site.events.filter(event => ['next', 'confirm', 'sign'].includes(event.kind)).map(event => event.kind), ['next', 'confirm']);
  assert.ok(timeline.some(event => event.phase === 'error' && event.step === 'first-step:authorization-readback'));
  assert.equal(timeline.filter(event => event.kind === 'intent' && event.step === 'first-step:confirm-upload').length, 1);
});
