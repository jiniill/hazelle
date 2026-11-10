import { useEffect, useState } from 'react';
import { tokenMs } from './tokenPx';

// The last value that was not waiting, while the one given is: for --duration-wait at most, the time a sign of
// waiting stays hidden too (motion.module.css lateIn). After it the given value shows, waiting or not.
export function useLingering<T>(value: T, waiting: boolean): T {
  const [last, setLast] = useState(value);
  if (!waiting && last !== value) setLast(value);
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => setLast(value), tokenMs('--duration-wait'));
    return () => clearTimeout(timer);
  }, [value, waiting]);
  return waiting ? last : value;
}
