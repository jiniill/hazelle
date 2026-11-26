import { expect, it } from 'vitest';
import { nextAt } from './WorkSection';

it('reads a clock time as its next coming, today or tomorrow, and nothing else', () => {
  const now = new Date(2026, 10, 26, 16, 30).getTime();
  expect(nextAt('17:00', now)).toBe(new Date(2026, 10, 26, 17, 0).getTime());
  expect(nextAt(' 5:05 ', now)).toBe(new Date(2026, 10, 27, 5, 5).getTime());
  expect(nextAt('16:30', now)).toBe(new Date(2026, 10, 27, 16, 30).getTime());
  for (const typed of ['', '17', '24:00', '17:60', '오후 5시']) expect(nextAt(typed, now)).toBeNull();
});
