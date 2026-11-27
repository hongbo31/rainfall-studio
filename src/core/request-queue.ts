/** Serializes Core mutations while keeping at most one timer tick queued or running. */
export function createCoreRequestQueue() {
  let tail = Promise.resolve();
  let pendingTick: Promise<void> | undefined;

  function enqueue<T>(task: () => T | Promise<T>): Promise<T> {
    const result = tail.then(task);
    // A failed request is returned to its caller without stranding later work.
    tail = result.then(() => undefined, () => undefined);
    return result;
  }

  function tick(task: () => void | Promise<void>): Promise<void> {
    if (!pendingTick) {
      pendingTick = enqueue(task).finally(() => { pendingTick = undefined; });
    }
    return pendingTick;
  }

  return { enqueue, tick };
}
