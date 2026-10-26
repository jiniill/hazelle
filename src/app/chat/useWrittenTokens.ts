import { useEffect, useRef, useState } from 'react';
import { useSession } from '../session';

const EVERY_MS = 1000;

// What a reply wrote so far, in o200k_base tokens, counted again once a second at most while it is shown: the next count
// waits for the last, so a busy worker never queues them. null until first counted; unknown without the tokenizer.
export function useWrittenTokens(texts: string[]): number | 'unknown' | null {
  const { store } = useSession();
  const [written, setWritten] = useState<number | 'unknown' | null>(null);
  const latest = useRef(texts);
  useEffect(() => {
    latest.current = texts;
  });
  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    const count = () =>
      store.evaluation.count(latest.current).then(
        (counts) => {
          if (stopped) return;
          if (!Array.isArray(counts)) return setWritten('unknown');
          setWritten(counts.reduce((sum, tokens) => sum + tokens, 0));
          timer = window.setTimeout(count, EVERY_MS);
        },
        () => !stopped && setWritten('unknown'),
      );
    void count();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [store]);
  return written;
}
