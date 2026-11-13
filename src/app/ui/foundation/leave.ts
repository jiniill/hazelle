import { useCallback, type RefObject } from 'react';

// Once every motion on these elements themselves has ended or been cancelled.
export const afterMotion = (...elements: Element[]) => Promise.allSettled(elements.flatMap((element) => element.getAnimations()).map((animation) => animation.finished));

// A ref callback: what it is on plays its leaving (motion.module.css, data-leaving) after it has left the page. React
// takes it off at once, so focus, layers and presses never wait; the element itself, not a copy, is then put back where
// it stood, inert, until its leaving ends.
export function leaves(given: HTMLElement | null) {
  // React gives null only to a ref that returned no cleanup.
  const element = given!;
  return () => {
    const parent = element.parentNode;
    // Read while it is whole: leaving the page scrolls every part of it back to its top.
    const scrolled = [element, ...element.querySelectorAll('*')].flatMap((part) => (part.scrollTop ? [{ part, top: part.scrollTop }] : []));
    queueMicrotask(() => {
      // Still here: StrictMode's rehearsal. No parent on the page: it went with something bigger, which leaves for both.
      if (element.isConnected || !parent?.isConnected) return;
      element.inert = true;
      element.dataset.leaving = '';
      // What opens next may take the same ids.
      for (const part of [element, ...element.querySelectorAll('[id]')]) part.removeAttribute('id');
      parent.appendChild(element);
      // Put back, it is out of the top layer it was lifted into (layers.ts lift).
      if (element.popover) element.showPopover();
      for (const { part, top } of scrolled) part.scrollTop = top;
      // Its children's too: a ground leaves with the box on it. No deeper: what else moves in there, a demo or a
      // loop, is not its leaving and may never end.
      void afterMotion(element, ...element.children).then(() => element.remove());
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
