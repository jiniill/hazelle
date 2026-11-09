import { useEffect, useLayoutEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import { ChangeSignal } from '../../../change-signal';
import { isComposing } from '../foundation/keys';
import { hasFinePointer } from '../foundation/media';

type Layer = {
  outside: (target: Node) => boolean;
  // refocus: closed by Esc, so the focus goes back to where the layer was opened. A press outside leaves the
  // focus where it pressed. Absent while it cannot close (a file being read or saved): Esc, a press outside and a back
  // leave it standing.
  close?: (refocus: boolean) => void;
  // Opt-in: a hover peek must write no history, and a sidebar that stands as long as its page is no overlay to back out of.
  takesBack?: true;
  // A step back inside the layer under it, named by where it stands (a covering panel's open part): only a back
  // takes it, Esc and presses go to that layer. A new name joins anew, so each step has an entry for its back.
  step?: string;
};

// Centralize document key/press listeners; only the newest layer that is no step handles outside/Esc.
// Components must not add parallel listeners that close multiple layers per action.
// Each layer's latest props, so whether it can close is read at the press.
const open: { current: Layer }[] = [];
const changes = new ChangeSignal();
const backing = () => open.filter((layer) => layer.current.takesBack);
const pressed = () => open.findLast((layer) => layer.current.step === undefined)?.current;

// What the router asks, since the kit may not import it (shell/router.ts holdBack, wired in Layout).
export const backLayers = {
  count: () => backing().length,
  // refocus, as Esc: a covering panel's press outside waits for a click that a back never brings.
  // One that cannot close stops the walk down and asks the router for its entry back.
  closeAbove: (keep: number) => {
    for (const { current } of backing().slice(keep).reverse()) {
      if (!current.close) return changes.notify();
      current.close(true);
    }
  },
  subscribe: changes.subscribe,
};

function press(event: PointerEvent) {
  const top = pressed();
  if (top?.close && top.outside(event.target as Node)) top.close(false);
}

// An Esc a focused field already took (응답 멈추기 in the composer, 수정 취소 in the edit box) closes nothing: one
// press does one thing.
function key(event: KeyboardEvent) {
  const top = pressed();
  if (!top || event.key !== 'Escape' || event.defaultPrevented || isComposing(event)) return;
  event.preventDefault();
  top.close?.(true);
}

export function useLayer(active: boolean, layer: Layer) {
  const latest = useRef(layer);
  latest.current = layer;
  useEffect(() => {
    if (!active) return;
    if (open.length === 0) {
      document.addEventListener('pointerdown', press);
      document.addEventListener('keydown', key);
    }
    open.push(latest);
    changes.notify();
    return () => {
      open.splice(open.indexOf(latest), 1);
      changes.notify();
      if (open.length > 0) return;
      document.removeEventListener('pointerdown', press);
      document.removeEventListener('keydown', key);
    };
  }, [active, layer.step]);
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

export const menuEdge = (element: HTMLElement) => parseFloat(getComputedStyle(element).getPropertyValue('--menu-edge'));

export function keepOnScreen(element: HTMLElement) {
  // Measured unshifted: --nudge inherits, so a popover inside another would otherwise start from the outer one's shift.
  element.style.setProperty('--nudge', '0px');
  const box = element.getBoundingClientRect();
  const edge = menuEdge(element);
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
    // Inside the modal window it was opened from (a dialog, 설정), not only the screen: below the window's foot it
    // would hang over the scrim. It goes above only where there is more room there.
    const frame = anchor.current!.closest('[aria-modal="true"]')?.getBoundingClientRect();
    const top = Math.max(0, frame?.top ?? 0);
    const bottom = Math.min(window.innerHeight, frame?.bottom ?? Infinity);
    if (element.getBoundingClientRect().bottom > bottom && at.top - top > bottom - at.bottom) element.dataset.flipped = '';
  }, [open, popover, anchor]);
  useEffect(() => {
    if (!open) return;
    const scrolled = () => latest.current();
    window.addEventListener('scroll', scrolled, { capture: true, passive: true });
    return () => window.removeEventListener('scroll', scrolled, { capture: true });
  }, [open]);
}

export const TAB_STOPS = 'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';

// A place to type comes before the buttons, the head's × first among them; but under a finger not a search, whose
// keyboard would cover what it searches.
export const openingField = (fine: boolean) => `input:not(:disabled, [type="checkbox"]${fine ? '' : ', [type="search"]'}), textarea:not(:disabled)`;

export const openingStop = (box: ParentNode, fine: boolean) =>
  box.querySelector<HTMLElement>('[data-autofocus]') ?? box.querySelector<HTMLElement>(openingField(fine)) ?? box.querySelector<HTMLElement>('button');

// A box itself marked data-autofocus opens on itself: a panel to read, whose first field would raise a phone's keyboard.
export function useFocusTrap(box: RefObject<HTMLElement | null>, active = true) {
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const element = box.current;
    if (!active || !element) return;
    // Kept across a run again over the same box (StrictMode's), which finds the focus already inside.
    if (!element.contains(document.activeElement)) opener.current = document.activeElement as HTMLElement | null;
    const aim = () => (element.hasAttribute('data-autofocus') ? element : openingStop(element, hasFinePointer()))?.focus();
    aim();
    // The control the focus was last in going away or turning disabled (a step changed in place) drops the focus to
    // the body, and the opening rule takes it back in. One dropped there by a press on the box's text stays.
    let held = element.contains(document.activeElement) ? document.activeElement : null;
    const hold = (event: FocusEvent) => {
      held = event.target as Element;
    };
    const watch = new MutationObserver(() => {
      if (document.activeElement === document.body && !(held?.isConnected && !held.matches(':disabled'))) aim();
    });
    element.addEventListener('focusin', hold);
    watch.observe(element, { subtree: true, childList: true, attributeFilter: ['disabled'] });
    return () => {
      element.removeEventListener('focusin', hold);
      watch.disconnect();
      // Given back unless it went on elsewhere, such as to a control pressed outside a covering panel.
      if (document.activeElement === document.body) opener.current?.focus();
    };
  }, [box, active]);
  return (event: ReactKeyboardEvent) => {
    // A Tab the focused control took (the code editor's indent and completion) moves nothing.
    if (!active || event.key !== 'Tab' || event.defaultPrevented || !box.current) return;
    const stops = [...box.current.querySelectorAll<HTMLElement>(TAB_STOPS)];
    const edge = event.shiftKey ? stops[0] : stops.at(-1);
    if (document.activeElement !== edge) return;
    event.preventDefault();
    (event.shiftKey ? stops.at(-1) : stops[0])?.focus();
  };
}
