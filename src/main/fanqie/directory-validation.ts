import type {Locator, Page} from 'playwright-core';

const repairableControls = {
  songFile: 'audio', lyricFile: 'lyrics', name: 'title',
  lyricist_id_list: 'lyricist', composer_id_list: 'composer', singer_id_list: 'singer', coverImage: 'cover',
} as const;

export type DirectoryRepairField = typeof repairableControls[keyof typeof repairableControls];

export const directoryInlineError = '.arco-form-item:is(.arco-form-item-error,.arco-form-item-status-error) :is(.arco-form-message,.arco-form-item-message,[role="alert"]),.arco-form-item-message-error';
export const directoryPageError = '.arco-message-error,.arco-notification-error,.arco-notification:has(.arco-notification-icon-wrapper-error),.arco-alert-error';

export function directoryValidationMessages(root: Page | Locator) {
  return root.locator(directoryInlineError).filter({visible: true, hasText: /\S/u});
}

export async function readDirectoryFieldErrors(root: Locator) {
  const controls = await directoryValidationMessages(root).evaluateAll(nodes => [...new Set(nodes.map(node => {
    const labels = node.closest('.arco-form-item')?.querySelectorAll('label[for^="songs_"]');
    return labels?.length === 1 ? labels[0].getAttribute('for') : null;
  }))]);
  return controls.map(control => {
    const match = /^songs_(0|[1-9]\d*)_(\w+)_input$/u.exec(control ?? '');
    const name = match?.[2] as keyof typeof repairableControls | undefined;
    return {index: match ? Number(match[1]) : -1, field: name && Object.hasOwn(repairableControls, name) ? repairableControls[name] : undefined};
  });
}
