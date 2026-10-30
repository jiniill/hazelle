import { createContext, useContext, useLayoutEffect, useRef, useSyncExternalStore, type RefObject } from 'react';
import motion from './motion.module.css';

// A row the page does not show this time (a model's capability, a 실험실 switch) must leave no seek for a later page to
// answer, and a lazy page needs time to arrive.
const WAIT_MS = 4000;

let sought: string | null = null;
let giveUp: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const set = (next: string | null) => {
  clearTimeout(giveUp);
  sought = next;
  for (const listener of listeners) listener();
};

// Sends the page to the row or section with this label, once. It is no route: back and a reload do not seek again.
export function seekRow(label: string) {
  set(label);
  giveUp = setTimeout(() => set(null), WAIT_MS);
}

export const useSeeking = () => useSyncExternalStore(subscribe, () => sought !== null, () => false);

// Opens the folds around a row that a seek found inside them.
export const OpenFold = createContext<() => void>(() => {});

export function useSeekRow<E extends HTMLElement>(label: string, block: ScrollLogicalPosition = 'center'): RefObject<E | null> {
  const self = useRef<E>(null);
  const openFold = useContext(OpenFold);
  const here = useSyncExternalStore(subscribe, () => sought === label, () => false);
  useLayoutEffect(() => {
    const row = self.current;
    // Two rows of one label both run in one commit; the first takes it.
    if (!here || !row || sought !== label) return;
    set(null);
    openFold();
    requestAnimationFrame(() => {
      row.scrollIntoView({ block });
      row.classList.add(motion.sought);
      row.addEventListener('animationend', () => row.classList.remove(motion.sought), { once: true });
    });
  }, [here, label, block, openFold]);
  return self;
}
