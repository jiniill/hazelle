import { useLayoutEffect, type RefObject } from 'react';

// Expose border-box height as --autosize. Measure through auto to cancel typing-time transitions;
// add borders because scrollHeight excludes them. mounted: what the area's element is mounted for, where its owner
// can put another in its place: a new element has no height measured.
export function useAutosize(area: RefObject<HTMLTextAreaElement | null>, value: string, mounted?: string) {
  useLayoutEffect(() => {
    const element = area.current;
    if (!element) return;
    element.style.height = 'auto';
    const { borderTopWidth, borderBottomWidth } = getComputedStyle(element);
    element.style.setProperty('--autosize', `${element.scrollHeight + parseFloat(borderTopWidth) + parseFloat(borderBottomWidth)}px`);
    element.style.height = '';
  }, [area, value, mounted]);
}
