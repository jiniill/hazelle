import { useCallback, type RefObject } from 'react';

const parts = (root: Element) => [root, ...root.querySelectorAll('*')];

// A ref callback: what it is on plays its leaving (motion.module.css, data-leaving) after it has left the page. React
// takes it off at once, so focus, layers and presses never wait; the element itself, not a copy, is then put back where
// it stood, inert, until its leaving ends.
export function leaves(given: HTMLElement | null) {
  // React gives null only to a ref that returned no cleanup.
  const element = given!;
  return () => {
    const parent = element.parentNode;
    // Read while it is whole: leaving the page scrolls every part of it back to its top.
    const scrolled = parts(element).map((part) => part.scrollTop);
    queueMicrotask(() => {
      // Still here: StrictMode's rehearsal. No parent on the page: it went with something bigger, which leaves for both.
      if (element.isConnected || !parent?.isConnected) return;
      element.inert = true;
      element.ariaHidden = 'true';
      element.dataset.leaving = '';
      parent.appendChild(element);
      parts(element).forEach((part, index) => {
        // What opens next may take the same ids.
        part.removeAttribute('id');
        part.scrollTop = scrolled[index]!;
      });
      // Its parts' too: a ground leaves with the box on it. None of them loops (motion.module.css stops the rest).
      void Promise.allSettled(element.getAnimations({ subtree: true }).map((animation) => animation.finished)).then(() => element.remove());
    });
  };
}

export function useLeaves<E extends HTMLElement>(own: RefObject<E | null>) {
  return useCallback(
    (element: E) => {
      own.current = element;
      const left = leaves(element);
      return () => {
        own.current = null;
        left();
      };
    },
    [own],
  );
}
