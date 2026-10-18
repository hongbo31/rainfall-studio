import type { PublishSelection } from "../shared/platform-config";

export function createSelectionWriter(
  write: (selection: PublishSelection) => Promise<unknown>,
) {
  let pending: Promise<unknown> = Promise.resolve();
  return {
    enqueue(selection: PublishSelection) {
      const captured: PublishSelection = {
        workIds: [...selection.workIds],
        targets: [...selection.targets],
        accountOverrides: { ...selection.accountOverrides },
      };
      pending = pending.catch(() => {}).then(() => write(captured));
      return pending;
    },
    flush() {
      return pending;
    },
  };
}
