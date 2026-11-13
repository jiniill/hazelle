import { useEffect, useLayoutEffect, useRef, type FragmentInstance, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import { ChangeSignal } from '../../../change-signal';
import { isComposing } from '../foundation/keys';
import { hasFinePointer } from '../foundation/media';
import { tokenPx } from '../foundation/tokenPx';

type Layer = {
  outside: (target: Node) => boolean;
  // refocus: closed by Esc, so the focus goes back to where the layer was opened. A press outside leaves the
  // focus where it pressed. Absent while it cannot close (a file being read or saved): Esc, a press outside and a back
  // leave it standing.
  close?: (refocus: boolean) => void;
  // Opt-in: a hover peek must write no history, and a sidebar that stands as long as its page is no overlay to back out of.
  takesBack?: true;
  // A step back inside the layer under it, named by where it goes back to (a covering panel's head's back): only a back
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

const screen = () => ({ left: 0, top: 0, right: document.documentElement.clientWidth, bottom: window.innerHeight });

// Into the top layer (a popover's): over every box that clips or stacks what holds it, while it stays in the page where
// it stands, so presses, focus and :focus-within read it as inside its anchor's. Shown once: a run again (StrictMode's)
// finds it shown.
export function lift(element: HTMLElement) {
  if (!element.matches(':popover-open')) element.showPopover();
}

// A lifted box is fixed on the screen: its CSS stands it on these edges of its anchor.
export function anchorTo(element: HTMLElement, anchor: DOMRect) {
  element.style.setProperty('--anchor-left', `${anchor.left}px`);
  element.style.setProperty('--anchor-right', `${document.documentElement.clientWidth - anchor.right}px`);
  element.style.setProperty('--anchor-below', `${anchor.bottom}px`);
  element.style.setProperty('--anchor-above', `${window.innerHeight - anchor.top}px`);
}

// Constrain a box drawn in place to the nearest clipping box AND the viewport; screen bounds alone cannot prevent
// column clipping.
export function room(element: HTMLElement) {
  let { left, top, right, bottom } = screen();
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

// A floating box where it rests: while it grows in (motion.module.css growIn) it is drawn smaller, about its origin.
export function restBox(element: HTMLElement) {
  const box = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const scale = parseFloat(style.scale);
  if (!(scale < 1)) return box;
  const [x, y] = style.transformOrigin.split(' ').map(parseFloat) as [number, number];
  const left = box.left - x * (1 - scale);
  const top = box.top - y * (1 - scale);
  return { left, top, right: left + box.width / scale, bottom: top + box.height / scale };
}

export const menuEdge = (element: HTMLElement) => tokenPx('--menu-edge', element);

export function keepOnScreen(element: HTMLElement) {
  // Measured unshifted: --nudge inherits, so a popover inside another would otherwise start from the outer one's shift.
  element.style.setProperty('--nudge', '0px');
  const box = restBox(element);
  const edge = menuEdge(element);
  const { left, right } = screen();
  const shift = box.left < left + edge ? left + edge - box.left : box.right > right - edge ? right - edge - box.right : 0;
  element.style.setProperty('--nudge', `${shift}px`);
}

// A peek lifted beside its anchor (lift, anchorTo); its CSS flips it by data-flipped on overflow.
// Close on any scroll instead of tracking a now-stale anchor.
export function useAnchored(open: boolean, popover: RefObject<HTMLElement | null>, anchor: RefObject<HTMLElement | null>, close: () => void) {
  const latest = useRef(close);
  latest.current = close;
  useLayoutEffect(() => {
    const element = popover.current;
    const at = anchor.current?.getBoundingClientRect();
    if (!open || !element || !at) return;
    lift(element);
    anchorTo(element, at);
    keepOnScreen(element);
    delete element.dataset.flipped;
    // Inside the modal window it was opened from (a dialog, 설정), not only the screen: past the window's edge it
    // would hang over the scrim. Its CSS sets it below (Hint) or above (MascotRemark); it turns only toward more room.
    const frame = anchor.current!.closest('[aria-modal="true"]')?.getBoundingClientRect();
    const top = Math.max(0, frame?.top ?? 0);
    const bottom = Math.min(window.innerHeight, frame?.bottom ?? Infinity);
    const box = restBox(element);
    const above = at.top - top;
    const below = bottom - at.bottom;
    if (box.top >= at.bottom ? box.bottom > bottom && above > below : box.top < top && below > above) element.dataset.flipped = '';
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

const stopBy = (find: (selector: string) => HTMLElement | null, fine: boolean) => find('[data-autofocus]') ?? find(openingField(fine)) ?? find('button');

export const openingStop = (box: ParentNode, fine: boolean) => stopBy((selector) => box.querySelector<HTMLElement>(selector), fine);

// React 19.3 has it on a fragment's instance; @types/react-dom does not list it yet.
declare module 'react' {
  interface FragmentInstance {
    compareDocumentPosition(node: Node): number;
  }
}

// A fragment's ref that takes the focus by the opening rule as it appears: a list's new row, which has no box of its own
// among its siblings. One function, so a render again does not take the focus again.
export function openingFocus(fragment: FragmentInstance | null) {
  if (!fragment) return;
  const inside = (node: Node) => (fragment.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_CONTAINED_BY) !== 0;
  stopBy((selector) => [...document.querySelectorAll<HTMLElement>(selector)].find(inside) ?? null, hasFinePointer())?.focus();
}

// Focus given back as what took it closes, to back's element, else to what held the focus as it opened: a dialog's
// trap, or something open in place (a pick's bar, the chat's search, a message's edit). Focus that went on elsewhere,
// such as to a control pressed outside a covering panel, stays there.
export function useFocusReturn(open: boolean, back?: () => HTMLElement | null) {
  // Set while open.
  const opening = useRef<{ from: HTMLElement | null } | null>(null);
  const latest = useRef(back);
  latest.current = back;
  const give = () => {
    const focused = document.activeElement;
    if (!opening.current || (focused && focused !== document.body)) return;
    const to = latest.current?.() ?? opening.current.from;
    if (to?.isConnected) to.focus();
  };
  // A layout effect: it reads the opener before what opened takes the focus in its own effect, and finds the focus on
  // BODY once what closed in place has left the page.
  useLayoutEffect(() => {
    if (!open) {
      give();
      opening.current = null;
      return;
    }
    // Kept across a run again (StrictMode's), which finds the focus already moved in.
    opening.current ??= { from: document.activeElement as HTMLElement | null };
  }, [open]);
  // Opened as another closed (a dialog that replaced one), the focus is on BODY until that one gives its own back in
  // its passive cleanup, which runs first: its opener is this one's too.
  useEffect(() => {
    if (open && opening.current?.from === document.body) opening.current.from = document.activeElement as HTMLElement | null;
  }, [open]);
  // Unmounted while open: a passive cleanup, which runs once what took the focus has left the page.
  useEffect(() => () => give(), []);
}

// A box itself marked data-autofocus opens on itself: a panel to read, whose first field would raise a phone's keyboard.
export function useFocusTrap(box: RefObject<HTMLElement | null>, active = true) {
  useFocusReturn(active);
  useEffect(() => {
    const element = box.current;
    if (!active || !element) return;
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
