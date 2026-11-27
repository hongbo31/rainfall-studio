/** Coalesces background reads and guarantees a fresh read after a user mutation. */
export function createSnapshotRefresh<T>(read: () => Promise<T>, apply: (snapshot: T) => void) {
  let active: Promise<void> | undefined;
  let queued: Promise<void> | undefined;
  let requested = 0;
  let previous: string | undefined;

  function start() {
    const revision = requested;
    const request = Promise.resolve().then(read).then(snapshot => {
      if (revision !== requested) return;
      const serialized = JSON.stringify(snapshot);
      if (serialized !== previous) {
        apply(snapshot);
        previous = serialized;
      }
    }).finally(() => { if (active === request) active = undefined; });
    active = request;
    return request;
  }

  function refresh() {
    requested++;
    if (queued) return queued;
    if (!active) return start();
    // A mutation may finish while the previous snapshot is still travelling back.
    // Wait for that read, then request current state instead of reusing its result.
    queued = active.catch(() => undefined).then(() => {
      queued = undefined;
      return start();
    });
    return queued;
  }

  return { refresh, poll: () => queued ?? active ?? start() };
}
