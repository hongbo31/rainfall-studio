import type {Locator, Page} from 'playwright-core';
import type {FanqieAsset, FanqieRole} from '../../shared/fanqie';
import {chooseFanqieFile} from './form';

export type DirectoryFileRole = FanqieRole | 'proof';

const acceptByRole: Record<DirectoryFileRole, string> = {
  audio: '.wav,.mp3',
  lyrics: '.txt',
  cover: 'image/png,image/jpeg',
  proof: '.zip,.jpeg,.jpg,.png,.bmp,.pdf',
};

export async function chooseDirectoryFile(page: Page, area: Locator, control: Locator, role: DirectoryFileRole,
  asset: FanqieAsset, assertCurrentScope: () => Promise<void>) {
  const owner = await area.elementHandle();
  try {
    const binding = await control.evaluateHandle((trigger, {area, accept}) => {
      if (window !== window.top || !area.contains(trigger)) throw Error('FANQIE_UPLOAD_CONTROL_UNVERIFIED');

      const normalizedAccept = (value: string) => value.toLowerCase().split(',').map(part => part.trim()).sort().join(',');
      const expectedAccept = normalizedAccept(accept);
      let activation: MouseEvent | undefined;
      let existing: Set<Element> | undefined;
      const opened = new Set<HTMLInputElement>();
      const capture = (event: MouseEvent) => {
        if (event.isTrusted && event.composedPath().includes(trigger)) {
          activation = event;
          existing = new Set(document.body.querySelectorAll(':scope > input[type="file"]'));
        }
        // The official uploader appends a temporary input to body and clicks it synchronously
        // from the selected control. A stale input elsewhere on the page cannot prove ownership.
        const input = event.target;
        if (activation && activation.eventPhase !== Event.NONE && input instanceof HTMLInputElement &&
            input.type === 'file' && input.parentElement === document.body && !existing?.has(input)) opened.add(input);
      };
      document.addEventListener('click', capture, true);

      return {
        owns(input: Node) {
          if (!(input instanceof HTMLInputElement) || input.type !== 'file' || input.ownerDocument !== document ||
              !area.isConnected || !area.contains(trigger)) return false;
          const acceptMatches = normalizedAccept(input.accept) === expectedAccept;
          if (area.contains(input)) return !input.accept || acceptMatches;
          return acceptMatches && input.parentElement === document.body && opened.size === 1 && opened.has(input);
        },
        stop() { document.removeEventListener('click', capture, true); },
      };
    }, {area: owner, accept: acceptByRole[role]});
    try {
      await chooseFanqieFile({playwright: {async waitForEvent(event, {timeoutMs}) {
        const chooser = await page.waitForEvent(event, {timeout: timeoutMs}).catch(error => {
          throw Error('FANQIE_FILE_CHOOSER_TIMEOUT', {cause: error});
        });
        const input = chooser.element();
        const assertOwner = async () => {
          if (!await binding.evaluate((session, element) => session.owns(element), input).catch(() => false))
            throw Error('FANQIE_FILE_CHOOSER_SCOPE_CHANGED');
        };
        await assertOwner();
        return {isMultiple: () => chooser.isMultiple(), async setFiles(files) {
          await assertOwner();
          await chooser.setFiles(files).catch(error => {throw Error('FANQIE_FILE_TRANSFER_FAILED', {cause: error});});
        }};
      }}}, control, asset, assertCurrentScope);
    } finally {
      await binding.evaluate(session => session.stop()).catch(() => {});
      await binding.dispose().catch(() => {});
    }
  } finally {
    await owner.dispose().catch(() => {});
  }
}

/** Read the uploader's row, even when its upload prompt remains visible beside it. */
export async function directoryFileReceipt(area: Locator) {
  const rows = area.locator('[class*="upload-list-item-"]').filter({
    has: area.page().locator('[class*="main-detail-info-content-status-"]'), visible: true,
  });
  const receipts = await rows.evaluateAll(elements => elements.map(row => ({
    names: [...row.querySelectorAll('[class*="main-detail-info-content-name-"]')].map(node => node.textContent?.trim() ?? ''),
    statuses: [...row.querySelectorAll('[class*="main-detail-info-content-status-"]')].map(node => node.textContent?.trim() ?? ''),
  })));
  if (receipts.length === 0) return '';
  const [{names, statuses}] = receipts;
  if (receipts.length !== 1 || names.length !== 1 || statuses.length !== 1) throw Error('FANQIE_UPLOAD_READBACK_REQUIRED');
  return names[0] + '\n' + statuses[0];
}
