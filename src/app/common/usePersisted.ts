import { useState } from 'react';

// A per-device convenience remembered in localStorage, such as the folded sidebar. Storage may be refused and an old
// value may not parse, so either way it starts as initial: nothing that must not be lost belongs here.
export function readPersisted<T>(key: string, parse: (stored: string) => T, initial: T): T {
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? initial : parse(stored);
  } catch {
    return initial;
  }
}

export function forgetPersisted(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Refused storage held nothing to forget, or asks again at the next open.
  }
}

export const storedStrings = (stored: string): string[] => {
  const list: unknown = JSON.parse(stored);
  return Array.isArray(list) ? list.filter((each) => typeof each === 'string') : [];
};

// A new key reads its own value, so a list kept mounted while its owner changes shows that owner's.
export function usePersisted<T>(key: string, parse: (stored: string) => T, initial: T, format: (value: T) => string = JSON.stringify): [T, (next: T) => void] {
  const [held, setHeld] = useState(() => ({ key, value: readPersisted(key, parse, initial) }));
  let value = held.value;
  if (held.key !== key) {
    value = readPersisted(key, parse, initial);
    setHeld({ key, value });
  }

  const remember = (next: T) => {
    setHeld({ key, value: next });
    try {
      localStorage.setItem(key, format(next));
    } catch {
      // Kept for this page only.
    }
  };

  return [value, remember];
}
