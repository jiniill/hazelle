import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { pressOf, SHORTCUTS, typing } from '../shortcuts';
import { isComposing, pressed, storySelection, type SelectionEnd } from '../ui';
import type { PartAt, Typed } from './useMessageEdit';

type SelectedPart = { part: PartAt; end: SelectionEnd; before: string };
type On = { edit: (part: PartAt, typed?: Typed) => void; remove: (part: PartAt) => void };

// The part selected in a story while active, read again as the selection or the view moves; null while what is
// selected is no part find knows. A key typed over it edits it there, and Delete or Backspace removes it.
export function useSelectedPart(story: RefObject<HTMLDivElement | null>, find: (pieces: string[]) => PartAt | null, active: boolean, on: On) {
  const [selected, setSelected] = useState<SelectedPart | null>(null);
  const latest = useRef({ find, on });
  latest.current = { find, on };
  const read = useCallback(() => {
    const selection = story.current && storySelection(story.current);
    const part = selection && latest.current.find(selection.pieces);
    setSelected(part ? { part, end: selection.end, before: selection.before } : null);
  }, [story]);
  useEffect(() => {
    if (!active) return;
    read();
    document.addEventListener('selectionchange', read);
    return () => document.removeEventListener('selectionchange', read);
  }, [active, read]);
  // Scrolling moves a selection's end but never makes or ends one, so only a story holding one reads on scroll: every
  // mounted message reading the page's selection on each scroll event cost a fast scroll on a slow phone.
  const held = active ? selected : null;
  const holding = held !== null;
  useEffect(() => {
    if (!holding) return;
    window.addEventListener('scroll', read, { capture: true, passive: true });
    return () => window.removeEventListener('scroll', read, { capture: true });
  }, [holding, read]);
  const remove = useCallback((part: PartAt) => {
    latest.current.on.remove(part);
    // Left standing, the selection would fall on the lines that close up under it, and a second key take them too.
    document.getSelection()?.removeAllRanges();
  }, []);
  useEffect(() => {
    if (!held) return;
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || typing(event) || isComposing(event) || event.ctrlKey || event.metaKey) return;
      if (pressed(pressOf(event), SHORTCUTS.removePart.keys)) remove(held.part);
      else if ([...event.key].length === 1) latest.current.on.edit(held.part, { before: held.before, key: event.key });
      else return;
      // edit types the key itself; passed on, it could land a second time in the edit box once that takes focus.
      event.preventDefault();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [held, remove]);
  return held && { part: held.part, end: held.end, edit: () => latest.current.on.edit(held.part), remove: () => remove(held.part) };
}
