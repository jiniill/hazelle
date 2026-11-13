import { useEffect, useReducer, type RefObject } from 'react';

// wants: what folds the composer (the story scrolled away from its end, a message edited on a phone). opened: a press,
// a focus or a key in the composer, which holds it open, typed text and all, until the next fold begins.
export type Fold = { wants: boolean; opened: boolean };
export type FoldEvent = 'open' | 'read' | { wants: boolean };

export function nextFold(fold: Fold, event: FoldEvent): Fold {
  if (event === 'open') return fold.opened ? fold : { ...fold, opened: true };
  if (event === 'read') return fold.opened ? { ...fold, opened: false } : fold;
  if (event.wants === fold.wants) return fold;
  return { wants: event.wants, opened: fold.opened && !event.wants };
}

export const folds = ({ wants, opened }: Fold) => wants && !opened;

export type ComposerFold = { folded: boolean; open: () => void };

// The reader moving the story folds it again; by gestures, not scroll events, since the keyboard opening and the
// composer growing scroll the story too.
export function useComposerFold(wants: boolean, scrollRef: RefObject<HTMLElement | null>): ComposerFold {
  const [fold, dispatch] = useReducer(nextFold, { wants, opened: false });
  if (fold.wants !== wants) dispatch({ wants });
  const { opened } = fold;
  useEffect(() => {
    if (!opened) return;
    const scroll = scrollRef.current!;
    const read = () => dispatch('read');
    scroll.addEventListener('wheel', read, { passive: true });
    scroll.addEventListener('touchmove', read, { passive: true });
    return () => {
      scroll.removeEventListener('wheel', read);
      scroll.removeEventListener('touchmove', read);
    };
  }, [opened, scrollRef]);
  return { folded: folds(fold), open: () => dispatch('open') };
}
