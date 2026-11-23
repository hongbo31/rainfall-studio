import { useCallback, useEffect, useRef, useState } from 'react';

export function useCenterQuery<T>(load: (() => Promise<T>) | null, options?: { key?: string; interval?: number }) {
  const key = options?.key ?? load;
  const interval = options?.interval ?? 4000;
  const [result, setResult] = useState<{ key: typeof key; value?: T; error?: unknown }>();
  const trigger = useRef<(() => Promise<void>) | undefined>(undefined);
  useEffect(() => {
    if (!load) return;
    let mounted = true;
    let latestRefresh = 0;
    let automaticQueued = false;
    let queue = Promise.resolve();
    let timer: ReturnType<typeof setTimeout>;
    const visible = () => document.visibilityState !== 'hidden';
    const read = (automatic = false) => {
      clearTimeout(timer);
      if (automatic && automaticQueued) return queue;
      if (automatic) automaticQueued = true;
      // An automatic refresh can wait behind a read without invalidating its response.
      const order = automatic ? latestRefresh : ++latestRefresh;
      const current = () => mounted && order === latestRefresh;
      queue = queue.then(async () => {
        if (automatic) automaticQueued = false;
        if (!current() || (automatic && !visible())) return;
        clearTimeout(timer);
        setResult(previous => previous?.key === key && previous.error ? { ...previous, error: undefined } : previous);
        try {
          const value = await load();
          if (current()) setResult({ key, value });
        } catch (error) {
          if (current()) setResult(previous => ({ key, value: previous?.key === key ? previous.value : undefined, error }));
        } finally {
          if (current() && interval > 0 && visible()) timer = setTimeout(() => void read(true), interval);
        }
      });
      return queue;
    };
    const visibilityChanged = () => {
      clearTimeout(timer);
      if (visible()) void read(true);
    };
    if (interval > 0) document.addEventListener('visibilitychange', visibilityChanged);
    trigger.current = read;
    void read();
    return () => {
      mounted = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', visibilityChanged);
      trigger.current = undefined;
    };
  }, [key, load, interval]);
  const refresh = useCallback(() => trigger.current?.() ?? Promise.resolve(), []);
  const current = load && result?.key === key ? result : undefined;
  return { value: current?.value, error: current?.error, loading: !!load && current?.value === undefined && !current?.error, refresh };
}
