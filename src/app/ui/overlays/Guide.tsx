import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChangeSignal } from '../../../change-signal';
import { Steps } from '../feedback/Steps';
import { menuEdge } from './layers';
import styles from './Guide.module.css';

// The marks on screen by name. A mark wraps one control without a box of its own, so what is pointed at is its
// first element; a list draws only the rows in view, so a name may have none for a while and gain one later. name
// null: a place in a list that marks only one of its rows.
const marks = new Map<string, Set<HTMLElement>>();
const changes = new ChangeSignal();

export function GuideMark({ name, children }: { name: string | null; children: ReactNode }) {
  const box = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (name === null) return;
    const element = box.current!;
    const named = marks.get(name) ?? new Set();
    marks.set(name, named);
    named.add(element);
    changes.notify();
    return () => {
      named.delete(element);
      changes.notify();
    };
  }, [name]);
  return <span ref={box} className={styles.mark}>{children}</span>;
}

function shownMark(name: string): HTMLElement | null {
  const shown = [...(marks.get(name) ?? [])]
    .map((box) => box.firstElementChild)
    .filter((element): element is HTMLElement => element instanceof HTMLElement && element.getClientRects().length > 0);
  shown.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  return shown[0] ?? null;
}

export const guideShown = (name: string) => shownMark(name) !== null;

// The first control on screen marked name, in the page's order.
export function useGuideTarget(name: string | null): HTMLElement | null {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (name === null) return setTarget(null);
    const pick = () => setTarget(shownMark(name));
    pick();
    const leave = changes.subscribe(pick);
    return () => void leave();
  }, [name]);
  return target;
}

const GAP = 8;

// A note by a control with a ring around it, following it each frame; nothing modal, so the control stays pressable.
// It stands right of the control where the screen has room, else under it, or over it when above (what comes next is
// under the control), turning to the other side where it runs off the screen; without a target it docks in the corner.
// progress: where the note stands in its walk, said at the title's end and drawn under it.
type Progress = { current: number; total: number };
export function Coach({ target, title, progress, above = false, children }: { target: HTMLElement | null; title: string; progress: Progress; above?: boolean; children: ReactNode }) {
  const ring = useRef<HTMLDivElement>(null);
  const bubble = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!target) return;
    const at = target.getBoundingClientRect();
    if (at.top < 0 || at.bottom > window.innerHeight) target.scrollIntoView({ block: 'center' });
  }, [target]);

  useLayoutEffect(() => {
    if (!target) return;
    let frame = 0;
    let placed = '';
    const place = () => {
      frame = requestAnimationFrame(place);
      const at = target.getBoundingClientRect();
      const box = bubble.current!;
      const width = document.documentElement.clientWidth;
      const height = window.innerHeight;
      const key = `${at.left} ${at.top} ${at.width} ${at.height} ${width} ${height} ${box.offsetWidth} ${box.offsetHeight}`;
      if (key === placed) return;
      placed = key;
      const edge = menuEdge(box);
      const within = (value: number, size: number, room: number) => Math.min(Math.max(value, edge), room - size - edge);
      ring.current!.style.setProperty('--anchor-left', `${at.left}px`);
      ring.current!.style.setProperty('--anchor-top', `${at.top}px`);
      ring.current!.style.setProperty('--anchor-width', `${at.width}px`);
      ring.current!.style.setProperty('--anchor-height', `${at.height}px`);
      let left = at.right + GAP;
      let top = at.top;
      if (left + box.offsetWidth + edge > width) {
        const below = at.bottom + GAP;
        const over = at.top - GAP - box.offsetHeight;
        const fitsBelow = below + box.offsetHeight + edge <= height;
        const fitsAbove = over >= edge;
        left = at.left;
        top = (above ? fitsAbove || !fitsBelow : !fitsBelow && fitsAbove) ? over : below;
      }
      box.style.setProperty('--coach-left', `${within(left, box.offsetWidth, width)}px`);
      box.style.setProperty('--coach-top', `${within(top, box.offsetHeight, height)}px`);
    };
    place();
    return () => cancelAnimationFrame(frame);
  }, [target, above]);

  return createPortal(
    <>
      {target && <div ref={ring} className={styles.ring} aria-hidden />}
      <div ref={bubble} role="note" aria-label={title} className={target ? styles.bubble : `${styles.bubble} ${styles.docked}`}>
        <div className={styles.head}>
          <span className={styles.title}>{title}</span>
          <span className={styles.note}>
            {progress.current}/{progress.total}
          </span>
        </div>
        <Steps current={progress.current} total={progress.total} />
        {children}
      </div>
    </>,
    document.body,
  );
}
