import { useCallback, useEffect, useRef, useState } from 'react';

export function useCenterQuery<T>(load: (() => Promise<T>) | null, options?: { key?: string; interval?: number }) {
  const key = options?.key ?? load;
  const interval = options?.interval ?? 4000;
  const [result, setResult] = useState<{ key: typeof key; value?: T; error?: unknown }>();
  const queue = useRef(Promise.resolve());
  const trigger = useRef<(() => Promise<void>) | undefined>(undefined);
  useEffect(() => {
    if (!load) return;
    let mounted = true, requested = 0;
    let timer: ReturnType<typeof setTimeout>;
    const read = () => {
      clearTimeout(timer);
      const order = ++requested;
      const current = () => mounted && order === requested;
      queue.current = queue.current.then(async () => {
        if (!current()) return;
        setResult(previous => previous?.key === key && previous.error ? { ...previous, error: undefined } : previous);
        try {
          const value = await load();
          if (current()) setResult({ key, value });
        } catch (error) {
          if (current()) setResult(previous => ({ key, value: previous?.key === key ? previous.value : undefined, error }));
        } finally {
          if (current() && interval > 0) timer = setTimeout(read, interval);
        }
      });
      return queue.current;
    };
    trigger.current = read;
    void read();
    return () => { mounted = false; clearTimeout(timer); trigger.current = undefined; };
  }, [key, load, interval]);
  const refresh = useCallback(() => trigger.current?.() ?? Promise.resolve(), []);
  const current = load && result?.key === key ? result : undefined;
  return { value: current?.value, error: current?.error, loading: !!load && current?.value === undefined && !current?.error, refresh };
}
