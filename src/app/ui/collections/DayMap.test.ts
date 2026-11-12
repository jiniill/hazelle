import { expect, it } from 'vitest';
import { weeks } from './DayMap';

it('starts the strip on a Monday and opens a column for each month on its first day', () => {
  // 2026-01-01 was a Thursday: three blank days before it, February opens in its fifth week.
  const year = weeks(new Date(2026, 0, 1).getTime(), 365);
  expect(year.lead).toBe(3);
  expect(year.columns).toBe(53);
  expect(year.months.slice(0, 3)).toEqual([
    { column: 0, first: 0 },
    { column: 4, first: 31 },
    { column: 8, first: 59 },
  ]);
  expect(year.months).toHaveLength(12);
});
