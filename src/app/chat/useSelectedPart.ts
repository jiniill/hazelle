import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { storySelection, type SelectionEnd } from '../ui';
import type { EditPart } from './useMessageEdit';

type SelectedPart = { part: Omit<EditPart, 'value'>; end: SelectionEnd };

// The part selected in a story while active, read again as the selection or the view moves; null while what is
// selected is no part find knows.
export function useSelectedPart(story: RefObject<HTMLDivElement | null>, find: (pieces: string[]) => SelectedPart['part'] | null, active: boolean) {
  const [selected, setSelected] = useState<SelectedPart | null>(null);
  const latest = useRef(find);
  latest.current = find;
  const read = useCallback(() => {
    const selection = story.current && storySelection(story.current);
    const part = selection && latest.current(selection.pieces);
    setSelected(part ? { part, end: selection.end } : null);
  }, [story]);
  useEffect(() => {
    if (!active) return;
    read();
    document.addEventListener('selectionchange', read);
    return () => document.removeEventListener('selectionchange', read);
  }, [active, read]);
  // Scrolling moves a selection's end but never makes or ends one, so only a story holding one reads on scroll: every
  // mounted message reading the page's selection on each scroll event cost a fast scroll on a slow phone.
  const holding = active && selected !== null;
  useEffect(() => {
    if (!holding) return;
    window.addEventListener('scroll', read, { capture: true, passive: true });
    return () => window.removeEventListener('scroll', read, { capture: true });
  }, [holding, read]);
  return active ? selected : null;
}
