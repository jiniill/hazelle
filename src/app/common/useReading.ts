import { useState } from 'react';
import { readingDefault, type Letters, type Reading, type Theme } from '../ui';
import { lettersKey, lettersOf, parseLetters, parseReading, READING } from './reading';
import { readPersisted, usePersisted } from './usePersisted';

// What the reader reads in while wearing theme. A theme that states letters keeps them and the reader's changes to
// them in a record of its own, so 기본's are as they were left on the way back; 응답 수신 시 is one value in every theme.
export function useReading(theme: Theme) {
  const [initial] = useState(readingDefault);
  const [own, setOwn] = usePersisted(READING, (stored) => parseReading(stored, initial), initial);
  const first = theme.letters ?? lettersOf(initial);
  const [themed, setThemed] = usePersisted(lettersKey(theme), (stored) => parseLetters(stored, first), first);
  const reading: Reading = theme.letters ? { ...themed, reply: own.reply } : own;
  const setReading = (next: Reading) => {
    if (!theme.letters) return setOwn(next);
    setThemed(lettersOf(next));
    setOwn({ ...own, reply: next.reply });
  };
  // Another theme's, for its card: the record it would wear.
  const lettersIn = (other: Theme): Letters => (other === theme ? reading : other.letters ? readPersisted(lettersKey(other), (stored) => parseLetters(stored, other.letters!), other.letters) : own);
  return { reading, setReading, first, lettersIn };
}
