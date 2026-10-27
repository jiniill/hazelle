import { useEffect, useRef, useState } from 'react';

// Tasks return failure text or null; abort on unmount and never display a late answer.
export function useAttempt() {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // Made by the effect: StrictMode runs a mount's cleanup once before the screen is used.
  const life = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    life.current = controller;
    return () => controller.abort();
  }, []);

  async function run(task: (signal: AbortSignal) => Promise<string | null>) {
    const { signal } = life.current!;
    setBusy(true);
    setFailure(null);
    const failed = await task(signal);
    if (signal.aborted) return;
    setBusy(false);
    setFailure(failed);
  }

  return { busy, failure, run, setFailure };
}
