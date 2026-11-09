import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChangeSignal } from '../../../change-signal';
import { Steps } from '../feedback/Steps';
import { menuEdge, TAB_STOPS } from './layers';
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

type Box = { left: number; top: number; right: number; bottom: number };
type Size = { width: number; height: number };

// Right of the control, else left of it, else under it, or over it first when above (what comes next is under the
// control): the first spot that stays on the screen by edge and covers nothing kept, or null, docked.
export function coachSpot(at: Box, note: Size, screen: Size, edge: number, above: boolean, covers: (box: Box) => boolean) {
  const within = (value: number, size: number, room: number) => Math.min(Math.max(value, edge), room - size - edge);
  const fits = (start: number, size: number, room: number) => start >= edge && start + size + edge <= room;
  const beside = (left: number) => (fits(left, note.width, screen.width) ? { left, top: within(at.top, note.height, screen.height) } : null);
  const upright = (top: number) => (fits(top, note.height, screen.height) ? { left: within(at.left, note.width, screen.width), top } : null);
  const over = upright(at.top - GAP - note.height);
  const below = upright(at.bottom + GAP);
  const spots = [beside(at.right + GAP), beside(at.left - GAP - note.width), ...(above ? [over, below] : [below, over])];
  return spots.find((spot) => spot !== null && !covers({ ...spot, right: spot.left + note.width, bottom: spot.top + note.height })) ?? null;
}

// What a note leaves in view: the page's head and every control but the one it points at, where they show (not
// scrolled out of their box, nor under a window).
const KEPT = `header, ${TAB_STOPS}`;

function covering(target: HTMLElement, note: HTMLElement) {
  const kept = [...document.querySelectorAll<HTMLElement>(KEPT)]
    .filter((element) => !element.contains(target) && !target.contains(element) && !note.contains(element))
    .map((element) => ({ element, at: element.getBoundingClientRect() }));
  return (box: Box) =>
    kept.some(({ element, at }) => {
      const left = Math.max(box.left, at.left);
      const right = Math.min(box.right, at.right);
      const top = Math.max(box.top, at.top);
      const bottom = Math.min(box.bottom, at.bottom);
      if (left >= right || top >= bottom) return false;
      const shown = document.elementsFromPoint((left + right) / 2, (top + bottom) / 2).find((hit) => !note.contains(hit));
      return shown !== undefined && element.contains(shown);
    });
}

// A note by a control with a ring around it, following it each frame; nothing modal, so the control stays pressable.
// Placed by coachSpot; without a target, or with no spot clear by it, it docks in the corner.
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
      ring.current!.style.setProperty('--anchor-left', `${at.left}px`);
      ring.current!.style.setProperty('--anchor-top', `${at.top}px`);
      ring.current!.style.setProperty('--anchor-width', `${at.width}px`);
      ring.current!.style.setProperty('--anchor-height', `${at.height}px`);
      const spot = coachSpot(at, { width: box.offsetWidth, height: box.offsetHeight }, { width, height }, menuEdge(box), above, covering(target, box));
      box.toggleAttribute('data-docked', spot === null);
      if (!spot) return;
      box.style.setProperty('--coach-left', `${spot.left}px`);
      box.style.setProperty('--coach-top', `${spot.top}px`);
    };
    place();
    return () => cancelAnimationFrame(frame);
  }, [target, above]);

  return createPortal(
    <>
      {target && <div ref={ring} className={styles.ring} aria-hidden />}
      <div ref={bubble} role="note" aria-label={title} className={styles.bubble} data-docked={target ? undefined : ''}>
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
