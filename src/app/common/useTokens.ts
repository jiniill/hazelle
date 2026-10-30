import { useEffect, useRef, useState } from 'react';
import { useSession } from '../session';

const EVERY_MS = 1000;

// Estimate live o200k tokens at most once/second, awaiting each count before scheduling another.
// Null before first count; tokenizer failure remains unknown.
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
