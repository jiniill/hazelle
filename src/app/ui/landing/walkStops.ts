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
    if (node.dataset['walkStop'] === 'top') return { from: within(at), to: within(at), slow: node.dataset['walkSlow'] !== undefined };
    const { paddingTop, paddingBottom } = getComputedStyle(node);
    // A beat whose words fit stands in the middle of the screen, even if its padding falls off it, so no move is a nudge of a few pixels; a longer one is read in moves from end to end.
    return spare > parseFloat(paddingTop) + parseFloat(paddingBottom) ? { from: within(at), to: within(at + spare), slow: false } : { from: within(at + spare / 2), to: within(at + spare / 2), slow: false };
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

const READ_STEP = 0.8;
const ALREADY_THERE = 0.1;

// Where one move can end: each stop, and the screens of a beat longer than the screen, so all of it can be read.
const restsOfPage = () =>
  readStops().flatMap(({ from, to }) => {
    const moves = Math.ceil((to - from) / (innerHeight * READ_STEP));
    return Array.from({ length: moves + 1 }, (_, move) => from + (moves ? (to - from) * (move / moves) : 0));
  });

const restAhead = (way: number) => {
  const at = scrollY;
  const rests = restsOfPage();
  // A stop that moved a little under the visitor (fonts arriving, the screen's bars) is where they already are: a gesture never spends itself on a nudge.
  const here = innerHeight * ALREADY_THERE;
  return way > 0 ? rests.find((rest) => rest > at + here) : rests.findLast((rest) => rest < at - here);
};

const scrollerAhead = (from: EventTarget | null, way: number) => {
  for (let node = from instanceof Element ? from : null; node && node !== document.body; node = node.parentElement) {
    if (node.scrollHeight <= node.clientHeight + 1) continue;
    const { overflowY } = getComputedStyle(node);
    if (overflowY !== 'auto' && overflowY !== 'scroll') continue;
    if (way > 0 ? node.scrollTop + node.clientHeight < node.scrollHeight - 1 : node.scrollTop > 1) return true;
  }
  return false;
};

const GLIDE_PER_PIXEL = 0.9;
const GLIDE_SHORTEST = 800;
const GLIDE_LONGEST = 1600;
// A threshold crossed in the same time as any other move reads as a cut.
const GLIDE_ACROSS = 2600;
const GLIDE_ATTACK = 0.75;
// Longer than the gap between a flick's inertial events, shorter than the pause before another notch.
const GESTURE_GAP = 160;
const SWIPE = 24;
const KEY_WAYS: Record<string, number> = { ArrowDown: 1, PageDown: 1, End: 1, ArrowUp: -1, PageUp: -1, Home: -1 };
const PRESSABLE = 'a, button, summary, [role="button"], [role="link"]';
const glideTakes = (from: number, to: number) =>
  readStops().some(({ from: at, slow }) => slow && at >= Math.min(from, to) - 1 && at <= Math.max(from, to) + 1) ? GLIDE_ACROSS : Math.min(Math.max(Math.abs(to - from) * GLIDE_PER_PIXEL, GLIDE_SHORTEST), GLIDE_LONGEST);
const typing = () => document.activeElement?.matches('input, textarea, select') ?? false;
const zoomedIn = () => (visualViewport?.scale ?? 1) > 1.01;

// One wheel gesture, swipe or scroll key moves one rest, at once, and what comes during the move is swallowed.
// CSS scroll snap cannot do this: in Chromium y mandatory snaps one wheel notch back forever.
// Left to the browser: a scroller inside the page while it can still move that way, browser zoom, a pull down at the top, the scrollbar and find in page. A sideways start is held: nothing here scrolls sideways, and left alone its upward part would stop the page between rests.
export function useWalkOn() {
  useEffect(() => {
    if (stillness()) return;
    let frame = 0;
    let gesture: 'open' | 'inside' | 'spent' = 'open';
    let lastWheel = -Infinity;
    let finger: { x: number; y: number; state: 'undecided' | 'holding' | 'spent' } | null = null;

    const glide = (to: number) => {
      const from = scrollY;
      const takes = glideTakes(from, to);
      const began = performance.now();
      const step = (now: number) => {
        const done = Math.min(Math.max(now - began, 0) / takes, 1);
        scrollTo(0, from + (to - from) * ((1 - Math.cos(done ** GLIDE_ATTACK * Math.PI)) / 2));
        frame = done < 1 ? requestAnimationFrame(step) : 0;
      };
      frame = requestAnimationFrame(step);
    };

    const wheeled = (event: WheelEvent) => {
      if (event.ctrlKey || !event.deltaY) return;
      if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return event.preventDefault();
      const way = Math.sign(event.deltaY);
      if (event.timeStamp - lastWheel > GESTURE_GAP) gesture = 'open';
      lastWheel = event.timeStamp;
      if (frame || gesture === 'spent') return event.preventDefault();
      if (scrollerAhead(event.target, way)) {
        gesture = 'inside';
        return;
      }
      event.preventDefault();
      // A flick that ran a list inside to its end must not carry on and leave the room.
      if (gesture === 'inside') return;
      gesture = 'spent';
      const rest = restAhead(way);
      if (rest !== undefined) glide(rest);
    };

    const keyed = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || typing()) return;
      const space = event.key === ' ';
      const way = space ? (event.shiftKey ? -1 : 1) : KEY_WAYS[event.key];
      if (!way || (space && (event.target as Element).matches(PRESSABLE)) || scrollerAhead(event.target, way)) return;
      const rest = event.key === 'Home' ? restsOfPage()[0] : event.key === 'End' ? restsOfPage().at(-1) : restAhead(way);
      if (rest === undefined) return;
      event.preventDefault();
      if (!frame) glide(rest);
    };

    const fingerDown = ({ touches }: TouchEvent) => {
      finger = touches.length === 1 ? { x: touches[0]!.clientX, y: touches[0]!.clientY, state: frame ? 'spent' : 'undecided' } : null;
    };
    const fingerMoved = (event: TouchEvent) => {
      if (!finger) return;
      if (event.touches.length > 1) {
        finger = null;
        return;
      }
      const { clientX, clientY } = event.touches[0]!;
      const down = finger.y - clientY;
      if (!down && clientX === finger.x) return;
      if (finger.state === 'undecided') {
        // The browser takes the gesture for good on the first move left uncancelled, so this one move decides it.
        const way = Math.sign(down);
        const upright = Math.abs(down) > Math.abs(clientX - finger.x);
        if (zoomedIn() || typing() || (upright && (scrollerAhead(event.target, way) || restAhead(way) === undefined))) {
          finger = null;
          return;
        }
        finger.state = 'holding';
      }
      if (event.cancelable) event.preventDefault();
      if (finger.state === 'holding' && Math.abs(down) >= SWIPE) {
        finger.state = 'spent';
        const rest = restAhead(Math.sign(down));
        if (rest !== undefined) glide(rest);
      }
    };

    addEventListener('wheel', wheeled, { passive: false });
    addEventListener('keydown', keyed);
    addEventListener('touchstart', fingerDown, { passive: true });
    addEventListener('touchmove', fingerMoved, { passive: false });
    return () => {
      removeEventListener('wheel', wheeled);
      removeEventListener('keydown', keyed);
      removeEventListener('touchstart', fingerDown);
      removeEventListener('touchmove', fingerMoved);
      cancelAnimationFrame(frame);
    };
  }, []);
}
