import { useEffect, type RefObject } from 'react';
import type { Pace } from '../common/reading';

// How far the view goes in a second, in the reader's letter sizes: larger letters hold less on a line, so they go by
// as much faster.
export const PACES: Record<Pace, number> = { slow: 0.5, normal: 0.9, fast: 1.5, fastest: 2.5 };

// How long the view waits after the reader's own move (a wheel, a press, a finger lifted) before it goes on.
const REST = 1500;
// And after a move from elsewhere (a seek, a swipe's momentum, the story held in place while its rows are measured),
// so it goes on from where that ends.
const SETTLE = 150;
// A frame later than this (the tab left and come back to) counts as this long.
const LONGEST = 100;

// at: where the view was put, finer than the pixel the browser keeps. The view is read back whole, so a step added to
// what was read would never add up at the slow paces. until: when it may go on.
export type Glide = { at: number; until: number };

// One frame. top: where the view is. end: the furthest it goes. speed: px a second.
export function glideOn({ at, until }: Glide, top: number, end: number, now: number, elapsed: number, speed: number): Glide {
  if (Math.abs(top - at) >= 1) return { at: top, until: Math.max(until, now + SETTLE) };
  if (now < until) return { at, until };
  return { at: Math.min(end, at + (speed * elapsed) / 1000), until };
}

// A view going down by itself has no touch to keep the screen on, so the screen is asked to stay on while told to.
// Where the browser has no such lock or refuses it, the screen sleeps as it would; a refusal is not asked again.
function screenWake() {
  let wanted = false;
  let asked = false;
  let lock: WakeLockSentinel | null = null;
  return (on: boolean) => {
    wanted = on;
    if (!on) {
      void lock?.release();
      lock = null;
    } else if (!lock && !asked && 'wakeLock' in navigator) {
      asked = true;
      navigator.wakeLock.request('screen').then(
        (got) => {
          asked = false;
          if (!wanted) return void got.release();
          lock = got;
          // The browser takes it back when the page is hidden.
          got.addEventListener('release', () => {
            if (lock === got) lock = null;
          });
        },
        () => {},
      );
    }
  };
}

// 자동으로 천천히 내려가기: the story goes down at speed px a second while there is more below; 0 is off. Its scroll events are
// the reader reading down to useFollow and ChatFrame, which is what it is.
export function useGlide(scrollRef: RefObject<HTMLElement | null>, speed: number) {
  useEffect(() => {
    if (!speed) return;
    const scroll = scrollRef.current!;
    const wake = screenWake();
    let glide: Glide = { at: scroll.scrollTop, until: 0 };
    let frame = 0;
    let last = 0;
    const step = (now: number) => {
      const top = scroll.scrollTop;
      const end = scroll.scrollHeight - scroll.clientHeight;
      const next = glideOn(glide, top, end, now, last ? Math.min(now - last, LONGEST) : 0, speed);
      // Only a step of its own is written: putting the view where it is would still end a swipe's momentum.
      if (next.at !== glide.at && next.at !== top) scroll.scrollTop = next.at;
      glide = next;
      // At the end it waits for a scroll or for the story to grow, not for frames.
      const more = glide.at < end;
      wake(more);
      last = more ? now : 0;
      frame = more ? requestAnimationFrame(step) : 0;
    };
    const start = () => {
      frame ||= requestAnimationFrame(step);
    };
    // By gestures, not scroll events, which its own steps send too.
    const rest = () => {
      glide = { ...glide, until: performance.now() + REST };
    };
    const ends = new AbortController();
    const heard = { signal: ends.signal, passive: true };
    // A touch ends on the node it began on, and a story drawn again under the finger has taken that node off the
    // page by then, so its end never rises to the story: it is heard on the node.
    const hold = (event: TouchEvent) => {
      glide = { ...glide, until: Infinity };
      const from = event.composedPath()[0]!;
      from.addEventListener('touchend', rest, heard);
      from.addEventListener('touchcancel', rest, heard);
    };
    const observer = new ResizeObserver(start);
    observer.observe(scroll);
    observer.observe(scroll.firstElementChild!);
    scroll.addEventListener('scroll', start, heard);
    scroll.addEventListener('wheel', rest, heard);
    scroll.addEventListener('mousedown', rest, heard);
    scroll.addEventListener('touchstart', hold, heard);
    return () => {
      cancelAnimationFrame(frame);
      wake(false);
      observer.disconnect();
      ends.abort();
    };
  }, [scrollRef, speed]);
}
