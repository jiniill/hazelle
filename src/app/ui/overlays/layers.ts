import { useEffect, useLayoutEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import { ChangeSignal } from '../../../change-signal';
import { isComposing } from '../foundation/keys';

type Layer = {
  outside: (target: Node) => boolean;
  // refocus: closed by Esc, so the focus goes back to where the layer was opened. A press outside leaves the
  // focus where it pressed.
  close: (refocus: boolean) => void;
  // Opt-in: a hover peek must write no history, and a sidebar that stands as long as its page is no overlay to back out of.
  takesBack?: true;
};

// Centralize document key/press listeners; only the newest layer handles outside/Esc.
// Components must not add parallel listeners that close multiple layers per action.
const open: Layer[] = [];
const changes = new ChangeSignal();
const backing = () => open.filter((layer) => layer.takesBack);

// What the router asks, since the kit may not import it (shell/router.ts holdBack, wired in Layout).
export const backLayers = {
  count: () => backing().length,
  // refocus, as Esc: a covering panel's press outside waits for a click that a back never brings.
  closeAbove: (keep: number) => {
    for (const layer of backing().slice(keep).reverse()) layer.close(true);
  },
  subscribe: changes.subscribe,
};

function press(event: PointerEvent) {
  const top = open.at(-1);
  if (top?.outside(event.target as Node)) top.close(false);
}

// An Esc a focused field already took (응답 멈추기 in the composer, 수정 취소 in the edit box) closes nothing: one
// press does one thing.
function key(event: KeyboardEvent) {
  const top = open.at(-1);
  if (!top || event.key !== 'Escape' || event.defaultPrevented || isComposing(event)) return;
  event.preventDefault();
  top.close(true);
}

export function useLayer(active: boolean, layer: Layer) {
  const latest = useRef(layer);
  latest.current = layer;
  useEffect(() => {
    if (!active) return;
    const entry: Layer = { outside: (target) => latest.current.outside(target), close: (refocus) => latest.current.close(refocus), takesBack: latest.current.takesBack };
    if (open.length === 0) {
      document.addEventListener('pointerdown', press);
      document.addEventListener('keydown', key);
    }
    open.push(entry);
    changes.notify();
    return () => {
      open.splice(open.indexOf(entry), 1);
      changes.notify();
      if (open.length > 0) return;
      document.removeEventListener('pointerdown', press);
      document.removeEventListener('keydown', key);
    };
  }, [active]);
}

// Constrain popovers to the nearest clipping box AND the viewport; screen bounds alone cannot prevent column clipping.
export function room(element: HTMLElement) {
  let left = 0;
  let top = 0;
  let right = document.documentElement.clientWidth;
  let bottom = window.innerHeight;
  for (let at = element.parentElement; at; at = at.parentElement) {
    if (getComputedStyle(at).overflowX === 'visible') continue;
    const box = at.getBoundingClientRect();
    left = Math.max(left, box.left);
    top = Math.max(top, box.top);
    right = Math.min(right, box.right);
    bottom = Math.min(bottom, box.bottom);
    break;
  }
  return { left, top, right, bottom };
}

export function keepOnScreen(element: HTMLElement) {
  // Measured unshifted: --nudge inherits, so a popover inside another would otherwise start from the outer one's shift.
  element.style.setProperty('--nudge', '0px');
  const box = element.getBoundingClientRect();
  const edge = parseFloat(getComputedStyle(element).getPropertyValue('--menu-edge'));
  const { left, right } = room(element);
  const shift = box.left < left + edge ? left + edge - box.left : box.right > right - edge ? right - edge - box.right : 0;
  element.style.setProperty('--nudge', `${shift}px`);
}

// Portal fixed popovers to body to escape panel clipping. CSS uses anchor edges and data-flipped on overflow.
// Close on any scroll instead of tracking a now-stale anchor.
export function useAnchored(open: boolean, popover: RefObject<HTMLElement | null>, anchor: RefObject<HTMLElement | null>, close: () => void) {
  const latest = useRef(close);
  latest.current = close;
  useLayoutEffect(() => {
    const element = popover.current;
    const at = anchor.current?.getBoundingClientRect();
    if (!open || !element || !at) return;
    element.style.setProperty('--anchor-left', `${at.left}px`);
    element.style.setProperty('--anchor-below', `${at.bottom}px`);
    element.style.setProperty('--anchor-above', `${window.innerHeight - at.top}px`);
    keepOnScreen(element);
    delete element.dataset.flipped;
    const box = element.getBoundingClientRect();
    if (box.top < 0 || box.bottom > window.innerHeight) element.dataset.flipped = '';
  }, [open, popover, anchor]);
  useEffect(() => {
    if (!open) return;
    const scrolled = () => latest.current();
    window.addEventListener('scroll', scrolled, { capture: true, passive: true });
    return () => window.removeEventListener('scroll', scrolled, { capture: true });
  }, [open]);
}

export const TAB_STOPS = 'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';

export function useFocusTrap(box: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const first = box.current?.querySelector<HTMLElement>('[data-autofocus]') ?? box.current?.querySelector<HTMLElement>('input, textarea, button');
    first?.focus();
    return () => opener?.focus();
  }, [box]);
  return (event: ReactKeyboardEvent) => {
    // A Tab the focused control took (the code editor's indent and completion) moves nothing.
    if (event.key !== 'Tab' || event.defaultPrevented || !box.current) return;
    const stops = [...box.current.querySelectorAll<HTMLElement>(TAB_STOPS)];
    const edge = event.shiftKey ? stops[0] : stops.at(-1);
    if (document.activeElement !== edge) return;
    event.preventDefault();
    (event.shiftKey ? stops.at(-1) : stops[0])?.focus();
  };
}
