import { useEffect, useState } from 'react';

const SETTLE_MS = 300;

// What is typed, once typing has stopped this long: words that cost a read (a chat's messages, the server's list) are
// asked for then, not on every key.
export function useSettled<T>(value: T): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [value]);
  return settled;
}
