import { expect, it } from 'vitest';
import { coachSpot } from './Guide';

const note = { width: 300, height: 160 };
const phone = { width: 390, height: 844 };
const box = (left: number, top: number, width: number, height: number) => ({ left, top, right: left + width, bottom: top + height });
// The page's head across a phone's top, its 뒤로 and title in it.
const head = box(0, 0, 390, 56);
const overlaps = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

it('turns a note asked over its control to the side that leaves the head clear, and docks it when no side is clear', () => {
  const field = box(16, 180, 358, 80);
  expect(coachSpot(field, note, phone, 8, true, (spot) => overlaps(spot, head))).toEqual({ left: 16, top: 268 });
  expect(coachSpot(field, note, phone, 8, true, () => false)).toEqual({ left: 16, top: 12 });
  expect(coachSpot(field, note, phone, 8, true, () => true)).toBeNull();
  // A control at a wide page's right edge: left of it before over or under it.
  expect(coachSpot(box(1200, 400, 32, 32), note, { width: 1240, height: 800 }, 8, true, () => false)).toEqual({ left: 892, top: 400 });
});
