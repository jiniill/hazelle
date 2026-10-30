import { useEffect, useRef, useState } from 'react';
import { useSession } from '../session';

const EVERY_MS = 1000;
const same = (a: string[], b: string[]) => a.length === b.length && a.every((text, index) => text === b[index]);

// Estimate live o200k tokens at most once/second, awaiting each count before scheduling another; unchanged text is not
// counted again. Null before first count; tokenizer failure remains unknown.
export function useTokens(texts: string[]): number | 'unknown' | null {
  const { store } = useSession();
  const [written, setWritten] = useState<number | 'unknown' | null>(null);
  const latest = useRef(texts);
  useEffect(() => {
    latest.current = texts;
  });
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let counted: string[] | null = null;
    const count = () => {
      const asked = latest.current;
      if (counted && same(counted, asked)) {
        timer = setTimeout(count, EVERY_MS);
        return;
      }
      void store.evaluation.count(asked).then(
        (counts) => {
          if (stopped) return;
          if (!Array.isArray(counts)) return setWritten('unknown');
          counted = asked;
          setWritten(counts.reduce((sum, tokens) => sum + tokens, 0));
          timer = setTimeout(count, EVERY_MS);
        },
        () => !stopped && setWritten('unknown'),
      );
    };
    count();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [store]);
  return written;
}
