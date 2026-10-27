import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { rowAt, viewLines } from '../collections/Viewport';
import { useAwake } from './awake';
import styles from './Scrubber.module.css';

type Props = {
  scrollRef: RefObject<HTMLElement | null>;
  keys: readonly string[];
  // Indexes into keys of the rows a drag stops at, in order.
  stops: readonly number[];
  label: (index: number) => string;
  onSeek: (key: string) => void;
};

const WAIT = 1200;
// A wheel's turn moves one stop, and the turns of one flick less often than this many ms count once.
const TURN = 150;
// Where the track gives a stop less than FINE px, a finger drawn PULL px off it moves one stop per STEP px.
const FINE = 14;
const PULL = 56;
const STEP = 16;

const clamp = (value: number, least: number, most: number) => Math.min(most, Math.max(least, value));

// The stop at the view's top and how far through it the view is; at the story's end, all through the last.
function where(frame: HTMLElement, order: ReadonlyMap<string, number>, stops: readonly number[]) {
  if (frame.scrollHeight - frame.scrollTop - frame.clientHeight < 1) return { stop: stops.length - 1, through: 1 };
  const row = rowAt(frame, viewLines(frame).top);
  const index = row ? (order.get(row.key) ?? -1) : -1;
  const stop = stops.findLastIndex((at) => at <= index);
  if (!row || stop < 0) return { stop: 0, through: 0 };
  return { stop, through: stops[stop] === index ? clamp(row.above / (row.above + row.below), 0, 1) : 1 };
}

// Give each message an equal track share regardless of length; drag seeks starts.
// Pointer-only here; keyboard uses story shortcuts.
export function Scrubber({ scrollRef, keys, stops, label, onSeek }: Props) {
  const { awake, wake } = useAwake(scrollRef, WAIT);
  const track = useRef<HTMLDivElement>(null);
  const order = useMemo(() => new Map(keys.map((key, index) => [key, index])), [keys]);
  // Capture track geometry at drag start: composer folding moves its foot mid-drag.
  // Keep fine-mode entry position/stop stable too.
  const grip = useRef<{ stop: number; fine: { y: number; stop: number } | null; box: DOMRect } | null>(null);
  const [drag, setDrag] = useState<{ stop: number; fine: boolean; coarse: boolean } | null>(null);
  const turned = useRef(0);
  const last = stops.length - 1;

  // The thumb follows the view past React, as the reading rail does.
  useLayoutEffect(() => {
    const frame = scrollRef.current!;
    const element = track.current;
    if (!element) return;
    let pending = 0;
    const place = () => {
      pending = 0;
      if (grip.current) return;
      const { stop, through } = where(frame, order, stops);
      element.style.setProperty('--scrubber-at', String(Math.min(1, (stop + through) / last)));
    };
    const schedule = () => {
      pending ||= requestAnimationFrame(place);
    };
    place();
    frame.addEventListener('scroll', schedule, { passive: true });
    return () => {
      cancelAnimationFrame(pending);
      frame.removeEventListener('scroll', schedule);
    };
  }, [scrollRef, order, stops, last]);

  if (last < 1) return null;

  function go(stop: number) {
    track.current!.style.setProperty('--scrubber-at', String(stop / last));
    onSeek(keys[stops[stop]!]!);
  }

  function seek(event: PointerEvent<HTMLDivElement>) {
    const held = grip.current!;
    const { box } = held;
    const thumb = parseFloat(getComputedStyle(track.current!).getPropertyValue('--scrubber-thumb'));
    const span = box.height - thumb;
    const coarse = span / last < FINE;
    if (coarse && !held.fine && held.stop >= 0 && box.left - event.clientX > PULL) held.fine = { y: event.clientY, stop: held.stop };
    const stop = clamp(held.fine ? held.fine.stop + Math.round((event.clientY - held.fine.y) / STEP) : Math.round(clamp((event.clientY - box.top - thumb / 2) / span, 0, 1) * last), 0, last);
    if (stop === held.stop) return;
    held.stop = stop;
    if ('vibrate' in navigator) navigator.vibrate(8);
    go(stop);
    setDrag({ stop, fine: held.fine !== null, coarse });
  }

  function end() {
    grip.current = null;
    setDrag(null);
    wake();
  }

  return (
    <div
      ref={track}
      className={`${styles.scrubber} ${awake || drag ? styles.awake : ''}`}
      aria-hidden
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        grip.current = { stop: -1, fine: null, box: event.currentTarget.getBoundingClientRect() };
        seek(event);
      }}
      onPointerMove={(event) => {
        if (grip.current) seek(event);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onWheel={(event) => {
        if (event.timeStamp - turned.current < TURN) return;
        turned.current = event.timeStamp;
        const { stop, through } = where(scrollRef.current!, order, stops);
        go(clamp(event.deltaY > 0 ? stop + 1 : through > 0 ? stop : stop - 1, 0, last));
        wake();
      }}
    >
      <span className={styles.line} />
      <span className={`${styles.thumb} ${drag ? styles.held : ''}`} />
      {drag && (
        <span className={styles.bubble}>
          {label(stops[drag.stop]!)}
          {drag.coarse && <span className={styles.note}>{drag.fine ? '하나씩 옮기는 중' : '왼쪽으로 끌면 하나씩'}</span>}
        </span>
      )}
    </div>
  );
}
