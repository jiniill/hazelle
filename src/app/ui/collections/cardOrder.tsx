import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as HeldPointer, type ReactNode, type RefObject } from 'react';
import { scrollAncestor } from './Viewport';

// Use pointer events for touch ordering; restrict moves to the same group, never folders among characters.
export type OrderGroup = 'card' | 'folder';
type Place = (key: string, after: boolean) => void;
export type Over = { key: string; side: 'before' | 'after' };
type Entry = { group: OrderGroup; place: Place };

type CardOrder = {
  held: string | null;
  over: Over | null;
  register: (key: string, entry: Entry) => () => void;
  grab: (key: string, event: HeldPointer) => void;
  step: (key: string, event: KeyboardEvent) => void;
};

const OrderContext = createContext<CardOrder | null>(null);

// Within this far of the scroller's top or bottom edge a held card scrolls it, faster nearer the edge.
const EDGE = 64;
const FASTEST = 18;

// keys: every card of the grid in its order.
export function CardOrderScope({ root, keys, children }: { root: RefObject<HTMLElement | null>; keys: readonly string[]; children: ReactNode }) {
  const entries = useRef(new Map<string, Entry>());
  const [held, setHeld] = useState<string | null>(null);
  const [over, setOver] = useState<Over | null>(null);
  const refocus = useRef<string | null>(null);
  const release = useRef<(() => void) | null>(null);
  useEffect(() => () => release.current?.(), []);

  // A step remounts the rows it changed, so the handle moved is focused again where it now stands.
  useLayoutEffect(() => {
    const key = refocus.current;
    if (key === null) return;
    refocus.current = null;
    root.current?.querySelector<HTMLElement>(`[data-order-key="${CSS.escape(key)}"] [data-order-handle]`)?.focus();
  }, [keys, root]);

  const register = (key: string, entry: Entry) => {
    entries.current.set(key, entry);
    return () => {
      if (entries.current.get(key) === entry) entries.current.delete(key);
    };
  };

  const grab = (key: string, event: HeldPointer) => {
    const group = entries.current.get(key)?.group;
    if (!group || !root.current || event.button !== 0) return;
    event.preventDefault();
    release.current?.();
    let point = { x: event.clientX, y: event.clientY };
    let target: Over | null = null;
    const scroller = scrollAncestor(root.current);
    const find = () => {
      const box = document.elementFromPoint(point.x, point.y)?.closest<HTMLElement>('[data-order-key]');
      const at = box?.dataset.orderKey;
      const entry = at === undefined ? undefined : entries.current.get(at);
      if (!box || at === undefined || entry?.group !== group || at === key) target = null;
      else {
        const rect = box.getBoundingClientRect();
        target = { key: at, side: point.x > rect.left + rect.width / 2 ? 'after' : 'before' };
      }
      setOver((shown) => (shown?.key === target?.key && shown?.side === target?.side ? shown : target));
    };
    let frame = 0;
    const tick = () => {
      const edges = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
      const near = point.y < edges.top + EDGE ? point.y - edges.top - EDGE : point.y > edges.bottom - EDGE ? point.y - edges.bottom + EDGE : 0;
      if (near !== 0) {
        (scroller ?? window).scrollBy(0, Math.max(-FASTEST, Math.min(FASTEST, (near / EDGE) * FASTEST)));
        find();
      }
      frame = requestAnimationFrame(tick);
    };
    const move = (moved: PointerEvent) => {
      point = { x: moved.clientX, y: moved.clientY };
      find();
    };
    const end = (drop: boolean) => {
      release.current?.();
      const landing = target;
      if (drop && landing) entries.current.get(landing.key)?.place(key, landing.side === 'after');
    };
    const up = () => end(true);
    const cancel = () => end(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    release.current = () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      release.current = null;
      setHeld(null);
      setOver(null);
    };
    setHeld(key);
    frame = requestAnimationFrame(tick);
  };

  // Arrows move a card one place among its group; the grid's own arrows, which move focus, do not run.
  const step = (key: string, event: KeyboardEvent) => {
    const back = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
    if (!back && event.key !== 'ArrowRight' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    event.stopPropagation();
    const group = entries.current.get(key)?.group;
    const same = keys.filter((each) => entries.current.get(each)?.group === group);
    const neighbor = same[same.indexOf(key) + (back ? -1 : 1)];
    if (neighbor === undefined) return;
    refocus.current = key;
    entries.current.get(neighbor)!.place(key, !back);
  };

  return <OrderContext.Provider value={{ held, over, register, grab, step }}>{children}</OrderContext.Provider>;
}

// arrange: this card's key and its handle's label, while the grid is being ordered. side: the line beside it, held: it
// is the one being moved.
export function useOrderHandle(arrange: { key: string; label: string } | undefined, group: OrderGroup, onPlace: Place | undefined) {
  const order = useContext(OrderContext);
  const key = arrange?.key;
  useEffect(() => (order && key !== undefined && onPlace ? order.register(key, { group, place: onPlace }) : undefined), [order, key, group, onPlace]);
  if (!order || !arrange || !onPlace) return null;
  return {
    side: order.over?.key === arrange.key ? order.over.side : null,
    held: order.held === arrange.key,
    box: { 'data-order-key': arrange.key },
    handle: {
      'data-order-handle': true,
      'aria-label': arrange.label,
      title: arrange.label,
      onPointerDown: (event: HeldPointer) => order.grab(arrange.key, event),
      onKeyDown: (event: KeyboardEvent) => order.step(arrange.key, event),
    },
  };
}
