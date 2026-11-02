import { useEffect } from 'react';
import { MEDIA } from '../foundation/media';

export const stillness = () => matchMedia(MEDIA.reducedMotion).matches;

// Where each [data-walk-stop] of the page stands at the screen this was tuned on (1440x900), as a share of the scroll, in page order.
// The walk is written against these and only its frames' places on the scroll move with the real page, so a stop shows the same scene on every screen.
const TUNED_STOPS = [0, 0.1725, 0.331, 0.5096, 0.79, 1];

const scrollRange = () => Math.max(document.documentElement.scrollHeight - innerHeight, 1);

const readStops = () => {
  const range = scrollRange();
  const within = (at: number) => Math.min(Math.max(at, 0), range);
  return [...document.querySelectorAll<HTMLElement>('[data-walk-stop]')].map((node) => {
    const { top, height } = node.getBoundingClientRect();
    const at = top + scrollY;
    const spare = height - innerHeight;
    // A beat that fits stands in the middle of the screen; a longer one is read freely from end to end.
    if (node.dataset['walkStop'] === 'top') return { from: within(at), to: within(at) };
    return spare > 0 ? { from: within(at), to: within(at + spare) } : { from: within(at + spare / 2), to: within(at + spare / 2) };
  });
};

export const along = (knots: readonly (readonly [number, number])[], at: number) => {
  const after = knots.findIndex(([x]) => x >= at);
  if (after < 0) return knots[knots.length - 1]![1];
  if (after === 0) return knots[0]![1];
  const [fromX, fromY] = knots[after - 1]!;
  const [toX, toY] = knots[after]!;
  return fromY + ((at - fromX) / (toX - fromX)) * (toY - fromY);
};

// Where on this page's real scroll a tuned share falls. The last stop is the end of the scroll even when its beat runs longer than the screen.
export type Pace = (tuned: number) => number;
export const samePace: Pace = (tuned) => tuned;

export const paceOfPage = (): Pace => {
  const range = scrollRange();
  const stops = readStops();
  const knots = stops.map(({ from }, index) => [TUNED_STOPS[index]!, index === stops.length - 1 ? 1 : from / range] as const);
  return (tuned) => along(knots, tuned);
};

const SETTLED_AFTER = 120;
const GLIDE_PER_PIXEL = 1.2;
const GLIDE_SHORTEST = 900;
const GLIDE_LONGEST = 2400;
const SCROLL_KEYS = new Set(['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', ' ', 'Home', 'End']);
const typing = () => document.activeElement?.matches('input, textarea, select') ?? false;

// When the visitor's own scroll comes to rest between stops, the walk carries on to the next stop that way.
// Nothing is intercepted: the browser's scroll stays whole, and a scroll that is not the visitor's (find in page, the scrollbar, a focus) is left where it lands.
export function useWalkOn() {
  useEffect(() => {
    if (stillness()) return;
    let meant = false;
    let touching = false;
    let left = scrollY;
    let settling: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;

    const halt = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };
    const glide = (to: number) => {
      const from = scrollY;
      const takes = Math.min(Math.max(Math.abs(to - from) * GLIDE_PER_PIXEL, GLIDE_SHORTEST), GLIDE_LONGEST);
      const began = performance.now();
      const step = (now: number) => {
        const done = Math.min((now - began) / takes, 1);
        scrollTo(0, from + (to - from) * ((1 - Math.cos(done * Math.PI)) / 2));
        frame = done < 1 ? requestAnimationFrame(step) : 0;
        if (!frame) left = scrollY;
      };
      frame = requestAnimationFrame(step);
    };
    const settle = () => {
      if (!meant || touching || typing()) return;
      meant = false;
      const at = scrollY;
      const stops = readStops();
      const movedOn = at > left;
      left = at;
      if (stops.some(({ from, to }) => at >= from - 1 && at <= to + 1)) return;
      const next = movedOn ? stops.find(({ from }) => from > at)?.from : stops.findLast(({ to }) => to < at)?.to;
      if (next !== undefined) glide(next);
    };
    const restLater = () => {
      clearTimeout(settling);
      settling = setTimeout(settle, SETTLED_AFTER);
    };
    const scrolled = () => {
      if (!frame) restLater();
    };
    const wheeled = () => {
      halt();
      meant = true;
    };
    const keyed = ({ key }: KeyboardEvent) => {
      if (SCROLL_KEYS.has(key)) wheeled();
    };
    const fingerDown = () => {
      halt();
      touching = true;
    };
    const fingerMoved = () => {
      meant = true;
    };
    const fingerUp = () => {
      touching = false;
      restLater();
    };

    addEventListener('scroll', scrolled, { passive: true });
    addEventListener('wheel', wheeled, { passive: true });
    addEventListener('keydown', keyed);
    addEventListener('touchstart', fingerDown, { passive: true });
    addEventListener('touchmove', fingerMoved, { passive: true });
    addEventListener('touchend', fingerUp, { passive: true });
    addEventListener('touchcancel', fingerUp, { passive: true });
    return () => {
      removeEventListener('scroll', scrolled);
      removeEventListener('wheel', wheeled);
      removeEventListener('keydown', keyed);
      removeEventListener('touchstart', fingerDown);
      removeEventListener('touchmove', fingerMoved);
      removeEventListener('touchend', fingerUp);
      removeEventListener('touchcancel', fingerUp);
      clearTimeout(settling);
      halt();
    };
  }, []);
}
