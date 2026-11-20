import { expect, it } from 'vitest';
import type { LeftMeter } from '../connectors/types';
import { pace, verdict } from './pace';

const DAY = 24 * 60 * 60 * 1000;
const credits = (amount: number, at: number): LeftMeter => ({ kind: 'left', label: 'AI 크레딧', unit: 'credit', amount, limit: 300, resets: { at } });

it('compares the spent share with an even spend over the month to the reset, cut to the group’s turn, and gives none from unknown inputs', () => {
  const november = Date.UTC(2026, 10, 1);
  const now = Date.UTC(2026, 9, 16, 12);
  expect(pace(credits(120, november), now, null)).toEqual({ used: 60, even: 50, perDay: 120 / 15.5, daysLeft: 16, endsAtSwitch: false });
  expect(pace(credits(120, november), now, { start: Date.UTC(2026, 9, 16), end: Date.UTC(2026, 10, 16) })).toMatchObject({ even: 3, endsAtSwitch: false });
  expect(pace(credits(120, Date.UTC(2026, 11, 1)), Date.UTC(2026, 10, 8), { start: Date.UTC(2026, 9, 16), end: Date.UTC(2026, 10, 16) })).toMatchObject({ even: 47, daysLeft: 8, endsAtSwitch: true });

  expect(pace({ ...credits(120, november), resets: 'monthly' }, now, null)).toBeNull();
  expect(pace({ ...credits(120, november), limit: null }, now, null)).toBeNull();
  expect(pace(credits(120, november), now, { start: now + DAY, end: now + 30 * DAY })).toBeNull();
});

it('reads more than ten points off the even mark as fast or slow', () => {
  const at = (used: number, even: number) => verdict({ used, even, perDay: 0, daysLeft: 1, endsAtSwitch: false });
  expect([at(48, 37), at(46, 37), at(26, 37), at(27, 37)]).toEqual(['fast', 'even', 'slow', 'even']);
});
