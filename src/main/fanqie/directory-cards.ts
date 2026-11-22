import {setTimeout as delay} from 'node:timers/promises';
import type {Locator} from 'playwright-core';

export const addSongCaption = '点击添加歌曲';
export const songNameLabel = 'label[for^="songs_"][for$="_name_input"]';
const renderTimeout = 15_000;
const pollInterval = 35;
const visible = (locator: Locator) => locator.filter({visible: true});

/** Bind DOM reads and virtual scrolling to the same form that owned the fresh Add control. */
export async function bindDirectoryCards(add: Locator, assertScope: () => void) {
  const page = add.page();
  const form = visible(page.locator('form').filter({has: page.getByText(addSongCaption, {exact: true})}));
  if (await form.count() !== 1) throw Error('FANQIE_FORM_UNVERIFIED');
  assertScope();
  const binding = await add.evaluateHandle((control, {url, nameLabel}) => {
    const root = control.closest('form');
    if (!root || window !== window.top || location.href !== url) throw Error('FANQIE_FORM_UNVERIFIED');
    const addSection = control.closest('.add-song-section');
    const footer = addSection?.parentElement;
    const candidate = footer?.parentElement;
    const trackCandidate = footer?.previousElementSibling;
    const viewport = candidate && root.contains(candidate) && trackCandidate instanceof HTMLElement &&
      /^(auto|scroll)$/u.test(getComputedStyle(candidate).overflowY) && getComputedStyle(trackCandidate).position === 'relative' ? candidate : null;
    const track = viewport ? trackCandidate as HTMLElement : null;
    const verifyOwner = () => {
      if (location.href !== url || !root.isConnected || !root.getClientRects().length || control.closest('form') !== root ||
          (viewport && (!root.contains(viewport) || footer?.parentElement !== viewport || footer.previousElementSibling !== track ||
            control.closest('.add-song-section') !== addSection || addSection?.parentElement !== footer)))
        throw Error('FANQIE_FORM_UNVERIFIED');
    };
    const invalidCount = () => {throw Error('FANQIE_SONG_COUNT_UNVERIFIED');};
    return {
      verifyOwner,
      rows(expected: number) {
        verifyOwner();
        const labels = [...document.querySelectorAll(nameLabel)];
        const names = labels.map(label => label.getAttribute('for'));
        if (new Set(names).size !== labels.length || labels.some(label => label.closest('form') !== root)) invalidCount();
        if (!viewport || !track) {
          if (labels.length > expected || names.some((name, index) => name !== `songs_${index}_name_input`)) invalidCount();
          return {virtual: false as const, count: labels.length};
        }
        // The official list exposes a relative track with absolutely positioned, numbered song rows.
        // Its DOM window can contain only a subset of the songs, including extra rows outside the view.
        const cards = [...track.children];
        const indexes = cards.map(card => {
          const value = card.getAttribute('data-index') ?? '';
          const index = Number(value);
          const header = card.querySelectorAll(':scope > .song-item > .song-header > .name');
          if (!/^(0|[1-9]\d*)$/u.test(value) || index >= expected || header.length !== 1 ||
              !new RegExp(`^歌曲\\s*${index + 1}\\s*[:：]`, 'u').test(header[0].textContent?.trim() ?? '')) invalidCount();
          return index;
        });
        if (indexes.some((index, i) => i > 0 && indexes[i - 1] >= index) || labels.some(label => {
          const card = label.closest('[data-index]');
          return card?.parentElement !== track || label.getAttribute('for') !== `songs_${card.getAttribute('data-index')}_name_input`;
        })) invalidCount();
        const headers = document.querySelectorAll('.song-header');
        if ([...headers].some(header => header.closest('form') !== root || header.closest('[data-index]')?.parentElement !== track)) invalidCount();

        const view = viewport.getBoundingClientRect();
        const bounds = cards.map(card => card.getBoundingClientRect());
        const trackBounds = track.getBoundingClientRect();
        const firstInView = bounds.findIndex(bounds => bounds.bottom > view.top && bounds.top < view.bottom);
        const tail = bounds.at(-1);
        // Require the last rendered row to reach the track's end as well as scrolling to the footer.
        // This avoids treating a stale render window as the last row after the viewport moves.
        const endRendered = tail ? Math.abs(tail.bottom - trackBounds.bottom) <= 2 : trackBounds.height <= 2;
        return {
          virtual: true as const, indexes, firstInView: indexes[firstInView], endRendered,
          position: viewport.scrollTop, end: Math.max(0, viewport.scrollHeight - viewport.clientHeight),
        };
      },
      scroll(direction: 'start' | 'end' | 'forward' | 'backward') {
        verifyOwner();
        if (!viewport) return;
        const step = Math.max(1, viewport.clientHeight * 0.9);
        const top = direction === 'start' ? 0 : direction === 'end' ? viewport.scrollHeight :
          viewport.scrollTop + (direction === 'forward' ? step : -step);
        viewport.scrollTo({top, behavior: 'instant'});
      },
    };
  }, {url: page.url(), nameLabel: songNameLabel});

  const assertCurrent = async () => {
    assertScope();
    await binding.evaluate(editor => editor.verifyOwner());
    if (await add.count() !== 1 || await form.count() !== 1) throw Error('FANQIE_FORM_UNVERIFIED');
    assertScope();
  };
  const rows = async (expected: number) => {
    await assertCurrent();
    const state = await binding.evaluate((editor, count) => editor.rows(count), expected);
    assertScope();
    return state;
  };
  const scroll = async (direction: 'start' | 'end' | 'forward' | 'backward') => {
    assertScope();
    await binding.evaluate((editor, value) => editor.scroll(value), direction);
    assertScope();
  };

  return {
    form,
    assertCurrent,
    start: () => scroll('start'),
    dispose: () => binding.dispose(),
    async count(expected: number, justAdded = false) {
      const deadline = performance.now() + renderTimeout;
      do {
        const state = await rows(expected);
        if (!state.virtual || (state.end - state.position <= 1 && state.endRendered)) {
          const actual = state.virtual ? (state.indexes.at(-1) ?? -1) + 1 : state.count;
          if (actual === expected) return;
          if (!justAdded) break;
        }
        if (state.virtual && state.end - state.position > 1) await scroll('end');
        await delay(pollInterval);
      } while (performance.now() < deadline);
      throw Error('FANQIE_SONG_COUNT_UNVERIFIED');
    },
    async requireMounted(index: number, expected: number) {
      const state = await rows(expected);
      if (state.virtual ? !state.indexes.includes(index) : state.count !== expected) throw Error('FANQIE_SONG_COUNT_UNVERIFIED');
    },
    async card(index: number, expected: number) {
      const label = page.locator(`label[for="songs_${index}_name_input"]`);
      const indexed = form.locator(`[data-index="${index}"]`).filter({has: label});
      const content = form.locator('.song-content').filter({has: label});
      const deadline = performance.now() + renderTimeout;
      do {
        const state = await rows(expected);
        if (!state.virtual) {
          if (state.count !== expected) throw Error('FANQIE_SONG_COUNT_UNVERIFIED');
          const card = visible(await indexed.count() ? indexed : content);
          if (await card.count() === 1 && await card.locator(songNameLabel).count() === 1) return card;
          if (index === 0 && expected === 1 && !await indexed.count() && !await content.count() && await visible(form.locator(label)).count() === 1)
            return form;
          break;
        }
        if (state.indexes.includes(index)) {
          const card = visible(indexed.locator(':scope > .song-item > .song-content'));
          if (await card.count() === 1 && await visible(card.locator(label)).count() === 1) return card;
        } else if (state.firstInView !== undefined) {
          const backward = index < state.firstInView;
          if ((backward && state.position > 1) || (!backward && state.end - state.position > 1))
            await scroll(backward ? 'backward' : 'forward');
        }
        await delay(pollInterval);
      } while (performance.now() < deadline);
      throw Error('FANQIE_SONG_CARD_UNVERIFIED');
    },
  };
}
