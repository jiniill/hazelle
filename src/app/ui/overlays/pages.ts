import { useRef, type KeyboardEvent, type TouchEvent } from 'react';
import { pressedKey } from '../foundation/keys';

// What an overlay steps through: the versions of a picture, the assets of a list.
export type Pages = { at: number; count: number; onStep: (by: -1 | 1) => void };

// Where ← → and a sideways stroke already move something: the caret, a slider, a video's time.
const OWN_ARROWS = 'input, textarea, select, video, audio, [contenteditable]:not([contenteditable="false"])';

export const stepping = (pages: Pages | undefined) => (pages && pages.count > 1 ? pages : undefined);

export const STEP_KEYS = { label: '이전 · 다음', keys: [{ key: 'ArrowLeft', mod: false, shift: false }, { key: 'ArrowRight', mod: false, shift: false }] } as const;

export function stepByKey(pages: Pages | undefined, event: KeyboardEvent) {
  if (!pages) return;
  const step = pressedKey(event, STEP_KEYS.keys);
  if (step === -1 || (event.target as Element).closest(OWN_ARROWS)) return;
  event.preventDefault();
  pages.onStep(step === 0 ? -1 : 1);
}

type Point = { x: number; y: number };
const STROKE = 48;

// A stroke long enough and mostly sideways steps; leftwards is the next page, as a phone's gallery turns.
export function strokeStep(from: Point, to: Point): -1 | 1 | 0 {
  const dx = to.x - from.x;
  if (Math.abs(dx) < STROKE || Math.abs(dx) < 2 * Math.abs(to.y - from.y)) return 0;
  return dx < 0 ? 1 : -1;
}

// One finger only, so a pinch to zoom never steps.
export function useSwipe(pages: Pages | undefined) {
  const from = useRef<Point | null>(null);
  if (!pages) return {};
  return {
    onTouchStart: (event: TouchEvent) => {
      const touch = event.touches[0];
      from.current = touch && event.touches.length === 1 && !(event.target as Element).closest(OWN_ARROWS) ? { x: touch.clientX, y: touch.clientY } : null;
    },
    onTouchEnd: (event: TouchEvent) => {
      const start = from.current;
      from.current = null;
      const touch = event.changedTouches[0];
      const step = start && touch ? strokeStep(start, { x: touch.clientX, y: touch.clientY }) : 0;
      if (step) pages.onStep(step);
    },
  };
}
