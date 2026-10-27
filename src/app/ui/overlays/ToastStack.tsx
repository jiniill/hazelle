import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FocusEvent, type Key, type PointerEvent, type ReactNode, type RefObject } from 'react';
import { useWide } from '../foundation/media';
import styles from './ToastStack.module.css';

type Props = {
  // Newest first: the first is in front, and the others wait behind it until the stack is pointed at. onClose: a
  // finger sliding the notice sideways puts it away.
  items: { key: Key; toast: ReactNode; onClose?: () => void }[];
  // How many wait behind the ones shown, counted past the stack's back edge.
  waiting: number;
  // Held while a mouse is over the stack or the focus is in it: open, its notices' time stopped. The caller keeps it,
  // since the time it stops outlives the stack.
  held: boolean;
  onHold: (held: boolean) => void;
  // Where the stack stands at the bottom, it stands above this, so it hides none of its buttons: the chat's composer
  // with the cards over it, such as a bot's question.
  floor: HTMLElement | null;
};

export function ToastStack({ items, waiting, held: open, onHold: hold, floor }: Props) {
  const holding = useHold(open, hold);
  // Away from where the stack stands: down from the bottom on a wide screen, up past the header on a phone.
  const away = useWide() ? 1 : -1;
  useFloor(holding.ref, floor, items.length > 0);
  // Each notice's own box: a short one is narrower than the stack.
  const [sizes, setSizes] = useState<ReadonlyMap<Key, { height: number; width: number }>>(() => new Map());
  // Keep one ref per notice across renders/detach; new refs remeasure/rerender forever.
  // StrictMode detaches on mount; only evict refs when the notice is gone.
  const refs = useRef(new Map<Key, (element: HTMLElement | null) => () => void>());
  for (const key of refs.current.keys()) if (!items.some((item) => item.key === key)) refs.current.delete(key);
  const measure = (key: Key) => {
    let ref = refs.current.get(key);
    if (!ref) {
      ref = (element: HTMLElement | null) => {
        const notice = element?.firstElementChild as HTMLElement | null | undefined;
        const observer = new ResizeObserver(() => {
          if (!notice) return;
          const size = { height: notice.offsetHeight, width: notice.offsetWidth };
          setSizes((all) => (all.get(key)?.height === size.height && all.get(key)?.width === size.width ? all : new Map(all).set(key, size)));
        });
        if (notice) observer.observe(notice);
        return () => {
          observer.disconnect();
          setSizes((all) => {
            if (!all.has(key)) return all;
            const rest = new Map(all);
            rest.delete(key);
            return rest;
          });
        };
      };
      refs.current.set(key, ref);
    }
    return ref;
  };
  if (items.length === 0) return null;
  const height = (key: Key) => sizes.get(key)?.height ?? 0;
  const lifts = items.map((_, index) => items.slice(0, index).reduce((sum, { key }) => sum + height(key), 0));
  const front = height(items[0]!.key);
  const total = lifts.at(-1)! + height(items.at(-1)!.key);
  return (
    <div
      className={open ? `${styles.stack} ${styles.open}` : styles.stack}
      style={{ '--front': `${front}px`, '--front-width': `${sizes.get(items[0]!.key)?.width ?? 0}px`, '--total': `${total}px`, '--count': items.length } as CSSProperties}
      {...holding}
    >
      {items.map(({ key, toast, onClose }, index) => (
        <div
          key={key}
          className={index > 0 && !open ? `${styles.item} ${styles.behind}` : styles.item}
          style={{ '--index': index, '--lift': `${lifts[index]}px` } as CSSProperties}
          inert={index > 0 && !open}
        >
          <Swiped measure={measure(key)} away={away} onClose={onClose}>
            {toast}
          </Swiped>
        </div>
      ))}
      {waiting > 0 && <span className={styles.waiting}>+{waiting}</span>}
    </div>
  );
}

// Written past React, so the stack follows the composer frame by frame as it folds or a card comes and goes.
function useFloor(stack: RefObject<HTMLDivElement | null>, floor: HTMLElement | null, shown: boolean) {
  useLayoutEffect(() => {
    const element = stack.current;
    if (!element || !floor) return;
    // Suspense hides the chat, composer and all, while the next screen loads: then the stack stands at the bottom.
    const measure = () => {
      const { top, height } = floor.getBoundingClientRect();
      element.style.setProperty('--rise', `${height ? window.innerHeight - top : 0}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(floor);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      element.style.removeProperty('--rise');
    };
  }, [stack, floor, shown]);
}

export function useHold(held: boolean, hold: (held: boolean) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const pointed = useRef(false);
  const focused = () => ref.current?.contains(document.activeElement) ?? false;
  // Recheck focus/hover after render: removed focused notices emit no React blur,
  // and removing the last hovered notice emits no pointerleave.
  useEffect(() => {
    if (!ref.current) pointed.current = false;
    if (held && !pointed.current && !focused()) hold(false);
  });
  return {
    ref,
    onPointerEnter: (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      pointed.current = true;
      hold(true);
    },
    onPointerLeave: (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      pointed.current = false;
      hold(focused());
    },
    onFocus: () => hold(true),
    onBlur: (event: FocusEvent) => event.currentTarget.contains(event.relatedTarget) || hold(pointed.current),
  };
}

// Past this a finger's move is a slide, not a press: 되돌리기 under it is not pressed. A move inside a long notice's
// words scrolls them instead (Toast's pan-y).
const SLIDE = 8;

type Shift = { axis: 'x' | 'y'; by: number };

// A finger slides a notice sideways, or away (1 down, -1 up), to put it away; a mouse's drag is left to selecting text,
// and its notices have a ×.
function Swiped({ measure, away, onClose, children }: { measure: (element: HTMLElement | null) => () => void; away: 1 | -1; onClose?: () => void; children: ReactNode }) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const [shift, setShift] = useState<Shift | null>(null);
  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (onClose && event.pointerType !== 'mouse') start.current = { x: event.clientX, y: event.clientY };
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const x = event.clientX - start.current.x;
    const y = event.clientY - start.current.y;
    if (shift) return setShift({ axis: shift.axis, by: shift.axis === 'x' ? x : Math.sign(y) === away ? y : 0 });
    const axis = Math.abs(x) > Math.abs(y) ? 'x' : 'y';
    if (Math.max(Math.abs(x), Math.abs(y)) <= SLIDE) return;
    if (axis === 'y' && Math.sign(y) !== away) return void (start.current = null);
    event.currentTarget.setPointerCapture(event.pointerId);
    setShift({ axis, by: axis === 'x' ? x : y });
  };
  const up = (event: PointerEvent<HTMLDivElement>) => {
    start.current = null;
    const room = shift?.axis === 'x' ? event.currentTarget.offsetWidth / 3 : event.currentTarget.offsetHeight / 2;
    if (shift && Math.abs(shift.by) > room) onClose!();
    else setShift(null);
  };
  return (
    <div
      ref={measure}
      className={shift === null ? styles.swiped : `${styles.swiped} ${styles.sliding}`}
      style={shift === null ? undefined : ({ '--shift': shift.axis === 'x' ? `${shift.by}px 0` : `0 ${shift.by}px` } as CSSProperties)}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => ((start.current = null), setShift(null))}
    >
      {children}
    </div>
  );
}
